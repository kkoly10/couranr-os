import { assertServerOnly } from "@/lib/couranr/serverOnly";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { computeCanonicalGoogleRoute } from "@/lib/couranr/routing/googleRoutes";
import {
  capturePaymentForAutomation,
  createDeliveryFromPromotionalCreditForAutomation,
  getPromotionalCredit,
  isFulfillmentFailure,
} from "@/lib/couranr/fulfillment/commands";
import { logServerFailure, newCorrelationId } from "@/lib/couranr/errors";

assertServerOnly("lib/couranr/automation/engine.ts");

export const AUTO_FULFILLMENT_VERSION = "couranr-auto-fulfillment-v1-2026-09-04";
export const AUTO_DISPATCH_TICK_LIMIT = 25;

type AutoResult = {
  ok: boolean;
  requestId: string;
  outcome: string;
  reason?: string;
  deliveryId?: string | null;
  assignmentId?: string | null;
};

function recordFailure(operation: string, detail: unknown) {
  const correlationId = newCorrelationId();
  logServerFailure({
    operation,
    correlationId,
    code: "internal",
    detail,
  });
  return correlationId;
}

async function rpc<T = any>(
  operation: string,
  fn: string,
  args: Record<string, unknown>
): Promise<{ ok: true; value: T } | { ok: false; message: string }> {
  const { data, error } = (await supabaseAdmin.rpc(fn, args)) as {
    data: T | null;
    error: any;
  };
  if (error) {
    recordFailure(operation, { fn, code: error.code, message: error.message });
    return { ok: false, message: String(error.message ?? "rpc_failed") };
  }
  return { ok: true, value: data as T };
}

/**
 * Advance one request through the parts of the normal lane that do not depend
 * on wall-clock dispatch.
 *
 * Safe to call after submit, payer authorization, readiness changes, from a
 * webhook, and from the periodic catch-up worker. Every database mutation is
 * idempotent and re-checks the canonical request/quote itself.
 */
export async function advanceAutomaticFulfillment(
  requestId: string
): Promise<AutoResult> {
  const accepted = await rpc<Record<string, any>>(
    "advanceAutomaticFulfillment.autoAccept",
    "couranr_try_auto_accept_standard_request",
    { p_request_id: requestId }
  );
  if (!accepted.ok) {
    return { ok: false, requestId, outcome: "auto_accept_failed", reason: accepted.message };
  }

  const planned = await rpc<Record<string, any>>(
    "advanceAutomaticFulfillment.autoPlan",
    "couranr_try_auto_plan",
    {
      p_request_id: requestId,
      p_planner_version: AUTO_FULFILLMENT_VERSION,
      p_now: new Date().toISOString(),
    }
  );
  if (!planned.ok) {
    return { ok: false, requestId, outcome: "auto_plan_failed", reason: planned.message };
  }

  const outcome = String(planned.value?.outcome ?? "waiting");

  // Promotional credit is already a completed commercial settlement. Once
  // the automatic plan exists, create the canonical scheduled delivery now;
  // real-card deliveries wait until dispatch so capture stays late-bound.
  if (outcome === "planned" || outcome === "already_planned") {
    const credit = await getPromotionalCredit({ requestId });
    if (!isFulfillmentFailure(credit) && credit.value.credit) {
      const created = await createDeliveryFromPromotionalCreditForAutomation({ requestId });
      if (isFulfillmentFailure(created)) {
        return {
          ok: false,
          requestId,
          outcome: "credit_delivery_conversion_failed",
          reason: created.message ?? created.code,
        };
      }
      return {
        ok: true,
        requestId,
        outcome: "scheduled",
        deliveryId: String(created.value.delivery.id),
      };
    }
  }

  return {
    ok: true,
    requestId,
    outcome,
    reason: planned.value?.reason ? String(planned.value.reason) : undefined,
  };
}

async function openException(params: {
  requestId: string;
  stage: "review" | "planning" | "dispatch" | "commercial";
  reason: string;
  detail: Record<string, unknown>;
  servicePlanId?: string | null;
  deliveryId?: string | null;
}) {
  return rpc(
    "automaticFulfillment.openException",
    "couranr_open_automation_exception",
    {
      p_request_id: params.requestId,
      p_stage: params.stage,
      p_reason: params.reason,
      p_detail: params.detail,
      p_service_plan_id: params.servicePlanId ?? null,
      p_delivery_id: params.deliveryId ?? null,
    }
  );
}

async function resolveException(requestId: string, stage: string) {
  return rpc("automaticFulfillment.resolveException", "couranr_resolve_automation_exception", {
    p_request_id: requestId,
    p_stage: stage,
  });
}

async function releaseReservation(reservationId: string, reason: string) {
  await rpc(
    "automaticFulfillment.releaseDispatchReservation",
    "couranr_release_automatic_dispatch_reservation",
    { p_reservation_id: reservationId, p_reason: reason }
  );
}

async function openDispatchException(
  plan: Record<string, any>,
  reason: string,
  detail: Record<string, unknown>,
  deliveryId?: string | null
) {
  await openException({
    requestId: String(plan.request_id),
    stage: "dispatch",
    reason,
    detail: {
      plannerVersion: plan.planner_version,
      servicePlanId: plan.id,
      ...detail,
    },
    servicePlanId: String(plan.id),
    deliveryId: deliveryId ?? null,
  });
}

/** Recoverable exception reasons automation may clear itself after re-checking. */
const SELF_HEALING_DISPATCH_REASONS = new Set([
  "readiness_changed",
  "route_revalidation_failed",
  "route_outside_auto_lane_at_dispatch",
]);

async function clearRecoverableDispatchException(requestId: string) {
  const { data } = (await supabaseAdmin
    .from("couranr_automation_exceptions")
    .select("reason")
    .eq("request_id", requestId)
    .eq("exception_stage", "dispatch")
    .eq("exception_state", "open")
    .maybeSingle()) as { data: any; error: any };
  if (data?.reason && SELF_HEALING_DISPATCH_REASONS.has(String(data.reason))) {
    await resolveException(requestId, "dispatch");
  }
}

async function dispatchOne(plan: Record<string, any>): Promise<AutoResult> {
  const requestId = String(plan.request_id);

  const { data: req, error: reqError } = (await supabaseAdmin
    .from("couranr_delivery_requests")
    .select(
      "id,request_state,readiness_state,current_quote_version_id,pickup_address,dropoff_address"
    )
    .eq("id", requestId)
    .maybeSingle()) as { data: any; error: any };

  if (reqError || !req) {
    recordFailure("automaticFulfillment.dispatch.loadRequest", {
      requestId,
      message: reqError?.message,
    });
    return { ok: false, requestId, outcome: "request_load_failed" };
  }

  if (req.request_state !== "confirmed") {
    await openDispatchException(plan, "request_no_longer_confirmed", {
      requestState: req.request_state,
    });
    return {
      ok: false,
      requestId,
      outcome: "dispatch_exception",
      reason: "request_no_longer_confirmed",
    };
  }

  if (req.readiness_state !== "ready") {
    await openDispatchException(plan, "readiness_changed", {
      readinessState: req.readiness_state,
    });
    return {
      ok: false,
      requestId,
      outcome: "dispatch_exception",
      reason: "readiness_changed",
    };
  }

  const pickupPlaceId = req.pickup_address?.googlePlaceId;
  const dropoffPlaceId = req.dropoff_address?.googlePlaceId;
  if (
    typeof pickupPlaceId !== "string" ||
    pickupPlaceId.length === 0 ||
    typeof dropoffPlaceId !== "string" ||
    dropoffPlaceId.length === 0
  ) {
    await openDispatchException(plan, "route_evidence_missing", {});
    return {
      ok: false,
      requestId,
      outcome: "dispatch_exception",
      reason: "route_evidence_missing",
    };
  }

  const route = await computeCanonicalGoogleRoute({
    pickupPlaceId,
    dropoffPlaceId,
    departureAt: plan.scheduled_pickup_start
      ? new Date(String(plan.scheduled_pickup_start))
      : null,
  });

  if (
    route.serviceabilityOutcome !== "available_for_request" ||
    route.loadedMiles === null ||
    route.durationSeconds === null ||
    route.trafficDelaySeconds === null
  ) {
    await openDispatchException(plan, "route_revalidation_failed", {
      routeReviewReason: route.reviewReason,
    });
    return {
      ok: false,
      requestId,
      outcome: "dispatch_exception",
      reason: "route_revalidation_failed",
    };
  }

  await rpc(
    "automaticFulfillment.recordRevalidation",
    "couranr_record_auto_revalidation",
    {
      p_service_plan_id: plan.id,
      p_loaded_miles: route.loadedMiles,
      p_route_duration_seconds: route.durationSeconds,
      p_traffic_delay_seconds: route.trafficDelaySeconds,
    }
  );

  // Revalidation is a fulfillment guard, never a repricing path.
  if (route.loadedMiles > 25 || route.trafficDelaySeconds > 25 * 60) {
    await openDispatchException(plan, "route_outside_auto_lane_at_dispatch", {
      loadedMiles: route.loadedMiles,
      trafficDelaySeconds: route.trafficDelaySeconds,
      approvedQuoteUntouched: true,
    });
    return {
      ok: false,
      requestId,
      outcome: "dispatch_exception",
      reason: "route_outside_auto_lane_at_dispatch",
    };
  }

  await clearRecoverableDispatchException(requestId);

  const reserved = await rpc<Record<string, any>>(
    "automaticFulfillment.reserveCandidate",
    "couranr_reserve_automatic_dispatch_candidate",
    { p_request_id: requestId, p_now: new Date().toISOString() }
  );
  if (!reserved.ok) {
    return { ok: false, requestId, outcome: "candidate_reservation_failed", reason: reserved.message };
  }

  if (reserved.value?.outcome !== "reserved") {
    return {
      ok: true,
      requestId,
      outcome: String(reserved.value?.outcome ?? "waiting"),
      reason: reserved.value?.reason ? String(reserved.value.reason) : undefined,
    };
  }

  const reservationId = String(reserved.value.reservationId);

  let deliveryId: string | null = null;
  if (plan.promotional_credit_id) {
    const created = await createDeliveryFromPromotionalCreditForAutomation({ requestId });
    if (isFulfillmentFailure(created)) {
      await releaseReservation(reservationId, "credit_delivery_conversion_failed");
      await openDispatchException(plan, "commercial_settlement_failed", {
        mode: "promotional_credit",
        code: created.code,
      });
      return {
        ok: false,
        requestId,
        outcome: "dispatch_exception",
        reason: "commercial_settlement_failed",
      };
    }
    deliveryId = String(created.value.delivery.id);
  } else {
    const captured = await capturePaymentForAutomation({ requestId });
    if (isFulfillmentFailure(captured)) {
      await releaseReservation(reservationId, "payment_capture_requires_reconciliation");
      await openDispatchException(plan, "payment_capture_requires_reconciliation", {
        code: captured.code,
        providerOutcomeUnknown: captured.code === "internal",
      });
      return {
        ok: false,
        requestId,
        outcome: "dispatch_exception",
        reason: "payment_capture_requires_reconciliation",
      };
    }
    deliveryId = captured.value.deliveryId ? String(captured.value.deliveryId) : null;
  }

  if (!deliveryId) {
    await releaseReservation(reservationId, "canonical_delivery_missing");
    await openDispatchException(plan, "canonical_delivery_missing", {});
    return {
      ok: false,
      requestId,
      outcome: "dispatch_exception",
      reason: "canonical_delivery_missing",
    };
  }

  const { data: delivery, error: deliveryError } = (await supabaseAdmin
    .from("couranr_deliveries")
    .select("id,version,fulfillment_state")
    .eq("id", deliveryId)
    .maybeSingle()) as { data: any; error: any };

  if (deliveryError || !delivery) {
    await releaseReservation(reservationId, "canonical_delivery_reload_failed");
    await openDispatchException(plan, "canonical_delivery_missing", {
      message: deliveryError?.message ?? null,
    });
    return {
      ok: false,
      requestId,
      outcome: "dispatch_exception",
      reason: "canonical_delivery_missing",
    };
  }

  if (delivery.fulfillment_state !== "scheduled") {
    // Another idempotent worker may have already assigned it.
    if (delivery.fulfillment_state === "assigned") {
      return { ok: true, requestId, outcome: "assigned", deliveryId };
    }
    await releaseReservation(reservationId, "delivery_not_scheduled");
    await openDispatchException(plan, "assignment_commit_failed", {
      fulfillmentState: delivery.fulfillment_state,
    }, deliveryId);
    return {
      ok: false,
      requestId,
      outcome: "dispatch_exception",
      reason: "assignment_commit_failed",
      deliveryId,
    };
  }

  const assigned = await rpc<Record<string, any>>(
    "automaticFulfillment.commitAssignment",
    "couranr_commit_automatic_assignment",
    {
      p_reservation_id: reservationId,
      p_delivery_id: deliveryId,
      p_expected_delivery_version: Number(delivery.version),
      p_idempotency_key: `auto-dispatch:${requestId}:${String(plan.id)}`,
    }
  );

  if (!assigned.ok) {
    await releaseReservation(reservationId, "assignment_commit_failed");
    await openDispatchException(plan, "assignment_commit_failed", {
      message: assigned.message,
    }, deliveryId);
    return {
      ok: false,
      requestId,
      outcome: "dispatch_exception",
      reason: "assignment_commit_failed",
      deliveryId,
    };
  }

  return {
    ok: true,
    requestId,
    outcome: "assigned",
    deliveryId,
    assignmentId: String(assigned.value.id),
  };
}

/**
 * Periodic safety net and timed dispatcher.
 *
 * Hooks advance requests immediately; this worker exists so a lost callback,
 * deploy restart, webhook delay or future scheduled time never strands work.
 */
export async function runAutomaticFulfillmentTick(
  limit = AUTO_DISPATCH_TICK_LIMIT
): Promise<{
  advanced: AutoResult[];
  dispatched: AutoResult[];
}> {
  const capped = Math.max(1, Math.min(Number(limit) || AUTO_DISPATCH_TICK_LIMIT, 100));

  const { data: requests, error: requestError } = (await supabaseAdmin
    .from("couranr_delivery_requests")
    .select("id")
    .in("request_state", ["pending_couranr_review", "confirmed"])
    .order("updated_at", { ascending: true })
    .limit(capped)) as { data: any[] | null; error: any };

  if (requestError) {
    recordFailure("automaticFulfillment.tick.requestScan", requestError.message);
  }

  const advanced: AutoResult[] = [];
  for (const row of requests ?? []) {
    advanced.push(await advanceAutomaticFulfillment(String(row.id)));
  }

  const now = new Date().toISOString();
  const { data: plans, error: planError } = (await supabaseAdmin
    .from("couranr_service_plans")
    .select(
      "id,request_id,promotional_credit_id,scheduled_pickup_start,scheduled_pickup_end," +
        "dispatch_not_before,dispatch_deadline,expected_service_end,planner_version,market_key"
    )
    .eq("plan_state", "confirmed")
    .eq("plan_source", "automatic")
    .lte("dispatch_not_before", now)
    .order("dispatch_not_before", { ascending: true })
    .limit(capped)) as { data: any[] | null; error: any };

  if (planError) {
    recordFailure("automaticFulfillment.tick.planScan", planError.message);
  }

  const dispatched: AutoResult[] = [];
  for (const plan of plans ?? []) {
    dispatched.push(await dispatchOne(plan));
  }

  return { advanced, dispatched };
}

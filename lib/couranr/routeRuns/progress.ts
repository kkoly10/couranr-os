import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import { logServerFailure, newCorrelationId, type PublicErrorCode } from "@/lib/couranr/errors";
import {
  isFulfillmentFailure, capturePaymentForRoute, reconcileRouteChildCapture,
} from "@/lib/couranr/fulfillment/commands";
import { readRouteDraft } from "./commands";
import {
  authorizeNextRouteChild, readRouteOperationalStatus, readRouteSettlement, releaseKnownRouteHolds,
} from "./settlement";
import type { RouteOperationalProgress, RouteProgress, RouteSettlementView } from "./types";

assertServerOnly("lib/couranr/routeRuns/progress.ts");

type Params = { businessAccountId: string; actorUserId: string; routeRunId: string };
type Failure = { ok: false; code: PublicErrorCode; correlationId: string; message?: string };
type Result = { ok: true; value: RouteProgress } | Failure;

function fail(operation: string, reason: unknown, message: string): Failure {
  const correlationId = newCorrelationId();
  logServerFailure({ operation, correlationId, code: "conflict", detail: reason });
  return { ok: false, code: "conflict", correlationId, message };
}
function present(settlement: RouteSettlementView, actionClientSecret?: string,
  execution?: RouteProgress["execution"]): RouteProgress {
  let next: RouteProgress["next"] = "continue";
  if (settlement.state === "authorized" && !settlement.pickupReadyConfirmed) next = "confirm_pickup_ready";
  else if (settlement.state === "authorization_required") next = "authenticate_card";
  else if (["authorization_unknown", "authorization_failed", "recovery_required", "cancelled"].includes(settlement.state))
    next = "operations_review";
  else if (settlement.state === "capture_pending" &&
      settlement.items.some((item) => item.paymentState === "capture_pending"))
    next = "operations_review";
  else if (settlement.state === "ready_for_execution") next = execution ? "ready" : "continue";
  return { settlement, next, ...(execution ? { execution } : {}),
    ...(actionClientSecret ? { actionClientSecret } : {}) };
}
export async function readRouteProgress(params: Params): Promise<Result | { ok: true; value: null }> {
  const read = await readRouteSettlement(params);
  if (read.ok === false) return read;
  if (!read.value) return { ok: true, value: null };
  if (read.value.state !== "ready_for_execution") {
    return { ok: true, value: present(read.value) };
  }
  const [execution, resource] = await Promise.all([
    supabaseAdmin.from("couranr_route_run_executions")
      .select("execution_state,current_sequence")
      .eq("route_run_id", params.routeRunId).maybeSingle(),
    supabaseAdmin.from("couranr_route_run_resource_reservations")
      .select("resource_state")
      .eq("settlement_id", read.value.settlementId).maybeSingle(),
  ]);
  if (execution.error || resource.error || !resource.data) return fail("readRouteProgress",
    execution.error?.message ?? resource.error?.message ?? "route_resource_missing",
    "Couranr could not confirm this Route's execution status.");
  if (!execution.data) return { ok: true, value: present(read.value) };
  const deliveryIds = read.value.items.map((item) => item.deliveryId);
  if (deliveryIds.some((id) => !id)) return fail("readRouteProgress", "route_child_delivery_missing",
    "Couranr could not confirm every Route delivery.");
  const { data: deliveries, error: deliveryError } = await supabaseAdmin
    .from("couranr_deliveries")
    .select("id,fulfillment_state")
    .eq("route_run_id", params.routeRunId)
    .in("id", deliveryIds as string[]);
  if (deliveryError || !deliveries || deliveries.length !== deliveryIds.length) {
    return fail("readRouteProgress", deliveryError?.message ?? "route_child_delivery_mismatch",
      "Couranr could not confirm every Route delivery.");
  }
  const byId = new Map(deliveries.map((delivery) => [delivery.id, delivery.fulfillment_state]));
  const stops: NonNullable<RouteProgress["execution"]>["stops"] = [];
  for (const item of read.value.items) {
    const fulfillmentState = byId.get(item.deliveryId!);
    if (!fulfillmentState) return fail("readRouteProgress", "route_child_delivery_mismatch",
      "Couranr could not confirm every Route delivery.");
    stops.push({ sequence: item.sequence, fulfillmentState });
  }
  return { ok: true, value: present(read.value, undefined, {
    state: execution.data.execution_state,
    currentSequence: execution.data.current_sequence,
    resourceState: resource.data.resource_state,
    stops,
  }) };
}

/** Read-only, billing-free progress for active Route members without billing.read. */
export async function readOperationalRouteProgress(params: Params): Promise<
  { ok: true; value: RouteOperationalProgress | null } | Failure
> {
  const read = await readRouteOperationalStatus(params);
  if (read.ok === false) return read;
  if (!read.value) return { ok: true, value: null };
  const value: RouteOperationalProgress = { kind: "operational", status: read.value };
  if (read.value !== "ready_for_execution") return { ok: true, value };
  const [execution, resource] = await Promise.all([
    supabaseAdmin.from("couranr_route_run_executions")
      .select("execution_state,current_sequence")
      .eq("route_run_id", params.routeRunId).maybeSingle(),
    supabaseAdmin.from("couranr_route_run_resource_reservations")
      .select("resource_state")
      .eq("route_run_id", params.routeRunId).maybeSingle(),
  ]);
  if (execution.error || resource.error) return fail("readOperationalRouteProgress",
    execution.error?.message ?? resource.error?.message,
    "Couranr could not confirm this Route's execution status.");
  if (execution.data && resource.data) value.execution = {
    state: execution.data.execution_state,
    currentSequence: execution.data.current_sequence,
    resourceState: resource.data.resource_state,
  };
  return { ok: true, value };
}

async function rpcStep(operation: string, fn: string, args: Record<string, unknown>): Promise<Failure | null> {
  try {
    const { error } = await supabaseAdmin.rpc(fn, args);
    if (!error) return null;
    return fail(operation, { fn, code: error.code, message: error.message },
      "This Route changed while checkout was progressing. Refresh its status before continuing.");
  } catch (error) {
    return fail(operation, { fn, error },
      "Couranr could not confirm this checkout step. Refresh its status before continuing.");
  }
}
const args = (p: Params) => ({
  p_business_account_id: p.businessAccountId,
  p_actor_user_id: p.actorUserId,
  p_route_run_id: p.routeRunId,
});
async function refreshed(params: Params): Promise<Result> {
  const read = await readRouteProgress(params);
  if (read.ok === false) return read;
  return read.value ? { ok: true, value: read.value } :
    fail("advanceRouteRun", "settlement_disappeared", "Couranr could not find this Route checkout.");
}

/**
 * Exactly one durable step per call. The browser supplies no child, amount,
 * method, vehicle, or provider state. Closing and reopening the tab resumes
 * from the server's current money truth; ambiguous capture never retries here.
 */
export async function advanceRouteRun(params: Params): Promise<Result> {
  const current = await readRouteSettlement(params);
  if (current.ok === false) return current;
  let settlement = current.value;
  if (!settlement) return fail("advanceRouteRun", "checkout_not_started",
    "Approve checkout before authorizing this Route.");

  if (["authorization_required", "authorized", "resource_reserved"].includes(settlement.state)) {
    const expiryError = await rpcStep("advanceRouteRun", "couranr_expire_route_run_checkout", {
      p_route_run_id: params.routeRunId,
    });
    if (expiryError) return expiryError;
    const rechecked = await readRouteSettlement(params);
    if (rechecked.ok === false) return rechecked;
    if (!rechecked.value) return fail("advanceRouteRun", "settlement_disappeared_after_expiry_check",
      "Couranr could not confirm this Route checkout.");
    settlement = rechecked.value;
  }

  if (["pending_authorization", "authorization_required", "authorization_unknown"].includes(settlement.state)) {
    const authorized = await authorizeNextRouteChild(params);
    if (authorized.ok === false) return authorized;
    if (authorized.value.settlement.state === "authorization_failed") {
      const released = await releaseKnownRouteHolds(params);
      if (released.ok === false) return released;
      return { ok: true, value: present(released.value) };
    }
    return { ok: true, value: present(authorized.value.settlement, authorized.value.actionClientSecret) };
  }
  if (settlement.state === "authorization_failed" || settlement.state === "recovery_required") {
    // Only the canonical release command may cancel a known provider hold.
    // Captured money remains in Operations refund/recovery authority.
    const released = await releaseKnownRouteHolds(params);
    if (released.ok === false) return released;
    return { ok: true, value: present(released.value) };
  }
  if (settlement.state === "authorized") {
    if (!settlement.pickupReadyConfirmed) return { ok: true, value: present(settlement) };
    const error = await rpcStep("advanceRouteRun", "couranr_reserve_route_run_resource", args(params));
    if (error) return error;
    const updated = await readRouteSettlement(params);
    if (updated.ok === false) return updated;
    if (updated.value?.state === "recovery_required") {
      const released = await releaseKnownRouteHolds(params);
      if (released.ok === false) return released;
      return { ok: true, value: present(released.value) };
    }
    return updated.value ? { ok: true, value: present(updated.value) } :
      fail("advanceRouteRun", "settlement_disappeared_after_reservation",
        "Couranr could not confirm this Route reservation.");
  }
  if (settlement.state === "resource_reserved") {
    const route = await readRouteDraft(params);
    if (route.ok === false) return route;
    if (route.value.state !== "accepted" || route.value.acceptedVersion === null) {
      return fail("advanceRouteRun", "accepted_route_changed", "This Route is no longer accepted.");
    }
    const planError = await rpcStep("advanceRouteRun", "couranr_confirm_route_service_plans", {
      ...args(params), p_expected_version: route.value.acceptedVersion,
    });
    if (planError) return planError;
    const captureError = await rpcStep("advanceRouteRun", "couranr_begin_route_run_capture", {
      ...args(params), p_expected_version: route.value.acceptedVersion,
    });
    if (captureError) return captureError;
    return refreshed(params);
  }
  if (settlement.state === "capture_pending") {
    const next = settlement.items.find((item) => item.paymentState !== "captured" || item.deliveryId === null);
    if (!next) {
      const error = await rpcStep("advanceRouteRun", "couranr_complete_route_run_funding", args(params));
      return error ?? refreshed(params);
    }
    if (next.paymentState === "capture_pending") {
      // Only the canonical provider READ may resolve an ambiguous capture.
      // A refresh or a second tab must never repeat paymentIntents.capture.
      const reconciled = await reconcileRouteChildCapture({ ...params,
        requestId: next.requestId, obligationId: next.obligationId,
      });
      if (isFulfillmentFailure(reconciled)) return reconciled;
      return refreshed(params);
    }
    if (!["authorized", "captured"].includes(next.paymentState)) {
      return fail("advanceRouteRun", "child_payment_not_capturable",
        "This Route needs Couranr Operations to reconcile a child payment.");
    }
    const captured = await capturePaymentForRoute({ ...params,
      requestId: next.requestId, obligationId: next.obligationId,
    });
    if (isFulfillmentFailure(captured)) return captured;
    return refreshed(params);
  }
  if (settlement.state === "ready_for_execution") {
    const error = await rpcStep("advanceRouteRun", "couranr_begin_route_execution", args(params));
    return error ?? refreshed(params);
  }
  return { ok: true, value: present(settlement) };
}

/** A separate explicit merchant attestation; checkout confirmation is not pickup readiness. */
export async function confirmRoutePickupReady(params: Params & {
  expectedVersion: number;
}): Promise<Result> {
  const read = await readRouteSettlement(params);
  if (read.ok === false) return read;
  if (!read.value || read.value.state !== "authorized") {
    return fail("confirmRoutePickupReady", "route_not_fully_authorized",
      "Every Route delivery must be authorized before pickup readiness can be confirmed.");
  }
  const error = await rpcStep("confirmRoutePickupReady", "couranr_confirm_route_pickup_ready", {
    ...args(params), p_expected_version: params.expectedVersion, p_acknowledged: true,
  });
  return error ?? refreshed(params);
}

/**
 * Bounded catch-up for a merchant who closes the tab after confirming
 * checkout. The 5-minute server cron invokes this; it selects only existing
 * merchant-approved settlements and never invents a Route or a payer action.
 * Each iteration goes through the same idempotent commands as the browser.
 */
export async function runRouteCheckoutMaintenance(): Promise<{
  considered: number; advanced: number; attention: number;
}> {
  const { data: rows, error } = await supabaseAdmin
    .rpc("couranr_claim_route_checkout_maintenance", { p_limit: 2 });
  if (error) {
    logServerFailure({ operation: "runRouteCheckoutMaintenance", correlationId: newCorrelationId(),
      code: "internal", detail: { stage: "select", error: error.message } });
    return { considered: 0, advanced: 0, attention: 1 };
  }
  let considered = 0;
  let advanced = 0;
  let attention = 0;
  for (const row of rows ?? []) {
    considered++;
    const { data: member, error: memberError } = await supabaseAdmin
      .from("business_members")
      .select("user_id")
      .eq("business_account_id", row.business_account_id)
      .eq("status", "active")
      .in("role", ["owner", "manager"])
      .limit(1)
      .maybeSingle();
    if (memberError || !member?.user_id) {
      attention++;
      logServerFailure({ operation: "runRouteCheckoutMaintenance", correlationId: newCorrelationId(),
        code: "conflict", detail: { routeRunId: row.route_run_id, stage: "active_owner" } });
      continue;
    }
    const params: Params = { routeRunId: row.route_run_id,
      businessAccountId: row.business_account_id, actorUserId: member.user_id };
    let previous = "";
    for (let stepNumber = 0; stepNumber < 4; stepNumber++) {
      let step: Result;
      try {
        step = await advanceRouteRun(params);
      } catch (error) {
        attention++;
        logServerFailure({ operation: "runRouteCheckoutMaintenance",
          correlationId: newCorrelationId(), code: "internal",
          detail: { routeRunId: row.route_run_id, stage: "advance", error } });
        break;
      }
      if (step.ok === false) { attention++; break; }
      const signature = JSON.stringify(step.value.settlement);
      if (signature !== previous) advanced++;
      if (step.value.next !== "continue" || signature === previous) break;
      previous = signature;
    }
  }
  return { considered, advanced, attention };
}

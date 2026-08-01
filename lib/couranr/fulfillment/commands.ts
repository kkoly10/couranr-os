import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import {
  classifyDatabaseError,
  logServerFailure,
  newCorrelationId,
  type PublicErrorCode,
} from "@/lib/couranr/errors";
import { canActOnDeliveryRequest, type RequestActor } from "@/lib/couranr/requests/permissions";
import { getStripeClient } from "@/lib/stripeClient";
import type { ReadinessState } from "@/lib/couranr/requests/states";

assertServerOnly("lib/couranr/fulfillment/commands.ts");

/**
 * Readiness, service planning, capture and canonical delivery conversion.
 *
 * Same contract as every other Couranr command layer: one `.rpc()` per
 * mutation into a service-role-only SQL function that does the state change
 * and its audit row in a single transaction, actor verified first, no
 * caller-supplied amount, no caller-supplied target state.
 */

export const RPC = {
  beginPreparation: "couranr_begin_delivery_preparation",
  markReady: "couranr_mark_delivery_ready",
  markNotReady: "couranr_mark_delivery_not_ready",
  markUnavailable: "couranr_mark_delivery_unavailable",
  confirmPlan: "couranr_confirm_service_plan",
  cancelPlan: "couranr_cancel_service_plan",
  beginCapture: "couranr_begin_payment_capture",
  completeCapture: "couranr_complete_payment_capture",
  failCapture: "couranr_fail_payment_capture",
  createDelivery: "couranr_create_delivery_from_capture",
} as const;

/** Which command produces which readiness state. No target is ever passed. */
const READINESS_RPC: Readonly<Record<ReadinessState, string | null>> = {
  preparing: RPC.beginPreparation,
  ready: RPC.markReady,
  not_ready: RPC.markNotReady,
  unavailable: RPC.markUnavailable,
  not_confirmed: null,
};

export type FulfillmentFailure = {
  ok: false;
  code: PublicErrorCode;
  correlationId: string;
  message?: string;
};
export type FulfillmentResult<T> = { ok: true; value: T } | FulfillmentFailure;

export function isFulfillmentFailure(r: { ok: boolean }): r is FulfillmentFailure {
  return r.ok === false;
}

function fail(p: {
  operation: string;
  code: PublicErrorCode;
  detail?: unknown;
  message?: string;
}): FulfillmentFailure {
  const correlationId = newCorrelationId();
  logServerFailure({ correlationId, operation: p.operation, code: p.code, detail: p.detail });
  const out: FulfillmentFailure = { ok: false, code: p.code, correlationId };
  if (p.message) out.message = p.message;
  return out;
}

async function callRpc<T = any>(
  operation: string,
  fn: string,
  args: Record<string, unknown>
): Promise<FulfillmentResult<T>> {
  const { data, error } = (await supabaseAdmin.rpc(fn, args)) as { data: any; error: any };
  if (error) {
    return fail({
      operation,
      code: classifyDatabaseError(error),
      detail: { fn, code: error.code, message: error.message },
    });
  }
  if (data === null || data === undefined) {
    return fail({ operation, code: "conflict", detail: { fn, reason: "no row returned" } });
  }
  return { ok: true, value: data as T };
}

/* ------------------------------------------------------- readiness ----- */

/**
 * Change merchant readiness.
 *
 * `to` selects the COMMAND, it is not passed to one — every SQL function
 * hard-codes its own destination, so there is no path by which a caller could
 * name a state. An unknown value never reaches the database.
 */
export async function setReadiness(params: {
  actor: RequestActor;
  requestId: string;
  businessAccountId: string;
  expectedVersion: number;
  to: ReadinessState;
}): Promise<FulfillmentResult<{ request: Record<string, any> }>> {
  const op = "setReadiness";

  const fn = READINESS_RPC[params.to];
  if (!fn) {
    return fail({
      operation: op,
      code: "invalid_input",
      detail: { to: params.to },
      message: "That is not a readiness Couranr can set.",
    });
  }

  const permission = canActOnDeliveryRequest(params.actor, "submit", params.businessAccountId);
  if (!permission.allowed) {
    return fail({
      operation: op,
      code: "not_permitted",
      detail: { reason: permission.reason },
      message: "You do not have access to this delivery.",
    });
  }
  if (params.actor.kind === "anonymous") {
    return fail({ operation: op, code: "unauthenticated", detail: { reason: "anonymous" } });
  }

  const r = await callRpc<Record<string, any>>(op, fn, {
    p_request_id: params.requestId,
    p_business_account_id: params.businessAccountId,
    p_expected_version: params.expectedVersion,
    p_actor_user_id: params.actor.userId,
  });
  if (isFulfillmentFailure(r)) return r;
  return { ok: true, value: { request: r.value } };
}

/* ---------------------------------------------------- service plan ----- */

export type VehicleRequirement = { vehicleClass: string; maxPayloadLb: number; notes?: string };

/**
 * Confirm the service plan. Operations only.
 *
 * The vehicle is a REQUIREMENT SNAPSHOT rather than a row in `vehicles`: that
 * table is the legacy auto-rental one, has no capacity field, and is a
 * quarantine target. Compatibility against the stored shipment is checked in
 * the database, not here.
 */
export async function confirmServicePlan(params: {
  actor: RequestActor;
  requestId: string;
  businessAccountId: string;
  expectedVersion: number;
  pickupStart: string;
  pickupEnd: string;
  timezone: string;
  vehicleId?: string | null;
  vehicleRequirement: VehicleRequirement;
}): Promise<FulfillmentResult<{ plan: Record<string, any> }>> {
  const op = "confirmServicePlan";

  const permission = canActOnDeliveryRequest(params.actor, "review", params.businessAccountId);
  if (!permission.allowed || params.actor.kind !== "operations") {
    return fail({
      operation: op,
      code: "not_permitted",
      detail: { reason: "not_operations" },
      message: "Only Couranr Operations can confirm a service plan.",
    });
  }

  const r = await callRpc<Record<string, any>>(op, RPC.confirmPlan, {
    p_request_id: params.requestId,
    p_expected_version: params.expectedVersion,
    p_actor_user_id: params.actor.userId,
    p_pickup_start: params.pickupStart,
    p_pickup_end: params.pickupEnd,
    p_timezone: params.timezone,
    p_vehicle_id: params.vehicleId ?? null,
    p_vehicle_requirement: params.vehicleRequirement,
  });
  if (isFulfillmentFailure(r)) return r;
  return { ok: true, value: { plan: r.value } };
}

/* --------------------------------------------------------- capture ----- */

export type CaptureOutcome = {
  outcome: string;
  obligationId: string | null;
  paymentState: string | null;
  deliveryId: string | null;
};

/**
 * Capture, as a recoverable external-effect workflow.
 *
 *   1. compare-and-set authorized -> capture_pending IN THE DATABASE, before
 *      Stripe is called
 *   2. call Stripe with an idempotency key derived from the obligation
 *   3. apply the verified result: capture_pending -> captured
 *   4. convert to a canonical delivery
 *
 * Step 1 first is the whole point. If this process dies at step 2 or 3, the
 * row says `capture_pending` — "a capture was started and the outcome is
 * unknown" — not `authorized`, which would invite a second capture of money
 * already taken. The webhook and `reconcileCapture` both converge on the same
 * terminal state, and Stripe's idempotency key means a retried call returns
 * the FIRST capture rather than performing a second.
 */
export async function capturePayment(params: {
  actor: RequestActor;
  requestId: string;
  businessAccountId: string;
}): Promise<FulfillmentResult<CaptureOutcome>> {
  const op = "capturePayment";

  const permission = canActOnDeliveryRequest(params.actor, "review", params.businessAccountId);
  if (!permission.allowed || params.actor.kind !== "operations") {
    return fail({
      operation: op,
      code: "not_permitted",
      detail: { reason: "not_operations" },
      message: "Only Couranr Operations can capture a payment.",
    });
  }

  const begun = await callRpc<Record<string, any>>(op, RPC.beginCapture, {
    p_request_id: params.requestId,
    p_actor_user_id: params.actor.userId,
  });
  if (isFulfillmentFailure(begun)) return begun;

  const ob = begun.value;
  if (ob.payment_state === "captured") {
    return convertAfterCapture(op, params.requestId, ob as any);
  }

  const intentId = String(ob.provider_payment_intent_id ?? "");
  if (!intentId) {
    return fail({
      operation: op,
      code: "conflict",
      detail: { reason: "no_payment_intent" },
      message: "This delivery has no payment to capture.",
    });
  }

  let intent: any;
  try {
    // No amount is passed: capturing the full authorized amount is the
    // default, so there is no number here to get wrong.
    intent = await getStripeClient().paymentIntents.capture(intentId, undefined, {
      idempotencyKey: `couranr:capture:${ob.id}`,
    });
  } catch (e: any) {
    /*
     * A DEFINITE provider refusal releases the hold back to authorized so it
     * can be retried. Anything else — a timeout, a socket error, an unknown
     * shape — leaves it in capture_pending on purpose: we do not know whether
     * Stripe took the money, and guessing "it failed" is how a captured
     * payment gets captured twice.
     */
    const definite = typeof e?.statusCode === "number" && e.statusCode >= 400 && e.statusCode < 500;
    if (definite) {
      await callRpc(op, RPC.failCapture, {
        p_obligation_id: ob.id,
        p_provider_event_id: `couranr:capture_failed:${ob.id}:${e?.code ?? "unknown"}`,
        p_reason: String(e?.code ?? e?.type ?? "provider_error"),
      });
      return fail({
        operation: op,
        code: "conflict",
        detail: { type: e?.type, code: e?.code, statusCode: e?.statusCode },
        message: "The payment could not be captured. Nothing was taken.",
      });
    }
    return fail({
      operation: op,
      code: "internal",
      detail: { type: e?.type, statusCode: e?.statusCode, message: e?.message },
      message:
        "Couranr could not confirm the capture with the payment provider. It will be resolved automatically — do not retry.",
    });
  }

  const completed = await callRpc<any>(op, RPC.completeCapture, {
    p_obligation_id: ob.id,
    p_provider_event_id: `couranr:capture_result:${ob.id}:${intent.id}`,
    p_payment_intent_id: intent.id,
    p_intent_status: String(intent.status ?? ""),
    p_amount_received: Number(intent.amount_received ?? intent.amount ?? 0),
    p_currency: String(intent.currency ?? ""),
  });
  if (isFulfillmentFailure(completed)) return completed;

  const applied = completed.value;
  if (applied.outcome !== "applied" && applied.payment_state !== "captured") {
    return fail({
      operation: op,
      code: "conflict",
      detail: { outcome: applied.outcome, reason: applied.rejected_reason },
      message: "The capture result did not match Couranr's record. Nothing was changed.",
    });
  }

  return convertAfterCapture(op, params.requestId, { id: ob.id, payment_state: "captured" });
}

/** Step 4. Idempotent: a second call returns the same delivery. */
async function convertAfterCapture(
  op: string,
  requestId: string,
  ob: { id: string; payment_state: string }
): Promise<FulfillmentResult<CaptureOutcome>> {
  const created = await callRpc<Record<string, any>>(op, RPC.createDelivery, {
    p_request_id: requestId,
  });
  if (isFulfillmentFailure(created)) return created;

  return {
    ok: true,
    value: {
      outcome: "captured",
      obligationId: ob.id,
      paymentState: "captured",
      deliveryId: String(created.value.id),
    },
  };
}

/**
 * Recovery. Re-reads the PaymentIntent and settles an obligation stuck in
 * `capture_pending` because a process died between Stripe and the database.
 *
 * Safe to call any number of times: completion is idempotent on its provider
 * event id, and conversion is idempotent on `request_id`.
 */
export async function reconcileCapture(params: {
  requestId: string;
  obligationId: string;
  paymentIntentId: string;
}): Promise<FulfillmentResult<CaptureOutcome>> {
  const op = "reconcileCapture";

  let intent: any;
  try {
    intent = await getStripeClient().paymentIntents.retrieve(params.paymentIntentId);
  } catch (e: any) {
    return fail({
      operation: op,
      code: "internal",
      detail: { type: e?.type, statusCode: e?.statusCode },
      message: "Could not reach the payment provider.",
    });
  }

  const completed = await callRpc<any>(op, RPC.completeCapture, {
    p_obligation_id: params.obligationId,
    p_provider_event_id: `couranr:capture_result:${params.obligationId}:${intent.id}`,
    p_payment_intent_id: intent.id,
    p_intent_status: String(intent.status ?? ""),
    p_amount_received: Number(intent.amount_received ?? intent.amount ?? 0),
    p_currency: String(intent.currency ?? ""),
  });
  if (isFulfillmentFailure(completed)) return completed;

  const applied = completed.value;
  if (applied.payment_state !== "captured" && applied.outcome !== "duplicate") {
    return {
      ok: true,
      value: {
        outcome: applied.outcome,
        obligationId: params.obligationId,
        paymentState: applied.payment_state,
        deliveryId: null,
      },
    };
  }

  return convertAfterCapture(op, params.requestId, {
    id: params.obligationId,
    payment_state: "captured",
  });
}

/* ----------------------------------------------------------- reads ----- */

const PLAN_COLUMNS =
  "id,request_id,business_account_id,payment_obligation_id,request_version," +
  "scheduled_pickup_start,scheduled_pickup_end,timezone,vehicle_id,vehicle_requirement," +
  "plan_state,confirmed_by,confirmed_at,version";

const DELIVERY_COLUMNS =
  "id,request_id,business_account_id,payment_obligation_id,service_plan_id," +
  "request_version,pricing_policy_version,captured_amount_cents,currency," +
  "pickup_address,dropoff_address,recipient,shipment,service_level," +
  "signature_required,proof_method,scheduled_pickup_start,scheduled_pickup_end," +
  "timezone,vehicle_id,vehicle_requirement,fulfillment_state,version,created_at";

export async function getServicePlan(params: {
  requestId: string;
}): Promise<FulfillmentResult<{ plan: Record<string, any> | null }>> {
  const { data, error } = (await supabaseAdmin
    .from("couranr_service_plans")
    .select(PLAN_COLUMNS)
    .eq("request_id", params.requestId)
    .eq("plan_state", "confirmed")
    .maybeSingle()) as { data: any; error: any };
  if (error) return fail({ operation: "getServicePlan", code: "internal", detail: error.message });
  return { ok: true, value: { plan: data ?? null } };
}

export async function getCanonicalDelivery(params: {
  requestId: string;
  businessAccountId: string | null;
}): Promise<FulfillmentResult<{ delivery: Record<string, any> | null }>> {
  let q = supabaseAdmin
    .from("couranr_deliveries")
    .select(DELIVERY_COLUMNS)
    .eq("request_id", params.requestId);
  if (params.businessAccountId !== null) {
    q = q.eq("business_account_id", params.businessAccountId);
  }
  const { data, error } = (await q.maybeSingle()) as { data: any; error: any };
  if (error) {
    return fail({ operation: "getCanonicalDelivery", code: "internal", detail: error.message });
  }
  return { ok: true, value: { delivery: data ?? null } };
}

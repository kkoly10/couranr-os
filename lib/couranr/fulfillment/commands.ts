import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import {
  classifyDatabaseError,
  logServerFailure,
  newCorrelationId,
  type PublicErrorCode,
} from "@/lib/couranr/errors";
import { canActOnDeliveryRequest, type RequestActor } from "@/lib/couranr/requests/permissions";
import { REQUEST_VIEW_COLUMNS } from "@/lib/couranr/requests/commands";
import { getStripeClient } from "@/lib/stripeClient";
import type { ReadinessState } from "@/lib/couranr/requests/states";
import {
  captureEventId,
  captureIdempotencyKey,
  isTerminalCaptureAction,
  mayWriteCaptureResult,
  reconcileActionForIntentStatus,
  REFUND_REASONS,
  type RefundReason,
} from "@/lib/couranr/payments/states";
import { getObligationForRequest, isPaymentFailure } from "@/lib/couranr/payments/commands";

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
  resolveTerminal: "couranr_resolve_terminal_capture_failure",
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
 * Change pickup readiness. Business merchants are the current actor, while a
 * future consumer server capability will reuse the same state machine.
 *
 * `to` selects the COMMAND, it is not passed to one — every SQL function
 * hard-codes its own destination, so there is no path by which a caller could
 * name a state. An unknown value never reaches the database.
 */
export async function setReadiness(params: {
  actor: RequestActor;
  requestId: string;
  businessAccountId: string | null;
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
  businessAccountId: string | null;
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
 *   2. call Stripe with an idempotency key scoped to this capture CYCLE
 *   3. apply the verified result — only for a `succeeded` intent
 *   4. convert to a canonical delivery
 *
 * Nothing in this function ever releases a hold. An error here is not evidence
 * about the money, so every failure leaves the obligation in `capture_pending`
 * and `reconcileCapture` — which re-reads the intent — is the only way out.
 *
 * Step 1 first is the whole point. If this process dies at step 2 or 3, the
 * row says `capture_pending` — "a capture was started and the outcome is
 * unknown" — not `authorized`, which would invite a second capture of money
 * already taken. The webhook goes THROUGH `reconcileCapture` for exactly this
 * state, so both routes out re-read the intent and converge on the same
 * terminal state, and Stripe's idempotency key means a retried call returns
 * the FIRST capture rather than performing a second.
 */
export async function capturePayment(params: {
  actor: RequestActor;
  requestId: string;
  businessAccountId: string | null;
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

  /*
   * Already converted. Hand back the same delivery instead of the database's
   * `delivery_already_exists` conflict.
   *
   * The conflict is the right answer for "capture this again"; it is the wrong
   * answer for the case that actually produces a second call — a capture that
   * succeeded and converted, whose HTTP response the operator never saw. That
   * operator is asking "did this finish?", and the honest answer is yes, here
   * it is, rather than an error on work that is complete.
   */
  const already = await getCanonicalDelivery({
    requestId: params.requestId,
    businessAccountId: params.businessAccountId,
  });
  if (!isFulfillmentFailure(already) && already.value.delivery) {
    return {
      ok: true,
      value: {
        outcome: "captured",
        obligationId: String(already.value.delivery.payment_obligation_id),
        paymentState: "captured",
        deliveryId: String(already.value.delivery.id),
      },
    };
  }

  /*
   * A capture is already in flight. Refuse, rather than call Stripe blind.
   *
   * `couranr_begin_payment_capture` deliberately RETURNS the existing row for
   * `capture_pending` instead of raising, so without this check a second
   * request — a stale tab, a second operator on the shared queue — walks
   * straight on to `paymentIntents.capture` for an obligation whose outcome is
   * unknown. The rule that "capture is withheld while the outcome is unknown"
   * was enforced only in the browser; a route is not defended by a hidden
   * button.
   */
  const inFlight = await getObligationForRequest({
    requestId: params.requestId,
    businessAccountId: params.businessAccountId,
  });
  if (!isPaymentFailure(inFlight) && inFlight.value.obligation?.payment_state === "capture_pending") {
    return fail({
      operation: op,
      code: "conflict",
      detail: { reason: "capture_already_in_flight" },
      message:
        "A capture for this delivery is already in progress. Do not capture again — check with the payment provider to resolve it.",
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
  /*
   * Lost the race to a concurrent caller between the check above and here.
   * The SQL handed back a row somebody else moved; do not call Stripe on it.
   */
  if (ob.payment_state !== "capture_pending") {
    return fail({
      operation: op,
      code: "conflict",
      detail: { reason: "unexpected_state_after_begin", state: ob.payment_state },
      message: "This payment is not in a state Couranr can capture.",
    });
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
      idempotencyKey: captureIdempotencyKey(String(ob.id), Number(ob.version)),
    });
  } catch (e: any) {
    /*
     * NO RELEASE FROM HERE. An error is not evidence about the money.
     *
     * This branch used to treat any 4xx as a definite refusal and release the
     * hold back to `authorized` with "Nothing was taken." Two very ordinary
     * 4xx responses mean the exact opposite:
     *
     *   409 idempotency_error         another request with this key is still
     *                                 in flight — and that one may be
     *                                 capturing the money right now
     *   400 payment_intent_unexpected_state   the intent is already captured
     *
     * Releasing on either one hands the operator a false "nothing was taken"
     * and re-arms the Capture button over money that has already moved.
     *
     * So every failure now leaves the obligation in `capture_pending` and the
     * only way out is `reconcileCapture`, which does not guess from an HTTP
     * status — it RE-READS the PaymentIntent and acts on what Stripe actually
     * says. That is also the precondition `couranr_fail_payment_capture`
     * documents for itself: "only ever called with a verified provider
     * failure".
     */
    return fail({
      operation: op,
      code: "internal",
      detail: { type: e?.type, code: e?.code, statusCode: e?.statusCode, message: e?.message },
      message:
        "Couranr could not confirm the capture with the payment provider. Do not capture again — check with the provider to resolve it.",
    });
  }

  /*
   * Only a SUCCEEDED intent may spend the result event id.
   *
   * `captureEventId.result` is keyed on (obligation, intent) and is therefore
   * legal exactly once. Under `automatic_payment_methods` a capture can resolve
   * as `processing` rather than `succeeded`, and writing a rejection for that
   * would burn the id — so the reconcile that runs once the intent finally
   * succeeds would be swallowed as a duplicate and the obligation stranded
   * with the money taken. `reconcileCapture` has always had this guard; this
   * call site did not, which is exactly the sibling-enforcement-point mistake
   * this codebase keeps making.
   */
  const status = String(intent.status ?? "");
  if (!mayWriteCaptureResult(status)) {
    return fail({
      operation: op,
      code: "internal",
      detail: { intentStatus: status, intentId: String(intent.id ?? "") },
      message:
        "The payment provider has not finished this capture. Do not capture again — check with the provider to resolve it.",
    });
  }

  const completed = await callRpc<any>(op, RPC.completeCapture, {
    p_obligation_id: ob.id,
    p_provider_event_id: captureEventId.result(String(ob.id), String(intent.id)),
    p_payment_intent_id: intent.id,
    p_intent_status: status,
    p_amount_received: Number(intent.amount_received ?? intent.amount ?? 0),
    p_currency: String(intent.currency ?? ""),
  });
  if (isFulfillmentFailure(completed)) return completed;

  const applied = completed.value;
  // Only `captured` may convert. A `duplicate` carries the state read at
  // function entry, which is `capture_pending` in the stranded case.
  if (applied.payment_state !== "captured") {
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
 * Recovery — the ONLY way out of `capture_pending`.
 *
 * `capture_pending` means "a capture was started and Couranr does not know
 * whether the money moved". Nothing in the request lifecycle can advance from
 * there, and by design the Capture button is withheld: retrying blind is how a
 * captured payment gets captured twice. So there has to be an action that
 * ASKS the provider what actually happened, and this is it.
 *
 * Two outcomes, and the difference matters:
 *
 *   - the intent is `succeeded` — Stripe took the money. Complete the capture
 *     and convert to a canonical delivery.
 *   - the intent is still capturable — Stripe never took it, the funds are
 *     still only held. Release back to `authorized` so a capture can be
 *     retried safely. This is a VERIFIED failure, read from the provider, not
 *     an assumption from a timeout — which is exactly the precondition
 *     `couranr_fail_payment_capture` documents.
 *
 * Anything else (`processing`, an unexpected status) is left alone: an unknown
 * answer is not a reason to move money's state in either direction.
 *
 * Safe to call any number of times: completion is idempotent on its provider
 * event id, release is idempotent on its own, and conversion is idempotent on
 * `request_id`.
 */
export async function reconcileCapture(params: {
  actor?: RequestActor;
  requestId: string;
  businessAccountId?: string | null;
  obligationId: string;
  /** The obligation's version, i.e. WHICH capture cycle is being settled. */
  obligationVersion: number;
  paymentIntentId: string;
}): Promise<FulfillmentResult<CaptureOutcome>> {
  const op = "reconcileCapture";

  // Optional so the webhook and any future job can call this with no actor.
  // A route ALWAYS passes one.
  if (params.actor && params.actor.kind !== "operations") {
    return fail({
      operation: op,
      code: "not_permitted",
      detail: { reason: "not_operations" },
      message: "Only Couranr Operations can reconcile a payment.",
    });
  }

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

  return applyVerifiedCaptureOutcome({
    requestId: params.requestId,
    obligationId: params.obligationId,
    obligationVersion: params.obligationVersion,
    intent,
  });
}

/**
 * THE ONE PLACE the closed capture mapping is applied.
 *
 * Two copies of a five-way money mapping is two chances to disagree about what
 * `canceled` means, and the disagreement would only ever show up as a stuck
 * row. So both enforcement points — the Operations reconcile route and the
 * canonical Stripe webhook, when it finds an obligation already in
 * `capture_pending` — reach it through `reconcileCapture` above.
 *
 * Through `reconcileCapture`, and only through it, because the intent this
 * takes must be one Couranr RETRIEVED. A signature-verified webhook proves the
 * event is Stripe's; it does not prove the event is current, and Stripe does
 * not guarantee delivery order. The webhook used to hand its own
 * `event.data.object` straight in here — a late `amount_capturable_updated`
 * then released the hold and re-armed Capture mid-capture.
 *
 * It never supplies a target state.
 */
export async function applyVerifiedCaptureOutcome(params: {
  requestId: string;
  obligationId: string;
  obligationVersion: number;
  intent: any;
}): Promise<FulfillmentResult<CaptureOutcome>> {
  const op = "applyVerifiedCaptureOutcome";
  const intent = params.intent;
  const status = String(intent?.status ?? "");
  const action = reconcileActionForIntentStatus(status);

  /*
   * TERMINAL. The provider has settled it: either the authorization is gone
   * and the payer must start again, or the intent is dead and the obligation
   * cannot be reused. One SQL command owns both, does the side effects in the
   * same transaction, and refuses any status that is not one of these two.
   */
  if (isTerminalCaptureAction(action)) {
    const failureCode =
      String(intent?.last_payment_error?.code ?? intent?.cancellation_reason ?? "") || null;
    const resolved = await callRpc<any>(op, RPC.resolveTerminal, {
      p_obligation_id: params.obligationId,
      p_provider_event_id: captureEventId.terminal(
        params.obligationId,
        params.obligationVersion,
        action
      ),
      p_payment_intent_id: String(intent.id ?? ""),
      p_intent_status: status,
      p_amount: Number(intent.amount ?? 0),
      p_currency: String(intent.currency ?? ""),
      p_failure_code: failureCode,
    });
    if (isFulfillmentFailure(resolved)) return resolved;

    return {
      ok: true,
      value: {
        outcome: resolved.value.outcome === "applied" ? action : resolved.value.outcome,
        obligationId: params.obligationId,
        paymentState: resolved.value.payment_state ?? null,
        deliveryId: null,
      },
    };
  }

  /*
   * Stripe still holds the funds without having taken them, so the capture
   * definitively did not happen. Release the obligation so it can be retried.
   */
  if (action === "release") {
    const released = await callRpc<Record<string, any>>(op, RPC.failCapture, {
      p_obligation_id: params.obligationId,
      /*
       * Per capture CYCLE, not per intent. The intent id is the same on every
       * retry, so keying on it would let the first release poison every later
       * one: `couranr_fail_payment_capture` swallows a duplicate event and
       * returns without releasing, which would strand a second failed cycle in
       * capture_pending permanently. The obligation version identifies the
       * cycle, because beginning a capture bumps it.
       */
      p_provider_event_id: captureEventId.notTaken(params.obligationId, params.obligationVersion),
      p_reason: "provider_reports_funds_still_only_authorized",
    });
    if (isFulfillmentFailure(released)) return released;
    return {
      ok: true,
      value: {
        outcome: "released",
        obligationId: params.obligationId,
        paymentState: String(released.value.payment_state ?? "authorized"),
        deliveryId: null,
      },
    };
  }

  /*
   * Neither taken nor merely held — `processing`, or something this build has
   * no semantics for. Report it and write NOTHING.
   *
   * Writing here would be worse than useless. `couranr_complete_payment_capture`
   * keys its event on (obligation, intent), so recording a rejection now would
   * make the SAME pair a `unique_violation` later — and the reconcile that ran
   * after the intent finally succeeded would be swallowed as a duplicate and
   * never apply. One premature write would permanently strand the obligation.
   */
  if (action !== "complete") {
    return {
      ok: true,
      value: {
        outcome: `provider_status_${status || "unknown"}`,
        obligationId: params.obligationId,
        paymentState: null,
        deliveryId: null,
      },
    };
  }

  const completed = await callRpc<any>(op, RPC.completeCapture, {
    p_obligation_id: params.obligationId,
    p_provider_event_id: captureEventId.result(params.obligationId, String(intent.id)),
    p_payment_intent_id: intent.id,
    p_intent_status: status,
    p_amount_received: Number(intent.amount_received ?? intent.amount ?? 0),
    p_currency: String(intent.currency ?? ""),
  });
  if (isFulfillmentFailure(completed)) return completed;

  /*
   * ONLY `captured` converts.
   *
   * `duplicate` used to be accepted here as if it meant "already captured".
   * It does not: `couranr_complete_payment_capture` returns the payment state
   * it read at ENTRY, so a duplicate on a stranded obligation reports
   * `capture_pending` — and `couranr_create_delivery_from_capture` then raises
   * CR409 `payment_not_captured`, turning a recoverable state into a 409 the
   * operator can do nothing with. The capture path's equivalent check requires
   * `captured` and therefore fails safe; this copy had lost that property.
   */
  const applied = completed.value;
  if (applied.payment_state !== "captured") {
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
  "id,request_id,business_account_id,payment_obligation_id,request_version,quote_version_id," +
  "scheduled_pickup_start,scheduled_pickup_end,timezone,vehicle_id,vehicle_requirement," +
  "plan_state,confirmed_by,confirmed_at,version";

const DELIVERY_COLUMNS =
  "id,request_id,business_account_id,payment_obligation_id,service_plan_id," +
  "request_version,quote_version_id,pricing_policy_version,captured_amount_cents,currency," +
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

/**
 * OPS-002. Every request Operations still has work on, with the payment,
 * plan and delivery each one's stage is derived from.
 *
 * Four bounded queries rather than one per row: the queue used to be a single
 * `select` because a request in `pending_couranr_review` has nothing attached
 * to it, but a lifecycle queue that only knew the request row could not tell
 * "ready for planning" from "capture pending" — and those two differ by
 * whether an operator should touch the row at all.
 *
 * Operations-only, and it says so at the top: this is the one read in the
 * codebase that deliberately crosses every business account.
 */
export type LifecycleQueueEntry = {
  /** The live assignment for this entry's delivery, when there is one. */
  assignment?: Record<string, any> | null;
  request: Record<string, any>;
  payment: Record<string, any> | null;
  servicePlan: Record<string, any> | null;
  delivery: Record<string, any> | null;
};

export async function listOperationsLifecycle(params: {
  actor: RequestActor;
  limit?: number;
}): Promise<FulfillmentResult<{ entries: LifecycleQueueEntry[]; total: number }>> {
  const op = "listOperationsLifecycle";
  if (params.actor.kind !== "operations") {
    return fail({
      operation: op,
      code: "not_permitted",
      detail: { reason: "not_operations" },
      message: "Only Couranr Operations can open the queue.",
    });
  }

  const limit = Math.min(Math.max(params.limit ?? 200, 1), 200);

  /*
   * SCHEDULED WORK IS EXCLUDED FROM THE OLDEST-FIRST WINDOW.
   *
   * A captured, scheduled request stays in `confirmed` forever — no state
   * change ever removes it — so with a single oldest-first query the window
   * fills with finished work and new review work is starved out of Operations
   * entirely. The queue would look healthy while nobody could see the newest
   * submission.
   *
   * So completed rows are fetched separately, newest-first and capped, and are
   * excluded from the work window by id.
   *
   * KNOWN LIMIT: the exclusion list is every canonical delivery, which grows
   * without bound. It is tiny today and this keeps the query in one round trip;
   * the durable fix is a database-side filter, which needs a reviewed
   * migration. `truncated` reports the shortfall rather than hiding it.
   */
  const DONE_WINDOW = 25;
  const { data: doneRows, error: doneErr } = (await supabaseAdmin
    .from("couranr_deliveries")
    .select("request_id,created_at")
    .order("created_at", { ascending: false })) as { data: any[]; error: any };

  if (doneErr) {
    return fail({
      operation: op,
      code: "internal",
      detail: doneErr.message,
      message: "The Couranr Operations Queue could not be loaded.",
    });
  }

  const doneIds = (doneRows ?? []).map((d) => String(d.request_id));
  const recentDoneIds = doneIds.slice(0, DONE_WINDOW);

  let workQuery = supabaseAdmin
    .from("couranr_delivery_requests")
    // The same allow-list the detail view is fed, so both screens render one
    // request from identical inputs.
    .select(REQUEST_VIEW_COLUMNS, { count: "exact" })
    // Nothing pre-submission and nothing terminal: a queue is work to be done.
    .in("request_state", [
      "pending_couranr_review",
      "confirmed",
      "awaiting_quote_acceptance",
      "quote_revision_required",
    ]);
  if (doneIds.length > 0) {
    workQuery = workQuery.not("id", "in", `(${doneIds.join(",")})`);
  }

  const {
    data: requests,
    error,
    count,
  } = (await workQuery
    /*
     * Oldest first, which is how a work queue is worked. `created_at` breaks
     * the tie so the page is stable rather than reordering between refreshes
     * on rows submitted in the same instant.
     */
    .order("submitted_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(limit)) as { data: any[]; error: any; count: number | null };

  if (error) {
    return fail({
      operation: op,
      code: "internal",
      detail: error.message,
      message: "The Couranr Operations Queue could not be loaded.",
    });
  }

  /*
   * The most recently scheduled work, folded back in so Operations can still
   * see what it just completed — capped, and newest-first, so it can never
   * crowd out the work window again.
   */
  let doneRequests: any[] = [];
  if (recentDoneIds.length > 0) {
    const { data, error: recentErr } = (await supabaseAdmin
      .from("couranr_delivery_requests")
      .select(REQUEST_VIEW_COLUMNS)
      .in("id", recentDoneIds)) as { data: any[]; error: any };
    if (recentErr) {
      return fail({
        operation: op,
        code: "internal",
        detail: recentErr.message,
        message: "The Couranr Operations Queue could not be loaded.",
      });
    }
    // Preserve the newest-first order the delivery query established.
    const rank = new Map(recentDoneIds.map((id, i) => [id, i]));
    doneRequests = (data ?? []).sort(
      (a, b) => (rank.get(String(a.id)) ?? 0) - (rank.get(String(b.id)) ?? 0)
    );
  }

  const workRows = requests ?? [];
  const rows = [...workRows, ...doneRequests];
  /*
   * `total` counts the WORK window only — the number the "showing the N oldest
   * of M" notice is about. Folding completed rows into it would understate how
   * much unworked queue is hidden.
   */
  const total = typeof count === "number" ? count : workRows.length;
  if (rows.length === 0) return { ok: true, value: { entries: [], total } };

  const ids = rows.map((r) => String(r.id));

  /*
   * Chunked, because `.in()` becomes a query STRING.
   *
   * PostgREST renders this as `request_id=in.(uuid,uuid,…)` in the request
   * line, and 200 UUIDs is roughly 7.4 KB of URL — close enough to the proxy's
   * header-buffer limit that a full queue would start returning errors while a
   * small one worked, which is the worst possible failure curve. 50 per batch
   * keeps every request comfortably small.
   */
  const CHUNK = 50;
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));

  async function joinAll(
    table: string,
    columns: string,
    narrow: (q: any) => any
  ): Promise<{ rows: any[]; error: any }> {
    const results = await Promise.all(
      chunks.map((batch) =>
        narrow(supabaseAdmin.from(table).select(columns).in("request_id", batch))
      )
    );
    const bad = results.find((r: any) => r.error);
    if (bad) return { rows: [], error: (bad as any).error };
    return { rows: results.flatMap((r: any) => r.data ?? []), error: null };
  }

  const [obs, plans, deliveries] = await Promise.all([
    joinAll(
      "couranr_payment_obligations",
      "id,request_id,payment_state,payer_type,amount_cents,currency",
      (q) => q.neq("payment_state", "cancelled")
    ),
    joinAll(
      "couranr_service_plans",
      "id,request_id,plan_state,scheduled_pickup_start,scheduled_pickup_end,timezone,vehicle_requirement",
      (q) => q.eq("plan_state", "confirmed")
    ),
    joinAll(
      "couranr_deliveries",
      "id,request_id,fulfillment_state,captured_amount_cents,scheduled_pickup_start,scheduled_pickup_end,timezone",
      (q) => q
    ),
  ]);

  for (const r of [obs, plans, deliveries]) {
    if (r.error) {
      return fail({
        operation: op,
        code: "internal",
        detail: r.error.message,
        message: "The Couranr Operations Queue could not be loaded.",
      });
    }
  }

  const byRequest = (list: any[]) => {
    const m = new Map<string, any>();
    for (const row of list) m.set(String(row.request_id), row);
    return m;
  };
  const obMap = byRequest(obs.rows);
  const planMap = byRequest(plans.rows);
  const deliveryMap = byRequest(deliveries.rows);

  /*
   * Active assignments for the deliveries in this page, keyed by delivery id.
   *
   * Chunked on DELIVERY id rather than request id — the assignment table has no
   * request_id, and adding one would be a second copy of a fact the delivery
   * already holds. Only deliveries that exist are looked up, so an empty queue
   * costs nothing.
   */
  const deliveryIds = deliveries.rows.map((d: any) => String(d.id));
  const assignmentByDelivery = new Map<string, any>();
  if (deliveryIds.length > 0) {
    const dChunks: string[][] = [];
    for (let i = 0; i < deliveryIds.length; i += CHUNK) dChunks.push(deliveryIds.slice(i, i + CHUNK));
    const results = await Promise.all(
      dChunks.map((batch) =>
        supabaseAdmin
          .from("couranr_delivery_assignments")
          .select("id,delivery_id,driver_id,vehicle_id,assignment_state,assigned_at,version")
          .eq("assignment_state", "active")
          .in("delivery_id", batch)
      )
    );
    const bad = results.find((r: any) => r.error);
    if (bad) {
      return fail({
        operation: op,
        code: "internal",
        detail: (bad as any).error.message,
        message: "The Couranr Operations Queue could not be loaded.",
      });
    }
    for (const row of results.flatMap((r: any) => r.data ?? [])) {
      assignmentByDelivery.set(String(row.delivery_id), row);
    }
  }

  return {
    ok: true,
    value: {
      entries: rows.map((request) => {
        const delivery = deliveryMap.get(String(request.id)) ?? null;
        return {
          request,
          payment: obMap.get(String(request.id)) ?? null,
          servicePlan: planMap.get(String(request.id)) ?? null,
          delivery,
          assignment: delivery ? assignmentByDelivery.get(String(delivery.id)) ?? null : null,
        };
      }),
      total,
    },
  };
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

/* ------------------------------------------------- release a hold ------ */

/**
 * Release an authorized hold back to the payer — ACP-032, CAN-001 `release`.
 *
 * Lives HERE, not in `lib/couranr/payments/`, and that is not a filing
 * preference. `tests/couranr-payments.test.ts:51` forbids `.cancel(` anywhere
 * in the payment modules, because that slice's strongest guarantee is about
 * what is ABSENT: no capture wrapper, no refund wrapper, so no route can reach
 * one by accident. Capture already lives in this module for the same reason,
 * and a release belongs beside it.
 *
 * THE ORDER IS THE DESIGN. `begin` gates and guards but does NOT move
 * payment_state; Stripe is called; `complete` records the outcome. Writing
 * `cancelled` first and then failing the Stripe call would leave the row
 * asserting released funds that are still held, with nothing to correct it —
 * no webhook fires for a cancel that never happened. Failing this way round
 * leaves the obligation truthfully `authorized`, and a real cancellation is
 * still picked up by the existing `payment_intent.canceled` webhook.
 */
export async function releaseAuthorization(params: {
  actor: RequestActor;
  requestId: string;
  businessAccountId: string | null;
  reason: string;
}): Promise<FulfillmentResult<{ obligationId: string; paymentState: string }>> {
  const op = "releaseAuthorization";

  const permission = canActOnDeliveryRequest(params.actor, "review", params.businessAccountId);
  if (!permission.allowed || params.actor.kind !== "operations") {
    return fail({
      operation: op,
      code: "not_permitted",
      detail: { reason: "not_operations" },
      message: "Only Couranr Operations can release a payment hold.",
    });
  }
  if (!params.reason || !params.reason.trim()) {
    return fail({
      operation: op,
      code: "invalid_input",
      detail: { reason: "no_reason" },
      message: "Say why this hold is being released.",
    });
  }

  /*
   * Read the obligation DIRECTLY rather than through getObligationForRequest.
   *
   * That helper filters `.neq("payment_state", "cancelled")`, which is right
   * for the authorization flow it serves and wrong here: after a successful
   * release the obligation IS cancelled, so a replay would find nothing and be
   * told "there is no payment on this delivery" instead of "already released".
   * The whole point of the replay path is that a retrying operator is told what
   * happened.
   *
   * Scoped to the request's nullable tenancy identity as well as request_id,
   * so a business request cannot reach another tenant's obligation and a
   * consumer request is matched with SQL NULL semantics rather than `"null"`.
   */
  let obligationQuery = supabaseAdmin
    .from("couranr_payment_obligations")
    .select("id,request_id,business_account_id,payment_state,provider_payment_intent_id,version")
    .eq("request_id", params.requestId);
  obligationQuery = params.businessAccountId === null
    ? obligationQuery.is("business_account_id", null)
    : obligationQuery.eq("business_account_id", params.businessAccountId);
  const { data: ob, error: obError } = (await obligationQuery.maybeSingle()) as {
    data: any;
    error: any;
  };

  if (obError) {
    return fail({ operation: op, code: "internal", detail: { reason: "obligation_read", message: obError.message } });
  }
  if (!ob) {
    return fail({
      operation: op,
      code: "not_found",
      detail: { reason: "no_obligation" },
      message: "There is no payment on this delivery.",
    });
  }

  if (ob.payment_state === "cancelled") {
    return { ok: true, value: { obligationId: String(ob.id), paymentState: "cancelled" } };
  }

  const begun = await callRpc<any>(op, "couranr_begin_payment_release", {
    p_obligation_id: String(ob.id),
    p_actor_user_id: params.actor.userId,
    p_expected_version: Number(ob.version),
    p_reason: params.reason.trim(),
  });
  if (!begun.ok) return begun;
  // Already released by an earlier attempt or by the webhook. Hand back the
  // settled state rather than calling Stripe again.
  if (begun.value?.outcome === "ignored") {
    return { ok: true, value: { obligationId: String(ob.id), paymentState: "cancelled" } };
  }

  const intentId = String(ob.provider_payment_intent_id ?? "");
  let intent: any;
  try {
    intent = await getStripeClient().paymentIntents.cancel(intentId);
  } catch (e: any) {
    /*
     * AN ERROR IS NOT EVIDENCE ABOUT THE MONEY — the same rule capture follows.
     * `payment_intent_unexpected_state` means the intent is not where we
     * thought, which covers BOTH "already cancelled" (release succeeded
     * earlier) and "already succeeded" (money is gone; this is a refund, not a
     * release). Guessing between them is exactly the mistake capture's own
     * comment records. So ask Stripe what the intent actually says and let
     * `complete` decide — it refuses any status that is not `canceled`.
     */
    try {
      intent = await getStripeClient().paymentIntents.retrieve(intentId);
    } catch {
      return fail({
        operation: op,
        // Same code capture uses for a provider failure. `PublicErrorCode`
        // has no upstream/unavailable member and inventing one would widen a
        // closed vocabulary that routes map to HTTP.
        code: "internal",
        detail: { reason: "cancel_failed", type: e?.type, stripeCode: e?.code ?? null },
        message: "The hold could not be released. Nothing was changed; try again.",
      });
    }
  }

  const done = await callRpc<any>(op, "couranr_complete_payment_release", {
    p_obligation_id: String(ob.id),
    p_payment_intent_id: intentId,
    p_intent_status: String(intent?.status ?? ""),
  });
  if (!done.ok) return done;

  /*
   * A `rejected` outcome is NOT a success, and reporting it as one is the worst
   * answer available here.
   *
   * `complete` returns `rejected` when the intent id does not match the
   * obligation, or when the obligation is no longer `authorized` — and by the
   * time it says so, STRIPE HAS ALREADY BEEN CANCELLED. Returning 200 would tell
   * the operator the hold was released while the row still says `authorized`
   * and nothing was recorded: the two systems disagree and the one person who
   * could reconcile them has been told there is nothing to look at.
   *
   * `ignored` IS a success — it means the release was already recorded, by an
   * earlier attempt or by the webhook.
   */
  const outcome = String(done.value?.outcome ?? "");
  if (outcome === "rejected") {
    return fail({
      operation: op,
      code: "conflict",
      detail: { reason: "complete_rejected", rejected: done.value?.rejected_reason ?? null },
      message:
        "The hold was cancelled at the payment provider but Couranr could not record it. " +
        "Do not retry — send this to Couranr Support to reconcile.",
    });
  }

  return {
    ok: true,
    value: {
      obligationId: String(ob.id),
      paymentState: String(done.value?.payment_state ?? ""),
    },
  };
}

/* --------------------------------------------------------- refunds ------ */

type RefundAttemptRow = {
  id: string;
  obligation_id: string;
  request_id: string;
  provider_payment_intent_id: string;
  provider_refund_id: string | null;
  amount_cents: number;
  retained_cents: number;
  reason: string;
  refund_key: string;
  attempt_state: "requested" | "pending_unknown" | "succeeded" | "failed";
};

export type RefundOutcome = {
  refundId: string;
  attemptState: RefundAttemptRow["attempt_state"];
  amountCents: number;
  retainedCents: number;
  reason: string;
};

/**
 * Read the request's obligation with the SAME nullable-tenancy discipline
 * releaseAuthorization uses: a consumer request (business null) matches with
 * SQL NULL semantics, and a business request can never reach another
 * tenant's obligation.
 */
async function readObligationForRecovery(
  op: string,
  requestId: string,
  businessAccountId: string | null
): Promise<FulfillmentResult<any>> {
  let q = supabaseAdmin
    .from("couranr_payment_obligations")
    .select(
      "id,request_id,business_account_id,payment_state,provider_payment_intent_id,version,captured_amount_cents,refunded_amount_cents"
    )
    .eq("request_id", requestId);
  q = businessAccountId === null ? q.is("business_account_id", null) : q.eq("business_account_id", businessAccountId);
  const { data: ob, error } = (await q.maybeSingle()) as { data: any; error: any };
  if (error) {
    return fail({ operation: op, code: "internal", detail: { reason: "obligation_read", message: error.message } });
  }
  if (!ob) {
    return fail({
      operation: op,
      code: "not_found",
      detail: { reason: "no_obligation" },
      message: "There is no payment on this delivery.",
    });
  }
  return { ok: true, value: ob };
}

/**
 * Refund captured money under a GOVERNED reason (batch 3 §B).
 *
 * Same discipline as capture and release:
 *   1. `couranr_begin_payment_refund` persists the attempt — obligation,
 *      provider intent identity, server-derived amount, governed retention,
 *      idempotency key, actor — BEFORE Stripe is called. Nobody types an
 *      amount anywhere: the SQL derives it from the captured amount and the
 *      owner-approved cancellation retention.
 *   2. `stripe.refunds.create` under the attempt's own idempotency key, so a
 *      resumed attempt converges on the SAME provider refund.
 *   3. `couranr_complete_payment_refund` records what the provider actually
 *      said. An error or timeout is NOT evidence about the money: the attempt
 *      parks at `pending_unknown` and `reconcileRefund` — never a retry loop —
 *      converges it later.
 */
export async function refundPayment(params: {
  actor: RequestActor;
  requestId: string;
  businessAccountId: string | null;
  reason: RefundReason;
}): Promise<FulfillmentResult<RefundOutcome>> {
  const op = "refundPayment";

  const permission = canActOnDeliveryRequest(params.actor, "review", params.businessAccountId);
  if (!permission.allowed || params.actor.kind !== "operations") {
    return fail({
      operation: op,
      code: "not_permitted",
      detail: { reason: "not_operations" },
      message: "Only Couranr Operations can refund a payment.",
    });
  }
  if (!REFUND_REASONS.includes(params.reason)) {
    return fail({
      operation: op,
      code: "invalid_input",
      detail: { reason: "refund_reason_invalid" },
      message: "That is not a governed refund reason.",
    });
  }

  const obRead = await readObligationForRecovery(op, params.requestId, params.businessAccountId);
  if (isFulfillmentFailure(obRead)) return obRead;
  const ob = obRead.value;

  const begun = await callRpc<RefundAttemptRow>(op, "couranr_begin_payment_refund", {
    p_obligation_id: String(ob.id),
    p_actor_user_id: params.actor.userId,
    p_expected_version: Number(ob.version),
    p_reason: params.reason,
  });
  if (isFulfillmentFailure(begun)) return begun;
  const attempt = begun.value;
  if (attempt.attempt_state === "succeeded") {
    // Idempotent replay: the money already moved exactly once.
    return {
      ok: true,
      value: {
        refundId: attempt.id,
        attemptState: attempt.attempt_state,
        amountCents: attempt.amount_cents,
        retainedCents: attempt.retained_cents,
        reason: attempt.reason,
      },
    };
  }

  return submitAndCompleteRefund(op, attempt);
}

/**
 * Converge an attempt whose provider outcome is unknown (`requested` after a
 * crash, or `pending_unknown` after a timeout). Re-submits under the SAME
 * provider idempotency key, so Stripe returns the ORIGINAL refund if one was
 * created and creates it exactly once if not — a duplicate provider refund is
 * structurally impossible on this path.
 */
export async function reconcileRefund(params: {
  actor: RequestActor;
  requestId: string;
  businessAccountId: string | null;
}): Promise<FulfillmentResult<RefundOutcome>> {
  const op = "reconcileRefund";

  const permission = canActOnDeliveryRequest(params.actor, "review", params.businessAccountId);
  if (!permission.allowed || params.actor.kind !== "operations") {
    return fail({
      operation: op,
      code: "not_permitted",
      detail: { reason: "not_operations" },
      message: "Only Couranr Operations can reconcile a refund.",
    });
  }

  const obRead = await readObligationForRecovery(op, params.requestId, params.businessAccountId);
  if (isFulfillmentFailure(obRead)) return obRead;
  const ob = obRead.value;

  const { data: attempt, error } = (await supabaseAdmin
    .from("couranr_payment_refunds")
    .select("id,obligation_id,request_id,provider_payment_intent_id,provider_refund_id,amount_cents,retained_cents,reason,refund_key,attempt_state")
    .eq("obligation_id", String(ob.id))
    .in("attempt_state", ["requested", "pending_unknown", "succeeded"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()) as { data: RefundAttemptRow | null; error: any };
  if (error) {
    return fail({ operation: op, code: "internal", detail: { reason: "refund_read", message: error.message } });
  }
  if (!attempt) {
    return fail({
      operation: op,
      code: "not_found",
      detail: { reason: "no_refund_attempt" },
      message: "There is no refund to reconcile on this delivery.",
    });
  }
  if (attempt.attempt_state === "succeeded") {
    return {
      ok: true,
      value: {
        refundId: attempt.id,
        attemptState: attempt.attempt_state,
        amountCents: attempt.amount_cents,
        retainedCents: attempt.retained_cents,
        reason: attempt.reason,
      },
    };
  }

  /*
   * LIST FIRST. Stripe idempotency keys expire after 24 hours (documented),
   * so "re-create under the same key" alone is only convergent inside that
   * window. Listing the intent's refunds and matching our own
   * metadata.couranrRefundId converges on the provider's record regardless of
   * age; only when the provider provably has NO refund do we (re)submit under
   * the attempt's key — inside the window that replays the original request,
   * and outside it the list has already established absence.
   */
  try {
    const listed = await getStripeClient().refunds.list({
      payment_intent: attempt.provider_payment_intent_id,
      limit: 100,
    });
    const match = (listed?.data ?? []).find(
      (r: any) => r?.metadata?.couranrRefundId === attempt.id
    );
    if (match) {
      const done = await callRpc<RefundAttemptRow>(op, "couranr_complete_payment_refund", {
        p_refund_id: attempt.id,
        p_provider_refund_id: String(match.id ?? ""),
        p_refund_status: String(match.status ?? ""),
        p_amount_cents: Number(match.amount ?? 0),
      });
      if (isFulfillmentFailure(done)) return done;
      const settled = done.value;
      return {
        ok: true,
        value: {
          refundId: settled.id,
          attemptState: settled.attempt_state,
          amountCents: settled.amount_cents,
          retainedCents: settled.retained_cents,
          reason: settled.reason,
        },
      };
    }
  } catch {
    // The list is an optimization for convergence, not the mechanism of
    // record; a failed list falls through to the idempotent re-submit.
  }
  return submitAndCompleteRefund(op, attempt);
}

async function submitAndCompleteRefund(
  op: string,
  attempt: RefundAttemptRow
): Promise<FulfillmentResult<RefundOutcome>> {
  let refund: any;
  try {
    refund = await getStripeClient().refunds.create(
      {
        payment_intent: attempt.provider_payment_intent_id,
        amount: attempt.amount_cents,
        metadata: { couranrRefundId: attempt.id, reason: attempt.reason },
      },
      { idempotencyKey: attempt.refund_key }
    );
  } catch (e: any) {
    /*
     * AN ERROR IS NOT EVIDENCE ABOUT THE MONEY — the capture rule, verbatim.
     * The request may have reached Stripe; a refund may exist. Park the
     * attempt at pending_unknown and let reconcileRefund converge under the
     * same idempotency key. Never mark failed from an HTTP error, never
     * retry in a loop from here.
     */
    await callRpc(op, "couranr_mark_payment_refund_unknown", {
      p_refund_id: attempt.id,
      p_detail: { type: e?.type ?? null, code: e?.code ?? null, statusCode: e?.statusCode ?? null },
    });
    return fail({
      operation: op,
      code: "internal",
      detail: { reason: "refund_outcome_unknown", type: e?.type, code: e?.code },
      message:
        "Couranr could not confirm the refund with the payment provider. Do not retry blindly — use Reconcile, which converges on the same provider operation.",
    });
  }

  const done = await callRpc<RefundAttemptRow>(op, "couranr_complete_payment_refund", {
    p_refund_id: attempt.id,
    p_provider_refund_id: String(refund?.id ?? ""),
    p_refund_status: String(refund?.status ?? ""),
    p_amount_cents: Number(refund?.amount ?? 0),
  });
  if (isFulfillmentFailure(done)) return done;
  const settled = done.value;
  return {
    ok: true,
    value: {
      refundId: settled.id,
      attemptState: settled.attempt_state,
      amountCents: settled.amount_cents,
      retainedCents: settled.retained_cents,
      reason: settled.reason,
    },
  };
}

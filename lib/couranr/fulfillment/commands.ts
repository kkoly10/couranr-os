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
import { captureEventId, reconcileActionForIntentStatus } from "@/lib/couranr/payments/states";

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
        /*
         * Scoped to the obligation's CURRENT version, i.e. to this capture
         * cycle. `couranr_begin_payment_capture` bumps the version each time
         * it moves authorized -> capture_pending, so every attempt gets its
         * own event id.
         *
         * Without `:v`, a second cycle that failed the same way would collide
         * with the first release event, `couranr_fail_payment_capture` would
         * swallow the `unique_violation` and return early, and the obligation
         * would be stranded in capture_pending with no way out.
         */
        p_provider_event_id: captureEventId.failed(
          String(ob.id),
          Number(ob.version),
          String(e?.code ?? "unknown")
        ),
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
    p_provider_event_id: captureEventId.result(String(ob.id), String(intent.id)),
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
  businessAccountId?: string;
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

  const status = String(intent.status ?? "");
  const action = reconcileActionForIntentStatus(status);

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

  const {
    data: requests,
    error,
    count,
  } = (await supabaseAdmin
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
    ])
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

  const rows = requests ?? [];
  const total = typeof count === "number" ? count : rows.length;
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

  return {
    ok: true,
    value: {
      entries: rows.map((request) => ({
        request,
        payment: obMap.get(String(request.id)) ?? null,
        servicePlan: planMap.get(String(request.id)) ?? null,
        delivery: deliveryMap.get(String(request.id)) ?? null,
      })),
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

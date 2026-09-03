import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import {
  classifyDatabaseError,
  logServerFailure,
  newCorrelationId,
  type PublicErrorCode,
} from "@/lib/couranr/errors";
import { canActOnDeliveryRequest, type RequestActor } from "@/lib/couranr/requests/permissions";
import {
  getCanonicalDelivery,
  isFulfillmentFailure,
  refundPayment,
  releaseAuthorization,
  type FulfillmentFailure,
  type FulfillmentResult,
  type RefundOutcome,
} from "@/lib/couranr/fulfillment/commands";
import type { RefundReason } from "@/lib/couranr/payments/states";

assertServerOnly("lib/couranr/fulfillment/cancellation.ts");

/**
 * Governed cancellation orchestration (batch 3 §30) — CAN-001.
 *
 * ONE composition of EXISTING commands, never a second money path. The stage
 * is determined from the STORED delivery and obligation, not from anything
 * the browser asserted, and each stage maps onto exactly one already-governed
 * recovery:
 *
 *   no delivery yet, request NOT confirmed         releaseAuthorization
 *     (money at most a hold)                         fee $0 — CAN-001's
 *                                                    before_authorization and
 *                                                    after_authorization_before_
 *                                                    confirmation stages, and
 *                                                    couranr_cannot_confirm,
 *                                                    are ALL "release, $0"
 *
 *   no delivery yet, request CONFIRMED              releaseAuthorization of
 *     (authorized; the canonical delivery is          the FULL hold (partial
 *     created only after capture, so this is a        capture is NOT built in
 *     real stage — final closure pass §4)             V0) + the $8 CAN-001
 *                                                    settlement recorded as a
 *                                                    durable Couranr
 *                                                    RECEIVABLE — owed, not
 *                                                    collected, never
 *                                                    fabricated as a charge
 *
 *   delivery pre-arrival (scheduled / assigned /   couranr_cancel_delivery,
 *     en_route_to_pickup), money captured            then refundPayment
 *                                                    reason cancel_after_
 *                                                    confirmation_before_arrival
 *                                                    ($8 retained) — or
 *                                                    couranr_caused_failure ($0)
 *                                                    when Couranr caused it
 *
 *   at_pickup onward, reason failed_pickup or      couranr_close_delivery_
 *     couranr_caused                                 undeliverable, then
 *                                                    refundPayment
 *                                                    failed_pickup_after_arrival
 *                                                    ($15) or
 *                                                    couranr_caused_failure ($0)
 *
 * Every fee above comes from the §B SQL command's own retention table
 * (20260903020000), which is CAN-001's schedule verbatim — so the fee this
 * module produces can never exceed CAN-001, because no amount and no
 * retention travels through here at all.
 *
 * OUT OF V0 SCOPE, deliberately: money movement past `picked_up` for any
 * reason OTHER than failed-pickup/Couranr-caused (partial delivery, disputes,
 * goodwill adjustments). Those return a `not_supported` conflict telling
 * Operations to route through Couranr Support / the forward repair path
 * rather than this module inventing an ungoverned fee.
 */

export const CANCELLATION_REASONS = [
  "merchant_request",
  "customer_request",
  "couranr_caused",
  "failed_pickup",
] as const;
export type CancellationReason = (typeof CANCELLATION_REASONS)[number];

export function isCancellationReason(v: unknown): v is CancellationReason {
  return typeof v === "string" && (CANCELLATION_REASONS as readonly string[]).includes(v);
}

/** Delivery states from which cancellation is still a schedule decision. */
const PRE_ARRIVAL_STATES = ["scheduled", "assigned", "en_route_to_pickup"] as const;
/** Delivery states from which only the undeliverable path may close. */
const POST_ARRIVAL_STATES = ["at_pickup", "picked_up", "in_transit", "at_dropoff"] as const;
/**
 * States in which the driver has, or may still have, physical custody
 * (custody begins at complete_pickup). Review item 4: the $15
 * failed-pickup retention and the plain failed-pickup closure are
 * at_pickup-only concepts and must NEVER attach to goods already picked up.
 */
const CUSTODY_STATES = ["picked_up", "in_transit", "at_dropoff"] as const;

export type CancellationOutcome = {
  /** Which governed path ran. */
  outcome:
    | "released"
    | "cancelled_delivery"
    | "closed_undeliverable"
    | "resumed_settlement"
    | "cancelled_request";
  /** The delivery's fulfillment state afterwards, when one exists. */
  deliveryState: string | null;
  /** The request's state afterwards — a user-visible cancellation must not
      leave a confirmed or pending request active (final closure pass §4). */
  requestState: string | null;
  /** What happened to the money, from the command that owns it. */
  payment:
    | { kind: "released"; obligationId: string; paymentState: string }
    | { kind: "refund"; refund: RefundOutcome }
    /* Final closure pass §4: confirmed-before-delivery — the hold released
       in full and CAN-001's $8 recorded as a durable receivable. */
    | {
        kind: "released_with_receivable";
        obligationId: string;
        paymentState: string;
        retainedDueCents: number;
      }
    /* Nothing at the provider to move: no obligation, or no intent ever
       attached. The request still terminates truthfully. */
    | { kind: "none" };
};

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

async function callRpc<T = Record<string, any>>(
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

/**
 * The refund reason CAN-001 assigns to this stage/reason pair. `null` means
 * the pair is governed by a release (no captured money should exist), and a
 * `not_supported` result means V0 refuses to move this money at all.
 */
function refundReasonFor(
  stage: "pre_arrival" | "at_pickup" | "in_custody",
  reason: CancellationReason
): RefundReason | "not_supported" {
  if (reason === "couranr_caused") return "couranr_caused_failure";
  if (stage === "pre_arrival") {
    // merchant_request / customer_request after confirmation, before arrival.
    if (reason === "merchant_request" || reason === "customer_request") {
      return "cancel_after_confirmation_before_arrival";
    }
    // failed_pickup makes no sense before anyone arrived.
    return "not_supported";
  }
  if (stage === "at_pickup") {
    // Failed pickup is EXACTLY this stage: the driver arrived, nothing is in
    // custody, and the pickup could not occur.
    if (reason === "failed_pickup") return "failed_pickup_after_arrival";
    return "not_supported";
  }
  /*
   * in_custody (picked_up / in_transit / at_dropoff): failed_pickup is a
   * pickup-stage concept — its $15 retention must never be selectable here
   * (review item 4). Only couranr_caused (handled above, $0 retained) moves
   * money once the goods are in a driver's hands; everything else is a
   * governed refusal, never an invented settlement.
   */
  return "not_supported";
}

/**
 * Cancel a delivery request's fulfillment WITH its governed money recovery —
 * a DURABLE SAGA (final closure pass §2).
 *
 * Operations only. Composes existing commands exclusively —
 * `releaseAuthorization`, `couranr_cancel_delivery`,
 * `couranr_close_delivery_undeliverable`, `refundPayment`,
 * `couranr_record_cancellation_settlement` and
 * `couranr_cancel_delivery_request` — and supplies no amount, no retention
 * and no target state to any of them.
 *
 * Durability: the CLOSED governed reason is persisted in the immutable
 * closure event (p_governed_reason), so when closure succeeded but money
 * recovery did not — even before any refund-attempt row existed — a retry
 * on the now-terminal delivery RESUMES the original settlement from that
 * evidence. The reason a retry posts is IGNORED on the resume path: nothing
 * a browser sends after closure can change the fee. Provider convergence is
 * the list-first path (§1); already-settled money replays idempotently.
 */
export async function cancelDeliveryWithRecovery(params: {
  actor: RequestActor;
  requestId: string;
  businessAccountId: string | null;
  /** Optional cross-check. When present it must be the request's delivery. */
  deliveryId: string | null;
  /** Ignored (and optional) when resuming a terminal delivery's settlement. */
  reason: CancellationReason | null;
  note: string;
}): Promise<FulfillmentResult<CancellationOutcome>> {
  const op = "cancelDeliveryWithRecovery";

  const permission = canActOnDeliveryRequest(params.actor, "review", params.businessAccountId);
  if (!permission.allowed || params.actor.kind !== "operations") {
    return fail({
      operation: op,
      code: "not_permitted",
      detail: { reason: "not_operations" },
      message: "Only Couranr Operations can cancel a delivery.",
    });
  }
  const note = typeof params.note === "string" ? params.note.trim() : "";
  if (!note) {
    return fail({
      operation: op,
      code: "invalid_input",
      detail: { reason: "no_note" },
      message: "Say why this delivery is being cancelled.",
    });
  }

  const requestRead = await readRequestForCancellation(op, params.requestId, params.businessAccountId);
  if (isFulfillmentFailure(requestRead)) return requestRead;
  const request = requestRead.value;

  const deliveryRead = await getCanonicalDelivery({
    requestId: params.requestId,
    businessAccountId: params.businessAccountId,
  });
  if (isFulfillmentFailure(deliveryRead)) return deliveryRead;
  const delivery = deliveryRead.value.delivery;

  if (delivery && params.deliveryId && String(delivery.id) !== params.deliveryId) {
    return fail({
      operation: op,
      code: "conflict",
      detail: { reason: "delivery_mismatch" },
      message: "That delivery does not belong to this request. Reload and try again.",
    });
  }

  /* --------------- terminal delivery: RESUME the saga (§2) -------------- */

  const deliveryState = delivery ? String(delivery.fulfillment_state ?? "") : null;
  if (delivery && (deliveryState === "cancelled" || deliveryState === "could_not_deliver")) {
    return resumeSettlementFromClosureEvidence(
      op,
      { actor: params.actor, requestId: params.requestId, businessAccountId: params.businessAccountId },
      request,
      delivery,
      note
    );
  }
  if (deliveryState === "delivered") {
    return fail({
      operation: op,
      code: "conflict",
      detail: { reason: "already_settled", state: deliveryState },
      message: "This delivery was completed and cannot be cancelled.",
    });
  }

  /* From here on a REASON is required — this is a first cancellation, not a
     resume, and the reason chosen now is what the closure evidence will
     carry forever. */
  if (!isCancellationReason(params.reason)) {
    return fail({
      operation: op,
      code: "invalid_input",
      detail: { reason: "cancellation_reason_invalid" },
      message: "That is not a governed cancellation reason.",
    });
  }
  const reason = params.reason;

  /* ------------------------- no delivery: derive from STORED facts ------ */

  if (!delivery) {
    return cancelBeforeDelivery(
      op,
      { actor: params.actor, requestId: params.requestId, businessAccountId: params.businessAccountId },
      request,
      reason,
      note
    );
  }

  /* ------------------------------- a canonical delivery exists --------- */

  const state = String(delivery.fulfillment_state ?? "");
  const version = Number(delivery.version);

  const preArrival = (PRE_ARRIVAL_STATES as readonly string[]).includes(state);
  const postArrival = (POST_ARRIVAL_STATES as readonly string[]).includes(state);
  if (!preArrival && !postArrival) {
    return fail({
      operation: op,
      code: "conflict",
      detail: { reason: "unrecognised_state", state },
      message: "Couranr does not recognise this delivery's state. Contact Couranr Support.",
    });
  }

  const inCustody = (CUSTODY_STATES as readonly string[]).includes(state);
  const refundReason = refundReasonFor(
    preArrival ? "pre_arrival" : inCustody ? "in_custody" : "at_pickup",
    reason
  );
  if (refundReason === "not_supported") {
    return fail({
      operation: op,
      code: "conflict",
      detail: { reason: "not_supported", state, cancellationReason: reason },
      message: preArrival
        ? "A failed pickup can only be recorded once a driver has arrived. Use a cancellation reason instead."
        : inCustody && reason === "failed_pickup"
          ? "A failed pickup applies only at the pickup door. These goods were already picked up — the driver has custody, and the failed-pickup settlement cannot attach to them."
          : "Cancelling at this stage is outside what Couranr can settle automatically. Send this to Couranr Support / the forward repair path.",
    });
  }

  const closed = preArrival
    ? await callRpc(op, "couranr_cancel_delivery", {
        p_delivery_id: String(delivery.id),
        p_expected_version: version,
        p_actor_user_id: params.actor.userId,
        p_reason: `${reason} — ${note}`,
        /* §2: the closed enum, persisted so a terminal retry can resume the
           SAME governed settlement without trusting any later browser input. */
        p_governed_reason: reason,
      })
    : await callRpc(op, "couranr_close_delivery_undeliverable", {
        p_delivery_id: String(delivery.id),
        p_expected_version: version,
        p_actor_user_id: params.actor.userId,
        p_reason: `${reason} — ${note}`,
        p_stage_note: state,
        /*
         * Custody evidence (review item 4): for goods already picked up the
         * operator's mandatory note IS the custody-resolution account, and
         * the SQL command refuses without it (and without an open dropoff
         * exception). At the pickup door there is no custody to resolve.
         */
        p_custody_resolution: inCustody ? note : null,
        p_governed_reason: reason,
      });
  if (isFulfillmentFailure(closed)) return closed;

  const refunded = await refundPayment({
    actor: params.actor,
    requestId: params.requestId,
    businessAccountId: params.businessAccountId,
    reason: refundReason,
  });
  if (isFulfillmentFailure(refunded)) {
    /* The fulfillment closure PERSISTED, and so did the governed reason —
       the saga can now ALWAYS resume from the terminal delivery, whether or
       not a refund-attempt row exists yet. Say exactly that. */
    return fail({
      operation: op,
      code: refunded.code,
      detail: { reason: "refund_after_closure_failed", state },
      message:
        (refunded.message ?? "The refund could not be settled.") +
        " The delivery itself WAS closed and the governed reason is recorded. Retrying is safe — the retry resumes this exact settlement from the closure evidence; no later input can change the fee.",
    });
  }

  const requestState = await terminateRequest(
    op,
    { actor: params.actor, requestId: params.requestId },
    `cancellation:${reason} — ${note}`
  );
  if (isFulfillmentFailure(requestState)) return requestState;

  return {
    ok: true,
    value: {
      outcome: preArrival ? "cancelled_delivery" : "closed_undeliverable",
      deliveryState: String((closed.value as Record<string, any>).fulfillment_state ?? ""),
      requestState: requestState.value,
      payment: { kind: "refund", refund: refunded.value },
    },
  };
}

/** The request row facts the stage derivation needs (final closure pass §4). */
async function readRequestForCancellation(
  op: string,
  requestId: string,
  businessAccountId: string | null
): Promise<FulfillmentResult<{ id: string; request_state: string }>> {
  let q = supabaseAdmin
    .from("couranr_delivery_requests")
    .select("id,request_state")
    .eq("id", requestId);
  q = businessAccountId === null ? q.is("business_account_id", null) : q.eq("business_account_id", businessAccountId);
  const { data, error } = (await q.maybeSingle()) as { data: any; error: any };
  if (error) {
    return fail({ operation: op, code: "internal", detail: { reason: "request_read", message: error.message } });
  }
  if (!data) {
    return fail({
      operation: op,
      code: "not_found",
      detail: { reason: "request_not_found" },
      message: "Delivery request not found.",
    });
  }
  return { ok: true, value: data };
}

/**
 * Terminate the REQUEST truthfully (final closure pass §4): a user-visible
 * cancellation must not leave a confirmed or pending request active. The SQL
 * command replays idempotently on an already-cancelled request; declined and
 * closed requests are left as the terminal record they already are.
 */
async function terminateRequest(
  op: string,
  params: { actor: { kind: "operations"; userId: string }; requestId: string },
  reason: string
): Promise<FulfillmentResult<string>> {
  const done = await callRpc<Record<string, any>>(op, "couranr_cancel_delivery_request", {
    p_request_id: params.requestId,
    p_actor_user_id: params.actor.userId,
    p_reason: reason,
  });
  if (isFulfillmentFailure(done)) {
    if (done.code === "version_conflict") {
      /* request_already_terminal: declined/closed. The record already tells
         the truth; the money settlement above is the part that mattered. */
      const read = await supabaseAdmin
        .from("couranr_delivery_requests")
        .select("request_state")
        .eq("id", params.requestId)
        .maybeSingle();
      const state = (read as any)?.data?.request_state;
      if (state === "declined" || state === "closed") return { ok: true, value: String(state) };
    }
    return done;
  }
  return { ok: true, value: String(done.value.request_state ?? "cancelled") };
}

/**
 * §4 — cancellation with NO canonical delivery, staged from STORED request
 * and payment facts (never from delivery existence alone):
 *
 *   couranr_caused                      → release, $0, whatever the stage
 *   request NOT confirmed               → release, $0 (before authorization,
 *                                         authorized-not-yet-confirmed and
 *                                         couranr-cannot-confirm all land
 *                                         here per CAN-001)
 *   request CONFIRMED, authorized       → release the FULL hold (partial
 *                                         capture is NOT built in V0) and
 *                                         record the $8 as a durable Couranr
 *                                         receivable — owed, not collected
 *   captured with no delivery           → stranded shape, refuse to guess
 */
async function cancelBeforeDelivery(
  op: string,
  params: {
    actor: { kind: "operations"; userId: string };
    requestId: string;
    businessAccountId: string | null;
  },
  request: { id: string; request_state: string },
  reason: CancellationReason,
  note: string
): Promise<FulfillmentResult<CancellationOutcome>> {
  if (reason === "failed_pickup") {
    return fail({
      operation: op,
      code: "invalid_input",
      detail: { reason: "failed_pickup_without_delivery" },
      message: "No driver was dispatched for this request, so a failed pickup cannot apply.",
    });
  }

  let q = supabaseAdmin
    .from("couranr_payment_obligations")
    .select("id,payment_state,provider_payment_intent_id")
    .eq("request_id", params.requestId);
  q =
    params.businessAccountId === null
      ? q.is("business_account_id", null)
      : q.eq("business_account_id", params.businessAccountId);
  const { data: ob, error: obError } = (await q.maybeSingle()) as { data: any; error: any };
  if (obError) {
    return fail({
      operation: op,
      code: "internal",
      detail: { reason: "obligation_read", message: obError.message },
    });
  }

  if (ob && ["captured", "capture_pending", "refunded"].includes(String(ob.payment_state))) {
    // Captured with no delivery is the stranded-conversion shape; a
    // cancellation flow must not paper over it with a guessed refund.
    return fail({
      operation: op,
      code: "conflict",
      detail: { reason: "not_supported", state: "captured_without_delivery" },
      message:
        "This payment was captured but no delivery exists. Send this to Couranr Support to reconcile before cancelling.",
    });
  }

  const confirmedBeforeDelivery =
    request.request_state === "confirmed" &&
    ob != null &&
    String(ob.payment_state) === "authorized" &&
    reason !== "couranr_caused";

  let payment: CancellationOutcome["payment"] = { kind: "none" };
  if (ob && ob.provider_payment_intent_id) {
    const released = await releaseAuthorization({
      actor: params.actor,
      requestId: params.requestId,
      businessAccountId: params.businessAccountId,
      reason: `cancellation:${reason} — ${note}`,
    });
    if (isFulfillmentFailure(released)) return released;
    payment = {
      kind: "released",
      obligationId: released.value.obligationId,
      paymentState: released.value.paymentState,
    };
  }

  if (confirmedBeforeDelivery && payment.kind === "released") {
    /* The canonical delivery is created only after capture, so CONFIRMED
       with only an authorization is a REAL CAN-001 $8 stage. The full hold
       was released (the provider-safe action without partial capture); the
       $8 is recorded as a durable receivable, never fabricated as a
       provider charge, and a retry converges on the same record. */
    const recorded = await callRpc(op, "couranr_record_cancellation_settlement", {
      p_obligation_id: payment.obligationId,
      p_actor_user_id: params.actor.userId,
      p_retained_due_cents: 800,
      p_reason: `cancellation:${reason} — ${note}`,
    });
    if (isFulfillmentFailure(recorded)) return recorded;
    payment = {
      kind: "released_with_receivable",
      obligationId: payment.obligationId,
      paymentState: payment.paymentState,
      retainedDueCents: 800,
    };
  }

  const requestState = await terminateRequest(op, params, `cancellation:${reason} — ${note}`);
  if (isFulfillmentFailure(requestState)) return requestState;

  return {
    ok: true,
    value: {
      outcome: payment.kind === "none" ? "cancelled_request" : "released",
      deliveryState: null,
      requestState: requestState.value,
      payment,
    },
  };
}

/**
 * §2 — the saga resume. The delivery is already terminal; the governed
 * reason lives in the immutable closure event, and NOTHING the caller posts
 * now can change the fee. Money that already settled replays idempotently;
 * money that never settled settles NOW through the same governed commands.
 */
async function resumeSettlementFromClosureEvidence(
  op: string,
  params: {
    actor: { kind: "operations"; userId: string };
    requestId: string;
    businessAccountId: string | null;
  },
  request: { id: string; request_state: string },
  delivery: Record<string, any>,
  note: string
): Promise<FulfillmentResult<CancellationOutcome>> {
  const { data: ev, error } = (await supabaseAdmin
    .from("couranr_delivery_events")
    .select("command,metadata")
    .eq("delivery_id", String(delivery.id))
    .in("command", ["cancel_delivery", "close_delivery_undeliverable"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()) as { data: any; error: any };
  if (error) {
    return fail({ operation: op, code: "internal", detail: { reason: "closure_read", message: error.message } });
  }
  const governedReason = ev?.metadata?.governedReason;
  if (!isCancellationReason(governedReason)) {
    /* A closure recorded before the saga carried its reason. Nothing here
       may guess a fee, so this stays a governed refusal — forward repair
       through Couranr Support, never an invented settlement. */
    return fail({
      operation: op,
      code: "conflict",
      detail: { reason: "closure_without_governed_reason" },
      message:
        "This delivery closed before its governed settlement reason was recorded. Send it to Couranr Support — the fee cannot be derived, so nothing was changed.",
    });
  }

  const stage: "pre_arrival" | "at_pickup" | "in_custody" =
    ev.command === "cancel_delivery"
      ? "pre_arrival"
      : (CUSTODY_STATES as readonly string[]).includes(String(ev?.metadata?.stageNote ?? ""))
        ? "in_custody"
        : "at_pickup";
  const refundReason = refundReasonFor(stage, governedReason);
  if (refundReason === "not_supported") {
    return fail({
      operation: op,
      code: "conflict",
      detail: { reason: "not_supported", stage, cancellationReason: governedReason },
      message: "The recorded closure carries no automatic settlement. Send this to Couranr Support.",
    });
  }

  const refunded = await refundPayment({
    actor: params.actor,
    requestId: params.requestId,
    businessAccountId: params.businessAccountId,
    reason: refundReason,
  });
  if (isFulfillmentFailure(refunded)) return refunded;

  const requestState = await terminateRequest(
    op,
    params,
    `cancellation:${governedReason} — resumed: ${note}`
  );
  if (isFulfillmentFailure(requestState)) return requestState;

  return {
    ok: true,
    value: {
      outcome: "resumed_settlement",
      deliveryState: String(delivery.fulfillment_state ?? ""),
      requestState: requestState.value,
      payment: { kind: "refund", refund: refunded.value },
    },
  };
}

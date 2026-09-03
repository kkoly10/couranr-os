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
 *   no delivery yet, money at most a HOLD          releaseAuthorization
 *     (not_started / requires_action / authorized)   fee $0 — CAN-001's
 *                                                    before_authorization and
 *                                                    after_authorization_before_
 *                                                    confirmation stages, and
 *                                                    couranr_cannot_confirm,
 *                                                    are ALL "release, $0"
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

export type CancellationOutcome = {
  /** Which governed path ran. */
  outcome: "released" | "cancelled_delivery" | "closed_undeliverable";
  /** The delivery's fulfillment state afterwards, when one exists. */
  deliveryState: string | null;
  /** What happened to the money, from the command that owns it. */
  payment:
    | { kind: "released"; obligationId: string; paymentState: string }
    | { kind: "refund"; refund: RefundOutcome };
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
  stage: "pre_arrival" | "post_arrival",
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
  // post_arrival
  if (reason === "failed_pickup") return "failed_pickup_after_arrival";
  return "not_supported";
}

/**
 * Cancel a delivery request's fulfillment WITH its governed money recovery.
 *
 * Operations only. Composes existing commands exclusively —
 * `releaseAuthorization`, `couranr_cancel_delivery`,
 * `couranr_close_delivery_undeliverable` and `refundPayment` — and supplies
 * no amount, no retention and no target state to any of them.
 *
 * If the fulfillment closure succeeds but the provider refund does not, the
 * failure says so explicitly and the whole flow is safe to retry: both SQL
 * commands replay idempotently and `refundPayment` converges on the same
 * attempt row, so a retry can never cancel twice or refund twice.
 */
export async function cancelDeliveryWithRecovery(params: {
  actor: RequestActor;
  requestId: string;
  businessAccountId: string | null;
  /** Optional cross-check. When present it must be the request's delivery. */
  deliveryId: string | null;
  reason: CancellationReason;
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
  if (!isCancellationReason(params.reason)) {
    return fail({
      operation: op,
      code: "invalid_input",
      detail: { reason: "cancellation_reason_invalid" },
      message: "That is not a governed cancellation reason.",
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

  /* ------------------------- no delivery: money is at most a hold ------ */

  if (!delivery) {
    if (params.reason === "failed_pickup") {
      return fail({
        operation: op,
        code: "invalid_input",
        detail: { reason: "failed_pickup_without_delivery" },
        message: "No driver was dispatched for this request, so a failed pickup cannot apply.",
      });
    }

    // Read the obligation's state with the same nullable-tenancy discipline
    // releaseAuthorization itself uses; this is a READ, the money command is
    // still the one that acts.
    let q = supabaseAdmin
      .from("couranr_payment_obligations")
      .select("id,payment_state")
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

    if (ob && ob.payment_state === "captured") {
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

    const released = await releaseAuthorization({
      actor: params.actor,
      requestId: params.requestId,
      businessAccountId: params.businessAccountId,
      reason: `cancellation:${params.reason} — ${note}`,
    });
    if (isFulfillmentFailure(released)) return released;
    return {
      ok: true,
      value: {
        outcome: "released",
        deliveryState: null,
        payment: {
          kind: "released",
          obligationId: released.value.obligationId,
          paymentState: released.value.paymentState,
        },
      },
    };
  }

  /* ------------------------------- a canonical delivery exists --------- */

  const state = String(delivery.fulfillment_state ?? "");
  const version = Number(delivery.version);

  if (state === "delivered" || state === "cancelled" || state === "could_not_deliver") {
    return fail({
      operation: op,
      code: "conflict",
      detail: { reason: "already_settled", state },
      message: "This delivery has already been settled and cannot be cancelled.",
    });
  }

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

  const refundReason = refundReasonFor(preArrival ? "pre_arrival" : "post_arrival", params.reason);
  if (refundReason === "not_supported") {
    return fail({
      operation: op,
      code: "conflict",
      detail: { reason: "not_supported", state, cancellationReason: params.reason },
      message: preArrival
        ? "A failed pickup can only be recorded once a driver has arrived. Use a cancellation reason instead."
        : "Cancelling at this stage is outside what Couranr can settle automatically. Send this to Couranr Support / the forward repair path.",
    });
  }

  const closed = preArrival
    ? await callRpc(op, "couranr_cancel_delivery", {
        p_delivery_id: String(delivery.id),
        p_expected_version: version,
        p_actor_user_id: params.actor.userId,
        p_reason: `${params.reason} — ${note}`,
      })
    : await callRpc(op, "couranr_close_delivery_undeliverable", {
        p_delivery_id: String(delivery.id),
        p_expected_version: version,
        p_actor_user_id: params.actor.userId,
        p_reason: `${params.reason} — ${note}`,
        p_stage_note: state,
      });
  if (isFulfillmentFailure(closed)) return closed;

  const refunded = await refundPayment({
    actor: params.actor,
    requestId: params.requestId,
    businessAccountId: params.businessAccountId,
    reason: refundReason,
  });
  if (isFulfillmentFailure(refunded)) {
    // The fulfillment closure PERSISTED; only the money did not settle. Say
    // exactly that — a retry replays the closure idempotently and converges
    // the refund on the same attempt, so nothing can run twice.
    return fail({
      operation: op,
      code: refunded.code,
      detail: { reason: "refund_after_closure_failed", state },
      message:
        (refunded.message ?? "The refund could not be settled.") +
        " The delivery itself WAS closed. Retrying is safe — the closure replays idempotently and a refund converges on the same attempt — and if the governed retention consumes the whole capture, no refund is owed and this refusal is the settled answer.",
    });
  }

  return {
    ok: true,
    value: {
      outcome: preArrival ? "cancelled_delivery" : "closed_undeliverable",
      deliveryState: String((closed.value as Record<string, any>).fulfillment_state ?? ""),
      payment: { kind: "refund", refund: refunded.value },
    },
  };
}

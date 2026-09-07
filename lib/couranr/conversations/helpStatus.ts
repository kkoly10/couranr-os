import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import { logServerFailure, newCorrelationId } from "@/lib/couranr/errors";

assertServerOnly("lib/couranr/conversations/helpStatus.ts");

export type HelpReturnState = "none" | "required" | "returning" | "returned";
export type HelpRefundState =
  | "none"
  | "pending"
  | "refunded"
  | "not_due"
  | "needs_review";

export type HelpLifecycleStatus =
  | {
      available: true;
      returnState: HelpReturnState;
      returnRequiredAt: string | null;
      returnStartedAt: string | null;
      returnedAt: string | null;
      refundState: HelpRefundState;
      refundUpdatedAt: string | null;
    }
  | { available: false };

function unavailable(operation: string, detail: unknown): HelpLifecycleStatus {
  logServerFailure({
    correlationId: newCorrelationId(),
    operation,
    code: "internal",
    detail,
  });
  return { available: false };
}

export function mapHelpReturnState(params: {
  returnState?: unknown;
  fulfillmentState?: unknown;
}): HelpReturnState | null {
  if (params.returnState === "required") return "required";
  if (params.returnState === "returning") return "returning";
  if (params.returnState === "returned") return "returned";
  if (params.returnState !== null && params.returnState !== undefined) return null;

  if (params.fulfillmentState === "return_required") return "required";
  if (params.fulfillmentState === "returning") return "returning";
  if (params.fulfillmentState === "returned") return "returned";
  return "none";
}

export function mapHelpRefundState(params: {
  attemptState?: unknown;
  paymentState?: unknown;
}): HelpRefundState | null {
  // The obligation is the durable aggregate. If it records any refund as
  // settled, a later retry row must not make the customer-facing status regress.
  if (
    params.paymentState === "refunded" ||
    params.paymentState === "partially_refunded"
  ) {
    return "refunded";
  }

  if (params.attemptState === "requested" || params.attemptState === "pending_unknown") {
    return "pending";
  }
  if (params.attemptState === "succeeded") return "refunded";
  if (params.attemptState === "settled_no_refund_due") return "not_due";
  if (params.attemptState === "failed") return "needs_review";
  if (params.attemptState !== null && params.attemptState !== undefined) return null;
  return "none";
}

/**
 * Read the return/refund projection for ONE Delivery Help credential.
 *
 * The caller supplies only the delivery id that came from redeemHelpToken.
 * Nothing here accepts a request id, payment id, amount, provider id, payer or
 * return destination from the browser. The response intentionally contains no
 * money amount: a Delivery Help token proves recipient relationship to one
 * delivery, not identity of the person or business that paid the delivery
 * charge.
 *
 * This read is fail-soft. A status-projection problem must not take down manual
 * Delivery Help; callers render "status unavailable" while the message thread
 * continues to work.
 */
export async function readHelpLifecycleStatus(
  deliveryId: string
): Promise<HelpLifecycleStatus> {
  const delivery = await supabaseAdmin
    .from("couranr_deliveries")
    .select("id,request_id,fulfillment_state,payment_obligation_id")
    .eq("id", deliveryId)
    .maybeSingle();

  if (delivery.error || !delivery.data) {
    return unavailable("help.status.delivery", delivery.error ?? { reason: "delivery_missing" });
  }

  const requestId = String(delivery.data.request_id);
  const obligationId = delivery.data.payment_obligation_id
    ? String(delivery.data.payment_obligation_id)
    : null;

  const [returnQ, refundQ, obligationQ] = await Promise.all([
    supabaseAdmin
      .from("couranr_delivery_returns")
      .select("return_state,required_at,started_at,returned_at,updated_at")
      .eq("delivery_id", deliveryId)
      .maybeSingle(),
    supabaseAdmin
      .from("couranr_payment_refunds")
      .select("attempt_state,updated_at")
      .eq("request_id", requestId)
      .order("created_at", { ascending: false })
      .limit(1),
    obligationId
      ? supabaseAdmin
          .from("couranr_payment_obligations")
          .select("payment_state,refunded_at,updated_at")
          .eq("id", obligationId)
          .eq("request_id", requestId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null } as any),
  ]);

  if (returnQ.error || refundQ.error || obligationQ.error) {
    return unavailable("help.status.projection", {
      returnError: returnQ.error,
      refundError: refundQ.error,
      obligationError: obligationQ.error,
    });
  }

  const returnState = mapHelpReturnState({
    returnState: returnQ.data?.return_state ?? null,
    fulfillmentState: delivery.data.fulfillment_state,
  });
  const latestRefund = Array.isArray(refundQ.data) ? refundQ.data[0] ?? null : null;
  const refundState = mapHelpRefundState({
    attemptState: latestRefund?.attempt_state ?? null,
    paymentState: obligationQ.data?.payment_state ?? null,
  });

  // Unknown stored vocabulary is a server/schema problem, not a new status the
  // customer should be asked to interpret.
  if (!returnState || !refundState) {
    return unavailable("help.status.vocabulary", {
      returnState: returnQ.data?.return_state ?? null,
      fulfillmentState: delivery.data.fulfillment_state,
      refundState: latestRefund?.attempt_state ?? null,
      paymentState: obligationQ.data?.payment_state ?? null,
    });
  }

  return {
    available: true,
    returnState,
    returnRequiredAt: returnQ.data?.required_at ? String(returnQ.data.required_at) : null,
    returnStartedAt: returnQ.data?.started_at ? String(returnQ.data.started_at) : null,
    returnedAt: returnQ.data?.returned_at ? String(returnQ.data.returned_at) : null,
    refundState,
    refundUpdatedAt:
      latestRefund?.updated_at
        ? String(latestRefund.updated_at)
        : obligationQ.data?.refunded_at
          ? String(obligationQ.data.refunded_at)
          : refundState === "refunded" && obligationQ.data?.updated_at
            ? String(obligationQ.data.updated_at)
            : null,
  };
}

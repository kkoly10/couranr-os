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

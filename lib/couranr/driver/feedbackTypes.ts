/** Browser-safe projection returned only after the route re-authorizes the
 * delivery audience. Keep it separate from the service-role feedback module. */
export type FeedbackView = {
  driverName: string | null;
  review: { rating: number; comment: string | null; createdAt: string } | null;
  tip: {
    amountCents: number;
    paymentState: string;
    capturedAmountCents: number;
    refundedAmountCents: number;
    disputed: boolean;
  } | null;
};

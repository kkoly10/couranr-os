export type LedgerRecentTransaction = {
  id: string;
  source_kind: "capture" | "refund" | "cancellation_receivable";
  request_id: string;
  obligation_id: string | null;
  currency: "usd";
  occurred_at: string;
  amount_cents: number;
};

export type LedgerReconciliation = {
  balanced: boolean;
  capturedCents: number;
  refundedCents: number;
  governedReceivableCents: number;
  stripeClearingCents: number;
  deliveryRevenueCents: number;
  promotionalCreditExpenseCents: number;
  refundExpenseCents: number;
  accountsReceivableCents: number;
  expectedStripeClearingCents: number;
  unbalancedTransactions: number;
  missingCaptures: number;
  missingRefunds: number;
  missingReceivables: number;
  recentTransactions: LedgerRecentTransaction[];
  generatedAt: string;
};

export type OperationsPaymentRow = {
  id: string;
  requestId: string;
  payerType: "merchant" | "customer";
  amountCents: number;
  currency: "usd";
  paymentState: string;
  authorizedAt: string | null;
  captureRequestedAt: string | null;
  capturedAt: string | null;
  capturedAmountCents: number | null;
  refundedAt: string | null;
  refundedAmountCents: number | null;
  updatedAt: string;
};

export type OperationsFinanceOverview = {
  reconciliation: LedgerReconciliation;
  payments: OperationsPaymentRow[];
};

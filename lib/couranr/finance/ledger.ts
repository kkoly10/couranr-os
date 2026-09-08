import { assertServerOnly } from "@/lib/couranr/serverOnly";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

assertServerOnly("lib/couranr/finance/ledger.ts");

import type {
  LedgerRecentTransaction,
  LedgerReconciliation,
  OperationsFinanceOverview,
  OperationsPaymentRow,
} from "./types";

function n(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseReconciliation(value: unknown): LedgerReconciliation {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const recent = Array.isArray(v.recentTransactions) ? v.recentTransactions : [];
  return {
    balanced: v.balanced === true,
    capturedCents: n(v.capturedCents),
    refundedCents: n(v.refundedCents),
    governedReceivableCents: n(v.governedReceivableCents),
    stripeClearingCents: n(v.stripeClearingCents),
    deliveryRevenueCents: n(v.deliveryRevenueCents),
    promotionalCreditExpenseCents: n(v.promotionalCreditExpenseCents),
    refundExpenseCents: n(v.refundExpenseCents),
    accountsReceivableCents: n(v.accountsReceivableCents),
    expectedStripeClearingCents: n(v.expectedStripeClearingCents),
    unbalancedTransactions: n(v.unbalancedTransactions),
    missingCaptures: n(v.missingCaptures),
    missingRefunds: n(v.missingRefunds),
    missingReceivables: n(v.missingReceivables),
    recentTransactions: recent.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: String(r.id ?? ""),
        source_kind: String(r.source_kind ?? "") as LedgerRecentTransaction["source_kind"],
        request_id: String(r.request_id ?? ""),
        obligation_id: r.obligation_id == null ? null : String(r.obligation_id),
        currency: "usd",
        occurred_at: String(r.occurred_at ?? ""),
        amount_cents: n(r.amount_cents),
      };
    }),
    generatedAt: String(v.generatedAt ?? ""),
  };
}

export async function getOperationsFinanceOverview(): Promise<
  { ok: true; value: OperationsFinanceOverview } | { ok: false; error: string }
> {
  const [ledger, payments] = await Promise.all([
    supabaseAdmin.rpc("couranr_get_ledger_reconciliation"),
    supabaseAdmin
      .from("couranr_payment_obligations")
      .select(
        "id,request_id,payer_type,amount_cents,currency,payment_state,authorized_at,capture_requested_at,captured_at,captured_amount_cents,refunded_at,refunded_amount_cents,updated_at",
      )
      .order("updated_at", { ascending: false })
      .limit(100),
  ]);

  if (ledger.error) {
    return { ok: false, error: `Ledger reconciliation failed: ${ledger.error.message}` };
  }
  if (payments.error) {
    return { ok: false, error: `Payment overview failed: ${payments.error.message}` };
  }

  return {
    ok: true,
    value: {
      reconciliation: parseReconciliation(ledger.data),
      payments: (payments.data ?? []).map((row: any) => ({
        id: String(row.id),
        requestId: String(row.request_id),
        payerType: row.payer_type as "merchant" | "customer",
        amountCents: n(row.amount_cents),
        currency: "usd",
        paymentState: String(row.payment_state),
        authorizedAt: row.authorized_at ?? null,
        captureRequestedAt: row.capture_requested_at ?? null,
        capturedAt: row.captured_at ?? null,
        capturedAmountCents: row.captured_amount_cents == null ? null : n(row.captured_amount_cents),
        refundedAt: row.refunded_at ?? null,
        refundedAmountCents: row.refunded_amount_cents == null ? null : n(row.refunded_amount_cents),
        updatedAt: String(row.updated_at),
      })),
    },
  };
}

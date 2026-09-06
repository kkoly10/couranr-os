"use client";

import * as React from "react";
import Link from "next/link";
import {
  Badge,
  Card,
  CardHeader,
  Cluster,
  Stack,
  Text,
  buttonClassName,
} from "@/components/couranr/primitives";
import {
  ErrorState,
  LoadingState,
  PermissionDeniedState,
} from "@/components/couranr/states";
import {
  call,
  isApiFailure,
  withReference,
  type ApiFailure,
} from "@/components/couranr/requests/client";
import { formatCents } from "@/lib/couranr/requests/view";
import type {
  LedgerReconciliation,
  OperationsFinanceOverview,
  OperationsPaymentRow,
} from "@/lib/couranr/finance/types";

export function OperationsPaymentsDashboard() {
  const [value, setValue] = React.useState<OperationsFinanceOverview | null>(null);
  const [failure, setFailure] = React.useState<ApiFailure | null>(null);

  const load = React.useCallback(async () => {
    const result = await call<OperationsFinanceOverview>(
      "/api/couranr/operations/payments/overview",
    );
    if (isApiFailure(result)) {
      setFailure(result);
      setValue(null);
      return;
    }
    setFailure(null);
    setValue(result.value);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (!value && !failure) {
    return (
      <LoadingState label="Loading payments and ledger">
        <Card>
          <CardHeader
            title="Payments and reconciliation"
            description="Loading canonical payment and ledger evidence."
          />
        </Card>
      </LoadingState>
    );
  }
  if (failure?.status === 401 || failure?.status === 403) {
    return <PermissionDeniedState />;
  }
  if (failure || !value) {
    return (
      <ErrorState
        title="Payments could not be loaded"
        body={failure ? withReference(failure) : "No financial data was returned."}
        action={{ label: "Retry", onClick: load }}
      />
    );
  }

  return (
    <Stack gap={6}>
      <ReconciliationSummary value={value.reconciliation} />

      <Card>
        <CardHeader
          title="Payment obligations"
          description="The latest canonical payer obligations. Authorization is not counted as revenue; capture is."
        />
        {value.payments.length === 0 ? (
          <div className="cr-ops-ready-state">
            <Text strong>No payment obligations yet.</Text>
            <Text muted size="sm">
              New payer obligations appear here when a delivery reaches payment.
            </Text>
          </div>
        ) : (
          <div className="cr-ops-attention-list">
            {value.payments.map((payment) => (
              <PaymentRow key={payment.id} payment={payment} />
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Recent ledger transactions"
          description="Append-only financial postings derived from canonical capture, refund, and governed receivable evidence."
        />
        {value.reconciliation.recentTransactions.length === 0 ? (
          <div className="cr-ops-ready-state">
            <Text strong>No ledger transactions yet.</Text>
            <Text muted size="sm">
              Authorized holds do not create revenue. The first successful capture creates the first posting.
            </Text>
          </div>
        ) : (
          <div className="cr-ops-attention-list">
            {value.reconciliation.recentTransactions.map((tx) => (
              <Link
                key={tx.id}
                href={`/operations/deliveries/${tx.request_id}#ops-current-action`}
                className="cr-ops-attention"
              >
                <div className="cr-ops-attention__main">
                  <Cluster gap={2}>
                    <Badge tone={tx.source_kind === "refund" ? "warning" : "neutral"}>
                      {sourceLabel(tx.source_kind)}
                    </Badge>
                    <Text size="xs" muted>{new Date(tx.occurred_at).toLocaleString()}</Text>
                  </Cluster>
                  <Text size="sm" muted>Request {shortId(tx.request_id)}</Text>
                </div>
                <div className="cr-ops-attention__aside">
                  <Text strong numeric>{formatCents(tx.amount_cents)}</Text>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </Stack>
  );
}

function ReconciliationSummary({ value }: { value: LedgerReconciliation }) {
  const missing =
    value.missingCaptures + value.missingRefunds + value.missingReceivables;
  const clearingDelta = value.stripeClearingCents - value.expectedStripeClearingCents;

  return (
    <>
      <Card>
        <CardHeader
          title="Ledger reconciliation"
          description="Canonical captured/refunded money compared with Couranr's immutable double-entry ledger. This is an internal reconciliation and does not call Stripe."
          actions={
            <Badge tone={value.balanced ? "success" : "danger"}>
              {value.balanced ? "Balanced" : "Attention required"}
            </Badge>
          }
        />
        <div className="cr-ops-metrics" aria-label="Financial reconciliation summary">
          <Metric label="Captured" value={formatCents(value.capturedCents)} />
          <Metric label="Refunded" value={formatCents(value.refundedCents)} />
          <Metric label="Stripe clearing" value={formatCents(value.stripeClearingCents)} />
          <Metric
            label="Promotional credits"
            value={formatCents(value.promotionalCreditExpenseCents)}
          />
          <Metric
            label="Receivable"
            value={formatCents(value.accountsReceivableCents)}
          />
        </div>
      </Card>

      {!value.balanced ? (
        <Card>
          <CardHeader
            title="Reconciliation exception"
            description="Do not treat the ledger as reconciled until every source posting is present and every transaction balances."
          />
          <Stack gap={2}>
            <Text size="sm">Missing source postings: {missing}</Text>
            <Text size="sm">Unbalanced transactions: {value.unbalancedTransactions}</Text>
            <Text size="sm">Clearing delta: {formatCents(clearingDelta)}</Text>
          </Stack>
        </Card>
      ) : null}
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="cr-ops-metric">
      <span className="cr-ops-metric__top"><span>{label}</span></span>
      <span className="cr-ops-metric__value">{value}</span>
    </div>
  );
}

function PaymentRow({ payment }: { payment: OperationsPaymentRow }) {
  const tone =
    payment.paymentState === "captured"
      ? "success"
      : payment.paymentState === "failed"
        ? "danger"
        : payment.paymentState === "capture_pending"
          ? "warning"
          : "neutral";
  return (
    <Link
      href={`/operations/deliveries/${payment.requestId}#ops-current-action`}
      className="cr-ops-attention"
    >
      <div className="cr-ops-attention__main">
        <Cluster gap={2}>
          <Badge tone={tone}>{payment.paymentState.replace(/_/g, " ")}</Badge>
          <Text size="xs" muted>{payment.payerType} payer</Text>
        </Cluster>
        <Text size="sm" muted>Request {shortId(payment.requestId)}</Text>
      </div>
      <div className="cr-ops-attention__aside">
        <Text strong numeric>{formatCents(payment.amountCents)}</Text>
        <Text size="xs" muted>{new Date(payment.updatedAt).toLocaleString()}</Text>
      </div>
    </Link>
  );
}

function shortId(id: string) {
  return id ? `${id.slice(0, 8)}…` : "—";
}

function sourceLabel(kind: LedgerReconciliation["recentTransactions"][number]["source_kind"]) {
  switch (kind) {
    case "capture":
      return "Capture";
    case "refund":
      return "Refund";
    case "cancellation_receivable":
      return "Cancellation receivable";
  }
}

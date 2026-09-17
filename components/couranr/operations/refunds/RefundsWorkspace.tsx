"use client";

import * as React from "react";
import Link from "next/link";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Cluster,
  Stack,
  Text,
  type BadgeTone,
} from "@/components/couranr/primitives";
import { Field, Input, Textarea } from "@/components/couranr/forms";
import { CardSkeleton, ErrorState, LoadingState } from "@/components/couranr/states";
import { isApiFailure, withReference } from "@/components/couranr/requests/client";
import { formatCents } from "@/lib/couranr/requests/view";
import {
  approveRefundRequest,
  denyRefundRequest,
  loadRefundRequests,
  type RefundRequestRow,
} from "./client";

/**
 * OPS-011 — Refund management.
 *
 * Reviews DELIVERY-CHARGE refund requests. The scope line is the registry's
 * own: "Merchant controls product refund; Couranr controls delivery-service
 * refund." Nothing on this screen offers to refund merchandise, and no copy
 * anywhere on it promises a delivery time — TRM-001 lists "on-time guarantee"
 * among the claims Couranr never makes.
 *
 * The figure in the approval box is a PROPOSAL. Couranr recomputes what is
 * refundable server-side from the captured delivery charge and refuses a
 * larger figure outright rather than reducing it, so this screen can show the
 * ceiling but can never set it.
 */

const STATE_LABELS: Record<RefundRequestRow["state"], string> = {
  pending: "Pending",
  approved: "Approved",
  processing: "Processing",
  partially_refunded: "Partially refunded",
  refunded: "Refunded",
  denied: "Denied",
  failed: "Failed",
};

const STATE_TONES: Record<RefundRequestRow["state"], BadgeTone> = {
  pending: "warning",
  approved: "info",
  processing: "info",
  partially_refunded: "success",
  refunded: "success",
  denied: "neutral",
  failed: "danger",
};

const REASON_LABELS: Record<string, string> = {
  service_not_performed: "Delivery service not performed",
  couranr_caused_failure: "Couranr-caused failure",
  duplicate_delivery_charge: "Duplicate delivery charge",
  incorrect_delivery_charge: "Delivery charge did not match the quote",
  operations_adjustment: "Couranr Operations adjustment",
};

const REQUESTER_LABELS: Record<RefundRequestRow["requestedBy"], string> = {
  merchant: "Merchant",
  customer: "Customer",
  operations: "Couranr Operations",
};

/** A decision is still open only while the money has not been committed. */
function isOpenForDecision(row: RefundRequestRow): boolean {
  return row.state === "pending";
}

export function RefundsWorkspace() {
  const [rows, setRows] = React.useState<RefundRequestRow[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [generation, setGeneration] = React.useState(0);

  const reload = React.useCallback(async () => {
    const r = await loadRefundRequests();
    if (isApiFailure(r)) {
      /* A failed read is a FAILURE, never an empty queue. "Nothing to review"
         and "Couranr could not read the queue" are different sentences and
         only one of them is safe to act on. */
      setRows(null);
      setLoadError(withReference(r));
      return;
    }
    setLoadError(null);
    setRows(Array.isArray(r.value.refundRequests) ? r.value.refundRequests : []);
  }, []);

  React.useEffect(() => {
    void reload();
  }, [reload, generation]);

  const onChanged = React.useCallback((updated: RefundRequestRow) => {
    setRows((current) =>
      current ? current.map((r) => (r.id === updated.id ? updated : r)) : current
    );
  }, []);

  if (loadError) {
    return (
      <ErrorState
        title="Couranr could not load the refund queue"
        body={loadError}
        action={{ label: "Try again", onClick: () => setGeneration((g) => g + 1) }}
      />
    );
  }
  if (rows === null) {
    return (
      <LoadingState label="Loading refund requests">
        <CardSkeleton lines={4} />
      </LoadingState>
    );
  }

  return (
    <Stack gap={6}>
      <Card>
        <CardHeader
          title="What Couranr refunds here"
          description="Couranr refunds the delivery charge it collected. The merchant controls any refund of the product itself."
        />
      </Card>

      {rows.length === 0 ? (
        <Card>
          <CardHeader title="No refund requests" />
          <Text size="sm" muted>
            Nothing is waiting for Couranr Operations review.
          </Text>
        </Card>
      ) : (
        rows.map((row) => <RefundRequestCard key={row.id} row={row} onChanged={onChanged} />)
      )}
    </Stack>
  );
}

function RefundRequestCard({
  row,
  onChanged,
}: {
  row: RefundRequestRow;
  onChanged: (updated: RefundRequestRow) => void;
}) {
  const [busy, setBusy] = React.useState<"approve" | "deny" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [amountText, setAmountText] = React.useState("");
  const [denialReason, setDenialReason] = React.useState("");

  const open = isOpenForDecision(row);
  const ceilingCents = row.remainingRefundableCents;

  /* Parsed for the operator's benefit only — the server recomputes and is the
     authority. Dollars in the box, integer cents on the wire: money never
     travels as a float. */
  const parsedCents = React.useMemo(() => {
    const t = amountText.trim();
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(t)) return null;
    const [whole, frac = ""] = t.split(".");
    return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  }, [amountText]);

  const overCeiling = parsedCents !== null && parsedCents > ceilingCents;

  async function approve(cents: number) {
    if (busy) return;
    setBusy("approve");
    setError(null);
    const r = await approveRefundRequest({
      id: row.id,
      expectedVersion: row.version,
      approvedCents: cents,
    });
    setBusy(null);
    if (isApiFailure(r)) {
      setError(withReference(r));
      return;
    }
    setAmountText("");
    onChanged(r.value.refundRequest);
  }

  async function deny() {
    if (busy) return;
    if (!denialReason.trim()) {
      setError("Say why this delivery-charge refund is being denied.");
      return;
    }
    setBusy("deny");
    setError(null);
    const r = await denyRefundRequest({
      id: row.id,
      expectedVersion: row.version,
      denialReason: denialReason.trim(),
    });
    setBusy(null);
    if (isApiFailure(r)) {
      setError(withReference(r));
      return;
    }
    setDenialReason("");
    onChanged(r.value.refundRequest);
  }

  return (
    <Card>
      <CardHeader
        title={row.reference ? `Delivery ${row.reference}` : "Delivery-charge refund request"}
        description={`${REASON_LABELS[row.reasonCode] ?? row.reasonCode} — raised by ${
          REQUESTER_LABELS[row.requestedBy] ?? row.requestedBy
        }`}
        actions={<Badge tone={STATE_TONES[row.state]}>{STATE_LABELS[row.state]}</Badge>}
      />

      <Stack gap={3}>
        {row.detail ? (
          <Text size="sm" muted>
            {row.detail}
          </Text>
        ) : null}

        <Cluster gap={4}>
          <Text size="sm">
            Delivery charge captured{" "}
            <Text as="span" strong numeric>
              {formatCents(row.capturedAmountCents)}
            </Text>
          </Text>
          <Text size="sm">
            Already refunded{" "}
            <Text as="span" strong numeric>
              {formatCents(row.refundedAmountCents)}
            </Text>
          </Text>
          <Text size="sm">
            Refundable now{" "}
            <Text as="span" strong numeric>
              {formatCents(ceilingCents)}
            </Text>
          </Text>
        </Cluster>

        {row.approvedAmountCents !== null ? (
          <Text size="sm">
            Couranr approved{" "}
            <Text as="span" strong numeric>
              {formatCents(row.approvedAmountCents)}
            </Text>{" "}
            of{" "}
            <Text as="span" strong numeric>
              {formatCents(row.refundableBaseCents)}
            </Text>
            .
          </Text>
        ) : null}

        {row.denialReason ? (
          <Text size="sm" muted>
            Denied: {row.denialReason}
          </Text>
        ) : null}

        {row.attempt ? (
          <Text size="sm" muted>
            Payment provider attempt: {row.attempt.state}
            {row.attempt.retainedCents > 0
              ? `, ${formatCents(row.attempt.retainedCents)} retained`
              : ""}
            .
          </Text>
        ) : null}

        {row.state === "failed" ? (
          <Alert tone="danger" title="This refund did not complete">
            The payment provider did not complete this refund. It is recorded as failed and the
            delivery charge has not been returned. Reconcile it from Payments before deciding
            again.
          </Alert>
        ) : null}

        <Cluster gap={3}>
          <Link href={`/operations/deliveries/${row.requestId}`}>View delivery</Link>
          {row.incidentId ? <Link href="/operations/incidents">View incident</Link> : null}
          <Link href={`/operations/deliveries/${row.requestId}#messages`}>
            Message merchant or customer
          </Link>
        </Cluster>

        {open ? (
          <Stack gap={3}>
            <Field
              label="Refund this much of the delivery charge"
              hint={`Couranr can refund up to ${formatCents(ceilingCents)} on this delivery.`}
              error={
                overCeiling
                  ? `That is more than the ${formatCents(
                      ceilingCents
                    )} still refundable on this delivery charge.`
                  : undefined
              }
            >
              {(a) => (
                <Input
                  {...a}
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amountText}
                  onChange={(e) => setAmountText(e.target.value)}
                />
              )}
            </Field>

            <Cluster gap={3}>
              <Button
                variant="primary"
                loading={busy === "approve"}
                loadingLabel="Approving…"
                disabled={parsedCents === null || parsedCents <= 0 || overCeiling}
                onClick={() => {
                  if (parsedCents !== null) void approve(parsedCents);
                }}
              >
                Approve partial refund
              </Button>
              <Button
                variant="secondary"
                loading={busy === "approve"}
                loadingLabel="Approving…"
                disabled={ceilingCents <= 0}
                onClick={() => void approve(ceilingCents)}
              >
                Approve full {formatCents(ceilingCents)}
              </Button>
            </Cluster>

            <Field label="Reason for denying">
              {(a) => (
                <Textarea
                  {...a}
                  rows={2}
                  value={denialReason}
                  onChange={(e) => setDenialReason(e.target.value)}
                />
              )}
            </Field>
            <Cluster gap={3}>
              <Button
                variant="ghost"
                loading={busy === "deny"}
                loadingLabel="Denying…"
                onClick={() => void deny()}
              >
                Deny refund
              </Button>
            </Cluster>
          </Stack>
        ) : null}

        {error ? (
          <Alert tone="danger" title="Refund decision failed">
            {error}
          </Alert>
        ) : null}
      </Stack>
    </Card>
  );
}

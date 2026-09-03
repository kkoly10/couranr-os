"use client";

import * as React from "react";
import { Alert, Button, Card, CardHeader, Cluster, Grid, Stack, Text } from "@/components/couranr/primitives";
import { Field, Input, Select } from "@/components/couranr/forms";
import { ErrorState } from "@/components/couranr/states";
import { formatCents, type DeliveryRequestView } from "@/lib/couranr/requests/view";
import {
  cancelDeliveryFromBrowser,
  refundFromBrowser,
  reconcileRefundFromBrowser,
  releaseHoldFromBrowser,
  type FulfillmentView,
} from "./client";
import { isApiFailure, withReference } from "@/components/couranr/requests/client";

/**
 * OPS-003 — payment evidence and recovery (batch 3 §E, corrected per review
 * item 6).
 *
 * Everything here is EXPLICIT AND NARROW: release takes a reason, the ONE
 * standalone refund action refunds in full (retentions are derived from the
 * delivery's stored stage on the Cancel path — never picked from a dropdown),
 * and cancellation composes the same commands with a mandatory note. There is
 * no amount field, no state dropdown, and nothing that could move money
 * outside a named command.
 */

const CANCEL_REASONS = [
  { value: "merchant_request", label: "Merchant asked to cancel" },
  { value: "customer_request", label: "Customer asked to cancel" },
  { value: "couranr_caused", label: "Couranr caused the failure" },
  { value: "failed_pickup", label: "Driver arrived; pickup cannot occur" },
];

type PaymentView = NonNullable<FulfillmentView["payment"]>;

/**
 * The V0 refund-surface truth table, extracted pure so it is testable:
 *
 *   captured, no attempt (or a failed one)   → the Full refund button only
 *   attempt requested / pending_unknown      → Reconcile only (outcome is
 *                                              in flight or unknown — a second
 *                                              submit would be a guess)
 *   attempt succeeded, or state 'refunded'   → NEITHER button; show the
 *                                              refunded and retained figures
 *                                              truthfully. One refund chain
 *                                              per obligation is the schema's
 *                                              own rule; the screen must not
 *                                              imply a second one exists.
 */
export function refundControlsFor(payment: PaymentView): {
  showFullRefund: boolean;
  showReconcile: boolean;
  settled: { refundedCents: number; retainedCents: number } | null;
} {
  const attempt = payment.refundAttempt;
  const settled =
    payment.paymentState === "refunded" || attempt?.state === "succeeded"
      ? {
          refundedCents: payment.refundedAmountCents ?? attempt?.amountCents ?? 0,
          retainedCents: attempt?.retainedCents ?? 0,
        }
      : null;
  if (settled) return { showFullRefund: false, showReconcile: false, settled };
  if (attempt && (attempt.state === "requested" || attempt.state === "pending_unknown")) {
    return { showFullRefund: false, showReconcile: true, settled: null };
  }
  return {
    showFullRefund: payment.paymentState === "captured",
    showReconcile: false,
    settled: null,
  };
}

export function OperationsPaymentRecoveryPanel({
  request,
  fulfillment,
  onChanged,
}: {
  request: DeliveryRequestView;
  fulfillment: FulfillmentView | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [releaseReason, setReleaseReason] = React.useState("");
  const [cancelReason, setCancelReason] = React.useState(CANCEL_REASONS[0].value);
  const [cancelNote, setCancelNote] = React.useState("");

  const payment = fulfillment?.payment ?? null;
  const delivery = fulfillment?.delivery ?? null;
  if (!payment) return null;

  const releasable =
    payment.staleProviderHold || payment.paymentState === "authorized";
  const refund = refundControlsFor(payment);
  const cancellable =
    delivery != null &&
    ["scheduled", "assigned", "en_route_to_pickup", "at_pickup", "picked_up", "in_transit", "at_dropoff"].includes(
      delivery.fulfillmentState
    );

  async function run(action: () => Promise<{ ok: boolean } & Record<string, any>>, done: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const r = await action();
    setBusy(false);
    if (isApiFailure(r as any)) {
      setError(withReference(r as any));
      return;
    }
    setNotice(done);
    onChanged();
  }

  return (
    <Card>
      <CardHeader
        title="Payment evidence and recovery"
        description="What the payer approved, when the provider says they approved it, and the governed ways back."
      />
      <Stack gap={4}>
        {error ? <ErrorState title="That could not be completed" body={error} /> : null}
        {notice ? <Alert tone="success" title={notice} /> : null}

        <Grid columns={3}>
          <Detail
            label="Authorized"
            value={payment.authorizedAt ? new Date(payment.authorizedAt).toLocaleString() : "—"}
          />
          <Detail
            label="Authorization source"
            value={
              payment.authorizedAtSource === "provider_event"
                ? "Provider-verified instant"
                : payment.authorizedAtSource === "processing_fallback"
                  ? "Processing time (provider instant unknown)"
                  : "—"
            }
          />
          <Detail
            label="Processed"
            value={
              payment.authorizationProcessedAt
                ? new Date(payment.authorizationProcessedAt).toLocaleString()
                : "—"
            }
          />
          <Detail
            label="Captured"
            value={payment.capturedAmountCents != null ? formatCents(payment.capturedAmountCents) : "—"}
          />
          <Detail
            label="Refunded"
            value={payment.refundedAmountCents != null ? formatCents(payment.refundedAmountCents) : "—"}
          />
          <Detail label="Payment state" value={payment.paymentState.replace(/_/g, " ")} />
        </Grid>

        {payment.staleProviderHold ? (
          <Alert tone="warning" title="Stale provider hold">
            The payment provider is holding {formatCents(payment.amountCents)} but Couranr never
            authorized it commercially (the quote was stale or the details did not match).
            Release the hold so the payer&apos;s money is freed.
          </Alert>
        ) : null}

        {releasable ? (
          <Stack gap={2}>
            <Field label="Why is this hold being released?" required>
              {(a) => (
                <Input
                  {...a}
                  value={releaseReason}
                  onChange={(e) => setReleaseReason(e.target.value)}
                  placeholder="e.g. stale quote — payer will re-authorize"
                />
              )}
            </Field>
            <Cluster gap={2}>
              <Button
                disabled={busy || !releaseReason.trim()}
                onClick={() =>
                  run(
                    () => releaseHoldFromBrowser({ id: request.id, reason: releaseReason.trim() }),
                    "The hold was released at the provider and recorded."
                  )
                }
              >
                Release the hold
              </Button>
            </Cluster>
          </Stack>
        ) : null}

        {refund.settled ? (
          <Alert tone="success" title="Refund settled">
            {formatCents(refund.settled.refundedCents)} was refunded to the payer
            {refund.settled.retainedCents > 0
              ? ` and Couranr retained ${formatCents(refund.settled.retainedCents)} under CAN-001.`
              : "."}{" "}
            One refund chain settles a payment; there is nothing further to refund here.
          </Alert>
        ) : null}

        {refund.showReconcile ? (
          <Stack gap={2}>
            <Alert tone="warning" title="Refund outcome not yet confirmed">
              A refund attempt is recorded but the provider&apos;s answer is not.
              Reconcile reads the provider&apos;s own records and converges — it
              never creates a second refund on its own.
            </Alert>
            <Cluster gap={2}>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  run(
                    () => reconcileRefundFromBrowser({ id: request.id }),
                    "The refund converged with the provider's record."
                  )
                }
              >
                Reconcile refund
              </Button>
            </Cluster>
          </Stack>
        ) : null}

        {refund.showFullRefund ? (
          <Stack gap={2}>
            <Text muted size="sm">
              The standalone refund refunds the captured amount in full. Cancellation
              retentions are derived from the delivery&apos;s stage by the Cancel action —
              never chosen here. There is no amount field.
            </Text>
            <Cluster gap={2}>
              <Button
                disabled={busy}
                onClick={() =>
                  run(
                    () => refundFromBrowser({ id: request.id }),
                    "The refund settled with the provider and was recorded."
                  )
                }
              >
                Refund in full
              </Button>
            </Cluster>
          </Stack>
        ) : null}

        {cancellable ? (
          <Stack gap={2}>
            <Field label="Cancel this delivery" hint="Composes the governed commands: the delivery closes, and money comes back per CAN-001 from the delivery's STORED stage.">
              {(a) => (
                <Select {...a} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}>
                  {CANCEL_REASONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              label="What happened?"
              required
              hint="Recorded in the delivery's audit trail. For a delivery whose goods were already picked up, say how the goods were physically resolved."
            >
              {(a) => (
                <Input
                  {...a}
                  value={cancelNote}
                  onChange={(e) => setCancelNote(e.target.value)}
                  maxLength={500}
                  placeholder="e.g. customer cancelled before the driver left"
                />
              )}
            </Field>
            <Cluster gap={2}>
              <Button
                variant="destructive"
                disabled={busy || !cancelNote.trim()}
                onClick={() =>
                  run(
                    () =>
                      cancelDeliveryFromBrowser({
                        id: request.id,
                        reason: cancelReason,
                        note: cancelNote.trim(),
                      }),
                    "The delivery was closed and the governed money recovery ran."
                  )
                }
              >
                Cancel delivery
              </Button>
            </Cluster>
          </Stack>
        ) : null}
      </Stack>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <Stack gap={1}>
      <Text muted size="sm">
        {label}
      </Text>
      <Text>{value}</Text>
    </Stack>
  );
}

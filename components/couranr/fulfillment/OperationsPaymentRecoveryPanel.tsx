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
 * OPS-003 — payment evidence and recovery (batch 3 §E).
 *
 * Everything here is EXPLICIT AND NARROW: release takes a reason, refunds take
 * one of four governed reasons whose amounts the database derives (CAN-001),
 * cancellation composes the same commands. There is no amount field, no state
 * dropdown, and nothing that could move money outside a named command.
 */

const REFUND_ACTIONS = [
  { value: "full_refund", label: "Full refund" },
  { value: "cancel_after_confirmation_before_arrival", label: "Cancellation refund (Couranr keeps $8.00)" },
  { value: "failed_pickup_after_arrival", label: "Failed-pickup refund (Couranr keeps $15.00)" },
  { value: "couranr_caused_failure", label: "Couranr-caused failure ($0 kept)" },
];

const CANCEL_REASONS = [
  { value: "merchant_request", label: "Merchant asked to cancel" },
  { value: "customer_request", label: "Customer asked to cancel" },
  { value: "couranr_caused", label: "Couranr caused the failure" },
  { value: "failed_pickup", label: "Driver arrived; pickup cannot occur" },
];

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
  const [refundReason, setRefundReason] = React.useState(REFUND_ACTIONS[0].value);
  const [cancelReason, setCancelReason] = React.useState(CANCEL_REASONS[0].value);

  const payment = fulfillment?.payment ?? null;
  const delivery = fulfillment?.delivery ?? null;
  if (!payment) return null;

  const releasable =
    payment.staleProviderHold || payment.paymentState === "authorized";
  const refundable =
    payment.paymentState === "captured" || payment.paymentState === "refunded";
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

        {refundable ? (
          <Stack gap={2}>
            <Field label="Governed refund" hint="The amount is derived by Couranr from the captured amount and CAN-001. There is no amount field.">
              {(a) => (
                <Select {...a} value={refundReason} onChange={(e) => setRefundReason(e.target.value)}>
                  {REFUND_ACTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Cluster gap={2}>
              <Button
                disabled={busy}
                onClick={() =>
                  run(
                    () => refundFromBrowser({ id: request.id, reason: refundReason }),
                    "The refund settled with the provider and was recorded."
                  )
                }
              >
                Refund
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  run(
                    () => reconcileRefundFromBrowser({ id: request.id }),
                    "The refund converged with the provider&apos;s record."
                  )
                }
              >
                Reconcile refund
              </Button>
            </Cluster>
          </Stack>
        ) : null}

        {cancellable ? (
          <Stack gap={2}>
            <Field label="Cancel this delivery" hint="Composes the governed commands: the delivery closes, and money comes back per CAN-001.">
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
            <Cluster gap={2}>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() =>
                  run(
                    () => cancelDeliveryFromBrowser({ id: request.id, reason: cancelReason }),
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

"use client";

import * as React from "react";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Cluster,
  Stack,
  Text,
} from "@/components/couranr/primitives";
import { Field, Select, Textarea } from "@/components/couranr/forms";
import { ConflictState, ErrorState } from "@/components/couranr/states";
import {
  acceptAsQuoted,
  declineRequest,
  isApiFailure,
  requoteRequest,
  withReference,
  type ApiFailure,
} from "./client";
import {
  DECLINE_MERCHANT_MESSAGE,
  DECLINE_REASONS,
  declineRequiresInternalNote,
  type DeclineReason,
} from "@/lib/couranr/requests/states";
import { formatCents, type DeliveryRequestView } from "@/lib/couranr/requests/view";

/**
 * OPS-003 — the three ways a Couranr review ends (REV-001).
 *
 * There is no status dropdown here and no price field. Each button is a named
 * server command; the server decides both the amount and the resulting state.
 * That is the repo rule ("no route accepts an arbitrary target status") applied
 * to the screen: an operator picks a DECISION, never a destination.
 *
 * Confirming does not authorize or capture payment and creates no order and no
 * delivery. The copy says so, because "Confirmed" is otherwise very easy to
 * read as "paid and dispatched".
 */

/**
 * What the OPERATOR picks — a cause, in Couranr's own words.
 *
 * Deliberately different strings from `DECLINE_MERCHANT_MESSAGE`, which is
 * what the merchant is told. The two audiences need different sentences, and
 * the panel shows both so an operator can see the consequence of the code
 * they are choosing before they commit to it.
 */
const DECLINE_REASON_LABELS: Record<DeclineReason, string> = {
  outside_service_area: "Outside the Couranr service area",
  requested_time_unavailable: "Requested delivery time unavailable",
  no_driver_available: "No driver available",
  no_compatible_vehicle: "No compatible vehicle",
  shipment_not_supported: "Shipment not supported",
  merchant_account_on_hold: "Business account on hold",
  duplicate_or_superseded: "Duplicate or superseded by another request",
  other: "Another reason",
};

type Outcome = "accept" | "requote" | "decline";

export function ReviewOutcomeActions({
  request,
  onUpdated,
}: {
  request: DeliveryRequestView;
  onUpdated: (next: DeliveryRequestView) => void;
}) {
  const [open, setOpen] = React.useState<Outcome | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<ApiFailure | null>(null);
  const [requoteReason, setRequoteReason] = React.useState("");
  const [declineReason, setDeclineReason] = React.useState<DeclineReason>("outside_service_area");
  const [declineNote, setDeclineNote] = React.useState("");

  // Every outcome starts from the same place. Once the request has left it,
  // the decision has already been made and the panel says so instead of
  // offering buttons that would come back as a conflict.
  if (request.requestState !== "pending_couranr_review") {
    return null;
  }

  async function run(kind: Outcome) {
    setBusy(true);
    setFailure(null);

    const r =
      kind === "accept"
        ? await acceptAsQuoted({ id: request.id, expectedVersion: request.version })
        : kind === "requote"
          ? await requoteRequest({
              id: request.id,
              expectedVersion: request.version,
              reason: requoteReason,
            })
          : await declineRequest({
              id: request.id,
              expectedVersion: request.version,
              reason: declineReason,
              internalNote: declineNote,
            });

    setBusy(false);
    if (isApiFailure(r)) {
      setFailure(r);
      return;
    }
    setOpen(null);
    setRequoteReason("");
    setDeclineNote("");
    onUpdated(r.value.request);
  }

  const merchantPays = request.payerType === "merchant";
  const operationsAssistedMerchant = merchantPays && request.source === "operations";
  const priced = request.quote.status === "estimated" && request.quote.deliverySubtotalCents !== null;

  return (
    <Card>
      <CardHeader
        title="Couranr review decision"
        description="Confirming records that Couranr accepted this request at the quoted price. It takes no payment and creates no delivery."
      />

      <Stack gap={4}>
        {/*
          Only a REAL concurrency conflict gets the reload affordance.
          `conflict` (CR412) means the acknowledgment is missing or the quote
          moved — reloading does nothing for either, so showing "reload and
          try again" would loop the operator indefinitely.
        */}
        {failure?.code === "version_conflict" ? (
          <ConflictState />
        ) : failure ? (
          <ErrorState
            title={
              failure.code === "conflict"
                ? "This request needs the payer's approval"
                : failure.code === "quote_expired"
                  ? "Refresh the quote before asking the business to approve"
                  : "This decision was not recorded"
            }
            body={withReference(failure)}
          />
        ) : null}

        {!priced ? (
          <Alert tone="warning" title="This request has no automatic estimate">
            Couranr cannot confirm a price that was never calculated. Send a revised quote or
            record that Couranr could not confirm service.
          </Alert>
        ) : (
          <Text size="sm" muted>
            {operationsAssistedMerchant
              ? `Couranr entered this request for the business. Confirming service accepts ${formatCents(
                  request.quote.deliverySubtotalCents
                )} as Couranr's quote, but it does not approve the price for the business. The request will wait for the business to authorize the amount.`
              : merchantPays
                ? `Confirming accepts ${formatCents(
                    request.quote.deliverySubtotalCents
                  )} as quoted. The business is paying and approved this estimate at submission, so no further approval is requested.`
                : `Confirming accepts ${formatCents(
                    request.quote.deliverySubtotalCents
                  )} as quoted. The customer is paying, so the request waits for the customer to approve the price.`}
          </Text>
        )}

        {open === null ? (
          <Cluster gap={3}>
            <Button
              variant="primary"
              loading={busy}
              disabled={!priced}
              onClick={() => run("accept")}
            >
              {operationsAssistedMerchant
                ? "Confirm service & request business approval"
                : "Confirm as quoted"}
            </Button>
            <Button variant="secondary" onClick={() => setOpen("requote")} disabled={busy}>
              Send revised quote
            </Button>
            <Button variant="ghost" onClick={() => setOpen("decline")} disabled={busy}>
              Could not confirm service
            </Button>
          </Cluster>
        ) : null}

        {open === "requote" ? (
          <Stack gap={3}>
            <Alert tone="info" title="Couranr recalculates the price">
              The revised amount is recomputed by Couranr from this request&rsquo;s shipment
              details. There is no field to type an amount into.
            </Alert>
            <Field
              label="Why is the quote being revised?"
              hint="The business sees that this request needs a new approval; this reason is recorded with the change."
              required
            >
              {(a) => (
                <Textarea
                  {...a}
                  value={requoteReason}
                  onChange={(e) => setRequoteReason(e.target.value)}
                  rows={3}
                  maxLength={500}
                />
              )}
            </Field>
            <Cluster gap={3}>
              <Button
                variant="primary"
                loading={busy}
                disabled={requoteReason.trim().length === 0}
                onClick={() => run("requote")}
              >
                Send revised quote
              </Button>
              <Button variant="ghost" onClick={() => setOpen(null)} disabled={busy}>
                Cancel
              </Button>
            </Cluster>
          </Stack>
        ) : null}

        {open === "decline" ? (
          <Stack gap={3}>
            <Field label="Reason Couranr could not confirm service" required>
              {(a) => (
                <Select
                  {...a}
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value as DeclineReason)}
                >
                  {DECLINE_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {DECLINE_REASON_LABELS[r]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Alert tone="info" title="The business will be told">
              {DECLINE_MERCHANT_MESSAGE[declineReason]}
            </Alert>
            <Field
              label="Internal note"
              hint="Recorded for Couranr Operations. Never shown to the business or the recipient."
              required={declineRequiresInternalNote(declineReason)}
            >
              {(a) => (
                <Textarea
                  {...a}
                  value={declineNote}
                  onChange={(e) => setDeclineNote(e.target.value)}
                  rows={3}
                  maxLength={1000}
                />
              )}
            </Field>
            <Cluster gap={3}>
              <Button
                variant="primary"
                loading={busy}
                disabled={
                  declineRequiresInternalNote(declineReason) && declineNote.trim().length === 0
                }
                onClick={() => run("decline")}
              >
                Record that Couranr could not confirm
              </Button>
              <Button variant="ghost" onClick={() => setOpen(null)} disabled={busy}>
                Cancel
              </Button>
            </Cluster>
          </Stack>
        ) : null}
      </Stack>
    </Card>
  );
}

"use client";

import * as React from "react";
import { Alert, Button, Card, CardHeader, Grid, Stack, Text } from "@/components/couranr/primitives";
import { Field, Input, Textarea } from "@/components/couranr/forms";
import { ErrorState } from "@/components/couranr/states";
import { formatCents, type DeliveryRequestView } from "@/lib/couranr/requests/view";
import { isApiFailure, withReference } from "@/components/couranr/requests/client";
import { applyPromotionalCreditFromBrowser, type FulfillmentView } from "./client";

function marketDefault(address: unknown): string {
  if (!address || typeof address !== "object") return "internal-pilot";
  const a = address as Record<string, unknown>;
  const city = typeof a.city === "string" ? a.city.trim() : "";
  const region = typeof a.region === "string" ? a.region.trim() : "";
  return [city, region].filter(Boolean).join(", ") || "internal-pilot";
}

/**
 * OPS-004 — governed Couranr promotional credit.
 *
 * This is NOT a fake payment button. Operations records Couranr funding against
 * the server's exact current quote; no amount, payment state or target request
 * state is editable in the browser. Stripe is never called by this command.
 */
export function OperationsPilotCreditPanel({
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
  const [reason, setReason] = React.useState("Controlled E2E test");
  const [campaign, setCampaign] = React.useState("internal-e2e");
  const [market, setMarket] = React.useState(() => marketDefault(request.pickupAddress));
  const [category, setCategory] = React.useState(
    request.restrictedClass && request.restrictedClass !== "none"
      ? request.restrictedClass
      : "general-delivery"
  );

  const paymentState = fulfillment?.payment?.paymentState ?? null;
  const paymentCommitted = new Set([
    "authorized",
    "capture_pending",
    "captured",
    "partially_refunded",
    "refunded",
  ]).has(paymentState ?? "");

  const eligible =
    request.requesterKind === "business" &&
    request.businessAccountId !== null &&
    request.payerType === "merchant" &&
    (request.source === "operations" || request.source === "merchant_portal") &&
    ["quote_revision_required", "awaiting_quote_acceptance", "confirmed"].includes(
      request.requestState
    ) &&
    request.quote.status === "estimated" &&
    request.quote.deliverySubtotalCents !== null &&
    !fulfillment?.promotionalCredit &&
    !paymentCommitted &&
    !fulfillment?.delivery;

  if (!eligible) return null;

  async function apply() {
    setBusy(true);
    setError(null);
    const result = await applyPromotionalCreditFromBrowser({
      id: request.id,
      reason,
      campaign,
      market,
      category,
    });
    setBusy(false);
    if (isApiFailure(result)) {
      setError(withReference(result));
      return;
    }
    onChanged();
  }

  return (
    <Card>
      <CardHeader
        title="Use Couranr pilot/test credit"
        description="For controlled pilots and E2E testing. Couranr funds the full stored quote without creating or capturing a card payment."
      />
      <Stack gap={4}>
        <Alert tone="info" title={`Full credit: ${formatCents(request.quote.deliverySubtotalCents)}`}>
          The standard quote stays unchanged. Couranr records a separate promotional-credit
          expense with the reason, campaign, market, category and approving Operations user.
        </Alert>

        {error ? <ErrorState title="The credit could not be applied" body={error} /> : null}

        <Grid columns={2}>
          <Field label="Campaign" required>
            {(a) => (
              <Input
                {...a}
                maxLength={120}
                value={campaign}
                onChange={(e) => setCampaign(e.target.value)}
              />
            )}
          </Field>
          <Field label="Market" required>
            {(a) => (
              <Input
                {...a}
                maxLength={120}
                value={market}
                onChange={(e) => setMarket(e.target.value)}
              />
            )}
          </Field>
          <Field label="Category" required>
            {(a) => (
              <Input
                {...a}
                maxLength={120}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            )}
          </Field>
        </Grid>

        <Field
          label="Reason"
          required
          hint="This becomes immutable commercial audit evidence."
        >
          {(a) => (
            <Textarea
              {...a}
              rows={2}
              maxLength={160}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>

        <Text size="xs" muted>
          Applying this does not overwrite the quote, mark Stripe paid, or give the browser
          control of an amount. Couranr reads and credits the current quote on the server.
        </Text>

        <div>
          <Button
            variant="primary"
            loading={busy}
            disabled={
              busy ||
              !reason.trim() ||
              !campaign.trim() ||
              !market.trim() ||
              !category.trim()
            }
            onClick={apply}
          >
            Apply full {formatCents(request.quote.deliverySubtotalCents)} Couranr credit
          </Button>
        </div>
      </Stack>
    </Card>
  );
}

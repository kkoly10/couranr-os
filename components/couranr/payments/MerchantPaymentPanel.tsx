"use client";

import * as React from "react";
import { Alert, Badge, Button, Card, CardHeader, Stack, Text } from "@/components/couranr/primitives";
import { ErrorState } from "@/components/couranr/states";
import { formatCents, type DeliveryRequestView } from "@/lib/couranr/requests/view";

/**
 * MER-007 — payment state, and the merchant's authorization action.
 *
 * Shown only for a MERCHANT-PAID request. A customer-paid delivery is not the
 * merchant's to authorize, so this panel renders the waiting state instead of
 * a button that would 403.
 *
 * The copy carries the whole point of manual capture: authorizing HOLDS the
 * amount, it does not take it. "Charged" never appears here.
 */

const AUTHORIZE_COPY =
  "This authorizes the delivery amount. Couranr captures payment only after the delivery is confirmed for service.";

type PaymentView = {
  id: string;
  amountCents: number;
  currency: string;
  paymentState: string;
  payerType: string;
};

const STATE_BADGE: Record<string, { tone: "neutral" | "info" | "success" | "warning" | "danger"; label: string }> = {
  not_started: { tone: "neutral", label: "Not authorized" },
  requires_action: { tone: "warning", label: "Awaiting authorization" },
  authorized: { tone: "success", label: "Authorized" },
  failed: { tone: "danger", label: "Authorization failed" },
  cancelled: { tone: "neutral", label: "Cancelled" },
};

export function MerchantPaymentPanel({
  request,
  businessAccountId,
}: {
  request: DeliveryRequestView;
  businessAccountId: string | null;
}) {
  const [payment, setPayment] = React.useState<PaymentView | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [clientSecret, setClientSecret] = React.useState<string | null>(null);

  // Only these states have anything to pay for.
  const payable =
    request.requestState === "confirmed" ||
    request.requestState === "awaiting_quote_acceptance" ||
    request.requestState === "quote_revision_required";

  if (!payable) return null;

  const merchantPays = request.payerType === "merchant";

  async function authorize() {
    if (!businessAccountId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/couranr/delivery-requests/${request.id}/authorize-payment`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          // No amount. There is no field for one, and the server would ignore it.
          body: JSON.stringify({ businessAccountId }),
        }
      );
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error ?? "Payment could not be set up.");
        return;
      }
      setPayment(body.obligation as PaymentView);
      setClientSecret(body.clientSecret ?? null);
    } catch {
      setError("We could not reach Couranr. Nothing was charged.");
    } finally {
      setBusy(false);
    }
  }

  const state = payment?.paymentState ?? "not_started";
  const badge = STATE_BADGE[state] ?? STATE_BADGE.not_started;

  return (
    <Card>
      <CardHeader
        title="Payment"
        description={
          merchantPays
            ? "Your business is paying for this delivery."
            : "The recipient is paying for this delivery."
        }
        actions={<Badge tone={badge.tone}>{badge.label}</Badge>}
      />

      <Stack gap={3}>
        <div>
          <Text size="xs" muted>
            Amount
          </Text>
          <Text strong>{formatCents(request.quote.deliverySubtotalCents)}</Text>
        </div>

        {error ? <ErrorState title="This could not be started" body={error} /> : null}

        {state === "authorized" ? (
          <Alert tone="success" title="Payment authorized">
            Couranr captures this amount only after the delivery is confirmed for service.
            Nothing has been taken yet.
          </Alert>
        ) : null}

        {!merchantPays ? (
          <Alert tone="info" title="Waiting for the recipient">
            Couranr sends the recipient a secure payment link. This delivery is scheduled once
            they authorize the amount.
          </Alert>
        ) : state === "authorized" ? null : clientSecret ? (
          <Stack gap={3}>
            {/* The Payment Element mounts against the client secret alone. */}
            <div data-couranr-payment-element data-client-secret="present" />
            <Text size="xs" muted>
              {AUTHORIZE_COPY}
            </Text>
          </Stack>
        ) : (
          <Stack gap={3}>
            <Alert tone="info" title="Couranr does not take payment yet">
              {AUTHORIZE_COPY}
            </Alert>
            <Button variant="primary" loading={busy} onClick={authorize}>
              Authorize {formatCents(request.quote.deliverySubtotalCents)}
            </Button>
          </Stack>
        )}
      </Stack>
    </Card>
  );
}

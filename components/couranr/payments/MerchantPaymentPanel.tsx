"use client";

import * as React from "react";
import { Alert, Badge, Button, Card, CardHeader, Stack, Text } from "@/components/couranr/primitives";
import { ErrorState } from "@/components/couranr/states";
import { formatCents, type DeliveryRequestView } from "@/lib/couranr/requests/view";
import { CouranrPaymentElement } from "./CouranrPaymentElement";
import { call, isApiFailure } from "@/components/couranr/requests/client";

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
    // Through the shared caller, which attaches the Bearer token every
    // canonical route resolves its actor from. No amount is sent: there is no
    // field for one, and the server reads the price off the request.
    const r = await call<{ obligation: PaymentView; clientSecret: string }>(
      `/api/couranr/delivery-requests/${request.id}/authorize-payment`,
      { method: "POST", body: { businessAccountId } }
    );
    setBusy(false);
    if (isApiFailure(r)) {
      setError(r.error ?? "Payment could not be set up.");
      return;
    }
    setPayment(r.value.obligation);
    setClientSecret(r.value.clientSecret ?? null);
  }

  /**
   * Ask the SERVER whether the merchant's payment really authorized.
   *
   * Handed to the Payment Element and called only after confirmation
   * succeeds. Carries the business account so the route can scope it; carries
   * no state, no amount and no PaymentIntent id, because none of those would
   * be believed.
   */
  async function reconcileWithServer() {
    const r = await call<{ outcome: string; paymentState: string; requestState: string }>(
      `/api/couranr/delivery-requests/${request.id}/reconcile-payment`,
      { method: "POST", body: { businessAccountId } }
    );
    // A failure is not an authorization. The Element treats "not authorized"
    // as "not yet", which is the correct, fail-closed reading.
    return isApiFailure(r) ? { paymentState: null } : r.value;
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
          /*
            The SAME component the customer link uses. Only the reconcile
            endpoint differs — this one is authenticated and scoped to the
            business account, so a merchant cannot reconcile another
            merchant's delivery.
          */
          <CouranrPaymentElement
            clientSecret={clientSecret}
            amountCents={payment?.amountCents ?? request.quote.deliverySubtotalCents ?? 0}
            reconcile={reconcileWithServer}
            onAuthorized={() =>
              setPayment((p) => (p ? { ...p, paymentState: "authorized" } : p))
            }
          />
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

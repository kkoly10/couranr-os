"use client";

import * as React from "react";
import { Alert, Badge, Button, Card, CardHeader, Cluster, Stack, Text } from "@/components/couranr/primitives";
import { ErrorState } from "@/components/couranr/states";
import { formatCents, type DeliveryRequestView } from "@/lib/couranr/requests/view";
import { CouranrPaymentElement } from "./CouranrPaymentElement";
import { call, isApiFailure } from "@/components/couranr/requests/client";
import { Input } from "@/components/couranr/forms";

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
  canManage = true,
}: {
  request: DeliveryRequestView;
  businessAccountId: string | null;
  canManage?: boolean;
}) {
  const [payment, setPayment] = React.useState<PaymentView | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [clientSecret, setClientSecret] = React.useState<string | null>(null);
  const [customerLink, setCustomerLink] = React.useState<{
    url: string;
    expiresAt: string;
  } | null>(null);
  const [linkCopied, setLinkCopied] = React.useState(false);

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

  /**
   * Customer-paid flow.
   *
   * The token is returned by the server ONCE and is intentionally not
   * recoverable later. We keep the resulting URL only in this component's
   * memory; generating another link supersedes the previous token.
   */
  async function createCustomerPaymentLink() {
    if (!businessAccountId) return;
    setBusy(true);
    setError(null);
    setLinkCopied(false);

    const r = await call<{ token: string; expiresAt: string }>(
      `/api/couranr/delivery-requests/${request.id}/payment-link`,
      { method: "POST", body: { businessAccountId } }
    );

    setBusy(false);
    if (isApiFailure(r)) {
      setError(r.error ?? "A payment link could not be created.");
      return;
    }

    const token = String(r.value.token ?? "");
    if (!token) {
      setError("A payment link could not be created.");
      return;
    }

    const origin = typeof window === "undefined" ? "" : window.location.origin;
    const url = origin
      ? new URL(`/pay/${encodeURIComponent(token)}`, origin).toString()
      : `/pay/${encodeURIComponent(token)}`;

    setCustomerLink({ url, expiresAt: String(r.value.expiresAt ?? "") });
  }

  async function copyCustomerPaymentLink() {
    if (!customerLink) return;
    setLinkCopied(false);
    try {
      await navigator.clipboard.writeText(customerLink.url);
      setLinkCopied(true);
    } catch {
      setError("Copy failed. Select the payment link and copy it manually.");
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

        {!canManage ? (
          <Alert tone="info" title="Payment controls are read only">
            An owner, manager, or dispatcher must authorize business-paid delivery or create a customer payment link.
          </Alert>
        ) : null}

        {error ? <ErrorState title="This could not be started" body={error} /> : null}

        {state === "authorized" ? (
          <Alert tone="success" title="Payment authorized">
            Couranr captures this amount only after the delivery is confirmed for service.
            Nothing has been taken yet.
          </Alert>
        ) : null}

        {canManage && !merchantPays ? (
          <Stack gap={3}>
            <Alert tone="info" title="Customer payment">
              Create a secure payment link and send it to your customer. Couranr schedules the
              delivery only after the customer authorizes the delivery amount.
            </Alert>

            {customerLink ? (
              <Stack gap={2}>
                <Input
                  aria-label="Customer payment link"
                  value={customerLink.url}
                  readOnly
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Cluster gap={2}>
                  <Button variant="primary" type="button" onClick={copyCustomerPaymentLink}>
                    Copy payment link
                  </Button>
                  <Button
                    variant="secondary"
                    type="button"
                    loading={busy}
                    onClick={createCustomerPaymentLink}
                  >
                    Replace link
                  </Button>
                </Cluster>
                {linkCopied ? (
                  <Alert tone="success" title="Payment link copied">
                    Send it directly to your customer. Couranr never puts merchandise charges on
                    this payment page.
                  </Alert>
                ) : null}
                <Text size="xs" muted>
                  For security, Couranr does not show this raw link again after you leave this
                  page. Replacing it immediately disables the previous link.
                </Text>
              </Stack>
            ) : (
              <Button
                variant="primary"
                type="button"
                loading={busy}
                onClick={createCustomerPaymentLink}
              >
                Create secure payment link
              </Button>
            )}
          </Stack>
        ) : !canManage ? null : state === "authorized" ? null : clientSecret ? (
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

"use client";

import * as React from "react";
import { Alert, Badge, Button, Card, CardHeader, Cluster, Stack, Text } from "@/components/couranr/primitives";
import { ErrorState } from "@/components/couranr/states";
import { formatCents, type DeliveryRequestView } from "@/lib/couranr/requests/view";
import { canChangeReadiness, READINESS_COMMANDS, type ReadinessState } from "@/lib/couranr/requests/states";
import {
  issuePaymentLinkFromBrowser,
  setReadinessFromBrowser,
  type FulfillmentView,
} from "./client";
import { isApiFailure, withReference } from "@/components/couranr/requests/client";

/**
 * MER-007 readiness, and the scheduled result once Couranr has captured.
 *
 * The merchant marks themselves ready HERE — no second page, no extra
 * navigation — because "Ready for Couranr" is the single action this screen
 * exists to make easy.
 *
 * Only transitions the owner-approved graph allows are offered. An action the
 * graph forbids is not rendered disabled with a tooltip; it is simply not
 * there, so the screen can never suggest something the server will refuse.
 */

export const READINESS_LABEL: Record<string, string> = {
  not_confirmed: "Not confirmed",
  preparing: "Preparing",
  ready: "Ready for Couranr",
  not_ready: "Not ready",
  unavailable: "Unavailable",
};

export const READINESS_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  not_confirmed: "neutral",
  preparing: "info",
  ready: "success",
  not_ready: "warning",
  unavailable: "danger",
};

export function MerchantReadinessPanel({
  request,
  fulfillment,
  businessAccountId,
  onChanged,
}: {
  request: DeliveryRequestView;
  fulfillment: FulfillmentView | null;
  businessAccountId: string | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  /** Shown once. The raw token is never stored and cannot be re-read. */
  const [issuedLink, setIssuedLink] = React.useState<string | null>(null);

  // Readiness only means anything once Couranr has confirmed the request.
  if (request.requestState !== "confirmed") return null;

  const readiness = (fulfillment?.readinessState ?? "not_confirmed") as ReadinessState;
  const payment = fulfillment?.payment;
  const delivery = fulfillment?.delivery;
  const authorized = payment?.paymentState === "authorized";
  // Once capture starts the answer is frozen — a driver is being planned
  // around it, and the server refuses a change.
  const frozen =
    payment?.paymentState === "capture_pending" ||
    payment?.paymentState === "captured" ||
    Boolean(delivery);

  async function change(to: ReadinessState) {
    if (!businessAccountId) return;
    setBusy(to);
    setError(null);
    const r = await setReadinessFromBrowser({
      id: request.id,
      businessAccountId,
      expectedVersion: request.version,
      readiness: to,
    });
    setBusy(null);
    if (isApiFailure(r)) {
      setError(withReference(r));
      return;
    }
    onChanged();
  }

  /*
   * The provider SETTLED this capture as failed. Verified, not assumed — which
   * is the only reason it is safe to tell a merchant nothing was taken.
   */
  const reauthorizationRequired = payment?.paymentState === "failed" && !delivery;
  const customerPays = payment?.payerType === "customer";

  async function generateLink() {
    if (!businessAccountId) return;
    setBusy("link");
    setError(null);
    const r = await issuePaymentLinkFromBrowser({ id: request.id, businessAccountId });
    setBusy(null);
    if (isApiFailure(r)) {
      setError(withReference(r));
      return;
    }
    setIssuedLink(`${window.location.origin}/pay/${r.value.token}`);
    onChanged();
  }

  return (
    <Card>
      <CardHeader
        title="Preparation"
        description="Tell Couranr when this delivery is ready to collect."
        actions={
          <Badge tone={READINESS_TONE[readiness] ?? "neutral"}>
            {READINESS_LABEL[readiness] ?? readiness}
          </Badge>
        }
      />

      <Stack gap={3}>
        {error ? <ErrorState title="That could not be saved" body={error} /> : null}

        {delivery ? (
          <Alert tone="success" title="Couranr has scheduled this delivery">
            {formatCents(delivery.capturedAmountCents)} was captured and this delivery is
            scheduled for pickup between{" "}
            {new Date(delivery.scheduledPickupStart).toLocaleString()} and{" "}
            {new Date(delivery.scheduledPickupEnd).toLocaleString()} ({delivery.timezone}).
            Couranr will assign a driver.
          </Alert>
        ) : null}

        {reauthorizationRequired ? (
          <Alert
            tone="danger"
            title={
              customerPays
                ? "Customer authorization needs attention"
                : "Payment authorization needs attention"
            }
          >
            The payment provider ended the authorization for this delivery.{" "}
            <strong>Nothing was charged.</strong> Couranr cannot collect or schedule it until
            it is authorized again.
            {customerPays
              ? " Generate a new secure payment link and send it to your recipient — the previous link no longer works."
              : " Authorize again below to put a new hold in place."}
          </Alert>
        ) : null}

        {reauthorizationRequired && customerPays ? (
          <Stack gap={2}>
            <Button
              variant="primary"
              loading={busy === "link"}
              disabled={Boolean(busy)}
              onClick={generateLink}
            >
              Generate new payment link
            </Button>
            {issuedLink ? (
              <Alert tone="info" title="Send this link to your recipient">
                {/*
                  Shown ONCE. Only a SHA-256 hash of the token reaches the
                  database, so Couranr cannot show it again — and issuing this
                  one revoked the previous link.
                */}
                <Text size="sm">{issuedLink}</Text>
                <Text size="xs" muted>
                  Couranr cannot show this again. Generating another link replaces this one.
                </Text>
              </Alert>
            ) : null}
          </Stack>
        ) : null}

        {frozen && !delivery ? (
          <Alert tone="info" title="Couranr is completing this delivery">
            Preparation can no longer be changed while payment is being completed. Contact
            Couranr Support if something has changed.
          </Alert>
        ) : null}

        {!authorized && !frozen ? (
          <Alert tone="info" title="Waiting for payment authorization">
            Couranr can collect this delivery once the payment is authorized.
          </Alert>
        ) : null}

        {!frozen ? (
          <Cluster gap={3}>
            {READINESS_COMMANDS.filter(
              (c) => c.to !== readiness && canChangeReadiness(readiness, c.to)
            ).map((c) => {
              // Ready additionally needs the money held; the server enforces
              // it, and offering the button anyway would just produce a 409.
              const blocked = c.to === "ready" && !authorized;
              if (blocked) return null;
              return (
                <Button
                  key={c.to}
                  variant={c.to === "ready" ? "primary" : "ghost"}
                  loading={busy === c.to}
                  disabled={Boolean(busy)}
                  onClick={() => change(c.to)}
                >
                  {c.to === "ready" ? "Ready for Couranr" : c.label}
                </Button>
              );
            })}
          </Cluster>
        ) : null}

        {payment ? (
          <Text size="xs" muted>
            Payment: {payment.paymentState.replace(/_/g, " ")} ·{" "}
            {formatCents(payment.amountCents)}
          </Text>
        ) : null}
      </Stack>
    </Card>
  );
}

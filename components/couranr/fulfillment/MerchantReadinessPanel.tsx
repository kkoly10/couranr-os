"use client";

import * as React from "react";
import { Alert, Badge, Button, Card, CardHeader, Cluster, Stack, Text } from "@/components/couranr/primitives";
import { ErrorState } from "@/components/couranr/states";
import { formatCents, type DeliveryRequestView } from "@/lib/couranr/requests/view";
import { canChangeReadiness, READINESS_COMMANDS, type ReadinessState } from "@/lib/couranr/requests/states";
import { setReadinessFromBrowser, type FulfillmentView } from "./client";
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

const READINESS_LABEL: Record<string, string> = {
  not_confirmed: "Not confirmed",
  preparing: "Preparing",
  ready: "Ready for Couranr",
  not_ready: "Not ready",
  unavailable: "Unavailable",
};

const READINESS_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
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

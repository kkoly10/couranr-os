"use client";

import * as React from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Alert, Button, Stack, Text } from "@/components/couranr/primitives";
import { formatCents } from "@/lib/couranr/requests/view";
import { confirmCouranrPayment, getStripePromise } from "./CouranrPaymentElement";

/** Same Stripe.js instance and company account as delivery payments; this
 * PaymentIntent is automatic-capture and is not a delivery quote obligation. */
export function DriverTipPaymentElement(props: {
  clientSecret: string;
  amountCents: number;
  onReconcile: () => Promise<"succeeded" | "pending" | "failed">;
}) {
  const promise = getStripePromise();
  if (!promise) return <Alert tone="warning" title="Tips are unavailable">The secure payment form is not configured.</Alert>;
  return <Elements stripe={promise} options={{ clientSecret: props.clientSecret, appearance: { theme: "stripe" } }}>
    <TipForm {...props} />
  </Elements>;
}

function TipForm(props: {
  amountCents: number;
  onReconcile: () => Promise<"succeeded" | "pending" | "failed">;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const busy = React.useRef(false);
  const [phase, setPhase] = React.useState<"ready" | "busy" | "succeeded" | "failed">("ready");
  const [ready, setReady] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy.current || !stripe || !elements) return;
    busy.current = true;
    setPhase("busy");
    setError(null);
    try {
      // Never hand a recipient tracking capability (or sender fragment) to
      // Stripe as return_url. Keep the exact page in same-tab session storage.
      try {
        window.sessionStorage.setItem("couranr-driver-tip-return-v1", window.location.href);
      } catch {
        setError("This browser cannot preserve your delivery link through card verification. Enable session storage and try again.");
        setPhase("failed");
        return;
      }
      const result = await confirmCouranrPayment(
        stripe,
        elements,
        `${window.location.origin}/tip-return`,
      );
      if (result.error) {
        setError(result.error.message ?? "The tip was not charged. Try another payment method.");
        setPhase("failed");
        return;
      }
      const settled = await props.onReconcile();
      if (settled === "succeeded") setPhase("succeeded");
      else {
        setError(settled === "pending"
          ? "Stripe is still processing this tip. Check this page again shortly before retrying."
          : "We could not confirm this tip. Check this page before trying again.");
        setPhase("failed");
      }
    } catch {
      setError("We could not verify the tip. Check this page before trying again.");
      setPhase("failed");
    } finally {
      busy.current = false;
    }
  }

  if (phase === "succeeded") return <Alert tone="success" title="Tip received">
    Couranr received your {formatCents(props.amountCents)} tip for the driver.
  </Alert>;
  return <form onSubmit={submit} data-couranr-driver-tip-payment>
    <Stack gap={3}>
      <PaymentElement onReady={() => setReady(true)} onLoadError={() => {
        setReady(false); setError("The secure payment form could not load."); setPhase("failed");
      }} />
      {error ? <Alert tone="warning" title="Tip not confirmed">{error}</Alert> : null}
      <Text size="xs" muted>
        This is an optional, separate charge to Couranr. The full tip is allocated to your driver
        and paid by Couranr on its payroll schedule. It does not change your delivery price.
      </Text>
      <Button type="submit" disabled={!stripe || !elements || !ready || phase === "busy"}
        loading={phase === "busy"}>
        Pay {formatCents(props.amountCents)} tip
      </Button>
    </Stack>
  </form>;
}

"use client";

import * as React from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { Alert, Button, Stack, Text } from "@/components/couranr/primitives";
import { ErrorState } from "@/components/couranr/states";
import { formatCents } from "@/lib/couranr/requests/view";

/**
 * The one Stripe Payment Element in Couranr.
 *
 * BOTH payer paths use this component — the customer link (PUB-005/CUS-005)
 * and the merchant panel (MER-007). They differ only in which reconcile
 * endpoint they hand in, so there is a single place where card confirmation
 * happens and a single place that can get it wrong.
 *
 * THE RULE THIS COMPONENT EXISTS TO ENFORCE:
 * `stripe.confirmPayment` returning without an error is NOT authorization. It
 * means the browser's part is done. Authorization is a fact about the
 * PaymentIntent that only the server may establish, so this component calls
 * `reconcile()` — which retrieves the intent server-side — and shows the
 * authorized state ONLY when the server says `authorized`. The webhook does
 * the same job independently; whichever lands first wins and the other
 * collides on the event id.
 *
 * `redirect: "if_required"` keeps the flow in place for cards that need no
 * redirect, and still supports the ones that do.
 */

const AUTHORIZE_COPY =
  "This authorizes the delivery amount. Couranr captures payment only after the delivery is confirmed for service.";

/**
 * One `loadStripe` per publishable key for the lifetime of the tab — the
 * script must not be fetched twice, and `Elements` remounts if the promise
 * identity changes.
 */
let stripePromise: Promise<Stripe | null> | null = null;
function getStripePromise(): Promise<Stripe | null> | null {
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!key) return null;
  if (!stripePromise) stripePromise = loadStripe(key);
  return stripePromise;
}

/** What the server said after it re-read the PaymentIntent. */
export type ReconcileResult = {
  outcome?: string;
  paymentState?: string | null;
  requestState?: string | null;
};

export type CouranrPaymentElementProps = {
  clientSecret: string;
  amountCents: number;
  /**
   * Asks the SERVER whether the payment authorized. Takes no arguments on
   * purpose: there is nothing the browser could pass that the server should
   * believe — it resolves the intent from the stored obligation itself.
   */
  reconcile: () => Promise<ReconcileResult>;
  onAuthorized?: (r: ReconcileResult) => void;
  /** Label override; defaults to "Authorize $X.XX". */
  submitLabel?: string;
};

export function CouranrPaymentElement(props: CouranrPaymentElementProps) {
  const promise = getStripePromise();

  // No publishable key configured. Say so plainly rather than rendering an
  // empty box that looks like a slow network.
  if (!promise) {
    return (
      <ErrorState
        title="Card payment is not available right now"
        body="Couranr could not load the payment form. Nothing was charged. Contact Couranr Support if this continues."
      />
    );
  }

  return (
    <Elements
      stripe={promise}
      options={{
        clientSecret: props.clientSecret,
        // No `amount` here. The intent already carries it, so there is no
        // number on this page that a script could change on its way to Stripe.
        appearance: { theme: "stripe" },
      }}
    >
      <PaymentForm {...props} />
    </Elements>
  );
}

type Phase = "ready" | "confirming" | "reconciling" | "authorized" | "error";

export function PaymentForm({
  amountCents,
  reconcile,
  onAuthorized,
  submitLabel,
}: CouranrPaymentElementProps) {
  const stripe = useStripe();
  const elements = useElements();

  const [phase, setPhase] = React.useState<Phase>("ready");
  const [error, setError] = React.useState<string | null>(null);

  /**
   * Guards a second submission while the first is in flight.
   *
   * A ref, not state: two clicks in the same tick would both read the same
   * stale state value and both proceed. The ref is written synchronously
   * before any await, so the second click sees it.
   */
  const inFlight = React.useRef(false);

  const busy = phase === "confirming" || phase === "reconciling";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    if (!stripe || !elements) return;

    inFlight.current = true;
    setError(null);
    setPhase("confirming");

    try {
      const { error: confirmError } = await stripe.confirmPayment({
        elements,
        // Stay on the page when the card allows it; redirect when it does not.
        redirect: "if_required",
      });

      if (confirmError) {
        /*
         * CONFIRMATION FAILED — DO NOT RECONCILE.
         *
         * Nothing was authorized, so asking the server to re-read the intent
         * would at best waste a round trip and at worst make a failed attempt
         * look like an in-progress one. The payer retries instead.
         */
        setError(
          confirmError.message ??
            "That payment could not be completed. Nothing was charged."
        );
        setPhase("error");
        return;
      }

      // The browser's part succeeded. That is a claim, not a fact.
      setPhase("reconciling");
      const result = await reconcile();

      if (result?.paymentState === "authorized") {
        setPhase("authorized");
        onAuthorized?.(result);
        return;
      }

      if (result?.paymentState === "failed") {
        setError("That payment did not go through. You can try again.");
        setPhase("error");
        return;
      }

      /*
       * Confirmed but not yet authorized. Stripe can still be processing, or
       * the card needs a further step. The webhook will land independently, so
       * this is a "not yet", not a failure — and it must NOT show the
       * authorized state.
       */
      setError(
        "Couranr is still confirming this payment. You can close this page — you will be notified once it is authorized."
      );
      setPhase("error");
    } catch {
      setError("We could not reach Couranr. Nothing was charged.");
      setPhase("error");
    } finally {
      inFlight.current = false;
    }
  }

  if (phase === "authorized") {
    return (
      <Alert tone="success" title="Payment authorized">
        {formatCents(amountCents)} is authorized for this delivery. Couranr captures it only
        after the delivery is confirmed for service. Nothing has been taken from your account
        yet.
      </Alert>
    );
  }

  return (
    <form onSubmit={onSubmit} data-couranr-payment-form>
      <Stack gap={3}>
        <PaymentElement />

        {error ? (
          <ErrorState title="That payment could not be completed" body={error} />
        ) : null}

        <Text size="xs" muted>
          {AUTHORIZE_COPY}
        </Text>

        <Button
          type="submit"
          variant="primary"
          loading={busy}
          disabled={busy || !stripe || !elements}
        >
          {phase === "reconciling"
            ? "Confirming with Couranr"
            : (submitLabel ?? `Authorize ${formatCents(amountCents)}`)}
        </Button>
      </Stack>
    </form>
  );
}

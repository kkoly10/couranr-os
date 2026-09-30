"use client";

import * as React from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Alert, Button, Card, CardHeader, Stack, Text } from "@/components/couranr/primitives";
import { CheckboxRow } from "@/components/couranr/forms";
import { call, isApiFailure } from "@/components/couranr/requests/client";
import { getStripePromise } from "@/components/couranr/payments/CouranrPaymentElement";
import { BUSINESS_CARD_CONSENT } from "@/lib/couranr/billing/consent";
import type { BusinessPaymentMethodSummary } from "@/lib/couranr/billing/paymentMethodTypes";

const PATH = "/api/couranr/merchant/billing/payment-method";

function SetupForm(props: {
  businessAccountId: string;
  attemptId: string;
  onSaved: (value: BusinessPaymentMethodSummary) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const busy = React.useRef(false);
  const [ready, setReady] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [working, setWorking] = React.useState(false);

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (busy.current || !stripe || !elements) return;
    busy.current = true;
    setWorking(true);
    setError(null);
    try {
      const returnUrl = new URL("/app/business/settings/billing", window.location.origin);
      returnUrl.searchParams.set("setupBusinessAccountId", props.businessAccountId);
      returnUrl.searchParams.set("setupAttemptId", props.attemptId);
      const result = await stripe.confirmSetup({
        elements,
        confirmParams: { return_url: returnUrl.toString() },
        redirect: "if_required",
      });
      if (result.error) {
        setError(result.error.message ?? "Card confirmation did not complete. Please try again.");
        return;
      }
      // The browser's success is not payment authority. The server retrieves
      // the stored SetupIntent and PaymentMethod from Stripe before saving.
      const verified = await call<{ paymentMethod: BusinessPaymentMethodSummary }>(PATH, {
        method: "POST", body: { businessAccountId: props.businessAccountId,
          action: "complete", attemptId: props.attemptId },
      });
      if (isApiFailure(verified)) {
        setError(verified.error);
        return;
      }
      props.onSaved(verified.value.paymentMethod);
    } catch {
      setError("Couranr could not verify the card. Check this page before trying again.");
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }

  return <form onSubmit={confirm}>
    <Stack gap={3}>
      <PaymentElement onReady={() => setReady(true)} onLoadError={() => {
        setReady(false); setError("The secure card form could not load.");
      }} />
      {error ? <Alert tone="warning" title="Card not saved">{error}</Alert> : null}
      <Button type="submit" variant="primary" disabled={!stripe || !elements || !ready || working}
        loading={working}>Confirm and save card</Button>
    </Stack>
  </form>;
}

export function SavedBusinessCard(props: {
  businessAccountId: string; mayManage: boolean; returnAttemptId?: string | null;
}) {
  const [method, setMethod] = React.useState<BusinessPaymentMethodSummary | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [consent, setConsent] = React.useState(false);
  const [clientSecret, setClientSecret] = React.useState<string | null>(null);
  const [attemptId, setAttemptId] = React.useState<string | null>(props.returnAttemptId ?? null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [working, setWorking] = React.useState(false);
  const busy = React.useRef(false);
  const stripePromise = getStripePromise();

  React.useEffect(() => {
    let active = true;
    async function load() {
      // Redirect completion must not depend on a successful preliminary GET.
      // The attempt ID is a selector only; actor, generation and Stripe
      // identity are checked by the server before anything is saved.
      if (props.mayManage && props.returnAttemptId) {
        const verified = await call<{ paymentMethod: BusinessPaymentMethodSummary }>(PATH, {
          method: "POST", body: { businessAccountId: props.businessAccountId,
            action: "complete", attemptId: props.returnAttemptId },
        });
        if (!active) return;
        if (!isApiFailure(verified)) {
          setMethod(verified.value.paymentMethod);
          setAttemptId(null);
          return;
        }
        setError(verified.error);
      }
      const result = await call<{ paymentMethod: BusinessPaymentMethodSummary }>(
        `${PATH}?businessAccountId=${encodeURIComponent(props.businessAccountId)}`,
      );
      if (!active) return;
      if (isApiFailure(result)) { setError(result.error); return; }
      setMethod(result.value.paymentMethod);
    }
    void load();
    return () => { active = false; };
  }, [props.businessAccountId, props.mayManage, props.returnAttemptId, reloadKey]);

  async function start() {
    if (!consent || busy.current) return;
    busy.current = true;
    setWorking(true);
    setError(null);
    try {
      const result = await call<{ clientSecret: string | null; attemptId: string; alreadyConfirmed: boolean }>(PATH, {
        method: "POST",
        body: { businessAccountId: props.businessAccountId, action: "start", consentAccepted: true },
      });
      if (isApiFailure(result)) setError(result.error);
      else {
        setAttemptId(result.value.attemptId);
        if (result.value.alreadyConfirmed) {
          const verified = await call<{ paymentMethod: BusinessPaymentMethodSummary }>(PATH, {
            method: "POST", body: { businessAccountId: props.businessAccountId,
              action: "complete", attemptId: result.value.attemptId },
          });
          if (isApiFailure(verified)) setError(verified.error);
          else { setMethod(verified.value.paymentMethod); setAttemptId(null); setConsent(false); }
        } else setClientSecret(result.value.clientSecret);
      }
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }

  async function checkSetupStatus() {
    if (busy.current || !attemptId) return;
    busy.current = true;
    setWorking(true);
    setError(null);
    try {
      const result = await call<{ paymentMethod: BusinessPaymentMethodSummary }>(PATH, {
        method: "POST", body: { businessAccountId: props.businessAccountId, action: "complete", attemptId },
      });
      if (isApiFailure(result)) setError(result.error);
      else { setMethod(result.value.paymentMethod); setClientSecret(null); setAttemptId(null); setConsent(false); }
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }

  return <Card>
    <CardHeader title="Business payment method" description="A saved card can be used for a future, separately priced Route Run. It does not book or charge a Route by itself." />
    <Stack gap={3}>
      {error ? <Alert tone="warning" title="Payment method unavailable">{error}</Alert> : null}
      {!method && !error ? <Text>Loading saved card…</Text> : null}
      {!method && error ? <Button onClick={() => { setError(null); setReloadKey((n) => n + 1); }}>
        Retry loading saved card
      </Button> : null}
      {method?.state === "none" ? <Text>No card is saved for this business.</Text> : null}
      {method?.state === "ready" ? <Alert tone="success" title="Card on file">
        {method.brand} ending in {method.last4}. Nothing is charged just by saving a card.
      </Alert> : null}
      {!props.mayManage ? <Text size="sm" muted>Only an owner or manager may save or replace the card.</Text> : null}
      {props.mayManage && method && !clientSecret ? <>
        <CheckboxRow checked={consent} onChange={(event) => setConsent(event.target.checked)}
          label={BUSINESS_CARD_CONSENT} />
        <Button disabled={!consent || !stripePromise || working} loading={working} onClick={start}>
          {method.state === "ready" ? "Replace saved card" : "Add a card"}
        </Button>
        {!stripePromise ? <Text size="sm" muted>The secure card form is not configured.</Text> : null}
      </> : null}
      {props.mayManage && clientSecret && attemptId && stripePromise ? <Elements
        stripe={stripePromise} options={{ clientSecret, appearance: { theme: "stripe" } }}>
        <SetupForm businessAccountId={props.businessAccountId} attemptId={attemptId} onSaved={(saved) => {
          setMethod(saved); setClientSecret(null); setAttemptId(null); setConsent(false);
        }} />
      </Elements> : null}
      {props.mayManage && attemptId ? <Button onClick={checkSetupStatus} disabled={working} loading={working}>
        Check card setup status
      </Button> : null}
    </Stack>
  </Card>;
}

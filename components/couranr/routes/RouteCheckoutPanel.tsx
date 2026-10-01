"use client";

import * as React from "react";
import Link from "next/link";
import { Alert, Button, Card, CardHeader, Stack, Text } from "@/components/couranr/primitives";
import { CheckboxRow } from "@/components/couranr/forms";
import { call, isApiFailure, withReference } from "@/components/couranr/requests/client";
import type { BusinessPaymentMethodSummary } from "@/lib/couranr/billing/paymentMethodTypes";
import type { RouteCheckoutAccess, RouteCheckoutProgress, RouteProgress } from "@/lib/couranr/routeRuns/types";
import { fetchRouteProgress, routeCheckoutAction } from "./client";

type Props = {
  businessAccountId: string; routeRunId: string; acceptedVersion: number;
  stopCount: number; totalCents: number; mayPay: boolean;
};
const money = (cents: number) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD",
}).format(cents / 100);

export function RouteCheckoutPanel(props: Props) {
  const { businessAccountId, routeRunId, mayPay } = props;
  const [progress, setProgress] = React.useState<RouteCheckoutProgress | null>(null);
  const [access, setAccess] = React.useState<RouteCheckoutAccess>({ billingRead: false, authorizeRoute: false });
  const [card, setCard] = React.useState<BusinessPaymentMethodSummary | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [checkoutAvailable, setCheckoutAvailable] = React.useState(false);
  const [consent, setConsent] = React.useState(false);
  const [pickupReady, setPickupReady] = React.useState(false);
  const [working, setWorking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [actionSecret, setActionSecret] = React.useState<string | null>(null);
  const busy = React.useRef(false);
  const responseGeneration = React.useRef(0);
  const checkoutKey = React.useRef(crypto.randomUUID());
  const identity = { businessAccountId: props.businessAccountId, routeRunId: props.routeRunId };

  React.useEffect(() => {
    let active = true;
    const generation = ++responseGeneration.current;
    // A changed workspace/role must not keep the previous billing projection
    // visible while the next permission-scoped GET is in flight.
    setProgress(null);
    setCard(null);
    setActionSecret(null);
    setAccess({ billingRead: false, authorizeRoute: false });
    setCheckoutAvailable(false);
    setLoaded(false);
    void (async () => {
      const status = await fetchRouteProgress({ businessAccountId, routeRunId });
      if (!active || responseGeneration.current !== generation) return;
      if (isApiFailure(status)) setError(withReference(status));
      else {
        setProgress(status.value.progress);
        setAccess(status.value.access);
        setCheckoutAvailable(status.value.checkoutAvailable);
        if (!status.value.access.billingRead) { setCard(null); setActionSecret(null); }
      }
      if (mayPay && !isApiFailure(status) && status.value.access.authorizeRoute &&
          status.value.checkoutAvailable && !status.value.progress) {
        const method = await call<{ paymentMethod: BusinessPaymentMethodSummary }>(
          `/api/couranr/merchant/billing/payment-method?businessAccountId=${encodeURIComponent(businessAccountId)}`,
        );
        if (!active || responseGeneration.current !== generation) return;
        if (isApiFailure(method)) setError(withReference(method));
        else setCard(method.value.paymentMethod);
      }
      setLoaded(true);
    })();
    return () => { active = false; responseGeneration.current++; };
  }, [businessAccountId, routeRunId, mayPay]);

  async function refresh() {
    const generation = ++responseGeneration.current;
    setLoaded(false);
    setProgress(null);
    setCard(null);
    setActionSecret(null);
    setAccess({ billingRead: false, authorizeRoute: false });
    setCheckoutAvailable(false);
    const result = await fetchRouteProgress(props);
    if (responseGeneration.current !== generation) return;
    if (isApiFailure(result)) setError(withReference(result));
    else {
      setProgress(result.value.progress);
      setAccess(result.value.access);
      setCheckoutAvailable(result.value.checkoutAvailable);
      setError(null);
      if (mayPay && result.value.access.authorizeRoute && result.value.checkoutAvailable &&
          !result.value.progress) {
        const method = await call<{ paymentMethod: BusinessPaymentMethodSummary }>(
          `/api/couranr/merchant/billing/payment-method?businessAccountId=${encodeURIComponent(businessAccountId)}`,
        );
        if (responseGeneration.current !== generation) return;
        if (isApiFailure(method)) setError(withReference(method));
        else setCard(method.value.paymentMethod);
      }
    }
    setLoaded(true);
  }

  /** One HTTP step at a time; all money/resource truth is re-read by the server. */
  async function progressUntilInput(initial: RouteProgress & { kind: "billing" }, generation: number) {
    let current = initial;
    for (let count = 0; count < 18 && current.next === "continue" &&
        responseGeneration.current === generation; count++) {
      const before = JSON.stringify(current.settlement);
      const result = await routeCheckoutAction({ ...identity, action: "advance" });
      if (responseGeneration.current !== generation) return;
      if (isApiFailure(result)) { setError(withReference(result)); return; }
      current = result.value.progress;
      setProgress(current);
      if (current.actionClientSecret) setActionSecret(current.actionClientSecret);
      if (JSON.stringify(current.settlement) === before) break;
    }
  }

  async function act(action: "begin" | "advance" | "confirm_pickup_ready") {
    if (!props.mayPay || !access.authorizeRoute || !checkoutAvailable || busy.current) return;
    busy.current = true;
    const generation = ++responseGeneration.current;
    setWorking(true);
    setError(null);
    try {
      const result = await routeCheckoutAction({ ...identity, action,
        ...(action === "begin" ? { expectedVersion: props.acceptedVersion,
          idempotencyKey: checkoutKey.current } : {}),
        ...(action === "confirm_pickup_ready" ? { expectedVersion: props.acceptedVersion } : {}),
      });
      if (responseGeneration.current !== generation) return;
      if (isApiFailure(result)) { setError(withReference(result)); await refresh(); return; }
      setProgress(result.value.progress);
      if (result.value.progress.actionClientSecret) setActionSecret(result.value.progress.actionClientSecret);
      if (result.value.progress.next === "continue") await progressUntilInput(result.value.progress, generation);
    } finally { busy.current = false; setWorking(false); }
  }

  async function authenticateCard() {
    if (!props.mayPay || !access.authorizeRoute || !checkoutAvailable || busy.current) return;
    busy.current = true;
    const generation = ++responseGeneration.current;
    setWorking(true);
    setError(null);
    try {
      let secret = actionSecret;
      if (!secret) {
        const prepared = await routeCheckoutAction({ ...identity, action: "advance" });
        if (responseGeneration.current !== generation) return;
        if (isApiFailure(prepared)) { setError(withReference(prepared)); return; }
        setProgress(prepared.value.progress);
        secret = prepared.value.progress.actionClientSecret ?? null;
      }
      if (!secret) { setError("Couranr could not retrieve this card confirmation. Contact Support."); return; }
      // Stripe's browser package can load its script as a module side effect.
      // A Route detail read must not contact Stripe before explicit checkout.
      const { getStripePromise } = await import("@/components/couranr/payments/CouranrPaymentElement");
      const stripe = await getStripePromise();
      if (!stripe) { setError("Secure card confirmation is unavailable. Contact Support."); return; }
      const confirmed = await stripe.confirmCardPayment(secret);
      if (responseGeneration.current !== generation) return;
      if (confirmed.error) {
        setError(confirmed.error.message ?? "Card authentication did not complete.");
        return;
      }
      // Browser success is not money truth. The server retrieves the SAME
      // PaymentIntent and applies canonical provider evidence before advancing.
      const verified = await routeCheckoutAction({ ...identity, action: "advance" });
      if (responseGeneration.current !== generation) return;
      if (isApiFailure(verified)) { setError(withReference(verified)); return; }
      setActionSecret(null);
      setProgress(verified.value.progress);
      if (verified.value.progress.next === "continue") await progressUntilInput(verified.value.progress, generation);
    } finally { busy.current = false; setWorking(false); }
  }

  const billingProgress = progress?.kind === "billing" ? progress : null;
  const operationalProgress = progress?.kind === "operational" ? progress : null;
  const mayAuthorize = mayPay && access.authorizeRoute && access.billingRead;
  const state = billingProgress?.settlement.state;
  return <Card>
    <CardHeader title="Route checkout" description="Each stop retains its own exact delivery charge and payment record." />
    <Stack gap={3}>
      {error ? <Alert tone="warning" title="Checkout needs attention">{error}</Alert> : null}
      {!loaded ? <Text>Loading Route payment status…</Text> : null}
      {loaded && !checkoutAvailable ? <Alert tone="warning" title="Route checkout is not available yet">
        The accepted stops remain saved, but no Route payment or booking has started. Couranr will enable checkout when shared Route execution is ready.
      </Alert> : null}
      {loaded && !progress ? <>
        {access.billingRead ? <Text><strong>{money(props.totalCents)}</strong> across {props.stopCount} separate delivery estimates.</Text> : null}
        {!mayAuthorize ? <Text size="sm" muted>Route payment has not started.</Text> : null}
        {mayAuthorize && card?.state === "ready" ? <Text>Saved business card: {card.brand} ending in {card.last4}.</Text> : null}
        {checkoutAvailable && mayAuthorize && card?.state !== "ready" ?
          <Alert tone="warning" title="Save a business card first">
            An owner or manager must save a card in <Link href={`/app/business/settings/billing?businessAccountId=${encodeURIComponent(businessAccountId)}`}>Billing</Link> before Route checkout.
          </Alert> : null}
        {checkoutAvailable && mayAuthorize && card?.state === "ready" ? <>
          <CheckboxRow checked={consent} onChange={(event) => setConsent(event.target.checked)}
            label={`I approve authorizing each of the ${props.stopCount} delivery estimates separately on this saved card, totaling ${money(props.totalCents)}. Acceptance alone did not charge the card.`} />
          <Button variant="primary" disabled={!consent || working} loading={working}
            onClick={() => void act("begin")}>Confirm Route checkout</Button>
        </> : null}
      </> : null}
      {billingProgress ? <>
        <Text><strong>{money(billingProgress.settlement.referenceTotalCents)}</strong> on {billingProgress.settlement.card.brand} ending in {billingProgress.settlement.card.last4}.</Text>
        <Text size="sm">Payment status: {state?.replaceAll("_", " ")}.</Text>
        {checkoutAvailable && billingProgress.next === "confirm_pickup_ready" && mayAuthorize ? <>
          <CheckboxRow checked={pickupReady} onChange={(event) => setPickupReady(event.target.checked)}
            label="I confirm that every package in this Route is ready at the common pickup location." />
          <Button variant="primary" disabled={!pickupReady || working} loading={working}
            onClick={() => void act("confirm_pickup_ready")}>Confirm pickup readiness and continue</Button>
        </> : null}
        {checkoutAvailable && billingProgress.next === "authenticate_card" && mayAuthorize ? <Button
          variant="primary" disabled={working} loading={working} onClick={() => void authenticateCard()}>
          Complete secure card authentication
        </Button> : null}
        {checkoutAvailable && billingProgress.next === "continue" && mayAuthorize ? <Button
          variant="primary" disabled={working} loading={working} onClick={() => void act("advance")}>
          Continue Route checkout
        </Button> : null}
        {billingProgress.next === "operations_review" ? <Alert tone="warning" title="Couranr is reviewing this Route">
          Do not start pickup. A payment or resource outcome needs reconciliation before the Route can move.
        </Alert> : null}
        {billingProgress.next === "ready" && billingProgress.execution ? <>
          <Alert tone={billingProgress.execution.state === "exception" ||
            billingProgress.execution.state === "returning" ||
            billingProgress.execution.state === "cancelled" ? "warning" : "success"}
            title={billingProgress.execution.state === "completed" ? "Route completed" :
              billingProgress.execution.state === "cancelled" ? "Route closed" :
              billingProgress.execution.state === "exception" || billingProgress.execution.state === "returning"
                ? "Route needs Operations review" : "Route funded and assigned"}>
            Every stop has its own captured delivery payment. Route status: {billingProgress.execution.state.replaceAll("_", " ")}.
            {billingProgress.execution.state === "completed" ? " All destinations are complete." :
              billingProgress.execution.state === "cancelled" ? " Execution is closed." :
                billingProgress.execution.currentSequence === 0 ? " Common pickup is current." :
                  ` Current destination: Stop ${billingProgress.execution.currentSequence}.`}
            {` Shared resource: ${billingProgress.execution.resourceState.replaceAll("_", " ")}.`}
          </Alert>
          <ol>{billingProgress.execution.stops.map((stop) => <li key={stop.sequence}>
            Stop {stop.sequence}: {stop.fulfillmentState.replaceAll("_", " ")}
          </li>)}</ol>
        </> : null}
      </> : null}
      {operationalProgress ? <>
        <Text>{operationalProgress.status === "payment_pending" ? "Route payment is being prepared." :
          operationalProgress.status === "operations_review" ? "Couranr Operations is reviewing payment." :
            "Route is funded and ready for execution."}</Text>
        {operationalProgress.execution ? <Text size="sm">
          Route status: {operationalProgress.execution.state.replaceAll("_", " ")}.
          {operationalProgress.execution.currentSequence === 0 ? " Common pickup is current." :
            ` Current destination: Stop ${operationalProgress.execution.currentSequence}.`}
          {` Shared resource: ${operationalProgress.execution.resourceState.replaceAll("_", " ")}.`}
        </Text> : null}
      </> : null}
      {loaded ? <Button variant="secondary" disabled={working} onClick={() => void refresh()}>
        Refresh checkout status
      </Button> : null}
      {loaded && !mayAuthorize ? <Text size="sm" muted>Only a business owner or manager can authorize Route payment.</Text> : null}
    </Stack>
  </Card>;
}

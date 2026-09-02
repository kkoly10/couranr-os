"use client";

import * as React from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Stack,
  Text,
} from "@/components/couranr/primitives";
import { CardSkeleton, ErrorState, LoadingState } from "@/components/couranr/states";
import { CouranrLogo } from "@/components/brand/CouranrLogo";
import { CouranrPaymentElement } from "./CouranrPaymentElement";
import { formatCents } from "@/lib/couranr/requests/view";

/**
 * PUB-005 — secure delivery payment, and CUS-005 — revised quote approval.
 *
 * One page: CUS-005 is the same screen with `?mode=requote`, which is exactly
 * how the screen registry describes it. The revised-quote framing is driven by
 * the SERVER's answer (`isRevisedQuote`), not by the query string — a URL
 * cannot talk this page into calling a first quote a revision, or the reverse.
 *
 * THE COPY THIS PAGE MUST GET RIGHT.
 * `capture_method: "manual"` means the amount is HELD, not taken. Saying "your
 * card has been charged" would be false, and it is the single most likely
 * thing to write by accident, so the authorized state says what actually
 * happened and `tests/couranr-payments.test.ts` asserts the word "charged"
 * never appears in a success state.
 */

const AUTHORIZE_COPY =
  "This authorizes the delivery amount. Couranr captures payment only after the delivery is confirmed for service.";

type Quote = {
  valid: true;
  amountCents: number;
  currency: string;
  payerType: string;
  paymentState: string;
  requestState: string;
  isRevisedQuote: boolean;
};

type Refusal = { valid: false; reason: string };

/** Every way a link can be unusable, in the customer's words. */
const REFUSAL_COPY: Record<string, { title: string; body: string }> = {
  not_found: {
    title: "This payment link is not valid",
    body: "Check the link you were sent, or ask the business to send a new one.",
  },
  revoked: {
    title: "This payment link is no longer active",
    body: "A newer link may have replaced it. Ask the business to send the current one.",
  },
  expired: {
    title: "This payment link has expired",
    body: "Payment links are valid for up to seven days. Ask the business for a new one.",
  },
  quote_changed: {
    title: "The price for this delivery has changed",
    body: "This link was for a previous quote. Ask the business to send the updated one.",
  },
  /* QVL-001. Distinct from `expired`, which is the LINK's seven-day TTL, and
     from `quote_changed`, which means a newer quote exists. This one means the
     price itself needs recalculating before anyone can pay it. */
  quote_expired: {
    title: "This estimate is no longer current",
    body: "Delivery estimates are held for 15 minutes. Ask the business to send an up-to-date price.",
  },
  already_authorized: {
    title: "This delivery is already authorized",
    body: "Nothing further is needed. Couranr has what it needs to go ahead.",
  },
  request_not_payable: {
    title: "This delivery is no longer open for payment",
    body: "It may have been cancelled or could not be confirmed. Contact Couranr Support if that is unexpected.",
  },
  no_obligation: {
    title: "This delivery is not ready for payment yet",
    body: "Ask the business to send a new payment link.",
  },
  unavailable: {
    title: "We could not load this payment",
    body: "Something went wrong on our side. Nothing was charged. Try again shortly.",
  },
};

type Phase =
  | "loading"
  | "quote"
  | "preparing"
  | "requires_action"
  | "processing"
  | "authorized"
  | "failed";

export function PaymentLinkPage({ token }: { token: string }) {
  const [quote, setQuote] = React.useState<Quote | null>(null);
  const [refusal, setRefusal] = React.useState<Refusal | null>(null);
  const [phase, setPhase] = React.useState<Phase>("loading");
  const [failureText, setFailureText] = React.useState<string | null>(null);
  const [clientSecret, setClientSecret] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setPhase("loading");
    try {
      const res = await fetch(`/api/couranr/pay/${encodeURIComponent(token)}`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!body?.valid) {
        setRefusal({ valid: false, reason: String(body?.reason ?? "not_found") });
        setQuote(null);
        setPhase("quote");
        return;
      }
      setRefusal(null);
      setQuote(body as Quote);
      setPhase(body.paymentState === "authorized" ? "authorized" : "quote");
    } catch {
      setRefusal({ valid: false, reason: "unavailable" });
      setPhase("quote");
    }
  }, [token]);

  React.useEffect(() => {
    load();
  }, [load]);

  /** Ask the server for a PaymentIntent. This authorizes nothing by itself. */
  async function beginPayment() {
    setPhase("preparing");
    setFailureText(null);
    try {
      const res = await fetch(`/api/couranr/pay/${encodeURIComponent(token)}`, {
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok || !body?.clientSecret) {
        if (body?.reason && REFUSAL_COPY[body.reason]) {
          setRefusal({ valid: false, reason: body.reason });
          setPhase("quote");
          return;
        }
        setFailureText(body?.error ?? "Payment could not be set up.");
        setPhase("failed");
        return;
      }
      setClientSecret(String(body.clientSecret));
      setPhase("requires_action");
    } catch {
      setFailureText("We could not reach Couranr. Nothing was charged.");
      setPhase("failed");
    }
  }

  /**
   * Ask the SERVER whether the payment really authorized.
   *
   * Handed to the Payment Element, which calls it only AFTER
   * `stripe.confirmPayment` returns without an error. The page never decides
   * authorization: the server retrieves the PaymentIntent from Stripe, and if
   * it is not really at `requires_capture` for the full amount, nothing moves.
   */
  async function reconcileWithServer() {
    const res = await fetch(`/api/couranr/pay/${encodeURIComponent(token)}/reconcile`, {
      method: "POST",
    });
    return res.json();
  }

  if (phase === "loading") {
    return (
      <LoadingState label="Loading this payment">
        <CardSkeleton lines={4} />
      </LoadingState>
    );
  }

  if (refusal) {
    const copy = REFUSAL_COPY[refusal.reason] ?? REFUSAL_COPY.not_found;
    return (
      <Stack gap={6}>
        <Brand />
        <ErrorState title={copy.title} body={copy.body} />
      </Stack>
    );
  }

  if (!quote) {
    return <ErrorState title="We could not load this payment" body="Nothing was charged." />;
  }

  return (
    <Stack gap={6}>
      <Brand />

      <Card>
        <CardHeader
          title={quote.isRevisedQuote ? "Revised delivery quote" : "Delivery payment"}
          description={
            quote.isRevisedQuote
              ? "The price for this delivery changed after Couranr reviewed it. Approving the revised amount authorizes it."
              : "Approving this amount authorizes it for this delivery."
          }
          actions={
            quote.isRevisedQuote ? <Badge tone="warning">Revised</Badge> : null
          }
        />
        <Stack gap={3}>
          <div>
            <Text size="xs" muted>
              Amount to authorize
            </Text>
            <Text strong>{formatCents(quote.amountCents)}</Text>
          </div>
          <Alert tone="info" title="Couranr does not take payment yet">
            {AUTHORIZE_COPY}
          </Alert>
        </Stack>
      </Card>

      {phase === "authorized" ? (
        <Alert tone="success" title="Payment authorized">
          {formatCents(quote.amountCents)} is authorized for this delivery. Couranr captures it
          only after the delivery is confirmed for service. Nothing has been taken from your
          account yet.
        </Alert>
      ) : null}

      {phase === "failed" ? (
        <Stack gap={3}>
          <ErrorState
            title="That payment did not go through"
            body={failureText ?? "Nothing was charged. You can try again."}
          />
          <Button variant="primary" onClick={beginPayment}>
            Try again
          </Button>
        </Stack>
      ) : null}

      {phase === "quote" ? (
        <Button variant="primary" onClick={beginPayment}>
          {quote.isRevisedQuote ? "Approve the revised amount" : "Authorize this amount"}
        </Button>
      ) : null}

      {phase === "preparing" ? (
        <LoadingState label="Setting up payment details">
          <CardSkeleton lines={3} />
        </LoadingState>
      ) : null}

      {phase === "requires_action" && clientSecret ? (
        <Card>
          <CardHeader
            title="Payment details"
            description="Enter the card that will be authorized for this delivery."
          />
          {/*
            The shared Payment Element — the same component the merchant panel
            uses. It gets the server's client secret and a reconcile callback,
            and nothing else: the amount lives on the intent, so there is no
            number on this page a script could change on its way to Stripe.
          */}
          <CouranrPaymentElement
            clientSecret={clientSecret}
            amountCents={quote.amountCents}
            reconcile={reconcileWithServer}
            onAuthorized={() => setPhase("authorized")}
          />
        </Card>
      ) : null}
    </Stack>
  );
}

function Brand() {
  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <CouranrLogo variant="primary" width={160} />
    </div>
  );
}

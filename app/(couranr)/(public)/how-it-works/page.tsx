import Link from "next/link";
import type { Metadata } from "next";
import { Badge, Card, Grid, Heading, Stack, Text } from "@/components/couranr/primitives";
import { SUPPORT_COPY } from "@/lib/couranr/public/governed";

/**
 * PUB-011 — how Couranr works: request, payer, Couranr confirmation, pickup,
 * tracking, proof, support. Registry constraint enforced in the copy itself:
 * NO instant-confirmation promise — payment is authorized first and captured
 * only after Couranr confirmation. Required states: merchant-paid and
 * customer-paid examples, both rendered as parallel sequences.
 */

export const metadata: Metadata = {
  title: "How Couranr works — Couranr",
  description:
    "Request, payment authorization, Couranr confirmation, managed pickup and delivery with live tracking and proof — for merchant-paid and customer-paid deliveries.",
};

const MERCHANT_PAID = [
  "You create the delivery request in your Couranr workspace.",
  "Your saved payment method is authorized for the server-computed quote. Nothing is captured yet.",
  "Couranr reviews the request and confirms the schedule and vehicle. Only then is payment captured.",
  "A Couranr-managed driver picks up with photo, PIN or signature proof.",
  "You and your customer track the delivery live to a proven drop-off.",
];

const CUSTOMER_PAID = [
  "You create the request and send your customer a secure payment link — no Couranr account required.",
  "Your customer authorizes payment on that link. You see the authorization status.",
  "Couranr reviews and confirms — capture happens after Couranr confirmation, never before.",
  "A Couranr-managed driver picks up with proof, exactly as in the merchant-paid flow.",
  "Everyone tracks live; delivery completes with drop-off proof.",
];

export default function Page() {
  return (
    <div className="cr-mkt">
      <section className="cr-mkt-hero" aria-labelledby="h-h">
        <p className="cr-mkt-eyebrow">How it works</p>
        <h1 id="h-h" className="cr-mkt-h1">
          From &ldquo;can you deliver?&rdquo; to proof it arrived.
        </h1>
        <p className="cr-mkt-sub">
          One flow, two ways to pay. Every delivery is priced server-side, reviewed by
          Couranr, and captured only after Couranr confirms — an estimate is never an
          instant confirmation.
        </p>
        <div className="cr-mkt-cta-row">
          <Link href="/sign-up" className="cr-button cr-button--primary cr-button--lg">
            Create your business account
          </Link>
          <Link href="/estimate" className="cr-button cr-button--secondary cr-button--lg">
            Estimate a delivery
          </Link>
        </div>
      </section>

      <section className="cr-mkt-section" aria-labelledby="h-flows-h">
        <Heading level={2} id="h-flows-h">
          Merchant-paid and customer-paid, side by side
        </Heading>
        <div className="cr-mkt-payers">
          <Card className="cr-mkt-payer--merchant">
            <Stack gap={3}>
              <Badge tone="info">Your business pays</Badge>
              <ol className="cr-mkt-flow">
                {MERCHANT_PAID.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </Stack>
          </Card>
          <Card className="cr-mkt-payer--customer">
            <Stack gap={3}>
              <Badge tone="info">Your customer pays</Badge>
              <ol className="cr-mkt-flow">
                {CUSTOMER_PAID.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </Stack>
          </Card>
        </div>
      </section>

      <section className="cr-mkt-section" aria-labelledby="h-proof-h">
        <Heading level={2} id="h-proof-h">
          Tracking, proof and support
        </Heading>
        <Grid columns={3}>
          <Card>
            <Stack gap={2}>
              <Heading level={3}>Live tracking</Heading>
              <Text muted size="sm">
                You and your customer follow the delivery from a secure link scoped to
                that one delivery. All time windows and ETAs are estimates.
              </Text>
            </Stack>
          </Card>
          <Card>
            <Stack gap={2}>
              <Heading level={3}>Proof at both ends</Heading>
              <Text muted size="sm">
                Pickup and drop-off are documented with photo, PIN or signature —
                chosen when the delivery is created, not improvised at the door.
              </Text>
            </Stack>
          </Card>
          <Card>
            <Stack gap={2}>
              <Heading level={3}>Couranr Support</Heading>
              <Text muted size="sm">{SUPPORT_COPY}</Text>
            </Stack>
          </Card>
        </Grid>
      </section>

      <section className="cr-mkt-closing" aria-labelledby="h-close-h">
        <h2 id="h-close-h" className="cr-mkt-h2-inverse">
          Ready to say yes to delivery?
        </h2>
        <div className="cr-mkt-cta-row">
          <Link href="/sign-up" className="cr-button cr-button--primary cr-button--lg">
            Create your business account
          </Link>
          <Link href="/pricing" className="cr-button cr-button--inverse cr-button--lg">
            See pricing first
          </Link>
        </div>
      </section>
    </div>
  );
}

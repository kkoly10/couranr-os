import Link from "next/link";
import type { Metadata } from "next";
import {
  Badge,
  Card,
  Grid,
  Heading,
  Stack,
  Text,
} from "@/components/couranr/primitives";
import { AskCouranrLauncher } from "@/components/couranr/marketing/AskCouranr";
import {
  BASE_PRICE_CENTS,
  INCLUDED_LOADED_MILES,
  MARKETS_PUBLIC_COPY,
  OPERATING_DAYS_COPY,
  OPERATING_WINDOW_COPY,
  SAME_DAY_CUTOFF_COPY,
  SUPPORT_COPY,
  dollars,
} from "@/lib/couranr/public/governed";

/**
 * PUB-001 — the Couranr marketing homepage. MKT-002's twelve approved
 * sections, in order (the ORDER is an acceptance criterion), hero copy
 * VERBATIM from the blueprint. Replaces the legacy multi-product
 * `app/page.tsx` under LEG-001's `authority_disposition: "replace"` —
 * structural replacement, not copy edit; the legacy page survives on
 * `archive/auto-docs-multiservice`.
 *
 * EVERY number renders from lib/couranr/public/governed.ts, which cites its
 * decision IDs and is registry-tested. No metrics of any kind appear —
 * nothing measures them and TRM-001/MKT-002 prohibit them regardless.
 * tests/couranr-public-claims.test.ts scans this file's rendered copy.
 */

export const metadata: Metadata = {
  title: "Couranr — local delivery infrastructure for local businesses",
  description:
    "Keep taking orders through your own channels. Couranr handles the delivery — from quote and payment to managed dispatch, tracking and proof.",
};

/** MKT-002 §1 — all seven merchant-controlled channels, named. §10.4 requires every one. */
const CHANNELS = [
  "Website",
  "Phone",
  "Text",
  "Social media",
  "Point of sale",
  "Storefront / in person",
  "Other channels you control",
];

const OUTCOMES = [
  "Say yes when a customer asks for delivery, instead of losing the order.",
  "Serve more customers.",
  "Reach customers who cannot easily visit in person.",
  "Extend the practical area your business can sell within.",
  "Keep the sale, the payment relationship and the customer relationship.",
  "Add delivery without hiring drivers or building logistics.",
];

const WORKFLOW = [
  {
    step: "1",
    title: "Request",
    body: "You (or your customer, from a link you share) describe the delivery. Couranr prices it deterministically, server-side.",
  },
  {
    step: "2",
    title: "Payment authorized",
    body: "Your business pays, or your customer pays through a secure payment link — no customer account required. Authorization first; nothing is captured yet.",
  },
  {
    step: "3",
    title: "Couranr confirmation",
    body: "Couranr reviews the request, confirms schedule and vehicle, and only then captures payment. An estimate is never an instant confirmation.",
  },
  {
    step: "4",
    title: "Couranr-managed dispatch",
    body: "Couranr assigns the driver, manages the route, and gives you and your customer live tracking with pickup and delivery proof.",
  },
];

export default function Page() {
  return (
    <div className="cr-mkt">
      {/* Required state: service-area notice. MKT-001 copy verbatim; SVC-002 is
          unresolved so there is no radius, polygon, ZIP list or checker here. */}
      <div className="cr-mkt-notice">
        <Text size="sm">
          {MARKETS_PUBLIC_COPY}{" "}
          <Link href="/service-areas">View service areas →</Link>
        </Text>
      </div>

      {/* 1 — Hero. Copy VERBATIM from MKT-002 §4. */}
      <section className="cr-mkt-hero" aria-labelledby="hero-h">
        <p className="cr-mkt-eyebrow">Local delivery for independent businesses</p>
        <h1 id="hero-h" className="cr-mkt-h1">
          Your customers want delivery. Now you can say yes.
        </h1>
        <p className="cr-mkt-sub">
          Keep taking orders through your website, phone, text, social media, POS or
          storefront. Couranr handles the delivery—from quote and payment to managed
          dispatch, tracking and proof.
        </p>
        <div className="cr-mkt-cta-row">
          <Link href="/sign-up" className="cr-button cr-button--primary cr-button--lg">
            Create your business account
          </Link>
          <Link href="/estimate" className="cr-button cr-button--secondary cr-button--lg">
            Estimate a delivery
          </Link>
        </div>
        <p className="cr-mkt-trust">
          No monthly fee during the pilot. No product-sales commission. You keep the
          sale and the customer relationship.
        </p>
      </section>

      {/* 2 — The pickup-only problem. */}
      <section className="cr-mkt-section" aria-labelledby="s2-h">
        <Heading level={2} id="s2-h">
          Pickup-only means lost orders
        </Heading>
        <Text muted>
          Every week, customers who cannot make it to you ask one question: “Can you
          deliver?” Without an answer, the order walks. Couranr exists so a pickup-only
          business never has to say no again — without hiring a driver or standing up
          logistics.
        </Text>
      </section>

      {/* 3 — Not only restaurants. Never names or attacks a competitor. */}
      <section className="cr-mkt-section" aria-labelledby="s3-h">
        <Heading level={2} id="s3-h">
          Local delivery should not stop at restaurant orders.
        </Heading>
        <Text muted>
          Florists, bakeries, boutiques, hardware stores, print shops — most delivery
          platforms were built around one kind of order. Couranr is built for the rest
          of your main street.
        </Text>
      </section>

      {/* 4 — Keep selling through YOUR channels. All seven, named (§10.4). */}
      <section className="cr-mkt-section" aria-labelledby="s4-h">
        <Heading level={2} id="s4-h">
          Keep selling your way
        </Heading>
        <Text muted>
          Couranr never gets between you and your customer. Take the order anywhere
          you already do:
        </Text>
        <ul className="cr-mkt-chips" aria-label="Order channels you control">
          {CHANNELS.map((c) => (
            <li key={c} className="cr-mkt-chip">
              {c}
            </li>
          ))}
        </ul>
        <ol className="cr-mkt-steps" aria-label="How an order flows">
          <li>Customer orders from you</li>
          <li>You prepare the order</li>
          <li>Couranr delivers it</li>
        </ol>
      </section>

      {/* 5 — Business-growth outcomes. No "brings you customers" claim. */}
      <section className="cr-mkt-section" aria-labelledby="s5-h">
        <Heading level={2} id="s5-h">
          What delivery adds to your business
        </Heading>
        <Grid columns={3}>
          {OUTCOMES.map((o) => (
            <Card key={o} padding="default">
              <Text size="sm">{o}</Text>
            </Card>
          ))}
        </Grid>
      </section>

      {/* 6 — The four-step workflow, both payers. Capture AFTER confirmation. */}
      <section className="cr-mkt-section" aria-labelledby="s6-h">
        <Heading level={2} id="s6-h">
          How a Couranr delivery works
        </Heading>
        <Grid columns={4}>
          {WORKFLOW.map((w) => (
            <Card key={w.step}>
              <Stack gap={2}>
                <Badge tone="info">Step {w.step}</Badge>
                <Heading level={3}>{w.title}</Heading>
                <Text muted size="sm">
                  {w.body}
                </Text>
              </Stack>
            </Card>
          ))}
        </Grid>
        <div className="cr-mkt-payers">
          <Card className="cr-mkt-payer cr-mkt-payer--merchant">
            <Stack gap={2}>
              <Heading level={3}>Your business pays</Heading>
              <Text muted size="sm">
                Use a saved payment method, see the delivery quote before you approve,
                and keep a clean receipt for your books.
              </Text>
            </Stack>
          </Card>
          <Card className="cr-mkt-payer cr-mkt-payer--customer">
            <Stack gap={2}>
              <Heading level={3}>Your customer pays</Heading>
              <Text muted size="sm">
                Send a secure payment link. No Couranr account required — you see the
                authorization status either way.
              </Text>
            </Stack>
          </Card>
        </div>
        <Text muted size="sm">
          You decide who pays for delivery, per delivery.
        </Text>
      </section>

      {/* 7 — Managed delivery and proof. TRM-001 vocabulary. */}
      <section className="cr-mkt-section" aria-labelledby="s7-h">
        <Heading level={2} id="s7-h">
          Couranr-managed, with proof
        </Heading>
        <Text muted>
          Every delivery is dispatched and managed by Couranr — no public driver
          marketplace, no bidding. Pickup and drop-off are documented with photo, PIN
          or signature proof, and both you and your customer can watch the delivery
          live. Anything that needs a change goes through Couranr confirmation, not a
          driver&apos;s judgment call.
        </Text>
      </section>

      {/* 8 — Supported categories. Recommendations, not eligibility. */}
      <section className="cr-mkt-section" aria-labelledby="s8-h">
        <Heading level={2} id="s8-h">
          Built for more kinds of businesses
        </Heading>
        <Text muted>
          Choose the categories that fit your business — they tune Couranr&apos;s
          recommendations, never your eligibility. General local businesses are
          welcome without a category.{" "}
          <Link href="/businesses">See supported business types →</Link>
        </Text>
      </section>

      {/* 9 — Pricing. Only exactly computable numbers; tiers live on /pricing. */}
      <section className="cr-mkt-section" aria-labelledby="s9-h">
        <Heading level={2} id="s9-h">
          Pricing you can put on a sticky note
        </Heading>
        <Text>
          Delivery starts at <strong>{dollars(BASE_PRICE_CENTS)}</strong>, which covers
          the first {INCLUDED_LOADED_MILES} loaded miles. Longer runs price by
          published per-mile tiers — computed server-side, in exact cents, before
          anyone approves anything.
        </Text>
        <Text muted size="sm">
          No monthly fee during the pilot. No product-sales commission.{" "}
          <Link href="/pricing">See the full pricing schedule →</Link>
        </Text>
      </section>

      {/* 10 — Service areas. MKT-001 verbatim, again; no boundary invention. */}
      <section className="cr-mkt-section" aria-labelledby="s10-h">
        <Heading level={2} id="s10-h">
          Where Couranr operates
        </Heading>
        <Text muted>
          {MARKETS_PUBLIC_COPY} Outside those areas, requests are captured for Couranr
          review rather than rejected.{" "}
          <Link href="/service-areas">View service areas →</Link>
        </Text>
      </section>

      {/* 11 — FAQ and the responsibility split. */}
      <section className="cr-mkt-section" aria-labelledby="s11-h">
        <Heading level={2} id="s11-h">
          The fine print, in plain words
        </Heading>
        <Stack gap={3}>
          <Card>
            <Stack gap={1}>
              <Heading level={3}>Who is responsible for what?</Heading>
              <Text muted size="sm">
                You remain responsible for merchandise price, quality, availability,
                packaging, product refunds and the customer relationship. Couranr is
                responsible for the delivery service and approved delivery-related
                charges.
              </Text>
            </Stack>
          </Card>
          <Card>
            <Stack gap={1}>
              <Heading level={3}>When does Couranr deliver?</Heading>
              <Text muted size="sm">
                {OPERATING_DAYS_COPY}, {OPERATING_WINDOW_COPY}. Same-day requests by{" "}
                {SAME_DAY_CUTOFF_COPY}; after the cutoff, delivery is normally the next
                business day. All time windows and ETAs are estimates, and every
                request is subject to Couranr confirmation.
              </Text>
            </Stack>
          </Card>
          <Card>
            <Stack gap={1}>
              <Heading level={3}>What if something comes up mid-delivery?</Heading>
              <Text muted size="sm">{SUPPORT_COPY}</Text>
            </Stack>
          </Card>
        </Stack>
      </section>

      {/* 12 — Closing conversion. Headline VERBATIM. */}
      <section className="cr-mkt-closing" aria-labelledby="s12-h">
        <h2 id="s12-h" className="cr-mkt-h2-inverse">
          The next customer who asks, &ldquo;Can you deliver?&rdquo; deserves a better
          answer.
        </h2>
        <div className="cr-mkt-cta-row">
          <Link href="/sign-up" className="cr-button cr-button--primary cr-button--lg">
            Create your business account
          </Link>
          <Link href="/estimate" className="cr-button cr-button--inverse cr-button--lg">
            Estimate a delivery
          </Link>
        </div>
      </section>

      <AskCouranrLauncher />
    </div>
  );
}

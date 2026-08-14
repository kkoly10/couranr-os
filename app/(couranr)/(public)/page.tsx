import Link from "next/link";
import type { Metadata } from "next";
import { Badge, Heading, Stack, Text } from "@/components/couranr/primitives";
import { AskCouranrLauncher } from "@/components/couranr/marketing/AskCouranr";
import { ServiceCorridorMap } from "@/components/couranr/marketing/ServiceCorridorMap";
import {
  IconBox,
  IconChat,
  IconGlobe,
  IconNoFee,
  IconPerson,
  IconPhone,
  IconPlusCircle,
  IconShare,
  IconStore,
  IconTag,
  IconTerminal,
  IconTruck,
} from "@/components/couranr/marketing/MarketingIcons";
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
 * PUB-001 — the Couranr marketing homepage.
 *
 * MKT-002's twelve approved sections, in order, with copy VERBATIM from the
 * blueprint. Every number renders from lib/couranr/public/governed.ts. No
 * metrics appear: nothing measures them and TRM-001/MKT-002 forbid them.
 *
 * The COMPOSITION of each section is governed separately, by §27.0 of
 * docs/couranr-mvp/brand/COURANR_VISUAL_SYSTEM_V2_2.md. That table is the only
 * source for the `data-couranr-section` ids and `data-composition` values
 * below, and tests/couranr-homepage-composition.test.ts asserts this file
 * against it — twelve sections in order, no two adjacent compositions equal, at
 * most two grid-dominant, at least two image-led, at least one product proof,
 * exactly one workflow rail.
 *
 * The version this replaces failed all four budgets: five card-grid sections,
 * one image-led section, the four-step workflow rendered as four detached
 * identical cards, and no product proof at all. That is the "mechanically
 * coherent and commercially weak" pattern §0 names.
 *
 * The `data-*` attributes exist for verification, not styling. Nothing in CSS
 * selects on them.
 */

export const metadata: Metadata = {
  title: "Couranr — local delivery infrastructure for local businesses",
  description:
    "Keep taking orders through your own channels. Couranr handles the delivery — from quote and payment to managed dispatch, tracking and proof.",
};

/** MKT-002 §1 — all seven merchant-controlled channels, named. §10.4 requires every one. */
const CHANNELS = [
  { label: "Website", Icon: IconGlobe },
  { label: "Phone", Icon: IconPhone },
  { label: "Text", Icon: IconChat },
  { label: "Social media", Icon: IconShare },
  { label: "Point of sale", Icon: IconTerminal },
  { label: "Storefront / in person", Icon: IconStore },
  { label: "Other channels you control", Icon: IconPlusCircle },
];

/**
 * The hero trust row. Between them these say exactly what the single governed
 * trust sentence says — no claim added, none dropped.
 */
const HERO_TRUST = [
  { label: "No monthly fee during the pilot", Icon: IconNoFee },
  { label: "No product-sales commission", Icon: IconTag },
  { label: "You keep the sale and the customer relationship", Icon: IconPerson },
];

const FLOW = [
  { label: "Customer orders from you", Icon: IconPerson },
  { label: "You prepare the order", Icon: IconBox },
  { label: "Couranr delivers it", Icon: IconTruck },
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

/**
 * Section 7's product proof. §19.5 accepts "real Couranr UI OR a faithful live
 * product composition" — this is the second, built from the same states the
 * delivery-detail screen renders. It cannot go stale the way a screenshot does
 * and cannot become the "unreadably small product screenshot" §28 bans.
 *
 * States only, never numbers. A fabricated metric here would breach TRM-001 and
 * §19.5's own "no fake metrics" in one stroke.
 */
const PROOF_TIMELINE = [
  { state: "Created", note: "Request received, priced server-side", done: true },
  { state: "Payment authorized", note: "Held, not captured", done: true },
  { state: "Couranr confirmation", note: "Schedule and vehicle confirmed", done: true },
  { state: "Picked up", note: "Photo and PIN recorded at pickup", done: true },
  { state: "In transit", note: "Live tracking shared with your customer", done: false },
  { state: "Delivered", note: "Photo or signature proof recorded", done: false },
];

const FAQ = [
  {
    q: "Who is responsible for what?",
    a: "You remain responsible for merchandise price, quality, availability, packaging, product refunds and the customer relationship. Couranr is responsible for the delivery service and approved delivery-related charges.",
  },
  {
    q: "When does Couranr deliver?",
    a: `${OPERATING_DAYS_COPY}, ${OPERATING_WINDOW_COPY}. Same-day requests by ${SAME_DAY_CUTOFF_COPY}; after the cutoff, delivery is normally the next business day. All time windows and ETAs are estimates, and every request is subject to Couranr confirmation.`,
  },
  { q: "What if something comes up mid-delivery?", a: SUPPORT_COPY },
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

      {/* ─── 1 ─────────────────────────────── hero / image-integrated-hero ─── */}
      <section
        className="cr-hero"
        aria-labelledby="hero-h"
        data-couranr-section="hero"
        data-composition="image-integrated-hero"
        data-image-led="true"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        {/*
          Art direction, not a resize. The wide source is 16:9; a 390px viewport
          `cover`-crops it to 0.5, which — measured in Chromium — showed about
          two fifths of its width and landed on the driver's navy jacket, so the
          hero read as a flat navy block. Narrow viewports get a portrait source.

          <picture> rather than next/image because art direction needs
          `<source media>`, which next/image cannot express. The alternatives are
          two <Image> elements toggled by CSS, where the hidden one still
          downloads, or a client breakpoint check, which moves the LCP image out
          of the server-rendered HTML.
        */}
        <picture>
          <source
            media="(max-width: 640px)"
            type="image/webp"
            srcSet="/images/pub-001-hero-portrait-640.webp 640w, /images/pub-001-hero-portrait-900.webp 900w"
            sizes="100vw"
          />
          <img
            src="/images/pub-001-hero-wide-1600.webp"
            srcSet="/images/pub-001-hero-wide-1024.webp 1024w, /images/pub-001-hero-wide-1600.webp 1600w"
            sizes="100vw"
            width={1600}
            height={900}
            alt="A florist hands a Couranr-branded parcel of flowers to a Couranr driver outside her shop."
            fetchPriority="high"
            decoding="async"
            className="cr-hero__photo"
          />
        </picture>
        {/* Carries the text contrast, so it is presentational, not content. */}
        <div className="cr-hero__scrim" aria-hidden="true" />

        <div className="cr-hero__body">
          {/* §14.1 — the ONE approved eyebrow on this page. §14.3 forbids
              inventing more; §14.5 caps the whole page at 2–3. */}
          <p className="cr-hero__eyebrow">Local delivery for independent businesses</p>
          <h1 id="hero-h" className="cr-hero__h1 cr-type-hero">
            Your customers want delivery.{" "}
            <span className="cr-hero__h1-accent">Now you can say yes.</span>
          </h1>
          <p className="cr-hero__sub cr-type-lead">
            Keep taking orders through your website, phone, text, social media, POS or
            storefront. Couranr handles the delivery—from quote and payment to managed
            dispatch, tracking and proof.
          </p>
          <div className="cr-hero__cta">
            <Link href="/sign-up" className="cr-button cr-button--primary cr-button--lg">
              Create your business account
            </Link>
            <Link href="/estimate" className="cr-button cr-button--inverse cr-button--lg">
              Estimate a delivery
            </Link>
          </div>
          <ul className="cr-hero__trust">
            {HERO_TRUST.map(({ label, Icon }) => (
              <li key={label} className="cr-hero__trust-item">
                <span className="cr-hero__trust-icon">
                  <Icon />
                </span>
                {label}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ─── 2 ──────────────────────── pickup-problem / editorial-statement ─── */}
      <section
        className="cr-mkt-editorial"
        aria-labelledby="s2-h"
        data-couranr-section="pickup-problem"
        data-composition="editorial-statement"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <h2 id="s2-h" className="cr-type-statement">
          Pickup-only means lost orders
        </h2>
        <p className="cr-mkt-editorial__body cr-type-lead">
          Every week, customers who cannot make it to you ask one question: “Can you
          deliver?” Without an answer, the order walks. Couranr exists so a pickup-only
          business never has to say no again — without hiring a driver or standing up
          logistics.
        </p>
      </section>

      {/* ─── 3 ─────────────────────── category-breadth / image-narrative ─── */}
      <section
        className="cr-mkt-narrative"
        aria-labelledby="s3-h"
        data-couranr-section="category-breadth"
        data-composition="image-narrative"
        data-image-led="true"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <div className="cr-mkt-narrative__copy">
          <h2 id="s3-h" className="cr-type-marketing-section">
            Local delivery, built for more than restaurants.
          </h2>
          <p className="cr-type-lead">
            Florists, bakeries, boutiques, hardware stores, print shops — most delivery
            platforms were built around one kind of order. Couranr is built for the rest
            of your main street.
          </p>
        </div>
        {/*
          IMAGE SLOT — awaiting IMG-01…04 from
          docs/couranr-mvp/brand/PUB-001_PHOTOGRAPHY_BRIEF.md.

          Rendered as a labelled placeholder rather than hidden, because a hidden
          slot is one nobody remembers. §21.1 required inventorying before
          sourcing: the repository owns exactly two photographs, both the same
          florist-and-driver scene, and both are already spent on the hero.
          Unsplash proved unreachable from this environment and the reachable CC0
          pool returned frames banned by name in §21.5.

          The page still meets §27's floor of two image-led sections, because
          section 10 carries a real corridor map. When the four frames land this
          becomes the 40–65% photographic half §19.2 describes.
        */}
        <div
          className="cr-mkt-narrative__visual cr-mkt-slot"
          role="img"
          aria-label="Photography for this section has not been produced yet."
        >
          <span className="cr-mkt-slot__label">Photography pending</span>
          <span className="cr-mkt-slot__note">
            IMG-01 … IMG-04 · PUB-001_PHOTOGRAPHY_BRIEF.md
          </span>
        </div>
      </section>

      {/* ─── 4 ───────────────── order-channels / structured-information-block ─── */}
      <section
        className="cr-mkt-section"
        aria-labelledby="s4-h"
        data-couranr-section="order-channels"
        data-composition="structured-information-block"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <Heading level={2} id="s4-h" className="cr-type-marketing-section">
          Keep selling your way
        </Heading>
        <Text muted>
          Couranr never gets between you and your customer. Take the order anywhere
          you already do:
        </Text>
        {/* §27 Section 4: "Do not render seven identical cards." A connected
            strip that reads as one system, converging into one workflow. */}
        <ul className="cr-mkt-channelstrip" aria-label="Order channels you control">
          {CHANNELS.map(({ label, Icon }) => (
            <li key={label} className="cr-mkt-channelstrip__item">
              <span className="cr-mkt-channelstrip__icon">
                <Icon />
              </span>
              <span className="cr-mkt-channelstrip__label">{label}</span>
            </li>
          ))}
        </ul>
        <ol className="cr-mkt-flow-strip" aria-label="How an order flows">
          {FLOW.map(({ label, Icon }) => (
            <li key={label} className="cr-mkt-flow-strip__step">
              <span className="cr-mkt-flow-strip__icon">
                <Icon />
              </span>
              {label}
            </li>
          ))}
        </ol>
      </section>

      {/* ─── 5 ──────────────────────────────────── outcomes / split-story ─── */}
      <section
        className="cr-mkt-split"
        aria-labelledby="s5-h"
        data-couranr-section="outcomes"
        data-composition="split-story"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <div className="cr-mkt-split__lead">
          <Heading level={2} id="s5-h" className="cr-type-marketing-section">
            What delivery adds to your business
          </Heading>
          <Text muted className="cr-type-lead">
            Not a feature list — the things that change on the day you can answer yes.
          </Text>
        </div>
        {/* §27 Section 5: "Do not default to a three-card benefits grid." One
            ruled list carries six items without six boxes. */}
        <ul className="cr-mkt-outcomes">
          {OUTCOMES.map((o) => (
            <li key={o} className="cr-mkt-outcomes__item">
              {o}
            </li>
          ))}
        </ul>
      </section>

      {/* ─── 6 ─────────────────────────────────── workflow / workflow-rail ─── */}
      <section
        className="cr-mkt-section"
        aria-labelledby="s6-h"
        data-couranr-section="workflow"
        data-composition="workflow-rail"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <Heading level={2} id="s6-h" className="cr-type-marketing-section">
          How a Couranr delivery works
        </Heading>
        {/* §19.4: sequential steps visually connected, progression spatially
            obvious. The previous version rendered these as four detached
            identical cards — the exact anti-pattern §19.4 names. */}
        <ol className="cr-mkt-rail" aria-label="The four steps of a Couranr delivery">
          {WORKFLOW.map((w) => (
            <li key={w.step} className="cr-mkt-rail__step">
              <span className="cr-mkt-rail__marker" aria-hidden="true">
                {w.step}
              </span>
              <div className="cr-mkt-rail__content">
                <h3 className="cr-type-card-title">{w.title}</h3>
                <Text muted size="sm">
                  {w.body}
                </Text>
              </div>
            </li>
          ))}
        </ol>
        <div className="cr-mkt-payers">
          <div className="cr-mkt-payer cr-mkt-payer--merchant">
            <span className="cr-mkt-payer__head">
              <span className="cr-mkt-payer__icon">
                <IconStore />
              </span>
              <h3 className="cr-type-card-title">Your business pays</h3>
            </span>
            <Text muted size="sm">
              Use a saved payment method, see the delivery quote before you approve,
              and keep a clean receipt for your books.
            </Text>
          </div>
          <div className="cr-mkt-payer cr-mkt-payer--customer">
            <span className="cr-mkt-payer__head">
              <span className="cr-mkt-payer__icon">
                <IconPerson />
              </span>
              <h3 className="cr-type-card-title">Your customer pays</h3>
            </span>
            <Text muted size="sm">
              Send a secure payment link. No Couranr account required — you see the
              authorization status either way.
            </Text>
          </div>
        </div>
        <Text muted size="sm">
          You decide who pays for delivery, per delivery.
        </Text>
      </section>

      {/* ─── 7 ────────────────────────────── product-proof / product-proof ─── */}
      <section
        className="cr-mkt-proof"
        aria-labelledby="s7-h"
        data-couranr-section="product-proof"
        data-composition="product-proof"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="true"
      >
        <div className="cr-mkt-proof__copy">
          <Heading level={2} id="s7-h" className="cr-type-marketing-section">
            Couranr-managed, with proof
          </Heading>
          <Text muted className="cr-type-lead">
            Every delivery is dispatched and managed by Couranr — no public driver
            marketplace, no bidding. Pickup and drop-off are documented with photo, PIN
            or signature proof, and both you and your customer can watch the delivery
            live. Anything that needs a change goes through Couranr confirmation, not a
            driver&apos;s judgment call.
          </Text>
        </div>
        {/* Built from the product's own states, at readable size. No numbers:
            §19.5 and TRM-001 both forbid a fabricated metric, and a state
            timeline is what the delivery-detail screen actually shows. */}
        <div className="cr-mkt-proof__panel">
          <div className="cr-mkt-proof__panel-head">
            <span className="cr-type-label">Delivery timeline</span>
            <Badge tone="info">Couranr review</Badge>
          </div>
          <ol className="cr-mkt-proof__timeline">
            {PROOF_TIMELINE.map((t) => (
              <li
                key={t.state}
                className={
                  t.done
                    ? "cr-mkt-proof__event cr-mkt-proof__event--done"
                    : "cr-mkt-proof__event"
                }
              >
                {/* Not colour alone (§23.5): the marker changes shape, and the
                    row carries its state as text either way. */}
                <span className="cr-mkt-proof__dot" aria-hidden="true" />
                <span className="cr-mkt-proof__state">{t.state}</span>
                <span className="cr-mkt-proof__note">{t.note}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ─── 8 ─────────────────── categories / structured-information-block ─── */}
      {/* The ONE grid-dominant section the page is allowed. §27 Section 8:
          "This may be one of the homepage's allowed card/grid-heavy sections." */}
      <section
        className="cr-mkt-section"
        aria-labelledby="s8-h"
        data-couranr-section="categories"
        data-composition="structured-information-block"
        data-image-led="false"
        data-grid-dominant="true"
        data-product-proof="false"
      >
        <Heading level={2} id="s8-h" className="cr-type-marketing-section">
          Built for more kinds of businesses
        </Heading>
        <Text muted>
          Choose the categories that fit your business — they tune Couranr&apos;s
          recommendations, never your eligibility. General local businesses are
          welcome without a category.{" "}
          <Link href="/businesses">See supported business types →</Link>
        </Text>
      </section>

      {/* ─── 9 ────────────────────────── pricing / full-bleed-interruption ─── */}
      <section
        className="cr-mkt-band"
        aria-labelledby="s9-h"
        data-couranr-section="pricing"
        data-composition="full-bleed-interruption"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <div className="cr-mkt-band__inner">
          <div className="cr-mkt-band__copy">
            <h2 id="s9-h" className="cr-mkt-band__h2 cr-type-marketing-section">
              Pricing you can put on a sticky note
            </h2>
            <p className="cr-mkt-band__body">
              Delivery starts at {dollars(BASE_PRICE_CENTS)}, which covers the first{" "}
              {INCLUDED_LOADED_MILES} loaded miles. Longer runs price by published
              per-mile tiers — computed server-side, in exact cents, before anyone
              approves anything.
            </p>
            <p className="cr-mkt-band__note">
              No monthly fee during the pilot. No product-sales commission.{" "}
              <Link href="/pricing">See the full pricing schedule →</Link>
            </p>
          </div>
          <div className="cr-mkt-band__figure">
            <span className="cr-mkt-band__label">Starting at</span>
            {/* Rendered from BASE_PRICE_CENTS. Nothing here is typed in. */}
            <span className="cr-mkt-band__price cr-type-metric">
              {dollars(BASE_PRICE_CENTS)}
            </span>
            <span className="cr-mkt-band__label">
              per delivery · first {INCLUDED_LOADED_MILES} loaded miles
            </span>
          </div>
        </div>
      </section>

      {/* ─── 10 ───────────────────────────── service-area / image-narrative ─── */}
      <section
        className="cr-mkt-narrative cr-mkt-narrative--reverse"
        aria-labelledby="s10-h"
        data-couranr-section="service-area"
        data-composition="image-narrative"
        data-image-led="true"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <div className="cr-mkt-narrative__copy">
          <h2 id="s10-h" className="cr-type-marketing-section">
            Where Couranr operates
          </h2>
          <p className="cr-type-lead">
            {MARKETS_PUBLIC_COPY} Outside those areas, requests are captured for Couranr
            review rather than rejected.{" "}
            <Link href="/service-areas">View service areas →</Link>
          </p>
        </div>
        <div className="cr-mkt-narrative__visual">
          <ServiceCorridorMap className="cr-mkt-map" />
        </div>
      </section>

      {/* ─── 11 ──────────────────────── faq / structured-information-block ─── */}
      <section
        className="cr-mkt-section"
        aria-labelledby="s11-h"
        data-couranr-section="faq"
        data-composition="structured-information-block"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <Heading level={2} id="s11-h" className="cr-type-marketing-section">
          The fine print, in plain words
        </Heading>
        {/* §27 Section 11: "Do not style every FAQ item as a floating marketing
            card if a simpler structure is clearer." A ruled list, not cards. */}
        <dl className="cr-mkt-faq">
          {FAQ.map(({ q, a }) => (
            <div key={q} className="cr-mkt-faq__item">
              <dt className="cr-type-card-title">{q}</dt>
              <dd>
                <Text muted size="sm">
                  {a}
                </Text>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ─── 12 ──────────────────────── closing / full-bleed-interruption ─── */}
      <section
        className="cr-mkt-closing"
        aria-labelledby="s12-h"
        data-couranr-section="closing"
        data-composition="full-bleed-interruption"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <Stack gap={6}>
          <h2 id="s12-h" className="cr-mkt-h2-inverse cr-type-statement">
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
        </Stack>
      </section>

      <AskCouranrLauncher />
    </div>
  );
}

import Link from "next/link";
import type { Metadata } from "next";
import { Badge, Heading, Stack, Text } from "@/components/couranr/primitives";
import { AskCouranrLauncher } from "@/components/couranr/marketing/AskCouranr";
import { ServiceCorridorMap } from "@/components/couranr/marketing/ServiceCorridorMap";
import {
  IconBolt,
  IconBox,
  IconCalendar,
  IconChat,
  IconGlobe,
  IconNoFee,
  IconPerson,
  IconPhone,
  IconPlusCircle,
  IconRoute,
  IconShare,
  IconStore,
  IconTag,
  IconTerminal,
  IconTruck,
} from "@/components/couranr/marketing/MarketingIcons";
import {
  BASE_PRICE_CENTS,
  INCLUDED_LOADED_MILES,
  MANUAL_QUOTE_OVER_MILES,
  MANUAL_REVIEW_OVER_LB,
  MARKETS_PUBLIC_COPY,
  OPERATING_DAYS_COPY,
  OPERATING_WINDOW_COPY,
  OVERNIGHT_WINDOW_COPY,
  ROUTE_SAVER_FROM_CENTS_PER_STOP,
  ROUTE_SAVER_MIN_STOPS,
  SAME_DAY_CUTOFF_COPY,
  SERVICE_LEVEL_CENTS,
  SUPPORT_COPY,
  WEIGHT_BANDS,
  dollars,
} from "@/lib/couranr/public/governed";
import {
  BUSINESS_CATEGORIES,
  CATEGORY_LABELS,
  GENERAL_CATEGORY,
  MAX_SECONDARY_CATEGORIES,
} from "@/lib/couranr/categories/registry";
import {
  VEHICLE_CLASSES,
  VEHICLE_CLASS_LABELS,
} from "@/lib/couranr/dispatch/states";

/**
 * PUB-001 — the Couranr marketing homepage.
 *
 * MKT-002's approved sections, in order, with copy VERBATIM from the
 * blueprint. Every number renders from lib/couranr/public/governed.ts. No
 * metrics appear: nothing measures them and TRM-001/MKT-002 forbid them.
 *
 * THIRTEEN sections, not MKT-002's original twelve. Section 9,
 * `delivery-options`, is the owner amendment recorded as MKT-003: the canonical
 * artboard carries a "Delivery options that fit your needs" section between the
 * category system and the pricing band, every value in it is already governed
 * (SUR-001 service levels and weight bands, SUR-002 Route Saver, MIL-002 tiers,
 * OVN-001 overnight), and Gate A's D-6 said adding it was a content decision
 * belonging to the owner. The owner made it.
 *
 * The COMPOSITION of each section is governed separately, by §27.0 of
 * docs/couranr-mvp/brand/COURANR_VISUAL_SYSTEM_V2_2.md. That table is the only
 * source for the `data-couranr-section` ids and `data-composition` values
 * below, and tests/couranr-homepage-composition.test.ts asserts this file
 * against it — thirteen sections in order, no two adjacent compositions equal,
 * at most two grid-dominant, at least two image-led, at least one product
 * proof, exactly one workflow rail.
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

/**
 * The proof artifacts, added by Gate A's D-2. The artboard puts four of these
 * beside the timeline, and it was right that a timeline alone under-sells what
 * proof means — the states say a delivery moved, the artifacts say what was
 * recorded.
 *
 * The mock also stamps each stage with a timestamp. Those are fixture data
 * presented as a record, so they stay out: §19.5 and TRM-001 both forbid
 * fabricated specifics on the public surface. What a proof TYPE is remains a
 * fact about the product; what a particular delivery did is not.
 *
 * `photo: true` marks the one artifact whose mock rendition carries an actual
 * photograph. It renders as a labelled tile until the imagery in
 * PUB-001_PHOTOGRAPHY_BRIEF.md exists.
 */
const PROOF_ARTIFACTS = [
  { label: "Recipient PIN", detail: "Four digits, verified at the door" },
  { label: "Delivery photo", detail: "Captured at drop-off", photo: true },
  { label: "Location", detail: "Recorded where it was left" },
  { label: "Signature", detail: "When the delivery calls for one" },
];

/**
 * Section 9 — the artboard's four delivery options, MKT-003.
 *
 * EVERY value below renders from `governed.ts`. Nothing here is typed in, and
 * nothing here is new product surface: the four options are four ways to read
 * decisions that already exist, which is why this section was buildable at all
 * while the artboard's other three extra sections (Smart Intake, the support
 * demonstration, "Why businesses choose Couranr") are still unbuilt.
 *
 * `tag` is the artboard's own short descriptor under each option. They are
 * descriptors, not claims — none of them promises a time, and MKT-002's
 * prohibited "guaranteed delivery times" and "instant confirmation" appear
 * nowhere. Every option remains subject to Couranr confirmation, which the
 * section's lead column states once rather than four times.
 */
const DELIVERY_OPTIONS = [
  {
    title: "Same-day and priority",
    Icon: IconBolt,
    body: `Requested by ${SAME_DAY_CUTOFF_COPY} on an operating day. Priority adds ${dollars(
      SERVICE_LEVEL_CENTS.priority,
    )}, rush adds ${dollars(SERVICE_LEVEL_CENTS.rush)}.`,
    tag: "As soon as possible",
  },
  {
    title: "Scheduled and next-day",
    Icon: IconCalendar,
    body: `Choose the day and window that works. After the ${SAME_DAY_CUTOFF_COPY} cutoff, delivery is normally the next business day — at no service-level surcharge.`,
    tag: "Plan ahead",
  },
  {
    title: "Bulky and extended-distance",
    Icon: IconTruck,
    body: `Weight adds from ${dollars(WEIGHT_BANDS[0].cents)} at ${
      WEIGHT_BANDS[0].fromLb
    } lb. Over ${MANUAL_REVIEW_OVER_LB} lb, or past ${MANUAL_QUOTE_OVER_MILES} loaded miles, the request is captured for Couranr review instead of an automatic quote.`,
    tag: "Review and confirm",
  },
  {
    title: "Route Saver",
    Icon: IconRoute,
    body: `From ${dollars(
      ROUTE_SAVER_FROM_CENTS_PER_STOP,
    )} per stop on runs of ${ROUTE_SAVER_MIN_STOPS} stops or more, with Couranr planning the route order.`,
    tag: "Lower cost option",
  },
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
          {/* Gate A / D-2 — what gets recorded, beside what happened. */}
          <ul className="cr-mkt-proof__artifacts" aria-label="What Couranr records as proof">
            {PROOF_ARTIFACTS.map((a) => (
              <li key={a.label} className="cr-mkt-proof__artifact">
                <span className="cr-mkt-proof__artifact-label">{a.label}</span>
                <span className="cr-mkt-proof__artifact-detail">{a.detail}</span>
                {a.photo ? (
                  <span className="cr-mkt-proof__artifact-slot" aria-hidden="true">
                    image pending
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ─── 8 ─────────────────── categories / structured-information-block ─── */}
      {/* The ONE grid-dominant section the page is allowed. §27 Section 8:
          "This may be one of the homepage's allowed card/grid-heavy sections."

          ALL ELEVEN governed categories render, from
          lib/couranr/categories/registry.ts. The artboard shows six as tabs,
          each revealing a photograph, "Typical items", "Handling notes" and
          "Typical delivery details" with a distance band and a vehicle class.

          The tab INTERACTION is deliberately not built, and the reason is not
          effort. Grepping lib/couranr/** for per-category data returns nothing:
          no module maps a category to items, handling, distance or vehicle,
          the Decision Registry has no category record at all, and the one rule
          the Master Package does state is "Category controls initial
          recommendations, not eligibility." A tab strip whose panels differ
          would have to invent that difference, and §27 Section 8 forbids
          exactly that — "Do not imply category controls eligibility where
          product authority says it does not."

          So the breadth claim is made the honest way: eleven visible at once
          instead of six behind tabs, which is more of the registry than the
          artboard showed, with the purpose sentence stating plainly that the
          choice tunes suggestions and nothing else. Recorded as Gate A's D-1. */}
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
          Built for real local businesses
        </Heading>
        <Text muted>
          Pick one primary category and up to {MAX_SECONDARY_CATEGORIES} secondary
          ones when you sign up. Your category tunes what Couranr suggests — it
          never limits what you can send or what it costs.
        </Text>
        <ul className="cr-mkt-categories" aria-label="Supported business categories">
          {BUSINESS_CATEGORIES.map((c) => (
            <li
              key={c}
              className={
                c === GENERAL_CATEGORY
                  ? "cr-mkt-categories__item cr-mkt-categories__item--general"
                  : "cr-mkt-categories__item"
              }
            >
              {CATEGORY_LABELS[c]}
            </li>
          ))}
        </ul>
        <Text muted size="sm">
          Not on the list? <strong>{CATEGORY_LABELS[GENERAL_CATEGORY]}</strong> is a
          first-class choice, not a waiting room.{" "}
          <Link href="/businesses">See supported business types →</Link>
        </Text>
      </section>

      {/* ─── 9 ───────────────────────────── delivery-options / split-story ─── */}
      {/* MKT-003 — the artboard's "Delivery options that fit your needs",
          between the category system and the pricing band exactly as it sits
          there.

          Composition is §19.3 split story, NOT the artboard's four-across card
          row, and that is the one place this section departs from the mock. The
          mock puts a card row (categories) directly above another card row
          (options); §19's adjacent-duplicate rule is a hard rule and two
          structured blocks in sequence read as one undifferentiated slab —
          the pattern §0 calls "mechanically coherent and commercially weak".
          Gate A row 9 already recorded the same judgment for the mock's other
          card-heavy sections. The four options keep their icons, titles, bodies
          and descriptor tags; what changes is that they hang off a lead column
          instead of floating as a fifth grid. */}
      <section
        className="cr-mkt-options"
        aria-labelledby="s9-h"
        data-couranr-section="delivery-options"
        data-composition="split-story"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <div className="cr-mkt-options__lead">
          <Heading level={2} id="s9-h" className="cr-type-marketing-section">
            Delivery options that fit your needs
          </Heading>
          <Text muted className="cr-type-lead">
            One request form, four ways to run it. Every option is priced
            server-side before anyone approves it, and every one is subject to
            Couranr confirmation.
          </Text>
          {/* OVN-001: request-only, Couranr-enabled, never stacked with rush.
              OVN-002 (the request-and-enable mechanism) is UNRESOLVED, so there
              is no button here and nothing implies overnight can be booked. */}
          <p className="cr-mkt-options__note">
            Overnight delivery — {OVERNIGHT_WINDOW_COPY}, {dollars(SERVICE_LEVEL_CENTS.overnight)}{" "}
            — may be requested when Couranr confirms availability. It never stacks
            with rush.
          </p>
        </div>
        <ul className="cr-mkt-options__list">
          {DELIVERY_OPTIONS.map(({ title, Icon, body, tag }) => (
            <li key={title} className="cr-mkt-option">
              <span className="cr-mkt-option__icon">
                <Icon />
              </span>
              <div className="cr-mkt-option__body">
                <h3 className="cr-type-card-title">{title}</h3>
                <Text muted size="sm">
                  {body}
                </Text>
              </div>
              <span className="cr-mkt-option__tag">{tag}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ─── 10 ───────────────────────── pricing / full-bleed-interruption ─── */}
      <section
        className="cr-mkt-band"
        aria-labelledby="s10-h"
        data-couranr-section="pricing"
        data-composition="full-bleed-interruption"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <div className="cr-mkt-band__inner">
          <div className="cr-mkt-band__copy">
            <h2 id="s10-h" className="cr-mkt-band__h2 cr-type-marketing-section">
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

      {/* ─── 11 ───────────────────────────── service-area / image-narrative ─── */}
      <section
        className="cr-mkt-narrative cr-mkt-narrative--reverse"
        aria-labelledby="s11-h"
        data-couranr-section="service-area"
        data-composition="image-narrative"
        data-image-led="true"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <div className="cr-mkt-narrative__copy">
          <h2 id="s11-h" className="cr-type-marketing-section">
            Where Couranr operates
          </h2>
          <p className="cr-type-lead">
            {MARKETS_PUBLIC_COPY} Outside those areas, requests are captured for Couranr
            review rather than rejected.
          </p>
          {/* Gate A / D-3. The artboard pairs pricing and coverage in one band
              and puts four assurance lines beside the map. The two sections stay
              separate — §27.0 assigns them different compositions precisely so
              two structured blocks never sit adjacent — but the assurance list
              was the part of the pairing that carried information, and it is
              added here.

              THREE lines, not the artboard's four. "Loading assistance
              available" is dropped: grepping the Decision Registry and
              lib/couranr/** for loading assistance returns nothing, so shipping
              it would be inventing a service. The other three each render from
              something governed — MIL-002's tiers, VEHICLE_CLASSES, and
              CAP-001's confirm-before-capture. */}
          <ul className="cr-mkt-assurances" aria-label="What coverage includes">
            <li>
              Local and extended-distance deliveries, priced by published mile
              tiers to {MANUAL_QUOTE_OVER_MILES} loaded miles
            </li>
            <li>
              {/* Sentence case, not four labels joined. `VEHICLE_CLASS_LABELS`
                  are display labels for an operator's selector, so lowercasing
                  all four put "cargo bike" at the head of a sentence; keeping
                  all four capitalised read as four proper nouns. First as
                  written, rest lowered, "or" before the last. */}
              {(() => {
                const labels = VEHICLE_CLASSES.map((c, i) =>
                  i === 0 ? VEHICLE_CLASS_LABELS[c] : VEHICLE_CLASS_LABELS[c].toLowerCase(),
                );
                return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
              })()}{" "}
              — matched to the delivery, not to the driver who bid first
            </li>
            <li>Couranr review before every pickup</li>
          </ul>
          <p>
            <Link href="/service-areas">View service areas →</Link>
          </p>
        </div>
        <div className="cr-mkt-narrative__visual">
          <ServiceCorridorMap className="cr-mkt-map" />
        </div>
      </section>

      {/* ─── 12 ──────────────────────── faq / structured-information-block ─── */}
      <section
        className="cr-mkt-section"
        aria-labelledby="s12-h"
        data-couranr-section="faq"
        data-composition="structured-information-block"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <Heading level={2} id="s12-h" className="cr-type-marketing-section">
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

      {/* ─── 13 ──────────────────────── closing / full-bleed-interruption ─── */}
      <section
        className="cr-mkt-closing"
        aria-labelledby="s13-h"
        data-couranr-section="closing"
        data-composition="full-bleed-interruption"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <Stack gap={6}>
          <h2 id="s13-h" className="cr-mkt-h2-inverse cr-type-statement">
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

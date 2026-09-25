import Link from "next/link";
import { Badge, Heading, Text } from "@/components/couranr/primitives";
import { CouranrLogo } from "@/components/brand/CouranrLogo";
import { AskCouranrLauncher } from "@/components/couranr/marketing/AskCouranr";
import {
  IconBolt,
  IconBox,
  IconCalendar,
  IconChat,
  IconGlobe,
  IconLock,
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
  ROUTE_SAVER_STATUS_COPY,
  SAME_DAY_CUTOFF_COPY,
  SERVICE_LEVEL_CENTS,
  SUPPORT_COPY,
  WEIGHT_INCLUDED_THROUGH_LB,
  WEIGHT_SURCHARGE_CENTS,
  WEIGHT_SURCHARGE_THROUGH_LB,
  dollars,
} from "@/lib/couranr/public/governed";
import { CATEGORY_PURPOSE_COPY } from "@/lib/couranr/categories/registry";
import { MASTER_COPY } from "@/lib/couranr/public/masterSameDayCopy";
import { PROHIBITED_GROUPS } from "@/lib/couranr/public/prohibitedSummary";
import { routeForScreen } from "@/lib/couranr/navigation";
import {
  VEHICLE_CLASSES,
  VEHICLE_CLASS_LABELS,
} from "@/lib/couranr/dispatch/states";
import { createIndexablePublicMetadata } from "@/lib/couranr/public/seo";
import {
  CATEGORY_BREADTH_PHOTOS,
  OUTCOME_PRIMARY_PHOTO,
  OUTCOME_SUPPORTING_PHOTO,
  intrinsic,
  largestSrc,
  srcSetFor,
  PROOF_ARTIFACT_PHOTOS,
  SERVICE_CORRIDOR_MAP,
} from "@/lib/couranr/public/marketingPhotos";

/**
 * PUB-001 — Couranr for Business, at `/business`.
 *
 * MKT-002's approved sections with copy from the blueprint, re-ordered by the
 * 2026-09 marketing-architecture lock. Every number renders from
 * lib/couranr/public/governed.ts. No metrics appear: nothing measures them and
 * TRM-001/MKT-002 forbid them.
 *
 * FIFTEEN governed sections. The lock made the largest information-architecture
 * correction on this page, and it is a correction rather than a redesign — the
 * visual language, the photography, the convergence diagram, the payer fork,
 * the proof panel and the closing band are all preserved:
 *
 *   REMOVED `pickup-problem`. "Pickup-only means lost orders" led the page with
 *     fear and said what §3 says better. Merged into `outcomes`.
 *   REMOVED `categories`, the eleven-category image grid with the
 *     primary/secondary mechanics. `/businesses` owns the deep category system
 *     and this page was a second copy of it. §6 is a teaser that routes there.
 *   ADDED   `product-choice`. THE HIGHEST-PRIORITY ADDITION. Same Day solves a
 *     delivery; Couranr for Business helps a business offer delivery. The
 *     difference is PURPOSE, never speed — both may run same-day — and owning
 *     a business does not route a person into For Business. The two locked
 *     sentences are imported from MKT-005 rather than retyped, so the master
 *     homepage and this page cannot drift apart on the positioning.
 *   ADDED   `responsibility`. Promoted out of a collapsed FAQ row: what the
 *     business owns, what Couranr owns. It is the question a merchant most
 *     needs answered and it was the hardest thing on the page to find.
 *   ADDED   `shipment-safety`. A business account does not make prohibited
 *     goods eligible. Its summary renders from `PROHIBITED_GROUPS`, the same
 *     derivation `/sameday` §6 uses, so there is no second policy list.
 *
 * WHAT DOES NOT PROPAGATE HERE. The Consumer Same Day declared-value ceiling is
 * a CONSUMER decision and the brief says not to carry it to Business without a
 * separate owner decision. Nothing on this page states one.
 *
 * The COMPOSITION of each section is governed separately, by §27.0 of
 * docs/couranr-mvp/brand/COURANR_VISUAL_SYSTEM_V2_2.md and the rows in
 * VISUAL_REGISTRY.json that render it. That table is the only source for the
 * `data-couranr-section` ids and `data-composition` values below, and
 * tests/couranr-public-composition.test.ts asserts this file against it —
 * fifteen sections in order, at most two grid-dominant, at least two image-led,
 * at least one product proof, exactly one workflow rail.
 *
 * The version this replaces failed all four budgets: five card-grid sections,
 * one image-led section, the four-step workflow rendered as four detached
 * identical cards, and no product proof at all. That is the "mechanically
 * coherent and commercially weak" pattern §0 names.
 *
 * The `data-*` attributes exist for verification, not styling. Nothing in CSS
 * selects on them.
 */

export const metadata = createIndexablePublicMetadata({
  title: "Couranr — local delivery infrastructure for local businesses",
  description:
    "Keep taking orders through the channels you already use. Couranr handles the delivery operation — from quote and payment through dispatch, tracking and proof.",
  path: "/business",
  image: "/images/marketing/2026-08/w/mkt-2026-08-florist-wide-800.webp",
  imageAlt: "Florist selecting stems from a wall of flowers in a local shop.",
});

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
    Icon: IconBox,
    title: "Request",
    body: "You (or your customer, from a link you share) describe the delivery. Couranr prices it deterministically, server-side.",
  },
  {
    step: "2",
    Icon: IconLock,
    title: "Payment authorized",
    body: "Your business pays, or your customer pays through a secure payment link — no customer account required. Authorization first; nothing is captured yet.",
  },
  {
    step: "3",
    Icon: IconCalendar,
    title: "Couranr confirmation",
    body: "Couranr reviews the request, confirms schedule and vehicle, and only then captures payment. An estimate is never an instant confirmation.",
  },
  {
    step: "4",
    Icon: IconTruck,
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
  /* "Photo and PIN recorded at pickup" until the 2026-09 claim audit, and then
     "Shipment and condition photographed", which was ALSO wrong — the audit
     read `couranr_complete_pickup` in the 20260802060000 migration while
     lib/couranr/driver/commands.ts:306 calls `couranr_complete_pickup_v2`,
     which supersedes it. Grepping the v2 body for `condition_photo` returns
     ZERO. What v2 actually refuses without: a CONSUMED merchant_pickup code of
     the latest generation (`pickup_code_not_accepted`), a `shipment_photo`
     (`shipment_photo_required` — unconditional here, though 20260917180000 made
     it conditional on the protection level, which only affects governed CONSUMER
     shipments and never a business one), and a `securement_photo` when the load calls
     for one. The recipient code remains a DROP-OFF credential, never presented
     at pickup. Read the command the app calls, not the one it used to. */
  { state: "Picked up", note: "Pickup code verified, shipment photographed", done: true },
  { state: "In transit", note: "Live tracking shared with your customer", done: false },
  /* One of three, never all three. Each drop-off command requires exactly the
     evidence its stored proof method names — a verified recipient code, a
     delivery photograph, or a captured signature. */
  { state: "Delivered", note: "Recipient code, photo or signature recorded", done: false },
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
 * `photo` used to be the boolean `true` on the single artifact whose MOCK
 * rendition carried a photograph, with the other three rendering nothing and
 * that one rendering the words "image pending". The imagery
 * PUB-001_PHOTOGRAPHY_BRIEF.md called for arrived on 2026-09-08, so the field
 * is now the MarketingPhoto itself and all four carry one.
 */
/* Gate A / D-2. Each artifact now carries its photograph, which until owner
   instruction 2026-09-08 was a literal "image pending" placeholder in one of
   the four slots and nothing in the other three.

   The LABEL still carries the meaning. The photographs illustrate the product
   surface; they are not evidence, and PROOF_ARTIFACT_PHOTOS' own header records
   the narrowed boundary the owner approved. Order matches the list above it. */
/* THE DETAILS ARE CLAIM BOUNDARIES, not flavour. Three of these four are
   ALTERNATIVES: a delivery carries one stored proof method, and its completion
   command requires that method's evidence and no other. Listed flat with
   unqualified details, the row read as "every delivery gets a PIN AND a photo
   AND a signature", which is the universal-proof claim the 2026-09 claim audit
   asked this section not to make. Location is the one that IS universal —
   `couranr_handoff_records` stores coordinates for every method. */
const PROOF_ARTIFACTS = [
  /* NO DIGIT COUNT. This said "Four digits" while `CODE_DIGITS` in
     lib/couranr/driver/codes.ts is 6 and the driver screen says "six-digit" —
     a number pinned in marketing copy and nowhere else drifts the moment the
     credential changes, which is exactly what had already happened. The count
     is an implementation detail no merchant needs; what matters is that the
     code GATES completion, which `recipient_code_not_accepted` (CR409) does. */
  { label: "Recipient code", detail: "Verified at the door before the delivery completes", photo: PROOF_ARTIFACT_PHOTOS[0] },
  { label: "Delivery photo", detail: "When the delivery is left at the door", photo: PROOF_ARTIFACT_PHOTOS[1] },
  { label: "Location", detail: "Recorded on every handoff", photo: PROOF_ARTIFACT_PHOTOS[2] },
  { label: "Signature", detail: "When the delivery calls for one", photo: PROOF_ARTIFACT_PHOTOS[3] },
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
    body: `Weight is included through ${WEIGHT_INCLUDED_THROUGH_LB} lb, then ${dollars(
      WEIGHT_SURCHARGE_CENTS,
    )} through ${WEIGHT_SURCHARGE_THROUGH_LB} lb. Over ${MANUAL_REVIEW_OVER_LB} lb, or past ${MANUAL_QUOTE_OVER_MILES} loaded miles, the request is captured for Couranr review instead of an automatic quote.`,
    tag: "Review and confirm",
  },
  {
    title: "Route Saver",
    Icon: IconRoute,
    body: ROUTE_SAVER_STATUS_COPY,
    tag: "Planned",
  },
];

/* "Who is responsible for what?" is GONE from here, and the doctrine is not.
   Section 5 answers it as a major section now, which is the whole point of
   promoting it: the split between what a business owns and what Couranr owns
   is the question a merchant most needs answered, and it was buried in a
   collapsed accordion row. Leaving both would be the duplication the
   marketing-architecture brief exists to remove. */
const FAQ = [
  {
    q: "When does Couranr deliver?",
    a: `${OPERATING_DAYS_COPY}, ${OPERATING_WINDOW_COPY}. Same-day requests by ${SAME_DAY_CUTOFF_COPY}; after the cutoff, delivery is normally the next business day. All time windows and ETAs are estimates, and every request is subject to Couranr confirmation.`,
  },
  { q: "What if something comes up mid-delivery?", a: SUPPORT_COPY },
  /* The edge case the whole positioning lock turns on. Owning a business does
     NOT route a person into Couranr for Business, and the answer has to say
     so plainly — a merchant who reads "no" here and then uses Same Day for a
     personal errand has been told something untrue by their own supplier. */
  {
    q: "Can I use Same Day instead of creating a business account?",
    a: "Yes, for an occasional one-off delivery. Couranr for Business is designed for businesses that want to offer delivery to customers repeatedly and manage those deliveries through one workspace.",
  },
];

/**
 * Section 2's business value points. What a WORKSPACE adds over a one-off
 * Same Day trip — every one of them is a thing the merchant product does
 * today, which is why "delivery status and history" is here and a saved
 * payment method (kind "unbuilt" in lib/couranr/billing/records.ts) is not.
 */
const BUSINESS_VALUE_POINTS = [
  "A business workspace for your deliveries",
  "Repeated customer deliveries in one place",
  "Business-paid or customer-paid delivery, per delivery",
  "Delivery status and history",
  "Tracking and proof together",
];

/**
 * Section 5 — the responsibility split, promoted out of a collapsed FAQ row.
 *
 * This is DOCTRINE, not positioning: Couranr is the merchant's delivery
 * provider and never their marketplace or storefront. The merchant column is
 * the FAQ answer this replaces, itemised; the Couranr column names only what
 * the product actually does.
 *
 * "Pickup and drop-off evidence", NOT "custody evidence", and THE REASON HAS
 * CHANGED. This note used to say value-tiered custody — documenting an item
 * before packing, a numbered tamper-evident seal, recipient identity
 * verification — was "not in this build". It is: `deriveProtection` in
 * `lib/couranr/consumer/protection.ts` derives it and
 * `private.couranr_enforce_consumer_custody_sequence` enforces it.
 *
 * What is still true is the SCOPE, which is the only thing this list turns on.
 * That authority governs CONSUMER Same Day and nothing else:
 * `private.couranr_delivery_protection_level` joins delivery -> request and
 * returns null unless `protection_policy_version` is set, which no business
 * delivery carries, and the custody trigger returns immediately for a null
 * level. So a merchant reading this column would be reading a chain their
 * deliveries do not run. The wording stays; the justification is scope, not
 * absence. Promote it the day business requests derive a protection level.
 */
const MERCHANT_HANDLES = [
  "Product selection",
  "Inventory and availability",
  "Merchandise pricing",
  "Product quality",
  "Preparing and packaging the order",
  "Merchandise returns and refunds",
  "Your customer relationship",
];

const COURANR_HANDLES = [
  "Delivery quote",
  "Delivery payment when applicable",
  "Scheduling and confirmation",
  "Driver assignment and dispatch",
  "Pickup and drop-off evidence",
  "Customer tracking",
  "Secure handoff",
  "Delivery-related proof and support",
];

/**
 * Section 6's teaser examples. A SHORT run of trades, not the category
 * registry: `/businesses` owns the eleven governed categories and the
 * primary/secondary mechanics, and duplicating them here is the content
 * duplication the marketing-architecture brief removes.
 *
 * These are ILLUSTRATIONS and deliberately not `CATEGORY_LABELS` values — a
 * reader who matched this list against the sign-up selector would find them
 * different, and that difference is the point: the category you pick tunes
 * recommendations, it never decides whether a shipment is eligible.
 */
const CATEGORY_EXAMPLES = [
  "Florists",
  "Bakeries",
  "Boutiques",
  "Print shops",
  "Hardware and auto",
  "Local retailers",
  "Service businesses",
];

export default function Page() {
  const sameDayHref = routeForScreen("PUB-013");

  return (
    <div className="cr-mkt">

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
          {/* NO EYEBROW. The artboard shows a rounded bordered pill above this
              headline, and the fidelity amendment §5.1 says the presence of one
              here is not itself a defect — but it also says the copy question
              is the owner's and not the agent's. THE OWNER RESOLVED IT:
              no eyebrow anywhere, including this one, so the pill is gone
              rather than restyled. Amendment §6 governs what may not replace
              it: no pill, chip, tiny uppercase label, badge or decorative
              rule. The hierarchy is the headline and the whitespace above it.

              MKT-002's consumer descriptor ("Local delivery for independent
              businesses") had no other home on this screen and is therefore no
              longer rendered anywhere. That is a registry line the owner should
              amend — the code follows the instruction, and the disagreement is
              surfaced rather than papered over. */}
          {/* TWO EXPLICIT BLOCKS, one H1. The canonical desktop artboard breaks
              this headline at a specific place — clause one over two lines,
              clause two on its own line at 0.83x — and the deployed page gave
              both clauses one size and differentiated them by colour alone.
              Measured off the artboard: cap heights 36px and 30px.

              Spans rather than `text-wrap: balance` + a `ch` guess, because the
              break is a design decision and should not be re-derived by a
              wrapping algorithm at every width. The WORDS are MKT-002's and are
              untouched; the accessible name is unchanged. */}
          <h1 id="hero-h" className="cr-hero__h1 cr-type-hero">
            <span className="cr-hero__h1-lead">Your customers want delivery.</span>{" "}
            <span className="cr-hero__h1-accent">Now you can say yes.</span>
          </h1>
          {/* The 2026-09 lock rewrites this sentence. It used to enumerate the
              channels, which §4 then enumerates again as seven tiles; naming
              them twice cost the line its job, which is to say what Couranr
              IS. "The delivery operation" is the phrase the positioning lock
              uses everywhere, and it is what distinguishes this product from
              Same Day in one word. */}
          <p className="cr-hero__sub cr-type-lead">
            Keep taking orders through the channels you already use. Couranr handles the
            delivery operation—from quote and payment through dispatch, tracking and
            proof.
          </p>
          <div className="cr-hero__cta">
            <Link href="/sign-up" className="cr-button cr-button--primary cr-button--lg">
              Create your business account
              {/* Drift ledger `hero-cta`: the mobile artboard puts a right
                  arrow inside the primary button. Markup rather than a CSS
                  `::after`, because a generated glyph is read into the
                  button's accessible name in Chrome and Safari and "Create
                  your business account right arrow" is noise. Hidden at
                  desktop widths, where the artboard has no arrow. */}
              <span className="cr-hero__cta-arrow" aria-hidden="true">
                →
              </span>
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

      {/* ─── 2 ───────────────────── product-choice / editorial-statement ─── */}
      {/* THE HIGHEST-PRIORITY ADDITION of the 2026-09 positioning lock, and the
          one section on this page whose absence was actively misleading. A
          visitor arriving here had no way to learn that Couranr has two
          products, which meant a person who wanted one delivery could be
          walked into a business sign-up, and a merchant could conclude that
          "For Business" was simply the faster tier. It is neither.

          THE DISTINCTION IS PURPOSE, NEVER SPEED. Both products may run
          same-day. What separates them is whether the delivery is yours or
          your customer's — and owning a business does not decide that. The
          closing cross-link is therefore a real invitation, not a courtesy:
          a merchant with a one-off personal trip belongs on Same Day.

          THE TWO LOCKED SENTENCES ARE IMPORTED, NOT RETYPED. `network_heading`
          and `network_statement` are MKT-005 strings rendered verbatim on the
          master homepage. Typing them again here is how two pages start
          describing one product differently, and the parity test guards the
          registry, not a second copy in JSX.

          Typography-led by contract. `grid-dominant` is false and load-bearing:
          two products beside five bullet points is exactly where a page reaches
          for a comparison-table or a pair of pricing-style cards, and §28 bans
          that template-filling. */}
      <section
        className="cr-mkt-editorial cr-mkt-editorial--wide"
        aria-labelledby="s2-h"
        data-couranr-section="product-choice"
        data-composition="editorial-statement"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <Heading level={2} id="s2-h" className="cr-type-marketing-section">
          {MASTER_COPY.network_heading}
        </Heading>
        <p className="cr-mkt-editorial__body cr-type-lead cr-mkt-choice__statement">
          {MASTER_COPY.network_statement}
        </p>

        <dl className="cr-mkt-choice">
          <div className="cr-mkt-choice__item">
            <dt className="cr-mkt-choice__term">Couranr Same Day</dt>
            <dd className="cr-mkt-choice__desc">
              Best when you simply need one item moved or picked up.
            </dd>
          </div>
          <div className="cr-mkt-choice__item">
            <dt className="cr-mkt-choice__term">Couranr for Business</dt>
            <dd className="cr-mkt-choice__desc">
              Best when customers are buying from your business and you need delivery to
              become part of your operation.
              <ul className="cr-mkt-choice__points">
                {BUSINESS_VALUE_POINTS.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </dd>
          </div>
        </dl>

        <p className="cr-mkt-choice__close">
          If you&rsquo;re routinely delivering orders that customers buy from your
          business, Couranr for Business is the right path.
        </p>
        <p className="cr-mkt-choice__crosslink">
          <Link href={sameDayHref}>Just need one delivery? Use Same Day →</Link>
        </p>
      </section>

      {/* ─── 3 ──────────────────────────────────── outcomes / split-story ─── */}
      {/* THE MERGE. `pickup-problem` used to sit above this section and open
          the page with "Pickup-only means lost orders" — a loss framing for a
          reader who has not yet been told what the product is. The 2026-09
          lock removes that section and folds its substance here, where the
          same fact is stated as the thing delivery ADDS. The six outcomes are
          unchanged; only the heading and the lead moved. */}
      <section
        className="cr-mkt-split"
        aria-labelledby="s5-h"
        data-couranr-section="outcomes"
        data-composition="split-story"
        data-image-led="true"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        {/* `data-image-led` is "true" as of the 2026-08-28 owner decision, and
            §27.0 row 5 was changed in the same commit. The flag is not
            decoration: `tests/couranr-public-composition.test.ts` parses §27.0's
            table and asserts this attribute equals its row, so the two cannot
            disagree without a red test. `check:visual-system` does NOT do that —
            it re-derives the budgets from the SPEC alone and would report four
            image-led sections whether or not the page agreed. Checked by
            planting the disagreement: the test failed, the gate passed. No
            artboard covers this region, so the owner decision governs it. */}
        <div className="cr-mkt-split__lead">
          <Heading level={2} id="s5-h" className="cr-type-marketing-section">
            Turn &ldquo;Can you deliver?&rdquo; into another way to sell.
          </Heading>
          <Text muted className="cr-type-lead">
            Add local delivery without hiring drivers or building your own logistics
            operation.
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
        {/*
          THE PHOTOGRAPHIC HALF, as a band across both columns rather than a
          frame inside one of them. That is not a styling preference — it was
          measured. With the supporting frame under the lead copy and the primary
          above the list, the lead column rendered 444px against the body's 891px
          at 1440: a 447px void down the left of the section, which is worse than
          the void this photography was meant to fill.

          A common height with `object-fit: cover` is what lets a 4:3 primary and
          a 3:2 support sit on one baseline at different widths. Each is cropped
          about its own focal point, so the cover crop lands on the subject
          rather than wherever the centre happens to be.

          WHAT THESE PICTURES CLAIM: nothing. They show what local delivery is
          worth to the person receiving it. Neither is a Couranr customer, neither
          is a Couranr delivery, and the alt text describes only the frame —
          OWNER_VISUAL_DECISION_2026-08-28.md's evidence boundary.
        */}
        <div className="cr-mkt-splitband">
          <img
            src={largestSrc(OUTCOME_PRIMARY_PHOTO)}
            srcSet={srcSetFor(OUTCOME_PRIMARY_PHOTO, "wide")}
            sizes="(max-width: 899px) 100vw, 62vw"
            width={intrinsic(OUTCOME_PRIMARY_PHOTO).width}
            height={intrinsic(OUTCOME_PRIMARY_PHOTO).height}
            alt={OUTCOME_PRIMARY_PHOTO.alt}
            loading="lazy"
            decoding="async"
            className="cr-mkt-splitband__img cr-mkt-splitband__img--primary"
          />
          <img
            src={largestSrc(OUTCOME_SUPPORTING_PHOTO)}
            srcSet={srcSetFor(OUTCOME_SUPPORTING_PHOTO, "wide")}
            sizes="(max-width: 899px) 100vw, 38vw"
            width={intrinsic(OUTCOME_SUPPORTING_PHOTO).width}
            height={intrinsic(OUTCOME_SUPPORTING_PHOTO).height}
            alt={OUTCOME_SUPPORTING_PHOTO.alt}
            loading="lazy"
            decoding="async"
            className="cr-mkt-splitband__img cr-mkt-splitband__img--support"
          />
        </div>
      </section>

      {/* ─── 4 ───────────────── order-channels / structured-information-block ─── */}
      {/* Drift ledger `order-channels` (KEEP — it was REBUILD when this
          comment was written and the ledger has classified it KEEP since the
          correction pass; nothing compares the two, which is how it drifted).
          The artboard shows SIX
          discrete bordered tiles, icon above a centred label, separated by
          gaps, with the section heading and subcopy centred above them — not
          one enclosing container. The flat `.cr-mkt-channelstrip` this replaces
          was written to satisfy §27 Section 4's "do not render seven identical
          cards"; the fidelity amendment §5.2 answers that directly: "If the
          current branch uses a single flat `channelstrip` where the mock shows
          discrete tiles, the current branch is the drift."

          SEVEN tiles, not the artboard's six. MKT-002 §10.4 requires every
          merchant-controlled channel be named, and the artboard splits social
          into Instagram and Facebook brand marks while dropping "point of sale"
          and "other channels you control". Written authority governs the count;
          the mock governs the geometry (amendment §1). */}
      <section
        className="cr-mkt-section cr-mkt-section--centred"
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
        <ul className="cr-mkt-channels" aria-label="Order channels you control">
          {CHANNELS.map(({ label, Icon }) => (
            <li key={label} className="cr-mkt-channel">
              <span className="cr-mkt-channel__icon">
                <Icon />
              </span>
              <span className="cr-mkt-channel__label">{label}</span>
            </li>
          ))}
        </ul>
        {/*
          THE CONVERGENCE — concept panel A, built natively at the owner's
          2026-08-28 request. Seven channels gather into one Couranr-managed
          delivery, which is the claim the section already makes in prose; this
          draws it.

          THE COURANR NODE IS THE APPROVED APP MARK, and that is the whole
          design problem in one line. BRAND_GUIDE.md bans a map-pin/C symbol
          (:53) — which is exactly what the concept board drew — and bans
          placing the logo inside a pill or badge (:57), which rules out
          dropping the wordmark into a circular node to match a flow diagram's
          other markers. The app mark is the one approved asset whose navy
          squircle is its OWN artwork rather than a chip added around a logo.
          It is never given a ring or a backing circle here, for the same rule.

          NO "YOUR BUSINESS" PHOTO NODE, though the board has one. A photograph
          in this section flips `data-image-led` to true, which §27.0 row 4
          declares false, and the composition test asserts equality — so it
          would also force the table and collide with the adjacent image
          narrative under the adjacency diagnostic. The merchant is named in
          words instead.

          The yoke is `aria-hidden`: it is a drawn restatement of the list above
          it, and a screen reader that has just read seven channels does not
          need seven repeated path descriptions. The node's own text is real
          content and is read.
        */}
        <div className="cr-mkt-converge">
          {/* Seven drops, one per tile, on the SAME seven-column grid the tiles
              use — so each starts at its own tile's centre by construction. An
              SVG was tried first and was wrong: a 1000-unit viewBox stretched
              with preserveAspectRatio="none" maps the origins onto a GAPLESS
              track, and the six 12px gaps put every outer curve up to 4.7px off
              its tile — about three stroke widths. Measured in Chromium, not
              reasoned. It is the same defect `.cr-mkt-miles__track` records. */}
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <span key={i} className="cr-mkt-converge__drop" aria-hidden="true" />
          ))}
          <span className="cr-mkt-converge__bar" aria-hidden="true" />
          <span className="cr-mkt-converge__stem" aria-hidden="true" />
          <div className="cr-mkt-converge__node">
            <CouranrLogo variant="app-icon" width={48} className="cr-mkt-converge__mark" />
            <span className="cr-mkt-converge__title">Couranr-managed delivery</span>
            <span className="cr-mkt-converge__note">
              You keep the sale and the customer relationship.
            </span>
          </div>
        </div>

        {/* Ledger `order-flow`: one tinted rounded container holding three
            icon-and-label groups with arrow glyphs between them. Confirmed
            against the artboard pixels and KEPT — amendment §5.3: "Do not
            classify 'bordered strip' as bad merely because it is a container."
            The label wraps to two lines there, so it is not centred with the
            icon; the icon sits to its left. */}
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

      {/* ─── 5 ─────────────────────────────── responsibility / split-story ─── */}
      {/* PROMOTED OUT OF THE FAQ, where it was one collapsed accordion row
          reading "Who is responsible for what?". That is the question a
          merchant most needs answered before they will sign up — Couranr is
          their delivery provider and not their marketplace — and it was the
          hardest thing on the page to find. The FAQ row is removed in the same
          change; keeping both would be the duplication this lock removes.

          TWO COLUMNS, NOT TWO CARDS. `grid-dominant` is false: the pairing is
          a comparison of two responsibilities, which is what a two-column
          definition list is, and boxing each side would make the split look
          like a pricing table.

          EVERY COURANR LINE IS A THING THE PRODUCT DOES. "Pickup and drop-off
          evidence", not "custody evidence": value-tiered custody is not in this
          build, and naming custody here would promise a chain Couranr does not
          yet keep. */}
      <section
        className="cr-mkt-split"
        aria-labelledby="s5r-h"
        data-couranr-section="responsibility"
        data-composition="split-story"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <div className="cr-mkt-split__lead">
          <Heading level={2} id="s5r-h" className="cr-type-marketing-section">
            You sell it. Couranr delivers it.
          </Heading>
          <Text muted className="cr-type-lead">
            Couranr is your delivery provider—not your marketplace or storefront.
          </Text>
        </div>
        <div className="cr-mkt-responsibility">
          <div className="cr-mkt-responsibility__side">
            <h3 className="cr-type-card-title">Your business handles</h3>
            <ul className="cr-mkt-responsibility__list">
              {MERCHANT_HANDLES.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="cr-mkt-responsibility__side">
            <h3 className="cr-type-card-title">Couranr handles</h3>
            <ul className="cr-mkt-responsibility__list">
              {COURANR_HANDLES.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <p className="cr-mkt-responsibility__close">
            Your customers continue buying from you. Couranr handles the delivery
            service.
          </p>
        </div>
      </section>

      {/* ─── 6 ─────────────────────── category-breadth / image-narrative ─── */}
      {/* A TEASER, and the restraint is the whole edit. This section and the
          eleven-card `categories` grid below it were two answers to one
          question, and `/businesses` already owns the deep one — the governed
          category registry, the primary/secondary mechanics, the per-category
          photography. The lock removes `categories` from this page and leaves
          this section to make the breadth point and route there.

          The four owner-accepted frames stay exactly as they were. */}
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
            Built for more than restaurant delivery.
          </h2>
          <p className="cr-type-lead">
            Most delivery platforms were built around one kind of order. Couranr is
            built for the rest of your main street.
          </p>
          {/* A run of trades, not eight bordered tiles: the composition is
              `image-narrative` and the photographs are its visual half, so the
              examples stay typographic. */}
          <ul className="cr-mkt-examples" aria-label="Business types Couranr delivers for">
            {CATEGORY_EXAMPLES.map((label) => (
              <li key={label} className="cr-mkt-examples__item">
                {label}
              </li>
            ))}
          </ul>
          {/* THE CLAIM BOUNDARY, and it is the reason the deep category system
              belongs on one page rather than two. A category tunes what
              Couranr suggests; the shipment policy decides eligibility, per
              shipment, after the details are described.

              THE GOVERNED SENTENCE, not a second one. The brief proposes
              wording for this line, and `CATEGORY_PURPOSE_COPY` already says it
              — on `/businesses` and inside merchant settings, from
              lib/couranr/categories/registry.ts. Typing a near-duplicate here
              would put a third phrasing of one claim boundary on a third
              surface, which is the drift this batch exists to remove. The
              deviation from the brief's exact words is deliberate and
              recorded. */}
          <p className="cr-mkt-narrative__note">{CATEGORY_PURPOSE_COPY}</p>
          <p className="cr-mkt-narrative__cta">
            <Link href="/businesses">See supported business types →</Link>
          </p>
        </div>
        {/*
          The four owner-accepted frames that closed this slot on 2026-08-28.
          They ARE the 40–65% photographic half §19.2 describes; the placeholder
          they replace had been here since the original brief could not be
          sourced.

          FOUR FRAMES, NOT FOUR CARDS. No border, no background, no padding, no
          per-frame caption — the anti-pattern IMPLEMENTATION_SPEC.md §3 names is
          "every photo inside the same card". The frames are staggered rather
          than set in a flat 2x2 so the block reads as one composition.

          ART DIRECTION, NOT A RESIZE. Below 560px a shrunk desktop mosaic puts
          each frame at roughly 175px, where a subject two thirds of the way into
          a 3:2 frame stops being readable. The `<source media>` swaps to a 1:1
          crop about the same focal point, which holds the subject's apparent
          size in a narrower box. Same reason the hero carries a portrait source.

          The alt text describes the photograph and claims nothing: none of these
          people is a Couranr customer and none of these is a Couranr delivery.
        */}
        <ul className="cr-mkt-narrative__visual cr-mkt-photoset" aria-label="Local businesses Couranr delivers for">
          {CATEGORY_BREADTH_PHOTOS.map((photo) => {
            const box = intrinsic(photo);
            const squareBox = intrinsic(photo, "square");
            return (
              <li key={photo.id} className="cr-mkt-photoset__frame">
                <picture>
                  {/*
                    `width`/`height` ON THE SOURCE, not only on the `img`. The
                    img's attributes describe the WIDE fallback, so below 560px
                    the browser reserved a 3:2 box and then reflowed it to the
                    1:1 the square source actually is — measured at 390: each
                    frame jumped 115px to 173px, 232px of layout shift across
                    the four. `<source>` takes its own dimensions for exactly
                    this case.
                  */}
                  <source
                    media="(max-width: 560px)"
                    type="image/webp"
                    srcSet={srcSetFor(photo, "square")}
                    sizes="(max-width: 560px) 45vw, 300px"
                    width={squareBox.width}
                    height={squareBox.height}
                  />
                  <img
                    src={largestSrc(photo)}
                    srcSet={srcSetFor(photo, "wide")}
                    sizes="(max-width: 899px) 45vw, 300px"
                    width={box.width}
                    height={box.height}
                    alt={photo.alt}
                    loading="lazy"
                    decoding="async"
                    className="cr-mkt-photoset__img"
                  />
                </picture>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ─── 7 ─────────────────────────────────── workflow / workflow-rail ─── */}
      {/* FOUR STEPS, deliberately. `/how-it-works` owns the full sequence and
          this page must not become a second copy of it, so the rail keeps the
          homepage summary and sends a reader who wants the detail there. */}
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
                {/* Concept panel B's per-step icon, above the title rather than
                    inside the marker — the marker's NUMBER is what makes the
                    sequence readable, and the glyph is a mnemonic, not the
                    meaning. Decorative: the heading beside it says the step. */}
                <span className="cr-mkt-rail__glyph" aria-hidden="true">
                  <w.Icon />
                </span>
                <h3 className="cr-type-card-title">{w.title}</h3>
                <Text muted size="sm">
                  {w.body}
                </Text>
              </div>
            </li>
          ))}
        </ol>
        <p className="cr-mkt-section__more">
          <Link href="/how-it-works">See the full delivery workflow →</Link>
        </p>
      </section>

      {/* ─── 8 ──────────────── payer-choice / structured-information-block ─── */}
      {/* Drift ledger `payer-choice` (RESTYLE): "Centre the heading." In the
          artboard this is its own section — a centred h2 over two tinted cards
          with circular icons — not a tail appended to the workflow rail, which
          is where the branch had put it. Promoting it is what centring the
          heading actually means; a second h2 nested under the rail's own
          heading would have been the wrong shape.

          The heading is the governed sentence that was already on the page,
          promoted from body copy. No new claim.

          The artboard also embeds a product mini-composition inside each card —
          a saved VISA •••• 4242, a $24.85 quote, a couranr.com/pay/… link with
          a Copy control. Those are fixture data presented as a record. TRM-001
          and §19.5 forbid fabricated specifics on the public surface, so the
          cards carry what each payer route IS and not what one delivery cost.
          Amendment §5.4's recovery target — tint, border, radius, icon geometry
          and title/body hierarchy — is what is reproduced. */}
      <section
        className="cr-mkt-section cr-mkt-section--centred"
        aria-labelledby="s7-h"
        data-couranr-section="payer-choice"
        data-composition="structured-information-block"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <Heading level={2} id="s7-h" className="cr-type-marketing-section">
          You decide who pays for delivery, per delivery.
        </Heading>
        {/*
          THE FORK — concept panel C, built natively at the owner's 2026-08-28
          request. One request, two payers, one delivery.

          THE TWO CARDS ARE NOT REPLACED. The fidelity amendment §5.4 recovered
          their tint, border, radius, icon geometry and title/body hierarchy
          from the artboard, and the drift ledger marks `payer-choice` against
          real mock pixels. So the board's device is built AROUND them: a stem
          above, two arms, a merge below. Replacing mock-supported geometry with
          concept art is the one thing the whole batch was told not to do.

          The stem and merge nodes are real text, not decoration — they carry
          PAY-001 (either party may pay, chosen per delivery, no account
          required) and CAP-001 (the same managed delivery follows either way).
          Only the connector rules are aria-hidden.
        */}
        <div className="cr-mkt-payerfork">
          <div className="cr-mkt-payerfork__stem">
            <span className="cr-mkt-payerfork__glyph" aria-hidden="true">
              <IconBox />
            </span>
            <span className="cr-mkt-payerfork__title">One delivery request</span>
            <span className="cr-mkt-payerfork__note">
              The payer is chosen on the request, per delivery — not fixed to your account.
            </span>
          </div>
          <span className="cr-mkt-payerfork__split" aria-hidden="true" />
        </div>
        <div className="cr-mkt-payers">
          <div className="cr-mkt-payer cr-mkt-payer--merchant">
            <span className="cr-mkt-payer__head">
              <span className="cr-mkt-payer__icon">
                <IconStore />
              </span>
              <h3 className="cr-type-card-title">Your business pays</h3>
            </span>
            {/* NOT "use a saved payment method", and NOT "a clean receipt for
                your books". Both were false. `lib/couranr/billing/records.ts`
                records `saved_payment_method` as kind "unbuilt" — "Couranr does
                not store a payment method yet" — and `downloadable_receipt` as
                undecided, blocked by TAX-001, whose own billing page tells the
                merchant "this page is a record of what Couranr charged, not a
                tax document". The marketing page was promising the two things
                the product explicitly says it does not do. */}
            <Text muted size="sm">
              You confirm payment on each delivery, see the quote before you approve
              it, and the charge is authorized before anything is taken.
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
        <div className="cr-mkt-payerfork">
          <span className="cr-mkt-payerfork__split cr-mkt-payerfork__split--up" aria-hidden="true" />
          <div className="cr-mkt-payerfork__stem">
            {/* The app mark, with no ring and no backing circle — BRAND_GUIDE.md:57.
                The label is two words on purpose: tests/brand-logo.test.ts flags a
                JSX text node that is exactly the wordmark, so a node labelled
                "Couranr" alone would fail the suite AND read as a typed logo. */}
            <CouranrLogo variant="app-icon" width={40} className="cr-mkt-payerfork__mark" />
            <span className="cr-mkt-payerfork__title">The same Couranr-managed delivery</span>
            <span className="cr-mkt-payerfork__note">
              Whoever pays, Couranr reviews, confirms and manages pickup through drop-off.
            </span>
          </div>
        </div>
      </section>

      {/* ─── 9 ────────────────────────────── product-proof / product-proof ─── */}
      {/* AUDITED against the completion commands in the 2026-09 claim pass.
          The lead used to say pickup and drop-off are "documented with photo,
          PIN or signature proof", which read as one undifferentiated pool. The
          two stages take different evidence and the drop-off methods are
          ALTERNATIVES — see the notes on PROOF_TIMELINE and PROOF_ARTIFACTS,
          both of which were stating things the database does not enforce. */}
      <section
        className="cr-mkt-proof"
        aria-labelledby="s8-h"
        data-couranr-section="product-proof"
        data-composition="product-proof"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="true"
      >
        <div className="cr-mkt-proof__copy">
          <Heading level={2} id="s8-h" className="cr-type-marketing-section">
            Couranr-managed, with proof
          </Heading>
          <Text muted className="cr-type-lead">
            Every delivery is dispatched and managed by Couranr — no public driver
            marketplace, no bidding. Pickup is released by a code and photographed, and
            the handoff is recorded using the method that delivery calls for — a
            recipient code, a photo at the door, or a signature. Both you and your customer can
            watch the delivery live, and anything that needs a change goes through
            Couranr confirmation, not a driver&apos;s judgment call.
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
                {/* Above the label, not beside it: at four across the chip is
                    ~150px and a side-by-side would leave the text two words
                    wide. `width`/`height` are the intrinsic box so the row
                    reserves its height before the image decodes — the same CLS
                    lesson the mosaic records, where a missing dimension cost
                    232px of shift across four frames.

                    alt="" — DECORATIVE, and deliberately so. The label and
                    detail beside it carry the whole fact, so W3C WAI's
                    decorative-images rule applies: an image already described
                    by its adjacent text takes a null alt rather than repeating
                    it. It also removes a claim these photographs should not
                    make. This list is labelled "What Couranr records as proof",
                    so a described scene ("a courier enters a four-digit
                    code…") would tell a screen-reader user the frame IS a
                    Couranr delivery — a stronger claim than a sighted reader
                    takes from the same picture. The alt is empty on the
                    MarketingPhoto record too, so it cannot be reintroduced
                    here without the registry and its test disagreeing. */}
                <img
                  className="cr-mkt-proof__artifact-photo"
                  src={largestSrc(a.photo)}
                  srcSet={srcSetFor(a.photo, "wide")}
                  sizes="(min-width: 900px) 260px, 45vw"
                  width={intrinsic(a.photo).width}
                  height={intrinsic(a.photo).height}
                  alt={a.photo.alt}
                  loading="lazy"
                  decoding="async"
                />
                <span className="cr-mkt-proof__artifact-label">{a.label}</span>
                <span className="cr-mkt-proof__artifact-detail">{a.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ─── 10 ──────────────────────── delivery-options / structured-block ─── */}
      {/* MKT-003 — the artboard's "Delivery options that fit your needs",
          between the category system and the pricing band exactly as it sits
          there.

          Drift ledger `delivery-options` (REBUILD). THE CANONICAL CASE. This
          section was a §19.3 split story for one reason, recorded in the code
          comment it replaces: the artboard puts a card row (categories)
          directly above another card row (options), and §19's adjacent-
          duplicate rule forbade two structured blocks in sequence. That was a
          budget, not a design judgment. Amendment §3.1 demotes the adjacency
          prohibition to a drift diagnostic and §5.7 names this exact change:
          "If the mock explicitly supports the original composition, revert the
          budget-driven reinterpretation." It does, so it is reverted — four
          bordered cards in one row, heading centred, overnight footnote
          centred beneath, which is what the artboard shows. */}
      <section
        className="cr-mkt-section cr-mkt-section--centred"
        aria-labelledby="s10-h"
        data-couranr-section="delivery-options"
        data-composition="structured-information-block"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <Heading level={2} id="s10-h" className="cr-type-marketing-section">
          Delivery options that fit your needs
        </Heading>
        <Text muted className="cr-type-lead">
          One request form, four ways to run it. Every option is priced
          server-side before anyone approves it, and every one is subject to
          Couranr confirmation.
        </Text>
        <ul className="cr-mkt-options">
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
                <span className="cr-mkt-option__tag">{tag}</span>
              </div>
            </li>
          ))}
        </ul>
        {/* OVN-001: request-only, Couranr-enabled, never stacked with rush.
            OVN-002 (the request-and-enable mechanism) is UNRESOLVED, so there
            is no button here and nothing implies overnight can be booked. The
            artboard puts this same footnote under the card row, prefixed by a
            clock glyph. */}
        <p className="cr-mkt-options__note">
          Overnight delivery — {OVERNIGHT_WINDOW_COPY}, {dollars(SERVICE_LEVEL_CENTS.overnight)}{" "}
          — may be requested when Couranr confirms availability. It never stacks
          with rush.
        </p>
      </section>

      {/* ─── 11 ──────────────────── shipment-safety / editorial-statement ─── */}
      {/* THE SENTENCE THIS SECTION EXISTS FOR: a business account does not make
          prohibited goods eligible. A merchant reading a page about workspaces,
          payer choice and delivery options can reasonably conclude that having
          an account is what decides what can be carried. It is not — the
          shipment-safety rules apply to every Couranr delivery, consumer or
          business, and they are checked per shipment.

          THE SUMMARY IS DERIVED, and it is SHORT on purpose. The group titles
          come from `PROHIBITED_GROUPS`, the same presentation of
          `PROHIBITED_CLASSES` that /sameday §6 expands in full; this page shows
          the headings only, because the consumer page owns the detailed
          boundary and a second full list is exactly the drift the
          marketing-architecture brief bans.

          NO DECLARED-VALUE CEILING. The Consumer Same Day ceiling is a consumer
          decision and the brief forbids carrying it to Business without a
          separate owner decision. Nothing here states one.

          NO POLICY-DOCUMENT LINK, for the same reason /sameday has none: the
          legal registry carries no Prohibited & Restricted Items Policy and no
          canonical screen owns that route, so the alternatives were a dead link
          or a link to the LEGACY multi-product /terms page. */}
      <section
        className="cr-mkt-editorial cr-mkt-editorial--wide"
        aria-labelledby="s11s-h"
        data-couranr-section="shipment-safety"
        data-composition="editorial-statement"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <Heading level={2} id="s11s-h" className="cr-type-marketing-section">
          Shipment safety applies to every Couranr delivery.
        </Heading>
        <p className="cr-mkt-editorial__body cr-type-lead">
          A business account does not make prohibited goods eligible. Couranr applies
          shipment-safety rules to every delivery.
        </p>
        <ul className="cr-mkt-examples" aria-label="Categories Couranr does not transport">
          {PROHIBITED_GROUPS.map((group) => (
            <li key={group.title} className="cr-mkt-examples__item">
              {group.title}
            </li>
          ))}
        </ul>
        <p className="cr-mkt-safety__note">
          Describe the shipment when you request the delivery. Couranr checks whether it
          can be accepted before anything is captured.
        </p>
      </section>

      {/* ─── 12 + 13 ─────────────────────────── pricing ∥ service-area ─── */}
      {/* Drift ledger `pricing` (REBUILD) and `service-areas` (RESTYLE). The
          artboard puts these two side by side as a pair of LIGHT bordered
          cards. The branch had pricing as a navy full-bleed band — the ledger
          records why: it was chosen to satisfy §19.6's rhythm reset, and §27.0
          says so in as many words ("Section 9 is therefore mapped to
          full-bleed-interruption … so 8 and 9 cannot both be
          structured-information-block"). That is a budget, and amendment §5.7
          reverts budget-driven reinterpretations the mock contradicts. The
          artboard shows no navy here; the closing band is where navy lives.

          Two <section> elements inside one grid wrapper, rather than one merged
          section: §27.0's identifiers are a normative list and merging would
          have deleted one of them from the DOM to achieve a layout. */}
      <div className="cr-mkt-pair">
        <section
          className="cr-mkt-card"
          aria-labelledby="s11-h"
          data-couranr-section="pricing"
          data-composition="structured-information-block"
          data-image-led="false"
          data-grid-dominant="false"
          data-product-proof="false"
        >
          <h2 id="s11-h" className="cr-mkt-card__h2 cr-type-section-title">
            Pricing you can put on a sticky note
          </h2>
          <div className="cr-mkt-pricecard">
            <div className="cr-mkt-pricecard__figure">
              <span className="cr-mkt-pricecard__label">Starting at</span>
              {/* Rendered from BASE_PRICE_CENTS. Nothing here is typed in. */}
              <span className="cr-mkt-pricecard__price cr-type-metric">
                {dollars(BASE_PRICE_CENTS)}
              </span>
            </div>
            {/* The artboard's five ticked lines. Each is a fact already stated
                elsewhere on this page or rendered from governed.ts — none is a
                new claim, and the pilot qualifier stays on the fee line. */}
            <ul className="cr-mkt-assurances" aria-label="What the base price covers">
              <li>Includes the first {INCLUDED_LOADED_MILES} loaded miles</li>
              <li>Distance and optional surcharges may apply</li>
              <li>Customer or business can pay, per delivery</li>
              <li>Bulky and extended-distance requests go through Couranr review</li>
              <li>No monthly fee during the pilot, no product-sales commission</li>
            </ul>
          </div>
          <p className="cr-mkt-card__note">
            Every quote is computed server-side, in exact cents, before anyone
            approves anything. <Link href="/pricing">See the full pricing schedule →</Link>
          </p>
          <Link
            href="/estimate"
            className="cr-button cr-button--primary cr-button--lg cr-mkt-card__cta"
          >
            Estimate a delivery
          </Link>
        </section>

        <section
          className="cr-mkt-card"
          aria-labelledby="s12-h"
          data-couranr-section="service-area"
          data-composition="image-narrative"
          data-image-led="true"
          data-grid-dominant="false"
          data-product-proof="false"
        >
          <h2 id="s12-h" className="cr-mkt-card__h2 cr-type-section-title">
            Where Couranr operates
          </h2>
          <div className="cr-mkt-coverage">
            <div className="cr-mkt-coverage__visual">
              {/* OWNER INSTRUCTION 2026-09-08 — replaces ServiceCorridorMap, the
                  schematic SVG that refused a rendered basemap. The owner ruled
                  that reasoning stale and the map decorative.

                  DECORATIVE, and that is load-bearing rather than a shrug:
                  alt="" because every fact the image depicts is already in text
                  directly beneath it through MARKETS_PUBLIC_COPY, which names
                  all four markets and ends "and surrounding areas". The blue
                  band is therefore not offered to a reader as a coverage
                  boundary — the sentence is what states coverage, which keeps
                  §27 Section 10's "do not invent boundaries" satisfied in
                  substance while the picture changes. */}
              <img
                className="cr-mkt-map"
                src={largestSrc(SERVICE_CORRIDOR_MAP)}
                srcSet={srcSetFor(SERVICE_CORRIDOR_MAP, "wide")}
                sizes="(min-width: 900px) 340px, 70vw"
                width={intrinsic(SERVICE_CORRIDOR_MAP).width}
                height={intrinsic(SERVICE_CORRIDOR_MAP).height}
                alt=""
                loading="lazy"
                decoding="async"
              />
            </div>
            {/* THREE lines, not the artboard's four. "Loading assistance
                available" is dropped: grepping the Decision Registry and
                lib/couranr/** for loading assistance returns nothing, so
                shipping it would be inventing a service. The other three each
                render from something governed — MIL-002's tiers,
                VEHICLE_CLASSES, and CAP-001's confirm-before-capture. */}
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
          </div>
          <p className="cr-mkt-card__note">
            {MARKETS_PUBLIC_COPY} Outside those areas, requests are captured for
            Couranr review rather than rejected.{" "}
            <Link href="/service-areas">View service areas →</Link>
          </p>
        </section>
      </div>

      {/* ─── 14 ─────────────────────── faq / structured-information-block ─── */}
      {/* Drift ledger `faq` (REBUILD) and `ask-couranr` (VERIFY → resolved).
          The artboard pairs a bordered FAQ card of COLLAPSED accordion rows
          with an "Ask Couranr" card. The branch had a ruled definition list
          with every answer expanded, citing §27 Section 11 ("Do not style every
          FAQ item as a floating marketing card if a simpler structure is
          clearer") — but that rule argues against per-item cards, which the
          artboard does not have either. One card containing collapsible rows is
          what the pixels show, and amendment §1 gives the mock the composition.

          `<details>`/`<summary>`: the disclosure is native, so it is keyboard
          operable, exposed to assistive technology, and printable/findable when
          the browser expands it for find-in-page. No client component and no
          JavaScript for a chevron.

          THE ASK COURANR RESOLUTION. The artboard's card says "Get quick
          answers from Couranr Assistant" over four prompt chips, two of them
          sparkle-marked as AI answers. AIS-001 does not settle that Couranr can
          answer anything, the assistant is Phase 9 work, and the execution
          spec's AI-PROVIDER row mandates a disabled/manual fallback — so the
          card is built to the artboard's geometry and position while saying
          what is true. Every chip is real navigation to a route that exists,
          the assistant's absence is stated in the card rather than implied by
          its silence, and there is no input that pretends to accept a question. */}
      <div className="cr-mkt-pair">
        <section
          className="cr-mkt-card"
          aria-labelledby="s13-h"
          data-couranr-section="faq"
          data-composition="structured-information-block"
          data-image-led="false"
          data-grid-dominant="false"
          data-product-proof="false"
        >
          <h2 id="s13-h" className="cr-mkt-card__h2 cr-type-section-title">
            The fine print, in plain words
          </h2>
          {/* THREE questions, not the artboard's five. The other two ("What
              areas does Couranr serve?", "How does delivery proof work?") have
              no governed answer text; answering them here would be writing
              product policy in a marketing file.

              Still three after the 2026-09 lock, by a swap rather than by
              accident: "Who is responsible for what?" left because §5 now
              answers it as a major section, and the Same Day question took its
              place because the positioning lock turns on it. */}
          <div className="cr-mkt-faq">
            {FAQ.map(({ q, a }) => (
              <details key={q} className="cr-mkt-faq__item">
                <summary className="cr-mkt-faq__q cr-type-card-title">{q}</summary>
                <div className="cr-mkt-faq__a">
                  <Text muted size="sm">
                    {a}
                  </Text>
                </div>
              </details>
            ))}
          </div>
        </section>

        <aside className="cr-mkt-card" aria-labelledby="askc-h">
          <h2 id="askc-h" className="cr-mkt-card__h2 cr-mkt-card__h2--start cr-type-section-title">
            Ask Couranr
          </h2>
          <Text muted size="sm">
            The Ask Couranr assistant is not live yet. {SUPPORT_COPY}
          </Text>
          <ul className="cr-mkt-asklinks">
            <li>
              <Link href="/service-areas" className="cr-mkt-asklink">
                Check your service areas
              </Link>
            </li>
            <li>
              <Link href="/pricing" className="cr-mkt-asklink">
                Explain pricing
              </Link>
            </li>
            <li>
              <Link href="/estimate" className="cr-mkt-asklink">
                Estimate a delivery
              </Link>
            </li>
            <li>
              <Link href="/sign-up" className="cr-mkt-asklink">
                Create a business account
              </Link>
            </li>
          </ul>
          <p className="cr-mkt-card__note">
            <Link href="/help">More questions? Contact Couranr Support →</Link>
          </p>
        </aside>
      </div>

      {/* ─── 15 ─────────────────────── closing / full-bleed-interruption ─── */}
      {/* Drift ledger `closing-cta` (RESTYLE): navy IS mock-supported here —
          unlike the pricing region — but the artboard sets the copy LEFT with
          the two buttons on the RIGHT of the same row, not centred over them.
          `--split` is a PUB-001 modifier: the other four public pages keep the
          centred treatment until step 9 propagates this one, and amendment §11
          puts that after owner visual approval.

          The artboard also carries a supporting line under the headline
          ("Create your free business workspace and test the workflow…"). It is
          not written anywhere in the authority chain, so it is not typed in
          here — recorded as a deviation rather than invented. */}
      <section
        className="cr-mkt-closing cr-mkt-closing--split"
        aria-labelledby="s14-h"
        data-couranr-section="closing"
        data-composition="full-bleed-interruption"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <div className="cr-mkt-closing__copy">
          <h2 id="s14-h" className="cr-mkt-h2-inverse cr-type-statement">
            The next customer who asks, &ldquo;Can you deliver?&rdquo; deserves a better
            answer.
          </h2>
        </div>
        <div className="cr-mkt-cta-row">
          <Link href="/sign-up" className="cr-button cr-button--primary cr-button--lg">
            Create your business account
          </Link>
          <Link href="/estimate" className="cr-button cr-button--inverse cr-button--lg">
            Estimate a delivery
          </Link>
        </div>
      </section>


      {/* NO STICKY BOTTOM CTA. The mobile artboard pins a primary action to
          the bottom of the viewport and this page had one — the owner removed
          it, at both widths. What is left is the Ask Couranr launcher, back to
          floating bottom-right on its own.

          The launcher and the bar were merged into one element earlier for a
          real reason: both were bottom-anchored and fixed, so at 390px the
          launcher landed on top of the hero's full-width primary CTA and
          covered the end of its label. With the bar gone there is nothing to
          collide with, and the launcher is a 44px corner affordance rather
          than the 145px labelled pill that caused it. Rendered last so it
          follows the page content in the tab order. */}
      <AskCouranrLauncher />
    </div>
  );
}

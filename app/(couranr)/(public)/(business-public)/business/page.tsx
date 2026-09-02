import Link from "next/link";
import type { Metadata } from "next";
import { Badge, Heading, Text } from "@/components/couranr/primitives";
import { CouranrLogo } from "@/components/brand/CouranrLogo";
import { AskCouranrLauncher } from "@/components/couranr/marketing/AskCouranr";
import { ServiceCorridorMap } from "@/components/couranr/marketing/ServiceCorridorMap";
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
import {
  CATEGORY_BREADTH_PHOTOS,
  OUTCOME_PRIMARY_PHOTO,
  OUTCOME_SUPPORTING_PHOTO,
  intrinsic,
  largestSrc,
  srcSetFor,
} from "@/lib/couranr/public/marketingPhotos";

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
          <p className="cr-hero__sub cr-type-lead">
            Keep taking orders through your website, phone, text, social media, POS or
            storefront. Couranr handles the delivery—from quote and payment to managed
            dispatch, tracking and proof.
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

      {/* ─── 5 ──────────────────────────────────── outcomes / split-story ─── */}
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
      </section>

      {/* ─── 7 ──────────────── payer-choice / structured-information-block ─── */}
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

      {/* ─── 8 ────────────────────────────── product-proof / product-proof ─── */}
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

      {/* ─── 9 ─────────────────── categories / structured-information-block ─── */}
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
          choice tunes suggestions and nothing else. Recorded as Gate A's D-1.

          Drift ledger `categories` was VERIFY on exactly this question and is
          now KEEP. What the ledger asked to verify was whether the artboard's
          tab content could be reproduced; grepping again confirms it cannot —
          no module maps a category to items, handling, a distance band or a
          vehicle class, and inventing them is the eligibility signal §27
          Section 8 forbids. The one part of the row that WAS a straightforward
          defect, the uncentred heading, is fixed here. */}
      <section
        className="cr-mkt-section cr-mkt-section--centred"
        aria-labelledby="s9-h"
        data-couranr-section="categories"
        data-composition="structured-information-block"
        data-image-led="false"
        data-grid-dominant="true"
        data-product-proof="false"
      >
        <Heading level={2} id="s9-h" className="cr-type-marketing-section">
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

      {/* ─── 11 + 12 ─────────────────────────── pricing ∥ service-area ─── */}
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
              <ServiceCorridorMap className="cr-mkt-map" />
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

      {/* ─── 13 ─────────────────────── faq / structured-information-block ─── */}
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
              product policy in a marketing file. */}
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

      {/* ─── 14 ─────────────────────── closing / full-bleed-interruption ─── */}
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

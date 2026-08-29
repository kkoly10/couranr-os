import Link from "next/link";
import type { Metadata } from "next";
import { Badge, Text } from "@/components/couranr/primitives";
import {
  IconBox,
  IconCalendar,
  IconChat,
  IconLock,
  IconPerson,
  IconStore,
  IconTruck,
} from "@/components/couranr/marketing/MarketingIcons";
import { SUPPORT_COPY } from "@/lib/couranr/public/governed";
import {
  CONFIRMATION_PHOTO,
  intrinsic,
  largestSrc,
  srcSetFor,
} from "@/lib/couranr/public/marketingPhotos";

/**
 * PUB-011 — how Couranr works: request, payer, Couranr confirmation, pickup,
 * tracking, proof, support.
 *
 * Registry constraint enforced in the copy itself: NO instant-confirmation
 * promise — payment is authorized first and captured only after Couranr
 * confirmation. Required states: merchant-paid and customer-paid examples.
 *
 * COMPOSITION is governed by §27.1 — seven sections, one connected workflow
 * rail, one product proof, and ZERO grid-dominant sections. That last budget is
 * deliberate and is the whole point of the rebuild: this page is entirely
 * process and evidence, and the version it replaces rendered the process as two
 * bordered cards of numbered lists and the evidence as a three-card benefits
 * grid — §19.4's "four detached identical cards when the content represents one
 * process", twice over.
 *
 * MKT-002: the supporting pages deepen the homepage rather than repeat it. The
 * homepage shows a four-step rail; this page carries CAP-001's full ordered
 * sequence and PRF-001's per-handoff-type proof requirements, neither of which
 * appears there.
 */

export const metadata: Metadata = {
  title: "How Couranr works — Couranr",
  description:
    "Request, payment authorization, Couranr confirmation, managed pickup and delivery with live tracking and proof — for merchant-paid and customer-paid deliveries.",
};

/**
 * CAP-001's `order`, verbatim in sequence and grouped for reading. The
 * registry lists nine steps; the grouping below adds no step and drops none.
 */
const SEQUENCE = [
  {
    step: "1",
    Icon: IconBox,
    title: "Quote",
    body: "The delivery is described and priced server-side, in exact cents. The quote is accepted before anything else happens.",
  },
  {
    step: "2",
    Icon: IconLock,
    title: "Payment authorized",
    body: "A payment method is confirmed and authorized. The money is held, not taken — nothing is captured at this point.",
  },
  {
    step: "3",
    Icon: IconStore,
    title: "Marked ready",
    body: "You prepare the order and mark it ready. Couranr does not dispatch against an order that is not.",
  },
  {
    step: "4",
    Icon: IconChat,
    title: "Couranr review",
    body: "Couranr Operations reads the request. This is a person, not a rule engine, and it is why an estimate is never an instant confirmation.",
  },
  {
    step: "5",
    Icon: IconCalendar,
    title: "Couranr confirmation",
    body: "Couranr confirms the schedule and the vehicle. Only now is payment captured.",
  },
  {
    step: "6",
    Icon: IconTruck,
    title: "Couranr-managed dispatch",
    body: "The delivery is created and assigned to a Couranr-managed driver. There is no marketplace, no bidding and no self-selection.",
  },
];

const MERCHANT_PAID = [
  "You create the delivery request in your Couranr workspace.",
  "You confirm a payment method and it is authorized for the server-computed quote.",
  "Capture happens after Couranr confirms — you see authorization, confirmation and capture, in that order.",
  "Authorization, confirmation and capture are three events you can see, in that order.",
];

const CUSTOMER_PAID = [
  "You create the request and send your customer a secure payment link.",
  "Your customer authorizes payment on that link — no Couranr account required.",
  "Capture happens after Couranr confirms here too. You see the authorization status without ever handling their card details.",
  "The delivery proceeds identically from there.",
];

/**
 * PRF-001, which fixes proof requirements BY HANDOFF TYPE. This is the page's
 * product proof and the thing the homepage does not carry: the homepage names
 * the four artifact kinds, this names what each drop-off method actually
 * requires.
 *
 * The two forbidden items are stated, not omitted. A proof page that lists only
 * what is collected reads as surveillance; the limit is the reassurance.
 */
const PICKUP_PROOF = [
  "Merchant pickup PIN",
  "Package count",
  "Shipment photo",
  "Condition photo",
  "Timestamp and location",
  "The actual vehicle",
];

const DELIVERY_PROOF = [
  {
    method: "Direct handoff",
    requires: ["Recipient PIN", "First name", "Timestamp", "Location"],
  },
  {
    method: "Signature",
    requires: ["Signature", "Signer name", "Timestamp", "Location"],
  },
  {
    method: "Leave at door",
    requires: [
      "Merchant permission",
      "Customer authorization",
      "A safe location",
      "Weather suitability",
      "Photo, timestamp and location",
    ],
  },
];

export default function Page() {
  return (
    <div className="cr-mkt">
      {/* ─── 1 ─────────────────────── works-hero / editorial-statement ─── */}
      <section
        className="cr-mkt-editorial cr-mkt-editorial--hero"
        aria-labelledby="w1-h"
        data-couranr-section="works-hero"
        data-composition="editorial-statement"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        {/* No eyebrow. This screen has no canonical mock, and the fidelity
            amendment §6 retires the shared marketing eyebrow: one label on
            PUB-001 never authorised the pattern here. Deliberately NOT
            replaced with a pill, chip or small caps rule — the hierarchy is
            the statement type and the whitespace under it. */}
        <h1 id="w1-h" className="cr-type-statement">
          From &ldquo;can you deliver?&rdquo; to proof it arrived.
        </h1>
        <p className="cr-mkt-editorial__body cr-type-lead">
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

      {/* ─── 2 ──────────────────────────────── sequence / workflow-rail ─── */}
      {/* §19.4: sequential steps visually connected, progression spatially
          obvious. CAP-001's order, which is the page's spine. */}
      <section
        className="cr-mkt-section"
        aria-labelledby="w2-h"
        data-couranr-section="sequence"
        data-composition="workflow-rail"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <h2 id="w2-h" className="cr-type-marketing-section">
          The order things happen in
        </h2>
        <Text muted className="cr-type-lead">
          This sequence is fixed. Couranr cannot capture a payment before it has
          confirmed the delivery, and it does not dispatch one it has not confirmed.
        </Text>
        <ol className="cr-mkt-rail cr-mkt-rail--long" aria-label="The order a Couranr delivery happens in">
          {SEQUENCE.map((s) => (
            <li key={s.step} className="cr-mkt-rail__step">
              <span className="cr-mkt-rail__marker" aria-hidden="true">
                {s.step}
              </span>
              <div className="cr-mkt-rail__content">
                {/* Concept panel F's per-step icon. Same treatment as PUB-001's
                    four-step rail, because it is the same device — this page
                    carries CAP-001's order at six steps, the homepage at four. */}
                <span className="cr-mkt-rail__glyph" aria-hidden="true">
                  <s.Icon />
                </span>
                <h3 className="cr-type-card-title">{s.title}</h3>
                <Text muted size="sm">
                  {s.body}
                </Text>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ─── 3 ─────────────────────────────────── payers / split-story ─── */}
      {/* Registry-required states: merchant-paid and customer-paid examples. */}
      <section
        className="cr-mkt-split"
        aria-labelledby="w3-h"
        data-couranr-section="payers"
        data-composition="split-story"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <div className="cr-mkt-split__lead">
          <h2 id="w3-h" className="cr-type-marketing-section">
            Two ways to pay, one delivery
          </h2>
          <Text muted className="cr-type-lead">
            Chosen per delivery, not per account. Steps 3 to 6 above are identical
            either way — only who authorizes changes.
          </Text>
        </div>
        <div className="cr-mkt-payers">
          <div className="cr-mkt-payer cr-mkt-payer--merchant">
            <span className="cr-mkt-payer__head">
              <span className="cr-mkt-payer__icon">
                <IconStore />
              </span>
              <h3 className="cr-type-card-title">Your business pays</h3>
            </span>
            <ol className="cr-mkt-payer__steps">
              {MERCHANT_PAID.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </div>
          <div className="cr-mkt-payer cr-mkt-payer--customer">
            <span className="cr-mkt-payer__head">
              <span className="cr-mkt-payer__icon">
                <IconPerson />
              </span>
              <h3 className="cr-type-card-title">Your customer pays</h3>
            </span>
            <ol className="cr-mkt-payer__steps">
              {CUSTOMER_PAID.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* ─── 4 ───────────────── confirmation / full-bleed-interruption ─── */}
      <section
        className="cr-mkt-band cr-mkt-band--photo"
        aria-labelledby="w4-h"
        data-couranr-section="confirmation"
        data-composition="full-bleed-interruption"
        data-image-led="true"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        {/*
          THE ONE NEW PHOTOGRAPHIC SLOT the 2026-08-29 review found, and the
          reasoning is worth keeping because the obvious answer was wrong.

          §19.6 full-bleed-interruption reads "Navy AND/OR APPROVED PHOTOGRAPHY"
          — a photograph in a navy band is this composition's own vocabulary. And
          PUB-011 is recorded `visual_authority: "derived"` in the visual
          registry: no separate approved artboard governs it. That combination
          exists nowhere else on the public site.

          It is NOT the homepage's closing band, which the photography brief also
          asks for. That artboard was opened and read at the pixel level: flat
          navy, headline, two buttons, no image. The brief predates the artboard
          reconciliation and the fidelity amendment gives the mock precedence on
          composition, so a photograph there would reopen a mock-approved region.

          `data-image-led` moves false -> true here and §27.1's PUB-011 row moves
          with it in this commit; the composition test asserts equality.

          The frame claims nothing: a person setting down a bag and a plant at
          her own door. Not a Couranr delivery, not a Couranr customer.
        */}
        {/*
          `sizes="100vw"` describes the ELEMENT's layout width, which is exactly
          100vw. Below about 592px the band is taller than the frame's 16:9, so
          `cover` scales by height and PAINTS more width than that — 776px at
          390, 879px at 320. Checked rather than assumed: at 320/390/768 the
          browser already selects the 900w candidate, which covers the painted
          width at all three. A larger declared size would only over-fetch a
          frame that sits behind a 0.80–0.86 scrim on a phone.
        */}
        <img
          src={largestSrc(CONFIRMATION_PHOTO)}
          srcSet={srcSetFor(CONFIRMATION_PHOTO, "wide")}
          sizes="100vw"
          width={intrinsic(CONFIRMATION_PHOTO).width}
          height={intrinsic(CONFIRMATION_PHOTO).height}
          alt={CONFIRMATION_PHOTO.alt}
          loading="lazy"
          decoding="async"
          className="cr-mkt-band__photo"
        />
        {/* Carries the text contrast, so it is presentational, not content —
            same split the PUB-001 hero uses. */}
        <div className="cr-mkt-band__scrim" aria-hidden="true" />
        <div className="cr-mkt-band__inner cr-mkt-band__inner--stacked">
          <div className="cr-mkt-band__copy">
            <h2 id="w4-h" className="cr-mkt-band__h2 cr-type-marketing-section">
              An estimate is never an instant confirmation
            </h2>
            <p className="cr-mkt-band__body">
              A price appears immediately because it is computed, not negotiated. A
              confirmation appears when Couranr has read the request and committed a
              schedule and a vehicle to it. Those are different events, and Couranr
              will not blur them to look faster.
            </p>
            <p className="cr-mkt-band__note">
              If Couranr cannot confirm, the authorization is released and you are not
              charged. <Link href="/pricing">See the full pricing schedule →</Link>
            </p>
          </div>
        </div>
      </section>

      {/* ─── 5 ─────────────────────────────────── proof / product-proof ─── */}
      {/* §19.5: a faithful live product composition, large enough to read, no
          fabricated metrics. PRF-001's requirements by handoff type. */}
      <section
        className="cr-mkt-proof"
        aria-labelledby="w5-h"
        data-couranr-section="proof"
        data-composition="product-proof"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="true"
      >
        <div className="cr-mkt-proof__copy">
          <h2 id="w5-h" className="cr-type-marketing-section">
            What gets recorded, and what never does
          </h2>
          <Text muted className="cr-type-lead">
            Proof requirements are fixed by handoff type before the driver arrives —
            chosen when the delivery is created, not improvised at the door. Two
            things are never collected, on any delivery: <strong>face photos</strong>{" "}
            and <strong>ID-document photos</strong>.
          </Text>
        </div>
        <div className="cr-mkt-proof__panel">
          <div className="cr-mkt-proof__panel-head">
            <span className="cr-type-label">Proof requirements</span>
            <Badge tone="info">Fixed at creation</Badge>
          </div>

          <div className="cr-mkt-proof__group">
            <h3 className="cr-type-label">At pickup, every time</h3>
            <ul className="cr-mkt-proof__requires">
              {PICKUP_PROOF.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <Text muted size="sm">
              A material discrepancy pauses the pickup and may require a requote —
              Couranr does not carry something it cannot describe.
            </Text>
          </div>

          {DELIVERY_PROOF.map((d) => (
            <div key={d.method} className="cr-mkt-proof__group">
              <h3 className="cr-type-label">{d.method}</h3>
              <ul className="cr-mkt-proof__requires">
                {d.requires.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ─── 6 ─────────────────── support / structured-information-block ─── */}
      <section
        className="cr-mkt-section"
        aria-labelledby="w6-h"
        data-couranr-section="support"
        data-composition="structured-information-block"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <h2 id="w6-h" className="cr-type-marketing-section">
          When something changes mid-delivery
        </h2>
        <dl className="cr-mkt-schedule">
          <div className="cr-mkt-schedule__row cr-mkt-schedule__row--stacked">
            <dt>Couranr Support</dt>
            <dd>{SUPPORT_COPY}</dd>
          </div>
          <div className="cr-mkt-schedule__row cr-mkt-schedule__row--stacked">
            <dt>Live tracking</dt>
            <dd>
              You and your customer follow the delivery from a secure link scoped to
              that one delivery. All time windows and ETAs are estimates.
            </dd>
          </div>
          <div className="cr-mkt-schedule__row cr-mkt-schedule__row--stacked">
            <dt>Changes go through Couranr</dt>
            <dd>
              A change to a confirmed delivery is a Couranr decision, not a
              driver&apos;s judgment call at the door.
            </dd>
          </div>
        </dl>
      </section>

      {/* ─── 7 ─────────────────────── closing / full-bleed-interruption ─── */}
      <section
        className="cr-mkt-closing"
        aria-labelledby="w7-h"
        data-couranr-section="closing"
        data-composition="full-bleed-interruption"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <h2 id="w7-h" className="cr-mkt-h2-inverse cr-type-statement">
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

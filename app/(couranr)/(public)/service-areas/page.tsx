import Link from "next/link";
import type { Metadata } from "next";
import { Text } from "@/components/couranr/primitives";
import { ServiceCorridorMap } from "@/components/couranr/marketing/ServiceCorridorMap";
import {
  MANUAL_QUOTE_OVER_MILES,
  MARKETED_MARKETS,
  MARKETS_PUBLIC_COPY,
  MILE_TIERS,
  dollars,
} from "@/lib/couranr/public/governed";

/**
 * PUB-010 — service areas. MKT-001's four named markets plus "surrounding
 * areas", and SVC-001's review-based behavior for everything else.
 *
 * WHAT IS DELIBERATELY ABSENT: any radius, polygon, ZIP list or eligibility
 * checker. SVC-002 (the precise boundary) is an UNRESOLVED owner decision —
 * inventing a boundary here is forbidden, and out-of-area requests are captured
 * for Couranr review, never rejected (SVC-001 `silent_zip_rejection: false`).
 * Maryland is excluded from initial marketing and does not appear. Required
 * states: primary market, surrounding area, extended-distance review.
 *
 * The corridor map is a SCHEMATIC of where the markets are relative to one
 * another, drawn from real coordinates. It is not a boundary and its own
 * `<desc>` says so.
 *
 * COMPOSITION is governed by §27.1 — six sections, one image-led, one
 * grid-dominant. MKT-002: this page deepens the homepage rather than repeating
 * it, so the corridor is the subject here at full size, and the mileage
 * relationship the homepage only alludes to is stated.
 */

export const metadata: Metadata = {
  title: "Service areas — Couranr",
  description: MARKETS_PUBLIC_COPY,
};

/*
 * There is deliberately NO per-market note here.
 *
 * The first draft carried one line per market ("the northern end of the
 * corridor", and so on), keyed by the market's name. `tests/decision-registry`
 * rejected it and was right twice over: keying prose by a literal market name
 * puts a copy of MKT-001 in this file that a registry rename would silently
 * de-sync, and the obvious fix — keying by position in MARKETED_MARKETS —
 * would have been WRONG, because the registry's order is not the geographic
 * one. Woodbridge sits between DC and Stafford on the road and third in the
 * registry.
 *
 * The corridor map above already carries the geography, from real coordinates.
 * These cards carry the governed fact: which markets are named.
 */

export default function Page() {
  return (
    <div className="cr-mkt">
      {/* ─── 1 ────────────────────── areas-hero / editorial-statement ─── */}
      <section
        className="cr-mkt-editorial cr-mkt-editorial--hero"
        aria-labelledby="a1-h"
        data-couranr-section="areas-hero"
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
        <h1 id="a1-h" className="cr-type-statement">
          Local, and honest about it.
        </h1>
        <p className="cr-mkt-editorial__body cr-type-lead">
          {MARKETS_PUBLIC_COPY} Couranr would rather tell you exactly where it runs
          than claim a map it cannot serve.
        </p>
        <div className="cr-mkt-cta-row">
          <Link href="/estimate" className="cr-button cr-button--primary cr-button--lg">
            Estimate a delivery
          </Link>
        </div>
      </section>

      {/* ─── 2 ────────────────────────────── corridor / image-narrative ─── */}
      <section
        className="cr-mkt-narrative cr-mkt-narrative--reverse"
        aria-labelledby="a2-h"
        data-couranr-section="corridor"
        data-composition="image-narrative"
        data-image-led="true"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <div className="cr-mkt-narrative__copy">
          <h2 id="a2-h" className="cr-type-marketing-section">
            One corridor, four markets
          </h2>
          <p className="cr-type-lead">
            Couranr runs a single north–south corridor rather than scattered
            islands, which is why a delivery between two of these markets is an
            ordinary run rather than a special case.
          </p>
          {/* NOT wrapped in a <p>: `Text` renders one, `<p>` cannot nest, and
              the browser auto-closes the outer tag — which made the server HTML
              and the client DOM disagree and threw React #418 at every width.
              Caught by Gate B's console-error check, invisible to the eye. */}
          <Text muted size="sm">
            A schematic at real relative positions — not a service-area boundary.
            Couranr does not publish a radius or a ZIP list, because a line on a
            map would be a promise it has not made.
          </Text>
        </div>
        <div className="cr-mkt-narrative__visual">
          <ServiceCorridorMap className="cr-mkt-map cr-mkt-map--large" />
        </div>
      </section>

      {/* ─── 3 ───────────────── markets / structured-information-block ─── */}
      {/* Registry-required state: primary market. The one grid-dominant
          section §27.1 allows this page. */}
      <section
        className="cr-mkt-section"
        aria-labelledby="a3-h"
        data-couranr-section="markets"
        data-composition="structured-information-block"
        data-image-led="false"
        data-grid-dominant="true"
        data-product-proof="false"
      >
        <h2 id="a3-h" className="cr-type-marketing-section">
          The named markets
        </h2>
        <Text muted className="cr-type-lead">
          These {MARKETED_MARKETS.length} are what Couranr markets today. Anywhere else
          is a request Couranr reads, not one it refuses.
        </Text>
        <ul className="cr-mkt-markets" aria-label="Named Couranr markets">
          {MARKETED_MARKETS.map((m) => (
            <li key={m} className="cr-mkt-market">
              <span className="cr-mkt-market__label">Primary market</span>
              <span className="cr-mkt-market__name cr-type-card-title">{m}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ─── 4 ─────────────────────────────── surrounding / split-story ─── */}
      {/* Registry-required state: surrounding area. */}
      <section
        className="cr-mkt-split"
        aria-labelledby="a4-h"
        data-couranr-section="surrounding"
        data-composition="split-story"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <div className="cr-mkt-split__lead">
          <h2 id="a4-h" className="cr-type-marketing-section">
            Surrounding areas
          </h2>
          <Text muted className="cr-type-lead">
            Distance is measured, not typed. Which town name you enter changes
            nothing — the quote is computed on the actual driving distance.
          </Text>
        </div>
        <ul className="cr-mkt-outcomes">
          <li className="cr-mkt-outcomes__item">
            A delivery that starts or ends near a named market is usually an
            ordinary run.
          </li>
          <li className="cr-mkt-outcomes__item">
            The first {MILE_TIERS[0].fromMile - 1} loaded miles are in the base price;
            after that the published tiers apply, from{" "}
            {dollars(MILE_TIERS[0].perMileCents)} per mile.
          </li>
          <li className="cr-mkt-outcomes__item">
            Past {MANUAL_QUOTE_OVER_MILES} loaded miles Couranr quotes by hand rather
            than returning a number automatically.
          </li>
          <li className="cr-mkt-outcomes__item">
            Enter the real addresses in an estimate and you will see the real answer.
          </li>
        </ul>
      </section>

      {/* ─── 5 ───────── extended-review / structured-information-block ─── */}
      {/* Registry-required state: extended-distance review. */}
      <section
        className="cr-mkt-section"
        aria-labelledby="a5-h"
        data-couranr-section="extended-review"
        data-composition="structured-information-block"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        {/* The registry's three required states are named on the page:
            "Primary market" labels the market cards, "Surrounding areas" is the
            heading above, and this is the third. */}
        <span className="cr-type-label">Extended-distance review</span>
        <h2 id="a5-h" className="cr-type-marketing-section">
          Outside the area? Couranr looks before it answers.
        </h2>
        <dl className="cr-mkt-schedule">
          <div className="cr-mkt-schedule__row cr-mkt-schedule__row--stacked">
            <dt>No silent ZIP rejection</dt>
            <dd>
              Couranr never silently rejects a request by ZIP code. There is no form
              here that declines to submit.
            </dd>
          </div>
          <div className="cr-mkt-schedule__row cr-mkt-schedule__row--stacked">
            <dt>Captured for Couranr review</dt>
            <dd>
              Longer or out-of-area requests go to Couranr Operations, who read them
              and reply.
            </dd>
          </div>
          <div className="cr-mkt-schedule__row cr-mkt-schedule__row--stacked">
            <dt>A real answer either way</dt>
            <dd>
              A workable quote or a clear no — with the reason — instead of silence.
            </dd>
          </div>
        </dl>
      </section>

      {/* ─── 6 ─────────────────────── closing / full-bleed-interruption ─── */}
      <section
        className="cr-mkt-closing"
        aria-labelledby="a6-h"
        data-couranr-section="closing"
        data-composition="full-bleed-interruption"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <h2 id="a6-h" className="cr-mkt-h2-inverse cr-type-statement">
          If your delivery starts here, start the estimate.
        </h2>
        <div className="cr-mkt-cta-row">
          <Link href="/estimate" className="cr-button cr-button--primary cr-button--lg">
            Estimate a delivery
          </Link>
          <Link href="/sign-up" className="cr-button cr-button--inverse cr-button--lg">
            Create your business account
          </Link>
        </div>
      </section>
    </div>
  );
}

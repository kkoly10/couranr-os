import Link from "next/link";
import type { Metadata } from "next";
import { Table, TableScroll, Text } from "@/components/couranr/primitives";
import {
  BASE_PRICE_CENTS,
  INCLUDED_LOADED_MILES,
  MANUAL_QUOTE_OVER_MILES,
  MANUAL_REVIEW_OVER_LB,
  MILE_TIERS,
  OVERNIGHT_WINDOW_COPY,
  PHOTO_OR_PIN_PROOF_CENTS,
  ROUTE_SAVER_STATUS_COPY,
  SERVICE_LEVEL_CENTS,
  SIGNATURE_CENTS,
  TRAFFIC_DELAY_CENTS_PER_MINUTE,
  TRAFFIC_DELAY_INCLUDED_MINUTES,
  TRAFFIC_REVIEW_OVER_MINUTES,
  WAITING_INCLUDED_MINUTES,
  WAITING_PER_MINUTE_CENTS,
  WEIGHT_INCLUDED_THROUGH_LB,
  WEIGHT_SURCHARGE_CENTS,
  WEIGHT_SURCHARGE_THROUGH_LB,
  dollars,
} from "@/lib/couranr/public/governed";
import {
  AuthorizationCaptureDiagram,
  LoadedMilesDiagram,
} from "@/components/couranr/marketing/PricingDiagrams";
import { PricingDetails } from "./PricingDetails";

/**
 * PUB-008 — the pricing page. Every number renders from
 * lib/couranr/public/governed.ts (registry-tested; PRC-001, MIL-001/002,
 * SUR-001/002, OVN-001, CAN-001, REF-001).
 *
 * Registry-required states: Standard (default), expanded pricing details
 * (PricingDetails disclosure), manual-quote notice (always visible).
 *
 * COMPOSITION is governed by §27.1 of
 * docs/couranr-mvp/brand/COURANR_VISUAL_SYSTEM_V2_2.md — eight sections, their
 * ids, their `data-composition` values and this page's own budget line, which
 * is NOT PUB-001's. §32.3 says the family pages' counts are page-specific:
 * /pricing has no governed photography and no product proof, and inventing
 * either to satisfy the homepage's floors is the template-filling §28 bans.
 *
 * The version this replaces was hero → three bordered Cards → notice →
 * disclosure of three more bordered Cards → section → closing: five card
 * surfaces and one composition repeated, the pattern §0 names.
 *
 * What must NOT appear, and why: no product prices or commission model (only
 * delivery and approved operating charges are Couranr's); no tax line
 * (TAX-001 unresolved); no rounded example totals (PRC-004 unresolved); no
 * bookable overnight (OVN-002 unresolved — request-only per OVN-001); no
 * internal driver-cost benchmarks (PRC-002).
 */

export const metadata: Metadata = {
  title: "Pricing — Couranr",
  description: `Delivery starts at ${dollars(BASE_PRICE_CENTS)} for the first ${INCLUDED_LOADED_MILES} loaded miles, with published mileage tiers and approved operating charges. No monthly fee during the pilot.`,
};

/** SUR-001 service levels and OVN-001, as one ordered ladder. */
const SERVICE_LEVELS = [
  {
    name: "Standard",
    charge: "Included",
    note: "The base delivery. Scheduled inside operating hours.",
  },
  {
    name: "Priority",
    charge: `+${dollars(SERVICE_LEVEL_CENTS.priority)}`,
    note: "Moved ahead of standard work on the same day.",
  },
  {
    name: "Rush",
    charge: `+${dollars(SERVICE_LEVEL_CENTS.rush)}`,
    note: "The fastest level Couranr offers. Never stacks with overnight.",
  },
  {
    name: `Overnight (${OVERNIGHT_WINDOW_COPY})`,
    charge: `+${dollars(SERVICE_LEVEL_CENTS.overnight)}`,
    note: "Request-only, when Couranr enables and confirms. There is no way to book it here.",
  },
];

/** SUR-001's per-item charges that are neither service level nor weight. */
const OPERATING_CHARGES = [
  { name: "Signature on delivery", charge: `+${dollars(SIGNATURE_CENTS)}` },
  {
    name: "Photo or PIN proof",
    charge: PHOTO_OR_PIN_PROOF_CENTS === 0 ? "Included" : `+${dollars(PHOTO_OR_PIN_PROOF_CENTS)}`,
  },
  {
    name: "Waiting time",
    charge: `First ${WAITING_INCLUDED_MINUTES} min included, then ${dollars(WAITING_PER_MINUTE_CENTS)}/min`,
  },
  {
    name: "Predicted traffic delay",
    charge: `First ${TRAFFIC_DELAY_INCLUDED_MINUTES} min included, then ${dollars(TRAFFIC_DELAY_CENTS_PER_MINUTE)}/min`,
  },
];

export default function Page() {
  return (
    <div className="cr-mkt">
      {/* ─── 1 ───────────────────── pricing-hero / editorial-statement ─── */}
      <section
        className="cr-mkt-editorial cr-mkt-editorial--hero"
        aria-labelledby="p1-h"
        data-couranr-section="pricing-hero"
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
        <h1 id="p1-h" className="cr-type-statement">
          Clear pricing before approval.
        </h1>
        <p className="cr-mkt-editorial__body cr-type-lead">
          Every quote is computed server-side, in exact cents, from the numbers on
          this page. No monthly fee during the pilot, no product-sales commission,
          and every estimate remains subject to Couranr confirmation.
        </p>
        <div className="cr-mkt-cta-row">
          <Link href="/estimate" className="cr-button cr-button--primary cr-button--lg">
            Estimate a delivery
          </Link>
        </div>
      </section>

      {/* ─── 2 ──────────────────── base-price / full-bleed-interruption ─── */}
      <section
        className="cr-mkt-band"
        aria-labelledby="p2-h"
        data-couranr-section="base-price"
        data-composition="full-bleed-interruption"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <div className="cr-mkt-band__inner">
          <div className="cr-mkt-band__copy">
            <h2 id="p2-h" className="cr-mkt-band__h2 cr-type-marketing-section">
              One base price, and it covers the first {INCLUDED_LOADED_MILES} loaded miles
            </h2>
            <p className="cr-mkt-band__body">
              Loaded miles are the miles your package actually travels, measured
              server-side from the real addresses — not the towns you typed.
              Everything past {INCLUDED_LOADED_MILES} loaded miles is billed by the
              mile, and part of a mile is billed as part of a mile — nothing is
              rounded up.
            </p>
            <p className="cr-mkt-band__note">
              Your business or your customer can pay, chosen per delivery.
            </p>
          </div>
          <div className="cr-mkt-band__figure">
            <span className="cr-mkt-band__label">Starting at</span>
            <span className="cr-mkt-band__price cr-type-metric">
              {dollars(BASE_PRICE_CENTS)}
            </span>
            <span className="cr-mkt-band__label">
              per delivery · first {INCLUDED_LOADED_MILES} loaded miles
            </span>
          </div>
        </div>
      </section>

      {/* ─── 3 ───────────────── mileage / structured-information-block ─── */}
      {/* A data table, not a card grid — see §27.1's definition of
          grid-dominant. §19.7 names pricing as the block's own use case. */}
      <section
        className="cr-mkt-section"
        aria-labelledby="p3-h"
        data-couranr-section="mileage"
        data-composition="structured-information-block"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <h2 id="p3-h" className="cr-type-marketing-section">
          Additional miles, by tier
        </h2>
        <Text muted className="cr-type-lead">
          Tiered by distance, not one flat rate — a fourteen-mile run is not priced
          like a ninety-mile one.
        </Text>
        {/* CONCEPT_USAGE_MATRIX.md panel D, built natively. It sits ABOVE the
            schedule because the schedule answers "how much" and this answers
            "from where" — a reader who meets the tiers first has to work out
            what a loaded mile is from a table. Every figure in it resolves from
            `governed.ts`; the concept board's own numbers are not used. */}
        <LoadedMilesDiagram />
        <TableScroll>
          <Table>
            <thead>
              <tr>
                <th scope="col">Loaded miles</th>
                <th scope="col">Per mile</th>
              </tr>
            </thead>
            <tbody>
              {MILE_TIERS.map((t) => (
                <tr key={t.overMiles}>
                  <td>
                    Over {t.overMiles} through {t.throughMiles}
                  </td>
                  <td>{dollars(t.perMileCents)}</td>
                </tr>
              ))}
              <tr>
                <td>Over {MANUAL_QUOTE_OVER_MILES}</td>
                <td>Couranr review and a manual quote — never an automatic one</td>
              </tr>
            </tbody>
          </Table>
        </TableScroll>
      </section>

      {/* ─── 4 ──────────────────────────── service-levels / split-story ─── */}
      <section
        className="cr-mkt-split"
        aria-labelledby="p4-h"
        data-couranr-section="service-levels"
        data-composition="split-story"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <div className="cr-mkt-split__lead">
          <h2 id="p4-h" className="cr-type-marketing-section">
            How fast, and what that costs
          </h2>
          <Text muted className="cr-type-lead">
            One ladder, applied to the base price. Rush and overnight never stack.
          </Text>
        </div>
        <dl className="cr-mkt-schedule">
          {SERVICE_LEVELS.map((s) => (
            <div key={s.name} className="cr-mkt-schedule__row cr-mkt-schedule__row--stacked">
              <dt>
                {s.name}
                <span className="cr-mkt-schedule__charge">{s.charge}</span>
              </dt>
              <dd>{s.note}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ─── 5 ────────── operating-charges / structured-information-block ─── */}
      <section
        className="cr-mkt-section"
        aria-labelledby="p5-h"
        data-couranr-section="operating-charges"
        data-composition="structured-information-block"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <h2 id="p5-h" className="cr-type-marketing-section">
          Approved operating charges
        </h2>
        <Text muted className="cr-type-lead">
          Applied only when selected or required. Nothing here is a surprise line on
          an invoice — it is all quoted before you approve.
        </Text>
        <dl className="cr-mkt-schedule">
          {OPERATING_CHARGES.map((c) => (
            <div key={c.name} className="cr-mkt-schedule__row">
              <dt>{c.name}</dt>
              <dd>{c.charge}</dd>
            </div>
          ))}
          <div className="cr-mkt-schedule__row">
            <dt>Weight</dt>
            <dd>
              Included through {WEIGHT_INCLUDED_THROUGH_LB} lb, then{" "}
              {dollars(WEIGHT_SURCHARGE_CENTS)} through {WEIGHT_SURCHARGE_THROUGH_LB} lb.
              Over {WEIGHT_SURCHARGE_THROUGH_LB} lb is a Large Item and Couranr quotes it.
            </dd>
          </div>
          <div className="cr-mkt-schedule__row">
            <dt>Route Saver</dt>
            <dd>{ROUTE_SAVER_STATUS_COPY}</dd>
          </div>
        </dl>

        {/* Registry-required state: expanded pricing details. */}
        <PricingDetails
          weightRows={[
            { label: `Through ${WEIGHT_INCLUDED_THROUGH_LB} lb`, price: "Included" },
            {
              label: `Over ${WEIGHT_INCLUDED_THROUGH_LB} through ${WEIGHT_SURCHARGE_THROUGH_LB} lb`,
              price: `+${dollars(WEIGHT_SURCHARGE_CENTS)}`,
            },
            { label: `Over ${WEIGHT_SURCHARGE_THROUGH_LB} lb`, price: "Large Item — Couranr quotes it" },
          ]}
          overnightCents={SERVICE_LEVEL_CENTS.overnight}
          waitingIncludedMinutes={WAITING_INCLUDED_MINUTES}
          waitingPerMinuteCents={WAITING_PER_MINUTE_CENTS}
          routeSaverStatusCopy={ROUTE_SAVER_STATUS_COPY}
          trafficIncludedMinutes={TRAFFIC_DELAY_INCLUDED_MINUTES}
          trafficPerMinuteCents={TRAFFIC_DELAY_CENTS_PER_MINUTE}
          trafficReviewOverMinutes={TRAFFIC_REVIEW_OVER_MINUTES}
        />
      </section>

      {/* ─── 6 ──────────────────── manual-quote / editorial-statement ─── */}
      {/* Registry-required state: manual-quote notice, ALWAYS visible. */}
      <section
        className="cr-mkt-editorial cr-mkt-editorial--wide"
        aria-labelledby="p6-h"
        data-couranr-section="manual-quote"
        data-composition="editorial-statement"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        {/* The registry names this state "manual-quote notice", so the page
            says so. A required state a reader cannot name is a required state
            nobody can check for. */}
        <span className="cr-type-label">Manual quote notice</span>
        <h2 id="p6-h" className="cr-type-statement">
          Some requests get a person, not a formula.
        </h2>
        <p className="cr-mkt-editorial__body cr-type-lead">
          Requests over {MANUAL_QUOTE_OVER_MILES} loaded miles, over{" "}
          {MANUAL_REVIEW_OVER_LB} lb, or with unusual handling are captured and quoted
          by hand instead of returning an automatic number Couranr cannot stand
          behind. An out-of-area request is captured for review too — Couranr never
          silently rejects a request by ZIP code.
        </p>
      </section>

      {/* ─── 7 ──────────────────────────────── who-pays / split-story ─── */}
      <section
        className="cr-mkt-split"
        aria-labelledby="p7-h"
        data-couranr-section="who-pays"
        data-composition="split-story"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <div className="cr-mkt-split__lead">
          <h2 id="p7-h" className="cr-type-marketing-section">
            Who pays, and when it is charged
          </h2>
          <Text muted className="cr-type-lead">
            Chosen per delivery. No split payments during the MVP, and no customer
            account required for the payment link.
          </Text>
        </div>
        {/* CAP-001's order. This was a ruled list of the same five statements;
            what it did not say is the part merchants actually get wrong, which
            is WHEN the money moves. CONCEPT_USAGE_MATRIX.md panel E, built
            natively: each step now carries its own money state as a word, a
            shape and only then a tint. The statements are unchanged. */}
        <AuthorizationCaptureDiagram />
      </section>

      {/* ─── 8 ─────────────────────── closing / full-bleed-interruption ─── */}
      <section
        className="cr-mkt-closing"
        aria-labelledby="p8-h"
        data-couranr-section="closing"
        data-composition="full-bleed-interruption"
        data-image-led="false"
        data-grid-dominant="false"
        data-product-proof="false"
      >
        <h2 id="p8-h" className="cr-mkt-h2-inverse cr-type-statement">
          Know the estimate before anyone approves.
        </h2>
        <div className="cr-mkt-cta-row">
          <Link href="/sign-up" className="cr-button cr-button--primary cr-button--lg">
            Create business account
          </Link>
          <Link href="/estimate" className="cr-button cr-button--inverse cr-button--lg">
            Estimate a delivery
          </Link>
        </div>
      </section>
    </div>
  );
}

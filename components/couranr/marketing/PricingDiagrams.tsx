import * as React from "react";
import {
  BASE_PRICE_CENTS,
  INCLUDED_LOADED_MILES,
  MANUAL_QUOTE_OVER_MILES,
  MILE_TIERS,
  dollars,
} from "@/lib/couranr/public/governed";
import { IconCheck, IconLock, IconPin, IconStore } from "./MarketingIcons";

/**
 * The two native explanatory diagrams PUB-008 gained in the 2026-08-28 visual
 * batch. Both are approved by name — CONCEPT_USAGE_MATRIX.md panels D and E —
 * and both are the only panels on that board approved for production.
 *
 * NATIVE, NOT THE CONCEPT ART. The board they come from is a generated image
 * carrying a substitute Couranr mark, generated lettering and made-up numbers.
 * It is reference. These are DOM, they inherit the type scale and the tokens,
 * their labels are real text that reflows and can be selected and read aloud,
 * and every number resolves from `lib/couranr/public/governed.ts` at render
 * time. Not one figure below is typed in.
 *
 * NOT A MAP. The loaded-miles guide is a schematic of a price, not a route.
 * SVC-002 is unresolved, so nothing here may imply a radius, a boundary or a
 * geography — which is also why the track is an abstract line and the endpoints
 * are a shop and a pin rather than two places.
 *
 * WITHOUT COLOUR. IMPLEMENTATION_SPEC.md §12 requires both diagrams to work
 * without colour, and §7.2 says "do not rely on color alone to distinguish
 * authorized vs captured". Every state here is carried three ways: a WORD, a
 * SHAPE (solid track against dashed; padlock against tick), and only then a
 * tint. Rendered in grayscale, both still read.
 */

/** Cheapest and dearest per-mile tier, so the range is derived, not typed. */
function tierRange(): { low: number; high: number } {
  const rates = MILE_TIERS.map((t) => t.perMileCents);
  return { low: Math.min(...rates), high: Math.max(...rates) };
}

/**
 * MIL-001/MIL-002 as a schematic: what the base price covers, and where
 * per-mile pricing starts.
 *
 * The list is ordered because the thing being described is a journey, and a
 * screen reader should meet pickup, then the included leg, then the billable
 * leg, then drop-off — the same order the eye travels. The connector is drawn
 * by CSS on the list items, so it is never something assistive technology has
 * to step over.
 */
export function LoadedMilesDiagram() {
  const { low, high } = tierRange();
  const firstBillable = INCLUDED_LOADED_MILES + 1;

  return (
    <figure className="cr-mkt-miles">
      <ol className="cr-mkt-miles__track">
        <li className="cr-mkt-miles__node">
          <span className="cr-mkt-miles__glyph" aria-hidden="true">
            <IconStore />
          </span>
          <span className="cr-mkt-miles__node-label">Pickup</span>
          <span className="cr-mkt-miles__node-note">Your counter</span>
        </li>

        <li className="cr-mkt-miles__leg cr-mkt-miles__leg--included">
          <span className="cr-mkt-miles__leg-rule" aria-hidden="true" />
          <span className="cr-mkt-miles__leg-title">
            First {INCLUDED_LOADED_MILES} loaded miles
          </span>
          <span className="cr-mkt-miles__leg-note">
            Included in the {dollars(BASE_PRICE_CENTS)} base price. No per-mile charge.
          </span>
        </li>

        <li className="cr-mkt-miles__node">
          <span className="cr-mkt-miles__glyph cr-mkt-miles__glyph--tick" aria-hidden="true" />
          <span className="cr-mkt-miles__node-label">{INCLUDED_LOADED_MILES} miles</span>
          <span className="cr-mkt-miles__node-note">Where per-mile pricing starts</span>
        </li>

        <li className="cr-mkt-miles__leg cr-mkt-miles__leg--tiered">
          <span className="cr-mkt-miles__leg-rule" aria-hidden="true" />
          <span className="cr-mkt-miles__leg-title">Mile {firstBillable} onward</span>
          <span className="cr-mkt-miles__leg-note">
            Priced by tier, {dollars(low)} to {dollars(high)} a mile — the table below is
            the schedule.
          </span>
        </li>

        <li className="cr-mkt-miles__node">
          <span className="cr-mkt-miles__glyph" aria-hidden="true">
            <IconPin />
          </span>
          <span className="cr-mkt-miles__node-label">Drop-off</span>
          <span className="cr-mkt-miles__node-note">Your customer</span>
        </li>
      </ol>

      <figcaption className="cr-mkt-miles__caption">
        <strong>Loaded miles</strong> are the miles your order is actually on the
        vehicle — pickup to drop-off. Getting to you does not count. Over{" "}
        {MANUAL_QUOTE_OVER_MILES} loaded miles Couranr quotes the delivery by hand
        rather than pricing it automatically. This is a diagram of the price, not a
        map: Couranr publishes no radius or boundary.
      </figcaption>
    </figure>
  );
}

/**
 * CAP-001 as a sequence with the money state made explicit at every step.
 *
 * The page already carried these five statements as a ruled list, and the
 * statements are unchanged — what was missing is the thing merchants actually
 * get wrong, which is WHEN the money moves. Each step now carries its own state,
 * and the state is a word before it is anything else.
 */
const PAYMENT_SEQUENCE = [
  {
    title: "Quote accepted",
    body: "The price is computed server-side, in exact cents, and accepted before anything else happens.",
    state: "Nothing charged",
    kind: "none",
  },
  {
    title: "Payment authorized",
    body: "A payment method is confirmed and the amount is authorized.",
    state: "Held, not taken",
    kind: "held",
  },
  {
    title: "Order marked ready",
    body: "You prepare the order and mark it ready. Couranr does not dispatch against an order that is not.",
    state: "Still held",
    kind: "held",
  },
  {
    title: "Couranr confirmation",
    body: "Couranr Operations reviews the request and confirms the schedule and the vehicle.",
    state: "Still held",
    kind: "held",
  },
  {
    title: "Captured",
    body: "Only now is the payment taken and the delivery assigned to a Couranr-managed driver.",
    state: "Charged",
    kind: "captured",
  },
] as const;

export function AuthorizationCaptureDiagram() {
  return (
    <ol className="cr-mkt-paystates" aria-label="When the money moves, in order">
      {PAYMENT_SEQUENCE.map((s, i) => (
        <li key={s.title} className="cr-mkt-paystates__step">
          <span className="cr-mkt-paystates__index" aria-hidden="true">
            {i + 1}
          </span>
          <div className="cr-mkt-paystates__copy">
            <h3 className="cr-mkt-paystates__title">{s.title}</h3>
            <p className="cr-mkt-paystates__body">{s.body}</p>
          </div>
          {/*
            THREE SIGNALS, NOT ONE. The word is the state. The glyph is a second,
            colour-independent signal — a closed padlock for held money, a tick
            for taken money, and nothing at all before either applies. The tint
            is third and carries no information on its own, which is what §23.5
            and IMPLEMENTATION_SPEC.md §7.2 both require.
          */}
          <span className={`cr-mkt-paystates__state cr-mkt-paystates__state--${s.kind}`}>
            <span className="cr-mkt-paystates__state-glyph" aria-hidden="true">
              {s.kind === "held" ? <IconLock /> : s.kind === "captured" ? <IconCheck /> : null}
            </span>
            {s.state}
          </span>
        </li>
      ))}
    </ol>
  );
}

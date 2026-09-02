/**
 * GOVERNED public-copy values — the one module every public page imports its
 * numbers and market names from.
 *
 * Every value here is transcribed from the root `02_DECISION_REGISTRY.json`
 * with its decision ID, and `tests/couranr-public-claims.test.ts` asserts this
 * module AGREES with the registry — so a registry change that this file misses
 * fails the suite instead of shipping a stale price.
 *
 * NEVER read pricing from a legacy delivery policy module. The $15 / 4 mi /
 * $1.75 engine and its routes are RETIRED by PRC-005 and no longer exist.
 *
 * Formatting helpers render integer cents; nothing here rounds. The historical
 * $0.25 rounding rule is RETIRED by PRC-005 — exact cents, always.
 */

/** PRC-001 (amended by PRC-005) — $7.99 base, covers the first 2 loaded miles. */
export const BASE_PRICE_CENTS = 799;
/** MIL-001 (amended by MIL-003) — included loaded miles. Mileage is never rounded up. */
export const INCLUDED_LOADED_MILES = 2;

/**
 * MIL-002 (amended by MIL-004) — per-mile rates in cents, over the included
 * allowance. Over 25 loaded miles: manual review, never an automatic price.
 */
export const MILE_TIERS = [
  { overMiles: 2, throughMiles: 10, perMileCents: 125 },
  { overMiles: 10, throughMiles: 25, perMileCents: 150 },
] as const;
export const MANUAL_QUOTE_OVER_MILES = 25;

/** SUR-001 (amended by SUR-003) — service levels. Rush and overnight NEVER stack. */
export const SERVICE_LEVEL_CENTS = {
  priority: 500,
  rush: 1000,
  /** OVN-001 — request-only, 18:00–06:00, when Couranr enables and confirms. */
  overnight: 3000,
} as const;

/** SUR-001 (amended by SUR-003) — per-item surcharges. */
export const SIGNATURE_CENTS = 300;
export const PHOTO_OR_PIN_PROOF_CENTS = 0;

/**
 * SUR-001 (amended by SUR-003) — waiting. Governed authority, not yet a runtime
 * charge: nothing in the fulfillment or payment layer assesses it, and this
 * module says so rather than implying a meter that does not exist.
 */
export const WAITING_INCLUDED_MINUTES = 10;
export const WAITING_PER_MINUTE_CENTS = 75;
export const WAITING_RENTED_VEHICLE_PER_MINUTE_CENTS = 100;
export const WAITING_OPS_DECISION_AFTER_MINUTES = 30;

/**
 * SUR-001 (amended by SUR-003) — weight. 0–25 lb included; over 25 through
 * 50 lb adds a flat charge; over 50 lb is a Large Item and leaves the
 * automatic lane. A band is a CHARGE, never a claimed weight.
 */
export const WEIGHT_INCLUDED_THROUGH_LB = 25;
export const WEIGHT_SURCHARGE_THROUGH_LB = 50;
export const WEIGHT_SURCHARGE_CENTS = 300;
export const MANUAL_REVIEW_OVER_LB = 50;

/**
 * TRF-001 — predicted traffic delay, priced UP FRONT from Google route
 * evidence. The first 5 minutes are included; beyond that, per minute; beyond
 * 25 minutes the route needs review. Never a post-delivery meter, and never a
 * clock-based "rush hour" guess.
 */
export const TRAFFIC_DELAY_INCLUDED_MINUTES = 5;
export const TRAFFIC_DELAY_CENTS_PER_MINUTE = 45;
export const TRAFFIC_REVIEW_OVER_MINUTES = 25;

/**
 * SUR-002 (amended by FND-005) — Route Saver is a DEFERRED future capability.
 * There is deliberately no public price: the historical "$16.99 per stop"
 * claim is retired, and no replacement may be advertised until the Route Run
 * aggregate and its economics exist.
 */
export const ROUTE_SAVER_STATUS_COPY =
  "Planned. Not available during the pilot, and not yet priced.";

/**
 * CAN-001 — cancellation charges by lifecycle stage, integer cents.
 *
 * Governed authority. Like waiting, this is NOT yet a runtime charge: no
 * lifecycle or payment path assesses it.
 */
export const CANCELLATION_CENTS = {
  beforeConfirmation: 0,
  /** Authorization is RELEASED, not captured and refunded. */
  afterAuthorizationBeforeConfirmation: 0,
  /** Couranr caused the cancellation or failure — never charged. */
  couranrCaused: 0,
  afterConfirmationBeforeArrival: 800,
  /** Driver arrived and pickup could not occur. */
  afterArrivalUnavailable: 1500,
} as const;

/**
 * REF-001 (amended by REF-002) — a physical return is priced as a NEW physical
 * route under Pricing V2, from the failed or current location to the return
 * destination. The historical "70% of the original, $14.99 minimum" rule is
 * retired. When Couranr caused the failure, the payer owes nothing.
 */
export const RETURN_PRICING_COPY =
  "A return is priced as a new delivery for the return trip. If Couranr caused the problem, the return is free.";

/** OVN-001 — the overnight window, as copy. */
export const OVERNIGHT_WINDOW_COPY = "6:00 PM to 6:00 AM";

/** HRS-001 / HRS-002 — Monday–Friday 06:00–18:00 America/New_York. */
export const OPERATING_DAYS_COPY = "Monday through Friday";
export const OPERATING_WINDOW_COPY = "6:00 AM to 6:00 PM Eastern";
export const SAME_DAY_CUTOFF_COPY = "4:00 PM";

/**
 * MKT-001 — the marketed markets, IN REGISTRY ORDER, and the one approved
 * public sentence. Maryland is excluded from initial marketing. SVC-002 (the
 * precise boundary) is UNRESOLVED: never render a radius, polygon, or ZIP
 * list, and never phrase out-of-area as rejection — it is capture-for-review.
 */
export const MARKETED_MARKETS = [
  "Washington, DC",
  "Stafford",
  "Woodbridge",
  "Fredericksburg",
] as const;
export const MARKETS_PUBLIC_COPY =
  "Local business delivery across DC, Stafford, Woodbridge, Fredericksburg, and surrounding areas.";

/**
 * MKT-006 — the same four markets, framed for a person rather than a merchant.
 *
 * MKT-001's sentence says "Local BUSINESS delivery across …". That was correct
 * while Couranr was a merchant-only brand; MKT-004 expanded it, and the
 * sentence then described the wrong product on the two surfaces MKT-004
 * created. It shipped on both `/` and `/sameday` — a consumer reading the Same
 * Day page was told Couranr delivers for businesses.
 *
 * PUB-012 and PUB-013 read this one. Every business surface still reads
 * `MARKETS_PUBLIC_COPY`, which is unchanged. Both name the same MKT-001
 * markets, and neither is typed into a page.
 */
export const MARKETS_PUBLIC_COPY_NEUTRAL =
  "Couranr delivers across DC, Stafford, Woodbridge, Fredericksburg, and surrounding areas.";

/** TRM-001 — the support sentence always carries its qualifier. */
export const SUPPORT_COPY =
  "In-app support with a 15-minute response target during operating hours.";

/** Renders integer cents as exact dollars. Never rounds — PRC-004 is unresolved. */
export function dollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

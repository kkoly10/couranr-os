/**
 * GOVERNED public-copy values — the one module every public page imports its
 * numbers and market names from.
 *
 * Every value here is transcribed from the root `02_DECISION_REGISTRY.json`
 * with its decision ID, and `tests/couranr-public-claims.test.ts` asserts this
 * module AGREES with the registry — so a registry change that this file misses
 * fails the suite instead of shipping a stale price.
 *
 * NEVER read pricing from `lib/delivery/policy.ts` — its $15 / 4 mi / $1.75
 * values are recorded defects (PRC-001 `conflict_with_current_code`).
 *
 * Formatting helpers render integer cents; nothing here rounds. PRC-004 (the
 * $0.25 rounding condition) is UNRESOLVED — exact cents, always.
 */

/** PRC-001 — $22.99 base, covers the first 3 loaded miles, integer cents. */
export const BASE_PRICE_CENTS = 2299;
/** MIL-001 — included loaded miles; mile 4 is the first billable mile. */
export const INCLUDED_LOADED_MILES = 3;

/** MIL-002 — per-mile tiers in cents. Over 100 miles: manual quote, never auto. */
export const MILE_TIERS = [
  { fromMile: 4, toMile: 10, perMileCents: 225 },
  { fromMile: 11, toMile: 25, perMileCents: 300 },
  { fromMile: 26, toMile: 50, perMileCents: 350 },
  { fromMile: 51, toMile: 75, perMileCents: 400 },
  { fromMile: 76, toMile: 100, perMileCents: 475 },
] as const;
export const MANUAL_QUOTE_OVER_MILES = 100;

/** SUR-001 — service levels. Rush and overnight NEVER stack. */
export const SERVICE_LEVEL_CENTS = {
  priority: 700,
  rush: 1200,
  /** OVN-001 — request-only, 18:00–06:00, when Couranr enables and confirms. */
  overnight: 3000,
} as const;

/** SUR-001 — per-item surcharges. */
export const ADDITIONAL_STOP_CENTS = 800;
export const SIGNATURE_CENTS = 300;
export const PHOTO_OR_PIN_PROOF_CENTS = 0;
export const WAITING_INCLUDED_MINUTES = 10;
export const WAITING_PER_MINUTE_CENTS = 75;

/** SUR-001 — weight bands in cents; over 200 lb is Couranr review. */
export const WEIGHT_BANDS = [
  { fromLb: 26, toLb: 50, cents: 1000 },
  { fromLb: 51, toLb: 75, cents: 2500 },
  { fromLb: 76, toLb: 150, cents: 5000 },
  { fromLb: 151, toLb: 200, cents: 8500 },
] as const;
export const MANUAL_REVIEW_OVER_LB = 200;

/** SUR-002 — Route Saver: from $16.99/stop, at least 3 stops, Couranr routes. */
export const ROUTE_SAVER_FROM_CENTS_PER_STOP = 1699;
export const ROUTE_SAVER_MIN_STOPS = 3;

/**
 * CAN-001 — cancellation charges by lifecycle stage, integer cents.
 *
 * These were typed directly into PUB-008's disclosure component. Money on a
 * public page belongs here, where `tests/couranr-public-claims.test.ts` checks
 * it against the registry — a typed-in 800 agrees with CAN-001 only until
 * CAN-001 changes, and nothing would have failed.
 */
export const CANCELLATION_CENTS = {
  beforeAuthorization: 0,
  /** Authorization is RELEASED, not captured and refunded. */
  afterAuthorizationBeforeConfirmation: 0,
  /** Couranr could not confirm — never charged. */
  couranrCannotConfirm: 0,
  afterConfirmationBeforeArrival: 800,
  /** Failed pickup attempt, plus approved waiting. */
  afterArrivalUnavailable: 1500,
} as const;

/** REF-001 — a return after pickup, as a percentage of the original with a floor. */
export const RETURN_PERCENT_OF_ORIGINAL = 70;
export const RETURN_MINIMUM_CENTS = 1499;

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

/** TRM-001 — the support sentence always carries its qualifier. */
export const SUPPORT_COPY =
  "In-app support with a 15-minute response target during operating hours.";

/** Renders integer cents as exact dollars. Never rounds — PRC-004 is unresolved. */
export function dollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

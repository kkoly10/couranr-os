/**
 * Canonical Couranr pricing policy constants.
 *
 * Every value here traces to a `decided` record in 02_DECISION_REGISTRY.json,
 * which in turn traces to Couranr_Claude_Code_Master_Package.md §4.
 *
 * This module is deliberately dependency-free: no React, Next.js, Supabase or
 * Stripe. It is pure arithmetic over integer cents.
 *
 * NOT the legacy policy. `lib/delivery/policy.ts` still holds the shipped-but-
 * wrong values ($15 / 4 miles / flat $1.75) and still serves legacy checkout.
 * Nothing here is wired into that path.
 */

/** Bumped whenever a value below changes. Recorded on every quote. */
export const COURANR_PRICING_POLICY_VERSION = "couranr-pricing-2026-07-31";

/* --------------------------------------------------------------- mileage */

/** PRC-001: base price, covering the first three loaded miles. */
export const BASE_PRICE_CENTS = 2299;

/** MIL-001: loaded miles included in the base price. */
export const INCLUDED_LOADED_MILES = 3;

/**
 * MIL-002: tiers over the included miles.
 *
 * `fromMile` 4 means "the fourth loaded mile", i.e. the distance interval
 * (3, 4]. A tier therefore covers the interval (fromMile - 1, toMile].
 */
export type MileageTier = {
  fromMile: number;
  toMile: number;
  perMileCents: number;
};

export const MILEAGE_TIERS: readonly MileageTier[] = [
  { fromMile: 4, toMile: 10, perMileCents: 225 },
  { fromMile: 11, toMile: 25, perMileCents: 300 },
  { fromMile: 26, toMile: 50, perMileCents: 350 },
  { fromMile: 51, toMile: 75, perMileCents: 400 },
  { fromMile: 76, toMile: 100, perMileCents: 475 },
];

/** MIL-002: beyond this, no automatic estimate is produced. */
export const MAX_AUTOMATIC_LOADED_MILES = 100;

/* -------------------------------------------------------- service levels */

/**
 * SUR-001. Overnight is a decided surcharge but is NOT offered by this
 * release, so it is deliberately absent from `ServiceLevel`; see
 * `QuoteInput.overnightRequested`.
 */
export type ServiceLevel = "standard" | "priority" | "rush";

export const SERVICE_LEVEL_CENTS: Record<ServiceLevel, number> = {
  standard: 0,
  priority: 700,
  rush: 1200,
};

export const SERVICE_LEVELS = Object.keys(SERVICE_LEVEL_CENTS) as ServiceLevel[];

/* -------------------------------------------------------------- add-ons */

/** SUR-001: per stop beyond the included first destination. */
export const ADDITIONAL_STOP_CENTS = 800;

/** SUR-001. */
export const SIGNATURE_CENTS = 300;

/** SUR-001: photo and PIN proof are included at no charge. */
export const PROOF_CENTS = 0;

/* --------------------------------------------------------------- weight */

/**
 * SUR-001 weight bands, expressed as inclusive upper bounds so the scale is
 * continuous. The authority states bands as "26–50 lb" etc.; a request of
 * 25.4 lb must land somewhere, so each band runs up to and including its
 * `maxLb`.
 */
export type WeightBand = { maxLb: number; cents: number };

export const WEIGHT_BANDS: readonly WeightBand[] = [
  { maxLb: 25, cents: 0 },
  { maxLb: 50, cents: 1000 },
  { maxLb: 75, cents: 2500 },
  { maxLb: 150, cents: 5000 },
  { maxLb: 200, cents: 8500 },
];

/** SUR-001: beyond this, no automatic estimate is produced. */
export const MAX_AUTOMATIC_WEIGHT_LB = 200;

/* ------------------------------------------------------------- unstated */

/**
 * PRC-004 is UNRESOLVED: the authority says the final total is rounded to the
 * nearest $0.25 "when the accepted pricing policy requires it", without saying
 * which policy, which totals, or in which direction. This engine therefore
 * applies NO $0.25 rounding and reports `roundingApplied: false`.
 */
export const QUARTER_ROUNDING_APPLIED = false;

/**
 * TAX-001 is UNRESOLVED. This engine returns a delivery subtotal and makes no
 * claim about tax in either direction.
 */
export const TAX_INCLUDED = false;

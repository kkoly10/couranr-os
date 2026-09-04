/**
 * Canonical Couranr Pricing Authority V2.
 *
 * Every value here traces to a `decided` record in 02_DECISION_REGISTRY.json.
 * Pricing V2 SUPERSEDES the historical $22.99 / first-3-mile model for NEW
 * quotes. Historical quotes are immutable and keep their own
 * `pricing_policy_version` and their own stored line items; nothing in this
 * module is ever used to reconstruct one.
 *
 * ONE UNIVERSAL CUSTOMER ENGINE. The same constants serve Couranr Business
 * merchant-paid, Couranr Business customer-paid, and future consumer Couranr
 * Same Day. There is deliberately NO merchant vertical/category input: a
 * restaurant, a bakery, a florist and a hardware store pay the same core fare
 * for the same physical shipment. Vertical may shape Smart Intake presets
 * later; it never touches the core delivery price.
 *
 * This module is dependency-free: no React, Next.js, Supabase or Stripe. It is
 * pure arithmetic over integer cents.
 */

/**
 * Recorded on every quote this engine mints. Bumped whenever a value below
 * changes, so a future V3 coexists with V2 rows rather than reinterpreting
 * them.
 */
export const COURANR_PRICING_POLICY_VERSION = "couranr-pricing-v2-2026-09-01";

/**
 * The superseded policy version. Retained ONLY so historical rows remain
 * identifiable and explainable. Never minted again — a guard in `quote.ts`
 * and a test both enforce that.
 */
export const COURANR_PRICING_POLICY_VERSION_V1_HISTORICAL =
  "couranr-pricing-2026-07-31";

/* --------------------------------------------------------------- mileage */

/** PRC-001 V2: base fare, covering the first two loaded miles. */
export const BASE_PRICE_CENTS = 799;

/** MIL-001 V2: loaded miles included in the base fare. */
export const INCLUDED_LOADED_MILES = 2;

/**
 * MIL-002 V2: rates above the included allowance.
 *
 * Each tier covers the half-open interval (`overMiles`, `throughMiles`], in
 * loaded miles. Mileage is NEVER rounded up to a whole mile — the engine works
 * in integer thousandths of a mile, which is the canonical precision the route
 * evidence and the quote row both carry.
 */
export type MileageTier = {
  overMiles: number;
  throughMiles: number;
  perMileCents: number;
};

export const MILEAGE_TIERS: readonly MileageTier[] = [
  { overMiles: 2, throughMiles: 10, perMileCents: 125 },
  { overMiles: 10, throughMiles: 25, perMileCents: 150 },
];

/** MIL-002 V2: beyond this, no automatic final price is produced. */
export const MAX_AUTOMATIC_LOADED_MILES = 25;

/* --------------------------------------------------------------- weight */

/**
 * SUR-001 V2 weight handling.
 *
 * 0–25 lb is included. Above 25 through 50 lb adds a flat handling charge.
 * Above 50 lb is a Large Item and leaves the automatic lane entirely.
 *
 * A BAND IS NOT A WEIGHT. Nothing here may be read back as "the parcel weighs
 * 50 lb"; the band only says which charge applies.
 */
export const WEIGHT_INCLUDED_THROUGH_LB = 25;
export const WEIGHT_SURCHARGE_THROUGH_LB = 50;
export const WEIGHT_SURCHARGE_CENTS = 300;

/** SUR-001 V2: above this the shipment is a Large Item and needs review. */
export const MAX_AUTOMATIC_WEIGHT_LB = WEIGHT_SURCHARGE_THROUGH_LB;

/* -------------------------------------------------------- service levels */

/**
 * SUR-001 V2. Overnight is a decided, governed product but is REQUEST-ONLY and
 * Couranr-confirmed, so it is not an automatically priced `ServiceLevel`; see
 * `QuoteInput.overnightRequested` and `OVERNIGHT_CENTS`.
 */
export type ServiceLevel = "standard" | "priority" | "rush";

export const SERVICE_LEVEL_CENTS: Record<ServiceLevel, number> = {
  standard: 0,
  priority: 500,
  rush: 1000,
};

export const SERVICE_LEVELS = Object.keys(SERVICE_LEVEL_CENTS) as ServiceLevel[];

/**
 * SUR-001 V2: the governed overnight amount. Request-only and
 * Couranr-confirmed, so the engine routes an overnight request to review
 * rather than charging it automatically. Rush and overnight never stack.
 */
export const OVERNIGHT_CENTS = 3000;

/* -------------------------------------------------------------- add-ons */

/** SUR-001 V2. */
export const SIGNATURE_CENTS = 300;

/** SUR-001 V2: photo and PIN proof are included at no charge. */
export const PROOF_CENTS = 0;

/* --------------------------------------------------------------- traffic */

/**
 * TRF-001: predicted-traffic pricing, quoted UP FRONT from canonical Mapbox
 * driving-traffic evidence — never from a clock-based "rush hour" guess, and never as a
 * post-delivery meter.
 *
 * `traffic_delay_seconds = max(traffic_aware_duration - static_duration, 0)`,
 * both durations coming from the same canonical Mapbox response as `duration`
 * and `duration_typical`.
 *
 * Once the payer accepts and authorizes the immutable quote, later real-world
 * traffic cannot raise that quote: the amount lives on the quote version, and
 * quote versions are append-only.
 */
export const TRAFFIC_DELAY_INCLUDED_SECONDS = 5 * 60;
export const TRAFFIC_DELAY_CENTS_PER_MINUTE = 45;
/**
 * QVL-001. How long an UNACCEPTED immediate quote stays current.
 *
 * The database is the enforcement point and server time is the authority -
 * `private.couranr_quote_version_is_expired` is what actually refuses a stale
 * acceptance. This constant exists so the application can say the same number
 * in copy and in tests without restating it, and
 * `tests/couranr-pricing.test.ts` asserts the two agree.
 */
export const QUOTE_VALIDITY_SECONDS = 900;

export const MAX_AUTOMATIC_TRAFFIC_DELAY_SECONDS = 25 * 60;

/* ------------------------------------------------------------- unstated */

/**
 * PRC-004: the historical "round to the nearest $0.25" rule is RETIRED. V2
 * money is exact integer cents with deterministic half-up rounding only where
 * fractional-cent arithmetic actually occurs (per-mile and per-minute rates).
 * No total is nudged to a quarter.
 */
export const QUARTER_ROUNDING_APPLIED = false;

/**
 * TAX-001 is UNRESOLVED, and tax is separate from the delivery subtotal in any
 * case. This engine returns a delivery subtotal and makes no claim about tax.
 */
export const TAX_INCLUDED = false;

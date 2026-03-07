import { COURIER_INSTANT_QUOTE_MAX_MILES } from "@/lib/serviceArea";

/**
 * Delivery policy constants
 *
 * Semantics:
 * - SERVICE AREA: where courier service is offered operationally (see `lib/serviceArea.ts`).
 * - INSTANT QUOTE MAX: self-serve quote boundary in the public UI.
 * - LONG DISTANCE FLAG: analytics/ops threshold for internal workflow/reporting.
 */
export const DELIVERY_POLICY_VERSION = "2026-03-04";

export const DELIVERY_BASE_FEE = 15;
export const DELIVERY_INCLUDED_MILES = 4;
export const DELIVERY_PER_MILE_RATE = 1.75;
export const DELIVERY_STOP_FEE = 6;
export const DELIVERY_RUSH_FEE = 10;
export const DELIVERY_SIGNATURE_FEE = 5;

export const DELIVERY_MAX_WEIGHT_LBS = 100;
export const DELIVERY_HEAVY_ITEM_THRESHOLD_LBS = 50;
export const DELIVERY_HEAVY_ITEM_SURCHARGE = 15;

// Policy threshold for ops/reporting flags (not an eligibility limit).
export const DELIVERY_LONG_DISTANCE_FLAG_MILES = 25;

// User-facing self-serve quote limit.
export const DELIVERY_INSTANT_QUOTE_MAX_MILES = COURIER_INSTANT_QUOTE_MAX_MILES;

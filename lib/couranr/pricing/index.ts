/**
 * Canonical Couranr pricing engine.
 *
 * Pure, dependency-free, integer-cent arithmetic. Not wired into legacy
 * checkout; `lib/delivery/policy.ts` and the existing checkout routes are
 * untouched by this module.
 */
export * from "./policy";
export * from "./types";
export { quoteDelivery, weightBandCents } from "./quote";

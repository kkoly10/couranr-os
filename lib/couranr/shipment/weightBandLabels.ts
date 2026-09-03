/**
 * Customer-facing labels for the governed weight bands (SUR-001 / SUR-003).
 *
 * The 25 lb boundary is INCLUSIVE on the included side: exactly 25 lb is
 * included and the +$3.00 handling charge starts strictly above it, so the
 * first band must read "25 lb or less" and the second "More than 25 lb" —
 * never "Under 25" / "25–50", which double-claim the boundary. Every
 * component that renders a band imports these strings so the boundary can
 * only ever be described one way; tests/couranr-weight-boundary.test.ts pins
 * the exact wording.
 *
 * These are LABELS only. The band ids (the option values, the stored fact
 * values) are governed by `lib/couranr/shipment/facts.ts` and never change
 * here.
 */
import type { WeightBand } from "./facts";

export const WEIGHT_BAND_LABELS: Record<Exclude<WeightBand, "unknown">, string> = {
  "0_25_lb": "25 lb or less",
  over_25_to_50_lb: "More than 25 lb, up to 50 lb",
  over_50_lb: "Over 50 lb",
};

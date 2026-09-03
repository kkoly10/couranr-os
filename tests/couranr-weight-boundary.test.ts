/**
 * The 25 lb / 50 lb commercial weight boundaries, at the boundary.
 *
 * Pricing V2 authority (SUR-001 amended by SUR-003): an exact weight of
 * 25 lb or LESS is included; MORE than 25 lb through 50 lb adds a flat
 * +$3.00; MORE than 50 lb is a Large Item and leaves the automatic lane.
 * Both boundaries are inclusive on the cheaper side — exactly 25.00 lb is
 * included and exactly 50.00 lb is +$3.00, never review. A merchant whose
 * scale reads 25.0 must never overpay because a label said "Under 25".
 *
 * The second half pins the rendered band labels to the unambiguous wording,
 * so a future relabel that reintroduces the "Under 25 / 25–50" double-claim
 * of the boundary fails here.
 */
import { describe, expect, it } from "vitest";
import { quoteDelivery } from "@/lib/couranr/pricing";
import type { QuoteInput } from "@/lib/couranr/pricing/types";
import { WEIGHT_BAND_LABELS } from "@/lib/couranr/shipment/weightBandLabels";

const base = (over: Partial<QuoteInput>): QuoteInput => ({
  loadedMiles: 5,
  weightLb: null,
  trafficDelaySeconds: 0,
  ...over,
});

function weightLine(r: ReturnType<typeof quoteDelivery>) {
  return r.lineItems.find((l) => l.code === "weight_band");
}

describe("exact-weight boundaries (25 lb inclusive-included, 50 lb inclusive-surcharge)", () => {
  it("24.99 lb — included: no weight modifier line, not review", () => {
    const r = quoteDelivery(base({ weightLb: 24.99 }));
    expect(r.quoteStatus).toBe("estimated");
    expect(r.reviewReasons).toEqual([]);
    expect(weightLine(r)).toBeUndefined();
  });

  it("exactly 25.00 lb — included: the merchant never overpays at the boundary", () => {
    const r = quoteDelivery(base({ weightLb: 25 }));
    expect(r.quoteStatus).toBe("estimated");
    expect(r.reviewReasons).toEqual([]);
    expect(weightLine(r)).toBeUndefined();
  });

  it("25.01 lb — +$3.00 weight_band modifier", () => {
    const r = quoteDelivery(base({ weightLb: 25.01 }));
    expect(r.quoteStatus).toBe("estimated");
    expect(weightLine(r)?.amountCents).toBe(300);
    expect(weightLine(r)?.unitAmountCents).toBe(300);
  });

  it("exactly 50.00 lb — still +$3.00, not review", () => {
    const r = quoteDelivery(base({ weightLb: 50 }));
    expect(r.quoteStatus).toBe("estimated");
    expect(r.reviewReasons).toEqual([]);
    expect(weightLine(r)?.amountCents).toBe(300);
  });

  it("50.01 lb — Large Item review, no modifier charged", () => {
    const r = quoteDelivery(base({ weightLb: 50.01 }));
    expect(r.quoteStatus).toBe("manual_review_required");
    expect(r.reviewReasons).toContain("large_item_review");
    expect(r.lineItems).toEqual([]);
    expect(r.deliverySubtotalCents).toBe(0);
  });

  it("75 lb — Large Item review, no modifier charged", () => {
    const r = quoteDelivery(base({ weightLb: 75 }));
    expect(r.quoteStatus).toBe("manual_review_required");
    expect(r.reviewReasons).toContain("large_item_review");
    expect(r.lineItems).toEqual([]);
    expect(r.deliverySubtotalCents).toBe(0);
  });
});

describe("band inputs price by band id, matching the exact-weight boundaries", () => {
  it("0_25_lb — no weight modifier", () => {
    const r = quoteDelivery(base({ weightBand: "0_25_lb" }));
    expect(r.quoteStatus).toBe("estimated");
    expect(weightLine(r)).toBeUndefined();
  });

  it("over_25_to_50_lb — +$3.00", () => {
    const r = quoteDelivery(base({ weightBand: "over_25_to_50_lb" }));
    expect(r.quoteStatus).toBe("estimated");
    expect(weightLine(r)?.amountCents).toBe(300);
  });

  it("over_50_lb — review, nothing charged", () => {
    const r = quoteDelivery(base({ weightBand: "over_50_lb" }));
    expect(r.quoteStatus).toBe("manual_review_required");
    expect(r.reviewReasons).toContain("large_item_review");
    expect(r.deliverySubtotalCents).toBe(0);
  });
});

describe("rendered band labels are unambiguous at exactly 25 lb", () => {
  it("carries exactly the three governed labels under the unchanged band ids", () => {
    // The exact strings, pinned. "Under 25 lb" / "25–50 lb" both claim the
    // 25.00 boundary; these wordings give it to the included band only,
    // matching the engine's <= comparisons.
    expect(WEIGHT_BAND_LABELS).toEqual({
      "0_25_lb": "25 lb or less",
      over_25_to_50_lb: "More than 25 lb, up to 50 lb",
      over_50_lb: "Over 50 lb",
    });
  });
});

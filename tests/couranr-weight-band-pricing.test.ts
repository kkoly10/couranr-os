/**
 * §9 canonical weight cutover — Pricing V2 consumes a confirmed band without
 * manufacturing pounds, and unknown weight never becomes a number.
 */
import { describe, expect, it } from "vitest";
import { quoteDelivery } from "@/lib/couranr/pricing";
import type { QuoteInput } from "@/lib/couranr/pricing/types";

const base = (over: Partial<QuoteInput>): QuoteInput => ({
  loadedMiles: 5,
  weightLb: null,
  trafficDelaySeconds: 0,
  ...over,
});

describe("band pricing parity with exact weights", () => {
  it("exact 20 lb and confirmed 0_25_lb band price identically", () => {
    const exact = quoteDelivery(base({ weightLb: 20 }));
    const band = quoteDelivery(base({ weightBand: "0_25_lb" }));
    expect(exact.quoteStatus).toBe("estimated");
    expect(band.quoteStatus).toBe("estimated");
    expect(band.deliverySubtotalCents).toBe(exact.deliverySubtotalCents);
    expect(band.lineItems.map((l) => l.code)).toEqual(exact.lineItems.map((l) => l.code));
  });

  it("exact 40 lb and confirmed over_25_to_50_lb band price identically (+$3)", () => {
    const exact = quoteDelivery(base({ weightLb: 40 }));
    const band = quoteDelivery(base({ weightBand: "over_25_to_50_lb" }));
    expect(exact.deliverySubtotalCents).toBe(band.deliverySubtotalCents);
    expect(band.lineItems.find((l) => l.code === "weight_band")?.amountCents).toBe(300);
  });

  it("over_50_lb band has NO automatic final price — Large Item review", () => {
    const r = quoteDelivery(base({ weightBand: "over_50_lb" }));
    expect(r.quoteStatus).toBe("manual_review_required");
    expect(r.reviewReasons).toContain("large_item_review");
    expect(r.deliverySubtotalCents).toBe(0);
    expect(r.lineItems).toEqual([]);
  });

  it("unknown band does not receive invented pounds — weight_unresolved review", () => {
    const r = quoteDelivery(base({ weightBand: "unknown" }));
    expect(r.quoteStatus).toBe("manual_review_required");
    expect(r.reviewReasons).toContain("weight_unresolved");
    expect(r.deliverySubtotalCents).toBe(0);
  });

  it("no weight input at all is unresolved review, not a validation failure", () => {
    const r = quoteDelivery(base({}));
    expect(r.quoteStatus).toBe("manual_review_required");
    expect(r.reviewReasons).toContain("weight_unresolved");
    expect(r.validationErrors).toEqual([]);
  });

  it("an exact weight WINS over a supplied band — the band is ignored, not merged", () => {
    // 20 lb exact with a (stale) over_25_to_50 band: the exact weight is the
    // better knowledge and there is no surcharge.
    const r = quoteDelivery(base({ weightLb: 20, weightBand: "over_25_to_50_lb" }));
    expect(r.quoteStatus).toBe("estimated");
    expect(r.lineItems.find((l) => l.code === "weight_band")).toBeUndefined();
  });

  it("a band outside the governed vocabulary is a validation failure, never priced", () => {
    const r = quoteDelivery(base({ weightBand: "about_30_lb" as never }));
    expect(r.quoteStatus).toBe("invalid");
    expect(r.validationErrors).toContain("weight_band_invalid");
  });

  it("no sentinel weights: the engine result never claims pounds it was not given", () => {
    // Structural: QuoteResult has no weight field to fabricate; the only
    // weight artifact is the surcharge line item, absent here.
    const r = quoteDelivery(base({ weightBand: "0_25_lb" })) as unknown as Record<string, unknown>;
    expect(r.weightLb).toBeUndefined();
    expect(r.weight_lb).toBeUndefined();
  });
});

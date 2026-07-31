import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADDITIONAL_STOP_CENTS,
  BASE_PRICE_CENTS,
  COURANR_PRICING_POLICY_VERSION,
  INCLUDED_LOADED_MILES,
  SIGNATURE_CENTS,
  quoteDelivery,
  weightBandCents,
  type QuoteInput,
} from "@/lib/couranr/pricing";

/** Convenience: a valid minimal input. */
function q(over: Partial<QuoteInput> = {}) {
  return quoteDelivery({ loadedMiles: 3, weightLb: 10, ...over });
}

/** Sum of mileage line items only. */
function mileageCents(r: ReturnType<typeof quoteDelivery>) {
  return r.lineItems
    .filter((li) => li.code.startsWith("mileage_tier_"))
    .reduce((s, li) => s + li.amountCents, 0);
}

describe("result shape", () => {
  it("returns every required field", () => {
    const r = q();
    expect(r.policyVersion).toBe(COURANR_PRICING_POLICY_VERSION);
    expect(r.quoteStatus).toBe("estimated");
    expect(typeof r.deliverySubtotalCents).toBe("number");
    expect(Array.isArray(r.lineItems)).toBe(true);
    expect(r.includedLoadedMiles).toBe(3);
    expect(typeof r.billableLoadedMiles).toBe("number");
    expect(Array.isArray(r.reviewReasons)).toBe(true);
    expect(r.roundingApplied).toBe(false);
    expect(r.taxIncluded).toBe(false);
    expect(r.paymentDueCents).toBeNull();
  });

  it("gives every line item a stable code, label, quantity and amounts", () => {
    const r = q({ loadedMiles: 30, weightLb: 60, additionalStops: 2, serviceLevel: "rush", signatureRequired: true });
    expect(r.lineItems.length).toBeGreaterThan(4);
    for (const li of r.lineItems) {
      expect(typeof li.code).toBe("string");
      expect(li.code.length).toBeGreaterThan(0);
      expect(typeof li.label).toBe("string");
      expect(li.label.length).toBeGreaterThan(0);
      expect(Number.isFinite(li.quantity)).toBe(true);
      expect(Number.isInteger(li.unitAmountCents)).toBe(true);
      expect(Number.isInteger(li.amountCents)).toBe(true);
    }
  });

  /** PRC-004 and TAX-001 are unresolved; the engine must not pretend otherwise. */
  it("never reports rounding, tax or a payable amount", () => {
    for (const miles of [3, 10, 42, 100]) {
      const r = q({ loadedMiles: miles, weightLb: 30 });
      expect(r.roundingApplied).toBe(false);
      expect(r.taxIncluded).toBe(false);
      expect(r.paymentDueCents).toBeNull();
      // The subtotal is the exact sum, never snapped to a 25c multiple.
      expect(r.deliverySubtotalCents).toBe(
        r.lineItems.reduce((s, li) => s + li.amountCents, 0)
      );
    }
  });
});

describe("mileage boundaries", () => {
  // Expected mileage-only cents at each boundary, computed from the tier table:
  //   4-10 @225, 11-25 @300, 26-50 @350, 51-75 @400, 76-100 @475
  const T1 = 7 * 225;                     // miles 4-10   = 1575
  const T2 = 15 * 300;                    // miles 11-25  = 4500
  const T3 = 25 * 350;                    // miles 26-50  = 8750
  const T4 = 25 * 400;                    // miles 51-75  = 10000
  const T5 = 25 * 475;                    // miles 76-100 = 11875

  const CASES: [number, number][] = [
    [3, 0],
    [4, 225],
    [10, T1],
    [11, T1 + 300],
    [25, T1 + T2],
    [26, T1 + T2 + 350],
    [50, T1 + T2 + T3],
    [51, T1 + T2 + T3 + 400],
    [75, T1 + T2 + T3 + T4],
    [76, T1 + T2 + T3 + T4 + 475],
    [100, T1 + T2 + T3 + T4 + T5],
  ];

  for (const [miles, expectedMileage] of CASES) {
    it(`bills ${miles} loaded miles as ${expectedMileage} mileage cents`, () => {
      const r = q({ loadedMiles: miles });
      expect(r.quoteStatus).toBe("estimated");
      expect(mileageCents(r)).toBe(expectedMileage);
      expect(r.deliverySubtotalCents).toBe(BASE_PRICE_CENTS + expectedMileage);
      expect(r.billableLoadedMiles).toBe(Math.max(0, miles - INCLUDED_LOADED_MILES));
    });
  }

  it("charges nothing beyond the base at or below the included allowance", () => {
    for (const miles of [0, 1, 2, 3]) {
      const r = q({ loadedMiles: miles });
      expect(mileageCents(r)).toBe(0);
      expect(r.billableLoadedMiles).toBe(0);
      expect(r.deliverySubtotalCents).toBe(BASE_PRICE_CENTS);
    }
  });

  it("sends 101 loaded miles to manual review with no estimate", () => {
    const r = q({ loadedMiles: 101 });
    expect(r.quoteStatus).toBe("manual_review_required");
    expect(r.reviewReasons).toContain("over_max_automatic_miles");
    expect(r.deliverySubtotalCents).toBe(0);
    expect(r.lineItems).toEqual([]);
  });

  it("still quotes exactly 100 miles automatically", () => {
    expect(q({ loadedMiles: 100 }).quoteStatus).toBe("estimated");
    expect(q({ loadedMiles: 100.001 }).quoteStatus).toBe("manual_review_required");
  });

  it("splits a route across every tier it reaches", () => {
    const r = q({ loadedMiles: 80 });
    const codes = r.lineItems.filter((l) => l.code.startsWith("mileage_tier_")).map((l) => l.code);
    expect(codes).toEqual([
      "mileage_tier_4_10",
      "mileage_tier_11_25",
      "mileage_tier_26_50",
      "mileage_tier_51_75",
      "mileage_tier_76_100",
    ]);
  });

  it("handles fractional miles without a fractional cent", () => {
    const r = q({ loadedMiles: 4.5 });
    // 1.5 billable miles in the 4-10 tier: 1500 milli * 225 / 1000 = 337.5 -> 338
    expect(mileageCents(r)).toBe(338);
    expect(Number.isInteger(r.deliverySubtotalCents)).toBe(true);
    expect(r.billableLoadedMiles).toBeCloseTo(1.5, 6);
  });
});

describe("weight boundaries", () => {
  const CASES: [number, number][] = [
    [0, 0], [25, 0],
    [26, 1000], [50, 1000],
    [51, 2500], [75, 2500],
    [76, 5000], [150, 5000],
    [151, 8500], [200, 8500],
  ];

  for (const [lb, cents] of CASES) {
    it(`bills ${lb} lb as ${cents} cents`, () => {
      expect(weightBandCents(lb)).toBe(cents);
      const r = q({ weightLb: lb });
      expect(r.quoteStatus).toBe("estimated");
      expect(r.deliverySubtotalCents).toBe(BASE_PRICE_CENTS + cents);
    });
  }

  it("sends 201 lb to manual review with no estimate", () => {
    const r = q({ weightLb: 201 });
    expect(r.quoteStatus).toBe("manual_review_required");
    expect(r.reviewReasons).toContain("over_max_automatic_weight");
    expect(r.deliverySubtotalCents).toBe(0);
  });

  it("still quotes exactly 200 lb automatically", () => {
    expect(q({ weightLb: 200 }).quoteStatus).toBe("estimated");
    expect(q({ weightLb: 200.5 }).quoteStatus).toBe("manual_review_required");
  });

  it("emits no weight line for a band that costs nothing", () => {
    const r = q({ weightLb: 20 });
    expect(r.lineItems.find((l) => l.code === "weight_band")).toBeUndefined();
  });
});

describe("stops", () => {
  it("charges nothing for zero additional stops", () => {
    const r = q({ additionalStops: 0 });
    expect(r.lineItems.find((l) => l.code === "additional_stops")).toBeUndefined();
    expect(r.deliverySubtotalCents).toBe(BASE_PRICE_CENTS);
  });

  it("charges one additional stop", () => {
    const r = q({ additionalStops: 1 });
    const li = r.lineItems.find((l) => l.code === "additional_stops")!;
    expect(li.quantity).toBe(1);
    expect(li.amountCents).toBe(ADDITIONAL_STOP_CENTS);
  });

  it("charges multiple additional stops linearly", () => {
    for (const n of [2, 3, 7]) {
      const r = q({ additionalStops: n });
      const li = r.lineItems.find((l) => l.code === "additional_stops")!;
      expect(li.quantity).toBe(n);
      expect(li.amountCents).toBe(n * ADDITIONAL_STOP_CENTS);
    }
  });
});

describe("service levels and signature", () => {
  it("charges nothing extra for standard", () => {
    const r = q({ serviceLevel: "standard" });
    expect(r.lineItems.find((l) => l.code.startsWith("service_level_"))).toBeUndefined();
  });

  it("charges priority", () => {
    const r = q({ serviceLevel: "priority" });
    expect(r.lineItems.find((l) => l.code === "service_level_priority")!.amountCents).toBe(700);
    expect(r.deliverySubtotalCents).toBe(BASE_PRICE_CENTS + 700);
  });

  it("charges rush", () => {
    const r = q({ serviceLevel: "rush" });
    expect(r.lineItems.find((l) => l.code === "service_level_rush")!.amountCents).toBe(1200);
    expect(r.deliverySubtotalCents).toBe(BASE_PRICE_CENTS + 1200);
  });

  it("charges signature", () => {
    const r = q({ signatureRequired: true });
    expect(r.lineItems.find((l) => l.code === "signature")!.amountCents).toBe(SIGNATURE_CENTS);
  });

  it("always includes proof at zero", () => {
    const li = q().lineItems.find((l) => l.code === "proof")!;
    expect(li.amountCents).toBe(0);
  });
});

describe("combined valid charges", () => {
  it("sums an exact integer-cent total", () => {
    const r = q({
      loadedMiles: 12,
      weightLb: 60,
      additionalStops: 2,
      serviceLevel: "rush",
      signatureRequired: true,
    });

    // base 2299
    // miles 4-10: 7 * 225 = 1575 ; miles 11-12: 2 * 300 = 600
    // rush 1200 ; stops 2 * 800 = 1600 ; signature 300 ; weight 51-75 = 2500
    const expected = 2299 + 1575 + 600 + 1200 + 1600 + 300 + 2500;

    expect(r.quoteStatus).toBe("estimated");
    expect(r.deliverySubtotalCents).toBe(expected);
    expect(r.deliverySubtotalCents).toBe(10074);
    expect(Number.isInteger(r.deliverySubtotalCents)).toBe(true);
  });

  it("keeps every intermediate an integer number of cents", () => {
    const inputs: QuoteInput[] = [
      { loadedMiles: 0, weightLb: 0 },
      { loadedMiles: 7.25, weightLb: 44.4, additionalStops: 3, serviceLevel: "priority" },
      { loadedMiles: 99.999, weightLb: 199.9, signatureRequired: true },
      { loadedMiles: 55.5, weightLb: 150, serviceLevel: "rush", additionalStops: 1 },
    ];
    for (const input of inputs) {
      const r = quoteDelivery(input);
      expect(Number.isInteger(r.deliverySubtotalCents)).toBe(true);
      for (const li of r.lineItems) {
        expect(Number.isInteger(li.amountCents)).toBe(true);
        expect(Number.isInteger(li.unitAmountCents)).toBe(true);
      }
    }
  });
});

describe("validation", () => {
  const BAD: [string, QuoteInput, string][] = [
    ["NaN miles", { loadedMiles: NaN, weightLb: 10 }, "loaded_miles_not_finite"],
    ["Infinite miles", { loadedMiles: Infinity, weightLb: 10 }, "loaded_miles_not_finite"],
    ["negative miles", { loadedMiles: -1, weightLb: 10 }, "loaded_miles_negative"],
    ["NaN weight", { loadedMiles: 5, weightLb: NaN }, "weight_not_finite"],
    ["Infinite weight", { loadedMiles: 5, weightLb: -Infinity }, "weight_not_finite"],
    ["negative weight", { loadedMiles: 5, weightLb: -0.5 }, "weight_negative"],
    ["negative stops", { loadedMiles: 5, weightLb: 10, additionalStops: -1 }, "additional_stops_negative"],
    ["fractional stops", { loadedMiles: 5, weightLb: 10, additionalStops: 1.5 }, "additional_stops_not_whole"],
    ["NaN stops", { loadedMiles: 5, weightLb: 10, additionalStops: NaN }, "additional_stops_not_finite"],
    ["unknown service level", { loadedMiles: 5, weightLb: 10, serviceLevel: "express" as any }, "unknown_service_level"],
    ["rush + overnight", { loadedMiles: 5, weightLb: 10, serviceLevel: "rush", overnightRequested: true }, "rush_and_overnight_conflict"],
  ];

  for (const [name, input, code] of BAD) {
    it(`rejects ${name}`, () => {
      const r = quoteDelivery(input);
      expect(r.quoteStatus).toBe("invalid");
      expect(r.validationErrors).toContain(code);
      expect(r.deliverySubtotalCents).toBe(0);
      expect(r.lineItems).toEqual([]);
      expect(r.paymentDueCents).toBeNull();
    });
  }

  it("reports several problems at once", () => {
    const r = quoteDelivery({ loadedMiles: -1, weightLb: -1, additionalStops: -1 });
    expect(r.validationErrors.length).toBeGreaterThanOrEqual(3);
  });

  it("accepts zero for every optional numeric field", () => {
    expect(quoteDelivery({ loadedMiles: 0, weightLb: 0, additionalStops: 0 }).quoteStatus).toBe(
      "estimated"
    );
  });
});

describe("overnight is not offered in this release", () => {
  it("sends an overnight request to manual review", () => {
    const r = q({ overnightRequested: true });
    expect(r.quoteStatus).toBe("manual_review_required");
    expect(r.reviewReasons).toContain("overnight_not_offered_in_this_release");
    expect(r.deliverySubtotalCents).toBe(0);
  });

  it("treats rush plus overnight as invalid, not merely unavailable", () => {
    const r = q({ overnightRequested: true, serviceLevel: "rush" });
    expect(r.quoteStatus).toBe("invalid");
    expect(r.validationErrors).toContain("rush_and_overnight_conflict");
  });

  it("allows overnight with priority to reach review rather than being rejected", () => {
    const r = q({ overnightRequested: true, serviceLevel: "priority" });
    expect(r.quoteStatus).toBe("manual_review_required");
  });
});

describe("manual review combines reasons", () => {
  it("reports both mileage and weight when both exceed the automatic limits", () => {
    const r = quoteDelivery({ loadedMiles: 150, weightLb: 250 });
    expect(r.quoteStatus).toBe("manual_review_required");
    expect(r.reviewReasons).toContain("over_max_automatic_miles");
    expect(r.reviewReasons).toContain("over_max_automatic_weight");
  });

  it("never returns money with a review result", () => {
    for (const input of [
      { loadedMiles: 101, weightLb: 10 },
      { loadedMiles: 10, weightLb: 201 },
      { loadedMiles: 10, weightLb: 10, overnightRequested: true },
    ]) {
      const r = quoteDelivery(input);
      expect(r.deliverySubtotalCents).toBe(0);
      expect(r.lineItems).toEqual([]);
    }
  });
});

/* ------------------------------------------------------------ structural */

/**
 * Structural assertions scan SOURCE TEXT, so comments must be stripped first.
 * These modules deliberately document the legacy path they replace and quote
 * example distances like "4.2 miles" in prose; asserting against raw text would
 * fail on the documentation rather than on the code. This is the third time in
 * this repository that a source-scanning test matched its own comments.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("engine is dependency-free and amount-free", () => {
  const DIR = path.resolve(__dirname, "../lib/couranr/pricing");
  const FILES = ["policy.ts", "types.ts", "quote.ts", "index.ts"];
  const SOURCES = FILES.map((f) =>
    stripComments(readFileSync(path.join(DIR, f), "utf8"))
  );

  it("imports no React, Next.js, Supabase or Stripe", () => {
    for (const [i, src] of SOURCES.entries()) {
      const imports = Array.from(src.matchAll(/from\s+"([^"]+)"/g)).map((m) => m[1]);
      for (const spec of imports) {
        expect(
          /^(react|next|@supabase|stripe|@stripe)/.test(spec),
          `${FILES[i]} imports "${spec}"`
        ).toBe(false);
      }
    }
  });

  it("accepts no client-supplied total or amount field", () => {
    const types = stripComments(readFileSync(path.join(DIR, "types.ts"), "utf8"));
    const inputBlock = types.slice(
      types.indexOf("export type QuoteInput"),
      types.indexOf("export type QuoteStatus")
    );
    for (const forbidden of ["total", "amount", "subtotal", "price", "cents"]) {
      expect(
        new RegExp(`^\\s*${forbidden}\\??:`, "im").test(inputBlock),
        `QuoteInput must not accept a "${forbidden}" field`
      ).toBe(false);
    }
  });

  it("performs no floating-point currency arithmetic", () => {
    const quoteSrc = stripComments(readFileSync(path.join(DIR, "quote.ts"), "utf8"));
    // No decimal literals and no float-producing helpers in the money path.
    expect(quoteSrc).not.toMatch(/\d+\.\d+/);
    expect(quoteSrc).not.toMatch(/toFixed|parseFloat|Math\.ceil\s*\(\s*[^)]*\/\s*100/);
  });

  it("does not import the legacy pricing policy", () => {
    for (const [i, src] of SOURCES.entries()) {
      expect(src.includes("lib/delivery/policy"), `${FILES[i]}`).toBe(false);
      expect(src.includes("lib/delivery/pricing"), `${FILES[i]}`).toBe(false);
    }
  });
});

describe("legacy pricing is untouched by this commit", () => {
  it("leaves the legacy constants at their shipped values", async () => {
    const legacy = await import("@/lib/delivery/policy");
    // These are WRONG per the Decision Registry, and deliberately unchanged
    // here: correcting them is a separate reviewable commit.
    expect(legacy.DELIVERY_BASE_FEE).toBe(15);
    expect(legacy.DELIVERY_INCLUDED_MILES).toBe(4);
    expect(legacy.DELIVERY_PER_MILE_RATE).toBe(1.75);
  });

  it("keeps the canonical engine numerically distinct from the legacy one", () => {
    expect(BASE_PRICE_CENTS).toBe(2299);
    expect(INCLUDED_LOADED_MILES).toBe(3);
  });
});

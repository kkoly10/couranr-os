import { REVIEW_REASON_LABELS } from "@/lib/couranr/requests/view";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BASE_PRICE_CENTS,
  QUOTE_VALIDITY_SECONDS,
  COURANR_PRICING_POLICY_VERSION,
  COURANR_PRICING_POLICY_VERSION_V1_HISTORICAL,
  INCLUDED_LOADED_MILES,
  MAX_AUTOMATIC_LOADED_MILES,
  MAX_AUTOMATIC_TRAFFIC_DELAY_SECONDS,
  MAX_AUTOMATIC_WEIGHT_LB,
  OVERNIGHT_CENTS,
  SERVICE_LEVEL_CENTS,
  SIGNATURE_CENTS,
  TRAFFIC_DELAY_CENTS_PER_MINUTE,
  TRAFFIC_DELAY_INCLUDED_SECONDS,
  WEIGHT_SURCHARGE_CENTS,
  quoteDelivery,
  trafficDelayCents,
  weightBandCents,
  type QuoteInput,
} from "@/lib/couranr/pricing";

/**
 * Couranr Pricing Authority V2.
 *
 * Every automatic quote needs traffic evidence, so the helper supplies a zero
 * delay by default. That is deliberate rather than convenient: a test that
 * omitted it would silently be testing the review path instead of the price.
 */
function q(over: Partial<QuoteInput> = {}) {
  return quoteDelivery({
    loadedMiles: 3,
    weightLb: 10,
    trafficDelaySeconds: 0,
    ...over,
  });
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

describe("PRC-005 / MIL-003 / MIL-004 — the standard fare", () => {
  it("stamps the V2 policy version, never the superseded one", () => {
    expect(COURANR_PRICING_POLICY_VERSION).toBe("couranr-pricing-v2-2026-09-01");
    expect(COURANR_PRICING_POLICY_VERSION).not.toBe(
      COURANR_PRICING_POLICY_VERSION_V1_HISTORICAL
    );
    expect(q().policyVersion).toBe(COURANR_PRICING_POLICY_VERSION);
  });

  it("bases at $7.99 covering the first 2 loaded miles", () => {
    expect(BASE_PRICE_CENTS).toBe(799);
    expect(INCLUDED_LOADED_MILES).toBe(2);
  });

  /* The eight examples the owner specified, to the cent. These are the whole
     point of the cutover, so they are asserted as exact totals rather than as
     a formula that could drift with the code it is checking. */
  it.each([
    [2.0, 799],
    [3.0, 924],
    [5.0, 1174],
    [10.0, 1799],
    [15.0, 2549],
    [20.0, 3299],
    [25.0, 4049],
  ])("%s loaded miles prices at exactly %i cents", (miles, cents) => {
    const r = q({ loadedMiles: miles });
    expect(r.quoteStatus).toBe("estimated");
    expect(r.deliverySubtotalCents).toBe(cents);
    expect(usd(r.deliverySubtotalCents)).toBe(usd(cents));
  });

  it("produces NO automatic subtotal above 25 loaded miles", () => {
    const r = q({ loadedMiles: 25.001 });
    expect(r.quoteStatus).toBe("manual_review_required");
    expect(r.deliverySubtotalCents).toBe(0);
    expect(r.lineItems).toEqual([]);
    expect(r.reviewReasons).toContain("over_max_automatic_miles");
    expect(MAX_AUTOMATIC_LOADED_MILES).toBe(25);
  });

  it("never rounds mileage up to a whole mile", () => {
    // 2.5 miles bills half a mile at 125c = 62.5c, half-up to 63c.
    const half = q({ loadedMiles: 2.5 });
    expect(half.deliverySubtotalCents).toBe(BASE_PRICE_CENTS + 63);
    // If mileage were rounded up to 3 miles this would be 125c instead.
    expect(half.deliverySubtotalCents).not.toBe(BASE_PRICE_CENTS + 125);
  });

  it("keeps thousandth-of-a-mile precision", () => {
    const a = q({ loadedMiles: 2.001 });
    const b = q({ loadedMiles: 2.002 });
    expect(a.billableLoadedMiles).toBe(0.001);
    expect(b.billableLoadedMiles).toBe(0.002);
  });
});

describe("SUR-003 — weight", () => {
  it("includes 25 lb and charges $3.00 over 25 through 50 lb", () => {
    expect(weightBandCents(25)).toBe(0);
    expect(weightBandCents(25.1)).toBe(WEIGHT_SURCHARGE_CENTS);
    expect(weightBandCents(50)).toBe(WEIGHT_SURCHARGE_CENTS);
    expect(WEIGHT_SURCHARGE_CENTS).toBe(300);
  });

  it("puts the 25 lb boundary on the right side", () => {
    expect(q({ weightLb: 25 }).deliverySubtotalCents).toBe(
      q({ weightLb: 1 }).deliverySubtotalCents
    );
    expect(q({ weightLb: 25.1 }).deliverySubtotalCents).toBe(
      q({ weightLb: 25 }).deliverySubtotalCents + 300
    );
  });

  it("puts the 50 lb boundary on the right side — over 50 is a Large Item", () => {
    expect(q({ weightLb: 50 }).quoteStatus).toBe("estimated");
    const large = q({ weightLb: 50.1 });
    expect(large.quoteStatus).toBe("manual_review_required");
    expect(large.reviewReasons).toContain("large_item_review");
    expect(large.deliverySubtotalCents).toBe(0);
    expect(MAX_AUTOMATIC_WEIGHT_LB).toBe(50);
  });
});

describe("SUR-003 — service levels and options", () => {
  it("prices priority, rush and overnight at exactly the governed amounts", () => {
    expect(SERVICE_LEVEL_CENTS.priority).toBe(500);
    expect(SERVICE_LEVEL_CENTS.rush).toBe(1000);
    expect(OVERNIGHT_CENTS).toBe(3000);
  });

  it("adds priority and rush to the subtotal exactly", () => {
    const base = q().deliverySubtotalCents;
    expect(q({ serviceLevel: "priority" }).deliverySubtotalCents).toBe(base + 500);
    expect(q({ serviceLevel: "rush" }).deliverySubtotalCents).toBe(base + 1000);
  });

  it("charges $3.00 for signature and nothing for proof", () => {
    expect(SIGNATURE_CENTS).toBe(300);
    expect(q({ signatureRequired: true }).deliverySubtotalCents).toBe(
      q().deliverySubtotalCents + 300
    );
    const proof = q().lineItems.find((li) => li.code === "proof");
    expect(proof?.amountCents).toBe(0);
  });

  it("routes overnight to Couranr confirmation rather than pricing it", () => {
    const r = q({ overnightRequested: true });
    expect(r.quoteStatus).toBe("manual_review_required");
    expect(r.reviewReasons).toContain("overnight_requires_couranr_confirmation");
    expect(r.deliverySubtotalCents).toBe(0);
  });

  it("refuses to stack rush and overnight", () => {
    const r = q({ serviceLevel: "rush", overnightRequested: true });
    expect(r.quoteStatus).toBe("invalid");
    expect(r.validationErrors).toContain("rush_and_overnight_conflict");
    expect(r.deliverySubtotalCents).toBe(0);
  });
});

describe("TRF-001 — predicted traffic", () => {
  it("includes the first five minutes", () => {
    expect(TRAFFIC_DELAY_INCLUDED_SECONDS).toBe(300);
    expect(trafficDelayCents(0)).toBe(0);
    expect(trafficDelayCents(299)).toBe(0);
    expect(trafficDelayCents(300)).toBe(0);
    expect(q({ trafficDelaySeconds: 300 }).deliverySubtotalCents).toBe(
      q({ trafficDelaySeconds: 0 }).deliverySubtotalCents
    );
  });

  it("charges 45 cents a minute beyond five minutes", () => {
    expect(TRAFFIC_DELAY_CENTS_PER_MINUTE).toBe(45);
    expect(trafficDelayCents(360)).toBe(45); // one minute over
    expect(trafficDelayCents(600)).toBe(225); // five minutes over
    expect(trafficDelayCents(1500)).toBe(900); // twenty minutes over
  });

  it("bills partial minutes as partial minutes, not rounded up", () => {
    // 30 seconds over = 22.5c, half-up to 23c. Rounding the minute up would be 45c.
    expect(trafficDelayCents(330)).toBe(23);
    expect(trafficDelayCents(330)).not.toBe(45);
  });

  it("sends a delay above 25 minutes to review with no subtotal", () => {
    expect(MAX_AUTOMATIC_TRAFFIC_DELAY_SECONDS).toBe(1500);
    const r = q({ trafficDelaySeconds: 1501 });
    expect(r.quoteStatus).toBe("manual_review_required");
    expect(r.reviewReasons).toContain("over_max_automatic_traffic_delay");
    expect(r.deliverySubtotalCents).toBe(0);
  });

  it("FAILS SAFE into review when traffic evidence is absent", () => {
    // The dangerous alternative is treating "no evidence" as "no delay", which
    // would under-price every route whose baseline Google declined to return.
    for (const missing of [undefined, null]) {
      const r = quoteDelivery({
        loadedMiles: 3,
        weightLb: 10,
        trafficDelaySeconds: missing as number | null | undefined,
      });
      expect(r.quoteStatus).toBe("manual_review_required");
      expect(r.reviewReasons).toContain("traffic_evidence_unavailable");
      expect(r.deliverySubtotalCents).toBe(0);
    }
  });

  it("rejects a nonsensical delay instead of pricing it", () => {
    expect(q({ trafficDelaySeconds: -1 }).validationErrors).toContain(
      "traffic_delay_negative"
    );
    expect(q({ trafficDelaySeconds: Number.NaN }).validationErrors).toContain(
      "traffic_delay_not_finite"
    );
  });

  it("puts the traffic charge on the quote as its own evidenced line", () => {
    const r = q({ trafficDelaySeconds: 600 });
    const line = r.lineItems.find((li) => li.code === "traffic_delay");
    expect(line?.amountCents).toBe(225);
    expect(r.trafficDelaySeconds).toBe(600);
  });
});

describe("one universal engine — no vertical, payer or channel differential", () => {
  const shipment = { loadedMiles: 7.35, weightLb: 30, trafficDelaySeconds: 420 };

  it("prices an identical physical shipment identically, whatever the merchant sells", () => {
    // There is no category input to vary, which is the strongest form of this
    // guarantee: the engine cannot be told what the merchant sells.
    const inputKeys = Object.keys(quoteDelivery(shipment));
    expect(inputKeys).not.toContain("category");
    const a = quoteDelivery(shipment);
    const b = quoteDelivery({ ...shipment });
    expect(a.deliverySubtotalCents).toBe(b.deliverySubtotalCents);
  });

  it("prices merchant-paid and customer-paid the same for the same job", () => {
    // Payer type is not an engine input either, so the subtotal cannot diverge.
    const src = readFileSync(
      path.resolve(__dirname, "../lib/couranr/pricing/types.ts"),
      "utf8"
    );
    const inputBlock = src.slice(
      src.indexOf("export type QuoteInput"),
      src.indexOf("export type QuoteStatus")
    );
    expect(inputBlock).not.toMatch(/payerType|payer_type/);
    expect(inputBlock).not.toMatch(/category|vertical|merchantType/);
  });

  it("is reusable by a future consumer channel with no changes", () => {
    // The same call, with no business identity anywhere in the input.
    const consumer = quoteDelivery(shipment);
    expect(consumer.quoteStatus).toBe("estimated");
    expect(consumer.policyVersion).toBe(COURANR_PRICING_POLICY_VERSION);
  });
});

describe("no invented fees", () => {
  it("adds no platform fee, consumer surcharge or processing surcharge", () => {
    const r = q();
    const codes = r.lineItems.map((li) => li.code);
    for (const forbidden of [
      "platform_fee",
      "consumer_surcharge",
      "processing_fee",
      "surge",
      "category_multiplier",
    ]) {
      expect(codes).not.toContain(forbidden);
    }
    // The subtotal is exactly the sum of the lines — nothing is added after.
    expect(r.deliverySubtotalCents).toBe(
      r.lineItems.reduce((s, li) => s + li.amountCents, 0)
    );
  });

  it("never decides what is payable, and never claims rounding or tax", () => {
    const r = q();
    expect(r.paymentDueCents).toBeNull();
    expect(r.roundingApplied).toBe(false);
    expect(r.taxIncluded).toBe(false);
  });

  it("applies no nearest-$0.25 rounding", () => {
    // 3.001 miles is 799 + 0.125c -> 799 + 0 = 799... assert a non-quarter total.
    const r = q({ loadedMiles: 5 });
    expect(r.deliverySubtotalCents).toBe(1174);
    expect(r.deliverySubtotalCents % 25).not.toBe(0);
  });
});

describe("historical quotes stay historical", () => {
  it("keeps the superseded policy identifier readable", () => {
    expect(COURANR_PRICING_POLICY_VERSION_V1_HISTORICAL).toBe(
      "couranr-pricing-2026-07-31"
    );
  });

  it("keeps every historical line-item code interpretable", () => {
    const types = readFileSync(
      path.resolve(__dirname, "../lib/couranr/pricing/types.ts"),
      "utf8"
    );
    for (const code of [
      "mileage_tier_4_10",
      "mileage_tier_11_25",
      "mileage_tier_26_50",
      "mileage_tier_51_75",
      "mileage_tier_76_100",
      "additional_stops",
    ]) {
      expect(types, `historical code ${code} must stay readable`).toContain(code);
    }
  });

  it("does not re-run today's engine to reconstruct an old amount", () => {
    // A historical $22.99 quote is 2299 because that is what was STORED. The
    // V2 engine given the same shipment produces something else entirely, which
    // is exactly why reconstruction would be wrong.
    const recomputed = q({ loadedMiles: 3 }).deliverySubtotalCents;
    expect(recomputed).toBe(924);
    expect(recomputed).not.toBe(2299);
  });

  it("mints no quote under the superseded version", () => {
    for (const miles of [2, 5, 25]) {
      expect(q({ loadedMiles: miles }).policyVersion).not.toBe(
        COURANR_PRICING_POLICY_VERSION_V1_HISTORICAL
      );
    }
  });
});

describe("the legacy pricing runtime is gone, not quarantined", () => {
  const ROOT = path.resolve(__dirname, "..");

  it.each([
    "lib/delivery/policy.ts",
    "lib/delivery/pricing.ts",
    "app/api/delivery/quote/route.ts",
    "app/api/delivery/start-checkout/route.ts",
    "app/courier/page.tsx",
    "app/courier/quote/page.tsx",
    "components/courier/QuoteClient.tsx",
  ])("%s no longer exists", (rel) => {
    expect(existsSync(path.join(ROOT, rel))).toBe(false);
  });

  it("is imported by nothing", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of require("node:fs").readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name)) {
          const src = readFileSync(full, "utf8");
          if (/@\/lib\/delivery\/(policy|pricing)/.test(src)) hits.push(full);
        }
      }
    };
    for (const d of ["app", "lib", "components", "tests"]) walk(path.join(ROOT, d));
    expect(hits, `still importing the retired calculator: ${hits.join(", ")}`).toEqual([]);
  });

  it("leaves no /courier link behind outside Operations tooling", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of require("node:fs").readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name)) {
          const src = readFileSync(full, "utf8");
          for (const m of src.matchAll(/["'`](\/courier[^"'`]*)/g)) {
            if (!m[1].startsWith("/courier") || m[1].startsWith("/admin")) continue;
            hits.push(`${path.relative(ROOT, full)} -> ${m[1]}`);
          }
        }
      }
    };
    for (const d of ["app", "lib", "components"]) walk(path.join(ROOT, d));
    expect(hits, hits.join("; ")).toEqual([]);
  });
});
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


/**
 * The policy identifier lives in TWO places by necessity: this module, and the
 * SQL guard that refuses to mint the superseded one. Nothing checked that they
 * agreed, and a drift there would be silent — the database would go on
 * refusing a string the engine no longer produces, which reads as working.
 */
describe("policy identifiers agree across the TypeScript/SQL boundary", () => {
  const ROOT = path.resolve(__dirname, "..");
  const migration = readFileSync(
    path.join(ROOT, "supabase/migrations/20260902090000_couranr_pricing_v2_traffic_authority.sql"),
    "utf8"
  );
  const rollback = readFileSync(
    path.join(
      ROOT,
      "supabase/rollbacks/20260902090000_couranr_pricing_v2_traffic_authority.rollback.sql"
    ),
    "utf8"
  );

  it("the migration refuses exactly the version this module calls historical", () => {
    expect(migration).toContain(`'${COURANR_PRICING_POLICY_VERSION_V1_HISTORICAL}'`);
    expect(migration).toContain("superseded_pricing_policy_cannot_be_minted");
  });

  it("the rollback guards exactly the version this module mints", () => {
    expect(rollback).toContain(`'${COURANR_PRICING_POLICY_VERSION}'`);
    expect(rollback).toContain("pricing_v2_rollback_would_destroy_commercial_evidence");
  });

  it("the registry records both identifiers under PRC-005", () => {
    const reg = JSON.parse(
      readFileSync(path.join(ROOT, "02_DECISION_REGISTRY.json"), "utf8")
    );
    const prc005 = reg.decisions.find((d: any) => d.id === "PRC-005");
    expect(prc005.value.policy_version).toBe(COURANR_PRICING_POLICY_VERSION);
    expect(prc005.value.superseded_policy_version).toBe(
      COURANR_PRICING_POLICY_VERSION_V1_HISTORICAL
    );
    expect(prc005.amends).toBe("PRC-001");
  });
});

/* ------------------------------------------------------------------------ */
/* Regressions from the twelve-lens adversarial review. Each of these failed  */
/* against the code as first written.                                        */

describe("a stored line item can explain its own amount", () => {
  /* traffic_delay carried a SECONDS quantity against a per-MINUTE unit rate,
     so quantity * unitAmountCents was 60x amountCents. These line items are
     persisted verbatim into couranr_quote_versions as immutable evidence, so
     the row's own arithmetic contradicted the amount it charged. */
  it("every line item satisfies quantity * unitAmountCents === amountCents", () => {
    const cases = [
      { loadedMiles: 3, weightLb: 10, trafficDelaySeconds: 600 },
      { loadedMiles: 17.5, weightLb: 40, trafficDelaySeconds: 361 },
      { loadedMiles: 25, weightLb: 25, trafficDelaySeconds: 1500 },
      { loadedMiles: 2, weightLb: 1, trafficDelaySeconds: 0 },
    ];
    for (const c of cases) {
      const r = quoteDelivery({
        serviceLevel: "standard",
        signatureRequired: true,
        overnightRequested: false,
        ...c,
      } as any);
      for (const li of r.lineItems) {
        expect(
          Math.round(li.quantity * li.unitAmountCents),
          `${li.code} at ${c.loadedMiles}mi/${c.trafficDelaySeconds}s: ` +
            `${li.quantity} x ${li.unitAmountCents} != ${li.amountCents}`
        ).toBe(li.amountCents);
      }
    }
  });

  it("the traffic quantity is minutes, and is NOT rounded up to a whole minute", () => {
    // 6m30s of chargeable delay: 90s over the free window.
    const r = quoteDelivery({
      loadedMiles: 2, weightLb: 1, serviceLevel: "standard",
      signatureRequired: false, overnightRequested: false,
      trafficDelaySeconds: 390,
    } as any);
    const traffic = r.lineItems.find((l) => l.code === "traffic_delay")!;
    expect(traffic.quantity).toBeCloseTo(1.5, 10);
    expect(traffic.amountCents).toBe(68); // 90s * 45c/60s = 67.5 -> half-up 68
  });
});

describe("every review reason the engine can emit is presentable", () => {
  /* QuoteSummary and OperationsQueue both render `LABELS[code] ?? code`, so a
     missing key shows a merchant the raw snake_case machine identifier. Four of
     the six V2 codes had no label. */
  it("REVIEW_REASON_LABELS covers every ReviewReasonCode with real prose", () => {
    const EMITTABLE = [
      "over_max_automatic_miles",
      "large_item_review",
      "overnight_requires_couranr_confirmation",
      "over_max_automatic_traffic_delay",
      "route_needs_review",
      "traffic_evidence_unavailable",
    ];
    for (const code of EMITTABLE) {
      const label = REVIEW_REASON_LABELS[code];
      expect(label, `${code} has no merchant-facing label`).toBeTruthy();
      expect(label, `${code} renders as its own machine code`).not.toBe(code);
      expect(label).not.toMatch(/_/);
    }
  });

  it("every reason the engine actually produces is in the map", () => {
    const produced = new Set<string>();
    const probes = [
      { loadedMiles: 26, weightLb: 1, trafficDelaySeconds: 0 },
      { loadedMiles: 2, weightLb: 51, trafficDelaySeconds: 0 },
      { loadedMiles: 2, weightLb: 1, trafficDelaySeconds: 1501 },
      { loadedMiles: 2, weightLb: 1, trafficDelaySeconds: null },
      { loadedMiles: 2, weightLb: 1, trafficDelaySeconds: 0, overnightRequested: true },
    ];
    for (const p of probes) {
      const r = quoteDelivery({
        serviceLevel: "standard", signatureRequired: false,
        overnightRequested: false, ...p,
      } as any);
      r.reviewReasons.forEach((c) => produced.add(c));
    }
    expect(produced.size).toBeGreaterThanOrEqual(5);
    for (const c of produced) {
      expect(REVIEW_REASON_LABELS[c], `engine emits ${c}, label map has no key`).toBeTruthy();
    }
  });
});

describe("QVL-001 quote validity is one number, not two", () => {
  const REPO = path.resolve(__dirname, "..");
  const QVL_SQL = () =>
    readFileSync(
      path.join(REPO, "supabase/migrations/20260902100000_couranr_quote_validity_and_policy_pin.sql"),
      "utf8"
    );
  /* The database is the enforcement point. This binds the TypeScript constant
     to the interval the migration actually uses, so the two cannot drift the
     way the Same Day fixture drifted from BASE_PRICE_CENTS. */
  it("the constant matches the interval the migration enforces", () => {
    const sql = QVL_SQL();
    const m = sql.match(/>=\s*interval\s*'(\d+)\s*minutes'/);
    expect(m, "the migration must state the window as an interval").toBeTruthy();
    expect(Number(m![1]) * 60).toBe(QUOTE_VALIDITY_SECONDS);
    expect(QUOTE_VALIDITY_SECONDS).toBe(900);
  });

  it("the window is enforced in SQL, never from a browser clock", () => {
    const sql = QVL_SQL();
    // Server time only: the predicate defaults p_now to now() and no command
    // passes a caller-supplied timestamp into it.
    expect(sql).toContain("p_now   timestamptz default now()");
    expect(sql).not.toMatch(/couranr_quote_version_is_expired\(v_quote,\s*p_/);
  });

  it("the policy pin is an exact match, not a blacklist", () => {
    const sql = QVL_SQL();
    expect(sql).toContain(
      "if p_pricing_policy_version is distinct from 'couranr-pricing-v2-2026-09-01' then"
    );
    // The superseded identifier must NOT be singled out any more: an exact
    // match already refuses it, and a blacklist waves typos through.
    expect(sql).not.toContain("superseded_pricing_policy_cannot_be_minted");
  });
});

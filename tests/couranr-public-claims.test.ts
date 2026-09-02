import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BASE_PRICE_CENTS,
  CANCELLATION_CENTS,
  INCLUDED_LOADED_MILES,
  MARKETED_MARKETS,
  MILE_TIERS,
  RETURN_PRICING_COPY,
  ROUTE_SAVER_STATUS_COPY,
  SIGNATURE_CENTS,
  TRAFFIC_DELAY_CENTS_PER_MINUTE,
  TRAFFIC_DELAY_INCLUDED_MINUTES,
  TRAFFIC_REVIEW_OVER_MINUTES,
  WAITING_INCLUDED_MINUTES,
  WAITING_PER_MINUTE_CENTS,
  WEIGHT_INCLUDED_THROUGH_LB,
  WEIGHT_SURCHARGE_CENTS,
  WEIGHT_SURCHARGE_THROUGH_LB,
  SERVICE_LEVEL_CENTS,
} from "@/lib/couranr/public/governed";

/**
 * P10-006 / ACP-016 — the prohibited-claims gate for the PUBLIC surface.
 *
 * Scans the SOURCE of every canonical public page and marketing component —
 * copy, metadata, alt text all live in these strings — for the claims the
 * authorities forbid (MKT-002 §6, TRM-001 `never_claim`, MKT-001 Maryland
 * exclusion, registry screen constraints). A claim's NEGATION is legal
 * ("never an instant confirmation") and each pattern may carry an allowlist
 * for exactly that.
 *
 * Also proves lib/couranr/public/governed.ts AGREES with the root decision
 * registry, so a registry change the module misses fails here instead of
 * shipping a stale price.
 *
 * MUTATION-TESTED at the bottom: the scanner is run against planted
 * violations and must flag every one, so this file cannot rot into a scanner
 * that matches nothing.
 */

const ROOT = path.resolve(__dirname, "..");

const PUBLIC_TREES = [
  "app/(couranr)/(public)",
  "components/couranr/marketing",
  "lib/couranr/public",
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
}

type Rule = {
  name: string;
  pattern: RegExp;
  /** Lines matching this are legal uses (negations, comments stating the rule). */
  allow?: RegExp;
};

/** The enforceable list, one row per authority claim boundary. */
const RULES: Rule[] = [
  { name: "brings-you-customers", pattern: /brings? you (new )?customers/i },
  /**
   * Two capabilities the PRODUCT records as not existing, which the marketing
   * page was promising anyway.
   *
   * `lib/couranr/billing/records.ts` is the repo's own register of billing
   * gaps. `saved_payment_method` is kind "unbuilt" — its merchantCopy reads
   * "Couranr does not store a payment method yet" — and `downloadable_receipt`
   * is undecided, blocked by TAX-001, with the signed-in billing page telling
   * the merchant in as many words that it is "not a tax document".
   *
   * The homepage said "Use a saved payment method ... and keep a clean receipt
   * for your books", and /how-it-works said the same two things in different
   * wording. A merchant read one promise in the marketing and the opposite
   * inside the product. Nothing failed: neither claim was in this list.
   */
  {
    name: "saved-payment-method",
    pattern: /saved payment method/i,
    allow: /does not store a payment method/i,
  },
  {
    name: "receipt-for-your-books",
    pattern: /for your books|tax document/i,
    allow: /not a tax document/i,
  },
  { name: "guarantee-language", pattern: /guarante/i, allow: /never|no guarantee|not a guarantee/i },
  { name: "24-7", pattern: /24\s*\/\s*7|24-7|twenty-four seven/i },
  {
    name: "instant-confirmation",
    pattern: /instant confirmation|instantly confirmed/i,
    allow: /never an instant confirmation|no instant-confirmation/i,
  },
  {
    name: "marketplace",
    pattern: /driver marketplace|marketplace demand/i,
    allow: /no public driver marketplace|never a marketplace|without joining a marketplace|never becomes? a marketplace/i,
  },
  { name: "volume-claims", pattern: /thousands of|trusted by|(\b[45](\.\d)?|five)[- ]star/i },
  { name: "buyer-protection", pattern: /buyer protection/i },
  { name: "maryland", pattern: /maryland/i },
  { name: "subscription", pattern: /subscription|monthly plan|signup fee/i },
  { name: "phone-number", pattern: /\(\d{3}\)\s?\d{3}[- ]?\d{4}|\b\d{3}-\d{3}-\d{4}\b/ },
  { name: "founder-voice", pattern: /\bfounder\b|personal[- ]operator/i },
  { name: "competitor-named", pattern: /uber\s?eats|doordash|grubhub|instacart|postmates/i },
  { name: "legacy-products", pattern: /auto rental|rent a car|document services|docs service/i },
  { name: "generic-startup", pattern: /seamless|reimagined/i },
  { name: "medical-category", pattern: /pharmac|prescription|medical delivery/i },
  { name: "zip-rejection", pattern: /we (do not|don't) serve (zip|your area)/i },
];

/**
 * Comments state the rules ("No 'brings you customers' claim") — they are not
 * rendered copy, so they are stripped before scanning, the same lesson the
 * destructive-migration scanner learned from a comment saying "no DROP TABLE".
 * Whitespace is then collapsed so a sentence wrapped across source lines
 * ("never an instant confirmation") is judged as the sentence it renders as.
 */
function scannableText(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ");
}

function violations(source: string, rules: Rule[] = RULES): { rule: string; context: string }[] {
  const text = scannableText(source);
  const out: { rule: string; context: string }[] = [];
  for (const rule of rules) {
    const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : rule.pattern.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      // The allowlist is judged on a window around THIS match, so a negation
      // elsewhere in the file cannot excuse a real violation here.
      const context = text.slice(Math.max(0, m.index - 80), m.index + m[0].length + 80);
      if (!(rule.allow && rule.allow.test(context))) {
        out.push({ rule: rule.name, context: context.trim().slice(0, 120) });
      }
      if (re.lastIndex === m.index) re.lastIndex++;
    }
  }
  return out;
}

describe("public surface carries no prohibited claim", () => {
  const files = PUBLIC_TREES.flatMap((t) => walk(path.join(ROOT, t)));

  it("scans a real, non-trivial file set", () => {
    // If the trees move, this fails instead of the scanner silently
    // scanning nothing — a gate over zero files is not a gate.
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  for (const f of files) {
    it(`${path.relative(ROOT, f)} is clean`, () => {
      const found = violations(readFileSync(f, "utf8"));
      expect(
        found,
        found.map((v) => `${v.rule}: ${v.context}`).join("; ")
      ).toEqual([]);
    });
  }
});

describe("governed.ts agrees with the root decision registry", () => {
  const reg = JSON.parse(readFileSync(path.join(ROOT, "02_DECISION_REGISTRY.json"), "utf8"));
  const byId = new Map<string, any>(reg.decisions.map((d: any) => [d.id, d.value]));

  /* The amending record is the authority now. Asserting against PRC-001 would
     re-pin the retired fare and make this parity test the thing keeping V1
     alive. */
  it("PRC-005 base price supersedes PRC-001", () => {
    expect(BASE_PRICE_CENTS).toBe(byId.get("PRC-005").base_price_cents);
    expect(byId.get("PRC-001").base_price_cents).toBe(2299);
    expect(BASE_PRICE_CENTS).not.toBe(byId.get("PRC-001").base_price_cents);
  });
  it("MIL-003 included miles supersedes MIL-001", () => {
    expect(INCLUDED_LOADED_MILES).toBe(byId.get("MIL-003").included_loaded_miles);
    expect(INCLUDED_LOADED_MILES).not.toBe(byId.get("MIL-001").included_loaded_miles);
  });
  it("MIL-004 tiers, exactly", () => {
    expect(MILE_TIERS.map((t) => [t.overMiles, t.throughMiles, t.perMileCents])).toEqual(
      byId.get("MIL-004").tiers.map((t: any) => [t.over_miles, t.through_miles, t.per_mile_cents])
    );
  });
  it("SUR-003 service levels and weight", () => {
    const sur = byId.get("SUR-003");
    expect(SERVICE_LEVEL_CENTS).toEqual({
      priority: sur.service_levels.priority_cents,
      rush: sur.service_levels.rush_cents,
      overnight: sur.service_levels.overnight_cents,
    });
    expect(WEIGHT_INCLUDED_THROUGH_LB).toBe(sur.weight.included_through_lb);
    expect(WEIGHT_SURCHARGE_THROUGH_LB).toBe(sur.weight.surcharge_through_lb);
    expect(WEIGHT_SURCHARGE_CENTS).toBe(sur.weight.surcharge_cents);
    expect(SIGNATURE_CENTS).toBe(sur.signature_cents);
    expect(WAITING_INCLUDED_MINUTES).toBe(sur.waiting.included_minutes);
    expect(WAITING_PER_MINUTE_CENTS).toBe(sur.waiting.per_minute_cents_after);
  });
  it("TRF-001 traffic pricing", () => {
    const trf = byId.get("TRF-001");
    expect(TRAFFIC_DELAY_INCLUDED_MINUTES * 60).toBe(trf.included_seconds);
    expect(TRAFFIC_DELAY_CENTS_PER_MINUTE).toBe(trf.cents_per_minute);
    expect(TRAFFIC_REVIEW_OVER_MINUTES * 60).toBe(trf.review_over_seconds);
  });
  it("SUR-004 retires the Route Saver public price and offers no replacement", () => {
    expect(byId.get("SUR-004").public_starting_price_cents_per_stop).toBeNull();
    expect(byId.get("SUR-004").public_price_claim_retired).toBe(true);
    // The status copy must not smuggle a price back in as text.
    expect(ROUTE_SAVER_STATUS_COPY).not.toMatch(/\$\s*\d/);
  });
  it("MKT-001 markets, in registry order", () => {
    expect([...MARKETED_MARKETS]).toEqual(byId.get("MKT-001").marketed_markets);
  });
  it("CAN-001 cancellation charges by stage", () => {
    const can = byId.get("CAN-001");
    expect(CANCELLATION_CENTS.beforeConfirmation).toBe(can.before_authorization.charge_cents);
    expect(CANCELLATION_CENTS.afterAuthorizationBeforeConfirmation).toBe(
      can.after_authorization_before_confirmation.charge_cents
    );
    expect(CANCELLATION_CENTS.couranrCaused).toBe(can.couranr_cannot_confirm.charge_cents);
    expect(CANCELLATION_CENTS.afterConfirmationBeforeArrival).toBe(
      can.after_confirmation_before_arrival.charge_cents
    );
    expect(CANCELLATION_CENTS.afterArrivalUnavailable).toBe(
      can.after_arrival_package_or_merchant_unavailable.charge_cents
    );
  });
  it("REF-003 retires the 70% / $14.99 return rule", () => {
    expect(byId.get("REF-003").historical_rule.return_charge_percent_of_original).toBe(70);
    expect(byId.get("REF-003").historical_rule.return_minimum_cents).toBe(1499);
    // The live public copy must state neither.
    expect(RETURN_PRICING_COPY).not.toMatch(/70\s*%/);
    expect(RETURN_PRICING_COPY).not.toMatch(/14\.99/);
  });

  it("every amended parent carries a reciprocal amended_by", () => {
    const byIdFull = new Map<string, any>(reg.decisions.map((d: any) => [d.id, d]));
    for (const d of reg.decisions) {
      if (!d.amends) continue;
      const parent = byIdFull.get(d.amends);
      expect(parent, `${d.id} amends a record that does not exist`).toBeTruthy();
      expect(
        parent.amended_by,
        `${d.amends} does not list ${d.id} in amended_by, so the amendment is invisible when reading the parent`
      ).toContain(d.id);
    }
  });
});

describe("MUTATION CONTROLS — the scanner can actually reject", () => {
  const PLANTS: [string, string][] = [
    ["24-7", "We offer 24/7 support for every delivery."],
    ["maryland", "Now serving Maryland!"],
    ["volume-claims", "Trusted by thousands of local businesses."],
    ["instant-confirmation", "Get instant confirmation on every order."],
    ["guarantee-language", "Guaranteed delivery in under an hour."],
    ["phone-number", "Call us at 555-123-4567 any time."],
    ["competitor-named", "Unlike DoorDash, we care."],
  ];

  for (const [rule, plant] of PLANTS) {
    it(`flags a planted "${rule}" violation`, () => {
      const found = violations(plant);
      expect(found.some((v) => v.rule === rule), `expected ${rule} to be flagged`).toBe(true);
    });
  }

  it("does NOT flag the legal negations the pages actually use", () => {
    const legal = [
      "an estimate is never an instant confirmation.",
      "no public driver marketplace, no bidding.",
      "it never becomes a marketplace between you and your customer",
      "Couranr helps businesses without joining a marketplace",
    ].join("\n");
    expect(violations(legal)).toEqual([]);
  });
});

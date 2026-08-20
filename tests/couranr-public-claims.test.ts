import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BASE_PRICE_CENTS,
  CANCELLATION_CENTS,
  INCLUDED_LOADED_MILES,
  MARKETED_MARKETS,
  MILE_TIERS,
  RETURN_MINIMUM_CENTS,
  RETURN_PERCENT_OF_ORIGINAL,
  ROUTE_SAVER_FROM_CENTS_PER_STOP,
  SERVICE_LEVEL_CENTS,
  WEIGHT_BANDS,
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

  it("PRC-001 base price", () => {
    expect(BASE_PRICE_CENTS).toBe(byId.get("PRC-001").base_price_cents);
  });
  it("MIL-001 included miles", () => {
    expect(INCLUDED_LOADED_MILES).toBe(byId.get("MIL-001").included_loaded_miles);
  });
  it("MIL-002 tiers, exactly", () => {
    expect(MILE_TIERS.map((t) => [t.fromMile, t.toMile, t.perMileCents])).toEqual(
      byId.get("MIL-002").tiers.map((t: any) => [t.from_mile, t.to_mile, t.per_mile_cents])
    );
  });
  it("SUR-001 service levels and weight bands", () => {
    expect(SERVICE_LEVEL_CENTS).toEqual(byId.get("SUR-001").service_level_cents);
    expect(WEIGHT_BANDS.map((b) => [b.fromLb, b.toLb, b.cents])).toEqual(
      byId.get("SUR-001").weight_cents.map((b: any) => [b.from_lb, b.to_lb, b.cents])
    );
  });
  it("SUR-002 Route Saver", () => {
    expect(ROUTE_SAVER_FROM_CENTS_PER_STOP).toBe(
      byId.get("SUR-002").public_starting_price_cents_per_stop
    );
  });
  it("MKT-001 markets, in registry order", () => {
    expect([...MARKETED_MARKETS]).toEqual(byId.get("MKT-001").marketed_markets);
  });
  it("CAN-001 cancellation charges by stage", () => {
    const can = byId.get("CAN-001");
    expect(CANCELLATION_CENTS.beforeAuthorization).toBe(can.before_authorization.charge_cents);
    expect(CANCELLATION_CENTS.afterAuthorizationBeforeConfirmation).toBe(
      can.after_authorization_before_confirmation.charge_cents
    );
    expect(CANCELLATION_CENTS.couranrCannotConfirm).toBe(can.couranr_cannot_confirm.charge_cents);
    expect(CANCELLATION_CENTS.afterConfirmationBeforeArrival).toBe(
      can.after_confirmation_before_arrival.charge_cents
    );
    expect(CANCELLATION_CENTS.afterArrivalUnavailable).toBe(
      can.after_arrival_package_or_merchant_unavailable.charge_cents
    );
  });
  it("REF-001 return charge and floor", () => {
    expect(RETURN_PERCENT_OF_ORIGINAL).toBe(byId.get("REF-001").return_charge_percent_of_original);
    expect(RETURN_MINIMUM_CENTS).toBe(byId.get("REF-001").return_minimum_cents);
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

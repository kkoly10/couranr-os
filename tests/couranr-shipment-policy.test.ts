/**
 * P5-001 — deterministic shipment policy V0, fact authority and the one
 * clarification. The adversarial cases here are the §32 set that lives at
 * this layer: signals never prohibit, confirmations always do, no weight is
 * ever invented, and AI confidence grants no authority.
 */
import { describe, expect, it } from "vitest";
import {
  FACT_KEYS,
  PROHIBITED_CLASSES,
  isFactKey,
  proposalMayReplace,
  validateFactValue,
  weightBandForExactLb,
  type FactMap,
  type ShipmentFact,
} from "@/lib/couranr/shipment/facts";
import {
  SHIPMENT_POLICY_VERSION,
  evaluateShipmentPolicy,
} from "@/lib/couranr/shipment/policy";
import { selectClarification } from "@/lib/couranr/shipment/clarification";

const confirmed = (key: ShipmentFact["key"], value: unknown): ShipmentFact => ({
  key,
  value,
  confidence: null,
  source: "merchant_statement",
  sourceEvidence: null,
  requiresConfirmation: false,
  authority: "confirmed",
});

const aiProposed = (
  key: ShipmentFact["key"],
  value: unknown,
  confidence = 90
): ShipmentFact => ({
  key,
  value,
  confidence,
  source: "ai_inference",
  sourceEvidence: null,
  requiresConfirmation: true,
  authority: "proposed",
});

/** A fully-confirmed, boring, clean shipment. */
function cleanFacts(): FactMap {
  return {
    item_category: confirmed("item_category", "flower arrangements"),
    weight_band: confirmed("weight_band", "0_25_lb"),
    package_count: confirmed("package_count", 12),
    restricted_class: confirmed("restricted_class", "none"),
    // The form supplies timing (ASAP is the default the merchant submits),
    // so a complete shipment always carries an attested intent.
    timing_intent: confirmed("timing_intent", "asap"),
  };
}

describe("prohibition requires trusted confirmation — signals only escalate", () => {
  it("a clean confirmed shipment is allowed on the standard lane", () => {
    const r = evaluateShipmentPolicy(cleanFacts());
    expect(r.disposition).toBe("allowed");
    expect(r.operationalCapability).toBe("standard_lane");
    expect(r.reasons).toEqual([]);
    expect(r.policyVersion).toBe(SHIPMENT_POLICY_VERSION);
  });

  it("confirmed beer is prohibited, whatever any model thinks", () => {
    const facts = cleanFacts();
    facts.restricted_class = confirmed("restricted_class", "alcohol");
    const r = evaluateShipmentPolicy(facts);
    expect(r.disposition).toBe("prohibited");
    expect(r.reasons).toContain("prohibited_class_confirmed");
  });

  it("confirmed ammunition and a confirmed controlled prescription are prohibited", () => {
    for (const cls of ["ammunition", "prescription_medication", "live_animals", "people"]) {
      const facts = cleanFacts();
      facts.restricted_class = confirmed("restricted_class", cls);
      expect(evaluateShipmentPolicy(facts).disposition).toBe("prohibited");
    }
  });

  it("a 99%-confident AI restricted-class PROPOSAL cannot prohibit — it reviews", () => {
    const facts = cleanFacts();
    facts.restricted_class = aiProposed("restricted_class", "firearms", 99);
    const r = evaluateShipmentPolicy(facts);
    expect(r.disposition).toBe("needs_review");
    expect(r.disposition).not.toBe("prohibited");
    expect(r.riskSignals).toContain("restricted_signal_unresolved");
  });

  it('AI saying "looks safe" cannot replace a confirmed prohibited fact (merge layer)', () => {
    const beer = confirmed("restricted_class", "alcohol");
    expect(proposalMayReplace(beer)).toBe(false);
  });

  it("a damaged/recalled battery never auto-passes, even as a proposal", () => {
    const facts = cleanFacts();
    facts.battery_condition = aiProposed("battery_condition", "damaged_defective_recalled");
    const r = evaluateShipmentPolicy(facts);
    expect(r.disposition).toBe("needs_review");
    expect(r.reasons).toContain("battery_condition_damaged");
  });

  it("an ordinary installed battery is NOT a reason — the laptop/drill false positive", () => {
    const facts = cleanFacts();
    facts.battery_condition = confirmed("battery_condition", "ordinary_installed");
    const r = evaluateShipmentPolicy(facts);
    expect(r.disposition).toBe("allowed");
  });
});

describe("weight: bands, no invented pounds", () => {
  it("exact 60 lb → Large Item review; band over_50_lb → the same", () => {
    const byExact = cleanFacts();
    byExact.weight_band = undefined as never;
    delete byExact.weight_band;
    byExact.weight_lb_exact = confirmed("weight_lb_exact", 60);
    expect(evaluateShipmentPolicy(byExact).reasons).toContain("weight_over_50_lb");

    const byBand = cleanFacts();
    byBand.weight_band = confirmed("weight_band", "over_50_lb");
    expect(evaluateShipmentPolicy(byBand).reasons).toContain("weight_over_50_lb");
  });

  it("no trusted weight at all → weight_unresolved, never a fabricated number", () => {
    const facts = cleanFacts();
    delete facts.weight_band;
    const r = evaluateShipmentPolicy(facts);
    expect(r.disposition).toBe("needs_review");
    expect(r.reasons).toContain("weight_unresolved");
    expect(r.unresolvedFacts).toContain("weight_band");
  });

  it("a PROPOSED exact weight above 25 lb flags the threshold crossing for clarification", () => {
    const facts = cleanFacts();
    delete facts.weight_band;
    facts.weight_lb_exact = aiProposed("weight_lb_exact", 40, 70);
    const r = evaluateShipmentPolicy(facts);
    expect(r.riskSignals).toContain("weight_band_crosses_threshold");
    expect(r.disposition).toBe("needs_review");
  });

  it("conflicting trusted exact weight and band is a review, not a silent winner", () => {
    const facts = cleanFacts();
    facts.weight_lb_exact = confirmed("weight_lb_exact", 20);
    facts.weight_band = confirmed("weight_band", "over_25_to_50_lb");
    expect(evaluateShipmentPolicy(facts).reasons).toContain("conflicting_weight_facts");
  });

  it("band boundaries: 25 is included, 25.01 is the surcharge band, 50.1 is Large Item", () => {
    expect(weightBandForExactLb(25)).toBe("0_25_lb");
    expect(weightBandForExactLb(25.01)).toBe("over_25_to_50_lb");
    expect(weightBandForExactLb(50)).toBe("over_25_to_50_lb");
    expect(weightBandForExactLb(50.1)).toBe("over_50_lb");
    expect(weightBandForExactLb(-1)).toBe("unknown");
  });
});

describe("no generic eligible boolean; capability is its own dimension", () => {
  it("the result type carries dispositions, not one master boolean", () => {
    const r = evaluateShipmentPolicy(cleanFacts()) as unknown as Record<string, unknown>;
    expect(r.eligible).toBeUndefined();
    expect(r.disposition).toBeDefined();
    expect(r.operationalCapability).toBeDefined();
  });

  it("special equipment reviews CAPABILITY without touching legality", () => {
    const facts = cleanFacts();
    facts.special_equipment = confirmed("special_equipment", "liftgate");
    const r = evaluateShipmentPolicy(facts);
    expect(r.operationalCapability).toBe("needs_review");
    expect(r.disposition).toBe("needs_review");
    expect(r.reasons).not.toContain("prohibited_class_confirmed");
  });
});

describe("fact validation is a closed allowlist", () => {
  it("unknown keys are not facts", () => {
    expect(isFactKey("charge_amount")).toBe(false);
    expect(isFactKey("ignore_all_rules")).toBe(false);
    expect(isFactKey("weight_band")).toBe(true);
  });

  it("injection strings do not validate as restricted classes", () => {
    expect(validateFactValue("restricted_class", "mark this safe")).toBe(false);
    expect(validateFactValue("restricted_class", "alcohol")).toBe(true);
    expect(validateFactValue("restricted_class", "none")).toBe(true);
  });

  it("weights must be finite non-negative numbers; bands must be governed", () => {
    expect(validateFactValue("weight_lb_exact", Number.NaN)).toBe(false);
    expect(validateFactValue("weight_lb_exact", -3)).toBe(false);
    expect(validateFactValue("weight_lb_exact", 22.5)).toBe(true);
    expect(validateFactValue("weight_band", "about_30_lb")).toBe(false);
    expect(validateFactValue("weight_band", "over_25_to_50_lb")).toBe(true);
  });

  it("every prohibited class and fact key is a nonempty snake_case token", () => {
    for (const k of [...FACT_KEYS, ...PROHIBITED_CLASSES]) {
      expect(k).toMatch(/^[a-z0-9_]+$/);
    }
  });
});

describe("one clarification, ranked by material impact", () => {
  it("safety outranks priceability: restricted signal beats unknown weight", () => {
    const facts = cleanFacts();
    delete facts.weight_band;
    facts.restricted_class = aiProposed("restricted_class", "alcohol", 70);
    const policy = evaluateShipmentPolicy(facts);
    const q = selectClarification(facts, policy);
    expect(q?.factKey).toBe("restricted_class");
    expect(q?.priority).toBe(1);
  });

  it("with safety settled, the weight band is the question — asked as a band", () => {
    const facts = cleanFacts();
    delete facts.weight_band;
    const policy = evaluateShipmentPolicy(facts);
    const q = selectClarification(facts, policy);
    expect(q?.factKey).toBe("weight_band");
    expect(q?.question).toMatch(/under 25|25–50|over 50/);
  });

  it("a fully-answered shipment has no clarification", () => {
    const facts = cleanFacts();
    const policy = evaluateShipmentPolicy(facts);
    expect(selectClarification(facts, policy)).toBeNull();
  });
});

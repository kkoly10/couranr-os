/**
 * P5-001 — one clarification at a time, chosen by material impact.
 *
 * The merchant is never handed a questionnaire. Smart Intake asks exactly ONE
 * question — the one whose answer moves the most — in the governed order
 * (§10 of the batch authority):
 *
 *   1. prohibited/safety disposition
 *   2. operational capability
 *   3. deterministic priceability
 *   4. timing/serviceability
 *   5. lesser convenience information
 *
 * A clarification RESPONSE is merchant_statement evidence: it lands as a new
 * intake revision and may trigger reinterpretation. Nothing here stores
 * anything — this module only chooses the question.
 */

import { isTrustedAuthority, type FactKey, type FactMap } from "./facts";
import type { ShipmentPolicyResult } from "./policy";

export type Clarification = {
  factKey: FactKey;
  /** 1 = safety … 5 = convenience; persisted so audit can see the ranking. */
  priority: 1 | 2 | 3 | 4 | 5;
  question: string;
  reason: string;
};

type Candidate = Clarification;

function needsAnswer(facts: FactMap, key: FactKey): boolean {
  const f = facts[key];
  if (!f) return true;
  return !isTrustedAuthority(f.authority);
}

/**
 * Pick the single highest-impact open question, or `null` when nothing
 * material is open. Deterministic: same facts + same policy result → same
 * question, so a rerun cannot flap between prompts.
 */
export function selectClarification(
  facts: FactMap,
  policy: ShipmentPolicyResult
): Clarification | null {
  const candidates: Candidate[] = [];

  // 1 — safety. An unresolved restricted signal outranks everything: until a
  // trusted actor answers, the shipment cannot be classified at all.
  if (
    policy.riskSignals.includes("restricted_signal_unresolved") &&
    needsAnswer(facts, "restricted_class")
  ) {
    candidates.push({
      factKey: "restricted_class",
      priority: 1,
      question:
        "Does this shipment contain anything Couranr can't carry — alcohol, tobacco or vape products, medication, weapons or ammunition, hazardous materials, live animals, or cash?",
      reason: "restricted_signal_unresolved",
    });
  }
  if (needsAnswer(facts, "battery_condition") && policy.reasons.includes("battery_condition_damaged")) {
    candidates.push({
      factKey: "battery_condition",
      priority: 1,
      question:
        "You mentioned a battery that may be damaged or recalled. Is the battery damaged, swollen, defective, or part of a recall?",
      reason: "battery_condition_damaged",
    });
  }

  // 2 — operational capability.
  if (policy.reasons.includes("special_equipment_required") && needsAnswer(facts, "special_equipment")) {
    candidates.push({
      factKey: "special_equipment",
      priority: 2,
      question: "What equipment is needed to move this safely (dolly, liftgate, straps, extra hands)?",
      reason: "special_equipment_required",
    });
  }
  if (policy.reasons.includes("stairs_access_concern") && needsAnswer(facts, "stairs_access")) {
    candidates.push({
      factKey: "stairs_access",
      priority: 2,
      question: "Are there stairs or tricky access at pickup or drop-off?",
      reason: "stairs_access_concern",
    });
  }

  // 3 — priceability. The weight question, in band terms — never "guess the
  // exact pounds".
  if (
    (policy.unresolvedFacts.includes("weight_band") ||
      policy.riskSignals.includes("weight_band_crosses_threshold")) &&
    needsAnswer(facts, "weight_band")
  ) {
    candidates.push({
      factKey: "weight_band",
      priority: 3,
      question:
        "Roughly how heavy is the full shipment — under 25 lb, 25–50 lb, or over 50 lb?",
      reason: "weight_unresolved",
    });
  }
  if (policy.reasons.includes("bulky_without_dimensions") && needsAnswer(facts, "dimensions_in")) {
    candidates.push({
      factKey: "dimensions_in",
      priority: 3,
      question: "About how big is the largest piece (length × width × height, in inches)?",
      reason: "bulky_without_dimensions",
    });
  }

  // 4 — timing.
  if (needsAnswer(facts, "timing_intent") && !facts.timing_intent) {
    candidates.push({
      factKey: "timing_intent",
      priority: 4,
      question: "Should we pick this up as soon as possible, or at a scheduled time?",
      reason: "timing_unresolved",
    });
  }

  // 5 — convenience.
  if (!facts.package_count) {
    candidates.push({
      factKey: "package_count",
      priority: 5,
      question: "How many separate packages or pieces will the driver pick up?",
      reason: "package_count_unknown",
    });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.priority - b.priority);
  return candidates[0];
}

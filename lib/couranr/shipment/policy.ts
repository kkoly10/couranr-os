/**
 * P5-001 — Deterministic Shipment Policy V0.
 *
 * ---------------------------------------------------------------------------
 * AI IS NOT THE POLICY ENGINE
 * ---------------------------------------------------------------------------
 *
 * This evaluator is a pure function of the STRUCTURED FACT SET. It never reads
 * prose, never calls a model, and is versioned so every stored disposition can
 * name the exact rules that produced it.
 *
 * The one asymmetry that makes it safe (§11 of the batch authority):
 *
 *   POLICY FACT ≠ RISK SIGNAL.
 *
 *   A signal — model inference, keyword, similarity, hunch — may ESCALATE
 *   (raise clarifications, add `needs_review`). It may NEVER produce a hard
 *   `prohibited`, and it may never DOWNGRADE: "looks safe" from a model
 *   cannot override a confirmed prohibited class.
 *
 *   Hard `prohibited` requires a trusted actor's confirmation of membership
 *   in a closed prohibited class ("12 bottles of beer" confirmed by the
 *   merchant), or an equally trusted deterministic fact. "alcohol-free
 *   cleaner", a toy gun, a battery-powered drill and an ordinary laptop are
 *   the canonical false positives this rule exists to protect.
 *
 * Dispositions are DELIBERATELY not one boolean (§12). This module returns
 * shipment-policy disposition and operational capability as separate closed
 * vocabularies; account eligibility, market serviceability and timing are
 * other modules' dimensions and are never folded in here.
 */

import {
  isProhibitedClass,
  isTrustedAuthority,
  weightBandForExactLb,
  type FactKey,
  type FactMap,
  type ShipmentFact,
  type WeightBand,
} from "./facts";

export const SHIPMENT_POLICY_VERSION = "couranr-shipment-policy-v0-2026-09-02";

export const POLICY_DISPOSITIONS = ["allowed", "needs_review", "prohibited"] as const;
export type PolicyDisposition = (typeof POLICY_DISPOSITIONS)[number];

/**
 * Physical execution is a separate question from legality and from price.
 * `unsupported` is reserved for deterministic knowledge; V0 has no fact that
 * establishes it, so V0 can emit only the first two — the vocabulary keeps
 * the slot so a future version does not need a schema change.
 */
export const OPERATIONAL_CAPABILITIES = [
  "standard_lane",
  "needs_review",
  "unsupported",
] as const;
export type OperationalCapability = (typeof OPERATIONAL_CAPABILITIES)[number];

/** Closed, persisted reason codes. Additions are policy versions. */
export type PolicyReason =
  | "prohibited_class_confirmed"
  | "restricted_signal_unresolved"
  | "battery_condition_damaged"
  | "weight_over_50_lb"
  | "weight_unresolved"
  | "weight_band_crosses_threshold"
  | "high_declared_value"
  | "fragile_shipment"
  | "temperature_sensitive"
  | "loading_uncertainty"
  | "stairs_access_concern"
  | "setup_breakdown_required"
  | "special_equipment_required"
  | "vehicle_capability_review"
  | "bulky_without_dimensions"
  | "conflicting_weight_facts"
  | "low_confidence_material_fact";

export type ShipmentPolicyResult = {
  policyVersion: typeof SHIPMENT_POLICY_VERSION;
  disposition: PolicyDisposition;
  /** Deterministic reasons — each one traceable to a fact, not to prose. */
  reasons: PolicyReason[];
  /**
   * Escalation-only signals (typically model- or keyword-sourced facts that
   * no trusted actor has confirmed). Kept apart from `reasons` so an Ops
   * screen can show "Couranr's rules said X" and "the model worried about Y"
   * as the different things they are.
   */
  riskSignals: PolicyReason[];
  operationalCapability: OperationalCapability;
  /** Material facts the evaluator needed and did not have. */
  unresolvedFacts: FactKey[];
};

function fact(facts: FactMap, key: FactKey): ShipmentFact | undefined {
  return facts[key];
}

function trustedBool(facts: FactMap, key: FactKey): boolean {
  const f = fact(facts, key);
  return !!f && f.value === true && isTrustedAuthority(f.authority);
}

function anyBool(facts: FactMap, key: FactKey): boolean {
  const f = fact(facts, key);
  return !!f && f.value === true;
}

/**
 * Resolve what is actually KNOWN about weight, refusing to invent precision:
 * a trusted exact weight wins; else a trusted band; else the shipment's
 * weight is unresolved. Proposed weights are visible to the caller for
 * clarification but establish nothing here.
 */
export function resolveWeightKnowledge(facts: FactMap): {
  exactLb: number | null;
  band: WeightBand | null;
  conflicting: boolean;
} {
  const exact = fact(facts, "weight_lb_exact");
  const band = fact(facts, "weight_band");
  const trustedExact =
    exact && isTrustedAuthority(exact.authority) && typeof exact.value === "number"
      ? (exact.value as number)
      : null;
  const trustedBand =
    band && isTrustedAuthority(band.authority) ? (band.value as WeightBand) : null;
  const conflicting =
    trustedExact !== null &&
    trustedBand !== null &&
    trustedBand !== "unknown" &&
    weightBandForExactLb(trustedExact) !== trustedBand;
  return { exactLb: trustedExact, band: trustedBand, conflicting };
}

export function evaluateShipmentPolicy(facts: FactMap): ShipmentPolicyResult {
  const reasons: PolicyReason[] = [];
  const riskSignals: PolicyReason[] = [];
  const unresolved: FactKey[] = [];

  /* ---- 1. Hard prohibition: trusted confirmation ONLY ------------------ */
  const restricted = fact(facts, "restricted_class");
  let prohibited = false;
  if (restricted && isProhibitedClass(restricted.value)) {
    if (isTrustedAuthority(restricted.authority)) {
      prohibited = true;
      reasons.push("prohibited_class_confirmed");
    } else {
      // A signal, not a fact. Escalates; cannot prohibit; cannot be waved
      // away by any later "looks safe".
      riskSignals.push("restricted_signal_unresolved");
      unresolved.push("restricted_class");
    }
  } else if (restricted && restricted.value === "unknown") {
    riskSignals.push("restricted_signal_unresolved");
    unresolved.push("restricted_class");
  }

  /* ---- 2. Batteries ---------------------------------------------------- */
  const battery = fact(facts, "battery_condition");
  if (battery && battery.value === "damaged_defective_recalled") {
    // Damaged/swollen/recalled lithium never auto-passes, whoever said it —
    // escalation is allowed from any source (§13). Ordinary installed
    // batteries in normal electronics are deliberately NOT a reason.
    reasons.push("battery_condition_damaged");
  }

  /* ---- 3. Weight ------------------------------------------------------- */
  const weight = resolveWeightKnowledge(facts);
  if (weight.conflicting) reasons.push("conflicting_weight_facts");
  if (weight.exactLb !== null) {
    if (weight.exactLb > 50) reasons.push("weight_over_50_lb");
  } else if (weight.band !== null) {
    if (weight.band === "over_50_lb") reasons.push("weight_over_50_lb");
    else if (weight.band === "unknown") {
      reasons.push("weight_unresolved");
      unresolved.push("weight_band");
    }
  } else {
    // Nothing trusted about weight at all. If a PROPOSAL exists that crosses
    // a pricing/safety threshold, that is the highest-value clarification.
    reasons.push("weight_unresolved");
    unresolved.push("weight_band");
    const proposedExact = fact(facts, "weight_lb_exact");
    if (
      proposedExact &&
      typeof proposedExact.value === "number" &&
      (proposedExact.value as number) > 25
    ) {
      riskSignals.push("weight_band_crosses_threshold");
    }
  }

  /* ---- 4. Handling / capability review triggers ------------------------ */
  const declaredValue = fact(facts, "declared_value_band");
  if (declaredValue && declaredValue.value === "over_1000") {
    reasons.push("high_declared_value");
  }
  if (anyBool(facts, "fragile")) reasons.push("fragile_shipment");
  if (anyBool(facts, "temperature_sensitive")) reasons.push("temperature_sensitive");
  if (anyBool(facts, "loading_uncertainty")) reasons.push("loading_uncertainty");
  if (anyBool(facts, "stairs_access")) reasons.push("stairs_access_concern");
  if (anyBool(facts, "setup_breakdown")) reasons.push("setup_breakdown_required");
  const equipment = fact(facts, "special_equipment");
  if (equipment && typeof equipment.value === "string" && equipment.value.trim() !== "" && equipment.value !== "none") {
    reasons.push("special_equipment_required");
  }
  const vehicle = fact(facts, "vehicle_requirement");
  if (vehicle && typeof vehicle.value === "string" && !["", "none", "standard"].includes(vehicle.value)) {
    // A claimed non-standard vehicle need is an OPERATIONS review, never an
    // automatic surcharge and never a hardcoded personal vehicle (§15).
    reasons.push("vehicle_capability_review");
  }
  const size = fact(facts, "size_bulk");
  const dims = fact(facts, "dimensions_in");
  if (size && typeof size.value === "string" && /bulk|oversiz|large/i.test(size.value) && !dims) {
    reasons.push("bulky_without_dimensions");
  }

  /* ---- 5. Low-confidence material facts -------------------------------- */
  for (const key of Object.keys(facts) as FactKey[]) {
    const f = facts[key];
    if (!f) continue;
    if (
      f.source === "ai_inference" &&
      !isTrustedAuthority(f.authority) &&
      f.confidence !== null &&
      f.confidence < 60 &&
      f.requiresConfirmation
    ) {
      if (!riskSignals.includes("low_confidence_material_fact")) {
        riskSignals.push("low_confidence_material_fact");
      }
      if (!unresolved.includes(key)) unresolved.push(key);
    }
  }

  /* ---- 6. Fold to dispositions ----------------------------------------- */
  const disposition: PolicyDisposition = prohibited
    ? "prohibited"
    : reasons.length > 0 || riskSignals.length > 0
      ? "needs_review"
      : "allowed";

  const capabilityReview =
    reasons.includes("weight_over_50_lb") ||
    reasons.includes("special_equipment_required") ||
    reasons.includes("vehicle_capability_review") ||
    reasons.includes("setup_breakdown_required") ||
    reasons.includes("stairs_access_concern") ||
    reasons.includes("loading_uncertainty") ||
    reasons.includes("bulky_without_dimensions");
  const operationalCapability: OperationalCapability = capabilityReview
    ? "needs_review"
    : "standard_lane";

  return {
    policyVersion: SHIPMENT_POLICY_VERSION,
    disposition,
    reasons,
    riskSignals,
    operationalCapability,
    unresolvedFacts: unresolved,
  };
}

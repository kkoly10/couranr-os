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
import type { RestrictedSignalScan } from "./restrictedSignals";

export const SHIPMENT_POLICY_VERSION = "couranr-shipment-policy-v1-2026-09-02";

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
  /**
   * No TRUSTED shipment-safety declaration exists (missing, "unknown", or
   * only an untrusted proposal). Automatic `allowed` requires the merchant to
   * affirm `restricted_class = none`; absence of an AI signal is never
   * absence of a safety concern.
   */
  | "safety_declaration_required"
  | "restricted_signal_unresolved"
  /** The merchant declared `none`, but the raw description carries a material restricted-item signal. */
  | "restricted_signal_conflicts_declaration"
  /** A deterministic lexical restricted-item signal in the raw description (escalation only). */
  | "restricted_text_signal"
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

/**
 * Audit truth (§9 of the correction pass): a fact a trusted actor stated
 * populates deterministic `reasons`; the same fact as an unconfirmed AI
 * proposal lands in `riskSignals`. Both may force review — what differs is
 * what Operations is told the review is BASED on.
 */
function escalate(
  facts: FactMap,
  key: FactKey,
  code: PolicyReason,
  test: (value: unknown) => boolean,
  reasons: PolicyReason[],
  riskSignals: PolicyReason[]
): void {
  const f = fact(facts, key);
  if (!f || !test(f.value)) return;
  (isTrustedAuthority(f.authority) ? reasons : riskSignals).push(code);
}

export type PolicyEvaluationOptions = {
  /**
   * Deterministic lexical scan of the merchant's RAW description (see
   * restrictedSignals.ts). Escalation-only input: it can add risk signals,
   * force review, and contradict a `none` declaration — it can never
   * prohibit and never clear.
   */
  textSignals?: RestrictedSignalScan | null;
};

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

export function evaluateShipmentPolicy(
  facts: FactMap,
  options: PolicyEvaluationOptions = {}
): ShipmentPolicyResult {
  const reasons: PolicyReason[] = [];
  const riskSignals: PolicyReason[] = [];
  const unresolved: FactKey[] = [];
  const textSignals = options.textSignals ?? null;

  /* ---- 1. Safety: a TRUSTED declaration is required for `allowed` -------- */
  const restricted = fact(facts, "restricted_class");
  const trustedDeclaration =
    restricted && isTrustedAuthority(restricted.authority) ? restricted.value : null;
  let prohibited = false;
  if (trustedDeclaration !== null && isProhibitedClass(trustedDeclaration)) {
    // Hard prohibition: trusted confirmation ONLY. Deterministic; no model
    // can create it and no model can clear it.
    prohibited = true;
    reasons.push("prohibited_class_confirmed");
  } else if (trustedDeclaration === "none") {
    // The merchant affirmed none of the classes is present. The raw text can
    // still contradict them materially ("12 bottles of beer" + "none"): that
    // stays in review until a person resolves it — but it is a signal, so it
    // is a risk signal, never a prohibition.
    if (textSignals?.material) {
      riskSignals.push("restricted_signal_conflicts_declaration");
      unresolved.push("restricted_class");
    }
  } else {
    // Missing, "unknown", or only an untrusted proposal. Absence of an AI
    // signal is NOT absence of a safety concern: without the declaration
    // there is no automatic quote, and the priority-1 question is asked.
    reasons.push("safety_declaration_required");
    unresolved.push("restricted_class");
    if (restricted && isProhibitedClass(restricted.value)) {
      riskSignals.push("restricted_signal_unresolved");
    }
    if (textSignals && textSignals.signals.length > 0) {
      riskSignals.push("restricted_text_signal");
    }
  }

  /* ---- 2. Batteries ---------------------------------------------------- */
  // Damaged/swollen/recalled lithium never auto-passes, whoever said it —
  // escalation is allowed from any source (§13); which column it lands in
  // records who said it. Ordinary installed batteries in normal electronics
  // are deliberately NOT a reason.
  escalate(
    facts,
    "battery_condition",
    "battery_condition_damaged",
    (v) => v === "damaged_defective_recalled",
    reasons,
    riskSignals
  );

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
  // Each of these escalates from ANY source, but lands in `reasons` only when
  // a trusted actor stated it and in `riskSignals` when only a model did.
  escalate(facts, "declared_value_band", "high_declared_value", (v) => v === "over_1000", reasons, riskSignals);
  escalate(facts, "fragile", "fragile_shipment", (v) => v === true, reasons, riskSignals);
  escalate(facts, "temperature_sensitive", "temperature_sensitive", (v) => v === true, reasons, riskSignals);
  escalate(facts, "loading_uncertainty", "loading_uncertainty", (v) => v === true, reasons, riskSignals);
  escalate(facts, "stairs_access", "stairs_access_concern", (v) => v === true, reasons, riskSignals);
  escalate(facts, "setup_breakdown", "setup_breakdown_required", (v) => v === true, reasons, riskSignals);
  escalate(
    facts,
    "special_equipment",
    "special_equipment_required",
    (v) => typeof v === "string" && v.trim() !== "" && v !== "none",
    reasons,
    riskSignals
  );
  // A claimed non-standard vehicle need is an OPERATIONS review, never an
  // automatic surcharge and never a hardcoded personal vehicle (§15).
  escalate(
    facts,
    "vehicle_requirement",
    "vehicle_capability_review",
    (v) => typeof v === "string" && !["", "none", "standard"].includes(v),
    reasons,
    riskSignals
  );
  const dims = fact(facts, "dimensions_in");
  escalate(
    facts,
    "size_bulk",
    "bulky_without_dimensions",
    (v) => typeof v === "string" && /bulk|oversiz|large/i.test(v) && !dims,
    reasons,
    riskSignals
  );

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

  const capabilityCodes: PolicyReason[] = [
    "weight_over_50_lb",
    "special_equipment_required",
    "vehicle_capability_review",
    "setup_breakdown_required",
    "stairs_access_concern",
    "loading_uncertainty",
    "bulky_without_dimensions",
  ];
  // Capability review is triggered by a stated OR a signalled need — the
  // difference between them is audit truth, not whether Ops must look.
  const capabilityReview = capabilityCodes.some(
    (c) => reasons.includes(c) || riskSignals.includes(c)
  );
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

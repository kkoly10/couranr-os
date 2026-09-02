/**
 * P5-001 — V0 structured shipment facts and their authority model.
 *
 * ---------------------------------------------------------------------------
 * WHAT A FACT IS HERE
 * ---------------------------------------------------------------------------
 *
 * Smart Intake is durable INPUT ENRICHMENT, not a second request system. The
 * canonical request stays `couranr_delivery_requests`; the canonical
 * commercial quote stays `couranr_quote_versions`. What lives here is the
 * evidence layer between a merchant's sentence and the canonical command
 * boundary: WHO said each thing, HOW SURE anyone is, and WHETHER a trusted
 * actor has confirmed it.
 *
 * The governing rule, verbatim from the batch authority:
 *
 *   AI PROPOSES. COURANR VALIDATES. A TRUSTED ACTOR CONFIRMS MATERIAL FACTS.
 *   SERVER COMMITS.
 *
 * Nothing in this module mutates anything. It is vocabulary and validation.
 */

/* ----------------------------------------------------------- weight bands */

/**
 * SUR-001 V2 governed weight bands. A BAND IS NOT A WEIGHT — it names which
 * pricing/handling rule applies, never how much the parcel weighs. `unknown`
 * is a first-class value precisely so nobody has to invent pounds (midpoints,
 * bounds, zeros and sentinels are all banned) to satisfy an old non-null API.
 */
export const WEIGHT_BANDS = [
  "0_25_lb",
  "over_25_to_50_lb",
  "over_50_lb",
  "unknown",
] as const;
export type WeightBand = (typeof WEIGHT_BANDS)[number];

export function isWeightBand(v: unknown): v is WeightBand {
  return typeof v === "string" && (WEIGHT_BANDS as readonly string[]).includes(v);
}

/** The band an EXACT weight falls in. Never runs the other direction. */
export function weightBandForExactLb(weightLb: number): WeightBand {
  if (!Number.isFinite(weightLb) || weightLb < 0) return "unknown";
  if (weightLb <= 25) return "0_25_lb";
  if (weightLb <= 50) return "over_25_to_50_lb";
  return "over_50_lb";
}

/* ------------------------------------------------------------ provenance */

/**
 * Where a fact value came from. `deterministic_policy` is the one
 * system-authored source: values the deterministic evaluator derived from
 * other facts (never from prose), named clearly so audit can tell it from a
 * model guess.
 */
export const FACT_SOURCES = [
  "merchant_statement",
  "saved_preset",
  "merchant_default",
  "previous_confirmed_delivery",
  "ai_inference",
  "deterministic_policy",
  "unknown",
] as const;
export type FactSource = (typeof FACT_SOURCES)[number];

/**
 * Authority is NOT a boolean. `proposed` is anything nobody trusted has
 * signed; `confirmed` and `overridden` are trusted-actor acts (`overridden`
 * records that the actor REPLACED a proposal rather than accepting it);
 * `unknown` is the honest empty state. Confidence never grants authority —
 * a 99%-confident model conclusion is still `proposed`.
 */
export const FACT_AUTHORITIES = ["proposed", "confirmed", "overridden", "unknown"] as const;
export type FactAuthority = (typeof FACT_AUTHORITIES)[number];

/** A trusted actor has attested this value (either accepting or replacing). */
export function isTrustedAuthority(a: FactAuthority): boolean {
  return a === "confirmed" || a === "overridden";
}

/* -------------------------------------------------------------- fact keys */

/**
 * The closed V0 fact vocabulary (§8 of the batch authority). Closed on
 * purpose: an unknown key coming back from a model is DROPPED at validation,
 * never stored, so unvalidated model output cannot become a canonical fact by
 * inventing a field name.
 */
export const FACT_KEYS = [
  "merchant_reference",
  "item_category",
  "item_subtype",
  "quantity",
  "package_count",
  "weight_lb_exact",
  "weight_band",
  "dimensions_in",
  "size_bulk",
  "declared_value_band",
  "fragile",
  "temperature_sensitive",
  "handling_requirements",
  "loading_uncertainty",
  "stairs_access",
  "setup_breakdown",
  "special_equipment",
  "vehicle_requirement",
  "restricted_class",
  "battery_condition",
  "timing_intent",
  "requested_pickup_local",
  "service_level",
  "payer_type",
  "proof_signature",
] as const;
export type FactKey = (typeof FACT_KEYS)[number];

export function isFactKey(v: unknown): v is FactKey {
  return typeof v === "string" && (FACT_KEYS as readonly string[]).includes(v);
}

/**
 * MATERIAL facts are the ones a trusted actor must confirm before the value
 * can move policy, price, or operations. Convenience facts may flow through
 * as proposals.
 */
export const MATERIAL_FACT_KEYS: readonly FactKey[] = [
  "item_category",
  "weight_lb_exact",
  "weight_band",
  "declared_value_band",
  "fragile",
  "temperature_sensitive",
  "loading_uncertainty",
  "stairs_access",
  "setup_breakdown",
  "special_equipment",
  "restricted_class",
  "battery_condition",
  "timing_intent",
  "requested_pickup_local",
  "service_level",
  "payer_type",
];

export function isMaterialFact(key: FactKey): boolean {
  return MATERIAL_FACT_KEYS.includes(key);
}

/* ------------------------------------------------------ restricted classes */

/**
 * The hard-prohibited shipment classes (§13). CONFIRMED membership in one of
 * these prohibits the shipment; a mere signal (keyword, model hunch,
 * similarity) may only raise risk. The list is closed and versioned with the
 * policy engine.
 */
export const PROHIBITED_CLASSES = [
  "alcohol",
  "tobacco",
  "vaping_nicotine",
  "cannabis_thc",
  "firearms",
  "ammunition",
  "prescription_medication",
  "controlled_substances",
  "fuel",
  "compressed_gas",
  "corrosive_hazmat",
  "toxic_hazmat",
  "infectious_material",
  "regulated_dangerous_goods",
  "fireworks",
  "explosives",
  "illegal_goods",
  "stolen_goods",
  "cash",
  "negotiable_instruments",
  "biological_specimens",
  "live_animals",
  "people",
] as const;
export type ProhibitedClass = (typeof PROHIBITED_CLASSES)[number];

export function isProhibitedClass(v: unknown): v is ProhibitedClass {
  return typeof v === "string" && (PROHIBITED_CLASSES as readonly string[]).includes(v);
}

/* ------------------------------------------------------------- fact shape */

export const FACT_SCHEMA_VERSION = "couranr-shipment-facts-v0-2026-09-02";

/** Longest value/evidence strings the store accepts. Bounded on purpose. */
export const MAX_FACT_STRING_LENGTH = 500;
export const MAX_RAW_DESCRIPTION_LENGTH = 4000;

export type ShipmentFact = {
  key: FactKey;
  /**
   * Normalized value. JSON-safe scalar or small structure; validated per key
   * by `validateFactValue` before anything stores it.
   */
  value: unknown;
  /** 0–100 when inference participated; null for stated/preset values. */
  confidence: number | null;
  source: FactSource;
  /**
   * The exact span of merchant text (or preset name, etc.) this value came
   * from. Evidence for a human, bounded, never fed back to a model as
   * instructions.
   */
  sourceEvidence: string | null;
  requiresConfirmation: boolean;
  authority: FactAuthority;
};

export type FactMap = Partial<Record<FactKey, ShipmentFact>>;

/* -------------------------------------------------- per-key value checks */

const BOOL_KEYS: readonly FactKey[] = [
  "fragile",
  "temperature_sensitive",
  "loading_uncertainty",
  "stairs_access",
  "setup_breakdown",
];

const POSITIVE_INT_KEYS: readonly FactKey[] = ["quantity", "package_count"];

const SHORT_STRING_KEYS: readonly FactKey[] = [
  "merchant_reference",
  "item_category",
  "item_subtype",
  "handling_requirements",
  "special_equipment",
  "vehicle_requirement",
  "dimensions_in",
  "size_bulk",
];

const DECLARED_VALUE_BANDS = ["under_100", "100_to_1000", "over_1000", "unknown"] as const;
const BATTERY_CONDITIONS = ["ordinary_installed", "damaged_defective_recalled", "unknown"] as const;
const SERVICE_LEVELS_V0 = ["standard", "priority", "rush"] as const;
const PAYER_TYPES_V0 = ["merchant", "customer"] as const;
const PROOF_SIGNATURE_V0 = ["photo_or_pin", "signature"] as const;
const TIMING_INTENTS_V0 = ["asap", "scheduled"] as const;

function inVocab(v: unknown, vocab: readonly string[]): boolean {
  return typeof v === "string" && vocab.includes(v);
}

/**
 * Is this value shape acceptable for this key? Pure validation — a `false`
 * here means the value is DROPPED (with the drop recorded by the caller),
 * never coerced into something storable.
 */
export function validateFactValue(key: FactKey, value: unknown): boolean {
  if (BOOL_KEYS.includes(key)) return typeof value === "boolean";
  if (POSITIVE_INT_KEYS.includes(key)) {
    return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 10_000;
  }
  if (SHORT_STRING_KEYS.includes(key)) {
    return (
      typeof value === "string" &&
      value.trim().length > 0 &&
      value.length <= MAX_FACT_STRING_LENGTH
    );
  }
  switch (key) {
    case "weight_lb_exact":
      return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 20_000;
    case "weight_band":
      return isWeightBand(value);
    case "declared_value_band":
      return inVocab(value, DECLARED_VALUE_BANDS);
    case "restricted_class":
      return isProhibitedClass(value) || value === "none" || value === "unknown";
    case "battery_condition":
      return inVocab(value, BATTERY_CONDITIONS);
    case "timing_intent":
      return inVocab(value, TIMING_INTENTS_V0);
    case "requested_pickup_local":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value);
    case "service_level":
      return inVocab(value, SERVICE_LEVELS_V0);
    case "payer_type":
      return inVocab(value, PAYER_TYPES_V0);
    case "proof_signature":
      return inVocab(value, PROOF_SIGNATURE_V0);
    default:
      return false;
  }
}

/**
 * The one merge rule that protects merchants from models: a later PROPOSAL
 * never replaces a fact a trusted actor already attested. Disagreement is the
 * caller's to retain as evidence (and optionally escalate) — silently keeping
 * the newer guess is exactly the bug this function exists to make impossible.
 */
export function proposalMayReplace(existing: ShipmentFact | undefined): boolean {
  if (!existing) return true;
  return !isTrustedAuthority(existing.authority);
}

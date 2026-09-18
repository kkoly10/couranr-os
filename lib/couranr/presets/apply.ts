/**
 * Applying a saved preset to the New Delivery form.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS, AND WHAT IT REFUSES TO BE
 * ---------------------------------------------------------------------------
 *
 * A preset prefills a form. That is the whole of it. Every value it produces
 * lands in ordinary form state the merchant can still change, and then travels
 * the identical validation, pricing, eligibility and proof path a hand-typed
 * request travels. Nothing here decides anything.
 *
 * `fields.ts` already guarantees a preset CANNOT HOLD weight, dimensions,
 * value, final vehicle, price, loading availability or safety — stripped in TS
 * before a write and refused by a jsonb CHECK in the migration. So this module
 * inherits that boundary rather than re-asserting it: there is no forbidden
 * field here to guard against, because one cannot exist in the body.
 *
 * ---------------------------------------------------------------------------
 * FIVE OF THE SEVEN, AND WHY THE OTHER TWO ARE ABSENT
 * ---------------------------------------------------------------------------
 *
 * A preset may suggest seven things (ACP-025). Five have somewhere legitimate
 * to go on the current New Delivery form:
 *
 *   commonItem      -> pickupDescription   (OPERATIONS form only - see below)
 *   packageCount    -> pickupPackageCount
 *   handling        -> pickupHandlingNotes
 *   proofMethod     -> proofMethod         (through the EXISTING withdrawn path)
 *   payerPreference -> payerType
 *
 * `commonItem` has a home on only ONE of the two forms this flow renders. The
 * operations form asks "What should the driver look for?" outright; the
 * merchant form does not - there, Smart Intake owns the description and pushes
 * it down through `onDescriptionChange`, one way. Writing `pickupDescription`
 * on the merchant form would set a value the merchant cannot see or edit, claim
 * in the outcome that something was filled when nothing visibly changed, and
 * then have Smart Intake overwrite it the moment they describe the shipment.
 * The existing duplicate-a-delivery seed reached the same conclusion and seeds
 * every other field but this one. So the caller says whether the field is real,
 * and when it is not the value is reported as not applied rather than written
 * somewhere invisible.
 *
 * `vehicleCapabilities` and `requiredQuestions` have no field on that form, and
 * this module does not invent one. Adding UI so a preset value has a home would
 * be expanding the delivery model to justify the preset — backwards, and the
 * vehicle case is worse than backwards: vehicle capability is server-authoritative
 * and a form control fed by a preset is exactly how that authority erodes.
 * They stay stored, stay editable on the preset screen, and simply do not apply
 * here until the form has an honest home for them.
 *
 * Pure and dependency-free, so every rule above is testable without a database
 * or a browser.
 */

import type { PresetBody } from "./fields";

/** The subset of a preset body that the current New Delivery form can accept. */
export type PresetSeed = Partial<{
  pickupDescription: string;
  pickupPackageCount: string;
  pickupHandlingNotes: string;
  proofMethod: string;
  payerType: "merchant" | "customer";
}>;

/** Which preset fields reach the form, for copy that tells the merchant the truth. */
export const APPLICABLE_PRESET_FIELDS = [
  "commonItem",
  "packageCount",
  "handling",
  "proofMethod",
  "payerPreference",
] as const;

/**
 * Preset fields deliberately NOT applied, with the reason, so the UI can say so
 * rather than leaving a merchant to wonder why what they saved did nothing.
 */
export const UNAPPLIED_PRESET_FIELDS: Readonly<Record<string, string>> = {
  vehicleCapabilities:
    "Vehicle suitability is decided when the delivery is priced, not chosen on the form.",
  requiredQuestions:
    "Required questions are not part of the delivery form yet.",
};

const PAYER_TYPES = new Set(["merchant", "customer"]);

/**
 * Turn a stored preset body into form values.
 *
 * Only keys the body actually carries are returned — an absent key and an empty
 * string are different things, and the caller's fill-empty-only rule depends on
 * being able to tell them apart.
 *
 * `packageCount` becomes a STRING because that is what the form holds; it is a
 * text input whose emptiness is meaningful ("leave it blank if unknown").
 * Converting to a number here and back there would lose that.
 */
export function buildPresetSeed(body: PresetBody | null | undefined): PresetSeed {
  const seed: PresetSeed = {};
  if (!body || typeof body !== "object") return seed;

  if (typeof body.commonItem === "string" && body.commonItem.trim() !== "") {
    seed.pickupDescription = body.commonItem.trim();
  }
  if (
    typeof body.packageCount === "number" &&
    Number.isInteger(body.packageCount) &&
    body.packageCount > 0
  ) {
    seed.pickupPackageCount = String(body.packageCount);
  }
  if (typeof body.handling === "string" && body.handling.trim() !== "") {
    seed.pickupHandlingNotes = body.handling.trim();
  }
  // Passed through verbatim. Whether it is still SELECTABLE is not this
  // module's question — the form's existing withdrawn-method path owns that,
  // and duplicating the check here would create the second proof-method
  // validator this build is explicitly not allowed to have.
  if (typeof body.proofMethod === "string" && body.proofMethod.trim() !== "") {
    seed.proofMethod = body.proofMethod.trim();
  }
  // A payer preference outside the two the form models is dropped rather than
  // coerced: silently turning an unrecognised value into "merchant" would
  // decide who pays on the merchant's behalf.
  if (typeof body.payerPreference === "string" && PAYER_TYPES.has(body.payerPreference)) {
    seed.payerType = body.payerPreference as "merchant" | "customer";
  }
  return seed;
}

/**
 * Which of a seed's values a form in `current` state would actually take.
 *
 * FILL EMPTY ONLY. A merchant who has typed a handling note and then reaches
 * for a preset wants the rest filled in, not their sentence replaced. Anything
 * already carrying a value is left exactly as it is, and the caller reports
 * both lists so the merchant can see what happened instead of hunting for it.
 *
 * `payerType` is the awkward one and is treated as ALWAYS-PRESENT: it defaults
 * to "merchant" rather than to blank, so "is it empty" has no answer. Applying
 * a preset must therefore never move it — a preset silently changing who pays
 * is precisely the kind of quiet authority a preset must not have.
 *
 * That makes THREE outcomes, not two, and they are returned separately because
 * they are different sentences to a merchant:
 *
 *   apply       filled in, because the field was empty
 *   skipped     left alone, because the merchant had already typed something
 *   notApplied  never applied by this build, whatever the field holds
 *
 * Folding `notApplied` into `skipped` would have the form tell a merchant it
 * kept what they entered for a field they never touched. A preset that lies
 * about what it did is worse than one that does less.
 */
export function planPresetApplication(
  seed: PresetSeed,
  current: {
    pickupDescription: string;
    pickupPackageCount: string;
    pickupHandlingNotes: string;
    proofMethodTouched: boolean;
    /**
     * Whether "What should the driver look for?" is actually on screen. False
     * on the merchant form, where Smart Intake owns the description.
     */
    pickupDescriptionEditable: boolean;
  },
): {
  apply: PresetSeed;
  skipped: (keyof PresetSeed)[];
  notApplied: (keyof PresetSeed)[];
} {
  const apply: PresetSeed = {};
  const skipped: (keyof PresetSeed)[] = [];
  const notApplied: (keyof PresetSeed)[] = [];

  const take = <K extends keyof PresetSeed>(key: K, occupied: boolean) => {
    if (seed[key] === undefined) return;
    if (occupied) skipped.push(key);
    else apply[key] = seed[key];
  };

  if (seed.pickupDescription !== undefined && !current.pickupDescriptionEditable) {
    // No field to fill. Reported, not written somewhere the merchant cannot see.
    notApplied.push("pickupDescription");
  } else {
    take("pickupDescription", current.pickupDescription.trim() !== "");
  }
  take("pickupPackageCount", current.pickupPackageCount.trim() !== "");
  take("pickupHandlingNotes", current.pickupHandlingNotes.trim() !== "");
  take("proofMethod", current.proofMethodTouched);

  // Never applied, and reported as such rather than as something the merchant
  // entered — see the note above.
  if (seed.payerType !== undefined) notApplied.push("payerType");

  return { apply, skipped, notApplied };
}

/** Merchant-facing label for a seed key. No field names leak into the UI. */
export const PRESET_FIELD_LABEL: Readonly<Record<keyof PresetSeed, string>> = {
  pickupDescription: "What to look for",
  pickupPackageCount: "Package count",
  pickupHandlingNotes: "Handling note",
  proofMethod: "Proof of delivery",
  payerType: "Who pays",
};

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
 * A preset may suggest seven things (ACP-025). Five of them MAP to a form value
 * here — but read the right-hand column before assuming five of them land:
 *
 *   packageCount    -> pickupPackageCount   FILLS when empty
 *   handling        -> pickupHandlingNotes  FILLS when empty
 *   proofMethod     -> proofMethod          FILLS, through the EXISTING
 *                                           withdrawn-method path
 *   commonItem      -> pickupDescription    NEVER, today: the field exists only
 *                                           on the Operations form, and this
 *                                           card renders only on the merchant
 *                                           one. Mapped rather than deleted
 *                                           because the rule is about the FORM,
 *                                           not the preset, and the day
 *                                           Operations gets presets it lands.
 *   payerPreference -> payerType            NEVER, by rule — see
 *                                           `planPresetApplication`
 *
 * So THREE fields reach a merchant's form today. Both of the others are
 * reported to the merchant with their reason rather than dropped quietly, which
 * is the only honest way to map a field to nowhere.
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
import {
  isSelectableProofMethod,
  type SelectableProofMethod,
} from "@/lib/couranr/requests/input";

/** The subset of a preset body that the current New Delivery form can accept. */
export type PresetSeed = Partial<{
  pickupDescription: string;
  pickupPackageCount: string;
  pickupHandlingNotes: string;
  /* NARROWED ON PURPOSE. A seed value goes straight into form state, so the
     type is the place to stop a withdrawn method rather than the call site:
     `string` here meant every future caller had to remember the check, and
     forgetting it is silent. `buildPresetSeed` is the only producer and it
     filters through the ONE authority below. */
  proofMethod: SelectableProofMethod;
  payerType: "merchant" | "customer";
}>;

/**
 * The ACP-025 fields this build CAN place on a form.
 *
 * Not UI copy — the merchant-facing names live in `PRESET_FIELD_LABEL`. This is
 * the accounting half of the seven-field contract: together with
 * `UNAPPLIED_PRESET_FIELDS` it must name all seven, and a test asserts exactly
 * that, so adding a suggestable field without deciding where it goes fails
 * rather than silently doing nothing.
 */
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
 *
 * These two never reach `PresetSeed` at all — `buildPresetSeed` has nowhere to
 * put them — so they cannot come out of `planPresetApplication` either. They
 * are read straight off the BODY by `describeUnapplied`, which is the only
 * reason this table earns its place: for a while it existed, documented exactly
 * this promise, and was read by nothing but its own test, which meant a
 * merchant whose preset carried vehicle needs got silence.
 */
export type BodyOnlyPresetField = "vehicleCapabilities" | "requiredQuestions";

export const UNAPPLIED_PRESET_FIELDS: Readonly<Record<BodyOnlyPresetField, string>> = {
  vehicleCapabilities:
    "Vehicle suitability is decided when the delivery is priced, not chosen on the form.",
  requiredQuestions:
    "Required questions are not part of the delivery form yet.",
};

/**
 * Merchant-facing names for the two fields that never reach the form.
 *
 * Keyed on the same union as the reasons above, so a field added to one and not
 * the other fails to compile. It previously fell back to the raw key, which
 * would have put `vehicleCapabilities` in front of a merchant — the same way a
 * generic reason would have: quietly, and only once someone shipped it.
 */
const UNAPPLIED_PRESET_FIELD_LABEL: Readonly<Record<BodyOnlyPresetField, string>> = {
  vehicleCapabilities: "Vehicle needs",
  requiredQuestions: "Questions to ask",
};

/**
 * Why a seed field the form COULD hold was still not applied.
 *
 * EXHAUSTIVE on purpose — not `Partial`. Only two of these can reach the
 * not-applied bucket today, but a rule that adds a third would otherwise
 * compile happily and show the merchant a generic sentence invented to cover
 * the gap. Requiring the reason here makes that a type error at the moment the
 * rule changes, which is the same bargain the seven-field accounting test
 * makes: a field with nowhere to go must fail loudly, never quietly.
 */
const SEED_NOT_APPLIED_REASON: Readonly<Record<keyof PresetSeed, string>> = {
  pickupDescription: "You describe the shipment in your own words on this form.",
  pickupPackageCount: "You set the package count on this form.",
  pickupHandlingNotes: "You write the handling note on this form.",
  proofMethod: "You choose proof of delivery on this form.",
  payerType: "You choose who pays on this form.",
};

/** One thing a preset carried, and the reason it did not reach the form. */
export type UnappliedField = { label: string; reason: string };

/**
 * Everything the preset holds that this form did not fill, each with its reason.
 *
 * Two sources, because there are two ways a value can fail to land: a seed key
 * this build refuses to apply (`payerType`, or a description on a form with no
 * description field), and a body key that never became a seed at all (vehicle
 * needs, required questions). A merchant does not care which kind theirs is —
 * they care that the thing they saved did nothing and nobody said why.
 */
export function describeUnapplied(
  notApplied: readonly (keyof PresetSeed)[],
  body: PresetBody | null | undefined,
): UnappliedField[] {
  const out: UnappliedField[] = notApplied.map((k) => ({
    label: PRESET_FIELD_LABEL[k],
    reason: SEED_NOT_APPLIED_REASON[k],
  }));

  if (body && typeof body === "object") {
    for (const key of Object.keys(UNAPPLIED_PRESET_FIELDS) as BodyOnlyPresetField[]) {
      const value = (body as Record<string, unknown>)[key];
      if (Array.isArray(value) && value.length > 0) {
        out.push({
          label: UNAPPLIED_PRESET_FIELD_LABEL[key],
          reason: UNAPPLIED_PRESET_FIELDS[key],
        });
      }
    }
  }
  return out;
}

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
  /* FILTERED, NOT VALIDATED. The original note here was right that this module
     must not become a second proof-method validator — this build has been bitten
     by two-authority drift before. So it does not implement a check: it CALLS
     `isSelectableProofMethod`, the single authority the intake gate, the form's
     select and the database backstop all use. One rule, read from one place.

     What changed is where the rule binds. It used to bind at the call site,
     which meant a future second consumer of `planPresetApplication` would put a
     withdrawn method into form state by simply not remembering to check. Now a
     non-selectable value cannot enter a `PresetSeed` at all, and the type says
     so. `withdrawnProofMethodFromBody` below keeps the merchant informed, which
     is the half that must not be lost: silently changing someone's saved proof
     method is its own defect. The preset itself is never rewritten. */
  if (typeof body.proofMethod === "string") {
    const raw = body.proofMethod.trim();
    if (isSelectableProofMethod(raw)) seed.proofMethod = raw;
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
 * The proof method a saved preset holds that Couranr no longer offers, if any.
 *
 * `buildPresetSeed` drops it, because a withdrawn method must never reach form
 * state. Dropping it silently would be the other defect — the merchant chose
 * that method once and is entitled to know it is not being used — so the value
 * is surfaced here for the caller to report. Same single authority as the
 * builder; this is a read of the body, not a second rule.
 */
export function withdrawnProofMethodFromBody(
  body: PresetBody | null | undefined,
): string | null {
  const raw = typeof body?.proofMethod === "string" ? body.proofMethod.trim() : "";
  if (raw === "" || isSelectableProofMethod(raw)) return null;
  return raw;
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

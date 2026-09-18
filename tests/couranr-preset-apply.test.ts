/**
 * Applying a saved preset to the New Delivery form.
 *
 * The rules under test are the ones a merchant would notice being broken: a
 * preset must not overwrite what they already typed, must not decide who pays,
 * and must not reach fields the delivery form has no honest home for.
 */

import { describe, expect, it } from "vitest";
import {
  withdrawnProofMethodFromBody,
  APPLICABLE_PRESET_FIELDS,
  PRESET_FIELD_LABEL,
  UNAPPLIED_PRESET_FIELDS,
  describeUnapplied,
  buildPresetSeed,
  planPresetApplication,
} from "@/lib/couranr/presets/apply";
import { SUGGESTABLE_FIELDS } from "@/lib/couranr/presets/fields";

const EMPTY_FORM = {
  pickupDescription: "",
  pickupPackageCount: "",
  pickupHandlingNotes: "",
  proofMethodTouched: false,
  // The OPERATIONS form, which genuinely asks for a description.
  pickupDescriptionEditable: true,
};

const FULL_BODY = {
  commonItem: "Two dozen roses in a box",
  packageCount: 3,
  handling: "Keep upright",
  proofMethod: "signature",
  payerPreference: "customer",
  vehicleCapabilities: ["refrigerated"],
  requiredQuestions: ["Gate code?"],
};

describe("buildPresetSeed", () => {
  it("maps the five fields the form can actually take", () => {
    expect(buildPresetSeed(FULL_BODY)).toEqual({
      pickupDescription: "Two dozen roses in a box",
      pickupPackageCount: "3",
      pickupHandlingNotes: "Keep upright",
      proofMethod: "signature",
      payerType: "customer",
    });
  });

  // The two absent fields are the point of the rule, not an oversight. Vehicle
  // capability is server-authoritative; giving a preset a form control for it
  // is how that authority quietly becomes advisory.
  it("produces nothing for vehicle capabilities or required questions", () => {
    const seed = buildPresetSeed(FULL_BODY) as Record<string, unknown>;
    for (const key of Object.keys(seed)) {
      expect(key).not.toMatch(/vehicle|question/i);
    }
    expect(Object.keys(UNAPPLIED_PRESET_FIELDS).sort()).toEqual([
      "requiredQuestions",
      "vehicleCapabilities",
    ]);
  });

  it("accounts for every suggestable field exactly once — applied or explained", () => {
    // If a future decision adds an eighth suggestable field, this fails until
    // someone decides whether it applies, rather than it silently doing nothing.
    const accounted = [...APPLICABLE_PRESET_FIELDS, ...Object.keys(UNAPPLIED_PRESET_FIELDS)];
    expect(accounted.slice().sort()).toEqual([...SUGGESTABLE_FIELDS].sort());
  });

  it("omits absent, blank and malformed values rather than emitting empties", () => {
    expect(buildPresetSeed({})).toEqual({});
    expect(buildPresetSeed(null)).toEqual({});
    expect(
      buildPresetSeed({ commonItem: "   ", handling: "", packageCount: 0 }),
    ).toEqual({});
    // A count that is not a whole positive number is not a count.
    expect(buildPresetSeed({ packageCount: 2.5 })).toEqual({});
    expect(buildPresetSeed({ packageCount: -1 })).toEqual({});
  });

  /*
   * DEFENCE IN DEPTH. `fields.ts` strips these before a write and a jsonb CHECK
   * refuses them in the database, so a body carrying one should be impossible.
   * This asserts the third gate anyway: the seed builder reads five known keys
   * and nothing else, so even a body that somehow held a weight, a value, a
   * price or a vehicle could not put one on the delivery form. The cost of the
   * assertion is a line; the cost of assuming is a preset that fixes a price.
   */
  it("cannot carry a forbidden field onto the form, whatever the body holds", () => {
    const seed = buildPresetSeed({
      commonItem: "Two dozen roses in a box",
      weightLb: 42,
      dimensions: { l: 10, w: 10, h: 10 },
      declaredValueCents: 250_000,
      vehicle: "cargo_van",
      priceCents: 4_999,
      loadingAvailable: true,
      safetyCritical: true,
    } as never);
    expect(seed).toEqual({ pickupDescription: "Two dozen roses in a box" });
  });

  it("drops an unrecognised payer preference instead of coercing it", () => {
    // Coercing to "merchant" would decide who pays on the merchant's behalf.
    expect(buildPresetSeed({ payerPreference: "split" })).toEqual({});
    expect(buildPresetSeed({ payerPreference: "merchant" })).toEqual({ payerType: "merchant" });
  });

  it("keeps a selectable proof method", () => {
    expect(buildPresetSeed({ proofMethod: "signature" })).toEqual({ proofMethod: "signature" });
    expect(buildPresetSeed({ proofMethod: "photo_or_pin" })).toEqual({
      proofMethod: "photo_or_pin",
    });
  });

  it("CANNOT emit a withdrawn proof method, whatever the stored body says", () => {
    /* The earlier shape passed this through verbatim and left the check to the
       form. That reasoning was half right: this module must not become a SECOND
       proof-method validator, and it still is not one — it calls
       `isSelectableProofMethod`, the same authority the intake gate, the form's
       select and the database backstop read.

       What it must not do is leave the rule bound to a call site. A seed value
       goes straight into form state, so a future second consumer of
       `planPresetApplication` would have put a withdrawn method on a form by
       simply forgetting to check, and forgetting is silent. The seed type is
       now `SelectableProofMethod`, so this cannot compile, let alone run. */
    expect(buildPresetSeed({ proofMethod: "leave_at_door" })).toEqual({});
  });

  it("still surfaces the withdrawn method, so the merchant is told", () => {
    /* Dropping it silently is the other defect: the merchant chose that method
       once and would otherwise just find it missing from the form. */
    expect(withdrawnProofMethodFromBody({ proofMethod: "leave_at_door" })).toBe("leave_at_door");
    expect(withdrawnProofMethodFromBody({ proofMethod: "signature" })).toBeNull();
    expect(withdrawnProofMethodFromBody({ proofMethod: "   " })).toBeNull();
    expect(withdrawnProofMethodFromBody(null)).toBeNull();
    expect(withdrawnProofMethodFromBody({})).toBeNull();
  });
});

describe("planPresetApplication — fill empty only", () => {
  it("fills an empty form completely", () => {
    const { apply, skipped, notApplied } = planPresetApplication(
      buildPresetSeed(FULL_BODY),
      EMPTY_FORM,
    );
    expect(apply).toEqual({
      pickupDescription: "Two dozen roses in a box",
      pickupPackageCount: "3",
      pickupHandlingNotes: "Keep upright",
      proofMethod: "signature",
    });
    // payerType is offered by the preset and deliberately never applied.
    expect(notApplied).toContain("payerType");
    // …and it is NOT reported as something the merchant had entered, because on
    // an empty form they entered nothing at all.
    expect(skipped).toEqual([]);
  });

  // The rule a merchant would feel: their sentence survives.
  it("never overwrites a value the merchant already entered", () => {
    const { apply, skipped } = planPresetApplication(buildPresetSeed(FULL_BODY), {
      ...EMPTY_FORM,
      pickupHandlingNotes: "Ring the bell twice",
      pickupDescription: "Wedding cake",
    });
    expect(apply.pickupHandlingNotes).toBeUndefined();
    expect(apply.pickupDescription).toBeUndefined();
    expect(skipped).toEqual(expect.arrayContaining(["pickupHandlingNotes", "pickupDescription"]));
    // …while still filling what was genuinely empty.
    expect(apply.pickupPackageCount).toBe("3");
  });

  it("treats a touched proof method as occupied", () => {
    const { apply, skipped } = planPresetApplication(buildPresetSeed(FULL_BODY), {
      ...EMPTY_FORM,
      proofMethodTouched: true,
    });
    expect(apply.proofMethod).toBeUndefined();
    expect(skipped).toContain("proofMethod");
  });

  // A preset must not decide who pays, on an empty form or any other.
  it("never applies payer type, even when nothing is filled in", () => {
    const { apply, skipped, notApplied } = planPresetApplication(
      { payerType: "customer" },
      EMPTY_FORM,
    );
    expect(apply.payerType).toBeUndefined();
    expect(notApplied).toEqual(["payerType"]);
    expect(skipped).toEqual([]);
  });

  /*
   * The distinction is the whole point of the third bucket: a field the
   * merchant genuinely filled reads back as theirs, and one this build never
   * applies reads back as not filled in. Collapsing the two would have the
   * form claim they typed something they never typed.
   */
  it("separates what the merchant entered from what is never applied", () => {
    const { skipped, notApplied } = planPresetApplication(buildPresetSeed(FULL_BODY), {
      ...EMPTY_FORM,
      pickupDescription: "Wedding cake",
    });
    expect(skipped).toEqual(["pickupDescription"]);
    expect(notApplied).toEqual(["payerType"]);
  });

  it("is idempotent — applying the same preset twice changes nothing the second time", () => {
    const seed = buildPresetSeed(FULL_BODY);
    const first = planPresetApplication(seed, EMPTY_FORM);
    const after = {
      pickupDescription: first.apply.pickupDescription ?? "",
      pickupPackageCount: first.apply.pickupPackageCount ?? "",
      pickupHandlingNotes: first.apply.pickupHandlingNotes ?? "",
      proofMethodTouched: first.apply.proofMethod !== undefined,
      pickupDescriptionEditable: EMPTY_FORM.pickupDescriptionEditable,
    };
    expect(planPresetApplication(seed, after).apply).toEqual({});
  });

  it("labels every seed key in merchant language, with no field names", () => {
    for (const label of Object.values(PRESET_FIELD_LABEL)) {
      expect(label).not.toMatch(/pickup[A-Z]|_|payload|schema|body|preset_/);
    }
    expect(Object.keys(PRESET_FIELD_LABEL).sort()).toEqual(
      ["payerType", "pickupDescription", "pickupHandlingNotes", "pickupPackageCount", "proofMethod"],
    );
  });

  /*
   * The merchant form has no description field at all - Smart Intake owns it,
   * one way. Filling `pickupDescription` there would write a value the merchant
   * can neither see nor edit, and Smart Intake would overwrite it as soon as
   * they described the shipment. The existing duplicate-a-delivery seed reached
   * the same conclusion and seeds every other field but this one.
   */
  it("does not fill a description when the form has no field for one", () => {
    const { apply, skipped, notApplied } = planPresetApplication(buildPresetSeed(FULL_BODY), {
      ...EMPTY_FORM,
      pickupDescriptionEditable: false,
    });
    expect(apply.pickupDescription).toBeUndefined();
    expect(notApplied).toContain("pickupDescription");
    // Not "you already entered this" - the merchant entered nothing.
    expect(skipped).not.toContain("pickupDescription");
    // …and the fields that DO have a home are still filled.
    expect(apply.pickupPackageCount).toBe("3");
    expect(apply.pickupHandlingNotes).toBe("Keep upright");
  });
});

/*
 * This table used to be read by nothing but the test below. It documented, in
 * as many words, that the UI would explain an unapplied field — and a merchant
 * whose preset carried vehicle needs was told nothing at all.
 */
describe("describeUnapplied — the reason reaches the merchant", () => {
  it("names a vehicle requirement the form cannot apply, with its reason", () => {
    const out = describeUnapplied([], {
      commonItem: "Roses",
      vehicleCapabilities: ["refrigerated"],
    } as never);
    expect(out).toEqual([
      {
        label: "Vehicle needs",
        reason: UNAPPLIED_PRESET_FIELDS.vehicleCapabilities,
      },
    ]);
  });

  it("says nothing about a field the preset does not carry", () => {
    expect(describeUnapplied([], { commonItem: "Roses" } as never)).toEqual([]);
    // An empty array is not a saved requirement.
    expect(describeUnapplied([], { vehicleCapabilities: [] } as never)).toEqual([]);
  });

  it("reports both kinds together — a refused seed value and a homeless body value", () => {
    const out = describeUnapplied(["payerType"], {
      requiredQuestions: ["Which entrance?"],
    } as never);
    expect(out.map((f) => f.label)).toEqual(["Who pays", "Questions to ask"]);
    expect(out.every((f) => f.reason.length > 0)).toBe(true);
  });

  it("gives every reason in merchant language, with no field names", () => {
    const out = describeUnapplied(["payerType", "pickupDescription"], {
      vehicleCapabilities: ["refrigerated"],
      requiredQuestions: ["Which entrance?"],
    } as never);
    expect(out).toHaveLength(4);
    for (const f of out) {
      expect(`${f.label} ${f.reason}`).not.toMatch(/pickup[A-Z]|payerType|vehicleCapabilities|requiredQuestions|body/);
    }
  });
});

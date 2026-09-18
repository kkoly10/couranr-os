/**
 * Applying a saved preset to the New Delivery form.
 *
 * The rules under test are the ones a merchant would notice being broken: a
 * preset must not overwrite what they already typed, must not decide who pays,
 * and must not reach fields the delivery form has no honest home for.
 */

import { describe, expect, it } from "vitest";
import {
  APPLICABLE_PRESET_FIELDS,
  PRESET_FIELD_LABEL,
  UNAPPLIED_PRESET_FIELDS,
  buildPresetSeed,
  planPresetApplication,
} from "@/lib/couranr/presets/apply";
import { SUGGESTABLE_FIELDS } from "@/lib/couranr/presets/fields";

const EMPTY_FORM = {
  pickupDescription: "",
  pickupPackageCount: "",
  pickupHandlingNotes: "",
  proofMethodTouched: false,
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

  it("drops an unrecognised payer preference instead of coercing it", () => {
    // Coercing to "merchant" would decide who pays on the merchant's behalf.
    expect(buildPresetSeed({ payerPreference: "split" })).toEqual({});
    expect(buildPresetSeed({ payerPreference: "merchant" })).toEqual({ payerType: "merchant" });
  });

  it("passes the proof method through verbatim, withdrawn or not", () => {
    // Deliberately NOT validated here — the form's existing withdrawn-method
    // path owns that. A second validator is the defect this avoids.
    expect(buildPresetSeed({ proofMethod: "leave_at_door" })).toEqual({
      proofMethod: "leave_at_door",
    });
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
});

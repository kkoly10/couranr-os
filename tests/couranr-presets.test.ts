import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  NEVER_ASSERTED_FIELDS,
  PRESET_PURPOSE_COPY,
  SUGGESTABLE_FIELDS,
  isForbiddenPresetKey,
  isSuggestableField,
  removedFieldsMessage,
  stripForbiddenFields,
} from "@/lib/couranr/presets/fields";
import {
  PRESET_STATES,
  PRESET_STATE_DESCRIPTIONS,
  PRESET_STATE_LABELS,
  PRESET_STATE_TONE,
  builderState,
  hasSuggestedUpdate,
  presetState,
  saveIsBlocked,
} from "@/lib/couranr/presets/states";

const ROOT = path.resolve(__dirname, "..");

/**
 * ACP-025 — the rule a preset must never break.
 *
 * Master Package §5: presets MAY suggest seven things and must NOT silently
 * assert seven others. MER-011 repeats the second as its mandatory constraint.
 * This file is the proof that the second list is impossible to store, rather
 * than merely discouraged.
 */

describe("the two lists are the authority's, exactly", () => {
  it("suggests the seven §5 permits, in its order", () => {
    expect([...SUGGESTABLE_FIELDS]).toEqual([
      "commonItem",
      "packageCount",
      "handling",
      "proofMethod",
      "vehicleCapabilities",
      "requiredQuestions",
      "payerPreference",
    ]);
  });

  it("forbids the seven §5 and MER-011 name", () => {
    expect([...NEVER_ASSERTED_FIELDS]).toEqual([
      "exactWeight",
      "exactDimensions",
      "declaredValue",
      "finalVehicle",
      "finalPrice",
      "loadingAvailability",
      "safetyAssertion",
    ]);
  });

  it("the two lists do not overlap", () => {
    for (const f of NEVER_ASSERTED_FIELDS) {
      expect(isSuggestableField(f), `${f} is both suggestable and forbidden`).toBe(false);
    }
  });
});

describe("a forbidden field cannot be stored, under ANY name", () => {
  /**
   * A flat key ban would be useless: the body is jsonb, so a caller can write
   * whatever it likes. `weight_lb`, `weightLb`, `grossWeight` and
   * `approxWeight` are the same assertion wearing different hats.
   */
  it("matches the concept, not the spelling", () => {
    for (const key of [
      "exactWeight",
      "exact_weight",
      "EXACT-WEIGHT",
      "weightLb",
      "weight_lb",
      "grossWeight",
      "approxWeight",
      "dimensions",
      "lengthIn",
      "widthCm",
      "heightMm",
      "declaredValue",
      "itemValue",
      "finalPrice",
      "priceCents",
      "totalCents",
      "costEstimate",
      "amountCents",
      "vehicleId",
      "vehicleType",
      "loadingAvailability",
      "loadingHelp",
      "isSafe",
      "safetyAssertion",
    ]) {
      expect(isForbiddenPresetKey(key), `${key} was allowed`).toBe(true);
    }
  });

  it("but every SUGGESTABLE field survives the same matcher", () => {
    // The fragment list must never grow teeth against the allow-list —
    // `packageCount` in particular sits close to several banned concepts.
    for (const f of SUGGESTABLE_FIELDS) {
      expect(isForbiddenPresetKey(f), `${f} was banned`).toBe(false);
    }
  });

  it("strips a forbidden field and SAYS it did", () => {
    /**
     * Dropping a field silently is indistinguishable, to the person who typed
     * it, from having stored it — which is the precise failure this module
     * exists to prevent. So `removed` is returned and the copy names it.
     */
    const r = stripForbiddenFields({
      commonItem: "Two dozen roses",
      exactWeight: 12,
      weight_lb: 12,
      finalPrice: 2299,
    });
    expect(r.body).toEqual({ commonItem: "Two dozen roses" });
    expect(r.removed.sort()).toEqual(["exactWeight", "finalPrice", "weight_lb"]);
    expect(removedFieldsMessage(r.removed)).toBeTruthy();
    expect(removedFieldsMessage(r.removed)).not.toMatch(/invalid|error/i);
  });

  it("says nothing when nothing was removed", () => {
    expect(removedFieldsMessage([])).toBeNull();
  });

  it("keeps every suggestable field with a real value", () => {
    const r = stripForbiddenFields({
      commonItem: "  Bouquet  ",
      packageCount: 2,
      handling: "Keep upright",
      proofMethod: "photo_or_pin",
      vehicleCapabilities: ["tall load", " ", "flat floor"],
      requiredQuestions: ["Which door?"],
      payerPreference: "merchant",
    });
    expect(r.removed).toEqual([]);
    expect(r.body).toEqual({
      commonItem: "Bouquet",
      packageCount: 2,
      handling: "Keep upright",
      proofMethod: "photo_or_pin",
      vehicleCapabilities: ["tall load", "flat floor"],
      requiredQuestions: ["Which door?"],
      payerPreference: "merchant",
    });
  });

  it("drops an unknown key without making the preset unsaveable", () => {
    // A field from a newer build, or a stray form input, must not block a save.
    const r = stripForbiddenFields({ commonItem: "Roses", somethingNew: "x" });
    expect(r.body).toEqual({ commonItem: "Roses" });
    expect(r.removed).toEqual([]);
  });

  it("refuses a package count that is not a sane count", () => {
    // A typo here would ride into every delivery made from the preset.
    for (const bad of [0, -1, 1.5, 100, null, NaN, Infinity, "", "abc", "2.5"]) {
      const r = stripForbiddenFields({ packageCount: bad });
      expect(r.body.packageCount, String(bad)).toBeUndefined();
    }
    expect(stripForbiddenFields({ packageCount: 1 }).body.packageCount).toBe(1);
    expect(stripForbiddenFields({ packageCount: 99 }).body.packageCount).toBe(99);
  });

  it("accepts a DIGIT STRING, because form inputs are strings", () => {
    expect(stripForbiddenFields({ packageCount: "2" }).body.packageCount).toBe(2);
    expect(stripForbiddenFields({ packageCount: " 3 " }).body.packageCount).toBe(3);
  });

  it("does NOT coerce a boolean into one package", () => {
    /**
     * `Number(true)` is 1, so a bare `Number(value)` would silently turn a
     * boolean into "one package" — a count invented from a value that was
     * never a count. Found by a test expectation that was itself wrong about
     * strings, which is the useful kind of wrong.
     */
    expect(stripForbiddenFields({ packageCount: true }).body.packageCount).toBeUndefined();
    expect(stripForbiddenFields({ packageCount: [1] }).body.packageCount).toBeUndefined();
    expect(stripForbiddenFields({ packageCount: {} }).body.packageCount).toBeUndefined();
  });

  it("survives a non-object without throwing", () => {
    for (const v of [null, undefined, 1, "x", [], true]) {
      const r = stripForbiddenFields(v);
      expect(r.body).toEqual({});
      expect(r.removed).toEqual([]);
    }
  });
});

describe("the merchant is told what a preset is NOT", () => {
  it("the copy says it never fixes weight, size, price or vehicle", () => {
    expect(PRESET_PURPOSE_COPY).toMatch(/never fixes/i);
    for (const word of ["weight", "size", "price", "vehicle"]) {
      expect(PRESET_PURPOSE_COPY.toLowerCase()).toContain(word);
    }
  });

  it("the module records its authority and why it is stricter than required", () => {
    const src = readFileSync(path.join(ROOT, "lib/couranr/presets/fields.ts"), "utf8")
      .replace(/^\s*\*\s?/gm, " ")
      .replace(/\s+/g, " ")
      .toLowerCase();
    expect(src).toContain("no decision about presets");
    expect(src).toContain("must not silently assert");
    // The deliberate over-strictness is a decision someone may want to revisit;
    // it must stay explained rather than become folklore.
    expect(src).toContain("stricter than the sentence requires");
  });
});

describe("MER-010 — the five list states are DERIVED, never stored", () => {
  /**
   * A stored flag drifts from the rows it describes. "Update suggested"
   * drifting means a merchant is either nagged about an update that does not
   * exist, or never told about one that does.
   */
  it("declares exactly the five the registry requires", () => {
    expect([...PRESET_STATES]).toEqual([
      "couranr_global",
      "customized",
      "update_suggested",
      "merchant_created",
      "archived",
    ]);
  });

  it("a Couranr global preset is a suggestion", () => {
    expect(presetState({ isGlobal: true })).toBe("couranr_global");
  });

  it("no source means merchant-created", () => {
    expect(presetState({ sourcePresetId: null })).toBe("merchant_created");
  });

  it("a source at the current version is customized, not stale", () => {
    expect(
      presetState({ sourcePresetId: "g", sourceVersion: 2, currentSourceVersion: 2 })
    ).toBe("customized");
  });

  it("a source the global has moved PAST suggests an update", () => {
    expect(
      presetState({ sourcePresetId: "g", sourceVersion: 1, currentSourceVersion: 3 })
    ).toBe("update_suggested");
    expect(
      hasSuggestedUpdate({ sourcePresetId: "g", sourceVersion: 1, currentSourceVersion: 3 })
    ).toBe(true);
  });

  it("an UNKNOWN current version is not an update — a failed lookup must not nag", () => {
    for (const now of [null, undefined, NaN as any]) {
      expect(
        presetState({ sourcePresetId: "g", sourceVersion: 1, currentSourceVersion: now }),
        String(now)
      ).toBe("customized");
    }
  });

  it("ARCHIVED outranks everything, including a pending update", () => {
    // Telling a merchant to review an update to something they retired is
    // noise about a thing they already decided.
    expect(
      presetState({
        archivedAt: "2026-08-06T00:00:00Z",
        sourcePresetId: "g",
        sourceVersion: 1,
        currentSourceVersion: 9,
        isGlobal: true,
      })
    ).toBe("archived");
  });

  it("every state has a label, a tone and a sentence", () => {
    for (const s of PRESET_STATES) {
      expect(PRESET_STATE_LABELS[s], s).toBeTruthy();
      expect(PRESET_STATE_TONE[s], s).toBeTruthy();
      expect(PRESET_STATE_DESCRIPTIONS[s], s).toBeTruthy();
    }
  });

  it("the update-suggested copy says NOTHING WAS CHANGED on its own", () => {
    // The no-overwrite rule is invisible to a merchant unless someone tells
    // them it held.
    expect(PRESET_STATE_DESCRIPTIONS.update_suggested).toMatch(/nothing of yours was changed/i);
    expect(PRESET_STATE_DESCRIPTIONS.update_suggested).toMatch(/only if you want it/i);
  });

  it("archiving is explained as not-offered, never as deleted", () => {
    expect(PRESET_STATE_DESCRIPTIONS.archived).toMatch(/deliveries that used it are unaffected/i);
    expect(PRESET_STATE_DESCRIPTIONS.archived).not.toMatch(/delete|remove/i);
  });
});

describe("MER-011 — the builder's states", () => {
  const base = {
    storedVersion: 2,
    loadedVersion: 2,
    dirty: false,
    recommendationAvailable: false,
  };

  it("nothing stored yet is new", () => {
    expect(builderState({ ...base, storedVersion: null })).toBe("new");
  });

  it("a VERSION CONFLICT outranks everything else", () => {
    /**
     * A merchant editing a preset someone else already saved must be told
     * before anything else: their next save would overwrite a colleague's
     * work with a body built from a version that no longer exists.
     */
    const conflicted = {
      storedVersion: 5,
      loadedVersion: 2,
      dirty: true,
      recommendationAvailable: true,
    };
    expect(builderState(conflicted)).toBe("version_conflict");
    expect(saveIsBlocked(conflicted)).toBe(true);
  });

  it("a recommendation outranks `edited`", () => {
    // Information a merchant may want BEFORE they finish; a nag afterwards is
    // a nag about work they have already redone.
    expect(builderState({ ...base, dirty: true, recommendationAvailable: true })).toBe(
      "recommendation_available"
    );
  });

  it("a changed form is edited", () => {
    expect(builderState({ ...base, dirty: true })).toBe("edited");
  });

  it("a saved, current, UNCHANGED form is NO state at all", () => {
    /**
     * Not "edited". A state machine that reports the nearest state rather
     * than no state is how a screen shows "unsaved changes" to someone who
     * changed nothing — and once that happens the badge means nothing on the
     * occasions it is true.
     */
    expect(builderState(base)).toBeNull();
    expect(saveIsBlocked(base)).toBe(false);
  });

  it("saving is blocked ONLY by a conflict", () => {
    expect(saveIsBlocked({ ...base, storedVersion: null })).toBe(false);
    expect(saveIsBlocked({ ...base, dirty: true })).toBe(false);
    expect(saveIsBlocked({ ...base, recommendationAvailable: true })).toBe(false);
  });
});

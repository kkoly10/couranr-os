/**
 * ACP-025 — what a delivery preset may and may not say.
 *
 * ---------------------------------------------------------------------------
 * AUTHORITY
 * ---------------------------------------------------------------------------
 *
 * `02_DECISION_REGISTRY.json` has NO decision about presets — all 43 records
 * scanned. The authority is rank 2, Master Package §5, and it is unusually
 * precise. Two sentences govern this entire module:
 *
 *   "Presets may suggest common item, package count, handling, proof, vehicle
 *    capabilities, required questions, and payer preference."
 *
 *   "They must not silently assert exact weight, dimensions, value, final
 *    vehicle, final price, loading availability, or safety."
 *
 * `UI_SCREEN_REGISTRY.md` repeats the second as MER-011's mandatory
 * constraint: "Never silently assert exact weight, dimensions, value, final
 * vehicle, price, loading, or safety."
 *
 * ---------------------------------------------------------------------------
 * HOW THAT IS ENFORCED HERE: STRUCTURALLY, NOT BY DISCIPLINE
 * ---------------------------------------------------------------------------
 *
 * A preset in this build CANNOT HOLD a forbidden field. Not "holds it and
 * marks it unconfirmed" — cannot hold it. The seven suggestable fields are the
 * whole shape, `stripForbiddenFields` removes anything else before a write,
 * and the migration stores the body as a jsonb with a CHECK that refuses the
 * forbidden keys.
 *
 * That is deliberately stricter than the sentence requires. "Must not SILENTLY
 * assert" could be read as permitting a stored weight flagged for
 * confirmation, and a future decision may well want exactly that. But nothing
 * in the authority defines what such a flag would mean, who confirms it, or
 * what happens when they do not — so building it would be inventing product,
 * and the failure mode of guessing wrong is a merchant shipping a delivery
 * priced on a weight nobody checked. Refusing to store the field is the
 * version of this that cannot be wrong; widening it later is a decision with
 * a migration, not a bug fix.
 *
 * Pure and dependency-free so every rule above is testable without a database.
 */

/**
 * The seven a preset MAY suggest. Master Package §5, in its order.
 *
 * "Suggest" is the operative word: every one of these prefills a field on the
 * delivery form that the merchant can still change. None of them decides
 * anything.
 */
export const SUGGESTABLE_FIELDS = [
  /** "Two dozen roses in a box" — free text, never a quantity of anything. */
  "commonItem",
  /** How many parcels usually go out. A count, not a weight. */
  "packageCount",
  /** "Keep upright", "fragile" — instructions for a person. */
  "handling",
  /** Which proof this merchant usually needs: photo, PIN, signature. */
  "proofMethod",
  /** "Needs a vehicle that can take a long box" — a capability, not a vehicle. */
  "vehicleCapabilities",
  /** Things staff should be asked when creating one of these. */
  "requiredQuestions",
  /** Whether this kind of delivery is usually merchant-paid or customer-paid. */
  "payerPreference",
] as const;
export type SuggestableField = (typeof SUGGESTABLE_FIELDS)[number];

/**
 * The seven a preset must NEVER silently assert.
 *
 * Each is here because getting it wrong costs a merchant or a driver
 * something real, and a preset is by definition a guess made in advance:
 *
 *   exactWeight / exactDimensions  price and vehicle class both key off these
 *   declaredValue                  drives liability, not convenience
 *   finalVehicle                   ASN-001 puts vehicle selection with
 *                                  Couranr Operations, not with a merchant's
 *                                  saved template
 *   finalPrice                     PRC-001 and friends are computed
 *                                  server-side per delivery; a stored price
 *                                  would be a second pricing engine
 *   loadingAvailability            "someone will help you load" is a promise
 *                                  about a person who may not be there
 *   safetyAssertion                a template cannot certify a shipment is safe
 */
export const NEVER_ASSERTED_FIELDS = [
  "exactWeight",
  "exactDimensions",
  "declaredValue",
  "finalVehicle",
  "finalPrice",
  "loadingAvailability",
  "safetyAssertion",
] as const;
export type NeverAssertedField = (typeof NEVER_ASSERTED_FIELDS)[number];

/**
 * Key fragments that mean a forbidden field under another name.
 *
 * A flat key ban is not enough: `weight_lb`, `weightLb`, `grossWeight` and
 * `approxWeight` are all the same assertion wearing a different hat, and the
 * body is jsonb so anything can be written into it. Matching on the CONCEPT
 * is what makes the rule hold against a caller who did not read this file.
 *
 * `packageCount` is explicitly permitted and contains none of these; the test
 * asserts every suggestable field survives, so this list cannot quietly grow
 * teeth against the allow-list.
 */
const FORBIDDEN_KEY_FRAGMENTS = [
  "weight",
  "dimension",
  "length",
  "width",
  "height",
  "value",
  "price",
  "cost",
  "amount",
  "cents",
  "vehicleid",
  "vehicletype",
  "loading",
  "safe",
] as const;

export function isSuggestableField(v: unknown): v is SuggestableField {
  return typeof v === "string" && (SUGGESTABLE_FIELDS as readonly string[]).includes(v);
}

/**
 * Is this key one a preset may not carry?
 *
 * Compared case- and separator-insensitively, so `exact_weight`, `exactWeight`
 * and `EXACT-WEIGHT` are one key.
 */
export function isForbiddenPresetKey(key: string): boolean {
  const flat = String(key).toLowerCase().replace(/[^a-z]/g, "");
  if ((SUGGESTABLE_FIELDS as readonly string[]).some((f) => f.toLowerCase() === flat)) {
    return false;
  }
  return FORBIDDEN_KEY_FRAGMENTS.some((frag) => flat.includes(frag));
}

/** What a preset body may contain, after stripping. */
export type PresetBody = Partial<{
  commonItem: string;
  packageCount: number;
  handling: string;
  proofMethod: string;
  vehicleCapabilities: string[];
  requiredQuestions: string[];
  payerPreference: string;
}>;

export type StripOutcome = {
  /** The body as it may be stored. */
  body: PresetBody;
  /**
   * Keys that were REMOVED, so the caller can tell the merchant rather than
   * silently discarding what they typed. Silence is the failure mode this
   * whole module exists to prevent — dropping a field without saying so is
   * indistinguishable, to the person who typed it, from having stored it.
   */
  removed: string[];
};

/**
 * Reduce an arbitrary object to a storable preset body.
 *
 * Unknown keys are dropped rather than refused: a preset written by a newer
 * build, or a stray field from a form, should not make an otherwise valid
 * preset unsaveable. FORBIDDEN keys are also dropped — but they are RETURNED
 * in `removed`, because a merchant who typed a weight has to be told it was
 * not kept.
 */
export function stripForbiddenFields(input: unknown): StripOutcome {
  const removed: string[] = [];
  const body: PresetBody = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { body, removed };
  }

  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (isForbiddenPresetKey(key)) {
      removed.push(key);
      continue;
    }
    if (!isSuggestableField(key)) continue;

    switch (key) {
      case "packageCount": {
        /*
         * A number, or a string of digits — form inputs arrive as strings, and
         * refusing "2" would make the field unusable from the very screen that
         * sets it.
         *
         * NOTHING ELSE is coerced. `Number(true)` is 1, so a bare `Number()`
         * would turn a boolean into "one package" — a silent coercion of a
         * value that was never a count. `null`, `[]` and `""` all coerce to 0
         * and would be caught by the range check; `true` would not have been.
         */
        const numeric =
          typeof value === "number"
            ? value
            : typeof value === "string" && /^\d+$/.test(value.trim())
              ? Number(value.trim())
              : NaN;
        // A sane count. A preset suggesting 10,000 parcels is a typo that
        // would otherwise ride into every delivery made from it.
        if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 99) {
          body.packageCount = numeric;
        }
        break;
      }
      case "vehicleCapabilities":
      case "requiredQuestions": {
        if (Array.isArray(value)) {
          const items = value
            .filter((v): v is string => typeof v === "string")
            .map((v) => v.trim())
            .filter(Boolean)
            .slice(0, 10);
          if (items.length > 0) body[key] = items;
        }
        break;
      }
      default: {
        if (typeof value === "string" && value.trim()) {
          (body as Record<string, unknown>)[key] = value.trim();
        }
      }
    }
  }

  return { body, removed };
}

/**
 * The sentence a merchant reads when a field was dropped.
 *
 * Names what was removed and why, in their words. It never says "invalid" —
 * the merchant did nothing wrong, Couranr simply does not let a saved template
 * decide these.
 */
export function removedFieldsMessage(removed: readonly string[]): string | null {
  if (removed.length === 0) return null;
  return (
    "A preset cannot fix the weight, size, value, price, vehicle or handling " +
    "help for a delivery — those are confirmed on each one. The rest of your " +
    "preset was saved."
  );
}

/**
 * What this screen tells a merchant a preset IS.
 *
 * Asserted by test on the preset screens, for the same reason the category
 * copy is: a merchant who believes a preset fixes the price will be surprised
 * exactly once, expensively.
 */
export const PRESET_PURPOSE_COPY =
  "A preset fills in what you usually send so you do not retype it. It never fixes the weight, size, price or vehicle — Couranr confirms those on every delivery.";

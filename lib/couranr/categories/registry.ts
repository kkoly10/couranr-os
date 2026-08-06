/**
 * ACP-024 — the business category registry.
 *
 * ---------------------------------------------------------------------------
 * AUTHORITY
 * ---------------------------------------------------------------------------
 *
 * `02_DECISION_REGISTRY.json` has NO decision about categories — verified by
 * scanning all 43 records. The authority is rank 2, the Master Package §5:
 *
 *   - "Merchant selects one primary category and up to three secondary
 *     categories." (also restated in the acceptance list: "One primary + three
 *     secondary categories.")
 *   - An "Initial registry" of eleven categories, ending in a general
 *     fallback.
 *   - And the sentence that governs everything this module is allowed to do:
 *     **"Category controls initial recommendations, not eligibility."**
 *
 * ---------------------------------------------------------------------------
 * THE INVARIANT: RECOMMENDATION, NEVER ELIGIBILITY
 * ---------------------------------------------------------------------------
 *
 * A category may CHANGE WHAT IS SUGGESTED to a merchant. It may never change
 * what a merchant is ALLOWED to do — not what they can send, not what it
 * costs, not whether Couranr will carry it. A florist and a furniture shop see
 * different suggestions and have identical rights.
 *
 * This is not a style note. The moment a category gates a capability, a
 * merchant who picked the wrong one at onboarding is silently locked out of
 * something with no error message that mentions categories, and the fix is
 * invisible to them. So this module exports NO predicate of the form "may this
 * category do X", and `tests/couranr-categories.test.ts` asserts that the
 * pricing and request modules never read a category at all.
 *
 * The eleven values are the SAME eleven the database already constrains — see
 * `couranr_mw_category_chk` in `20260731061356_couranr_merchant_workspace.sql`.
 * A test reads that constraint out of the migration and compares, so the two
 * cannot drift into a category the database will reject.
 */

export const BUSINESS_CATEGORIES = [
  "dry_cleaning_laundry_tailoring",
  "printing_signage_promotional",
  "boutique_clothing_shoes_accessories",
  "florists_gifts_specialty_retail",
  "repair_and_electronics",
  "auto_parts_and_accessories",
  "furniture_and_home_goods",
  "event_rentals_and_supplies",
  "bakeries_prepared_food_catering",
  "books_cards_collectibles_hobby",
  "general_local_business",
] as const;
export type BusinessCategory = (typeof BUSINESS_CATEGORIES)[number];

/**
 * The fallback. Master Package §5 lists "General local business" as the last
 * entry of the initial registry and the acceptance list names "General
 * business" explicitly, so a merchant who does not see themselves in the list
 * has somewhere to go that is a real category rather than a blank.
 */
export const GENERAL_CATEGORY: BusinessCategory = "general_local_business";

export const CATEGORY_LABELS: Readonly<Record<BusinessCategory, string>> = {
  dry_cleaning_laundry_tailoring: "Dry cleaning, laundry, tailoring",
  printing_signage_promotional: "Printing, signage, promotional products",
  boutique_clothing_shoes_accessories: "Boutique, clothing, shoes, accessories",
  florists_gifts_specialty_retail: "Florists, gifts, specialty retail",
  repair_and_electronics: "Repair and electronics",
  auto_parts_and_accessories: "Auto parts and accessories",
  furniture_and_home_goods: "Furniture and home goods",
  event_rentals_and_supplies: "Event rentals and supplies",
  bakeries_prepared_food_catering: "Bakeries, prepared food, catering",
  books_cards_collectibles_hobby: "Books, cards, collectibles, hobby",
  general_local_business: "General local business",
};

/**
 * The version of this registry.
 *
 * ACP-024 asks for "versioning". A merchant's stored categories are stamped
 * with the version they chose under, so a later edition that renames or
 * retires a category can be told apart from a merchant's own change. It is a
 * date string rather than an integer so it reads as a decision with a date
 * behind it.
 */
export const CATEGORY_REGISTRY_VERSION = "couranr-categories-2026-08";

/** How many secondary categories a merchant may hold. Master Package §5. */
export const MAX_SECONDARY_CATEGORIES = 3;

export function isBusinessCategory(value: unknown): value is BusinessCategory {
  return (
    typeof value === "string" && (BUSINESS_CATEGORIES as readonly string[]).includes(value)
  );
}

export type CategorySelection = {
  primary: string;
  secondary: readonly string[];
};

export type CategoryValidation =
  | { ok: true; value: { primary: BusinessCategory; secondary: BusinessCategory[] } }
  | { ok: false; reason: string };

/**
 * `tsconfig` sets `"strict": false`, so a bare `!r.ok` does NOT narrow a
 * discriminated union. Callers use this.
 */
export function isCategoryValidationFailed(
  r: CategoryValidation
): r is { ok: false; reason: string } {
  return r.ok === false;
}

/**
 * Validate a selection.
 *
 * Every rule here is a Master Package rule, and every failure is worded for a
 * merchant — this is the text a person reads when their choice is refused, so
 * "invalid input" is not an acceptable answer.
 *
 * Duplicates are STRIPPED rather than refused: a merchant who ticks the same
 * secondary twice meant to tick it once, and refusing that is pedantry. A
 * secondary equal to the primary IS refused, because it means the merchant
 * thinks they have selected two things and they have not.
 */
export function validateCategorySelection(input: CategorySelection): CategoryValidation {
  if (!isBusinessCategory(input.primary)) {
    return { ok: false, reason: "Choose a primary category for your business." };
  }

  const secondary: BusinessCategory[] = [];
  for (const raw of input.secondary ?? []) {
    if (!isBusinessCategory(raw)) {
      return { ok: false, reason: "One of the categories you chose is not one Couranr offers." };
    }
    if (raw === input.primary) {
      return {
        ok: false,
        reason: "A category cannot be both your primary and a secondary one.",
      };
    }
    if (!secondary.includes(raw)) secondary.push(raw);
  }

  if (secondary.length > MAX_SECONDARY_CATEGORIES) {
    return {
      ok: false,
      reason: `Choose up to ${MAX_SECONDARY_CATEGORIES} secondary categories.`,
    };
  }

  return { ok: true, value: { primary: input.primary, secondary } };
}

/**
 * What a merchant is told a category DOES.
 *
 * Rendered on every screen that asks for one. It exists so no merchant ever
 * believes their category limits them — the sentence is the Master Package's
 * own, and a test asserts the category screens carry it.
 */
export const CATEGORY_PURPOSE_COPY =
  "Your category shapes what Couranr suggests when you create a delivery. It never limits what you can send or what it costs.";

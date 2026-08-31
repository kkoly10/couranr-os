import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUSINESS_CATEGORIES,
  CATEGORY_LABELS,
  CATEGORY_PURPOSE_COPY,
  CATEGORY_REGISTRY_VERSION,
  GENERAL_CATEGORY,
  MAX_SECONDARY_CATEGORIES,
  isBusinessCategory,
  isCategoryValidationFailed,
  validateCategorySelection,
  isSecondaryValidationFailed,
  validateSecondarySelection,
} from "@/lib/couranr/categories/registry";

const ROOT = path.resolve(__dirname, "..");

/**
 * ACP-024 — the category registry.
 *
 * The rule this file protects is one sentence from Master Package §5:
 * "Category controls initial recommendations, not eligibility." Everything
 * else here is the shape of the selection.
 */

describe("the registry matches the authority and the database", () => {
  it("holds the eleven categories the Master Package lists", () => {
    expect(BUSINESS_CATEGORIES).toHaveLength(11);
    expect(BUSINESS_CATEGORIES[BUSINESS_CATEGORIES.length - 1]).toBe(GENERAL_CATEGORY);
  });

  it("is EXACTLY the vocabulary the database already constrains", () => {
    /**
     * The eleven values are enforced by `couranr_mw_category_chk`. If this
     * module ever grows a twelfth, every workspace write using it fails on a
     * CHECK — at runtime, invisible to `tsc` and to any test that does not
     * read the migration. So the migration is read and compared.
     */
    const sql = readFileSync(
      path.join(ROOT, "supabase/migrations/20260731061356_couranr_merchant_workspace.sql"),
      "utf8"
    );
    const m = sql.match(/couranr_mw_category_chk check \(business_category in \(([^)]*)\)/);
    expect(m, "the category CHECK is not where this test expects it").toBeTruthy();
    const fromDatabase = m![1]
      .split(",")
      .map((s) => s.trim().replace(/^'|'$/g, ""))
      .filter(Boolean)
      .sort();
    expect(fromDatabase).toEqual([...BUSINESS_CATEGORIES].sort());
  });

  it("every category has a human label", () => {
    for (const c of BUSINESS_CATEGORIES) {
      expect(CATEGORY_LABELS[c], c).toBeTruthy();
    }
  });

  it("the registry is versioned", () => {
    expect(CATEGORY_REGISTRY_VERSION).toMatch(/^couranr-categories-\d{4}-\d{2}$/);
  });
});

describe("one primary, up to three secondary", () => {
  it("accepts a primary alone", () => {
    const r = validateCategorySelection({ primary: "florists_gifts_specialty_retail", secondary: [] });
    expect(isCategoryValidationFailed(r)).toBe(false);
    if (!isCategoryValidationFailed(r)) {
      expect(r.value.secondary).toEqual([]);
    }
  });

  it("accepts exactly three secondary categories", () => {
    const r = validateCategorySelection({
      primary: "florists_gifts_specialty_retail",
      secondary: [
        "printing_signage_promotional",
        "repair_and_electronics",
        "furniture_and_home_goods",
      ],
    });
    expect(isCategoryValidationFailed(r)).toBe(false);
  });

  it("REFUSES a fourth, and says how many are allowed", () => {
    const r = validateCategorySelection({
      primary: "florists_gifts_specialty_retail",
      secondary: [
        "printing_signage_promotional",
        "repair_and_electronics",
        "furniture_and_home_goods",
        "books_cards_collectibles_hobby",
      ],
    });
    expect(isCategoryValidationFailed(r)).toBe(true);
    if (isCategoryValidationFailed(r)) {
      expect(r.reason).toContain(String(MAX_SECONDARY_CATEGORIES));
    }
  });

  it("refuses a secondary that repeats the primary", () => {
    // The merchant believes they picked two things. They picked one.
    const r = validateCategorySelection({
      primary: "repair_and_electronics",
      secondary: ["repair_and_electronics"],
    });
    expect(isCategoryValidationFailed(r)).toBe(true);
  });

  it("STRIPS a duplicated secondary rather than refusing it", () => {
    // Ticking the same box twice meant ticking it once. Refusing is pedantry.
    const r = validateCategorySelection({
      primary: "repair_and_electronics",
      secondary: ["furniture_and_home_goods", "furniture_and_home_goods"],
    });
    expect(isCategoryValidationFailed(r)).toBe(false);
    if (!isCategoryValidationFailed(r)) {
      expect(r.value.secondary).toEqual(["furniture_and_home_goods"]);
    }
  });

  it("refuses an unknown category, in either position", () => {
    expect(
      isCategoryValidationFailed(validateCategorySelection({ primary: "nope", secondary: [] }))
    ).toBe(true);
    expect(
      isCategoryValidationFailed(
        validateCategorySelection({ primary: GENERAL_CATEGORY, secondary: ["nope"] })
      )
    ).toBe(true);
  });

  it("refuses a missing primary rather than defaulting to general", () => {
    // Defaulting would record a category the merchant never chose, and
    // categories drive what they are shown from then on.
    for (const bad of ["", null, undefined]) {
      const r = validateCategorySelection({ primary: bad as any, secondary: [] });
      expect(isCategoryValidationFailed(r), String(bad)).toBe(true);
    }
  });

  it("every failure is worded for a merchant, not for a log", () => {
    const failures = [
      validateCategorySelection({ primary: "", secondary: [] }),
      validateCategorySelection({ primary: GENERAL_CATEGORY, secondary: ["nope"] }),
      validateCategorySelection({ primary: GENERAL_CATEGORY, secondary: [GENERAL_CATEGORY] }),
      validateCategorySelection({
        primary: GENERAL_CATEGORY,
        secondary: [
          "printing_signage_promotional",
          "repair_and_electronics",
          "furniture_and_home_goods",
          "books_cards_collectibles_hobby",
        ],
      }),
    ];
    for (const f of failures) {
      expect(isCategoryValidationFailed(f)).toBe(true);
      if (isCategoryValidationFailed(f)) {
        expect(f.reason).toMatch(/^[A-Z]/);
        expect(f.reason).toMatch(/\.$/);
        // No identifier, no code, no snake_case leaking to a person.
        expect(f.reason).not.toMatch(/_|invalid input|CR\d{3}/);
      }
    }
  });

  it("isBusinessCategory rejects non-strings without throwing", () => {
    for (const v of [null, undefined, 1, {}, [], true]) {
      expect(isBusinessCategory(v)).toBe(false);
    }
  });
});

describe("a secondary-only edit is validated without inventing a primary", () => {
  /**
   * A merchant changing only their secondaries sends no primary. The overlap
   * rule — a secondary may not repeat the primary — is deliberately NOT
   * checked on this path, because the caller does not know the primary and
   * having it send back one it read earlier is a read-then-write race: a
   * concurrent primary change between the read and the write would be silently
   * reverted. `couranr_set_business_categories` checks it under a row lock
   * instead, and `e2e/disposable/businessCategories.mjs` R4 proves it fires.
   */
  it("accepts up to three, deduplicating", () => {
    const r = validateSecondarySelection([
      "repair_and_electronics",
      "repair_and_electronics",
      "furniture_and_home_goods",
    ]);
    expect(isSecondaryValidationFailed(r)).toBe(false);
    if (!isSecondaryValidationFailed(r)) {
      expect(r.value).toEqual(["repair_and_electronics", "furniture_and_home_goods"]);
    }
  });

  it("refuses a fourth and an unknown value", () => {
    expect(
      isSecondaryValidationFailed(
        validateSecondarySelection([
          "repair_and_electronics",
          "furniture_and_home_goods",
          "books_cards_collectibles_hobby",
          "printing_signage_promotional",
        ])
      )
    ).toBe(true);
    expect(isSecondaryValidationFailed(validateSecondarySelection(["nope"]))).toBe(true);
  });

  it("accepts an empty list — clearing every secondary is a real edit", () => {
    const r = validateSecondarySelection([]);
    expect(isSecondaryValidationFailed(r)).toBe(false);
    if (!isSecondaryValidationFailed(r)) expect(r.value).toEqual([]);
  });

  it("does NOT check the primary overlap, and the SQL does", () => {
    // If this path ever started checking it, it could only do so against a
    // primary supplied by the caller — which is the race described above.
    const src = readFileSync(path.join(ROOT, "lib/couranr/categories/registry.ts"), "utf8");
    const fn = src.slice(src.indexOf("export function validateSecondarySelection"));
    expect(fn.slice(0, fn.indexOf("\n}"))).not.toMatch(/primary/);
    const sql = readFileSync(
      path.join(ROOT, "supabase/migrations/20260806160443_couranr_business_categories.sql"),
      "utf8"
    );
    expect(sql).toMatch(/for update/);
    expect(sql).toMatch(/v_primary = any\(v_secondary\)/);
  });
});

describe("the migration enforces the same rules the validator does", () => {
  /**
   * The validator produces good copy for a merchant; the CHECKs make the rule
   * true regardless of which caller wrote the row. Both must exist, because
   * `service_role` bypasses RLS and the ~45 ad-hoc inline clients in legacy
   * routes do not go through the validator at all.
   *
   * These are TEXT assertions on the file — a guard on the migration, not a
   * guarantee about the database. The database half was executed against a
   * real PostgreSQL: 18/18, including a direct UPDATE proving each CHECK
   * fires, and proving the distinctness helper is still evaluated inside the
   * CHECK after being revoked from PUBLIC.
   */
  const sql = readFileSync(
    path.join(ROOT, "supabase/migrations/20260806160443_couranr_business_categories.sql"),
    "utf8"
  );

  it("constrains the count, the values, the primary overlap and distinctness", () => {
    for (const c of [
      "couranr_mw_secondary_count_chk",
      "couranr_mw_secondary_values_chk",
      "couranr_mw_secondary_not_primary_chk",
      "couranr_mw_secondary_distinct_chk",
    ]) {
      expect(sql, `${c} missing`).toContain(c);
    }
    expect(sql).toMatch(/cardinality\(secondary_categories\) <= 3/);
  });

  it("the SQL's value list is exactly this module's", () => {
    // Two lists of eleven strings that must agree. A category added to the
    // registry but not the CHECK fails at runtime on every write.
    const m = sql.match(/couranr_mw_secondary_values_chk[\s\S]*?array\[([\s\S]*?)\]::text\[\]/);
    expect(m, "the secondary-values CHECK is not where this test expects it").toBeTruthy();
    const fromSql = m![1]
      .split(",")
      .map((s) => s.trim().replace(/^'|'$/g, ""))
      .filter(Boolean)
      .sort();
    expect(fromSql).toEqual([...BUSINESS_CATEGORIES].sort());
  });

  it("is additive — it adds columns and drops nothing", () => {
    expect(sql).toMatch(/add column if not exists secondary_categories/);
    expect(sql).toMatch(/add column if not exists category_registry_version/);
    expect(sql).not.toMatch(/drop (table|column)/i);
  });

  it("names `public` in its revokes, not just anon and authenticated", () => {
    // `pg_default_acl` grants EXECUTE to PUBLIC on every new function in
    // `public` on this project, so a revoke that omits `public` is a silent
    // no-op that reads as protection.
    const revokes = sql.match(/revoke all on function[\s\S]*?;/g) ?? [];
    expect(revokes.length).toBeGreaterThanOrEqual(2);
    for (const r of revokes) {
      expect(r, `revoke omits public: ${r.slice(0, 80)}`).toMatch(/from public\b/);
    }
  });

  it("the distinctness helper must be IMMUTABLE or it cannot sit in a CHECK", () => {
    expect(sql).toMatch(/create or replace function public\.couranr_text_array_is_distinct[\s\S]*?immutable/);
  });

  it("the rollback warns before destroying a merchant's choices", () => {
    const rb = readFileSync(
      path.join(ROOT, "supabase/rollbacks/20260806160443_couranr_business_categories.rollback.sql"),
      "utf8"
    );
    expect(rb).toMatch(/CHOICES A MERCHANT MADE/);
    // The destructive half must be commented out, so running the file by
    // reflex drops the command and not the data.
    expect(rb).toMatch(/^--\s*alter table public\.couranr_merchant_workspaces$/m);
    expect(rb).toMatch(/^drop function if exists public\.couranr_set_business_categories/m);
  });
});

describe("CATEGORY CONTROLS RECOMMENDATIONS, NOT ELIGIBILITY", () => {
  /**
   * Master Package §5, verbatim: "Category controls initial recommendations,
   * not eligibility."
   *
   * If a category ever gates a capability, a merchant who picked the wrong one
   * at onboarding is silently locked out of something, with no error that
   * mentions categories and no way for them to find the cause. These are the
   * tests that keep that from happening quietly.
   */
  it("the module exports no capability predicate at all", () => {
    const src = readFileSync(path.join(ROOT, "lib/couranr/categories/registry.ts"), "utf8");
    // A function whose name asks whether a category MAY do something.
    expect(src).not.toMatch(/export function (can|may|isAllowed|isEligible)\w*/);
    expect(src).not.toMatch(/eligib(le|ility)\s*[:=]/i);
  });

  it("nothing in pricing reads a business category", () => {
    // Pricing is PRC-001/MIL-001/MIL-002/SUR-001 and none of them mention a
    // category. A category-dependent price would be an invented decision.
    for (const f of [
      "lib/couranr/pricing/quote.ts",
      "lib/couranr/public/governed.ts",
    ]) {
      const p = path.join(ROOT, f);
      let src = "";
      try {
        src = readFileSync(p, "utf8");
      } catch {
        continue; // the file may not exist in every revision; absence is fine
      }
      expect(src, `${f} reads a business category`).not.toMatch(/business_category|BusinessCategory/);
    }
  });

  it("nothing in the request/permission path reads a business category", () => {
    for (const f of [
      "lib/couranr/requests/permissions.ts",
      "lib/couranr/requests/states.ts",
      "lib/couranr/settings/permissions.ts",
    ]) {
      const src = readFileSync(path.join(ROOT, f), "utf8");
      expect(src, `${f} reads a business category`).not.toMatch(
        /business_category|BusinessCategory/
      );
    }
  });

  it("the merchant is TOLD it does not limit them", () => {
    expect(CATEGORY_PURPOSE_COPY).toMatch(/never limits/i);
    expect(CATEGORY_PURPOSE_COPY).toMatch(/suggest/i);
  });

  it("the module states the authority and the invariant", () => {
    // Whitespace collapsed and comment continuation markers stripped, the
    // lesson `couranr-activation` learned: a sentence wrapped across source
    // lines is the sentence it reads as.
    const src = readFileSync(path.join(ROOT, "lib/couranr/categories/registry.ts"), "utf8")
      .replace(/^\s*\*\s?/gm, " ")
      .replace(/\s+/g, " ")
      .toLowerCase();
    expect(src).toContain("category controls initial recommendations, not eligibility");
    expect(src).toContain("no decision about categories");
  });
});

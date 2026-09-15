import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CONSUMER_MAX_DECLARED_VALUE_CENTS,
  PROTECTION_THRESHOLDS,
} from "@/lib/couranr/consumer/protection";

/**
 * The TypeScript authority and the SQL re-derivation must agree, forever.
 *
 * There are two protection tables in this system by design: the module the
 * server and the /send UI read, and `private.couranr_derive_protection_level`,
 * which the database uses to refuse a row whose stored level disagrees. Two
 * tables are the point — the SQL one is the enforcement point a tampered
 * browser cannot reach. Two tables that DRIFT are a hole: the application would
 * write a level the database happily accepts under a different rule.
 *
 * This file exists because the migration's own comment claimed it did. That
 * claim was written before the file was, and a comment naming a guard that does
 * not exist is worse than no comment — it is the reason nobody goes looking.
 *
 * The disposable suite (e2e/disposable/consumerTrustCustody.mjs) proves the SQL
 * function RUNS and returns the right bands. This proves the two definitions
 * cannot silently diverge in the file, which is cheaper and catches the edit
 * that has not been executed yet.
 */
const ROOT = path.resolve(__dirname, "..");
const MIGRATION = readFileSync(
  path.join(ROOT, "supabase/migrations/20260915090000_couranr_consumer_trust_custody_v1.sql"),
  "utf8"
);

/** The executable body of the derivation, comments stripped. */
function derivationSql(): string {
  const start = MIGRATION.indexOf("create or replace function private.couranr_derive_protection_level");
  expect(start, "the derivation function is not in the migration").toBeGreaterThan(-1);
  const end = MIGRATION.indexOf("$fn$;", start);
  return MIGRATION.slice(start, end)
    .replace(/^\s*--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("the SQL re-derivation matches the TypeScript authority", () => {
  it("uses the same three band boundaries, to the cent", () => {
    const sql = derivationSql();
    /* Read the numbers OUT of the SQL rather than asserting the SQL contains a
       number the test also hardcodes — that would pass if both were wrong. */
    const bounds = [...sql.matchAll(/p_cents\s*<=\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(bounds, "expected exactly three ascending upper bounds").toHaveLength(3);
    expect(bounds).toEqual([
      PROTECTION_THRESHOLDS.standardMaxCents,
      PROTECTION_THRESHOLDS.securePickupMaxCents,
      PROTECTION_THRESHOLDS.protectedHandoffMaxCents,
    ]);
  });

  it("maps each band to the same level name the module uses", () => {
    const sql = derivationSql();
    expect(sql).toMatch(/p_cents\s*<=\s*3000\s+then\s+'standard'/);
    expect(sql).toMatch(/p_cents\s*<=\s*15000\s+then\s+'secure_pickup'/);
    expect(sql).toMatch(/p_cents\s*<=\s*50000\s+then\s+'protected_handoff'/);
    expect(sql).toMatch(/else\s+'declined'/);
  });

  it("refuses a negative value rather than banding it as standard", () => {
    // `p_cents < 0 then 'declined'` must come BEFORE the `<= 3000` arm, or -1
    // would fall into standard and a malformed payload would take the cheapest
    // custody path.
    const sql = derivationSql();
    const negative = sql.indexOf("p_cents < 0");
    const standard = sql.indexOf("<= 3000");
    expect(negative).toBeGreaterThan(-1);
    expect(negative).toBeLessThan(standard);
  });

  it("returns null for a null value — an ungoverned row derives no level", () => {
    expect(derivationSql()).toMatch(/p_cents is null then null/);
  });

  it("is immutable, so a CHECK constraint may call it", () => {
    // A CHECK constraint can only call an IMMUTABLE function. Without this the
    // migration would fail to apply — and the whole anti-tamper invariant with it.
    expect(derivationSql()).toMatch(/\bimmutable\b/);
  });

  it("pins the ceiling in both places", () => {
    expect(CONSUMER_MAX_DECLARED_VALUE_CENTS).toBe(50_000);
    // The range CHECK is a separate statement from the derivation and must use
    // the same ceiling.
    expect(MIGRATION).toMatch(/declared_value_cents\s*<=\s*50000/);
  });
});

describe("the constraints the migration claims to add", () => {
  /* A migration that adds a constraint nobody ever attempts to violate is a
     constraint nobody knows works. These assert the constraint EXISTS in the
     file; e2e/disposable/consumerTrustCustody.mjs attempts to violate each one
     against a real database. */
  const REQUIRED = [
    "couranr_dr_declared_value_range_chk",
    "couranr_dr_protection_level_chk",
    "couranr_dr_protection_derived_chk",
    "couranr_dr_protection_completeness_chk",
    "couranr_dr_terms_evidence_chk",
    "couranr_dr_consumer_acceptance_chk",
    "couranr_dr_consumer_email_first_chk",
  ];

  it("declares every constraint this stage depends on", () => {
    for (const c of REQUIRED) {
      expect(MIGRATION, `${c} is missing`).toContain(`add constraint ${c}`);
    }
  });

  it("every constraint is attempted by the executed suite", () => {
    /* The gap this catches: stage 2 shipped with the email-first and acceptance
       constraints written and never once violated on purpose. The commit
       claimed them. Nothing proved them. */
    const suite = readFileSync(path.join(ROOT, "e2e/disposable/consumerTrustCustody.mjs"), "utf8");
    const untested = REQUIRED.filter((c) => !suite.includes(c));
    expect(untested, "constraints with no executed attack").toEqual([]);
  });

  it("leaves the pre-existing phone-OR-email rule in place", () => {
    // Email-first is added BESIDE the old rule, never by relaxing it, so a
    // historical row keeps the rule it was written under.
    expect(MIGRATION).not.toContain("drop constraint if exists couranr_dr_consumer_submitted_contact_chk");
  });

  it("makes every new column nullable, so historical rows survive", () => {
    const added = MIGRATION.slice(
      MIGRATION.indexOf("add column if not exists declared_value_cents"),
      MIGRATION.indexOf("comment on column")
    );
    expect(added).not.toMatch(/not null/i);
  });
});

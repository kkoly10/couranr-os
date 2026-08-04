import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Repo-wide rules about the migration sequence itself.
 *
 * Separate from the per-feature suites because these apply to every migration
 * ever added, including ones that do not exist yet. A new migration that breaks
 * one of these fails here rather than in whatever feature suite happens to read
 * the same directory.
 *
 * WHAT THESE TESTS CANNOT DO. They read files. Whether a rollback is a true
 * inverse can only be established by applying the whole sequence forward and
 * then backward against a real PostgreSQL, which is how the current set was
 * verified: 35/35 forward into an empty database, 34/35 back, zero `couranr_`
 * tables and zero `couranr_` functions surviving. The one refusal is
 * deliberate and is asserted below by name.
 */

const ROOT = path.resolve(__dirname, "..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");

const ALL = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));
const FORWARD = ALL.filter((f) => !f.includes(".rollback."));
const ROLLBACKS = ALL.filter((f) => f.includes(".rollback."));

const read = (f: string) => readFileSync(path.join(MIGRATIONS, f), "utf8");
const stripSql = (s: string) => s.replace(/^\s*--.*$/gm, "");

describe("every forward migration is paired with a rollback", () => {
  it("finds a migration set to police", () => {
    // Without this the pairing test below would pass vacuously on an empty
    // directory, which is the same shape of bug as a filter that matches
    // nothing.
    expect(FORWARD.length).toBeGreaterThanOrEqual(35);
  });

  it("no forward migration is missing its rollback", () => {
    const missing = FORWARD.filter(
      (f) => !ALL.includes(f.replace(/\.sql$/, ".rollback.sql"))
    );
    expect(
      missing,
      `forward migrations with no rollback:\n  ${missing.join("\n  ")}`
    ).toEqual([]);
  });

  it("no rollback is orphaned", () => {
    const orphans = ROLLBACKS.filter(
      (f) => !ALL.includes(f.replace(/\.rollback\.sql$/, ".sql"))
    );
    expect(orphans).toEqual([]);
  });

  it("no rollback is empty of statements", () => {
    // Two rollbacks generated EMPTY because the extractor that built them
    // required `$$` to close a function body and those migrations use `$fn$`.
    // They looked fine and would have restored nothing.
    const empty = ROLLBACKS.filter((f) => {
      const body = stripSql(read(f))
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && l !== "begin;" && l !== "commit;");
      return body.length === 0;
    });
    expect(empty, `rollbacks with no statements:\n  ${empty.join("\n  ")}`).toEqual([]);
  });
});

describe("rollbacks fail loudly rather than cascading", () => {
  /**
   * RESTRICT everywhere.
   *
   * `DROP TABLE ... CASCADE` removes dependent rows and objects nobody asked to
   * lose. `DROP FUNCTION ... CASCADE` silently removes CHECK constraints and
   * triggers that call the function. In both cases the default, RESTRICT, fails
   * with a message naming the dependency — which is what an operator running a
   * rollback needs to see.
   *
   * The generator that produced these was inconsistent with itself: RESTRICT on
   * every table, CASCADE on every function, with a comment defending RESTRICT
   * three lines above.
   */
  it("no rollback drops a table with CASCADE", () => {
    const offenders = ROLLBACKS.filter((f) => /drop\s+table[^;]*cascade/i.test(stripSql(read(f))));
    expect(offenders).toEqual([]);
  });

  it("no rollback drops a function with CASCADE", () => {
    const offenders = ROLLBACKS.filter((f) =>
      /drop\s+function[^;]*cascade/i.test(stripSql(read(f)))
    );
    expect(offenders).toEqual([]);
  });

  it("every table drop is explicitly RESTRICT rather than relying on the default", () => {
    // RESTRICT is the default, so omitting it is not a bug — but stating it
    // makes the intent survive someone adding CASCADE later "to make it work".
    const bad: string[] = [];
    for (const f of ROLLBACKS) {
      for (const m of stripSql(read(f)).matchAll(/drop\s+table[^;]*;/gi)) {
        if (!/restrict/i.test(m[0])) bad.push(`${f}: ${m[0].trim()}`);
      }
    }
    expect(bad, `table drops without an explicit RESTRICT:\n  ${bad.join("\n  ")}`).toEqual([]);
  });
});

describe("rollbacks say what they destroy", () => {
  /**
   * Twelve of the tables these rollbacks drop hold real production rows. A
   * rollback that drops one without saying so invites an operator to run it to
   * "clean up".
   */
  const DROPS_REAL_DATA = [
    "20260801083000_couranr_service_plan_and_deliveries.rollback.sql",
    "20260801190000_couranr_managed_dispatch.rollback.sql",
    "20260802030000_couranr_dispatch_driver_execution_tables.rollback.sql",
  ];

  for (const f of DROPS_REAL_DATA) {
    it(`${f.replace(".rollback.sql", "")} warns before dropping live tables`, () => {
      expect(ALL).toContain(f);
      const header = read(f).slice(0, read(f).indexOf("begin;"));
      expect(header.toUpperCase()).toContain("REAL PRODUCTION DATA");
    });
  }

  it("the one rollback that refuses by design says why", () => {
    // 20260731234500 deliberately raises rather than restoring a function that
    // throws 42702 on every call. It is the single failure in the full reverse
    // sequence and it is correct.
    const f = "20260731234500_couranr_fix_redeem_ambiguity.rollback.sql";
    expect(ALL).toContain(f);
    expect(read(f).toLowerCase()).toContain("refusing to restore");
  });
});

describe("forward migrations keep the properties the sequence depends on", () => {
  it("no forward migration drops a table or a column", () => {
    // The working rule for this repo: migrations are additive. A drop belongs
    // in a rollback, reviewed on its own terms.
    const offenders: string[] = [];
    for (const f of FORWARD) {
      const sql = stripSql(read(f));
      for (const m of sql.matchAll(/drop\s+(table|column)\s+(?!if\s+exists\s+public\.couranr_conversation)[^;]*;/gi)) {
        // `drop constraint` and `drop trigger` are corrections, not data loss.
        if (/drop\s+(table|column)/i.test(m[0])) offenders.push(`${f}: ${m[0].trim().slice(0, 80)}`);
      }
    }
    expect(
      offenders,
      `forward migrations are additive; these drop:\n  ${offenders.join("\n  ")}`
    ).toEqual([]);
  });

  it("every migration filename sorts in application order", () => {
    // The sequence is applied by filename sort, so a name that does not begin
    // with a sortable timestamp silently lands in the wrong place.
    const bad = FORWARD.filter((f) => !/^\d{14}_/.test(f));
    expect(bad, `migrations without a 14-digit timestamp prefix:\n  ${bad.join("\n  ")}`).toEqual(
      []
    );
  });
});

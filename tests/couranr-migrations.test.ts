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
 *
 * ROLLBACKS LIVE IN supabase/rollbacks/, NOT BESIDE THE MIGRATIONS.
 *
 * They used to sit in `supabase/migrations/`, and that was a live deployment
 * hazard rather than an aesthetic one. The Supabase CLI treats any file
 * matching `<timestamp>_name.sql` as a migration to APPLY, and
 * `20260731045417_couranr_delivery_requests.rollback.sql` matches. It saw 76
 * files where the repository has 38.
 *
 * Worse, `.rollback.sql` sorts BEFORE `.sql` (`r` < `s`), so a deployment ran
 * the rollback FIRST. Observed against an empty database, verbatim:
 *
 *     Applying migration 20260731045417_couranr_delivery_requests.rollback.sql...
 *     Applying migration 20260731045417_couranr_delivery_requests.sql...
 *     ERROR: duplicate key value violates unique constraint "schema_migrations_pkey"
 *
 * The DROP script executed, claimed the version, and the real migration then
 * collided on it. `e2e/disposable/deploymentSafety.mjs` reproduces this and
 * asserts the fix.
 */

const ROOT = path.resolve(__dirname, "..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const ROLLBACKS_DIR = path.join(ROOT, "supabase/rollbacks");

const FORWARD = readdirSync(MIGRATIONS).filter(
  (f) => f.endsWith(".sql") && !f.includes(".rollback.")
);
const ROLLBACKS = readdirSync(ROLLBACKS_DIR).filter((f) => f.endsWith(".rollback.sql"));
const ALL = [...FORWARD, ...ROLLBACKS];

/** Reads from whichever directory the file belongs to. */
const read = (f: string) =>
  readFileSync(path.join(f.includes(".rollback.") ? ROLLBACKS_DIR : MIGRATIONS, f), "utf8");
const stripSql = (s: string) => s.replace(/^\s*--.*$/gm, "");

/**
 * THE RULE WHOSE ABSENCE LET A DROP SCRIPT BECOME A DEPLOYMENT STEP.
 *
 * Everything else in this file polices what a rollback CONTAINS. Nothing
 * policed where it LIVES, so 38 rollback files sat in the directory the
 * deployment command reads, and a full green suite said nothing.
 */
describe("no rollback is reachable by the deployment command", () => {
  /** The Supabase CLI's own rule for what counts as a migration file. */
  const CLI_MIGRATION_PATTERN = /^\d{14}_.+\.sql$/;

  it("supabase/migrations/ contains no rollback file", () => {
    const strays = readdirSync(MIGRATIONS).filter((f) => f.includes(".rollback."));
    expect(
      strays,
      "a rollback in supabase/migrations/ WILL be executed by `supabase db push`, " +
        "and because .rollback.sql sorts before .sql it runs BEFORE its own migration"
    ).toEqual([]);
  });

  it("the CLI would see exactly the forward migrations", () => {
    const seen = readdirSync(MIGRATIONS).filter((f) => CLI_MIGRATION_PATTERN.test(f));
    expect(seen.length).toBe(FORWARD.length);
    expect(seen.sort()).toEqual([...FORWARD].sort());
  });

  it("POSITIVE CONTROL: the CLI pattern really does match a rollback filename", () => {
    // If this ever stops matching, the rule above becomes vacuous and the
    // hazard could return unnoticed.
    expect(
      CLI_MIGRATION_PATTERN.test("20260731045417_couranr_delivery_requests.rollback.sql")
    ).toBe(true);
    // ...and it sorts BEFORE the forward file, which is why it ran first.
    const pair = [
      "20260731045417_couranr_delivery_requests.sql",
      "20260731045417_couranr_delivery_requests.rollback.sql",
    ].sort();
    expect(pair[0]).toBe("20260731045417_couranr_delivery_requests.rollback.sql");
  });

  it("every file in supabase/rollbacks/ is a rollback, and nothing else", () => {
    const wrong = readdirSync(ROLLBACKS_DIR).filter((f) => !f.endsWith(".rollback.sql"));
    expect(wrong, "supabase/rollbacks/ must hold only *.rollback.sql").toEqual([]);
  });
});

describe("every forward migration is paired with a rollback", () => {
  it("finds a migration set to police", () => {
    // Without this the pairing test below would pass vacuously on an empty
    // directory, which is the same shape of bug as a filter that matches
    // nothing.
    // Non-vacuity guard: without it the pairing test below would pass on an
    // empty directory, which is the same shape of bug as a filter matching
    // nothing. The floor is the count at the time this branch was cut.
    expect(FORWARD.length).toBeGreaterThanOrEqual(31);
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

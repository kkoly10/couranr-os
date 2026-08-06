import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * SEC-001 regression guard.
 *
 * The defect: `profiles_update_own` was an UPDATE policy with a NULL WITH
 * CHECK, so PostgreSQL substituted its USING expression — which pins the row
 * (`auth.uid() = id`) and never the columns. Combined with a live
 * column-level UPDATE grant on `profiles.role`, and with `public.is_admin()`
 * answering "are you an admin?" by reading that very column, any signed-in
 * user could grant themselves admin from a browser.
 *
 * These tests are static: they assert the migration that closes the hole is
 * present and says what it must say. That is deliberately not the whole
 * story — a static test cannot observe the live privilege system, and a future
 * migration could re-grant UPDATE without editing this file. The live half is
 * `supabase/verification/sec001_profiles_role_privilege.sql`, which must report
 * PASS on all 12 rows. What this file catches is the likelier regression: the
 * migration being edited, reverted, or quietly dropped from the sequence.
 */

const ROOT = path.resolve(__dirname, "..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");

const FORWARD_NAME = "20260804120000_sec001_profiles_role_privilege.sql";
const ROLLBACK_NAME = "20260804120000_sec001_profiles_role_privilege.rollback.sql";

/** Comments name the very patterns the SQL must not contain, so strip them. */
const stripSql = (s: string) => s.replace(/^\s*--.*$/gm, "");

const FORWARD = stripSql(readFileSync(path.join(MIGRATIONS, FORWARD_NAME), "utf8"));
const ROLLBACK = stripSql(
  readFileSync(path.join(ROOT, "supabase/rollbacks", ROLLBACK_NAME), "utf8")
);

/** Every forward migration in sequence order. Rollbacks are never applied. */
const ALL_FORWARD = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql") && !f.includes(".rollback."))
  .sort();

const ALL_FORWARD_SQL = stripSql(
  ALL_FORWARD.map((f) => readFileSync(path.join(MIGRATIONS, f), "utf8")).join("\n")
);

/** Collapse whitespace so a reformat does not fail the assertion. */
const flat = (s: string) => s.replace(/\s+/g, " ").toLowerCase();

describe("SEC-001 — profiles.role is not self-assignable", () => {
  it("the forward migration is present in the sequence", () => {
    expect(ALL_FORWARD).toContain(FORWARD_NAME);
  });

  /**
   * The revoked role list, parsed rather than substring-matched.
   *
   * Substring matching cannot do this job: the statement is `revoke update on
   * public.profiles from public, anon, authenticated`, so a naive
   * `clause.includes("public")` is satisfied by the SCHEMA NAME in
   * `public.profiles` and stays green even when `public` is removed from the
   * role list. That is the exact can't-fail shape this repo has shipped before,
   * and it was caught here only by deliberately breaking the migration and
   * watching the test pass anyway.
   */
  function revokedRoles(sql: string): string[] {
    const m = flat(sql).match(/revoke\s+update\s+on\s+public\.profiles\s+from\s+([^;]+);/);
    expect(m, "the forward migration must revoke UPDATE on public.profiles").not.toBeNull();
    return m![1].split(",").map((r) => r.trim());
  }

  it("revokes UPDATE on profiles from PUBLIC, anon and authenticated", () => {
    // PUBLIC must be named explicitly. A privilege held through PUBLIC does
    // not appear in information_schema grantee rows, so a revoke that lists
    // only the two Supabase roles can leave the escalation open while looking
    // complete. This is the single most load-bearing token in the migration.
    const roles = revokedRoles(FORWARD);
    for (const role of ["public", "anon", "authenticated"]) {
      expect(roles, `revoke must name ${role} as a role`).toContain(role);
    }
  });

  it("does NOT revoke UPDATE from service_role", () => {
    // service_role is the only identity left able to change a role. Revoking
    // from it would make legitimate admin administration impossible, and would
    // break the server-side paths that assume full DML.
    expect(revokedRoles(FORWARD)).not.toContain("service_role");
  });

  it("gives profiles_update_own an explicit WITH CHECK", () => {
    const sql = flat(FORWARD);
    expect(sql).toContain("alter policy profiles_update_own on public.profiles");
    expect(sql).toContain("with check (auth.uid() = id)");
  });

  it("leaves SELECT and INSERT alone, so reads and signup still work", () => {
    const sql = flat(FORWARD);
    expect(sql).not.toMatch(/revoke\s+(select|insert)\s+on\s+public\.profiles/);
    expect(sql).not.toMatch(/revoke\s+all\s+on\s+public\.profiles/);
  });

  it("no later migration re-grants UPDATE on profiles to a browser role", () => {
    // The real regression this suite exists to catch: someone re-opens the
    // privilege in a future migration. Scan every forward migration, not just
    // this one, because the last writer wins when they are applied in order.
    const offenders: string[] = [];
    for (const file of ALL_FORWARD) {
      const sql = flat(stripSql(readFileSync(path.join(MIGRATIONS, file), "utf8")));
      for (const m of sql.matchAll(/grant[^;]*\bupdate\b[^;]*\bon\b[^;]*profiles[^;]*;/g)) {
        const stmt = m[0];
        if (/\b(anon|authenticated|public)\b/.test(stmt.slice(stmt.indexOf(" to ")))) {
          offenders.push(`${file}: ${stmt.trim()}`);
        }
      }
    }
    expect(
      offenders,
      `a migration re-grants UPDATE on profiles to a browser-reachable role:\n  ${offenders.join(
        "\n  "
      )}`
    ).toEqual([]);
  });

  it("the paired rollback exists and restores the policy by recreating it", () => {
    expect(readdirSync(path.join(ROOT, "supabase/rollbacks"))).toContain(ROLLBACK_NAME);

    // ALTER POLICY leaves omitted clauses unchanged, so `alter policy ... using
    // (...)` would NOT clear the WITH CHECK the forward migration added. Only a
    // DROP and CREATE restores the original NULL-WITH-CHECK shape. If the
    // rollback ever goes back to ALTER, it silently stops being a rollback.
    const sql = flat(ROLLBACK);
    expect(sql).toContain("drop policy profiles_update_own on public.profiles");
    expect(sql).toContain("create policy profiles_update_own on public.profiles");
    expect(sql).not.toContain("alter policy");
  });

  it("the escalation premise is documented where the next reader will look", () => {
    // The migration header is the only place the three-fact chain is written
    // down. If it is stripped, the next person to touch this table has no way
    // to know why the privilege is missing and will helpfully re-grant it.
    const raw = readFileSync(path.join(MIGRATIONS, FORWARD_NAME), "utf8").toLowerCase();
    expect(raw).toContain("is_admin");
    expect(raw).toContain("polwithcheck");
    expect(raw).toContain("has_column_privilege");
  });
});

describe("SEC-001 — the application still does not write to profiles", () => {
  /**
   * The migration's safety argument rests on this: no repository code updates
   * `profiles`, so revoking UPDATE from the browser roles breaks nothing. If a
   * future commit adds a client-side profile write, it will fail at runtime
   * against a permission error — this test turns that into a build failure with
   * the reason attached.
   */
  const SEARCH_DIRS = ["app", "lib", "components"];
  const EXTS = new Set([".ts", ".tsx"]);

  function walk(dir: string, out: string[] = []): string[] {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return out;
    }
    for (const entry of entries) {
      if (entry === "node_modules" || entry === ".next") continue;
      const full = path.join(dir, entry);
      const stat = readdirSync(path.dirname(full), { withFileTypes: true }).find(
        (d) => d.name === entry
      );
      if (stat?.isDirectory()) walk(full, out);
      else if (EXTS.has(path.extname(full))) out.push(full);
    }
    return out;
  }

  const FILES = SEARCH_DIRS.flatMap((d) => walk(path.join(ROOT, d)));

  it("finds source files to police", () => {
    expect(FILES.length).toBeGreaterThan(100);
  });

  it("no module performs an update/upsert/delete against the profiles table", () => {
    const offenders: string[] = [];

    for (const file of FILES) {
      const src = readFileSync(file, "utf8");
      // Match a profiles table handle and look at what is chained onto it.
      for (const m of src.matchAll(/\.from\(\s*["'`]profiles["'`]\s*\)([\s\S]{0,200})/g)) {
        const tail = m[1];
        const mutation = tail.match(/\.\s*(update|upsert|delete)\s*\(/);
        if (mutation) {
          offenders.push(`${path.relative(ROOT, file)}: .from("profiles")${mutation[0]}`);
        }
      }
    }

    expect(
      offenders,
      "SEC-001 revoked UPDATE on profiles from anon and authenticated. A write " +
        "added here will fail at runtime unless it runs through service_role:\n  " +
        offenders.join("\n  ")
    ).toEqual([]);
  });
});

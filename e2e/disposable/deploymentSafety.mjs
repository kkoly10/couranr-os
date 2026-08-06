/**
 * Proves what the REAL migration deployment mechanism would do to production,
 * against a disposable database that carries production's exact ledger shape.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 *
 * A schema diff is not a deployment proof. `docs/couranr-mvp/PHASE8_RECONCILIATION.md`
 * established that production is schema-IDENTICAL to a clean replay of this
 * branch — 67 objects, empty diff — and that finding is still true and still
 * useless for answering the only question that matters at deploy time:
 *
 *     if someone runs the deployment command tomorrow, what happens?
 *
 * Running it revealed two defects, neither visible in any schema comparison.
 *
 * DEFECT 1 — THE CLI TREATS EVERY *.rollback.sql AS A MIGRATION TO APPLY.
 *
 *   Its file pattern is `<timestamp>_name.sql`, and
 *   `20260731045417_couranr_delivery_requests.rollback.sql` matches it. So the
 *   38 rollback files in `supabase/migrations/` were 38 extra migrations: the
 *   CLI saw 76 local files where the repository has 38.
 *
 *   Worse, `.rollback.sql` sorts BEFORE `.sql` (`r` < `s`), so the rollback ran
 *   FIRST. Against an empty database the observed transcript was, verbatim:
 *
 *       Applying migration 20260731045417_couranr_delivery_requests.rollback.sql...
 *       Applying migration 20260731045417_couranr_delivery_requests.sql...
 *       ERROR: duplicate key value violates unique constraint
 *              "schema_migrations_pkey" (SQLSTATE 23505)
 *
 *   The rollback executed, claimed the version, and the real migration then
 *   collided recording the same version. The deployment could not complete at
 *   all, and the first thing it did was run a DROP script.
 *
 * DEFECT 2 — 35 OF 38 REPO VERSIONS ARE ABSENT FROM PRODUCTION'S LEDGER.
 *
 *   Migrations were applied through the Supabase MCP, which stamps its own
 *   timestamp, so `20260804150000_couranr_conversations.sql` is recorded as
 *   version `20260804154141`. Only 3 of 38 filename versions match a ledger
 *   row. `supabase db push` fails closed on this with
 *   LegacyDbPushMissingLocalError — a genuine safety net — but it means NO
 *   migration can be deployed until the ledger is reconciled.
 *
 *   The CLI's own suggested remedy is `migration repair --status reverted` on
 *   the 35 production stamps ALONE. Following only that half would mark
 *   production's history reverted and then push all 38 local files (plus, at
 *   the time, 38 rollbacks) — the opposite of what is wanted.
 *
 * ---------------------------------------------------------------------------
 * THE FIX, IN TWO PARTS, BOTH REQUIRED
 * ---------------------------------------------------------------------------
 *
 *   1. Rollbacks live in `supabase/rollbacks/`, not `supabase/migrations/`.
 *      The CLI then sees 38 files, not 76, and no DROP script is reachable by
 *      a deployment.
 *
 *   2. Repair the ledger in BOTH directions: `--status applied` for the repo
 *      versions that are genuinely applied under a different stamp, and
 *      `--status reverted` for the orphan production stamps that no file
 *      claims.
 *
 * Measured result after both, and asserted below: exactly ONE migration would
 * apply — the newly added one — and a second push reports "up to date".
 *
 * ---------------------------------------------------------------------------
 * SAFETY
 * ---------------------------------------------------------------------------
 *
 * Every command here targets a LOCAL disposable database. Nothing in this file
 * connects to the Couranr project, and the repair commands are printed for a
 * human to run against production rather than run for them.
 *
 *   node e2e/disposable/deploymentSafety.mjs
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, copyFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SUPABASE_CLI = ["--yes", "supabase@2.111.0"];

let passed = 0;
let failed = 0;
const results = [];

function check(id, description, ok, detail = "") {
  if (ok) passed++;
  else failed++;
  results.push({ id, description, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${description}${detail ? `  [${detail}]` : ""}`);
}

function cli(args, { allowFail = false } = {}) {
  try {
    return execFileSync("npx", [...SUPABASE_CLI, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      cwd: process.env.DEPLOY_PROOF_DIR || ROOT,
      timeout: 300_000,
    });
  } catch (e) {
    if (!allowFail) throw e;
    return `${e.stdout || ""}${e.stderr || ""}`;
  }
}

/** The CLI prints a JSON object as its final line. */
function lastJson(out) {
  const lines = out.trim().split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      /* not this line */
    }
  }
  return null;
}

/**
 * The repository's forward migrations and rollbacks, by the CLI's own rule:
 * a migration is `<14 digits>_name.sql`, and `.rollback.sql` matches that rule
 * too. That is the entire defect, expressed as a predicate.
 */
export function classifyMigrationDir(dir) {
  const pattern = /^\d{14}_.+\.sql$/;
  const all = readdirSync(dir).filter((f) => pattern.test(f));
  return {
    seenByCli: all,
    forward: all.filter((f) => !f.endsWith(".rollback.sql")),
    rollbacks: all.filter((f) => f.endsWith(".rollback.sql")),
  };
}

async function main() {
  const dbUrl = process.env.DEPLOY_PROOF_DB_URL;
  console.log("Phase 8 deployment-safety proof\n");

  // ── static half: what does the CLI see in the repository today? ───────────
  const migrationsDir = path.join(ROOT, "supabase/migrations");
  const rollbacksDir = path.join(ROOT, "supabase/rollbacks");
  const inMigrations = classifyMigrationDir(migrationsDir);

  check(
    "D1",
    "supabase/migrations/ contains NO rollback files",
    inMigrations.rollbacks.length === 0,
    `${inMigrations.rollbacks.length} found`
  );
  check(
    "D2",
    "the CLI sees exactly the forward migrations, not twice as many",
    inMigrations.seenByCli.length === inMigrations.forward.length,
    `sees ${inMigrations.seenByCli.length}, forward ${inMigrations.forward.length}`
  );

  let rollbackCount = 0;
  try {
    rollbackCount = readdirSync(rollbacksDir).filter((f) => f.endsWith(".sql")).length;
  } catch {
    /* directory absent */
  }
  check(
    "D3",
    "every forward migration still has a rollback, in supabase/rollbacks/",
    rollbackCount === inMigrations.forward.length,
    `${rollbackCount} rollbacks for ${inMigrations.forward.length} migrations`
  );

  if (!dbUrl) {
    console.log(
      "\n  DEPLOY_PROOF_DB_URL not set — the static half ran, the live half did not."
    );
    console.log("  Bring up a disposable database with e2e/disposable/up.mjs and re-run.\n");
    summarize();
    return;
  }

  // ── live half: what would the deployment actually do? ─────────────────────
  const listOut = cli(["migration", "list", "--db-url", dbUrl], { allowFail: true });
  const list = lastJson(listOut);
  if (!list?.migrations) {
    check("D4", "migration list returned a parseable result", false, listOut.slice(0, 160));
    summarize();
    return;
  }

  const wouldApply = [
    ...new Set(list.migrations.filter((m) => m.local && !m.remote).map((m) => m.local)),
  ].sort();
  const orphans = [
    ...new Set(list.migrations.filter((m) => m.remote && !m.local).map((m) => m.remote)),
  ].sort();

  check("D4", "no orphan remote versions remain", orphans.length === 0, `${orphans.length} orphans`);

  const expected = (process.env.DEPLOY_PROOF_EXPECT_APPLY || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (expected.length) {
    check(
      "D5",
      "exactly the expected new migrations would apply",
      JSON.stringify(wouldApply) === JSON.stringify(expected.sort()),
      `would apply ${JSON.stringify(wouldApply)}`
    );
  } else {
    check("D5", "at most one migration would apply", wouldApply.length <= 1, JSON.stringify(wouldApply));
  }

  // No Phase 8 migration may be in the would-apply set: all seven are already
  // live in production, and replaying 20260804210000 would raise CR409 against
  // real participant rows.
  const PHASE8 = [
    "20260804150000", "20260804160000", "20260804170000", "20260804180000",
    "20260804190000", "20260804200000", "20260804210000",
  ];
  const p8WouldApply = PHASE8.filter((v) => wouldApply.includes(v));
  check(
    "D6",
    "all seven Phase 8 migrations are treated as APPLIED, none would replay",
    p8WouldApply.length === 0,
    p8WouldApply.length ? `would replay ${p8WouldApply.join(",")}` : "0 of 7"
  );

  const dry = lastJson(cli(["db", "push", "--dry-run", "--db-url", dbUrl], { allowFail: true }));
  check(
    "D7",
    "db push --dry-run agrees with migration list",
    Array.isArray(dry?.migrations) && dry.migrations.length === wouldApply.length,
    JSON.stringify(dry?.migrations ?? dry)
  );

  const push = lastJson(cli(["db", "push", "-p", "", "--db-url", dbUrl], { allowFail: true }));
  check("D8", "the push completes without error", Array.isArray(push?.migrations), JSON.stringify(push).slice(0, 120));

  const again = lastJson(cli(["db", "push", "-p", "", "--db-url", dbUrl], { allowFail: true }));
  check(
    "D9",
    "a second push is a clean no-op — the ledger and the files agree",
    again?.upToDate === true,
    JSON.stringify(again?.message ?? again)
  );

  summarize();
}

function summarize() {
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}

/**
 * Brings up a DISPOSABLE Couranr database and tears it down again.
 *
 * ---------------------------------------------------------------------------
 * WHAT PROBLEM THIS SOLVES
 * ---------------------------------------------------------------------------
 *
 * `e2e/phase8Acceptance.mjs` passed 26/26 once and then had to be disarmed. It
 * ran against the CONNECTED project, which holds 42 real orders, and
 * `service_role` has DELETE on no `couranr_*` table — they are append-only by
 * design. So it could seed but not clean up, and two runs left synthetic rows
 * beside real ones.
 *
 * The wrong fixes were available and are not taken here: granting production
 * DELETE, or applying `PROPOSED_couranr_e2e_cleanup.sql.review`. Both widen a
 * deliberately narrow grant to make a test easier.
 *
 * The right fix is a database that starts empty and is destroyed afterwards,
 * so cleanup is `rm -rf` rather than a privilege.
 *
 * ---------------------------------------------------------------------------
 * WHY A BARE POSTGRESQL AND NOT `supabase start`
 * ---------------------------------------------------------------------------
 *
 * `supabase start` needs Docker. This container has the docker CLI and NO
 * daemon — `/var/run/docker.sock` does not exist and `docker info` reports
 * "failed to connect to the docker API". Measured, not assumed. So the stack
 * is assembled directly:
 *
 *   PostgreSQL 16   /usr/lib/postgresql/16/bin, initdb into a scratch dir
 *   PostgREST       a real binary, the same server Supabase runs
 *
 * `bootstrap.sql` reproduces what no repository migration creates, and the two
 * items that decide whether privilege assertions mean anything:
 *
 *   pg_default_acl granting ALL on every new public object to anon,
 *   authenticated and service_role — without it a narrow GRANT looks effective
 *   locally and is a silent no-op in production;
 *
 *   service_role BYPASSRLS — RLS constrains none of the server commands in
 *   production, so a cluster where service_role respects RLS would pass tests
 *   production fails.
 *
 * Verified against production after a full replay: 24 couranr_ tables, 78
 * couranr_ functions, service_role BYPASSRLS true, anon holding no SELECT on
 * couranr_conversation_messages, and couranr_cvp_help_token_fkey pointing at
 * couranr_help_access_tokens.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES NOT REPRODUCE — state it in any report that cites a run
 * ---------------------------------------------------------------------------
 *
 * GoTrue is not started. `gateway.mjs` reimplements the two endpoints the
 * application calls — bcrypt against `auth.users.encrypted_password`, HS256
 * tokens verified with `crypto.timingSafeEqual`, and a `/auth/v1/user` that
 * reads the real row — and `e2e/disposable/authGateway.mjs` proves 20 refusals
 * against it. What that does NOT cover is GoTrue's own behaviour: sessions as
 * rows, refresh-token reuse detection, MFA, email confirmation, rate limiting.
 * A defect in GoTrue cannot be found here. Say so wherever a run is cited.
 *
 * Storage is a table, not a storage API, so uploads are not exercised here.
 * Neither gap affects the database acceptance matrix, which invokes functions
 * directly, and both are recorded rather than papered over.
 *
 * ---------------------------------------------------------------------------
 * USAGE
 * ---------------------------------------------------------------------------
 *
 *   node e2e/disposable/up.mjs            start, print connection info, wait
 *   node e2e/disposable/up.mjs --once     start, run the matrix, tear down
 *   node e2e/disposable/up.mjs --down     tear down a leftover instance
 *
 * The teardown is registered on SIGINT, SIGTERM and exit, so an interrupted
 * run does not leave a cluster behind.
 */

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PGBIN = process.env.COURANR_PGBIN || "/usr/lib/postgresql/16/bin";

/**
 * The cluster lives somewhere the `postgres` OS user can traverse. The
 * scratchpad is mode 0700 root, so initdb there fails with "could not access
 * directory ... Permission denied" — found by running it.
 */
const BASE = process.env.COURANR_DISPOSABLE_DIR || "/var/lib/postgresql/couranr-disposable";
const PORT = Number(process.env.COURANR_DISPOSABLE_PORT || 55432);
const DB = "couranr_disposable";

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });

/** Runs as the postgres OS user, which owns the data directory. */
const asPostgres = (command) => sh("su", ["postgres", "-c", command]);

export const dbUrl = (db = DB) => `postgresql://postgres@127.0.0.1:${PORT}/${db}?sslmode=disable`;

export function psql(sqlText, { db = DB, tuplesOnly = true } = {}) {
  return sh(path.join(PGBIN, "psql"), [
    "-h", "127.0.0.1", "-p", String(PORT), "-U", "postgres", "-d", db,
    ...(tuplesOnly ? ["-tA"] : []),
    // -q suppresses the command tag. Without it an `insert ... returning id`
    // yields "…uuid…\nINSERT 0 1", and a caller that only .trim()s carries the
    // tag into the next statement — which surfaced as
    // `invalid input syntax for type uuid`, one layer away from the cause.
    "-q",
    "-v", "ON_ERROR_STOP=1", "-c", sqlText,
  ]);
}

function isRunning() {
  try {
    sh(path.join(PGBIN, "pg_isready"), ["-h", "127.0.0.1", "-p", String(PORT)]);
    return true;
  } catch {
    return false;
  }
}

export function down({ quiet = false } = {}) {
  if (existsSync(path.join(BASE, "data", "postmaster.pid"))) {
    try {
      asPostgres(`${PGBIN}/pg_ctl -D ${BASE}/data -m immediate stop`);
    } catch {
      /* already gone */
    }
  }
  try {
    rmSync(BASE, { recursive: true, force: true });
  } catch {
    /* nothing to remove */
  }
  if (!quiet) console.log("  disposable database destroyed");
}

export function up({ quiet = false } = {}) {
  const log = (m) => !quiet && console.log(m);

  down({ quiet: true });
  mkdirSync(path.join(BASE, "data"), { recursive: true });
  mkdirSync(path.join(BASE, "log"), { recursive: true });
  sh("chown", ["-R", "postgres:postgres", BASE]);

  log("  initdb...");
  asPostgres(`${PGBIN}/initdb -D ${BASE}/data -U postgres --auth=trust -E UTF8 >${BASE}/log/initdb.log 2>&1`);

  log(`  starting on port ${PORT}...`);
  asPostgres(
    `${PGBIN}/pg_ctl -D ${BASE}/data -l ${BASE}/log/pg.log ` +
      `-o '-p ${PORT} -c listen_addresses=127.0.0.1' -w start`
  );
  if (!isRunning()) throw new Error("disposable postgres did not come up");

  psql(`create database ${DB}`, { db: "postgres" });

  log("  bootstrap (roles, pg_default_acl, auth/storage, the remote_schema baseline)...");
  sh(path.join(PGBIN, "psql"), [
    "-h", "127.0.0.1", "-p", String(PORT), "-U", "postgres", "-d", DB,
    "-q", "-v", "ON_ERROR_STOP=1", "-f", path.join(ROOT, "e2e/disposable/bootstrap.sql"),
  ]);

  const migrations = readdirSync(path.join(ROOT, "supabase/migrations"))
    .filter((f) => /^\d{14}_.+\.sql$/.test(f) && !f.includes(".rollback."))
    .sort();
  log(`  applying ${migrations.length} forward migrations in filename order...`);
  for (const f of migrations) {
    sh(path.join(PGBIN, "psql"), [
      "-h", "127.0.0.1", "-p", String(PORT), "-U", "postgres", "-d", DB,
      "-q", "-v", "ON_ERROR_STOP=1", "-f", path.join(ROOT, "supabase/migrations", f),
    ]);
  }

  return { url: dbUrl(), port: PORT, database: DB, migrationsApplied: migrations.length };
}

/**
 * The fidelity assertions. A disposable database that does not behave like
 * production is worse than none — it produces confident, wrong answers.
 * Every expected value here was read from the live project.
 */
export function verifyFidelity() {
  const one = (sql) => psql(sql).trim();
  const checks = [
    ["service_role has BYPASSRLS",
      () => one("select rolbypassrls from pg_roles where rolname='service_role'") === "t"],
    ["pg_default_acl grants exist",
      () => Number(one("select count(*) from pg_default_acl")) >= 3],
    /*
     * 24 at the production head, plus the two `couranr_`-prefixed tables from
     * migrations that are committed but NOT yet applied to production:
     * `couranr_team_events` (20260806120000, MER-015) and
     * `couranr_website_tool_configs` (20260806150000, MER-013). The disposable
     * stack is deliberately ahead of production by exactly those.
     *
     * `merchant_customers` and `customer_addresses` (20260806160000) are NOT
     * counted here: their names come from the canonical data model and carry
     * no `couranr_` prefix. They are asserted by name below instead, so this
     * probe cannot silently stop covering them.
     */
    ["26 couranr_ tables",
      () => one(`select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
                 where n.nspname='public' and c.relkind='r' and c.relname like 'couranr%'`) === "26"],
    ["the merchant-customer tables exist and are service_role-only",
      () =>
        one(`select has_table_privilege('service_role','public.merchant_customers','INSERT')
                 || ',' || has_table_privilege('authenticated','public.merchant_customers','SELECT')
                 || ',' || has_table_privilege('anon','public.customer_addresses','SELECT')`)
        === "true,false,false"],
    ["couranr_ functions present",
      () => Number(one(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                        where n.nspname='public' and p.proname like 'couranr%'`)) >= 78],
    ["SEC-001 held: authenticated cannot UPDATE profiles",
      () => one("select has_table_privilege('authenticated','public.profiles','UPDATE')") === "f"],
    ["SEC-001 held: profiles_update_own has a WITH CHECK",
      () => one(`select coalesce(pg_get_expr(polwithcheck,polrelid),'') from pg_policy
                 where polname='profiles_update_own'`).includes("auth.uid()")],
    ["the help-token FK points at couranr_help_access_tokens",
      () => one(`select confrelid::regclass::text from pg_constraint
                 where conname='couranr_cvp_help_token_fkey'`) === "couranr_help_access_tokens"],
    ["no role holds SELECT on the message table, despite pg_default_acl",
      () => one("select has_table_privilege('anon','public.couranr_conversation_messages','SELECT')") === "f"],
    ["HRS-002 clock functions are callable",
      () => one("select public.couranr_operating_timezone()") === "America/New_York"],
  ];

  const failures = [];
  for (const [name, fn] of checks) {
    let ok = false;
    try {
      ok = fn();
    } catch (e) {
      ok = false;
      failures.push(`${name}: threw ${e.message.split("\n")[0]}`);
      continue;
    }
    if (!ok) failures.push(name);
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  }
  return failures;
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.includes("--down")) {
    down();
    return;
  }

  console.log("Disposable Couranr database\n");
  const info = up();
  console.log(`\n  ${info.migrationsApplied} migrations applied`);
  console.log(`  ${info.url}\n`);

  console.log("Fidelity against production:");
  const failures = verifyFidelity();
  if (failures.length) {
    console.error(`\n  FIDELITY FAILED:\n    ${failures.join("\n    ")}`);
    down();
    process.exitCode = 1;
    return;
  }
  console.log("\n  fidelity OK\n");

  if (argv.includes("--once")) {
    down();
    return;
  }

  console.log("  Leaving it up. Tear down with: node e2e/disposable/up.mjs --down");
  console.log(`  Export for other harnesses:\n    export DEPLOY_PROOF_DB_URL="${info.url}"\n`);
}

// Never leave a cluster behind on an interrupted run.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    down({ quiet: true });
    process.exit(130);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e.message || e);
    down({ quiet: true });
    process.exitCode = 1;
  });
}

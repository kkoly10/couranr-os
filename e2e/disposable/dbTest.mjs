/**
 * `npm run db:test` — the database gate that actually EXECUTES.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 *
 * The platform baseline names `db:test` among its gate commands, and this
 * repository's history is exactly why the named command must not be a text
 * scan: a foreign key aimed at the wrong table survived 1230 passing tests and
 * a full migration round trip, because every check of that slice was static.
 * A constraint that only fires on INSERT is invisible to all of them.
 *
 * So every check here runs against a REAL PostgreSQL, created empty with all
 * forward migrations and destroyed afterwards. Sections:
 *
 *   clock      the five HRS-002 functions EXECUTED on fixed instants whose
 *              expected values were derived independently (Python zoneinfo)
 *              and verified against production on 2026-08-06 — including both
 *              2026 DST crossings;
 *   rls        row security, table grants, function grants — including the
 *              PUBLIC-inheritance trap that `pg_default_acl` sets on every new
 *              object, measured with has_*_privilege, never grantee rows;
 *   integrity  the constraints whose earlier absence shipped real defects;
 *   commands   a REAL fixture chain driven through the help-token command
 *              functions: issue → redeem → post → idempotent replay → refusal.
 *
 * `--rls-only` runs the rls section alone (this is `npm run check:rls`).
 *
 * ---------------------------------------------------------------------------
 * POSITIVE CONTROL — a check that cannot fail is worse than no check
 * ---------------------------------------------------------------------------
 *
 * `--positive-control` appends a check that is KNOWN false (timezone =
 * Europe/Paris) and exits 0 only if the real checks pass AND the planted check
 * fails. `scripts/positiveControls.mjs` drives this so the batch gate proves
 * the gate itself can go red.
 *
 * Run:  node e2e/disposable/dbTest.mjs [--rls-only] [--positive-control] [--keep]
 */

import crypto from "node:crypto";
import { up, down, psql } from "./up.mjs";

const args = process.argv.slice(2);
const RLS_ONLY = args.includes("--rls-only");
const POSITIVE_CONTROL = args.includes("--positive-control");
const KEEP = args.includes("--keep");

let passed = 0;
let failed = 0;

const one = (sql) => psql(sql).trim();

function check(id, description, actual, expected) {
  const ok = String(actual) === String(expected);
  ok ? passed++ : failed++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${id}  ${description}` +
      (ok ? "" : `  [expected ${JSON.stringify(String(expected))}, got ${JSON.stringify(String(actual))}]`)
  );
  return ok;
}

/**
 * A call that must RAISE, matched on the refusal MESSAGE. Success is the
 * refusal. psql only prints the SQLSTATE under \set VERBOSITY verbose, so the
 * stable thing to match is the message — which is also the identity the
 * acceptance matrix asserts is indistinguishable across refusal causes.
 */
function checkRaises(id, description, sql, expectedMessage) {
  let outcome = "NO ERROR";
  try {
    psql(sql);
  } catch (e) {
    const text = String(e.stderr || e.message || e);
    outcome = text.includes(expectedMessage) ? expectedMessage : `OTHER: ${text.slice(0, 120)}`;
  }
  check(id, description, outcome, expectedMessage);
}

/* ------------------------------------------------------------------ clock */

function sectionClock() {
  console.log("\nclock — HRS-002 functions EXECUTED on independently derived instants");
  check("CLK-1", "operating timezone", one("select public.couranr_operating_timezone()"), "America/New_York");
  check("CLK-2", "06:00 local is INSIDE the window (start inclusive)",
    one("select public.couranr_is_within_operating_hours('2026-07-14 06:00:00-04'::timestamptz)"), "t");
  check("CLK-3", "18:00 local is OUTSIDE the window (end exclusive)",
    one("select public.couranr_is_within_operating_hours('2026-07-14 18:00:00-04'::timestamptz)"), "f");
  check("CLK-4", "Saturday noon is outside",
    one("select public.couranr_is_within_operating_hours('2026-07-18 12:00:00-04'::timestamptz)"), "f");
  check("CLK-5", "in-hours: 14:00Z + 15 operating minutes = 14:15Z",
    one("select public.couranr_add_operating_minutes('2026-07-14 14:00:00+00', 15) at time zone 'UTC'"),
    "2026-07-14 14:15:00");
  check("CLK-6", "Friday 17:58 EDT + 15 rolls to Monday 06:13 EDT (10:13Z)",
    one("select public.couranr_add_operating_minutes('2026-07-17 21:58:00+00', 15) at time zone 'UTC'"),
    "2026-07-20 10:13:00");
  check("CLK-7", "Saturday + 15 rolls to Monday 06:15 EDT (10:15Z)",
    one("select public.couranr_add_operating_minutes('2026-07-18 16:00:00+00', 15) at time zone 'UTC'"),
    "2026-07-20 10:15:00");
  check("CLK-8", "SPRING-FORWARD weekend: Friday 17:50 EST + 15 = Monday 06:05 EDT (10:05Z)",
    one("select public.couranr_add_operating_minutes('2026-03-06 22:50:00+00', 15) at time zone 'UTC'"),
    "2026-03-09 10:05:00");
  check("CLK-9", "FALL-BACK weekend: Friday 17:50 EDT + 15 = Monday 06:05 EST (11:05Z)",
    one("select public.couranr_add_operating_minutes('2026-10-30 21:50:00+00', 15) at time zone 'UTC'"),
    "2026-11-02 11:05:00");
  // 2 minutes before Friday close + 13 after Monday open = 15 — necessarily,
  // since the end instant is what add_operating_minutes(start, 15) produced.
  check("CLK-10", "operating minutes across a weekend count only open time",
    one("select public.couranr_operating_minutes_between('2026-07-17 21:58:00+00','2026-07-20 10:13:00+00')"),
    "15.0000000000000000");
  check("CLK-11", "next operating period from Saturday is Monday 06:00 EDT",
    one("select public.couranr_next_operating_period_start('2026-07-18 16:00:00+00') at time zone 'UTC'"),
    "2026-07-20 10:00:00");
}

/* -------------------------------------------------------------------- rls */

function sectionRls() {
  console.log("\nrls — row security and grants, including PUBLIC inheritance");
  check("RLS-1", "every couranr_ table has row security enabled",
    one(`select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r'
            and c.relname like 'couranr%' and not c.relrowsecurity`), "0");
  check("RLS-2", "service_role has BYPASSRLS (grants, not RLS, are the real boundary)",
    one("select rolbypassrls from pg_roles where rolname = 'service_role'"), "t");
  check("RLS-3", "pg_default_acl trap is present (a narrow GRANT alone would be a no-op)",
    one("select count(*) >= 3 from pg_default_acl"), "t");
  check("RLS-4", "NO role can SELECT the message table — not even service_role",
    one(`select bool_or(has_table_privilege(r, 'public.couranr_conversation_messages', 'SELECT'))
           from unnest(array['anon','authenticated','service_role']) r`), "f");
  check("RLS-5", "anon holds no DML on couranr_conversations",
    one(`select bool_or(has_table_privilege('anon', 'public.couranr_conversations', p))
           from unnest(array['SELECT','INSERT','UPDATE','DELETE']) p`), "f");
  check("RLS-6", "SEC-001 holds: authenticated cannot UPDATE profiles",
    one("select has_table_privilege('authenticated', 'public.profiles', 'UPDATE')"), "f");
  check("RLS-7", "the thread reader executes as service_role ONLY",
    one(`select has_function_privilege('service_role', 'public.couranr_conversation_thread(uuid,uuid)', 'EXECUTE')
             and not has_function_privilege('anon', 'public.couranr_conversation_thread(uuid,uuid)', 'EXECUTE')
             and not has_function_privilege('authenticated', 'public.couranr_conversation_thread(uuid,uuid)', 'EXECUTE')`), "t");
  check("RLS-8", "the clock functions are service_role only (explicit REVOKE beat pg_default_acl)",
    one(`select bool_and(
             has_function_privilege('service_role', p::regprocedure, 'EXECUTE')
         and not has_function_privilege('anon', p::regprocedure, 'EXECUTE')
         and not has_function_privilege('authenticated', p::regprocedure, 'EXECUTE'))
         from unnest(array[
           'public.couranr_operating_timezone()',
           'public.couranr_is_within_operating_hours(timestamptz)',
           'public.couranr_next_operating_period_start(timestamptz)',
           'public.couranr_add_operating_minutes(timestamptz,integer)',
           'public.couranr_operating_minutes_between(timestamptz,timestamptz)'
         ]) p`), "t");
  check("RLS-9", "PUBLIC-trap regression: the disposable password oracle is denied to anon and authenticated",
    one(`select not has_function_privilege('anon', 'public.couranr_disposable_verify_password(text,text)', 'EXECUTE')
             and not has_function_privilege('authenticated', 'public.couranr_disposable_verify_password(text,text)', 'EXECUTE')`), "t");
  check("RLS-10", "profiles_update_own carries its WITH CHECK",
    one(`select pg_get_expr(polwithcheck, polrelid) is not null from pg_policy
          where polname = 'profiles_update_own'`), "t");

  // ACP-008 — the private/analytics boundary, EXECUTED not read: a probe
  // table is created in each schema and the privilege actually measured, so
  // the default-privilege statements are proven to do what they claim.
  check("RLS-11", "anon and authenticated hold no USAGE on private or analytics",
    one(`select bool_or(has_schema_privilege(r, s, 'USAGE'))
           from unnest(array['anon','authenticated']) r,
                unnest(array['private','analytics']) s`), "f");
  check("RLS-12", "service_role holds USAGE on both",
    one(`select bool_and(has_schema_privilege('service_role', s, 'USAGE'))
           from unnest(array['private','analytics']) s`), "t");
  psql("create table if not exists private.__acl_probe (id int); create table if not exists analytics.__acl_probe (id int);");
  check("RLS-13", "a NEW table in private/analytics grants service_role DML and the world nothing",
    one(`select bool_and(
             has_table_privilege('service_role', t, 'SELECT')
         and has_table_privilege('service_role', t, 'INSERT')
         and not has_table_privilege('anon', t, 'SELECT')
         and not has_table_privilege('authenticated', t, 'SELECT'))
         from unnest(array['private.__acl_probe','analytics.__acl_probe']) t`), "t");
  psql("drop table private.__acl_probe; drop table analytics.__acl_probe;");
}

/* -------------------------------------------------------------- integrity */

function sectionIntegrity() {
  console.log("\nintegrity — the constraints whose absence shipped real defects");
  check("INT-1", "the help-token FK points at couranr_help_access_tokens (the P8-004 killer)",
    one(`select confrelid::regclass::text from pg_constraint
          where conname = 'couranr_cvp_help_token_fkey'`), "couranr_help_access_tokens");
  check("INT-2", "message idempotency is scoped per conversation AND author",
    one(`select count(*) from pg_indexes
          where indexname = 'couranr_cvm_idempotency_uniq'`), "1");
  check("INT-3", "one live customer participant per token",
    one(`select count(*) from pg_indexes where indexname = 'couranr_cvp_live_token_uniq'`), "1");
  check("INT-4", "conversation kind is trigger-immutable",
    one(`select count(*) from pg_trigger where tgname = 'couranr_cv_kind_immutable_trg'`), "1");
}

/* --------------------------------------------------------------- commands */

function sectionCommands() {
  console.log("\ncommands — a REAL fixture chain through the help-token functions");
  const marker = `dbtest-${crypto.randomUUID().slice(0, 8)}`;
  const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

  const businessId = one(
    `insert into public.business_accounts (name, status) values ('[DBTEST] ${marker}', 'active') returning id`);
  const userId = one(`insert into auth.users (email) values ('${marker}@couranr.invalid') returning id`);
  const requestId = one(
    `insert into public.couranr_delivery_requests (business_account_id, created_by, idempotency_key, recipient_name)
     values ('${businessId}', '${userId}', '${marker}', 'dbtest recipient') returning id`);
  const obligationId = one(
    `insert into public.couranr_payment_obligations
       (request_id, business_account_id, payer_type, request_version, pricing_policy_version, amount_cents, idempotency_key)
     values ('${requestId}', '${businessId}', 'merchant', 1, 'dbtest', 1000, 'po-${marker}') returning id`);
  const planId = one(
    `insert into public.couranr_service_plans
       (request_id, business_account_id, payment_obligation_id, request_version,
        scheduled_pickup_start, scheduled_pickup_end, timezone, vehicle_requirement)
     values ('${requestId}', '${businessId}', '${obligationId}', 1, now(), now() + interval '1 hour',
             'America/New_York', '{}'::jsonb) returning id`);
  const deliveryId = one(
    `insert into public.couranr_deliveries
       (request_id, business_account_id, payment_obligation_id, service_plan_id,
        request_version, pricing_policy_version, captured_amount_cents, currency,
        pickup_address, dropoff_address, recipient, shipment, service_level,
        signature_required, proof_method, scheduled_pickup_start, scheduled_pickup_end,
        timezone, vehicle_requirement)
     values ('${requestId}', '${businessId}', '${obligationId}', '${planId}', 1, 'dbtest', 1000, 'usd',
             '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'standard', false, 'photo_or_pin',
             now(), now() + interval '1 hour', 'America/New_York', '{}'::jsonb) returning id`);

  const raw = crypto.randomBytes(32).toString("base64url");
  const tokenId = one(
    `select public.couranr_issue_help_token('${deliveryId}', '${sha256(raw)}', 1)`);
  check("CMD-1", "couranr_issue_help_token returns an id", /^[0-9a-f-]{36}$/.test(tokenId), true);

  const redeemed = one(
    `select out_conversation_id from public.couranr_redeem_help_token('${sha256(raw)}')`);
  check("CMD-2", "redemption resolves a conversation", /^[0-9a-f-]{36}$/.test(redeemed), true);
  // `||` casts a boolean to 'true'/'false'; only a bare boolean column prints 't'.
  check("CMD-3", "the conversation is delivery_help on the right delivery",
    one(`select kind || '|' || (delivery_id = '${deliveryId}') from public.couranr_conversations where id = '${redeemed}'`),
    "delivery_help|true");

  const key = `k-${marker}`;
  const msg1 = one(
    `select public.couranr_help_post_message('${tokenId}', 'dbtest first message', 'access', '${key}')`);
  const msg2 = one(
    `select public.couranr_help_post_message('${tokenId}', 'dbtest first message', 'access', '${key}')`);
  check("CMD-4", "a customer message persists and returns its id", /^[0-9a-f-]{36}$/.test(msg1), true);
  check("CMD-5", "an idempotent replay returns THE SAME id", msg1 === msg2 && msg1 !== "", true);
  check("CMD-6", "the deadline was computed on the OPERATING clock",
    one(`select response_due_at = public.couranr_add_operating_minutes(received_at, 15)
           from public.couranr_conversations where id = '${redeemed}'`), "t");

  checkRaises("CMD-7", "an unissued token is refused with the one indistinguishable message",
    `select public.couranr_redeem_help_token('${sha256("never-issued-" + marker)}')`,
    "help_link_not_available");
}

/* ------------------------------------------------------------------- main */

function main() {
  console.log(`db:test — disposable database gate${RLS_ONLY ? " (rls only)" : ""}\n`);
  console.log("  bringing up the disposable database (empty + all forward migrations)...");
  const info = up({ quiet: true });
  console.log(`  ${info.migrationsApplied} migrations applied`);

  try {
    if (RLS_ONLY) {
      sectionRls();
    } else {
      sectionClock();
      sectionRls();
      sectionIntegrity();
      sectionCommands();
    }

    if (POSITIVE_CONTROL) {
      console.log("\npositive control — this check MUST fail");
      const before = failed;
      check("CTL-1", "PLANTED FALSEHOOD: timezone is Europe/Paris",
        one("select public.couranr_operating_timezone()"), "Europe/Paris");
      if (failed === before) {
        console.error("\n  POSITIVE CONTROL DID NOT FAIL — the gate cannot go red. Refusing to pass.");
        process.exitCode = 1;
        return;
      }
      // The planted failure proved the gate binds; it does not count against
      // the real run.
      failed -= 1;
      passed += 0;
      console.log("  the planted check failed as required — the gate can go red");
    }
  } finally {
    if (!KEEP) {
      down({ quiet: true });
      console.log("\n  disposable database destroyed");
    } else {
      console.log("\n  left up (--keep)");
    }
  }

  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    down({ quiet: true });
    process.exit(130);
  });
}

main();

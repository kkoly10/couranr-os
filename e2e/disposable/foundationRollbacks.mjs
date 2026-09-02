#!/usr/bin/env node
/** Executable rollback/forward-repair safety matrix for Foundation Gate A. */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { down, psql, up } from "./up.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const ROLLBACKS = path.join(ROOT, "supabase/rollbacks");
const dockerContainer = process.env.COURANR_FOUNDATION_DOCKER_CONTAINER || "";
const dockerDb = "couranr_foundation_rollbacks";
const files = readdirSync(MIGRATIONS)
  .filter((file) => /^\d{14}_.+\.sql$/.test(file) && !file.includes(".rollback."))
  .sort();

const M1 = "20260901051549_fnd_a_m1_universal_requester.sql";
const M2 = "20260901051555_fnd_a_m2_immutable_quote_schema.sql";
const M3 = "20260901051601_fnd_a_m3_deterministic_quote_backfill.sql";
const M4 = "20260901051609_fnd_a_m4_command_cutover.sql";
const M5 = "20260901051617_fnd_a_m5_invariant_cutover.sql";
const M6 = "20260901051627_fnd_a_m6_single_destination.sql";

let ownsBareDatabase = false;
let passed = 0;
let failed = 0;

function dockerSql(sql, db = dockerDb) {
  return execFileSync(
    "docker",
    ["exec", "-i", dockerContainer, "psql", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", db],
    { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
  );
}

const raw = (sql) => (dockerContainer ? dockerSql(sql) : psql(sql));
const one = (sql) => raw(sql).trim();
const apply = (directory, filename) => raw(readFileSync(path.join(directory, filename), "utf8"));
const rollback = (migration) => apply(ROLLBACKS, migration.replace(/\.sql$/, ".rollback.sql"));

function check(id, description, actual, expected) {
  const ok = String(actual) === String(expected);
  ok ? passed++ : failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${description}` +
    (ok ? "" : ` [expected ${JSON.stringify(String(expected))}, got ${JSON.stringify(String(actual))}]`));
}

function refuses(id, description, action, expected) {
  let actual = "NO ERROR";
  try {
    action();
  } catch (error) {
    const message = String(error.stderr || error.message || error);
    actual = message.includes(expected) ? expected : `OTHER: ${message.slice(0, 180)}`;
  }
  check(id, description, actual, expected);
}

class StopReplay extends Error {}

function reset(stopBefore = null) {
  if (dockerContainer) {
    execFileSync("docker", ["exec", dockerContainer, "dropdb", "--if-exists", "--force", "-U", "postgres", dockerDb]);
    execFileSync("docker", ["exec", dockerContainer, "createdb", "-U", "postgres", dockerDb]);
    dockerSql(readFileSync(path.join(ROOT, "e2e/disposable/bootstrap.sql"), "utf8"));
    for (const file of files) {
      if (file === stopBefore) break;
      apply(MIGRATIONS, file);
    }
    return;
  }

  try {
    up({
      quiet: true,
      beforeMigration: ({ filename }) => {
        if (filename === stopBefore) throw new StopReplay();
      },
    });
  } catch (error) {
    if (!(error instanceof StopReplay)) throw error;
  }
  ownsBareDatabase = true;
}

function main() {
  console.log("\npre-semantic additive rollback and replay");
  reset(M2);
  rollback(M1);
  check("ROLL-M1", "M1 reverses before consumer semantics exist",
    one("select count(*) from information_schema.columns where table_schema='public' and table_name='couranr_delivery_requests' and column_name='requester_kind'"), "0");
  apply(MIGRATIONS, M1);
  check("ROLL-M1", "M1 reapplies after safe reversal",
    one("select count(*) from information_schema.columns where table_schema='public' and table_name='couranr_delivery_requests' and column_name='requester_kind'"), "1");

  reset(M3);
  rollback(M2);
  check("ROLL-M2", "M2 removes unused additive quote schema",
    one("select to_regclass('public.couranr_quote_versions') is null"), "t");
  apply(MIGRATIONS, M2);
  check("ROLL-M2", "M2 reapplies after safe reversal",
    one("select to_regclass('public.couranr_quote_versions') is not null"), "t");

  raw(`
    insert into auth.users(id,email) values
      ('61000000-0000-4000-8000-000000000001','tenancy-guard@example.test');
    insert into public.business_accounts(id,name,slug,created_by) values
      ('62000000-0000-4000-8000-000000000001','Request Tenant','request-tenant',
       '61000000-0000-4000-8000-000000000001'),
      ('62000000-0000-4000-8000-000000000002','Wrong Payment Tenant','wrong-payment-tenant',
       '61000000-0000-4000-8000-000000000001');
    insert into public.couranr_delivery_requests(
      id,business_account_id,created_by,idempotency_key,source
    ) values (
      '63000000-0000-4000-8000-000000000001',
      '62000000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000001','tenancy-guard','merchant_portal'
    );
    insert into public.couranr_payment_obligations(
      request_id,business_account_id,payer_type,request_version,
      pricing_policy_version,amount_cents,idempotency_key
    ) values (
      '63000000-0000-4000-8000-000000000001',
      '62000000-0000-4000-8000-000000000002','merchant',1,
      'legacy-tenancy-guard',1000,'tenancy-guard'
    );
  `);
  refuses("FND-MIG-01", "M3 hard-refuses an obligation mapped across business tenants",
    () => apply(MIGRATIONS, M3), "unmappable payment obligation: request missing or tenancy disagrees");

  reset(M4);
  rollback(M3);
  check("ROLL-M3", "M3 removes only legacy backfill authority before runtime use",
    one("select to_regprocedure('private.couranr_foundation_backfill_quote_versions()') is null"), "t");
  apply(MIGRATIONS, M3);
  check("ROLL-M3", "M3 deterministic backfill reapplies",
    one("select count(*) from public.couranr_quote_versions"), "0");

  reset();
  rollback(M6);
  rollback(M5);
  check("ROLL-M5", "M5 guards reverse before semantic use",
    one("select to_regprocedure('public.couranr_foundation_integrity()') is null"), "t");
  check("ROLL-M6", "M6 single-destination column reverses before semantic use",
    one("select count(*) from information_schema.columns where table_schema='public' and table_name='couranr_delivery_requests' and column_name='single_destination_contract'"), "0");
  apply(MIGRATIONS, M5);
  apply(MIGRATIONS, M6);
  check("ROLL-M5/6", "M5 and M6 reapply cleanly",
    one("select count(*) from public.couranr_foundation_integrity()"), "0");
  refuses("FND-MIG-02", "M4 authority cutover never restores mutable commercial authority",
    () => rollback(M4), "refusing destructive authority rollback");

  /* ─────────────────────────────────────────────────────────────────────
     M6 REFUSES UNCLASSIFIED HISTORICAL STOPS.

     M6 used to add the column and then set
     `single_destination_contract = (additional_stops = 0)`, so a historical
     row with a positive value silently became `false`, satisfied the CHECK,
     and the migration reported success. Nothing recorded that a human had
     decided anything about that row — the ambiguity simply became data.

     These three cases are the contract. B is the one that matters: it proves
     the refusal is total, that the schema does not half-apply, and that the
     offending rows are left exactly as they were rather than being edited or
     deleted to get past the guard.
     ───────────────────────────────────────────────────────────────────── */
  console.log("\nM6 unclassified historical additional_stops");

  const stopsFixture = (stops, key) => `
    insert into auth.users(id,email) values
      ('73000000-0000-4000-8000-000000000001','stops@example.test')
      on conflict do nothing;
    insert into public.business_accounts(id,name,slug,created_by) values
      ('74000000-0000-4000-8000-000000000001','Stops Fixture','stops-fixture',
       '73000000-0000-4000-8000-000000000001')
      on conflict do nothing;
    set role service_role;
    select id from public.couranr_create_delivery_request_draft(
      '74000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000001','${key}','merchant_portal',
      'not_confirmed','merchant','Recipient','555-0100','recipient@example.test',
      5,10,${stops},'standard',false,'photo_or_pin',
      '{"line1":"10 Market St"}'::jsonb,'{"line1":"20 Main St"}'::jsonb,false,
      'estimated','stops-v1',2500,3,2,
      '[{"code":"base","amountCents":2500}]'::jsonb,'[]'::jsonb);
    reset role;
  `;

  const m6ColumnCount = () =>
    one("select count(*) from information_schema.columns where table_schema='public'" +
        " and table_name='couranr_delivery_requests' and column_name='single_destination_contract'");

  // ── A. a historical database whose stops are all zero: M6 applies ──────
  reset(M6);
  raw(stopsFixture(0, "stops-zero"));
  check("M6-A0", "case A fixture is a real zero-stop historical row",
    one("select count(*) from public.couranr_delivery_requests where additional_stops=0"), "1");
  apply(MIGRATIONS, M6);
  check("M6-A1", "A: M6 succeeds against an all-zero history", m6ColumnCount(), "1");
  check("M6-A2", "A: every historical row satisfies the single-destination contract",
    one("select count(*) from public.couranr_delivery_requests where single_destination_contract is not true"), "0");

  // ── B. a historical database with a positive stop: M6 HARD REFUSES ─────
  reset(M6);
  raw(stopsFixture(2, "stops-positive"));
  const beforeB = one(
    "select count(*)||'|'||coalesce(sum(additional_stops),0)||'|'||coalesce(max(updated_at)::text,'-')" +
    " from public.couranr_delivery_requests");
  refuses("M6-B1", "B: M6 hard-refuses a history carrying additional_stops > 0",
    () => apply(MIGRATIONS, M6), "gate_a_m6_refuses_unclassified_additional_stops");
  check("M6-B2", "B: the schema does not partially apply — no column", m6ColumnCount(), "0");
  check("M6-B3", "B: the schema does not partially apply — no constraint",
    one("select count(*) from pg_constraint where conname='couranr_dr_single_destination_chk'"), "0");
  check("M6-B4", "B: the schema does not partially apply — no trigger",
    one("select count(*) from pg_trigger where tgname='couranr_dr_single_destination_trg'"), "0");
  check("M6-B5", "B: not one row is changed, deleted, or grandfathered",
    one("select count(*)||'|'||coalesce(sum(additional_stops),0)||'|'||coalesce(max(updated_at)::text,'-')" +
        " from public.couranr_delivery_requests"), beforeB);
  check("M6-B6", "B: the offending row is still exactly as it was",
    one("select additional_stops from public.couranr_delivery_requests where idempotency_key='stops-positive'"), "2");

  /* The refusal has to NAME the rows, or an operator cannot act on it — but by
     safe metadata only. A migration failure is precisely when everyone reads
     the log, so recipient identity must not be in it. */
  let m6Detail = "";
  try {
    apply(MIGRATIONS, M6);
  } catch (error) {
    m6Detail = String(error.stderr || error.message || error);
  }
  check("M6-B7", "B: the refusal reports a count and a date range",
    /1 canonical request\(s\) carry additional_stops > 0/.test(m6Detail) &&
      /created_at .* \.\. /.test(m6Detail), "true");
  check("M6-B8", "B: the refusal reports lifecycle state and source",
    /request_state: \w+/.test(m6Detail) && /source: \w+/.test(m6Detail), "true");
  check("M6-B9", "B: the refusal leaks no recipient PII",
    /Recipient|555-0100|recipient@example\.test|Market St|Main St/.test(m6Detail), "false");

  /* The guard must be the reason, not a coincidence. Classify the row the way
     a reviewed mechanism would — by resolving it to a single destination —
     and M6 then applies. This is the ONLY thing the test does to that row,
     and it does it after proving the refusal, never to get past it. */
  raw("set role service_role;" +
      " update public.couranr_delivery_requests set additional_stops=0" +
      " where idempotency_key='stops-positive'; reset role;");
  apply(MIGRATIONS, M6);
  check("M6-B10", "B: POSITIVE CONTROL — M6 applies once the row is classified",
    m6ColumnCount(), "1");

  // ── C. after M6, the contract holds for new rows ───────────────────────
  refuses("M6-C1", "C: a new request with a positive stop is refused",
    () => raw(stopsFixture(1, "stops-after-m6")),
    "new_delivery_request_requires_one_destination");
  raw(stopsFixture(0, "stops-after-m6-zero"));
  check("M6-C2", "C: a new zero-stop request succeeds",
    one("select single_destination_contract from public.couranr_delivery_requests" +
        " where idempotency_key='stops-after-m6-zero'"), "t");
  refuses("M6-C3", "C: an existing row cannot be edited back to multi-stop",
    () => raw("set role service_role;" +
              " update public.couranr_delivery_requests set additional_stops=3" +
              " where idempotency_key='stops-after-m6-zero'; reset role;"),
    "additional_stops_is_historical_only");

  console.log("\npost-semantic destructive rollback refusal");
  reset();
  raw(`
    insert into auth.users(id,email) values
      ('71000000-0000-4000-8000-000000000001','rollback@example.test');
    insert into public.business_accounts(id,name,slug,created_by) values
      ('72000000-0000-4000-8000-000000000001','Rollback Fixture','rollback-fixture',
       '71000000-0000-4000-8000-000000000001');
    set role service_role;
    select id from public.couranr_create_routed_delivery_request_draft(
      '72000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000001','runtime-quote','merchant_portal',
      'not_confirmed','merchant','Recipient','555-0100','recipient@example.test',
      10,0,'standard',false,'photo_or_pin',
      '{"googlePlaceId":"place-pickup","formattedAddress":"10 Market St, Stafford, VA 22554, USA","line1":"10 Market St","line2":null,"city":"Stafford","region":"VA","postalCode":"22554","countryCode":"US","latitude":38.422,"longitude":-77.408,"addressSource":"google_places_new","instructions":null}'::jsonb,
      '{"googlePlaceId":"place-dropoff","formattedAddress":"20 Main St, Stafford, VA 22554, USA","line1":"20 Main St","line2":null,"city":"Stafford","region":"VA","postalCode":"22554","countryCode":"US","latitude":38.423,"longitude":-77.409,"addressSource":"google_places_new","instructions":null}'::jsonb,false,
      8047,600,600,0,'google_routes_v2','available_for_request',null,
      'estimated','couranr-pricing-v2-2026-09-01',2500,3,2,
      '[{"code":"base","amountCents":2500}]'::jsonb,'[]'::jsonb,
      p_restricted_class => 'none');
    insert into public.couranr_delivery_requests(
      requester_kind,business_account_id,created_by,consumer_contact_snapshot,
      idempotency_scope,idempotency_key,source
    ) values (
      'consumer',null,null,'{"email":"guest@example.test"}',
      'consumer:rollback-scope-0001','consumer-row','consumer_send'
    );
    reset role;
  `);
  refuses("FND-MIG-02", "M1 preserves live consumer requester history",
    () => rollback(M1), "consumer requester history exists");
  refuses("FND-MIG-02", "M2 preserves live immutable quote history",
    () => rollback(M2), "immutable quote history exists");
  refuses("FND-MIG-02", "M3 preserves runtime quote history",
    () => rollback(M3), "runtime quote history exists");
  refuses("FND-MIG-02", "M5 preserves invariant guards after runtime quote use",
    () => rollback(M5), "runtime immutable quote history exists");
  refuses("FND-MIG-02", "M6 preserves one-destination semantics after runtime quote use",
    () => rollback(M6), "runtime quotes exist under the one-destination doctrine");

  console.log(`\nFoundation Gate A rollbacks: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

try {
  main();
} finally {
  if (dockerContainer) {
    try {
      execFileSync("docker", ["exec", dockerContainer, "dropdb", "--if-exists", "--force", "-U", "postgres", dockerDb]);
    } catch {
      // Disposable cleanup only.
    }
  } else if (ownsBareDatabase) {
    down({ quiet: true });
  }
}

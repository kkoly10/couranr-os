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

const M1 = "20260831035450_fnd_a_m1_universal_requester.sql";
const M2 = "20260831035452_fnd_a_m2_immutable_quote_schema.sql";
const M3 = "20260831035454_fnd_a_m3_deterministic_quote_backfill.sql";
const M4 = "20260831035456_fnd_a_m4_command_cutover.sql";
const M5 = "20260831035458_fnd_a_m5_invariant_cutover.sql";
const M6 = "20260831035500_fnd_a_m6_single_destination.sql";

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

  console.log("\npost-semantic destructive rollback refusal");
  reset();
  raw(`
    insert into auth.users(id,email) values
      ('71000000-0000-4000-8000-000000000001','rollback@example.test');
    insert into public.business_accounts(id,name,slug,created_by) values
      ('72000000-0000-4000-8000-000000000001','Rollback Fixture','rollback-fixture',
       '71000000-0000-4000-8000-000000000001');
    set role service_role;
    select id from public.couranr_create_delivery_request_draft(
      '72000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000001','runtime-quote','merchant_portal',
      'not_confirmed','merchant','Recipient','555-0100','recipient@example.test',
      5,10,0,'standard',false,'photo_or_pin',
      '{"line1":"10 Market St"}'::jsonb,'{"line1":"20 Main St"}'::jsonb,false,
      'estimated','rollback-v1',2500,3,2,
      '[{"code":"base","amountCents":2500}]'::jsonb,'[]'::jsonb);
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

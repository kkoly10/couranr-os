#!/usr/bin/env node
/** Gate A historical backfill matrix, including deliberately imperfect data. */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { up, down, psql } from "./up.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const M3 = "20260831035454_fnd_a_m3_deterministic_quote_backfill.sql";
const dockerContainer = process.env.COURANR_FOUNDATION_DOCKER_CONTAINER || "";
const dockerDb = "couranr_foundation_backfill";
let ownsBareDatabase = false;
let passed = 0;
let failed = 0;

function dockerSql(sql, db = dockerDb) {
  return execFileSync("docker", ["exec", "-i", dockerContainer, "psql", "-qAt",
    "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", db],
  { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
}

const query = (sql) => dockerContainer ? dockerSql(sql) : psql(sql);
const one = (sql) => query(sql).trim();

function check(id, description, actual, expected) {
  const ok = String(actual) === String(expected);
  ok ? passed++ : failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${description}` +
    (ok ? "" : ` [expected ${JSON.stringify(String(expected))}, got ${JSON.stringify(String(actual))}]`));
}

const USER = "51000000-0000-4000-8000-000000000001";
const BUSINESS = "52000000-0000-4000-8000-000000000001";
const NORMAL = "53000000-0000-4000-8000-000000000001";
const PARTIAL = "53000000-0000-4000-8000-000000000002";
const MISMATCH = "53000000-0000-4000-8000-000000000003";
const HISTORICAL = "53000000-0000-4000-8000-000000000004";
const OBLIGATION = "54000000-0000-4000-8000-000000000001";
const PLAN = "55000000-0000-4000-8000-000000000001";
const DELIVERY = "56000000-0000-4000-8000-000000000001";

const seedSql = `
  insert into auth.users(id,email) values ('${USER}','backfill@example.test');
  insert into public.business_accounts(id,name,slug,created_by)
    values ('${BUSINESS}','Backfill Fixture','backfill-fixture','${USER}');

  insert into public.couranr_delivery_requests(
    id,business_account_id,created_by,idempotency_key,source,created_at,updated_at,
    requester_kind,idempotency_scope,quote_status,pricing_policy_version,
    delivery_subtotal_cents,included_loaded_miles,billable_loaded_miles,quote_line_items,
    pickup_address,dropoff_address,loaded_miles,weight_lb,payer_type)
  values
    ('${NORMAL}','${BUSINESS}','${USER}','legacy-normal','merchant_portal',
      '2026-01-01Z','2026-01-01Z','business','ignored','estimated','legacy-v1',1000,3,2,
      '[{"code":"base","amountCents":1000}]',
      '{"line1":"Normal pickup"}','{"line1":"Normal dropoff"}',5,10,'merchant'),
    ('${PARTIAL}','${BUSINESS}','${USER}','legacy-partial','merchant_portal',
      '2026-01-02Z','2026-01-02Z','business','ignored','estimated','legacy-v1',1200,3,2,
      '[]','{"line1":"Partial pickup"}','{"line1":"Partial dropoff"}',5,10,'merchant'),
    ('${MISMATCH}','${BUSINESS}','${USER}','legacy-mismatch','merchant_portal',
      '2026-01-03Z','2026-01-03Z','business','ignored','estimated','legacy-v1',1300,3,2,
      '[{"code":"base","amountCents":1200}]',
      '{"line1":"Mismatch pickup"}','{"line1":"Mismatch dropoff"}',5,10,'merchant'),
    ('${HISTORICAL}','${BUSINESS}','${USER}','legacy-payment','merchant_portal',
      '2026-01-04Z','2026-01-06Z','business','ignored','estimated','current-v2',1500,3,2,
      '[{"code":"base","amountCents":1500}]',
      '{"line1":"Current pickup"}','{"line1":"Current dropoff"}',5,10,'merchant');

  update public.couranr_delivery_requests set
    request_state='confirmed',review_state='accepted_as_quoted',readiness_state='ready',
    submitted_at='2026-01-04 12:00Z'
  where id='${HISTORICAL}';

  insert into public.couranr_payment_obligations(
    id,request_id,business_account_id,payer_type,request_version,
    pricing_policy_version,amount_cents,currency,payment_state,provider,
    provider_payment_intent_id,idempotency_key,authorized_at,capture_requested_at,
    captured_at,captured_amount_cents,created_at,updated_at)
  values ('${OBLIGATION}','${HISTORICAL}','${BUSINESS}','merchant',1,
    'old-v1',1400,'usd','captured','stripe','pi_legacy_backfill','legacy-payment',
    '2026-01-04 12:10Z','2026-01-04 12:20Z','2026-01-04 12:21Z',1400,
    '2026-01-04 12:05Z','2026-01-04 12:21Z');

  insert into public.couranr_service_plans(
    id,request_id,business_account_id,payment_obligation_id,request_version,
    scheduled_pickup_start,scheduled_pickup_end,timezone,vehicle_requirement,
    plan_state,confirmed_by,confirmed_at,created_at,updated_at)
  values ('${PLAN}','${HISTORICAL}','${BUSINESS}','${OBLIGATION}',1,
    '2026-01-05 14:00Z','2026-01-05 15:00Z','America/New_York',
    '{"vehicleClass":"car","maxPayloadLb":100}','confirmed','${USER}',
    '2026-01-04 12:15Z','2026-01-04 12:15Z','2026-01-04 12:15Z');

  insert into public.couranr_deliveries(
    id,request_id,business_account_id,payment_obligation_id,service_plan_id,
    request_version,pricing_policy_version,captured_amount_cents,currency,
    pickup_address,dropoff_address,recipient,shipment,service_level,
    signature_required,proof_method,scheduled_pickup_start,scheduled_pickup_end,
    timezone,vehicle_requirement,fulfillment_state,created_at,updated_at)
  values ('${DELIVERY}','${HISTORICAL}','${BUSINESS}','${OBLIGATION}','${PLAN}',1,
    'old-v1',1400,'usd','{"line1":"Paid pickup"}','{"line1":"Paid dropoff"}',
    '{"name":"Historical"}','{"loadedMiles":5,"weightLb":10,"additionalStops":0}',
    'standard',false,'photo_or_pin','2026-01-05 14:00Z','2026-01-05 15:00Z',
    'America/New_York','{"vehicleClass":"car","maxPayloadLb":100}',
    'scheduled','2026-01-04 12:22Z','2026-01-04 12:22Z');
`;

function prepareDocker() {
  dockerSql(`drop database if exists ${dockerDb} with (force); create database ${dockerDb};`, "postgres");
  dockerSql(readFileSync(path.join(ROOT, "e2e/disposable/bootstrap.sql"), "utf8"));
  const migrations = readdirSync(path.join(ROOT, "supabase/migrations"))
    .filter((file) => /^\d{14}_.+\.sql$/.test(file)).sort();
  for (const filename of migrations) {
    if (filename === M3) dockerSql(seedSql);
    dockerSql(readFileSync(path.join(ROOT, "supabase/migrations", filename), "utf8"));
  }
}

function main() {
  if (dockerContainer) {
    prepareDocker();
  } else {
    up({ quiet: true, beforeMigration: ({ filename, psql: run }) => {
      if (filename === M3) run(seedSql);
    }});
    ownsBareDatabase = true;
  }

  console.log("\nhistorical preservation and classification");
  check("FND-REQ-01", "existing request IDs, states and amounts survive", one(`
    select count(*)||':'||min(request_state)||':'||sum(delivery_subtotal_cents)
      from public.couranr_delivery_requests
     where id in ('${NORMAL}','${PARTIAL}','${MISMATCH}','${HISTORICAL}')`), "4:confirmed:5000");
  check("FND-MIG-01", "consistent request quote is verified", one(`
    select provenance_state from public.couranr_quote_versions where request_id='${NORMAL}'`), "verified");
  check("FND-MIG-01", "incomplete evidence remains legacy_partial", one(`
    select provenance_state from public.couranr_quote_versions where request_id='${PARTIAL}'`), "legacy_partial");
  check("FND-MIG-01", "arithmetic disagreement remains legacy_mismatch", one(`
    select provenance_state from public.couranr_quote_versions where request_id='${MISMATCH}'`), "legacy_mismatch");
  check("FND-MIG-01", "mismatch subtotal and original line items were not rewritten", one(`
    select subtotal_cents||':'||(legacy_evidence->'originalLineItems'->0->>'amountCents')
      from public.couranr_quote_versions where request_id='${MISMATCH}'`), "1300:1200");
  check("FND-MIG-01", "older payment maps to its old amount/policy quote, not current request", one(`
    select q.subtotal_cents||':'||q.pricing_policy_version||':'||q.quote_number
      from public.couranr_payment_obligations o join public.couranr_quote_versions q on q.id=o.quote_version_id
     where o.id='${OBLIGATION}'`), "1400:old-v1:1");
  check("FND-MIG-01", "request current pointer maps its newer representation", one(`
    select q.subtotal_cents||':'||q.pricing_policy_version||':'||q.quote_number
      from public.couranr_delivery_requests r join public.couranr_quote_versions q on q.id=r.current_quote_version_id
     where r.id='${HISTORICAL}'`), "1500:current-v2:2");
  check("FND-DLV-01", "historical delivery, plan and obligation share exact quote", one(`
    select (d.quote_version_id=p.quote_version_id and d.quote_version_id=o.quote_version_id)::text
      from public.couranr_deliveries d join public.couranr_service_plans p on p.id=d.service_plan_id
      join public.couranr_payment_obligations o on o.id=d.payment_obligation_id where d.id='${DELIVERY}'`), "true");
  check("FND-MIG-01", "historical captured amount is untouched", one(`
    select amount_cents||':'||captured_amount_cents from public.couranr_payment_obligations where id='${OBLIGATION}'`), "1400:1400");

  const before = one(`select count(*)||':'||md5(string_agg(row(q.*)::text,'' order by q.request_id,q.quote_number))
    from public.couranr_quote_versions q`);
  one(`select private.couranr_foundation_backfill_quote_versions()`);
  const after = one(`select count(*)||':'||md5(string_agg(row(q.*)::text,'' order by q.request_id,q.quote_number))
    from public.couranr_quote_versions q`);
  check("FND-MIG-01", "backfill replay is idempotent byte-for-byte", after, before);
  check("INTEGRITY", "backfilled historical fixture passes permanent integrity probe", one(`
    select count(*) from public.couranr_foundation_integrity()`), "0");

  console.log(`\nFoundation Gate A backfill: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

try {
  main();
} finally {
  if (ownsBareDatabase) down({ quiet: true });
  if (dockerContainer && !process.argv.includes("--keep")) {
    try { dockerSql(`drop database if exists ${dockerDb} with (force);`, "postgres"); } catch {}
  }
}

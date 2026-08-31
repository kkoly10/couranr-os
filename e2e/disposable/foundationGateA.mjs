#!/usr/bin/env node
/**
 * Foundation Gate A against a disposable PostgreSQL database.
 *
 * By default this uses the repository's bare-Postgres harness. On a developer
 * machine that already replayed the migrations into an isolated Docker
 * container, set COURANR_FOUNDATION_DOCKER_CONTAINER to that exact container
 * name. This suite never connects to the configured Supabase project.
 */
import { execFileSync } from "node:child_process";
import { up, down, psql } from "./up.mjs";

const dockerContainer = process.env.COURANR_FOUNDATION_DOCKER_CONTAINER || "";
const keep = process.argv.includes("--keep") || Boolean(dockerContainer);
let ownsDatabase = false;
let passed = 0;
let failed = 0;

function raw(sql) {
  if (!dockerContainer) return psql(sql);
  return execFileSync(
    "docker",
    ["exec", "-i", dockerContainer, "psql", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "couranr"],
    { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
  );
}

const service = (sql) => raw(`set role service_role;\n${sql}`);
const one = (sql) => service(sql).trim();

function check(id, description, actual, expected) {
  const ok = String(actual) === String(expected);
  ok ? passed++ : failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${description}` +
    (ok ? "" : ` [expected ${JSON.stringify(String(expected))}, got ${JSON.stringify(String(actual))}]`));
}

function raises(id, description, sql, message) {
  let actual = "NO ERROR";
  try {
    service(sql);
  } catch (error) {
    const text = String(error.stderr || error.message || error);
    actual = text.includes(message) ? message : `OTHER: ${text.slice(0, 180)}`;
  }
  check(id, description, actual, message);
}

const USER = "10000000-0000-4000-8000-000000000001";
const BUSINESS = "20000000-0000-4000-8000-000000000001";
const CUSTOMER_A = "30000000-0000-4000-8000-000000000001";
const CUSTOMER_B = "30000000-0000-4000-8000-000000000002";

const address = (line1) =>
  `jsonb_build_object('line1','${line1}','city','Stafford','region','VA','postalCode','22554')`;
const items = (amount) =>
  `jsonb_build_array(jsonb_build_object('code','base','label','Base delivery','quantity',1,'unitAmountCents',${amount},'amountCents',${amount}))`;

function requestVersion(requestId) {
  return Number(one(`select version from public.couranr_delivery_requests where id='${requestId}'`));
}

function currentQuote(requestId) {
  return one(`select current_quote_version_id from public.couranr_delivery_requests where id='${requestId}'`);
}

function createBusinessRequest(key, amount = 2500) {
  return one(`
    select id from public.couranr_create_delivery_request_draft(
      '${BUSINESS}','${USER}','${key}','merchant_portal','not_confirmed','merchant',
      'Recipient','555-0100','recipient@example.test',5,10,0,'standard',false,
      'photo_or_pin',${address("10 Market St")},${address("20 Main St")},false,
      'estimated','foundation-test-v1',${amount},3,2,${items(amount)},'[]'::jsonb
    )
  `);
}

function submitAndAccept(requestId) {
  service(`select id from public.couranr_submit_delivery_request_v2(
    '${requestId}','${BUSINESS}',${requestVersion(requestId)},'${USER}',true)`);
  service(`select id from public.couranr_accept_delivery_request_as_quoted(
    '${requestId}','${BUSINESS}',${requestVersion(requestId)},'${USER}')`);
}

function authorize(requestId, key, intent, event) {
  const obligation = one(`select id from public.couranr_create_payment_obligation(
    '${requestId}','${BUSINESS}','${key}')`);
  service(`select id from public.couranr_attach_payment_intent('${obligation}',1,'${intent}')`);
  const quote = currentQuote(requestId);
  const amount = Number(one(`select amount_cents from public.couranr_payment_obligations where id='${obligation}'`));
  const outcome = one(`select outcome from public.couranr_apply_payment_intent_state(
    '${event}','payment_intent.amount_capturable_updated','${intent}','requires_capture',
    ${amount},${amount},'usd',jsonb_build_object(
      'paymentObligationId','${obligation}','couranrRequestId','${requestId}',
      'businessAccountId','${BUSINESS}','quoteVersionId','${quote}'))`);
  check("FND-PAY-01", "payment authorization reconciles server-derived quote amount", outcome, "applied");
  return obligation;
}

function main() {
  if (!dockerContainer) {
    up({ quiet: true });
    ownsDatabase = true;
  }

  raw(`
    insert into auth.users(id,email) values ('${USER}','foundation@example.test');
    insert into public.business_accounts(id,name,slug,created_by)
      values ('${BUSINESS}','Foundation Fixture','foundation-fixture','${USER}');
    insert into public.business_members(business_account_id,user_id,role,status)
      values ('${BUSINESS}','${USER}','owner','active');
  `);

  console.log("\nrequester and idempotency");
  raises("FND-REQ-02", "business requester requires business_account_id", `
    insert into public.couranr_delivery_requests(
      id,business_account_id,created_by,idempotency_key,source,requester_kind,
      consumer_contact_snapshot,idempotency_scope)
    values ('40000000-0000-4000-8000-000000000001',null,'${USER}','bad-business',
      'merchant_portal','business','{}','business:${BUSINESS}')`, "business_requester_requires_business_account");
  service(`insert into public.couranr_delivery_requests(
      id,business_account_id,created_by,idempotency_key,source,requester_kind,
      consumer_contact_snapshot,idempotency_scope)
    values ('${CUSTOMER_A}',null,null,'same-key','consumer_send','consumer',
      '{"email":"guest@example.test"}','consumer:server-capability-00000001')`);
  check("FND-REQ-03", "guest consumer exists without business tenancy or creator", one(`
    select (business_account_id is null and created_by is null)::text
      from public.couranr_delivery_requests where id='${CUSTOMER_A}'`), "true");
  raises("FND-REQ-04", "consumer cannot carry a business account", `
    insert into public.couranr_delivery_requests(
      id,business_account_id,created_by,idempotency_key,source,requester_kind,
      consumer_contact_snapshot,idempotency_scope)
    values ('40000000-0000-4000-8000-000000000004','${BUSINESS}',null,'masquerade',
      'consumer_send','consumer','{"phone":"555-0101"}','consumer:server-capability-00000004')`,
    "consumer_requester_cannot_have_business_account");
  raises("FND-IDEM-01", "same consumer scope and key is unique", `
    insert into public.couranr_delivery_requests(
      business_account_id,created_by,idempotency_key,source,requester_kind,
      consumer_contact_snapshot,idempotency_scope)
    values (null,null,'same-key','consumer_send','consumer',
      '{"phone":"555-0102"}','consumer:server-capability-00000001')`,
    "couranr_delivery_requests_scope_idempotency_uniq");
  service(`insert into public.couranr_delivery_requests(
      id,business_account_id,created_by,idempotency_key,source,requester_kind,
      consumer_contact_snapshot,idempotency_scope)
    values ('${CUSTOMER_B}',null,null,'same-key','consumer_send','consumer',
      '{"phone":"555-0103"}','consumer:server-capability-00000002')`);
  check("FND-IDEM-02", "NULL business tenancy does not defeat scoped uniqueness", one(`
    select count(*) from public.couranr_delivery_requests
     where requester_kind='consumer' and idempotency_key='same-key'`), "2");
  raises("FND-STOP-01", "new canonical request cannot encode extra destinations", `
    insert into public.couranr_delivery_requests(
      business_account_id,created_by,idempotency_key,source,requester_kind,
      consumer_contact_snapshot,idempotency_scope,additional_stops)
    values (null,null,'multistop','consumer_send','consumer',
      '{"phone":"555-0104"}','consumer:server-capability-00000003',1)`,
    "new_delivery_request_requires_one_destination");

  console.log("\nquote, submission, readiness, payment and delivery");
  const request = createBusinessRequest("scenario-a");
  const q1 = currentQuote(request);
  check("FND-Q-03", "runtime quote arithmetic is exact", one(`
    select (subtotal_cents=public.couranr_quote_line_items_total(quote_line_items))::text
      from public.couranr_quote_versions where id='${q1}'`), "true");
  raises("FND-Q-01", "runtime role cannot UPDATE a quote", `
    update public.couranr_quote_versions set subtotal_cents=1 where id='${q1}'`,
    "permission denied for table couranr_quote_versions");
  raises("FND-Q-02", "runtime role cannot DELETE a quote", `
    delete from public.couranr_quote_versions where id='${q1}'`,
    "permission denied for table couranr_quote_versions");
  raises("FND-Q-03", "named quote command rejects false arithmetic", `
    select id from public.couranr_create_quote_version(
      '${request}','${BUSINESS}',${requestVersion(request)},'${USER}','estimated',
      'foundation-test-v1',2501,3,2,${items(2500)},'[]')`, "quote_subtotal_mismatch");
  submitAndAccept(request);
  check("FND-Q-05", "submission event names the exact quote UUID", one(`
    select metadata->>'quoteVersionId' from public.couranr_delivery_request_events
     where request_id='${request}' and command='submit_delivery_request'`), q1);
  check("FND-Q-06", "merchant acknowledgment is evidence for that exact quote", one(`
    select (metadata->>'acknowledgment')||':'||(metadata->>'quoteVersionId')
      from public.couranr_delivery_request_events
     where request_id='${request}' and command='submit_delivery_request'`), `true:${q1}`);
  const obligation = authorize(request, "scenario-a-pay", "pi_foundation_a", "evt_foundation_a");
  const versionBeforeReadiness = requestVersion(request);
  service(`select id from public.couranr_begin_delivery_preparation(
    '${request}','${BUSINESS}',${versionBeforeReadiness},'${USER}')`);
  service(`select id from public.couranr_mark_delivery_ready(
    '${request}','${BUSINESS}',${requestVersion(request)},'${USER}')`);
  check("FND-Q-07", "pickup-readiness CAS bumps request version", requestVersion(request) > versionBeforeReadiness, true);
  check("FND-Q-07", "pickup-readiness CAS does not change quote identity", currentQuote(request), q1);
  check("FND-PAY-01", "obligation amount and policy equal its immutable quote", one(`
    select (o.amount_cents=q.subtotal_cents and o.pricing_policy_version=q.pricing_policy_version
      and o.payer_type=q.payer_type and o.quote_version_id=q.id)::text
      from public.couranr_payment_obligations o join public.couranr_quote_versions q
        on q.id=o.quote_version_id where o.id='${obligation}'`), "true");
  const plan = one(`select id from public.couranr_confirm_service_plan(
    '${request}',${requestVersion(request)},'${USER}',now()+interval '1 hour',now()+interval '2 hours',
    'America/New_York',null,'{"vehicleClass":"car","maxPayloadLb":100}'::jsonb)`);
  check("FND-PLAN-01", "confirmed plan shares exact obligation/current quote", one(`
    select (p.quote_version_id=o.quote_version_id and p.quote_version_id=r.current_quote_version_id)::text
      from public.couranr_service_plans p join public.couranr_payment_obligations o on o.id=p.payment_obligation_id
      join public.couranr_delivery_requests r on r.id=p.request_id where p.id='${plan}'`), "true");
  // Fixture-only mutation proves conversion does not read mutable commercial
  // fields. Production runtime cannot issue this DML (the static gate scans it).
  raw(`update public.couranr_delivery_requests set
      pickup_address=${address("999 Mutable Drift")},weight_lb=99,version=version+1
    where id='${request}'`);
  service(`select id from public.couranr_begin_payment_capture('${request}','${USER}')`);
  service(`select outcome from public.couranr_complete_payment_capture(
    '${obligation}','evt_foundation_capture','pi_foundation_a','succeeded',2500,'usd')`);
  const delivery = one(`select id from public.couranr_create_delivery_from_capture('${request}')`);
  check("FND-DLV-01", "delivery, plan and obligation share exact quote UUID", one(`
    select (d.quote_version_id=p.quote_version_id and d.quote_version_id=o.quote_version_id)::text
      from public.couranr_deliveries d join public.couranr_service_plans p on p.id=d.service_plan_id
      join public.couranr_payment_obligations o on o.id=d.payment_obligation_id where d.id='${delivery}'`), "true");
  check("FND-DLV-02", "delivery snapshot comes from immutable quote, not mutable request drift", one(`
    select (d.pickup_address=q.pickup_address_snapshot and d.shipment=q.shipment_snapshot
      and d.pickup_address is distinct from r.pickup_address)::text
      from public.couranr_deliveries d join public.couranr_quote_versions q on q.id=d.quote_version_id
      join public.couranr_delivery_requests r on r.id=d.request_id where d.id='${delivery}'`), "true");
  check("FND-DLV-03", "conversion retry returns exactly one delivery", one(`
    select (public.couranr_create_delivery_from_capture('${request}')).id='${delivery}'::uuid`), "t");

  console.log("\nrequote and concurrency");
  const repriced = createBusinessRequest("scenario-b", 3000);
  const oldQuote = currentQuote(repriced);
  submitAndAccept(repriced);
  const oldObligation = authorize(repriced, "scenario-b-pay", "pi_foundation_b", "evt_foundation_b");
  const oldCommercialHash = one(`select md5(row(q.*)::text) from public.couranr_quote_versions q where id='${oldQuote}'`);
  const staleExpectedVersion = requestVersion(repriced);
  service(`select id from public.couranr_create_quote_version(
    '${repriced}','${BUSINESS}',${staleExpectedVersion},'${USER}','estimated',
    'foundation-test-v2',3200,3,2,${items(3200)},'[]')`);
  const newQuote = currentQuote(repriced);
  check("FND-Q-04", "requote creates quote N+1 linked to quote N", one(`
    select (quote_number=2 and supersedes_quote_version_id='${oldQuote}'::uuid)::text
      from public.couranr_quote_versions where id='${newQuote}'`), "true");
  check("FND-Q-04", "quote N remains byte-for-byte unchanged", one(`
    select md5(row(q.*)::text) from public.couranr_quote_versions q where id='${oldQuote}'`), oldCommercialHash);
  raises("FND-PAY-02", "Q1 authorization cannot become Q2 obligation authority", `
    select id from public.couranr_create_payment_obligation(
      '${repriced}','${BUSINESS}','scenario-b-q2-pay')`,
    "payment_quote_superseded_requires_resolution");
  raises("FND-PLAN-01", "plan refuses Q1 authorization against current Q2", `
    select id from public.couranr_confirm_service_plan(
      '${repriced}',${requestVersion(repriced)},'${USER}',now()+interval '1 hour',now()+interval '2 hours',
      'America/New_York',null,'{"vehicleClass":"car","maxPayloadLb":100}')`,
    "authorization_does_not_match_current_quote");
  raises("FND-Q-04", "concurrent requote loser is refused by request CAS", `
    select id from public.couranr_create_quote_version(
      '${repriced}','${BUSINESS}',${staleExpectedVersion},'${USER}','estimated',
      'foundation-test-v2',3300,3,2,${items(3300)},'[]')`, "version_or_state_conflict");
  check("FND-PAY-02", "Q1 obligation retains its exact original quote", one(`
    select quote_version_id from public.couranr_payment_obligations where id='${oldObligation}'`), oldQuote);

  console.log("\nsecurity and integrity");
  check("FND-SEC-01", "anon/authenticated have no canonical mutation grant", one(`
    select count(*) from (values
      ('anon'),('authenticated')) r(role_name),
      (values ('couranr_delivery_requests'),('couranr_delivery_request_events'),
       ('couranr_quote_versions'),('couranr_payment_obligations'),('couranr_payment_events'),
       ('couranr_service_plans'),('couranr_deliveries'),('couranr_delivery_events'),
       ('couranr_delivery_assignments')) t(table_name)
     where has_table_privilege(r.role_name,'public.'||t.table_name,'INSERT,UPDATE,DELETE')`), "0");
  check("FND-SEC-02", "RLS remains enabled on every protected table", one(`
    select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname in (
       'couranr_delivery_requests','couranr_delivery_request_events','couranr_quote_versions',
       'couranr_payment_obligations','couranr_payment_events','couranr_service_plans',
       'couranr_deliveries','couranr_delivery_events','couranr_delivery_assignments')
       and c.relrowsecurity`), "9");
  check("FND-Q-01", "quote table grants are SELECT/INSERT only for runtime role", one(`
    select has_table_privilege('service_role','public.couranr_quote_versions','SELECT,INSERT')::text
      ||','||has_table_privilege('service_role','public.couranr_quote_versions','UPDATE,DELETE')::text`), "true,false");
  check("FND-MIG-02", "runtime quote history makes destructive M2 rollback unsafe", one(`
    select exists(select 1 from public.couranr_quote_versions where record_origin='runtime')::text`), "true");
  // Stale Q1 is intentionally preserved as historical payment evidence and is
  // not an obligation/quote mismatch: it still exactly matches Q1.
  check("INTEGRITY", "permanent read-only probe finds no structural mismatch", one(`
    select count(*) from public.couranr_foundation_integrity()`), "0");

  console.log(`\nFoundation Gate A disposable DB: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

try {
  main();
} finally {
  if (ownsDatabase && !keep) down({ quiet: true });
}

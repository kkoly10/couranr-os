/** SQL execution probes for the lifecycle closure's stage and capability seams.
 * Disposable data only: no live physical or payment evidence is touched. */
import { up, down, psql } from "./up.mjs";
import { psqlTransport, seedCanonicalDeliveryChain, seedCanonicalQuotedRequest } from "./gateAFixtures.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const one = (query) => psql(query).trim();
let pass = 0;
let fail = 0;
function test(name, actual, expected) {
  if (actual === expected) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}: ${actual} (expected ${expected})`); }
}
function refused(query, marker) {
  try { psql(query); return false; }
  catch (error) { return !marker || String(error.stderr || error.message).includes(marker); }
}
try {
  up({ quiet: true });
  const business = one("insert into public.business_accounts(name,status) values('Lifecycle probe','active') returning id");
  const operator = one("insert into auth.users(email) values('lifecycle-ops@example.test') returning id");
  const chain = await seedCanonicalDeliveryChain(psqlTransport(psql), {
    businessId: business, actorUserId: operator, marker: "lifecycle-closure",
  });
  const D = chain.deliveryId;
  const R = chain.requestId;
  const hash = (letter) => `repeat('${letter}',64)`;
  const insertCode = (kind, generation, letter) => `insert into public.couranr_handoff_codes
    (delivery_id,code_kind,generation,code_digest,issued_by,expires_at)
    values ('${D}','${kind}',${generation},${hash(letter)},'${operator}',now()+interval '1 hour')`;

  test("recipient code refused before custody",
    refused(insertCode("recipient_dropoff", 1, "a"), "recipient_code_not_available_before_custody"), true);
  one(`${insertCode("merchant_pickup", 1, "b")} returning id`);
  test("sender pickup code accepted before custody",
    one(`select count(*) from public.couranr_handoff_codes where delivery_id='${D}' and code_kind='merchant_pickup'`), "1");
  test("return code refused before governed return",
    refused(insertCode("merchant_return", 1, "c"), "return_code_not_available_at_this_stage"), true);

  const driverUser = one("insert into auth.users(email) values('lifecycle-driver@example.test') returning id");
  one(`insert into public.profiles(id,role) values('${driverUser}','driver') on conflict(id) do nothing`);
  const driver = one(`insert into public.couranr_drivers(user_id,display_name,driver_state,active)
    values('${driverUser}','Lifecycle driver','active',true) returning id`);
  const vehicle = one("insert into public.couranr_dispatch_vehicles(name,vehicle_class,payload_capacity_lb) values('Lifecycle van','van',2000) returning id");
  one(`insert into public.couranr_delivery_assignments
    (delivery_id,driver_id,vehicle_id,assignment_state,assignment_source,assigned_by)
    values('${D}','${driver}','${vehicle}','active','operations','${operator}') returning id`);
  one(`update public.couranr_deliveries set fulfillment_state='assigned' where id='${D}'`);
  const discrepancy = one(`select id from public.couranr_report_pickup_discrepancy(
    '${D}','${driverUser}','weather_or_safety','Unsafe conditions en route')`);
  test("pre-arrival driver issue enters existing Operations discrepancy view",
    one(`select stage||'|'||reason from public.couranr_pickup_discrepancies where id='${discrepancy}'`),
    "pickup|weather_or_safety");
  test("report did not manufacture arrival/custody",
    one(`select fulfillment_state from public.couranr_deliveries where id='${D}'`), "assigned");
  test("wrong driver cannot report another driver's delivery",
    refused(`select public.couranr_report_pickup_discrepancy('${D}','${operator}','other','Wrong actor')`, null), true);

  // A database-only fixture advances the state with triggers disabled for that
  // single UPDATE. The following issuance calls execute with all triggers ON.
  // This is NOT a simulation of physical pickup completion.
  one(`set session_replication_role=replica;
    update public.couranr_deliveries set fulfillment_state='picked_up' where id='${D}';
    set session_replication_role=default;`);
  test("sender pickup code refused after custody",
    refused(insertCode("merchant_pickup", 2, "d"), "pickup_code_not_available_at_this_stage"), true);
  one(`${insertCode("recipient_dropoff", 1, "e")} returning id`);
  test("recipient code accepted only after custody",
    one(`select count(*) from public.couranr_handoff_codes where delivery_id='${D}' and code_kind='recipient_dropoff'`), "1");
  const replacement = one(`select generation from public.couranr_issue_handoff_code_cas(
    '${D}','recipient_dropoff',2,${hash("a")},'${operator}',60)`);
  test("recipient replacement advances exact CAS generation", replacement, "2");
  test("old recipient generation is unusable immediately",
    one(`select (public.couranr_verify_handoff_code('${D}','recipient_dropoff',${hash("e")},'${driverUser}')).outcome`),
    "invalid");
  test("new recipient generation verifies with recipient kind",
    one(`select (public.couranr_verify_handoff_code('${D}','recipient_dropoff',${hash("a")},'${driverUser}')).outcome`),
    "accepted");
  test("consumed recipient credential cannot be replayed",
    one(`select (public.couranr_verify_handoff_code('${D}','recipient_dropoff',${hash("a")},'${driverUser}')).outcome`),
    "expired");

  const recipientHash = "f".repeat(64);
  one(`select id from public.couranr_issue_delivery_access_token('${R}','${recipientHash}',14)`);
  const helpId = one(`select public.couranr_issue_customer_help_token('recipient_tracking','${recipientHash}','${"1".repeat(64)}')`);
  test("recipient Help is bound to recipient audience and exact delivery",
    one(`select audience||'|'||(delivery_id='${D}')::text from public.couranr_help_access_tokens where id='${helpId}'`),
    "recipient|true");
  one(`insert into public.couranr_delivery_access_tokens
    (request_id,business_account_id,token_hash,audience,expires_at)
    values('${R}','${business}','${"2".repeat(64)}','sender',now()+interval '1 day') returning id`);
  test("sender-only token is not a recipient tracking token",
    one(`select valid from public.couranr_redeem_delivery_access_token('${"2".repeat(64)}')`), "f");

  // Recast only this disposable fixture as a tenantless direct Consumer row.
  // It tests the NULL-business Help and sender recovery paths; it is not a
  // claim that a real business delivery can change requester identity.
  const sessionHash = "3".repeat(64);
  const session = one(`select id from public.couranr_create_consumer_guest_session('${sessionHash}',60)`);
  one(`set session_replication_role=replica;
    update public.couranr_delivery_requests set requester_kind='consumer',
      business_account_id=null,source='consumer_send',created_by=null,
      consumer_contact_snapshot='{"email":"sender@example.test"}'::jsonb,
      idempotency_scope='consumer:${session}' where id='${R}';
    update public.couranr_deliveries set business_account_id=null where id='${D}';
    update public.couranr_consumer_guest_sessions set request_id='${R}' where id='${session}';
    set session_replication_role=default;`);
  const senderHash = "4".repeat(64);
  one(`select id from public.couranr_issue_sender_access_token('${R}','${senderHash}',30)`);
  test("sender capability cannot redeem as recipient",
    one(`select valid from public.couranr_redeem_delivery_access_token('${senderHash}')`), "f");
  one(`select id from public.couranr_recover_sender_guest_session('${senderHash}','${"5".repeat(64)}')`);
  test("sender link rotates only the bound guest session",
    one(`select token_hash from public.couranr_consumer_guest_sessions where id='${session}'`), "5".repeat(64));
  const senderHelp = one(`select public.couranr_issue_customer_help_token(
    'sender_guest','${"5".repeat(64)}','${"6".repeat(64)}')`);
  test("direct Consumer Help has no fake business tenancy",
    one(`select audience||'|'||coalesce(business_account_id::text,'-') from public.couranr_help_access_tokens where id='${senderHelp}'`),
    "sender|-");
  test("legacy Operations Help token cannot accidentally grant recipient payer controls on direct Consumer",
    refused(`select public.couranr_issue_help_token('${D}','${"a".repeat(64)}',14)`,
      "customer_help_audience_required"), true);
  const senderThread = one(`select out_conversation_id from public.couranr_redeem_help_token('${"6".repeat(64)}')`);
  test("sender Help thread is distinct from recipient thread",
    one(`select customer_audience||'|'||coalesce(business_account_id::text,'-') from public.couranr_conversations where id='${senderThread}'`),
    "sender|-");
  one(`select id from public.couranr_issue_delivery_access_token('${R}','${"7".repeat(64)}',14)`);
  const recipientHelp = one(`select public.couranr_issue_customer_help_token(
    'recipient_tracking','${"7".repeat(64)}','${"8".repeat(64)}')`);
  one(`select out_conversation_id from public.couranr_redeem_help_token('${"8".repeat(64)}')`);
  test("direct Consumer recipient Help also has no fake tenant",
    one(`select audience||'|'||coalesce(business_account_id::text,'-') from public.couranr_help_access_tokens where id='${recipientHelp}'`),
    "recipient|-");
  test("recipient cannot append a financial return review",
    refused(`select * from public.couranr_help_post_resolution_request(
      '${recipientHelp}','${D}','picked_up','return_review',
      'I want to cancel this order','delivery_problem','recipient-financial-review-1')`,
      "recipient_cannot_request_financial_resolution"), true);
  test("sender can request governed return REVIEW without changing custody",
    one(`select out_request_kind from public.couranr_help_post_resolution_request(
      '${senderHelp}','${D}','picked_up','return_review',
      'Please review a return','delivery_problem','sender-return-review-1')`),
    "return_review");
  test("sender review did not mutate delivery state",
    one(`select fulfillment_state from public.couranr_deliveries where id='${D}'`), "picked_up");
  test("request-only cancellation review cannot bypass Delivery Help after creation",
    refused(`select public.couranr_request_sender_cancellation_review(
      '${session}','review-retry-key-123','Please cancel this delivery')`,
      "sender_review_use_delivery_help"), true);
  const pre = await seedCanonicalQuotedRequest(psqlTransport(psql), {
    businessId: business, actorUserId: operator, marker: "pre-delivery-review", upTo: "confirmed",
  });
  const preSession = one(`select id from public.couranr_create_consumer_guest_session('${"9".repeat(64)}',60)`);
  one(`set session_replication_role=replica;
    update public.couranr_delivery_requests set requester_kind='consumer',
      business_account_id=null,source='consumer_send',created_by=null,
      consumer_contact_snapshot='{"email":"review@example.test"}'::jsonb,
      idempotency_scope='consumer:${preSession}' where id='${pre.requestId}';
    update public.couranr_consumer_guest_sessions set request_id='${pre.requestId}' where id='${preSession}';
    set session_replication_role=default;`);
  const reviewKey = "pre-delivery-review-key-1";
  const review = one(`select public.couranr_request_sender_cancellation_review(
    '${preSession}','${reviewKey}','Please review cancellation before delivery creation')`);
  test("pre-delivery sender review is durable and replay-idempotent",
    one(`select public.couranr_request_sender_cancellation_review(
      '${preSession}','${reviewKey}','Please review cancellation before delivery creation')`), review);
  test("different retry key cannot spam a second open review",
    one(`select public.couranr_request_sender_cancellation_review(
      '${preSession}','another-review-attempt','Please review this cancellation again')`), review);
  test("Operations queue includes the sender's request-only review",
    one(`select count(*) from public.couranr_operations_queue_candidates(200)
      where request_id='${pre.requestId}'`), "1");
  // The event was made before conversion in the real flow. This synthetic
  // insertion on an active-delivery fixture isolates the queue's post-conversion
  // behavior without inventing a payment, physical handoff, or customer claim.
  test("active delivery is not otherwise an Operations queue chore",
    one(`select count(*) from public.couranr_operations_queue_candidates(200)
      where request_id='${R}'`), "0");
  one(`insert into public.couranr_delivery_request_events(
    request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values ('${R}',null,'customer','sender_cancellation_review_requested',
    'confirmed','confirmed','{"idempotencyKey":"preconversion-queue-proof"}'::jsonb)`);
  test("unanswered sender review stays in Operations queue after active delivery creation",
    one(`select count(*) from public.couranr_operations_queue_candidates(200)
      where request_id='${R}'`), "1");
  test("request review did not change request state or money",
    one(`select request_state from public.couranr_delivery_requests where id='${pre.requestId}'`), "confirmed");
  test("new canonical tables stay service-role-only",
    one("select has_table_privilege('anon','public.couranr_help_access_tokens','INSERT')::text || '|' || has_table_privilege('authenticated','public.couranr_handoff_codes','INSERT')::text"),
    "false|false");
  test("new sender and Help command authority stays server-only",
    one(`select has_function_privilege('anon','public.couranr_issue_sender_access_token(uuid,text,integer)','EXECUTE')::text
      ||'|'||has_function_privilege('authenticated','public.couranr_issue_customer_help_token(text,text,text)','EXECUTE')::text
      ||'|'||has_function_privilege('anon','public.couranr_request_sender_cancellation_review(uuid,text,text)','EXECUTE')::text
      ||'|'||has_function_privilege('service_role','public.couranr_recover_sender_guest_session(text,text)','EXECUTE')::text`),
    "false|false|false|true");

  // Disposable trigger probe only: this UPDATE is not a claim that a driver
  // performed a return or that Operations governed one on the real canary.
  one(`select generation from public.couranr_issue_handoff_code_cas(
    '${D}','recipient_dropoff',3,${hash("b")},'${operator}',60)`);
  one(`update public.couranr_deliveries set fulfillment_state='return_required' where id='${D}' returning fulfillment_state`);
  test("leaving the drop-off window supersedes the still-active recipient code",
    one(`select code_state from public.couranr_handoff_codes
      where delivery_id='${D}' and code_kind='recipient_dropoff' and generation=3`),
    "superseded");

  const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  for (const [name, marker] of [
    ["20260921150000_couranr_handoff_stage_authority", "handoff_stage_authority_rollback_refused"],
    ["20260921151000_couranr_sender_lifecycle_access", "sender_lifecycle_access_rollback_refused"],
    ["20260921152000_couranr_customer_help_audiences", "customer_help_audiences_rollback_refused"],
    ["20260921153000_couranr_sender_request_review", "sender_request_review_rollback_refused"],
    ["20260921154000_couranr_prearrival_driver_exception", "prearrival_driver_exception_rollback_refused"],
  ]) {
    const sql = readFileSync(resolve(repoRoot, "supabase/rollbacks", `${name}.rollback.sql`), "utf8");
    test(`${name} destructive rollback hard-refuses`, refused(sql, marker), true);
  }
  test("rollback refusals leave sender and recipient evidence intact",
    one(`select (select count(*) from public.couranr_delivery_access_tokens where request_id='${R}')::text
      ||'|'||(select count(*) from public.couranr_help_access_tokens where delivery_id='${D}')::text`),
    "4|3");
} finally {
  down({ quiet: true });
}
console.log(`Same Day lifecycle SQL: ${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;

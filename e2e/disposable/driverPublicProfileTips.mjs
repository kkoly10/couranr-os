/** Executed driver identity / private feedback / company-held tip probe.
 * Disposable PostgreSQL only; fake provider IDs are never sent to Stripe. */
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { up, down, psql } from "./up.mjs";
import { psqlTransport, seedCanonicalDeliveryChain } from "./gateAFixtures.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const one = (q) => psql(q).trim();
const row = (q) => JSON.parse(one(`select row_to_json(x) from ${q} x`));
const escape = (s) => String(s).replaceAll("'", "''");
let passed = 0;
let failed = 0;
function check(id, label, yes, detail = "") {
  (yes ? passed++ : failed++);
  console.log(`  ${yes ? "PASS" : "FAIL"} ${id} ${label}${detail ? ` [${detail}]` : ""}`);
}
function refusal(q, code) {
  try { psql(q); return false; }
  catch (e) { return String(e.stderr || e.message).includes(code); }
}
function actor(email, role) {
  const user = one(`insert into auth.users(email) values('${escape(email)}') returning id`);
  psql(`insert into public.profiles(id,email,role) values('${user}','${escape(email)}','${role}')`);
  return user;
}
function call(name, args) { return `public.${name}(${args.join(",")})`; }
const q = (v) => `'${escape(v)}'`;

try {
  up({ quiet: true });
  const portraitMigration = path.join(root,"supabase/migrations/20260922200000_couranr_driver_public_portraits.sql");
  const feedbackMigration = path.join(root,"supabase/migrations/20260922210000_couranr_driver_feedback_and_tips.sql");
  const portraitRollback = path.join(root,"supabase/rollbacks/20260922200000_couranr_driver_public_portraits.rollback.sql");
  const feedbackRollback = path.join(root,"supabase/rollbacks/20260922210000_couranr_driver_feedback_and_tips.rollback.sql");
  psql(readFileSync(feedbackRollback,"utf8"));
  psql(readFileSync(portraitRollback,"utf8"));
  check("DP-00a", "unused additive schema rolls back cleanly",
    one("select to_regclass('public.couranr_driver_portraits') is null and to_regclass('public.couranr_driver_tips') is null") === "t");
  psql(readFileSync(portraitMigration,"utf8"));
  psql(readFileSync(feedbackMigration,"utf8"));
  check("DP-00b", "forward repair reapplies both staged migrations",
    one("select to_regclass('public.couranr_driver_portraits') is not null and to_regclass('public.couranr_driver_tips') is not null") === "t");
  const suffix = crypto.randomUUID().slice(0, 8);
  const ops = actor(`ops-${suffix}@example.test`, "admin");
  const merchant = actor(`merchant-${suffix}@example.test`, "customer");
  const driverUser = actor(`driver-${suffix}@example.test`, "driver");
  const outsider = actor(`outsider-${suffix}@example.test`, "customer");
  const business = one(`insert into public.business_accounts(name,status) values('Feedback test','active') returning id`);
  psql(`insert into public.business_members(business_account_id,user_id,role,status)
    values('${business}','${merchant}','owner','active')`);
  const chain = await seedCanonicalDeliveryChain(psqlTransport(psql), {
    businessId: business, actorUserId: merchant, marker: `feedback-${suffix}`,
    stopAfter: "delivery",
  });
  const delivery = chain.deliveryId;
  const driver = row(call("couranr_create_driver_profile", [q(driverUser),q(ops),q("Photo Driver"),"null","null"]));
  const active = row(call("couranr_activate_driver", [q(driver.id),driver.version,q(ops)]));
  const available = row(call("couranr_mark_driver_available", [q(driver.id),active.version,q(ops)]));
  const portraitId = crypto.randomUUID();
  const portrait = row(call("couranr_publish_driver_portrait", [
    q(driver.id),available.version,q(ops),q(`drivers/${driver.id}/${crypto.randomUUID()}.jpg`),q(portraitId),"true",
  ]));
  check("DP-01", "Operations consent publication pins private portrait", portrait.public_id === portraitId);
  const replacementPublicId = crypto.randomUUID();
  const replacementPortrait = row(call("couranr_publish_driver_portrait", [
    q(driver.id),available.version + 1,q(ops),q(`drivers/${driver.id}/${crypto.randomUUID()}.jpg`),
    q(replacementPublicId),"true",
  ]));
  check("DP-01a", "replacement immediately revokes the superseded public portrait",
    one(`select revoked_at is not null from public.couranr_driver_portraits where id='${portrait.id}'`) === "t" &&
    one(`select current_portrait_id='${replacementPortrait.id}'::uuid from public.couranr_drivers where id='${driver.id}'`) === "t");
  check("DP-02", "non-Operations cannot publish a portrait",
    refusal(`select ${call("couranr_publish_driver_portrait", [q(driver.id),available.version + 1,q(outsider),
      q(`drivers/${driver.id}/${crypto.randomUUID()}.jpg`),q(crypto.randomUUID()),"true"])};`, "operations_actor_required"));
  const vehicle = row(call("couranr_create_dispatch_vehicle", [
    q(ops),q("Tip test van"),q("van"),"2000","null","null","null","null",
    "true","false","false","false","true",
  ]));
  const deliveryVersion = one(`select version from public.couranr_deliveries where id='${delivery}'`);
  const assigned = row(call("couranr_assign_delivery", [
    q(delivery),deliveryVersion,q(ops),q(driver.id),q(vehicle.id),q(`tip-${suffix}`),
  ]));
  check("DP-03", "assignment snapshot uses approved profile name and portrait",
    assigned.driver_display_name_snapshot === "Photo Driver" &&
    assigned.driver_portrait_id === replacementPortrait.id);
  const currentDriverVersion = one(`select version from public.couranr_drivers where id='${driver.id}'`);
  check("DP-04", "consent withdrawal revokes public redemption without rewriting assignment evidence",
    one(`select ${call("couranr_revoke_driver_portrait", [
      q(driver.id),currentDriverVersion,q(ops)])}`) === "t" &&
    one(`select current_portrait_id is null from public.couranr_drivers where id='${driver.id}'`) === "t" &&
    one(`select revoked_at is not null from public.couranr_driver_portraits where id='${replacementPortrait.id}'`) === "t" &&
    one(`select driver_portrait_id='${replacementPortrait.id}'::uuid from public.couranr_delivery_assignments where id='${assigned.id}'`) === "t");

  // Fixtures may set physical completion directly. This never touches a live
  // delivery; the subject here is post-delivery feedback authority, not proof.
  psql(`update public.couranr_delivery_assignments
     set assignment_state='completed',ended_at=now(),end_reason='delivered'
     where id='${assigned.id}';
   update public.couranr_deliveries set fulfillment_state='delivered',updated_at=now()
     where id='${delivery}'`);
  const goodHash = crypto.createHash("sha256").update(`recipient-${suffix}`).digest("hex");
  const badHash = crypto.createHash("sha256").update(`outsider-${suffix}`).digest("hex");
  psql(`insert into public.couranr_delivery_access_tokens(
    request_id,business_account_id,token_hash,audience,expires_at)
    values('${chain.requestId}','${business}','${goodHash}','recipient',now()+interval '1 day')`);
  const feedback = (audience, token, guest, user) => [
    q(delivery),q(audience),token ? q(token) : "null",guest ? q(guest) : "null",user ? q(user) : "null",
  ];
  check("DF-01", "unknown recipient capability cannot review",
    refusal(`select ${call("couranr_submit_driver_review", [
      ...feedback("recipient",badHash,null,null),"5",q("Good")])};`, "feedback_unavailable"));
  check("DF-02", "nonmember cannot review as merchant",
    refusal(`select ${call("couranr_submit_driver_review", [
      ...feedback("merchant",null,null,outsider),"5",q("Good")])};`, "feedback_unavailable"));
  const review = row(call("couranr_submit_driver_review", [
    ...feedback("recipient",goodHash,null,null),"5",q("Careful handoff")]));
  check("DF-03", "recipient review records completed assignment, privately",
    review.driver_id === driver.id && review.assignment_id === assigned.id && review.rating === 5);
  check("DF-04", "review retry is idempotent", row(call("couranr_submit_driver_review", [
    ...feedback("recipient",goodHash,null,null),"5",q("Careful handoff")])).id === review.id);
  check("DF-05", "different review content cannot replace first",
    refusal(`select ${call("couranr_submit_driver_review", [
      ...feedback("recipient",goodHash,null,null),"1",q("Changed")])};`, "review_already_submitted"));
  const merchantReview = row(call("couranr_submit_driver_review", [
    ...feedback("merchant",null,null,merchant),"4",q("Professional handoff")]));
  check("DF-06", "authorized merchant can review the completed assignment",
    merchantReview.driver_id === driver.id && merchantReview.audience === "merchant");
  const tip = row(call("couranr_prepare_driver_tip", [
    ...feedback("recipient",goodHash,null,null),"500"]));
  check("DT-01", "recipient tip binds completed driver and fixed gross amount",
    tip.driver_id === driver.id && tip.amount_cents === 500);
  check("DT-02", "tip retry converges on one row", row(call("couranr_prepare_driver_tip", [
    ...feedback("recipient",goodHash,null,null),"500"])).id === tip.id);
  check("DT-03", "browser cannot change prepared tip amount",
    refusal(`select ${call("couranr_prepare_driver_tip", [
      ...feedback("recipient",goodHash,null,null),"10000"])};`, "tip_amount_already_chosen"));
  check("DT-04", "payer cannot use another recipient token to prepare tip",
    refusal(`select ${call("couranr_prepare_driver_tip", [
      ...feedback("recipient",badHash,null,null),"500"])};`, "feedback_unavailable"));
  const merchantTip = row(call("couranr_prepare_driver_tip", [
    ...feedback("merchant",null,null,merchant),"600"]));
  check("DT-04a", "authorized merchant can prepare a separately scoped tip",
    merchantTip.driver_id === driver.id && merchantTip.audience === "merchant");

  // Turn this disposable fixture into the equivalent consumer requester only
  // after proving merchant authority. The immutable-request trigger is disabled
  // solely for fixture construction; the resulting row still satisfies every
  // requester constraint and exercises the real guest-session feedback command.
  const guestSession = crypto.randomUUID();
  psql(`alter table public.couranr_delivery_requests disable trigger couranr_dr_requester_scope_trg;
    update public.couranr_delivery_requests
       set requester_kind='consumer',business_account_id=null,
           idempotency_scope='consumer:${crypto.randomUUID()}',
           consumer_contact_snapshot='{"email":"sender@example.test"}'::jsonb
     where id='${chain.requestId}';
    alter table public.couranr_delivery_requests enable trigger couranr_dr_requester_scope_trg;
    insert into public.couranr_consumer_guest_sessions(id,token_hash,request_id,contact_snapshot,expires_at)
    values('${guestSession}','${"9".repeat(64)}','${chain.requestId}',
           '{"email":"sender@example.test"}'::jsonb,now()+interval '1 day')`);
  const senderReview = row(call("couranr_submit_driver_review", [
    ...feedback("sender",null,guestSession,null),"5",q("Reliable delivery")]));
  const senderTip = row(call("couranr_prepare_driver_tip", [
    ...feedback("sender",null,guestSession,null),"700"]));
  check("DF-07", "consumer guest sender can review under its bound session",
    senderReview.audience === "sender" && senderReview.driver_id === driver.id);
  check("DT-04b", "consumer guest sender can prepare a separately scoped tip",
    senderTip.audience === "sender" && senderTip.driver_id === driver.id);
  const canceledPi = `pi_${crypto.randomUUID().replaceAll("-", "")}`;
  const replacementPi = `pi_${crypto.randomUUID().replaceAll("-", "")}`;
  row(call("couranr_attach_driver_tip_intent", [q(senderTip.id),q(canceledPi)]));
  const replacedIntent = row(call("couranr_replace_driver_tip_intent", [
    q(senderTip.id),q(canceledPi),"0",q(replacementPi),
  ]));
  check("DT-04c", "freshly verified canceled pending intent rotates once through generation CAS",
    replacedIntent.provider_payment_intent_id === replacementPi &&
    replacedIntent.intent_generation === 1 && replacedIntent.payment_state === "pending" &&
    refusal(`select ${call("couranr_replace_driver_tip_intent", [
      q(senderTip.id),q(canceledPi),"0",q(replacementPi)])};`, "tip_intent_conflict"));
  const pi = `pi_${crypto.randomUUID().replaceAll("-", "")}`;
  row(call("couranr_attach_driver_tip_intent", [q(tip.id),q(pi)]));
  const settle = (tipRow, intentId, amount, refund = 0, dispute = null) =>
    call("couranr_settle_driver_tip", [
      q(tipRow.id),q(intentId),q(delivery),q(driver.id),q("succeeded"),amount,amount,refund,q("usd"),
      dispute ? q(dispute.id) : "null",dispute ? q(dispute.status) : "null",
      dispute ? dispute.amount : "0",
    ]);
  check("DT-05", "provider amount mismatch hard refuses",
    refusal(`select ${settle(tip,pi,400)};`, "tip_provider_mismatch"));
  const paid = row(settle(tip,pi,500));
  check("DT-06", "captured tip stays in company clearing, fully payable to driver",
    paid.payment_state === "succeeded" && Number(one(`select sum(e.amount_cents)
      from private.couranr_ledger_transactions t join private.couranr_ledger_entries e on e.transaction_id=t.id
      where t.source_kind='tip' and e.account_code='tips_payable' and e.side='credit'`)) === 500);
  row(settle(tip,pi,500));
  check("DT-07", "duplicate capture posts one tip transaction",
    one(`select count(*) from private.couranr_ledger_transactions where source_kind='tip'`) === "1");
  row(settle(tip,pi,500,200));
  check("DT-08", "partial refund reverses only refunded liability",
    one(`select sum(e.amount_cents) from private.couranr_ledger_transactions t
      join private.couranr_ledger_entries e on e.transaction_id=t.id
      where t.source_kind='tip_refund' and e.account_code='tips_payable' and e.side='debit'`) === "200");
  const recipientDispute = { id: `du_${crypto.randomUUID().replaceAll("-", "")}`,
    status: "needs_response", amount: 200 };
  const held = row(settle(tip,pi,500,200,recipientDispute));
  check("DT-09", "open partial dispute holds its exact amount without reversing liability",
    held.payment_state === "disputed" && held.disputed_amount_cents === 200 &&
    one(`select count(*) from private.couranr_ledger_transactions where source_kind='tip_dispute_loss'`) === "0");
  const won = row(settle(tip,pi,500,200,{ ...recipientDispute, status: "won" }));
  check("DT-10", "won dispute closes the hold without a loss posting",
    won.payment_state === "partially_refunded" && won.dispute_closed_at &&
    one(`select count(*) from private.couranr_ledger_transactions where source_kind='tip_dispute_loss'`) === "0");

  const merchantPi = `pi_${crypto.randomUUID().replaceAll("-", "")}`;
  row(call("couranr_attach_driver_tip_intent", [q(merchantTip.id),q(merchantPi)]));
  row(settle(merchantTip,merchantPi,600));
  const merchantDispute = { id: `du_${crypto.randomUUID().replaceAll("-", "")}`,
    status: "under_review", amount: 300 };
  row(settle(merchantTip,merchantPi,600,0,merchantDispute));
  const lost = row(settle(merchantTip,merchantPi,600,0,{ ...merchantDispute, status: "lost" }));
  row(settle(merchantTip,merchantPi,600,0,{ ...merchantDispute, status: "lost" }));
  check("DT-11", "lost dispute reverses only the disputed driver liability exactly once",
    lost.payment_state === "dispute_lost" &&
    one(`select coalesce(sum(e.amount_cents),0) from private.couranr_ledger_transactions t
      join private.couranr_ledger_entries e on e.transaction_id=t.id
      where t.source_kind='tip_dispute_loss' and e.account_code='tips_payable' and e.side='debit'`) === "300" &&
    one(`select count(*) from private.couranr_ledger_transactions where source_kind='tip_dispute_loss'`) === "1");
  check("DT-12", "ledger reconciliation remains balanced after refund and dispute loss",
    one(`select public.couranr_get_ledger_reconciliation()->>'balanced'`) === "true");
  check("DT-13", "canonical recent ledger gives tip sources their real amounts",
    one(`select bool_and((x->>'amount_cents')::int>0)
      from jsonb_array_elements(public.couranr_get_ledger_reconciliation()->'recentTransactions') x
      where x->>'source_kind' in ('tip','tip_refund','tip_dispute_loss')`) === "t");
  check("DT-14", "anon/authenticated have no DML or read privilege on feedback and portrait tables",
    ["anon","authenticated"].every((role) =>
      ["couranr_driver_reviews","couranr_driver_tips","couranr_driver_portraits"].every((table) =>
        ["SELECT","INSERT","UPDATE","DELETE"].every((privilege) =>
          one(`select has_table_privilege('${role}','public.${table}','${privilege}')`) === "f"))));
  const callable = [
    "couranr_publish_driver_portrait(uuid,integer,uuid,text,uuid,boolean)",
    "couranr_revoke_driver_portrait(uuid,integer,uuid)",
    "couranr_submit_driver_review(uuid,text,text,uuid,uuid,integer,text)",
    "couranr_prepare_driver_tip(uuid,text,text,uuid,uuid,integer)",
    "couranr_get_driver_feedback(uuid,text,text,uuid,uuid)",
    "couranr_attach_driver_tip_intent(uuid,text)",
    "couranr_replace_driver_tip_intent(uuid,text,integer,text)",
    "couranr_settle_driver_tip(uuid,text,uuid,uuid,text,integer,integer,integer,text,text,text,integer)",
  ];
  check("DT-15", "new identity and money RPCs are service-role-only",
    callable.every((fn) =>
      one(`select has_function_privilege('service_role','public.${fn}','EXECUTE')`) === "t" &&
      one(`select has_function_privilege('anon','public.${fn}','EXECUTE')`) === "f" &&
      one(`select has_function_privilege('authenticated','public.${fn}','EXECUTE')`) === "f"));
  const rollback = readFileSync(feedbackRollback,"utf8");
  check("DT-16", "rollback refuses live tip/review history",
    refusal(rollback, "driver_feedback_rollback_refused_live_history_use_forward_repair"));
} catch (error) {
  failed++;
  console.error(error);
} finally {
  down({ quiet: true });
  console.log(`\n  driver profile/feedback/tips: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

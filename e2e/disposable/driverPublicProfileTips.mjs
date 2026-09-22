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
    assigned.driver_display_name_snapshot === "Photo Driver" && assigned.driver_portrait_id === portrait.id);

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
  const pi = `pi_${crypto.randomUUID().replaceAll("-", "")}`;
  row(call("couranr_attach_driver_tip_intent", [q(tip.id),q(pi)]));
  const settle = (amount, refund = 0) => call("couranr_settle_driver_tip", [
    q(tip.id),q(pi),q(delivery),q(driver.id),q("succeeded"),amount,amount,refund,q("usd"),"false",
  ]);
  check("DT-05", "provider amount mismatch hard refuses",
    refusal(`select ${settle(400)};`, "tip_provider_mismatch"));
  const paid = row(settle(500));
  check("DT-06", "captured tip stays in company clearing, fully payable to driver",
    paid.payment_state === "succeeded" && Number(one(`select sum(e.amount_cents)
      from private.couranr_ledger_transactions t join private.couranr_ledger_entries e on e.transaction_id=t.id
      where t.source_kind='tip' and e.account_code='tips_payable' and e.side='credit'`)) === 500);
  row(settle(500));
  check("DT-07", "duplicate capture posts one tip transaction",
    one(`select count(*) from private.couranr_ledger_transactions where source_kind='tip'`) === "1");
  row(settle(500,200));
  check("DT-08", "partial refund reverses only refunded liability",
    one(`select sum(e.amount_cents) from private.couranr_ledger_transactions t
      join private.couranr_ledger_entries e on e.transaction_id=t.id
      where t.source_kind='tip_refund' and e.account_code='tips_payable' and e.side='debit'`) === "200");
  check("DT-09", "ledger reconciliation remains balanced with company-held tip",
    one(`select public.couranr_get_ledger_reconciliation()->>'balanced'`) === "true");
  check("DT-10", "anon/authenticated cannot mutate reviews or tips",
    ["anon","authenticated"].every((role) =>
      ["couranr_driver_reviews","couranr_driver_tips"].every((table) =>
        one(`select has_table_privilege('${role}','public.${table}','INSERT')`) === "f")));
  const rollback = readFileSync(feedbackRollback,"utf8");
  check("DT-11", "rollback refuses live tip/review history",
    refusal(rollback, "driver_feedback_rollback_refused_live_history_use_forward_repair"));
} catch (error) {
  failed++;
  console.error(error);
} finally {
  down({ quiet: true });
  console.log(`\n  driver profile/feedback/tips: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { up, down, psql } from "./up.mjs";
import { psqlTransport, seedCanonicalQuotedRequest } from "./gateAFixtures.mjs";

const ROOT=fileURLToPath(new URL("../../", import.meta.url));
const forward=readFileSync(resolve(ROOT,"supabase/migrations/20260930133000_couranr_route_run_settlement_foundation.sql"),"utf8");
const rollback=readFileSync(resolve(ROOT,"supabase/rollbacks/20260930133000_couranr_route_run_settlement_foundation.rollback.sql"),"utf8");
const one=(q)=>psql(q).trim();
const esc=(s)=>String(s).replaceAll("'","''");
let checks=0;
function check(name,a,b){assert.deepEqual(a,b,name);checks++;console.log("PASS",name);}
function refuses(name,q,marker){let e="";try{one(q)}catch(x){e=String(x.stderr||x.message)}assert.ok(e.includes(marker),`${name}: expected ${marker}; ${e||"success"}`);checks++;console.log("PASS",name);}
try{
  const info=up({quiet:true,throughMigration:"20260930133000_couranr_route_run_settlement_foundation.sql"});
  console.log(`RR-003b settlement: ${info.migrationsApplied} migrations applied`);
  one(rollback);
  check("empty settlement rollback restores ordinary obligation command",
    one("select position('couranr_create_obligation_for_quote' in pg_get_functiondef('public.couranr_create_payment_obligation(uuid,uuid,text)'::regprocedure))"),"0");
  one(forward);
  check("settlement forward reapplies after empty rollback",
    one("select to_regclass('public.couranr_route_run_settlements') is not null"),"t");
  const biz=one("insert into public.business_accounts(name,status) values('RR003b shop','active') returning id");
  const owner=one("insert into auth.users(email) values('rr003b-owner@example.test') returning id");
  const dispatcher=one("insert into auth.users(email) values('rr003b-dispatcher@example.test') returning id");
  one(`insert into public.business_members(business_account_id,user_id,role,status) values
    ('${biz}','${owner}','owner','active'),('${biz}','${dispatcher}','dispatcher','active')`);
  const transport=psqlTransport(psql);
  async function child(marker,subtotal){
    const c=await seedCanonicalQuotedRequest(transport,{businessId:biz,actorUserId:owner,marker,upTo:"draft",weightLb:20,subtotalCents:subtotal});
    one(`select id from public.couranr_set_business_pickup_manifest(
      '${c.requestId}','${biz}','${owner}',0,'Package ${esc(marker)}',1,'${esc(marker)}',null)`);
    const dv=JSON.parse(one(`select public.couranr_record_business_declared_value(
      '${biz}','${owner}','${c.requestId}',${c.version},10000)`));
    return {...c,version:dv.version};
  }
  const a=await child("rr003b-a",1800), b=await child("rr003b-b",2200);
  const route=randomUUID(), saveKey=randomUUID(), acceptKey=randomUUID(), checkoutKey=randomUUID();
  one(`select public.couranr_save_route_run_draft(
    '${biz}','${owner}','${route}',0,'${saveKey}','Morning route',
    array['${a.requestId}','${b.requestId}']::uuid[])`);
  one(`select public.couranr_accept_route_run('${biz}','${owner}','${route}',1,'${acceptKey}')`);
  one(`insert into public.couranr_business_payment_profiles(
    business_account_id,stripe_customer_id,stripe_customer_livemode,current_generation,
    default_payment_method_id,default_setup_intent_id,card_brand,card_last4
  ) values('${biz}','cus_rr003fixture',false,1,'pm_rr003fixture','seti_rr003fixture','visa','4242')`);

  refuses("dispatcher cannot confirm checkout",
    `select public.couranr_begin_route_run_checkout('${biz}','${dispatcher}','${route}',1,'${randomUUID()}')`,
    "route_checkout_access_denied");

  const checkout=JSON.parse(one(`select public.couranr_begin_route_run_checkout(
    '${biz}','${owner}','${route}',1,'${checkoutKey}')`));
  check("checkout is pending authorization",checkout.state,"pending_authorization");
  check("checkout projects only saved-card brand and last4",checkout.card,{brand:"visa",last4:"4242"});
  check("checkout response hides reusable provider ids",JSON.stringify(checkout).includes("pm_rr003fixture"),false);
  check("checkout pins provider method identity server-side",
    one(`select stripe_payment_method_id from public.couranr_route_run_settlements where id='${checkout.settlementId}'`),"pm_rr003fixture");
  one(`update public.couranr_business_payment_profiles
    set current_generation=2,default_payment_method_id='pm_replacement',
        card_last4='5555' where business_account_id='${biz}'`);
  check("later saved-card replacement cannot rewrite checkout provider identity",
    one(`select stripe_payment_method_id from public.couranr_route_run_settlements where id='${checkout.settlementId}'`),"pm_rr003fixture");
  check("checkout keeps exact child total",checkout.referenceTotalCents,4000);
  check("checkout has two child obligation items",checkout.items.length,2);
  check("checkout item order follows Route",checkout.items.map(x=>x.requestId),[a.requestId,b.requestId]);
  check("each child has its own obligation",new Set(checkout.items.map(x=>x.obligationId)).size,2);
  check("obligations are canonical not_started rows",one(`select count(*) from public.couranr_payment_obligations where payment_state='not_started'`),"2");
  check("checkout confirms exact child requests without authorizing money",
    one(`select count(*) from public.couranr_delivery_requests where id in ('${a.requestId}','${b.requestId}') and request_state='confirmed'`),"2");
  check("checkout writes one exact child audit event apiece",
    one(`select count(*) from public.couranr_delivery_request_events where command='route_checkout_confirmed' and request_id in ('${a.requestId}','${b.requestId}')`),"2");
  check("accepted Route does not call its own checkout CAS movement stale",
    one(`select count(*) from public.couranr_route_run_stops s join public.couranr_route_run_versions v on v.id=s.route_version_id where v.route_run_id='${route}' and (private.couranr_route_run_draft_view('${route}',1)->'stops'->(s.sequence-1)->>'stale')::boolean`),"0");
  refuses("standalone child mutation remains blocked after checkout",
    `update public.couranr_delivery_requests set readiness_state='ready' where id='${a.requestId}'`,
    "route_child_claimed");
  refuses("ordinary payment command cannot reuse a Route child obligation",
    `select id from public.couranr_create_payment_obligation(
      '${a.requestId}','${biz}','ordinary-bypass')`,
    "route_child_payment_owned_by_settlement");
  refuses("ordinary payer link cannot be minted for a Route child",
    `select id from public.couranr_issue_payment_access_token(
      '${a.requestId}','${checkout.items[0].obligationId}',repeat('a',64),7)`,
    "route_child_payment_owned_by_settlement");
  check("checkout creates no service plans",one("select count(*) from public.couranr_service_plans"),"0");
  check("checkout creates no deliveries",one("select count(*) from public.couranr_deliveries"),"0");
  check("checkout creates no assignments",one("select count(*) from public.couranr_delivery_assignments"),"0");
  check("checkout creates no provider intent ids",one("select count(*) from public.couranr_payment_obligations where provider_payment_intent_id is not null"),"0");
  check("idempotent checkout replay returns same settlement",
    JSON.parse(one(`select public.couranr_begin_route_run_checkout('${biz}','${owner}','${route}',1,'${checkoutKey}')`)).settlementId,
    checkout.settlementId);
  refuses("different checkout key cannot reinterpret started checkout",
    `select public.couranr_begin_route_run_checkout('${biz}','${owner}','${route}',1,'${randomUUID()}')`,
    "route_checkout_already_started");
  refuses("accepted Route release is blocked after checkout obligations exist",
    `select public.couranr_cancel_accepted_route_run('${biz}','${owner}','${route}',1,'${randomUUID()}')`,
    "route_cancel_downstream_started");

  refuses("second child cannot authorize before the first",
    `select public.couranr_begin_route_child_authorization(
      '${biz}','${owner}','${route}','${checkout.items[1].obligationId}')`,
    "route_authorization_order_conflict");
  const firstAttempt=JSON.parse(one(`select public.couranr_begin_route_child_authorization(
    '${biz}','${owner}','${route}','${checkout.items[0].obligationId}')`));
  check("first provider attempt pins exact obligation amount",firstAttempt.amountCents,checkout.items[0].amountCents);
  check("provider attempt key is durable across retries",
    JSON.parse(one(`select public.couranr_begin_route_child_authorization(
      '${biz}','${owner}','${route}','${checkout.items[0].obligationId}')`)).idempotencyKey,
    firstAttempt.idempotencyKey);
  check("provider attempt uses frozen saved card",firstAttempt.stripePaymentMethodId,"pm_rr003fixture");

  refuses("an unattempted sibling cannot be called provider-unknown",
    `select public.couranr_mark_route_settlement_provider_unknown(
      '${biz}','${owner}','${route}','${checkout.items[1].obligationId}','no provider call')`,
    "route_settlement_unknown_item_invalid");

  refuses("provider uncertainty cannot name a foreign obligation",
    `select public.couranr_mark_route_settlement_provider_unknown(
      '${biz}','${owner}','${route}','${randomUUID()}','provider timeout')`,
    "route_settlement_unknown_item_invalid");
  const uncertainItem=checkout.items[0];
  const unknown=JSON.parse(one(`select public.couranr_mark_route_settlement_provider_unknown(
    '${biz}','${owner}','${route}','${uncertainItem.obligationId}','provider timeout')`));
  check("provider uncertainty is durable",unknown.state,"authorization_unknown");
  check("ordinary sync cannot clear an unreconciled unknown",
    JSON.parse(one(`select public.couranr_sync_route_run_settlement(
      '${biz}','${owner}','${route}',false)`)).state,"authorization_unknown");
  refuses("a true flag alone cannot fake provider reconciliation",
    `select public.couranr_sync_route_run_settlement('${biz}','${owner}','${route}',true)`,
    "route_settlement_provider_reconciliation_evidence_required");
  check("unknown retry uses the SAME provider attempt, never a new key",
    JSON.parse(one(`select public.couranr_begin_route_child_authorization(
      '${biz}','${owner}','${route}','${uncertainItem.obligationId}')`)).idempotencyKey,
    firstAttempt.idempotencyKey);

  for(const item of checkout.items){
    if(item.sequence===2){
      const second=JSON.parse(one(`select public.couranr_begin_route_child_authorization(
        '${biz}','${owner}','${route}','${item.obligationId}')`));
      check("second provider attempt starts only after first was verified",second.outcome,"attempt_ready");
    }
    const pi=`pi_${item.sequence}rr003b`;
    one(`select id from public.couranr_attach_payment_intent(
      '${item.obligationId}',${item.obligationVersion},'${pi}')`);
    const meta=JSON.stringify({
      paymentObligationId:item.obligationId,
      couranrRequestId:item.requestId,
      businessAccountId:biz,
      quoteVersionId:item.quoteVersionId,
      payerType:"merchant",
      pricingPolicyVersion:"couranr-pricing-v2-2026-09-01"
    }).replaceAll("'","''");
    one(`select outcome from public.couranr_apply_payment_intent_state(
      'rr003b-auth-${item.sequence}','payment_intent.amount_capturable_updated','${pi}',
      'requires_capture',${item.amountCents},${item.amountCents},'usd','${meta}'::jsonb,now())`);
    if(item.sequence===1){
      check("verified provider event clears unknown but waits for later children",
        JSON.parse(one(`select public.couranr_sync_route_run_settlement(
          '${biz}','${owner}','${route}',true)`)).state,"pending_authorization");
    }
  }
  check("all child authorizations make settlement authorized",
    JSON.parse(one(`select public.couranr_sync_route_run_settlement('${biz}','${owner}','${route}',false)`)).state,
    "authorized");
  check("authorization still creates no canonical delivery",one("select count(*) from public.couranr_deliveries"),"0");
  refuses("unknown marker cannot downgrade an already-authorized Route",
    `select public.couranr_mark_route_settlement_provider_unknown(
      '${biz}','${owner}','${route}','${uncertainItem.obligationId}','late timeout')`,
    "route_settlement_unknown_state_invalid");
  const held=checkout.items[0], failed=checkout.items[1];
  const heldVersion=Number(one(`select version from public.couranr_payment_obligations where id='${held.obligationId}'`));
  refuses("merchant cannot release a healthy Route authorization",
    `select outcome from public.couranr_begin_payment_release(
      '${held.obligationId}','${owner}',${heldVersion},'Route failed')`,
    "route_release_requires_failed_settlement");
  const failedMeta=JSON.stringify({
    paymentObligationId:failed.obligationId,couranrRequestId:failed.requestId,
    businessAccountId:biz,quoteVersionId:failed.quoteVersionId
  }).replaceAll("'","''");
  check("canonical provider failure is recorded for the later child",
    one(`select outcome from public.couranr_apply_payment_intent_state(
      'rr003b-decline-later','payment_intent.payment_failed','pi_2rr003b',
      'requires_payment_method',${failed.amountCents},0,'usd','${failedMeta}'::jsonb,now())`),"applied");
  check("partial authorization plus failure requires recovery",
    JSON.parse(one(`select public.couranr_sync_route_run_settlement('${biz}','${owner}','${route}',false)`)).state,
    "recovery_required");
  refuses("dispatcher cannot release a failed Route hold",
    `select outcome from public.couranr_begin_payment_release(
      '${held.obligationId}','${dispatcher}',${heldVersion},'Route failed')`,
    "route_checkout_access_denied");
  check("Route release reuses the canonical hold-release command",
    one(`select outcome from public.couranr_begin_payment_release(
      '${held.obligationId}','${owner}',${heldVersion},'Known later-child decline')`),"applied");
  check("canonical completion records the cancelled hold",
    one(`select outcome from public.couranr_complete_payment_release(
      '${held.obligationId}','pi_1rr003b','canceled')`),"applied");
  check("recovery converges to failed checkout after all holds are released",
    JSON.parse(one(`select public.couranr_sync_route_run_settlement('${biz}','${owner}','${route}',false)`)).state,
    "authorization_failed");
  refuses("semantic rollback refuses checkout history",rollback,"route_settlement_rollback_refuses_semantic_use");
  check("failed rollback preserves settlement",one("select count(*) from public.couranr_route_run_settlements"),"1");

  // Two older stalled checkouts must not monopolize the bounded maintenance
  // batch while a later capture/recovery checkout needs attention.
  async function additionalCheckout(marker,state){
    const left=await child(`${marker}-left`,1800),right=await child(`${marker}-right`,2200);
    const id=randomUUID();
    one(`select public.couranr_save_route_run_draft(
      '${biz}','${owner}','${id}',0,'${randomUUID()}','${marker}',
      array['${left.requestId}','${right.requestId}']::uuid[])`);
    one(`select public.couranr_accept_route_run('${biz}','${owner}','${id}',1,'${randomUUID()}')`);
    one(`select public.couranr_begin_route_run_checkout('${biz}','${owner}','${id}',1,'${randomUUID()}')`);
    one(`update public.couranr_route_run_settlements set settlement_state='${state}'
      where route_run_id='${id}'`);
    return id;
  }
  const stuck=await additionalCheckout("rr003b-stuck","recovery_required");
  const later=await additionalCheckout("rr003b-later","capture_pending");
  const firstBatch=one("select route_run_id from public.couranr_claim_route_checkout_maintenance(2) order by route_run_id").split("\n");
  const nextBatch=one("select route_run_id from public.couranr_claim_route_checkout_maintenance(2) order by route_run_id").split("\n");
  check("bounded maintenance rotates past two older stalled settlements",
    new Set([...firstBatch,...nextBatch]).has(later),true);
  check("failed and recovery checkouts remain in the compensating worker queue",
    new Set([...firstBatch,...nextBatch]).has(route) &&
      new Set([...firstBatch,...nextBatch]).has(stuck),true);

  console.log(`RR-003b Settlement ${checks}/${checks} PASS (disposable PostgreSQL; no provider calls).`);
}finally{down({quiet:true})}

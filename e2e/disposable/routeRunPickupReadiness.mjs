import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { up, down, psql } from "./up.mjs";
import { psqlTransport, seedCanonicalQuotedRequest } from "./gateAFixtures.mjs";

const ROOT=fileURLToPath(new URL("../../",import.meta.url));
const forward=readFileSync(resolve(ROOT,"supabase/migrations/20260930161610_route_run_pickup_readiness.sql"),"utf8");
const rollback=readFileSync(resolve(ROOT,"supabase/rollbacks/20260930161610_route_run_pickup_readiness.rollback.sql"),"utf8");
const one=(q)=>psql(q).trim();
const esc=(s)=>String(s).replaceAll("'","''");
let checks=0;
function check(name,actual,expected){assert.deepEqual(actual,expected,name);checks++;console.log("PASS",name);}
function refuses(name,q,marker){let error="";try{one(q)}catch(e){error=String(e.stderr||e.message)}assert.ok(error.includes(marker),`${name}: expected ${marker}, got ${error||"success"}`);checks++;console.log("PASS",name);}

try {
  const info=up({quiet:true,throughMigration:"20260930161610_route_run_pickup_readiness.sql"});
  console.log(`RR-003d readiness: ${info.migrationsApplied} migrations applied`);
  one(rollback);
  check("empty rollback removes Route readiness command",
    one("select to_regprocedure('public.couranr_confirm_route_pickup_ready(uuid,uuid,uuid,integer,boolean)') is null"),"t");
  one(forward);
  check("forward reapplies after empty rollback",
    one("select to_regprocedure('public.couranr_confirm_route_pickup_ready(uuid,uuid,uuid,integer,boolean)') is not null"),"t");
  check("browser roles cannot execute Route readiness directly",
    one(`select has_function_privilege('anon',
      'public.couranr_confirm_route_pickup_ready(uuid,uuid,uuid,integer,boolean)','execute')
      or has_function_privilege('authenticated',
      'public.couranr_confirm_route_pickup_ready(uuid,uuid,uuid,integer,boolean)','execute')`),"f");

  const biz=one("insert into public.business_accounts(name,status) values('RR003d shop','active') returning id");
  const owner=one("insert into auth.users(email) values('rr003d-owner@example.test') returning id");
  const viewer=one("insert into auth.users(email) values('rr003d-viewer@example.test') returning id");
  one(`insert into public.business_members(business_account_id,user_id,role,status) values
    ('${biz}','${owner}','owner','active'),('${biz}','${viewer}','viewer','active')`);
  const transport=psqlTransport(psql);
  async function child(marker,subtotal){
    const c=await seedCanonicalQuotedRequest(transport,{businessId:biz,actorUserId:owner,
      marker,upTo:"draft",weightLb:20,subtotalCents:subtotal});
    one(`select id from public.couranr_set_business_pickup_manifest(
      '${c.requestId}','${biz}','${owner}',0,'Package ${esc(marker)}',1,'${esc(marker)}',null)`);
    const dv=JSON.parse(one(`select public.couranr_record_business_declared_value(
      '${biz}','${owner}','${c.requestId}',${c.version},10000)`));
    return {...c,version:dv.version};
  }
  const a=await child("rr003d-a",1800),b=await child("rr003d-b",2200);
  const route=randomUUID();
  one(`select public.couranr_save_route_run_draft('${biz}','${owner}','${route}',0,
    '${randomUUID()}','Ready route',array['${a.requestId}','${b.requestId}']::uuid[])`);
  one(`select public.couranr_accept_route_run('${biz}','${owner}','${route}',1,'${randomUUID()}')`);
  one(`insert into public.couranr_business_payment_profiles(
    business_account_id,stripe_customer_id,stripe_customer_livemode,current_generation,
    default_payment_method_id,default_setup_intent_id,card_brand,card_last4)
    values('${biz}','cus_rr003dfixture',false,1,'pm_rr003dfixture','seti_rr003dfixture','visa','4242')`);
  const checkout=JSON.parse(one(`select public.couranr_begin_route_run_checkout(
    '${biz}','${owner}','${route}',1,'${randomUUID()}')`));
  const ready=`select public.couranr_confirm_route_pickup_ready('${biz}','${owner}','${route}',1,true)`;
  refuses("pickup cannot be attested before every child authorization",ready,
    "route_pickup_requires_authorization");
  check("premature attempt does not change either child",
    one(`select count(*) from public.couranr_delivery_requests where id in
      ('${a.requestId}','${b.requestId}') and readiness_state='ready'`),"0");

  for(const item of checkout.items){
    one(`select public.couranr_begin_route_child_authorization(
      '${biz}','${owner}','${route}','${item.obligationId}')`);
    const pi=`pi_rr003d${item.sequence}`;
    one(`select id from public.couranr_attach_payment_intent(
      '${item.obligationId}',${item.obligationVersion},'${pi}')`);
    const metadata=JSON.stringify({paymentObligationId:item.obligationId,
      couranrRequestId:item.requestId,businessAccountId:biz,
      quoteVersionId:item.quoteVersionId,payerType:"merchant",
      pricingPolicyVersion:"couranr-pricing-v2-2026-09-01"}).replaceAll("'","''");
    one(`select outcome from public.couranr_apply_payment_intent_state(
      'rr003d-auth-${item.sequence}','payment_intent.amount_capturable_updated','${pi}',
      'requires_capture',${item.amountCents},${item.amountCents},'usd',
      '${metadata}'::jsonb,now())`);
  }
  check("provider-verified child holds authorize the Route",
    JSON.parse(one(`select public.couranr_sync_route_run_settlement(
      '${biz}','${owner}','${route}',false)`)).state,"authorized");
  refuses("acknowledgement is mandatory",
    `select public.couranr_confirm_route_pickup_ready('${biz}','${owner}','${route}',1,false)`,
    "route_pickup_confirmation_required");
  refuses("viewer cannot attest merchant cargo",
    `select public.couranr_confirm_route_pickup_ready('${biz}','${viewer}','${route}',1,true)`,
    "route_checkout_access_denied");
  refuses("stale Route generation cannot attest",
    `select public.couranr_confirm_route_pickup_ready('${biz}','${owner}','${route}',2,true)`,
    "route_version_conflict");
  check("one explicit acknowledgement readies both children atomically",
    JSON.parse(one(ready)).childCount,2);
  check("both children use the existing pickup-readiness state",
    one(`select count(*) from public.couranr_delivery_requests where id in
      ('${a.requestId}','${b.requestId}') and readiness_state='ready'`),"2");
  check("readiness advanced request CAS without changing accepted quote identity",
    one(`select count(*) from public.couranr_delivery_requests q
      join public.couranr_route_run_settlement_items i on i.request_id=q.id
      where i.settlement_id='${checkout.settlementId}'
        and q.current_quote_version_id=i.quote_version_id and q.version>1`),"2");
  check("existing readiness audit command recorded each child",
    one(`select count(*) from public.couranr_delivery_request_events e
      where e.request_id in ('${a.requestId}','${b.requestId}')
        and e.command='mark_delivery_ready'`),"2");
  refuses("replay cannot silently reaffirm later readiness",ready,"route_pickup_already_confirmed");
  refuses("standalone child mutation remains blocked",
    `update public.couranr_delivery_requests set readiness_state='not_ready'
      where id='${a.requestId}'`,"route_child_claimed");
  refuses("ordinary readiness RPC cannot bypass Route ownership",
    `select public.couranr_mark_delivery_not_ready('${a.requestId}','${biz}',
      (select version from public.couranr_delivery_requests where id='${a.requestId}'),'${owner}')`,
    "route_child_claimed");
  check("pickup readiness creates no service plan",one("select count(*) from public.couranr_service_plans"),"0");
  check("pickup readiness creates no delivery",one("select count(*) from public.couranr_deliveries"),"0");
  check("pickup readiness creates no capture",one("select count(*) from public.couranr_payment_obligations where payment_state='captured'"),"0");
  refuses("semantic rollback preserves merchant attestation",rollback,
    "route_pickup_readiness_rollback_refuses_semantic_use");
  console.log(`RR-003d Pickup Readiness ${checks}/${checks} PASS (disposable PostgreSQL; no provider calls).`);
} finally { down({quiet:true}); }

/** RR-003d: Route-owned canonical plans; no payment capture or delivery. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { up, down, psql } from "./up.mjs";
import { psqlTransport, seedCanonicalQuotedRequest } from "./gateAFixtures.mjs";

const ROOT=fileURLToPath(new URL("../../",import.meta.url));
const forward=readFileSync(resolve(ROOT,"supabase/migrations/20260930163000_route_run_service_plans.sql"),"utf8");
const rollback=readFileSync(resolve(ROOT,"supabase/rollbacks/20260930163000_route_run_service_plans.rollback.sql"),"utf8");
const one=(sql)=>psql(sql).trim();
const esc=(x)=>String(x).replaceAll("'","''");
let checks=0;
function check(label,actual,expected){assert.deepEqual(actual,expected,label);checks++;console.log("PASS",label);}
function refuses(label,sql,marker){let error="";try{one(sql)}catch(e){error=String(e.stderr||e.message)}assert.ok(error.includes(marker),`${label}: expected ${marker}, got ${error||"success"}`);checks++;console.log("PASS",label);}

try {
  const info=up({quiet:true,throughMigration:"20260930163000_route_run_service_plans.sql"});
  console.log(`RR-003d plans: ${info.migrationsApplied} migrations applied`);
  one(rollback);
  check("empty rollback removes Route plan command",
    one("select to_regprocedure('public.couranr_confirm_route_service_plans(uuid,uuid,uuid,integer)') is null"),"t");
  one(forward);
  check("forward reapplies after empty rollback",
    one("select to_regprocedure('public.couranr_confirm_route_service_plans(uuid,uuid,uuid,integer)') is not null"),"t");
  check("anon and authenticated cannot call Route planning directly",
    one(`select has_function_privilege('anon',
      'public.couranr_confirm_route_service_plans(uuid,uuid,uuid,integer)','execute')
      or has_function_privilege('authenticated',
      'public.couranr_confirm_route_service_plans(uuid,uuid,uuid,integer)','execute')`),"f");

  const biz=one("insert into public.business_accounts(name,status) values('RR003d plan shop','active') returning id");
  const owner=one("insert into auth.users(email) values('rr003d-plan-owner@example.test') returning id");
  const viewer=one("insert into auth.users(email) values('rr003d-plan-viewer@example.test') returning id");
  const driverUser=one("insert into auth.users(email) values('rr003d-plan-driver@example.test') returning id");
  one(`insert into public.business_members(business_account_id,user_id,role,status) values
    ('${biz}','${owner}','owner','active'),('${biz}','${viewer}','viewer','active')`);
  const transport=psqlTransport(psql);
  async function child(marker){
    const c=await seedCanonicalQuotedRequest(transport,{businessId:biz,actorUserId:owner,
      marker,upTo:"draft",weightLb:20,subtotalCents:2000});
    one(`select id from public.couranr_set_business_pickup_manifest(
      '${c.requestId}','${biz}','${owner}',0,'Package ${esc(marker)}',1,'${esc(marker)}',null)`);
    const dv=JSON.parse(one(`select public.couranr_record_business_declared_value(
      '${biz}','${owner}','${c.requestId}',${c.version},10000)`));
    return {...c,version:dv.version};
  }
  const a=await child("rr003d-plan-a"),b=await child("rr003d-plan-b");
  const route=randomUUID();
  one(`select public.couranr_save_route_run_draft('${biz}','${owner}','${route}',0,
    '${randomUUID()}','Plan route',array['${a.requestId}','${b.requestId}']::uuid[])`);
  one(`select public.couranr_accept_route_run('${biz}','${owner}','${route}',1,'${randomUUID()}')`);
  one(`insert into public.couranr_business_payment_profiles(
    business_account_id,stripe_customer_id,stripe_customer_livemode,current_generation,
    default_payment_method_id,default_setup_intent_id,card_brand,card_last4)
    values('${biz}','cus_rr003dplan',false,1,'pm_rr003dplan','seti_rr003dplan','visa','4242')`);
  const checkout=JSON.parse(one(`select public.couranr_begin_route_run_checkout(
    '${biz}','${owner}','${route}',1,'${randomUUID()}')`));
  const plan=`select public.couranr_confirm_route_service_plans('${biz}','${owner}','${route}',1)`;
  refuses("planning before full authorization fails",plan,"route_plan_requires_live_resource");
  for(const item of checkout.items){
    one(`select public.couranr_begin_route_child_authorization(
      '${biz}','${owner}','${route}','${item.obligationId}')`);
    const pi=`pi_rr003dplan${item.sequence}`;
    one(`select id from public.couranr_attach_payment_intent(
      '${item.obligationId}',${item.obligationVersion},'${pi}')`);
    const metadata=JSON.stringify({paymentObligationId:item.obligationId,
      couranrRequestId:item.requestId,businessAccountId:biz,
      quoteVersionId:item.quoteVersionId,payerType:"merchant",
      pricingPolicyVersion:"couranr-pricing-v2-2026-09-01"}).replaceAll("'","''");
    check(`verified authorization stop ${item.sequence}`,
      one(`select outcome from public.couranr_apply_payment_intent_state(
        'rr003d-plan-auth-${item.sequence}','payment_intent.amount_capturable_updated',
        '${pi}','requires_capture',${item.amountCents},${item.amountCents},'usd',
        '${metadata}'::jsonb,now())`),"applied");
  }
  check("Route fully authorized",
    JSON.parse(one(`select public.couranr_sync_route_run_settlement(
      '${biz}','${owner}','${route}',false)`)).state,"authorized");
  check("explicit readiness attestation for both child packages",
    JSON.parse(one(`select public.couranr_confirm_route_pickup_ready(
      '${biz}','${owner}','${route}',1,true)`)).childCount,2);
  refuses("planning without one Route resource fails",plan,"route_plan_requires_live_resource");
  refuses("ordinary Operations-style plan cannot take a claimed child",
    `select id from public.couranr_confirm_service_plan(
      '${a.requestId}',(select version from public.couranr_delivery_requests where id='${a.requestId}'),
      '${owner}',now()+interval '30 minutes',now()+interval '60 minutes',
      'America/New_York',null,'{"vehicleClass":"van","maxPayloadLb":100}'::jsonb)`,
    "route_child_plan_owned_by_route");
  const driver=one(`insert into public.couranr_drivers(
    user_id,display_name,driver_state,availability_state,active,market)
    values('${driverUser}','RR003d Plan Driver','active','available',true,
      'dc_va_launch_corridor') returning id`);
  const vehicle=one(`insert into public.couranr_dispatch_vehicles(
    name,vehicle_class,payload_capacity_lb,active,availability_state)
    values('RR003d Plan Van','van',100,true,'available') returning id`);
  const resource=JSON.parse(one(`select public.couranr_reserve_route_run_resource(
    '${biz}','${owner}','${route}',now())`));
  check("resource selected by server",resource.driverId,driver);
  check("resource vehicle selected by server",resource.vehicleId,vehicle);
  refuses("viewer cannot confirm Route service plan",
    `select public.couranr_confirm_route_service_plans('${biz}','${viewer}','${route}',1)`,
    "route_checkout_access_denied");
  refuses("stale Route version cannot confirm plans",
    `select public.couranr_confirm_route_service_plans('${biz}','${owner}','${route}',2)`,
    "route_version_conflict");
  check("one command creates canonical plan per child",JSON.parse(one(plan)).childCount,2);
  check("both plans share one exact pickup window",
    one(`select count(distinct (scheduled_pickup_start,scheduled_pickup_end,timezone))
      from public.couranr_service_plans where route_run_id='${route}'`),"1");
  check("both plans pin the exact Route version and resource vehicle",
    one(`select count(*) from public.couranr_service_plans p
      join public.couranr_route_run_settlement_items i on i.request_id=p.request_id
      where p.route_run_id='${route}' and p.route_version_id=(
        select route_version_id from public.couranr_route_run_settlements where route_run_id='${route}')
        and p.payment_obligation_id=i.obligation_id and p.quote_version_id=i.quote_version_id
        and p.vehicle_id='${vehicle}' and p.plan_source='route_run'`),"2");
  check("planning retry returns same two plans",JSON.parse(one(plan)).outcome,"already_planned");
  check("planning creates no deliveries",one("select count(*) from public.couranr_deliveries"),"0");
  check("planning captures no money",one("select count(*) from public.couranr_payment_obligations where payment_state='captured'"),"0");
  refuses("Route plan identity cannot be edited",
    `update public.couranr_service_plans set route_run_id=null
      where route_run_id='${route}'`,"route_plan_identity_immutable");
  refuses("ordinary plan cancellation cannot dismantle an accepted Route",
    `update public.couranr_service_plans set plan_state='cancelled'
      where route_run_id='${route}'`,"route_plan_lifecycle_owned_by_route");
  refuses("semantic rollback retains Route commitments",rollback,
    "route_service_plan_rollback_refuses_semantic_use");
  console.log(`RR-003d Service Plans ${checks}/${checks} PASS (disposable PostgreSQL; no provider calls).`);
} finally { down({quiet:true}); }

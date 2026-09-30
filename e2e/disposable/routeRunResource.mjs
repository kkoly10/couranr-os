/** RR-003c: provider-free Route resource, aggregate cargo and ordinary-dispatch exclusion. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { up, down, psql } from "./up.mjs";
import { psqlTransport, seedCanonicalQuotedRequest, seedCanonicalPaymentObligation,
  seedCanonicalServicePlan } from "./gateAFixtures.mjs";

const ROOT=fileURLToPath(new URL("../../",import.meta.url));
const forward=readFileSync(resolve(ROOT,"supabase/migrations/20260930150000_couranr_route_run_resource_reservation.sql"),"utf8");
const rollback=readFileSync(resolve(ROOT,"supabase/rollbacks/20260930150000_couranr_route_run_resource_reservation.rollback.sql"),"utf8");
const one=(q)=>psql(q).trim();
const esc=(s)=>String(s).replaceAll("'","''");
let checks=0;
const check=(label,actual,expected)=>{assert.deepEqual(actual,expected,label);checks++;console.log("PASS",label);};
function refuses(label,sql,marker){
  let error="";
  try{one(sql)}catch(e){error=String(e.stderr||e.message)}
  assert.ok(error.includes(marker),`${label}: expected ${marker}; ${error||"unexpected success"}`);
  checks++;console.log("PASS",label);
}
try{
  const info=up({quiet:true});
  console.log(`RR-003c resource: ${info.migrationsApplied} migrations applied`);
  one(rollback);
  check("empty resource rollback removes only Route resource tables",
    one("select to_regclass('public.couranr_route_run_resource_reservations') is null and to_regclass('public.couranr_route_run_settlements') is not null"),"t");
  one(forward);
  check("resource forward reapplies",one("select to_regclass('public.couranr_route_run_resource_reservations') is not null"),"t");
  const biz=one("insert into public.business_accounts(name,status) values('RR003c shop','active') returning id");
  const owner=one("insert into auth.users(email) values('rr003c-owner@example.test') returning id");
  const dispatcher=one("insert into auth.users(email) values('rr003c-dispatcher@example.test') returning id");
  const driverUser=one("insert into auth.users(email) values('rr003c-driver@example.test') returning id");
  one(`insert into public.business_members(business_account_id,user_id,role,status) values
    ('${biz}','${owner}','owner','active'),('${biz}','${dispatcher}','dispatcher','active')`);
  const transport=psqlTransport(psql);
  async function child(marker,weight,packages){
    const c=await seedCanonicalQuotedRequest(transport,{
      businessId:biz,actorUserId:owner,marker,upTo:"draft",weightLb:weight,
      subtotalCents:2000,
    });
    one(`select id from public.couranr_set_business_pickup_manifest(
      '${c.requestId}','${biz}','${owner}',0,'Package ${esc(marker)}',${packages},'${esc(marker)}',null)`);
    const dv=JSON.parse(one(`select public.couranr_record_business_declared_value(
      '${biz}','${owner}','${c.requestId}',${c.version},10000)`));
    return {...c,version:dv.version};
  }
  async function acceptedPaidRoute(marker){
    const a=await child(`${marker}-a`,20,2),b=await child(`${marker}-b`,25,1);
    const route=randomUUID();
    one(`select public.couranr_save_route_run_draft(
      '${biz}','${owner}','${route}',0,'${randomUUID()}','${esc(marker)}',
      array['${a.requestId}','${b.requestId}']::uuid[])`);
    one(`select public.couranr_accept_route_run(
      '${biz}','${owner}','${route}',1,'${randomUUID()}')`);
    const settlement=JSON.parse(one(`select public.couranr_begin_route_run_checkout(
      '${biz}','${owner}','${route}',1,'${randomUUID()}')`));
    for(const item of settlement.items){
      const pi=`pi_${marker.replaceAll("-","")}${item.sequence}`;
      one(`select id from public.couranr_attach_payment_intent(
        '${item.obligationId}',${item.obligationVersion},'${pi}')`);
      const metadata=JSON.stringify({
        paymentObligationId:item.obligationId,couranrRequestId:item.requestId,
        businessAccountId:biz,quoteVersionId:item.quoteVersionId,
      }).replaceAll("'","''");
      check(`canonical authorization ${marker} stop ${item.sequence}`,
        one(`select outcome from public.couranr_apply_payment_intent_state(
          '${marker}-auth-${item.sequence}','payment_intent.amount_capturable_updated',
          '${pi}','requires_capture',${item.amountCents},${item.amountCents},
          'usd','${metadata}'::jsonb,now())`),"applied");
    }
    check(`settlement ${marker} fully authorized`,
      JSON.parse(one(`select public.couranr_sync_route_run_settlement(
        '${biz}','${owner}','${route}',false)`)).state,"authorized");
    return {route,settlement,a,b};
  }
  one(`insert into public.couranr_business_payment_profiles(
    business_account_id,stripe_customer_id,stripe_customer_livemode,
    current_generation,default_payment_method_id,default_setup_intent_id,
    card_brand,card_last4
  ) values('${biz}','cus_rr003cfixture',false,1,
    'pm_rr003cfixture','seti_rr003cfixture','visa','4242')`);
  const driver=one(`insert into public.couranr_drivers(
    user_id,display_name,driver_state,availability_state,active,market)
    values('${driverUser}','RR003c Driver','active','available',true,
      'dc_va_launch_corridor') returning id`);
  const vehicle=one(`insert into public.couranr_dispatch_vehicles(
    name,vehicle_class,payload_capacity_lb,active,availability_state)
    values('RR003c Van','van',100,true,'available') returning id`);
  const first=await acceptedPaidRoute("rr003c-first");
  refuses("dispatcher cannot reserve the Route resource",
    `select public.couranr_reserve_route_run_resource(
      '${biz}','${dispatcher}','${first.route}',now())`,
    "route_checkout_access_denied");
  const reserved=JSON.parse(one(`select public.couranr_reserve_route_run_resource(
    '${biz}','${owner}','${first.route}',now())`));
  check("one compatible resource reserved",reserved.outcome,"reserved");
  check("aggregate payload is SUM, not max child",Number(reserved.totalPayloadLb),45);
  check("aggregate package count is exact",reserved.packageCount,3);
  check("selected driver is server-owned",reserved.driverId,driver);
  check("selected vehicle is server-owned",reserved.vehicleId,vehicle);
  check("idempotent retry returns the same resource",
    JSON.parse(one(`select public.couranr_reserve_route_run_resource(
      '${biz}','${owner}','${first.route}',now())`)).resourceId,reserved.resourceId);
  check("Route resource alone creates no delivery or assignment",
    one("select count(*) from public.couranr_deliveries")+","+
      one("select count(*) from public.couranr_delivery_assignments"),"0,0");

  const ordinary=await seedCanonicalQuotedRequest(transport,{
    businessId:biz,actorUserId:owner,marker:"rr003c-ordinary",upTo:"confirmed",
  });
  const ordinaryOb=await seedCanonicalPaymentObligation(transport,ordinary);
  const ordinaryPlan=await seedCanonicalServicePlan(transport,ordinary);
  check("ordinary fixture authorized",ordinaryOb.paymentState,"authorized");
  refuses("ordinary reservation cannot take Route driver or vehicle",
    `insert into public.couranr_dispatch_reservations(
      request_id,service_plan_id,driver_id,vehicle_id,expires_at)
      values('${ordinary.requestId}','${ordinaryPlan.planId}',
        '${driver}','${vehicle}',now()+interval '5 minutes')`,
    "resource_owned_by_route_run");
  const second=await acceptedPaidRoute("rr003c-second");
  const noResource=JSON.parse(one(`select public.couranr_reserve_route_run_resource(
    '${biz}','${owner}','${second.route}',now())`));
  check("second Route cannot steal the first resource",noResource.outcome,"unavailable");
  check("resource-unavailable Route remains financially blocked",
    noResource.settlementState,"recovery_required");
  check("settlement refresh cannot silently re-arm unavailable Route",
    JSON.parse(one(`select public.couranr_sync_route_run_settlement(
      '${biz}','${owner}','${second.route}',false)`)).state,"recovery_required");
  check("one live driver ownership",one("select count(*) from public.couranr_route_run_resource_reservations where resource_state='reserved'"),"1");
  check("resource RLS enabled",one("select relrowsecurity from pg_class where oid='public.couranr_route_run_resource_reservations'::regclass"),"t");
  check("anon cannot execute reservation RPC",one("select has_function_privilege('anon','public.couranr_reserve_route_run_resource(uuid,uuid,uuid,timestamptz)','EXECUTE')"),"f");
  check("authenticated cannot read resource rows",one("select has_table_privilege('authenticated','public.couranr_route_run_resource_reservations','SELECT')"),"f");
  refuses("semantic rollback preserves reserved resource",rollback,"route_resource_rollback_refuses_semantic_use");
  check("failed rollback preserves resource",one("select count(*) from public.couranr_route_run_resource_reservations"),"1");
  console.log(`RR-003c Resource ${checks}/${checks} PASS (disposable PostgreSQL; no provider calls).`);
}finally{down({quiet:true})}

/** RR-003d capture admission with fake provider evidence in disposable PG. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { up, down, psql } from "./up.mjs";
import { psqlTransport, seedCanonicalQuotedRequest } from "./gateAFixtures.mjs";

const ROOT=fileURLToPath(new URL("../../",import.meta.url));
const forward=readFileSync(resolve(ROOT,"supabase/migrations/20260930164659_route_run_capture_gate.sql"),"utf8");
const rollback=readFileSync(resolve(ROOT,"supabase/rollbacks/20260930164659_route_run_capture_gate.rollback.sql"),"utf8");
const one=(sql)=>psql(sql).trim();
const esc=(x)=>String(x).replaceAll("'","''");
let checks=0;
function check(label,actual,expected){assert.deepEqual(actual,expected,label);checks++;console.log("PASS",label);}
function refuses(label,sql,marker){let error="";try{one(sql)}catch(e){error=String(e.stderr||e.message)}assert.ok(error.includes(marker),`${label}: expected ${marker}, got ${error||"success"}`);checks++;console.log("PASS",label);}

try {
  const info=up({quiet:true,throughMigration:"20260930164659_route_run_capture_gate.sql"});
  console.log(`RR-003d capture: ${info.migrationsApplied} migrations applied`);
  one(rollback);
  check("empty rollback removes Route capture command",
    one("select to_regprocedure('public.couranr_begin_route_run_capture(uuid,uuid,uuid,integer)') is null"),"t");
  one(forward);
  check("forward reapplies after empty rollback",
    one("select to_regprocedure('public.couranr_begin_route_run_capture(uuid,uuid,uuid,integer)') is not null"),"t");
  check("browser roles cannot execute Route capture",
    one(`select has_function_privilege('anon',
      'public.couranr_begin_route_run_capture(uuid,uuid,uuid,integer)','execute')
      or has_function_privilege('authenticated',
      'public.couranr_begin_route_child_capture(uuid,uuid,uuid,uuid)','execute')`),"f");

  const biz=one("insert into public.business_accounts(name,status) values('RR003d capture shop','active') returning id");
  const owner=one("insert into auth.users(email) values('rr003d-capture-owner@example.test') returning id");
  const driverUser=one("insert into auth.users(email) values('rr003d-capture-driver@example.test') returning id");
  const driver2User=one("insert into auth.users(email) values('rr003d-capture-driver2@example.test') returning id");
  one(`insert into public.business_members(business_account_id,user_id,role,status)
    values('${biz}','${owner}','owner','active')`);
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
  const a=await child("rr003d-capture-a"),b=await child("rr003d-capture-b");
  const route=randomUUID();
  one(`select public.couranr_save_route_run_draft('${biz}','${owner}','${route}',0,
    '${randomUUID()}','Capture route',array['${a.requestId}','${b.requestId}']::uuid[])`);
  one(`select public.couranr_accept_route_run('${biz}','${owner}','${route}',1,'${randomUUID()}')`);
  one(`insert into public.couranr_business_payment_profiles(
    business_account_id,stripe_customer_id,stripe_customer_livemode,current_generation,
    default_payment_method_id,default_setup_intent_id,card_brand,card_last4)
    values('${biz}','cus_rr003dcapture',false,1,'pm_rr003dcapture','seti_rr003dcapture','visa','4242')`);
  const checkout=JSON.parse(one(`select public.couranr_begin_route_run_checkout(
    '${biz}','${owner}','${route}',1,'${randomUUID()}')`));
  for(const item of checkout.items){
    one(`select public.couranr_begin_route_child_authorization(
      '${biz}','${owner}','${route}','${item.obligationId}')`);
    const pi=`pi_rr003dcapture${item.sequence}`;
    one(`select id from public.couranr_attach_payment_intent(
      '${item.obligationId}',${item.obligationVersion},'${pi}')`);
    const metadata=JSON.stringify({paymentObligationId:item.obligationId,
      couranrRequestId:item.requestId,businessAccountId:biz,
      quoteVersionId:item.quoteVersionId,payerType:"merchant",
      pricingPolicyVersion:"couranr-pricing-v2-2026-09-01"}).replaceAll("'","''");
    one(`select outcome from public.couranr_apply_payment_intent_state(
      'rr003d-capture-auth-${item.sequence}','payment_intent.amount_capturable_updated',
      '${pi}','requires_capture',${item.amountCents},${item.amountCents},'usd',
      '${metadata}'::jsonb,now())`);
  }
  check("two verified holds authorize settlement",
    JSON.parse(one(`select public.couranr_sync_route_run_settlement(
      '${biz}','${owner}','${route}',false)`)).state,"authorized");
  one(`select public.couranr_confirm_route_pickup_ready('${biz}','${owner}','${route}',1,true)`);
  const driver=one(`insert into public.couranr_drivers(
    user_id,display_name,driver_state,availability_state,active,market)
    values('${driverUser}','RR003d Capture Driver','active','available',true,
      'dc_va_launch_corridor') returning id`);
  const vehicle=one(`insert into public.couranr_dispatch_vehicles(
    name,vehicle_class,payload_capacity_lb,active,availability_state)
    values('RR003d Capture Van','van',100,true,'available') returning id`);
  const resource=JSON.parse(one(`select public.couranr_reserve_route_run_resource(
    '${biz}','${owner}','${route}',now())`));
  check("one Route resource is reserved",resource.outcome,"reserved");
  one(`select public.couranr_confirm_route_service_plans('${biz}','${owner}','${route}',1)`);
  refuses("rollback cannot reopen ordinary capture after Route checkout",
    rollback,"route_capture_gate_rollback_refuses_semantic_use");
  refuses("ordinary capture RPC cannot bypass Route resource commit",
    `select id from public.couranr_begin_payment_capture('${a.requestId}','${owner}')`,
    "route_child_capture_owned_by_route");
  check("bypass leaves child authorized",
    one(`select payment_state from public.couranr_payment_obligations
      where id='${checkout.items[0].obligationId}'`),"authorized");
  refuses("stale Route generation cannot begin capture",
    `select public.couranr_begin_route_run_capture('${biz}','${owner}','${route}',2)`,
    "route_version_conflict");
  const started=JSON.parse(one(`select public.couranr_begin_route_run_capture(
    '${biz}','${owner}','${route}',1)`));
  check("resource commit and capture gate happen together",started.outcome,"capture_started");
  check("resource is committed",
    one(`select resource_state from public.couranr_route_run_resource_reservations
      where route_run_id='${route}'`),"committed");
  check("capture start idempotent after lost response",
    JSON.parse(one(`select public.couranr_begin_route_run_capture(
      '${biz}','${owner}','${route}',1)`)).outcome,"already_started");
  refuses("second child cannot capture before first delivery exists",
    `select id from public.couranr_begin_route_child_capture(
      '${biz}','${owner}','${route}','${checkout.items[1].obligationId}')`,
    "route_capture_order_conflict");
  refuses("funding cannot claim success before child captures",
    `select public.couranr_complete_route_run_funding('${biz}','${owner}','${route}')`,
    "route_funding_child_capture_or_conversion_incomplete");
  for(const item of checkout.items){
    check(`child ${item.sequence} uses canonical capture_pending state`,
      one(`select payment_state from public.couranr_begin_route_child_capture(
        '${biz}','${owner}','${route}','${item.obligationId}')`),"capture_pending");
    refuses(`child ${item.sequence} second capture cannot call provider again`,
      `select id from public.couranr_begin_route_child_capture(
        '${biz}','${owner}','${route}','${item.obligationId}')`,
      "route_capture_child_not_authorized_or_in_flight");
    check(`fake provider success ${item.sequence} applies through canonical command`,
      one(`select outcome from public.couranr_complete_payment_capture(
        '${item.obligationId}','rr003d-capture-result-${item.sequence}',
        'pi_rr003dcapture${item.sequence}','succeeded',${item.amountCents},'usd')`),"applied");
    const delivery=one(`select id from public.couranr_create_delivery_from_capture('${item.requestId}')`);
    check(`child ${item.sequence} delivery pins Route identity`,
      one(`select route_run_id from public.couranr_deliveries where id='${delivery}'`),route);
    if(item.sequence===1){
      check("status refresh during normal sequential capture stays capture_pending",
        JSON.parse(one(`select public.couranr_sync_route_run_settlement(
          '${biz}','${owner}','${route}',false)`)).state,"capture_pending");
      const secondDriver=one(`insert into public.couranr_drivers(
        user_id,display_name,driver_state,availability_state,active,market)
        values('${driver2User}','RR003d Other Driver','active','available',true,
          'dc_va_launch_corridor') returning id`);
      const secondVehicle=one(`insert into public.couranr_dispatch_vehicles(
        name,vehicle_class,payload_capacity_lb,active,availability_state)
        values('RR003d Other Van','van',100,true,'available') returning id`);
      refuses("even captured first child cannot be assigned before RR004",
        `insert into public.couranr_delivery_assignments(
          delivery_id,driver_id,vehicle_id,assigned_by,idempotency_key)
          values('${delivery}','${secondDriver}','${secondVehicle}','${owner}',
            'rr003d-assignment-bypass')`,
        "route_child_assignment_requires_route_execution");
      refuses("one captured child cannot make Route ready",
        `select public.couranr_complete_route_run_funding('${biz}','${owner}','${route}')`,
        "route_funding_child_capture_or_conversion_incomplete");
    }
  }
  check("two exact captured deliveries allow Route funding completion",
    JSON.parse(one(`select public.couranr_complete_route_run_funding(
      '${biz}','${owner}','${route}')`)).outcome,"ready_for_execution");
  check("status refresh cannot downgrade execution-ready Route",
    JSON.parse(one(`select public.couranr_sync_route_run_settlement(
      '${biz}','${owner}','${route}',false)`)).state,"ready_for_execution");
  check("Route has exactly two child deliveries",
    one(`select count(*) from public.couranr_deliveries where route_run_id='${route}'`),"2");
  const fundedView=JSON.parse(one(`select public.couranr_read_route_run_settlement(
    '${biz}','${owner}','${route}')`));
  check("safe settlement projection identifies every canonical child delivery",
    fundedView.items.filter((item)=>typeof item.deliveryId==="string").length,2);
  check("safe settlement projection retains merchant pickup readiness evidence",
    fundedView.pickupReadyConfirmed,true);
  check("no physical assignment or proof was fabricated",
    one("select count(*) from public.couranr_delivery_assignments")+","+
      one("select count(*) from public.couranr_delivery_proofs"),"0,0");

  // A second Route exercises definitive failure AFTER the first child was
  // captured. The uncaptured sibling still has a Route plan, but its provider
  // hold must be releasable through the canonical release command.
  const c=await child("rr003d-recovery-a"),d=await child("rr003d-recovery-b");
  const recoveryRoute=randomUUID();
  one(`select public.couranr_save_route_run_draft('${biz}','${owner}','${recoveryRoute}',0,
    '${randomUUID()}','Recovery route',array['${c.requestId}','${d.requestId}']::uuid[])`);
  one(`select public.couranr_accept_route_run('${biz}','${owner}','${recoveryRoute}',1,'${randomUUID()}')`);
  const recovery=JSON.parse(one(`select public.couranr_begin_route_run_checkout(
    '${biz}','${owner}','${recoveryRoute}',1,'${randomUUID()}')`));
  for(const item of recovery.items){
    one(`select public.couranr_begin_route_child_authorization(
      '${biz}','${owner}','${recoveryRoute}','${item.obligationId}')`);
    const pi=`pi_rr003drecovery${item.sequence}`;
    one(`select id from public.couranr_attach_payment_intent(
      '${item.obligationId}',${item.obligationVersion},'${pi}')`);
    const metadata=JSON.stringify({paymentObligationId:item.obligationId,
      couranrRequestId:item.requestId,businessAccountId:biz,
      quoteVersionId:item.quoteVersionId,payerType:"merchant",
      pricingPolicyVersion:"couranr-pricing-v2-2026-09-01"}).replaceAll("'","''");
    one(`select outcome from public.couranr_apply_payment_intent_state(
      'rr003d-recovery-auth-${item.sequence}','payment_intent.amount_capturable_updated',
      '${pi}','requires_capture',${item.amountCents},${item.amountCents},'usd',
      '${metadata}'::jsonb,now())`);
  }
  one(`select public.couranr_sync_route_run_settlement('${biz}','${owner}','${recoveryRoute}',false)`);
  one(`select public.couranr_confirm_route_pickup_ready('${biz}','${owner}','${recoveryRoute}',1,true)`);
  check("second Route reserves the other available resource",
    JSON.parse(one(`select public.couranr_reserve_route_run_resource(
      '${biz}','${owner}','${recoveryRoute}',now())`)).outcome,"reserved");
  one(`select public.couranr_confirm_route_service_plans('${biz}','${owner}','${recoveryRoute}',1)`);
  one(`select public.couranr_begin_route_run_capture('${biz}','${owner}','${recoveryRoute}',1)`);
  const first=recovery.items[0],second=recovery.items[1];
  one(`select id from public.couranr_begin_route_child_capture(
    '${biz}','${owner}','${recoveryRoute}','${first.obligationId}')`);
  one(`select outcome from public.couranr_complete_payment_capture(
    '${first.obligationId}','rr003d-recovery-captured',
    'pi_rr003drecovery1','succeeded',${first.amountCents},'usd')`);
  one(`select id from public.couranr_create_delivery_from_capture('${first.requestId}')`);
  one(`select id from public.couranr_begin_route_child_capture(
    '${biz}','${owner}','${recoveryRoute}','${second.obligationId}')`);
  check("verified provider refusal releases second child to authorized",
    one(`select payment_state from public.couranr_fail_payment_capture(
      '${second.obligationId}','rr003d-recovery-not-taken',
      'provider_reports_funds_still_only_authorized')`),"authorized");
  check("partial capture plus definite failure enters recovery, not execution",
    JSON.parse(one(`select public.couranr_sync_route_run_settlement(
      '${biz}','${owner}','${recoveryRoute}',false)`)).state,"recovery_required");
  check("partial capture opens child-scoped Operations commercial recovery",
    one(`select count(*) from public.couranr_automation_exceptions e
      where e.request_id in ('${first.requestId}','${second.requestId}')
        and e.exception_stage='commercial' and e.exception_state='open'
        and e.reason='route_settlement_recovery_required'`),"2");
  const releasedVersion=Number(one(`select version from public.couranr_payment_obligations
    where id='${second.obligationId}'`));
  check("planned but uncaptured sibling uses canonical hold-release command",
    one(`select outcome from public.couranr_begin_payment_release(
      '${second.obligationId}','${owner}',${releasedVersion},
      'Route capture failed after an earlier child')`),"applied");
  check("verified provider cancel releases remaining hold",
    one(`select outcome from public.couranr_complete_payment_release(
      '${second.obligationId}','pi_rr003drecovery2','canceled')`),"applied");
  refuses("partial capture can never claim execution-ready",
    `select public.couranr_complete_route_run_funding('${biz}','${owner}','${recoveryRoute}')`,
    "route_funding_capture_incomplete");
  refuses("semantic rollback preserves captured money and resource",rollback,
    "route_capture_gate_rollback_refuses_semantic_use");
  console.log(`RR-003d Capture Gate ${checks}/${checks} PASS (disposable PostgreSQL; fake provider outcomes only).`);
} finally { down({quiet:true}); }

/** RR-004a: funded Route assignment and ordinary-work exclusion, no provider I/O. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { up, down, psql } from "./up.mjs";
import { psqlTransport, seedCanonicalQuotedRequest } from "./gateAFixtures.mjs";

const ROOT=fileURLToPath(new URL("../../",import.meta.url));
const filename="20260930233259_couranr_route_run_execution_foundation";
const forward=readFileSync(resolve(ROOT,`supabase/migrations/${filename}.sql`),"utf8");
const rollback=readFileSync(resolve(ROOT,`supabase/rollbacks/${filename}.rollback.sql`),"utf8");
const sharedForward=readFileSync(resolve(ROOT,
  "supabase/migrations/20260930234200_couranr_route_run_shared_pickup.sql"),"utf8");
const sharedRollback=readFileSync(resolve(ROOT,
  "supabase/rollbacks/20260930234200_couranr_route_run_shared_pickup.rollback.sql"),"utf8");
const terminalForward=readFileSync(resolve(ROOT,
  "supabase/migrations/20260930234700_couranr_route_run_stop_advance_release.sql"),"utf8");
const terminalRollback=readFileSync(resolve(ROOT,
  "supabase/rollbacks/20260930234700_couranr_route_run_stop_advance_release.rollback.sql"),"utf8");
const one=(sql)=>psql(sql).trim();
const esc=(value)=>String(value).replaceAll("'","''");
let checks=0;
function check(label,actual,expected){assert.deepEqual(actual,expected,label);checks++;console.log("PASS",label);}
function refuses(label,sql,marker){let error="";try{one(sql)}catch(e){error=String(e.stderr||e.message)}assert.ok(error.includes(marker),`${label}: expected ${marker}, got ${error||"success"}`);checks++;console.log("PASS",label);}

try{
  const info=up({quiet:true,throughMigration:`${filename}.sql`});
  console.log(`RR-004a execution: ${info.migrationsApplied} migrations applied`);
  one(rollback);
  check("empty execution rollback removes only RR004 authority",
    one("select to_regclass('public.couranr_route_run_executions') is null and to_regclass('public.couranr_route_run_settlements') is not null"),"t");
  one(forward);
  check("execution forward reapplies",one("select to_regclass('public.couranr_route_run_executions') is not null"),"t");
  one(sharedForward);
  one(terminalForward);
  one(terminalRollback);
  check("empty terminal authority rollback preserves pickup guard",
    one("select to_regprocedure('public.couranr_advance_route_run_stop(uuid,uuid)') is null and to_regprocedure('public.couranr_depart_route_run_pickup(uuid,uuid)') is not null"),"t");
  one(terminalForward);
  one(sharedRollback);
  check("empty shared pickup rollback preserves RR004a",
    one("select to_regprocedure('public.couranr_start_route_run_to_pickup(uuid,uuid)') is null and to_regclass('public.couranr_route_run_executions') is not null"),"t");
  one(sharedForward);
  check("browser roles cannot read execution records or call assignment command",
    one(`select has_table_privilege('anon','public.couranr_route_run_executions','select')
      or has_table_privilege('authenticated','public.couranr_route_run_executions','select')
      or has_function_privilege('authenticated',
        'public.couranr_begin_route_execution(uuid,uuid,uuid)','execute')`),"f");
  check("all RR004 driver and Operations RPCs are service-role-only",
    one(`select count(*) from (values
      ('public.couranr_begin_route_execution(uuid,uuid,uuid)'),
      ('public.couranr_start_route_run_to_pickup(uuid,uuid)'),
      ('public.couranr_arrive_route_run_at_pickup(uuid,uuid,numeric,numeric,numeric)'),
      ('public.couranr_depart_route_run_pickup(uuid,uuid)'),
      ('public.couranr_advance_route_run_stop(uuid,uuid)'),
      ('public.couranr_resolve_route_run_exception(uuid,uuid,text)'),
      ('public.couranr_complete_route_run_execution(uuid,uuid)')
    ) as f(signature)
    where has_function_privilege('anon',f.signature,'execute')
       or has_function_privilege('authenticated',f.signature,'execute')
       or not has_function_privilege('service_role',f.signature,'execute')`),"0");
  check("RR004 execution and event tables deny browser DML",
    one(`select count(*) from (values
      ('public.couranr_route_run_executions'),
      ('public.couranr_route_run_execution_events')
    ) as t(table_name)
    where has_table_privilege('anon',t.table_name,'select,insert,update,delete')
       or has_table_privilege('authenticated',t.table_name,'select,insert,update,delete')
       or not (select c.relrowsecurity from pg_class c where c.oid=t.table_name::regclass)`),"0");
  const biz=one("insert into public.business_accounts(name,status) values('RR004a shop','active') returning id");
  const owner=one("insert into auth.users(email) values('rr004a-owner@example.test') returning id");
  const driverUser=one("insert into auth.users(email) values('rr004a-driver@example.test') returning id");
  const otherDriverUser=one("insert into auth.users(email) values('rr004a-other-driver@example.test') returning id");
  one(`insert into public.business_members(business_account_id,user_id,role,status)
    values('${biz}','${owner}','owner','active')`);
  const transport=psqlTransport(psql);
  async function child(marker){
    const c=await seedCanonicalQuotedRequest(transport,{businessId:biz,actorUserId:owner,
      marker,upTo:"draft",weightLb:20,subtotalCents:2000});
    one(`select id from public.couranr_set_business_pickup_manifest(
      '${c.requestId}','${biz}','${owner}',0,'Package ${esc(marker)}',1,'${esc(marker)}',null)`);
    const dv=JSON.parse(one(`select public.couranr_record_business_declared_value(
      '${biz}','${owner}','${c.requestId}',${c.version},2000)`));
    return {...c,version:dv.version};
  }
  const first=await child("rr004a-first"),second=await child("rr004a-second");
  const route=randomUUID();
  one(`select public.couranr_save_route_run_draft('${biz}','${owner}','${route}',0,
    '${randomUUID()}','Execution route',array['${first.requestId}','${second.requestId}']::uuid[])`);
  one(`select public.couranr_accept_route_run('${biz}','${owner}','${route}',1,'${randomUUID()}')`);
  one(`insert into public.couranr_business_payment_profiles(
    business_account_id,stripe_customer_id,stripe_customer_livemode,current_generation,
    default_payment_method_id,default_setup_intent_id,card_brand,card_last4)
    values('${biz}','cus_rr004a',false,1,'pm_rr004a','seti_rr004a','visa','4242')`);
  const checkout=JSON.parse(one(`select public.couranr_begin_route_run_checkout(
    '${biz}','${owner}','${route}',1,'${randomUUID()}')`));
  for(const item of checkout.items){
    one(`select public.couranr_begin_route_child_authorization(
      '${biz}','${owner}','${route}','${item.obligationId}')`);
    const pi=`pi_rr004a${item.sequence}`;
    one(`select id from public.couranr_attach_payment_intent(
      '${item.obligationId}',${item.obligationVersion},'${pi}')`);
    const metadata=JSON.stringify({paymentObligationId:item.obligationId,
      couranrRequestId:item.requestId,businessAccountId:biz,
      quoteVersionId:item.quoteVersionId,payerType:"merchant",
      pricingPolicyVersion:"couranr-pricing-v2-2026-09-01"}).replaceAll("'","''");
    one(`select outcome from public.couranr_apply_payment_intent_state(
      'rr004a-auth-${item.sequence}','payment_intent.amount_capturable_updated',
      '${pi}','requires_capture',${item.amountCents},${item.amountCents},'usd',
      '${metadata}'::jsonb,now())`);
  }
  one(`select public.couranr_sync_route_run_settlement('${biz}','${owner}','${route}',false)`);
  one(`select public.couranr_confirm_route_pickup_ready('${biz}','${owner}','${route}',1,true)`);
  const driver=one(`insert into public.couranr_drivers(
    user_id,display_name,driver_state,availability_state,active,market)
    values('${driverUser}','RR004a Driver','active','available',true,'dc_va_launch_corridor') returning id`);
  const vehicle=one(`insert into public.couranr_dispatch_vehicles(
    name,vehicle_class,payload_capacity_lb,active,availability_state)
    values('RR004a Van','van',100,true,'available') returning id`);
  one(`select public.couranr_reserve_route_run_resource('${biz}','${owner}','${route}',now())`);
  one(`select public.couranr_confirm_route_service_plans('${biz}','${owner}','${route}',1)`);
  one(`select public.couranr_begin_route_run_capture('${biz}','${owner}','${route}',1)`);
  const deliveries=[];
  for(const item of checkout.items){
    one(`select id from public.couranr_begin_route_child_capture(
      '${biz}','${owner}','${route}','${item.obligationId}')`);
    one(`select outcome from public.couranr_complete_payment_capture(
      '${item.obligationId}','rr004a-capture-${item.sequence}',
      'pi_rr004a${item.sequence}','succeeded',${item.amountCents},'usd')`);
    deliveries.push(one(`select id from public.couranr_create_delivery_from_capture('${item.requestId}')`));
  }
  check("funded Route has separate canonical child deliveries",
    deliveries.length,2);
  check("funding is exact-child complete",
    JSON.parse(one(`select public.couranr_complete_route_run_funding(
      '${biz}','${owner}','${route}')`)).outcome,"ready_for_execution");
  check("funded Route without assignments remains maintenance-claimable",
    one("select count(*) from public.couranr_claim_route_checkout_maintenance(2)"),"1");
  const execution=JSON.parse(one(`select public.couranr_begin_route_execution(
    '${biz}','${owner}','${route}')`));
  check("funded Route leaves maintenance queue after exact assignment",
    one("select count(*) from public.couranr_claim_route_checkout_maintenance(2)"),"0");
  check("one Route execution binds the accepted version",execution.routeRunId,route);
  check("same driver has two active canonical child assignments",
    one(`select count(*) from public.couranr_delivery_assignments
      where driver_id='${driver}' and assignment_state='active' and route_run_id='${route}'`),"2");
  check("same Route assignments hold the single reserved vehicle",
    one(`select count(*) from public.couranr_delivery_assignments
      where route_run_id='${route}' and vehicle_id='${vehicle}' and assignment_state='active'`),"2");
  check("driver remains unavailable for ordinary work",
    one(`select availability_state from public.couranr_drivers where id='${driver}'`),"on_delivery");
  check("vehicle remains unavailable for ordinary work",
    one(`select availability_state from public.couranr_dispatch_vehicles where id='${vehicle}'`),"on_delivery");
  check("duplicate Route execution returns the same identity",
    JSON.parse(one(`select public.couranr_begin_route_execution(
      '${biz}','${owner}','${route}')`)).executionId,execution.executionId);
  for(const deliveryId of deliveries){
    check(`driver authorization selects exact child ${deliveryId.slice(0,8)}`,
      one(`select delivery_id from public.couranr_driver_assignment_for(
        '${deliveryId}','${driverUser}')`),deliveryId);
  }
  refuses("unrelated driver cannot access a Route child",
    `select delivery_id from public.couranr_driver_assignment_for(
      '${deliveries[0]}','${otherDriverUser}')`,"not_your_delivery");
  one(`select public.couranr_release_assignment_resources('${driver}','${vehicle}')`);
  check("child resource release cannot free Route driver",
    one(`select availability_state from public.couranr_drivers where id='${driver}'`),"on_delivery");
  check("child resource release cannot free Route vehicle",
    one(`select availability_state from public.couranr_dispatch_vehicles where id='${vehicle}'`),"on_delivery");
  refuses("ordinary assignment cannot steal a Route driver",
    `insert into public.couranr_delivery_assignments(
      delivery_id,driver_id,vehicle_id,assigned_by,idempotency_key)
      values('${deliveries[0]}','${driver}','${vehicle}','${owner}','rr004a-steal')`,
    "resource_owned_by_route_run");
  const otherDriver=one(`insert into public.couranr_drivers(
    user_id,display_name,driver_state,availability_state,active,market)
    values('${otherDriverUser}','RR004a Other','active','available',true,'dc_va_launch_corridor') returning id`);
  refuses("ordinary driver cannot be inserted as a sibling of this Route",
    `insert into public.couranr_delivery_assignments(
      delivery_id,driver_id,vehicle_id,assigned_by,assignment_source,route_run_id,route_execution_id,
      idempotency_key)
      values('${deliveries[0]}','${otherDriver}','${vehicle}',null,'route_run','${route}',
        '${execution.executionId}','rr004a-wrong-driver')`,"route_assignment_resource_mismatch");
  refuses("semantic rollback preserves Route assignment history",rollback,
    "route_execution_rollback_refuses_semantic_use");
  refuses("standalone child cannot start a shared Route pickup",
    `select id from public.couranr_start_route_to_pickup(
      '${deliveries[0]}',2,'${driverUser}')`,"route_stop_transition_not_authorized");
  const start=JSON.parse(one(`select public.couranr_start_route_run_to_pickup(
    '${route}','${driverUser}')`));
  check("one driver action starts both child pickup legs",start.outcome,"en_route_to_pickup");
  check("both children share en-route state",
    one(`select count(*) from public.couranr_deliveries
      where route_run_id='${route}' and fulfillment_state='en_route_to_pickup'`),"2");
  const arrival=JSON.parse(one(`select public.couranr_arrive_route_run_at_pickup(
    '${route}','${driverUser}',38.3,-77.4,9)`));
  check("one evidenced arrival reaches pickup for both children",arrival.outcome,"at_pickup");
  refuses("Route cannot depart without every child's verified proof and custody",
    `select public.couranr_depart_route_run_pickup('${route}','${driverUser}')`,
    "route_pickup_custody_incomplete");
  refuses("shared pickup rollback refuses live physical Route evidence",sharedRollback,
    "route_shared_pickup_rollback_refuses_semantic_use");
  refuses("terminal resource rollback refuses an active Route",
    terminalRollback,"route_terminal_release_rollback_refuses_semantic_use");
  // This is fault-injection data on disposable PostgreSQL, NOT customer proof.
  // The production child commands must create these rows after real PIN/photo.
  for(const deliveryId of deliveries){
    const asg=one(`select id from public.couranr_delivery_assignments
      where delivery_id='${deliveryId}' and route_execution_id='${execution.executionId}'`);
    one(`insert into public.couranr_delivery_proofs(
      delivery_id,assignment_id,proof_stage,proof_type,actor_driver_id)
      values('${deliveryId}','${asg}','pickup','shipment_photo','${driver}')`);
    one(`insert into public.couranr_handoff_records(
      delivery_id,assignment_id,handoff_stage,confirmed_vehicle_id,
      latitude,longitude,accuracy_m,actor_driver_id)
      values('${deliveryId}','${asg}','pickup','${vehicle}',38.3,-77.4,9,'${driver}')`);
    one(`update public.couranr_deliveries set fulfillment_state='picked_up',
      version=version+1 where id='${deliveryId}'`);
  }
  check("Route departure rechecks all child custody evidence",
    JSON.parse(one(`select public.couranr_depart_route_run_pickup(
      '${route}','${driverUser}')`)).outcome,"in_progress");
  function deliveryVersion(id){return Number(one(`select version from public.couranr_deliveries where id='${id}'`))}
  refuses("later stop cannot call ordinary arrival ahead of sequence",
    `select id from public.couranr_arrive_at_dropoff(
      '${deliveries[1]}',${deliveryVersion(deliveries[1])},'${driverUser}',38.4,-77.3,8)`,
    "route_stop_transition_not_authorized");
  one(`select id from public.couranr_arrive_at_dropoff(
    '${deliveries[0]}',${deliveryVersion(deliveries[0])},'${driverUser}',38.4,-77.3,8)`);
  refuses("driver cannot advance before current child's completion",
    `select public.couranr_advance_route_run_stop('${route}','${driverUser}')`,
    "route_current_stop_not_terminal");
  // Fault-inject finalized dropoff evidence + terminal state; the canonical
  // completion command has separate full proof/PIN tests elsewhere.
  function simulateDelivered(deliveryId){
    const asg=one(`select id from public.couranr_delivery_assignments where delivery_id='${deliveryId}'`);
    one(`insert into public.couranr_delivery_proofs(
      delivery_id,assignment_id,proof_stage,proof_type,actor_driver_id)
      values('${deliveryId}','${asg}','dropoff','recipient_pin','${driver}')`);
    one(`insert into public.couranr_handoff_records(
      delivery_id,assignment_id,handoff_stage,latitude,longitude,
      accuracy_m,actor_driver_id,proof_method_used)
      values('${deliveryId}','${asg}','dropoff',38.4,-77.3,8,
        '${driver}','photo_or_pin')`);
    one(`update public.couranr_deliveries set fulfillment_state='delivered',
      version=version+1 where id='${deliveryId}'`);
    one(`update public.couranr_delivery_assignments set assignment_state='completed',
      ended_at=now(),end_reason='delivered',version=version+1 where id='${asg}'`);
  }
  simulateDelivered(deliveries[0]);
  check("first terminal stop advances exactly one sequence",
    JSON.parse(one(`select public.couranr_advance_route_run_stop(
      '${route}','${driverUser}')`)).currentSequence,2);
  check("intermediate completion keeps Route driver unavailable",
    one(`select availability_state from public.couranr_drivers where id='${driver}'`),"on_delivery");
  check("intermediate completion keeps Route vehicle unavailable",
    one(`select availability_state from public.couranr_dispatch_vehicles where id='${vehicle}'`),"on_delivery");
  one(`select id from public.couranr_arrive_at_dropoff(
    '${deliveries[1]}',${deliveryVersion(deliveries[1])},'${driverUser}',38.4,-77.3,8)`);
  simulateDelivered(deliveries[1]);
  check("last terminal stop closes the Route once",
    JSON.parse(one(`select public.couranr_advance_route_run_stop(
      '${route}','${driverUser}')`)).outcome,"completed");
  check("Route resource releases after all child proof/custody terminal",
    one(`select resource_state from public.couranr_route_run_resource_reservations
      where route_run_id='${route}'`),"released");
  check("driver becomes available only at Route terminal",
    one(`select availability_state from public.couranr_drivers where id='${driver}'`),"available");
  check("vehicle becomes available only at Route terminal",
    one(`select availability_state from public.couranr_dispatch_vehicles where id='${vehicle}'`),"available");
  check("Route terminal replay does not release resource twice",
    JSON.parse(one(`select public.couranr_complete_route_run_execution(
      '${route}','${driverUser}')`)).outcome,"already_completed");
  check("exactly one Route resource release event",
    one(`select count(*) from public.couranr_route_run_resource_events e
      join public.couranr_route_run_resource_reservations r on r.id=e.resource_id
      where r.route_run_id='${route}' and e.event_type='released'`),"1");
  // A second disposable Route exercises the failed common pickup. Financial
  // rows below are explicit provider-double fixtures, never live Stripe data.
  one(`update public.couranr_drivers set active=false where id='${otherDriver}'`);
  const ops=one("insert into auth.users(email) values('rr004a-ops@example.test') returning id");
  one(`insert into public.profiles(id,email,role)
    values('${ops}','rr004a-ops@example.test','admin')`);
  const failedFirst=await child("rr004a-failed-first");
  const failedSecond=await child("rr004a-failed-second");
  const failedRoute=randomUUID();
  one(`select public.couranr_save_route_run_draft('${biz}','${owner}',
    '${failedRoute}',0,'${randomUUID()}','Failed pickup route',
    array['${failedFirst.requestId}','${failedSecond.requestId}']::uuid[])`);
  one(`select public.couranr_accept_route_run('${biz}','${owner}',
    '${failedRoute}',1,'${randomUUID()}')`);
  const failedCheckout=JSON.parse(one(`select public.couranr_begin_route_run_checkout(
    '${biz}','${owner}','${failedRoute}',1,'${randomUUID()}')`));
  const failedDeliveries=[];
  for(const item of failedCheckout.items){
    one(`select public.couranr_begin_route_child_authorization(
      '${biz}','${owner}','${failedRoute}','${item.obligationId}')`);
    const pi=`pi_rr004fail${item.sequence}`;
    one(`select id from public.couranr_attach_payment_intent(
      '${item.obligationId}',${item.obligationVersion},'${pi}')`);
    const metadata=JSON.stringify({paymentObligationId:item.obligationId,
      couranrRequestId:item.requestId,businessAccountId:biz,
      quoteVersionId:item.quoteVersionId,payerType:"merchant",
      pricingPolicyVersion:"couranr-pricing-v2-2026-09-01"}).replaceAll("'","''");
    one(`select outcome from public.couranr_apply_payment_intent_state(
      'rr004fail-auth-${item.sequence}','payment_intent.amount_capturable_updated',
      '${pi}','requires_capture',${item.amountCents},${item.amountCents},'usd',
      '${metadata}'::jsonb,now())`);
  }
  one(`select public.couranr_sync_route_run_settlement('${biz}','${owner}',
    '${failedRoute}',false)`);
  one(`select public.couranr_confirm_route_pickup_ready('${biz}','${owner}',
    '${failedRoute}',1,true)`);
  one(`select public.couranr_reserve_route_run_resource('${biz}','${owner}',
    '${failedRoute}',now())`);
  one(`select public.couranr_confirm_route_service_plans('${biz}','${owner}',
    '${failedRoute}',1)`);
  one(`select public.couranr_begin_route_run_capture('${biz}','${owner}',
    '${failedRoute}',1)`);
  for(const item of failedCheckout.items){
    one(`select id from public.couranr_begin_route_child_capture(
      '${biz}','${owner}','${failedRoute}','${item.obligationId}')`);
    one(`select outcome from public.couranr_complete_payment_capture(
      '${item.obligationId}','rr004fail-capture-${item.sequence}',
      'pi_rr004fail${item.sequence}','succeeded',${item.amountCents},'usd')`);
    failedDeliveries.push(one(`select id from public.couranr_create_delivery_from_capture(
      '${item.requestId}')`));
  }
  one(`select public.couranr_complete_route_run_funding('${biz}','${owner}',
    '${failedRoute}')`);
  one(`select public.couranr_begin_route_execution('${biz}','${owner}',
    '${failedRoute}')`);
  one(`select public.couranr_start_route_run_to_pickup('${failedRoute}',
    '${driverUser}')`);
  one(`select public.couranr_arrive_route_run_at_pickup('${failedRoute}',
    '${driverUser}',38.3,-77.4,9)`);
  one(`select id from public.couranr_report_pickup_discrepancy(
    '${failedDeliveries[0]}','${driverUser}','loading_not_available',
    'First package unavailable')`);
  one(`select id from public.couranr_close_delivery_undeliverable(
    '${failedDeliveries[0]}',${deliveryVersion(failedDeliveries[0])},
    '${ops}','Failed common pickup','at_pickup',null,'couranr_caused')`);
  check("failed common pickup pauses the Route before custody",
    one(`select execution_state||':'||current_sequence from public.couranr_route_run_executions
      where route_run_id='${failedRoute}'`),"exception:0");
  refuses("Operations cannot continue stops after failed common pickup",
    `select public.couranr_resolve_route_run_exception('${failedRoute}',
      '${ops}','continue_later_stops')`,"route_failed_pickup_requires_return_review");
  check("Operations can order failed-pickup recovery without moving child money",
    JSON.parse(one(`select public.couranr_resolve_route_run_exception(
      '${failedRoute}','${ops}','return_now')`)).outcome,"return_now");
  refuses("failed Route cannot release with another child still at pickup",
    `select public.couranr_complete_route_run_execution('${failedRoute}',
      '${driverUser}')`,"route_failed_pickup_recovery_incomplete");
  one(`select id from public.couranr_report_pickup_discrepancy(
    '${failedDeliveries[1]}','${driverUser}','loading_not_available',
    'Second package unavailable')`);
  one(`select id from public.couranr_close_delivery_undeliverable(
    '${failedDeliveries[1]}',${deliveryVersion(failedDeliveries[1])},
    '${ops}','Failed common pickup','at_pickup',null,'couranr_caused')`);
  refuses("failed Route cannot release while refunds lack provider certainty",
    `select public.couranr_complete_route_run_execution('${failedRoute}',
      '${driverUser}')`,"route_failed_pickup_recovery_incomplete");
  refuses("accepted child cannot close its request before money recovery",
    `select id from public.couranr_cancel_delivery_request(
      '${failedFirst.requestId}','${ops}','Premature failed pickup closure')`,
    "route_child_claimed");
  for(const item of failedCheckout.items){
    one(`insert into public.couranr_payment_refunds(
      obligation_id,request_id,provider_payment_intent_id,provider_refund_id,
      amount_cents,reason,refund_key,attempt_state,actor_user_id)
      values('${item.obligationId}','${item.requestId}',
        'pi_rr004fail${item.sequence}','re_rr004fail${item.sequence}',
        ${item.amountCents},'couranr_caused_failure',
        'rr004fail-refund-${item.sequence}','succeeded','${ops}')`);
    one(`update public.couranr_payment_obligations
      set payment_state='refunded',refunded_at=now(),
        refunded_amount_cents=${item.amountCents}
      where id='${item.obligationId}'`);
    one(`select id from public.couranr_cancel_delivery_request(
      '${item.requestId}','${ops}','Governed failed pickup and refund settled')`);
  }
  check("governed failed-pickup request closures survive Route child freeze",
    one(`select count(*) from public.couranr_delivery_requests
      where id in ('${failedFirst.requestId}','${failedSecond.requestId}')
        and request_state='cancelled'`),"2");
  check("fully settled failed pickup cancels execution, not delivers it",
    JSON.parse(one(`select public.couranr_complete_route_run_execution(
      '${failedRoute}','${driverUser}')`)).outcome,"cancelled");
  check("failed pickup releases Route resource once",
    one(`select resource_state||':'||release_reason from
      public.couranr_route_run_resource_reservations
      where route_run_id='${failedRoute}'`),"released:failed_shared_pickup");
  check("cancelled execution preserves distinct physical truth",
    one(`select execution_state||':'||(cancelled_at is not null)::text from
      public.couranr_route_run_executions
      where route_run_id='${failedRoute}'`),"cancelled:true");

  // Mixed pickup fault injection: one package is already in driver custody
  // when the other proves unavailable. No bulk rollback can erase that cargo.
  async function fundedExecution(marker,title){
    const children=[await child(`${marker}-first`),await child(`${marker}-second`)];
    const routeId=randomUUID();
    one(`select public.couranr_save_route_run_draft('${biz}','${owner}',
      '${routeId}',0,'${randomUUID()}','${esc(title)}',
      array['${children[0].requestId}','${children[1].requestId}']::uuid[])`);
    one(`select public.couranr_accept_route_run('${biz}','${owner}',
      '${routeId}',1,'${randomUUID()}')`);
    const checkoutResult=JSON.parse(one(`select public.couranr_begin_route_run_checkout(
      '${biz}','${owner}','${routeId}',1,'${randomUUID()}')`));
    for(const item of checkoutResult.items){
      one(`select public.couranr_begin_route_child_authorization(
        '${biz}','${owner}','${routeId}','${item.obligationId}')`);
      const pi=`pi_${marker}${item.sequence}`;
      one(`select id from public.couranr_attach_payment_intent(
        '${item.obligationId}',${item.obligationVersion},'${pi}')`);
      const metadata=JSON.stringify({paymentObligationId:item.obligationId,
        couranrRequestId:item.requestId,businessAccountId:biz,
        quoteVersionId:item.quoteVersionId,payerType:"merchant",
        pricingPolicyVersion:"couranr-pricing-v2-2026-09-01"}).replaceAll("'","''");
      one(`select outcome from public.couranr_apply_payment_intent_state(
        '${marker}-auth-${item.sequence}','payment_intent.amount_capturable_updated',
        '${pi}','requires_capture',${item.amountCents},${item.amountCents},'usd',
        '${metadata}'::jsonb,now())`);
    }
    one(`select public.couranr_sync_route_run_settlement('${biz}','${owner}',
      '${routeId}',false)`);
    one(`select public.couranr_confirm_route_pickup_ready('${biz}','${owner}',
      '${routeId}',1,true)`);
    one(`select public.couranr_reserve_route_run_resource('${biz}','${owner}',
      '${routeId}',now())`);
    one(`select public.couranr_confirm_route_service_plans('${biz}','${owner}',
      '${routeId}',1)`);
    one(`select public.couranr_begin_route_run_capture('${biz}','${owner}',
      '${routeId}',1)`);
    const childDeliveries=[];
    for(const item of checkoutResult.items){
      one(`select id from public.couranr_begin_route_child_capture(
        '${biz}','${owner}','${routeId}','${item.obligationId}')`);
      one(`select outcome from public.couranr_complete_payment_capture(
        '${item.obligationId}','${marker}-capture-${item.sequence}',
        'pi_${marker}${item.sequence}','succeeded',${item.amountCents},'usd')`);
      childDeliveries.push(one(`select id from public.couranr_create_delivery_from_capture(
        '${item.requestId}')`));
    }
    one(`select public.couranr_complete_route_run_funding('${biz}','${owner}',
      '${routeId}')`);
    const routeExecution=JSON.parse(one(`select public.couranr_begin_route_execution(
      '${biz}','${owner}','${routeId}')`));
    one(`select public.couranr_start_route_run_to_pickup('${routeId}',
      '${driverUser}')`);
    one(`select public.couranr_arrive_route_run_at_pickup('${routeId}',
      '${driverUser}',38.3,-77.4,9)`);
    return {children,routeId,checkoutResult,childDeliveries,routeExecution};
  }
  const {children:[mixedFirst],routeId:mixedRoute,
    checkoutResult:mixedCheckout,childDeliveries:mixedDeliveries,
    routeExecution:mixedExecution}=await fundedExecution("rr004mixed","Mixed pickup route");
  const loadedAssignment=one(`select id from public.couranr_delivery_assignments
    where delivery_id='${mixedDeliveries[0]}'`);
  one(`insert into public.couranr_delivery_proofs(
    delivery_id,assignment_id,proof_stage,proof_type,actor_driver_id)
    values('${mixedDeliveries[0]}','${loadedAssignment}',
      'pickup','shipment_photo','${driver}')`);
  one(`insert into public.couranr_handoff_records(
    delivery_id,assignment_id,handoff_stage,confirmed_vehicle_id,
    latitude,longitude,accuracy_m,actor_driver_id)
    values('${mixedDeliveries[0]}','${loadedAssignment}',
      'pickup','${vehicle}',38.3,-77.4,9,'${driver}')`);
  one(`update public.couranr_deliveries set fulfillment_state='picked_up',
    version=version+1 where id='${mixedDeliveries[0]}'`);
  one(`select id from public.couranr_report_pickup_discrepancy(
    '${mixedDeliveries[1]}','${driverUser}','loading_not_available',
    'Second package unavailable')`);
  one(`select id from public.couranr_close_delivery_undeliverable(
    '${mixedDeliveries[1]}',${deliveryVersion(mixedDeliveries[1])},
    '${ops}','Partial common pickup','at_pickup',null,'couranr_caused')`);
  check("mixed pickup preserves already-loaded child custody",
    one(`select fulfillment_state from public.couranr_deliveries
      where id='${mixedDeliveries[0]}'`),"picked_up");
  refuses("mixed pickup cannot depart with a missing package",
    `select public.couranr_depart_route_run_pickup('${mixedRoute}',
      '${driverUser}')`,"route_pickup_departure_wrong_state");
  one(`select public.couranr_resolve_route_run_exception('${mixedRoute}',
    '${ops}','return_now')`);
  one(`select id from public.couranr_report_dropoff_exception_v2(
    '${mixedDeliveries[0]}','${driverUser}','other',
    'Loaded package must return',38.3,-77.4,9)`);
  one(`select id from public.couranr_require_return('${mixedDeliveries[0]}',
    ${deliveryVersion(mixedDeliveries[0])},'${ops}','couranr_caused',
    'Partial common pickup')`);
  check("loaded child has governed return rather than silent cancellation",
    one(`select fulfillment_state from public.couranr_deliveries
      where id='${mixedDeliveries[0]}'`),"return_required");
  const missingItem=mixedCheckout.items[1];
  one(`insert into public.couranr_payment_refunds(
    obligation_id,request_id,provider_payment_intent_id,provider_refund_id,
    amount_cents,reason,refund_key,attempt_state,actor_user_id)
    values('${missingItem.obligationId}','${missingItem.requestId}',
      'pi_rr004mixed2','re_rr004mixed2',${missingItem.amountCents},
      'couranr_caused_failure','rr004mixed-refund-2','succeeded','${ops}')`);
  one(`update public.couranr_payment_obligations
    set payment_state='refunded',refunded_at=now(),
      refunded_amount_cents=${missingItem.amountCents}
    where id='${missingItem.obligationId}'`);
  one(`select id from public.couranr_cancel_delivery_request(
    '${missingItem.requestId}','${ops}','Governed missing-package refund settled')`);
  refuses("settled missing child cannot release driver while loaded cargo is open",
    `select public.couranr_complete_route_run_execution('${mixedRoute}',
      '${driverUser}')`,"route_failed_pickup_recovery_incomplete");
  one(`select id from public.couranr_start_return('${mixedDeliveries[0]}',
    ${deliveryVersion(mixedDeliveries[0])},'${driverUser}')`);
  one(`insert into public.couranr_handoff_codes(
    delivery_id,code_kind,generation,code_digest,code_state,issued_by,
    expires_at,consumed_at)
    values('${mixedDeliveries[0]}','merchant_return',1,repeat('a',64),
      'consumed','${owner}',now()+interval '1 hour',now())`);
  one(`insert into public.couranr_delivery_proofs(
    delivery_id,assignment_id,proof_stage,proof_type,actor_driver_id)
    values('${mixedDeliveries[0]}','${loadedAssignment}',
      'return','return_condition_photo','${driver}')`);
  one(`select id from public.couranr_complete_return('${mixedDeliveries[0]}',
    ${deliveryVersion(mixedDeliveries[0])},'${driverUser}')`);
  check("canonical return completion keeps Route resource until Route terminal",
    one(`select resource_state from public.couranr_route_run_resource_reservations
      where route_run_id='${mixedRoute}'`),"committed");
  check("mixed failed pickup closes only after refund and physical return",
    JSON.parse(one(`select public.couranr_complete_route_run_execution(
      '${mixedRoute}','${driverUser}')`)).outcome,"cancelled");
  check("mixed Route releases its shared resource exactly once",
    one(`select count(*) from public.couranr_route_run_execution_events
      where execution_id='${mixedExecution.executionId}'
        and event_type='resource_released'`),"1");

  // A failed first drop-off cannot silently skip Stop 2 or release the driver.
  // Operations may explicitly continue, but return cargo still blocks the
  // terminal Route command after the final normal delivery.
  const {routeId:exceptionRoute,childDeliveries:exceptionDeliveries,
    routeExecution:exceptionExecution}=await fundedExecution(
      "rr004failedstop","Recipient unavailable route");
  for(const deliveryId of exceptionDeliveries){
    const assignment=one(`select id from public.couranr_delivery_assignments
      where delivery_id='${deliveryId}'`);
    one(`insert into public.couranr_delivery_proofs(
      delivery_id,assignment_id,proof_stage,proof_type,actor_driver_id)
      values('${deliveryId}','${assignment}',
        'pickup','shipment_photo','${driver}')`);
    one(`insert into public.couranr_handoff_records(
      delivery_id,assignment_id,handoff_stage,confirmed_vehicle_id,
      latitude,longitude,accuracy_m,actor_driver_id)
      values('${deliveryId}','${assignment}',
        'pickup','${vehicle}',38.3,-77.4,9,'${driver}')`);
    one(`update public.couranr_deliveries set fulfillment_state='picked_up',
      version=version+1 where id='${deliveryId}'`);
  }
  one(`select public.couranr_depart_route_run_pickup('${exceptionRoute}',
    '${driverUser}')`);
  one(`select id from public.couranr_arrive_at_dropoff(
    '${exceptionDeliveries[0]}',${deliveryVersion(exceptionDeliveries[0])},
    '${driverUser}',38.4,-77.3,8)`);
  one(`select id from public.couranr_report_dropoff_exception_v2(
    '${exceptionDeliveries[0]}','${driverUser}','recipient_unavailable',
    'No recipient at Stop 1',38.4,-77.3,8)`);
  one(`select id from public.couranr_require_return('${exceptionDeliveries[0]}',
    ${deliveryVersion(exceptionDeliveries[0])},'${ops}',
    'recipient_unavailable','Operations return review')`);
  check("failed Stop 1 pauses the Route and leaves Stop 2 in transit",
    one(`select execution_state||':'||current_sequence from
      public.couranr_route_run_executions
      where id='${exceptionExecution.executionId}'`),"exception:1");
  refuses("later Stop 2 remains blocked before Operations resolves exception",
    `select id from public.couranr_arrive_at_dropoff(
      '${exceptionDeliveries[1]}',${deliveryVersion(exceptionDeliveries[1])},
      '${driverUser}',38.4,-77.3,8)`,"route_stop_transition_not_authorized");
  check("Operations can explicitly continue later stops while return cargo remains",
    JSON.parse(one(`select public.couranr_resolve_route_run_exception(
      '${exceptionRoute}','${ops}','continue_later_stops')`)).currentSequence,2);
  one(`select id from public.couranr_arrive_at_dropoff(
    '${exceptionDeliveries[1]}',${deliveryVersion(exceptionDeliveries[1])},
    '${driverUser}',38.4,-77.3,8)`);
  simulateDelivered(exceptionDeliveries[1]);
  refuses("last normal child delivered does not release open return cargo",
    `select public.couranr_advance_route_run_stop('${exceptionRoute}',
      '${driverUser}')`,"route_custody_not_terminal");
  check("Route resource remains committed during return cargo recovery",
    one(`select resource_state from public.couranr_route_run_resource_reservations
      where route_run_id='${exceptionRoute}'`),"committed");
  one(`select id from public.couranr_start_return('${exceptionDeliveries[0]}',
    ${deliveryVersion(exceptionDeliveries[0])},'${driverUser}')`);
  const returnAssignment=one(`select id from public.couranr_delivery_assignments
    where delivery_id='${exceptionDeliveries[0]}'`);
  one(`insert into public.couranr_handoff_codes(
    delivery_id,code_kind,generation,code_digest,code_state,issued_by,
    expires_at,consumed_at)
    values('${exceptionDeliveries[0]}','merchant_return',1,repeat('b',64),
      'consumed','${owner}',now()+interval '1 hour',now())`);
  one(`insert into public.couranr_delivery_proofs(
    delivery_id,assignment_id,proof_stage,proof_type,actor_driver_id)
    values('${exceptionDeliveries[0]}','${returnAssignment}',
      'return','return_condition_photo','${driver}')`);
  one(`select id from public.couranr_complete_return('${exceptionDeliveries[0]}',
    ${deliveryVersion(exceptionDeliveries[0])},'${driverUser}')`);
  check("final Route completion requires the return to reach terminal custody",
    JSON.parse(one(`select public.couranr_advance_route_run_stop(
      '${exceptionRoute}','${driverUser}')`)).outcome,"completed");
  check("failed-stop Route releases shared resource once after both child outcomes",
    one(`select count(*) from public.couranr_route_run_execution_events
      where execution_id='${exceptionExecution.executionId}'
        and event_type='resource_released'`),"1");
  console.log(`RR-004a Execution ${checks}/${checks} PASS (disposable PostgreSQL; no provider calls).`);
}finally{down({quiet:true})}

-- Empty-semantic rollback only. A Route-owned plan or delivery is a durable
-- commitment; never erase its identity to make an older binary look healthy.
begin;
set local lock_timeout='5s';
set local statement_timeout='90s';
lock table public.couranr_service_plans,
  public.couranr_deliveries,
  public.couranr_route_run_settlement_events in access exclusive mode;
do $$ begin
  if exists(select 1 from public.couranr_service_plans where plan_source='route_run'
    or route_run_id is not null or route_version_id is not null)
     or exists(select 1 from public.couranr_deliveries where plan_source='route_run'
       or route_run_id is not null or route_version_id is not null)
     or exists(select 1 from public.couranr_route_run_settlement_events
       where event_type='service_plans_confirmed') then
    raise exception 'route_service_plan_rollback_refuses_semantic_use';
  end if;
end $$;

drop function public.couranr_confirm_route_service_plans(uuid,uuid,uuid,integer);
drop trigger couranr_route_plan_identity_guard on public.couranr_service_plans;
drop trigger couranr_route_delivery_identity_guard on public.couranr_deliveries;
drop function private.couranr_guard_route_plan_identity();
drop function private.couranr_guard_route_delivery_identity();

alter table public.couranr_route_run_settlement_events
  drop constraint couranr_rrsette_type_chk;
alter table public.couranr_route_run_settlement_events
  add constraint couranr_rrsette_type_chk check(event_type in (
    'checkout_confirmed','authorization_attempt_started','provider_uncertain','provider_reconciled',
    'authorization_state_changed','resource_reserved','capture_state_changed',
    'recovery_required','ready_for_execution','checkout_cancelled','pickup_ready_confirmed'
  ));

create or replace function private.couranr_copy_plan_automation_metadata()
returns trigger language plpgsql set search_path='' as $fn$
declare v_plan public.couranr_service_plans;
begin
  select * into v_plan from public.couranr_service_plans where id=new.service_plan_id;
  if not found then raise exception 'service_plan_not_found' using errcode='CR409'; end if;
  new.plan_source:=v_plan.plan_source;
  new.planner_version:=v_plan.planner_version;
  new.market_key:=v_plan.market_key;
  new.dispatch_not_before:=v_plan.dispatch_not_before;
  new.dispatch_deadline:=v_plan.dispatch_deadline;
  new.expected_service_end:=v_plan.expected_service_end;
  new.last_revalidated_at:=v_plan.last_revalidated_at;
  new.revalidated_loaded_miles:=v_plan.revalidated_loaded_miles;
  new.revalidated_route_duration_seconds:=v_plan.revalidated_route_duration_seconds;
  new.revalidated_traffic_delay_seconds:=v_plan.revalidated_traffic_delay_seconds;
  return new;
end
$fn$;

alter table public.couranr_service_plans drop constraint couranr_sp_route_identity_chk;
alter table public.couranr_service_plans drop constraint couranr_sp_route_version_fk;
alter table public.couranr_deliveries drop constraint couranr_dlv_route_identity_chk;
alter table public.couranr_deliveries drop constraint couranr_dlv_route_version_fk;
drop index public.couranr_sp_route_idx;
drop index public.couranr_dlv_route_idx;
alter table public.couranr_service_plans
  drop column route_run_id,drop column route_version_id;
alter table public.couranr_deliveries
  drop column route_run_id,drop column route_version_id;

alter table public.couranr_service_plans drop constraint couranr_sp_plan_source_chk;
alter table public.couranr_service_plans add constraint couranr_sp_plan_source_chk
  check(plan_source in ('operations','automatic'));
alter table public.couranr_service_plans drop constraint couranr_sp_confirmed_stamp_chk;
alter table public.couranr_service_plans add constraint couranr_sp_confirmed_stamp_chk
  check(plan_state<>'confirmed' or (confirmed_at is not null and (
    (plan_source='operations' and confirmed_by is not null)
    or (plan_source='automatic' and confirmed_by is null))));
alter table public.couranr_deliveries drop constraint couranr_dlv_plan_source_chk;
alter table public.couranr_deliveries add constraint couranr_dlv_plan_source_chk
  check(plan_source in ('operations','automatic'));
commit;

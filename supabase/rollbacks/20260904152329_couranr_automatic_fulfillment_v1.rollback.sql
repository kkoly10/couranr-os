-- Roll back 20260904152329_couranr_automatic_fulfillment_v1.
-- REAL PRODUCTION DATA: automatic plans, exceptions, reservations and system
-- assignments are operational/audit evidence. Refuse if any exist.
begin;
do $$
begin
  if exists(select 1 from public.couranr_service_plans where plan_source='automatic')
     or exists(select 1 from public.couranr_automation_exceptions)
     or exists(select 1 from public.couranr_capacity_reservations)
     or exists(select 1 from public.couranr_dispatch_reservations)
     or exists(select 1 from public.couranr_delivery_assignments where assignment_source='automatic')
     or exists(select 1 from public.couranr_delivery_request_events where command in ('auto_accept_delivery_request','auto_plan_delivery_request')) then
    raise exception 'refusing to remove automatic fulfillment evidence; roll forward';
  end if;
end $$;

drop trigger if exists couranr_assignment_reservation_guard on public.couranr_delivery_assignments;
drop function if exists private.couranr_assignment_reservation_guard() restrict;
drop function if exists public.couranr_commit_automatic_assignment(uuid,uuid,integer,text) restrict;
drop function if exists public.couranr_release_automatic_dispatch_reservation(uuid,text) restrict;
drop function if exists public.couranr_reserve_automatic_dispatch_candidate(uuid,timestamptz) restrict;
drop function if exists public.couranr_record_auto_revalidation(uuid,numeric,integer,integer) restrict;
drop function if exists public.couranr_try_auto_plan(uuid,text,timestamptz) restrict;
drop function if exists public.couranr_try_auto_accept_standard_request(uuid) restrict;
drop function if exists private.couranr_automatic_lane_reason(uuid) restrict;
drop function if exists public.couranr_resolve_automation_exception(uuid,text) restrict;
drop function if exists public.couranr_open_automation_exception(uuid,text,text,jsonb,uuid,uuid) restrict;

drop trigger if exists couranr_cancel_capacity_with_plan on public.couranr_service_plans;
drop function if exists private.couranr_cancel_capacity_with_plan() restrict;
drop trigger if exists couranr_copy_plan_automation_metadata on public.couranr_deliveries;
drop function if exists private.couranr_copy_plan_automation_metadata() restrict;

alter table public.couranr_delivery_assignments
  drop constraint if exists couranr_asg_source_actor_chk;
alter table public.couranr_delivery_assignments
  drop constraint if exists couranr_asg_dispatch_reservation_fk;
alter table public.couranr_delivery_assignments
  alter column assigned_by set not null;
alter table public.couranr_delivery_assignments
  drop column if exists assignment_source,
  drop column if exists dispatch_reservation_id;

drop table if exists public.couranr_dispatch_reservations restrict;
drop table if exists public.couranr_automation_exceptions restrict;
drop table if exists public.couranr_capacity_reservations restrict;
drop table if exists public.couranr_operating_closures restrict;
drop table if exists public.couranr_capacity_policies restrict;

alter table public.couranr_deliveries
  drop constraint if exists couranr_dlv_plan_source_chk;
alter table public.couranr_deliveries
  drop column if exists plan_source,
  drop column if exists planner_version,
  drop column if exists market_key,
  drop column if exists dispatch_not_before,
  drop column if exists dispatch_deadline,
  drop column if exists expected_service_end,
  drop column if exists last_revalidated_at,
  drop column if exists revalidated_loaded_miles,
  drop column if exists revalidated_route_duration_seconds,
  drop column if exists revalidated_traffic_delay_seconds;

alter table public.couranr_service_plans
  drop constraint if exists couranr_sp_auto_schedule_chk;
alter table public.couranr_service_plans
  drop constraint if exists couranr_sp_plan_source_chk;
alter table public.couranr_service_plans
  drop constraint if exists couranr_sp_confirmed_stamp_chk;
alter table public.couranr_service_plans
  add constraint couranr_sp_confirmed_stamp_chk
  check (plan_state<>'confirmed' or (confirmed_by is not null and confirmed_at is not null));
alter table public.couranr_service_plans
  drop column if exists plan_source,
  drop column if exists planner_version,
  drop column if exists market_key,
  drop column if exists dispatch_not_before,
  drop column if exists dispatch_deadline,
  drop column if exists expected_service_end,
  drop column if exists last_revalidated_at,
  drop column if exists revalidated_loaded_miles,
  drop column if exists revalidated_route_duration_seconds,
  drop column if exists revalidated_traffic_delay_seconds;

alter table public.couranr_delivery_request_events
  drop constraint if exists couranr_dre_command_chk;
alter table public.couranr_delivery_request_events
  add constraint couranr_dre_command_chk check (command in (
    'create_delivery_request_draft','calculate_delivery_request_estimate','create_quote_version',
    'submit_delivery_request','begin_delivery_request_review','accept_delivery_request_as_quoted',
    'requote_delivery_request','decline_delivery_request','record_payer_quote_approval',
    'begin_delivery_preparation','mark_delivery_ready','mark_delivery_not_ready',
    'mark_delivery_unavailable','cancel_delivery_request','apply_promotional_credit'
  ));
commit;

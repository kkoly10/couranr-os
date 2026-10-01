-- RR-004a: empty-schema rollback only. A Route execution is custody-adjacent
-- historical authority and can never be destroyed after semantic use.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
lock table public.couranr_route_run_executions,
  public.couranr_route_run_execution_events,
  public.couranr_delivery_assignments in access exclusive mode;
do $$ begin
  if exists(select 1 from public.couranr_route_run_executions)
    or exists(select 1 from public.couranr_route_run_execution_events)
    or exists(select 1 from public.couranr_delivery_assignments
      where route_run_id is not null or route_execution_id is not null) then
    raise exception 'route_execution_rollback_refuses_semantic_use';
  end if;
end $$;
drop function public.couranr_begin_route_execution(uuid,uuid,uuid);
create or replace function public.couranr_claim_route_checkout_maintenance(
  p_limit integer default 2)
returns table(route_run_id uuid,business_account_id uuid)
language sql security definer set search_path='' as $fn$
  with candidates as (
    select s.id from public.couranr_route_run_settlements s
     where s.settlement_state in (
       'pending_authorization','authorization_required','authorization_unknown',
       'authorization_failed','authorized','resource_reserved','capture_pending',
       'recovery_required')
     order by s.maintenance_checked_at nulls first,s.updated_at,s.id
     limit greatest(1,least(coalesce(p_limit,2),4))
     for update skip locked
  ), claimed as (
    update public.couranr_route_run_settlements s
       set maintenance_checked_at=clock_timestamp()
      from candidates c where s.id=c.id
    returning s.route_run_id,s.business_account_id
  ) select claimed.route_run_id,claimed.business_account_id from claimed
$fn$;
drop trigger couranr_validate_route_assignment on public.couranr_delivery_assignments;
drop function private.couranr_validate_route_assignment();
drop trigger couranr_route_child_assignment_gate on public.couranr_delivery_assignments;
create trigger couranr_route_child_assignment_gate
  before insert or update of assignment_state,delivery_id
  on public.couranr_delivery_assignments for each row
  execute function private.couranr_block_route_child_standalone_assignment();
drop trigger couranr_ordinary_assignment_route_resource_guard
  on public.couranr_delivery_assignments;
create trigger couranr_ordinary_assignment_route_resource_guard
  before insert or update of driver_id,vehicle_id,assignment_state
  on public.couranr_delivery_assignments for each row
  execute function private.couranr_guard_ordinary_resource_against_route();
drop trigger couranr_assignment_reservation_guard
  on public.couranr_delivery_assignments;
create trigger couranr_assignment_reservation_guard
  before insert on public.couranr_delivery_assignments for each row
  execute function private.couranr_assignment_reservation_guard();
drop index public.couranr_asg_one_active_nonroute_driver;
create unique index couranr_asg_one_active_per_driver
  on public.couranr_delivery_assignments(driver_id)
  where assignment_state='active';
alter table public.couranr_delivery_assignments
  drop constraint couranr_asg_source_actor_chk;
alter table public.couranr_delivery_assignments
  add constraint couranr_asg_source_actor_chk check (
    (assignment_source='operations' and assigned_by is not null)
    or (assignment_source='automatic' and assigned_by is null
      and dispatch_reservation_id is not null));
drop index public.couranr_asg_route_execution_state_idx;
alter table public.couranr_delivery_assignments
  drop constraint couranr_asg_route_execution_fk,
  drop constraint couranr_asg_route_pair_chk,
  drop column route_execution_id,
  drop column route_run_id;
drop table public.couranr_route_run_execution_events restrict;
drop table public.couranr_route_run_executions restrict;
create or replace function public.couranr_driver_assignment_for(
  p_delivery_id uuid,p_actor_user_id uuid
) returns public.couranr_delivery_assignments
language plpgsql security invoker set search_path='' as $fn$
declare v_drv public.couranr_drivers;
  v_asg public.couranr_delivery_assignments;
begin
  if p_actor_user_id is null then
    raise exception 'actor_required' using errcode='CR403';
  end if;
  select * into v_drv from public.couranr_drivers where user_id=p_actor_user_id;
  if not found then raise exception 'not_your_delivery' using errcode='CR403'; end if;
  select * into v_asg from public.couranr_delivery_assignments
    where driver_id=v_drv.id and assignment_state='active' for update;
  if not found or v_asg.delivery_id is distinct from p_delivery_id then
    raise exception 'not_your_delivery' using errcode='CR403';
  end if;
  return v_asg;
end $fn$;
create or replace function public.couranr_release_assignment_resources(
  p_driver_id uuid,p_vehicle_id uuid
) returns void language plpgsql security invoker set search_path='' as $fn$
begin
  update public.couranr_drivers
     set availability_state=case when driver_state='active' and active
       then 'available' else 'unavailable' end,
       version=version+1,updated_at=now() where id=p_driver_id;
  update public.couranr_dispatch_vehicles
     set availability_state=case when active then 'available' else 'unavailable' end,
       version=version+1,updated_at=now() where id=p_vehicle_id;
end $fn$;
commit;

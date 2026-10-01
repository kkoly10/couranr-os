-- RR-004a: one Route execution owns several canonical child assignments.
-- No proof, pickup or stop movement is introduced by this stage. Existing
-- ordinary one-active-driver behavior remains the default and is database-
-- enforced; only exact siblings of the SAME funded Route share a resource.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

do $$ begin
  if to_regclass('public.couranr_route_run_settlements') is null
     or to_regclass('public.couranr_route_run_resource_reservations') is null
     or to_regclass('public.couranr_delivery_assignments') is null
     or to_regclass('public.couranr_asg_one_active_per_driver') is null
     or to_regprocedure('public.couranr_complete_route_run_funding(uuid,uuid,uuid)') is null
     or to_regprocedure('public.couranr_driver_assignment_for(uuid,uuid)') is null then
    raise exception 'route_execution_requires_rr003_and_driver_commands';
  end if;
  if to_regclass('public.couranr_route_run_executions') is not null then
    raise exception 'route_execution_schema_already_exists';
  end if;
end $$;

create table public.couranr_route_run_executions (
  id uuid primary key default gen_random_uuid(),
  route_run_id uuid not null unique references public.couranr_route_runs(id),
  route_version_id uuid not null,
  settlement_id uuid not null unique references public.couranr_route_run_settlements(id),
  resource_id uuid not null unique references public.couranr_route_run_resource_reservations(id),
  driver_id uuid not null references public.couranr_drivers(id),
  vehicle_id uuid not null references public.couranr_dispatch_vehicles(id),
  current_sequence integer not null default 0,
  execution_state text not null default 'ready',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  constraint couranr_rrex_route_version_fk foreign key(route_run_id,route_version_id)
    references public.couranr_route_run_versions(route_run_id,id),
  constraint couranr_rrex_route_id_pair_uniq unique(route_run_id,id),
  constraint couranr_rrex_sequence_chk check(current_sequence between 0 and 5),
  constraint couranr_rrex_version_chk check(version>=1),
  constraint couranr_rrex_state_chk check(execution_state in (
    'ready','en_route_to_pickup','at_pickup','in_progress','exception',
    'returning','completed','cancelled')),
  constraint couranr_rrex_completed_stamp_chk check(
    (execution_state<>'completed' or completed_at is not null)
    and (execution_state<>'cancelled' or cancelled_at is not null))
);
create index couranr_rrex_driver_state_idx
  on public.couranr_route_run_executions(driver_id,execution_state);
create index couranr_rrex_route_version_idx
  on public.couranr_route_run_executions(route_run_id,route_version_id);
create index couranr_rrex_vehicle_idx
  on public.couranr_route_run_executions(vehicle_id);

create table public.couranr_route_run_execution_events (
  id uuid primary key default gen_random_uuid(),
  execution_id uuid not null references public.couranr_route_run_executions(id),
  actor_user_id uuid references auth.users(id),
  event_type text not null check(event_type in (
    'assignment_committed','departed_for_pickup','arrived_at_pickup',
    'departed_with_cargo','stop_advanced','exception_paused',
    'operations_continue','operations_return','route_completed',
    'route_cancelled',
    'resource_released')),
  detail jsonb not null default '{}'::jsonb check(jsonb_typeof(detail)='object'),
  created_at timestamptz not null default now()
);
create index couranr_rrexe_execution_created_idx
  on public.couranr_route_run_execution_events(execution_id,created_at);
create index couranr_rrexe_actor_idx
  on public.couranr_route_run_execution_events(actor_user_id);

alter table public.couranr_route_run_executions enable row level security;
alter table public.couranr_route_run_execution_events enable row level security;
revoke all on public.couranr_route_run_executions,
  public.couranr_route_run_execution_events from public,anon,authenticated,service_role;
grant select on public.couranr_route_run_executions,
  public.couranr_route_run_execution_events to service_role;

alter table public.couranr_delivery_assignments
  add column route_run_id uuid,
  add column route_execution_id uuid;
alter table public.couranr_delivery_assignments
  add constraint couranr_asg_route_execution_fk
    foreign key(route_run_id,route_execution_id)
    references public.couranr_route_run_executions(route_run_id,id),
  add constraint couranr_asg_route_pair_chk check(
    (route_run_id is null and route_execution_id is null)
    or (route_run_id is not null and route_execution_id is not null));
create index couranr_asg_route_execution_state_idx
  on public.couranr_delivery_assignments(route_execution_id,assignment_state)
  where route_execution_id is not null;
create index couranr_asg_route_execution_fk_idx
  on public.couranr_delivery_assignments(route_run_id,route_execution_id);

alter table public.couranr_delivery_assignments
  drop constraint couranr_asg_source_actor_chk;
alter table public.couranr_delivery_assignments
  add constraint couranr_asg_source_actor_chk check (
    (assignment_source='operations' and assigned_by is not null
      and route_run_id is null and route_execution_id is null)
    or (assignment_source='automatic' and assigned_by is null
      and dispatch_reservation_id is not null
      and route_run_id is null and route_execution_id is null)
    or (assignment_source='route_run' and assigned_by is null
      and dispatch_reservation_id is null
      and route_run_id is not null and route_execution_id is not null)
  );

-- The old unique index still governs non-Route work. The narrow replacement
-- leaves Route siblings to the serialized trigger below, which also refuses
-- a non-Route assignment if the resource is already Route-owned.
drop index public.couranr_asg_one_active_per_driver;
create unique index couranr_asg_one_active_nonroute_driver
  on public.couranr_delivery_assignments(driver_id)
  where assignment_state='active' and route_execution_id is null;

-- Keep the proven ordinary reservation and Route-resource guards for their
-- original callers. Route-owned rows get a stricter exact-child guard below.
drop trigger couranr_assignment_reservation_guard
  on public.couranr_delivery_assignments;
create trigger couranr_assignment_reservation_guard
  before insert on public.couranr_delivery_assignments
  for each row when (new.assignment_source<>'route_run')
  execute function private.couranr_assignment_reservation_guard();
drop trigger couranr_ordinary_assignment_route_resource_guard
  on public.couranr_delivery_assignments;
create trigger couranr_ordinary_assignment_route_resource_guard
  before insert or update of driver_id,vehicle_id,assignment_state
  on public.couranr_delivery_assignments
  for each row when (new.assignment_source<>'route_run')
  execute function private.couranr_guard_ordinary_resource_against_route();
drop trigger couranr_route_child_assignment_gate
  on public.couranr_delivery_assignments;
create trigger couranr_route_child_assignment_gate
  before insert or update of assignment_state,delivery_id
  on public.couranr_delivery_assignments
  for each row when (new.assignment_source<>'route_run')
  execute function private.couranr_block_route_child_standalone_assignment();

create function private.couranr_validate_route_assignment()
returns trigger language plpgsql security definer set search_path='' as $fn$
declare
  v_exec public.couranr_route_run_executions;
begin
  if tg_op='UPDATE' and
     (old.delivery_id,old.driver_id,old.vehicle_id,old.route_run_id,
      old.route_execution_id,old.assignment_source)
       is distinct from
     (new.delivery_id,new.driver_id,new.vehicle_id,new.route_run_id,
      new.route_execution_id,new.assignment_source) then
    raise exception 'route_assignment_identity_immutable' using errcode='CR409';
  end if;
  if new.assignment_source<>'route_run' then return new; end if;
  if new.assignment_state<>'active' then return new; end if;
  if not pg_try_advisory_xact_lock(hashtext('couranr-resource-allocation')) then
    raise exception 'resource_allocation_busy_retry' using errcode='CR409';
  end if;
  select * into v_exec from public.couranr_route_run_executions
   where id=new.route_execution_id and route_run_id=new.route_run_id for update;
  if not found or v_exec.execution_state in ('completed','cancelled')
     or v_exec.driver_id is distinct from new.driver_id
     or v_exec.vehicle_id is distinct from new.vehicle_id then
    raise exception 'route_assignment_resource_mismatch' using errcode='CR409';
  end if;
  if not exists(
    select 1 from public.couranr_route_run_resource_reservations res
    join public.couranr_route_run_settlements s on s.id=res.settlement_id
    join public.couranr_route_runs rr on rr.id=s.route_run_id
    join public.couranr_route_run_settlement_items item on item.settlement_id=s.id
    join public.couranr_deliveries d on d.request_id=item.request_id
    join public.couranr_route_run_stops stop
      on stop.route_version_id=s.route_version_id
      and stop.request_id=item.request_id and stop.sequence=item.sequence
    where res.id=v_exec.resource_id and res.resource_state='committed'
      and res.route_run_id=v_exec.route_run_id
      and res.driver_id=new.driver_id and res.vehicle_id=new.vehicle_id
      and s.id=v_exec.settlement_id and s.settlement_state='ready_for_execution'
      and rr.id=v_exec.route_run_id and rr.route_state='accepted'
      and d.id=new.delivery_id and d.route_run_id=v_exec.route_run_id
      and d.quote_version_id=item.quote_version_id
      and item.obligation_id=d.payment_obligation_id
  ) then
    raise exception 'route_assignment_child_not_funded' using errcode='CR409';
  end if;
  if exists(
    select 1 from public.couranr_delivery_assignments a
    where a.assignment_state='active' and a.id is distinct from new.id
      and (a.driver_id=new.driver_id or a.vehicle_id=new.vehicle_id)
      and (a.route_execution_id is distinct from new.route_execution_id
        or a.driver_id is distinct from new.driver_id
        or a.vehicle_id is distinct from new.vehicle_id)
  ) then
    raise exception 'resource_owned_by_other_assignment' using errcode='CR409';
  end if;
  return new;
end
$fn$;
revoke all on function private.couranr_validate_route_assignment()
  from public,anon,authenticated,service_role;
create trigger couranr_validate_route_assignment
  before insert or update of assignment_state,delivery_id,driver_id,vehicle_id,
    route_run_id,route_execution_id,assignment_source
  on public.couranr_delivery_assignments
  for each row execute function private.couranr_validate_route_assignment();

-- A driver can own several active assignments only inside one Route. Locate
-- the exact child rather than selecting an arbitrary active driver row.
create or replace function public.couranr_driver_assignment_for(
  p_delivery_id uuid,p_actor_user_id uuid
) returns public.couranr_delivery_assignments
language plpgsql security invoker set search_path='' as $fn$
declare v_asg public.couranr_delivery_assignments;
begin
  if p_actor_user_id is null then
    raise exception 'actor_required' using errcode='CR403';
  end if;
  select a.* into v_asg from public.couranr_delivery_assignments a
   join public.couranr_drivers d on d.id=a.driver_id
   where d.user_id=p_actor_user_id and a.delivery_id=p_delivery_id
     and a.assignment_state='active' for update of a;
  if not found then
    raise exception 'not_your_delivery' using errcode='CR403';
  end if;
  return v_asg;
end $fn$;

-- Child completion never frees a resource owned by a live Route. The Route
-- terminal command must release its reservation before availability changes.
create or replace function public.couranr_release_assignment_resources(
  p_driver_id uuid,p_vehicle_id uuid
) returns void language plpgsql security invoker set search_path='' as $fn$
begin
  if exists(select 1 from public.couranr_route_run_resource_reservations r
    where r.resource_state='committed'
      and (r.driver_id=p_driver_id or r.vehicle_id=p_vehicle_id)) then
    return;
  end if;
  update public.couranr_drivers
     set availability_state=case when driver_state='active' and active
       then 'available' else 'unavailable' end,
       version=version+1,updated_at=now()
   where id=p_driver_id;
  update public.couranr_dispatch_vehicles
     set availability_state=case when active then 'available' else 'unavailable' end,
       version=version+1,updated_at=now()
   where id=p_vehicle_id;
end $fn$;

create function public.couranr_begin_route_execution(
  p_business_account_id uuid,p_actor_user_id uuid,p_route_run_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare
  v_route public.couranr_route_runs;
  v_settlement public.couranr_route_run_settlements;
  v_resource public.couranr_route_run_resource_reservations;
  v_exec public.couranr_route_run_executions;
  v_item record;
  v_asg public.couranr_delivery_assignments;
  v_delivery public.couranr_deliveries;
  v_count integer:=0;
begin
  perform private.couranr_require_route_checkout_member(
    p_business_account_id,p_actor_user_id);
  if not pg_try_advisory_xact_lock(hashtext('couranr-resource-allocation')) then
    raise exception 'resource_allocation_busy_retry' using errcode='CR409';
  end if;
  select * into v_route from public.couranr_route_runs
   where id=p_route_run_id and business_account_id=p_business_account_id for update;
  if not found or v_route.route_state<>'accepted' then
    raise exception 'route_execution_route_not_accepted' using errcode='CR409';
  end if;
  select * into v_exec from public.couranr_route_run_executions
   where route_run_id=p_route_run_id for update;
  if found then
    return jsonb_build_object('executionId',v_exec.id,
      'routeRunId',v_exec.route_run_id,'outcome','already_started');
  end if;
  select * into v_settlement from public.couranr_route_run_settlements
   where route_run_id=v_route.id for update;
  if not found or v_settlement.settlement_state<>'ready_for_execution' then
    raise exception 'route_execution_not_funded' using errcode='CR409';
  end if;
  select * into v_resource from public.couranr_route_run_resource_reservations
   where settlement_id=v_settlement.id for update;
  if not found or v_resource.resource_state<>'committed'
    or v_resource.route_version_id is distinct from v_settlement.route_version_id then
    raise exception 'route_execution_resource_not_committed' using errcode='CR409';
  end if;
  if exists(select 1 from public.couranr_delivery_assignments a
    where a.assignment_state='active' and
      (a.driver_id=v_resource.driver_id or a.vehicle_id=v_resource.vehicle_id)) then
    raise exception 'route_execution_resource_already_assigned' using errcode='CR409';
  end if;
  insert into public.couranr_route_run_executions(
    route_run_id,route_version_id,settlement_id,resource_id,driver_id,vehicle_id)
  values(v_route.id,v_settlement.route_version_id,v_settlement.id,v_resource.id,
    v_resource.driver_id,v_resource.vehicle_id) returning * into v_exec;
  for v_item in
    select i.*,d.id as delivery_id,d.fulfillment_state,d.version as delivery_version
      from public.couranr_route_run_settlement_items i
      join public.couranr_deliveries d on d.request_id=i.request_id
     where i.settlement_id=v_settlement.id
     order by i.sequence for update of d
  loop
    if v_item.fulfillment_state<>'scheduled'
      or not exists(select 1 from public.couranr_payment_obligations o
        where o.id=v_item.obligation_id and o.payment_state='captured'
          and o.quote_version_id=v_item.quote_version_id)
      or not exists(select 1 from public.couranr_service_plans p
        where p.request_id=v_item.request_id and p.plan_state='confirmed'
          and p.payment_obligation_id=v_item.obligation_id
          and p.quote_version_id=v_item.quote_version_id) then
      raise exception 'route_execution_child_not_ready' using errcode='CR409';
    end if;
    insert into public.couranr_delivery_assignments(
      delivery_id,driver_id,vehicle_id,assigned_by,assignment_source,
      route_run_id,route_execution_id,idempotency_key)
    values(v_item.delivery_id,v_resource.driver_id,v_resource.vehicle_id,
      null,'route_run',v_route.id,v_exec.id,
      'route-execution:'||v_exec.id::text||':stop:'||v_item.sequence::text)
    returning * into v_asg;
    insert into public.couranr_assignment_events(
      assignment_id,delivery_id,actor_user_id,actor_type,command,
      from_state,to_state,metadata)
    values(v_asg.id,v_item.delivery_id,p_actor_user_id,'operations',
      'assign_delivery',null,'active',
      jsonb_build_object('routeExecutionId',v_exec.id,'sequence',v_item.sequence));
    update public.couranr_deliveries
      set fulfillment_state='assigned',version=version+1,updated_at=now()
     where id=v_item.delivery_id and fulfillment_state='scheduled'
       and version=v_item.delivery_version
     returning * into v_delivery;
    if not found then raise exception 'route_execution_child_cas_conflict'
      using errcode='CR409'; end if;
    insert into public.couranr_delivery_events(
      delivery_id,actor_user_id,actor_type,command,from_state,to_state,metadata)
    values(v_item.delivery_id,p_actor_user_id,'operations','assign_delivery',
      'scheduled','assigned',
      jsonb_build_object('assignmentId',v_asg.id,'routeExecutionId',v_exec.id));
    v_count:=v_count+1;
  end loop;
  if v_count not between 2 and 5 or v_count<>(select stop_count
    from public.couranr_route_run_versions where id=v_settlement.route_version_id) then
    raise exception 'route_execution_child_count_mismatch' using errcode='CR409';
  end if;
  update public.couranr_drivers set availability_state='on_delivery',
    version=version+1,updated_at=now() where id=v_resource.driver_id;
  update public.couranr_dispatch_vehicles set availability_state='on_delivery',
    version=version+1,updated_at=now() where id=v_resource.vehicle_id;
  insert into public.couranr_route_run_execution_events(
    execution_id,actor_user_id,event_type,detail)
  values(v_exec.id,p_actor_user_id,'assignment_committed',
    jsonb_build_object('childCount',v_count,'driverId',v_resource.driver_id));
  return jsonb_build_object('executionId',v_exec.id,'routeRunId',v_route.id,
    'outcome','assigned','childCount',v_count);
end $fn$;
revoke all on function public.couranr_begin_route_execution(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_begin_route_execution(uuid,uuid,uuid)
  to service_role;

-- Funding may commit just before a worker process dies. Keep the ready Route
-- in the fair maintenance queue until its exact child assignments exist.
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
       or (s.settlement_state='ready_for_execution' and not exists(
         select 1 from public.couranr_route_run_executions e
         where e.route_run_id=s.route_run_id))
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
commit;

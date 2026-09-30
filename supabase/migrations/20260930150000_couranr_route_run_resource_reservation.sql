-- RR-003c: one Route-owned driver/vehicle resource before any child capture.
-- This migration performs no provider I/O, capture, delivery conversion or
-- assignment. The existing ordinary reservation/assignment writers are
-- cross-fenced at their shared database insertion boundary.
begin;
set local lock_timeout='5s';
set local statement_timeout='90s';

do $$ begin
  if to_regclass('public.couranr_route_run_settlements') is null
     or to_regclass('public.couranr_dispatch_reservations') is null
     or to_regclass('public.couranr_delivery_assignments') is null
     or to_regprocedure('public.couranr_vehicle_incompatibility(uuid,uuid,jsonb)') is null then
    raise exception 'route_resource_requires_rr003b_and_managed_dispatch';
  end if;
end $$;

create table public.couranr_route_run_resource_reservations (
  id uuid primary key default gen_random_uuid(),
  route_run_id uuid not null unique references public.couranr_route_runs(id),
  settlement_id uuid not null unique references public.couranr_route_run_settlements(id),
  route_version_id uuid not null references public.couranr_route_run_versions(id),
  driver_id uuid not null references public.couranr_drivers(id),
  vehicle_id uuid not null references public.couranr_dispatch_vehicles(id),
  market_key text not null,
  total_payload_lb numeric(8,2) not null,
  package_count integer not null,
  vehicle_requirement jsonb not null,
  resource_state text not null default 'reserved',
  reserved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  committed_at timestamptz,
  released_at timestamptz,
  release_reason text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint couranr_rrres_state_chk check(resource_state in
    ('reserved','committed','released','expired')),
  constraint couranr_rrres_payload_chk check(total_payload_lb>0 and package_count between 2 and 49995),
  constraint couranr_rrres_requirement_chk check(
    jsonb_typeof(vehicle_requirement)='object'
    and vehicle_requirement->>'vehicleClass' in ('car','van','box_truck','cargo_bike')
    and (vehicle_requirement->>'maxPayloadLb')::numeric>=total_payload_lb),
  constraint couranr_rrres_timestamps_chk check(
    expires_at>reserved_at
    and (resource_state<>'committed' or committed_at is not null)
    and (resource_state not in ('released','expired') or released_at is not null)),
  constraint couranr_rrres_version_chk check(version>=1),
  constraint couranr_rrres_route_version_fk
    foreign key(route_run_id,route_version_id)
    references public.couranr_route_run_versions(route_run_id,id)
);
create unique index couranr_rrres_one_live_driver
  on public.couranr_route_run_resource_reservations(driver_id)
  where resource_state in ('reserved','committed');
create unique index couranr_rrres_one_live_vehicle
  on public.couranr_route_run_resource_reservations(vehicle_id)
  where resource_state in ('reserved','committed');
create index couranr_rrres_route_version_idx
  on public.couranr_route_run_resource_reservations(route_run_id,route_version_id);

create table public.couranr_route_run_resource_events (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.couranr_route_run_resource_reservations(id),
  actor_user_id uuid references auth.users(id),
  event_type text not null check(event_type in
    ('reserved','committed','released','expired')),
  detail jsonb not null default '{}'::jsonb check(jsonb_typeof(detail)='object'),
  created_at timestamptz not null default now()
);
create index couranr_rrrese_resource_created_idx
  on public.couranr_route_run_resource_events(resource_id,created_at);

alter table public.couranr_route_run_resource_reservations enable row level security;
alter table public.couranr_route_run_resource_events enable row level security;
revoke all on public.couranr_route_run_resource_reservations,
  public.couranr_route_run_resource_events from public,anon,authenticated,service_role;
grant select on public.couranr_route_run_resource_reservations,
  public.couranr_route_run_resource_events to service_role;

-- A named global resource lock serializes Route reservation with every
-- ordinary reservation/assignment insertion. The ordinary triggers TRY the
-- lock: they fail quickly rather than deadlocking if their caller already
-- holds a candidate row while the Route command owns the global lock.
create function private.couranr_guard_ordinary_resource_against_route()
returns trigger language plpgsql security definer set search_path='' as $fn$
begin
  -- PL/pgSQL may evaluate both sides of a SQL OR expression. These tables
  -- have different state columns, so branch before reading either record.
  if tg_table_name='couranr_dispatch_reservations' then
    if new.reservation_state<>'active' then return new; end if;
  elsif tg_table_name='couranr_delivery_assignments' then
    if new.assignment_state<>'active' then return new; end if;
  else
    raise exception 'resource_guard_wrong_table' using errcode='CR409';
  end if;
  if not pg_try_advisory_xact_lock(hashtext('couranr-resource-allocation')) then
    raise exception 'resource_allocation_busy_retry' using errcode='CR409';
  end if;
  with expired as (
    update public.couranr_route_run_resource_reservations
       set resource_state='expired',released_at=now(),release_reason='reservation_ttl_expired',
           version=version+1,updated_at=now()
     where resource_state='reserved' and expires_at<=now()
     returning id
  )
  insert into public.couranr_route_run_resource_events(resource_id,event_type,detail)
    select id,'expired',jsonb_build_object('reason','reservation_ttl_expired')
    from expired;
  if exists(
    select 1 from public.couranr_route_run_resource_reservations r
    where (r.resource_state='committed'
      or (r.resource_state='reserved' and r.expires_at>now()))
      and (r.driver_id=new.driver_id or r.vehicle_id=new.vehicle_id)
  ) then
    raise exception 'resource_owned_by_route_run' using errcode='CR409';
  end if;
  return new;
end
$fn$;
revoke all on function private.couranr_guard_ordinary_resource_against_route()
  from public,anon,authenticated,service_role;
create trigger couranr_ordinary_reservation_route_resource_guard
before insert or update of driver_id,vehicle_id,reservation_state
on public.couranr_dispatch_reservations
for each row execute function private.couranr_guard_ordinary_resource_against_route();
create trigger couranr_ordinary_assignment_route_resource_guard
before insert or update of driver_id,vehicle_id,assignment_state
on public.couranr_delivery_assignments
for each row execute function private.couranr_guard_ordinary_resource_against_route();

create function public.couranr_reserve_route_run_resource(
  p_business_account_id uuid,p_actor_user_id uuid,p_route_run_id uuid,
  p_now timestamptz default now()
) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare
  v_route public.couranr_route_runs;
  v_settlement public.couranr_route_run_settlements;
  v_existing public.couranr_route_run_resource_reservations;
  v_resource public.couranr_route_run_resource_reservations;
  v_count integer;
  v_authorized integer;
  v_total_lb numeric;
  v_packages integer;
  v_bad integer;
  v_driver_id uuid;
  v_vehicle_id uuid;
  v_requirement jsonb;
  v_market text:='dc_va_launch_corridor';
begin
  perform private.couranr_require_route_checkout_member(p_business_account_id,p_actor_user_id);
  select * into v_route from public.couranr_route_runs
   where id=p_route_run_id and business_account_id=p_business_account_id for update;
  if not found then raise exception 'route_draft_not_found' using errcode='CR404'; end if;
  select * into v_settlement from public.couranr_route_run_settlements
   where route_run_id=v_route.id and business_account_id=p_business_account_id for update;
  if not found then raise exception 'route_settlement_not_found' using errcode='CR404'; end if;
  if v_route.route_state<>'accepted'
     or v_route.accepted_version<>v_route.current_version
     or v_settlement.route_version_id is distinct from (
       select id from public.couranr_route_run_versions
        where route_run_id=v_route.id and version=v_route.accepted_version)
     or v_settlement.settlement_state not in ('authorized','resource_reserved') then
    raise exception 'route_resource_requires_exact_authorized_settlement'
      using errcode='CR409';
  end if;
  select * into v_existing from public.couranr_route_run_resource_reservations
   where route_run_id=v_route.id for update;
  if found then
    if v_existing.resource_state='reserved' and v_existing.expires_at>p_now
       and v_settlement.settlement_state='resource_reserved' then
      return jsonb_build_object('outcome','reserved','resourceId',v_existing.id,
        'driverId',v_existing.driver_id,'vehicleId',v_existing.vehicle_id,
        'expiresAt',v_existing.expires_at,'totalPayloadLb',v_existing.total_payload_lb,
        'packageCount',v_existing.package_count);
    end if;
    raise exception 'route_resource_already_used_or_expired' using errcode='CR409';
  end if;
  if v_settlement.settlement_state<>'authorized' then
    raise exception 'route_resource_state_conflict' using errcode='CR409';
  end if;

  select count(*),count(*) filter(where o.payment_state='authorized')
    into v_count,v_authorized
    from public.couranr_route_run_settlement_items i
    join public.couranr_payment_obligations o on o.id=i.obligation_id
   where i.settlement_id=v_settlement.id
     and o.quote_version_id=i.quote_version_id and o.request_id=i.request_id
     and o.amount_cents=i.amount_cents;
  if v_count not between 2 and 5 or v_count<>v_authorized
     or v_count<>(select stop_count from public.couranr_route_run_versions
                  where id=v_settlement.route_version_id) then
    raise exception 'route_resource_child_authorization_mismatch'
      using errcode='CR409';
  end if;

  -- Source all cargo evidence from the accepted immutable Route stop/quote.
  -- A missing weight or package count is UNKNOWN, never zero. V1 conservatively
  -- requires the already-governed van class (box truck may substitute upward).
  select sum(case when coalesce(q.shipment_snapshot->>'weightLb','') ~ '^[0-9]+([.][0-9]+)?$'
                  then (q.shipment_snapshot->>'weightLb')::numeric else null end),
         sum(case when coalesce(s.request_snapshot->'pickupManifest'->>'packageCount','') ~ '^[0-9]+$'
                  then (s.request_snapshot->'pickupManifest'->>'packageCount')::integer else null end),
         count(*) filter(where
           q.serviceability_outcome is distinct from 'available_for_request'
           or coalesce(q.shipment_snapshot->>'weightLb','') !~ '^[0-9]+([.][0-9]+)?$'
           or coalesce(s.request_snapshot->'pickupManifest'->>'packageCount','') !~ '^[0-9]+$'
           or case when coalesce(q.shipment_snapshot->>'weightLb','') ~ '^[0-9]+([.][0-9]+)?$'
                   then (q.shipment_snapshot->>'weightLb')::numeric<=0 else true end
           or case when coalesce(s.request_snapshot->'pickupManifest'->>'packageCount','') ~ '^[0-9]+$'
                   then (s.request_snapshot->'pickupManifest'->>'packageCount')::integer<1 else true end)
    into v_total_lb,v_packages,v_bad
    from public.couranr_route_run_stops s
    join public.couranr_quote_versions q on q.id=s.quote_version_id
   where s.route_version_id=v_settlement.route_version_id;
  if v_total_lb is null or v_total_lb<=0 or v_packages is null or v_packages<2
     or v_bad>0 or v_total_lb>10000 or v_packages>49995 then
    raise exception 'route_resource_cargo_or_market_evidence_missing'
      using errcode='CR409';
  end if;
  v_requirement:=jsonb_build_object('vehicleClass','van',
    'maxPayloadLb',ceil(v_total_lb)::integer);

  perform pg_advisory_xact_lock(hashtext('couranr-resource-allocation'));
  with expired as (
    update public.couranr_route_run_resource_reservations
       set resource_state='expired',released_at=p_now,release_reason='reservation_ttl_expired',
           version=version+1,updated_at=now()
     where resource_state='reserved' and expires_at<=p_now
     returning id
  )
  insert into public.couranr_route_run_resource_events(resource_id,event_type,detail)
    select id,'expired',jsonb_build_object('reason','reservation_ttl_expired')
    from expired;
  update public.couranr_dispatch_reservations
     set reservation_state='expired',release_reason='ttl_expired',updated_at=now()
   where reservation_state='active' and expires_at<=p_now;

  select d.id,v.id into v_driver_id,v_vehicle_id
    from public.couranr_drivers d
    cross join public.couranr_dispatch_vehicles v
   where d.driver_state='active' and d.active=true and d.availability_state='available'
     and v.active=true and v.availability_state='available'
     and (v.assigned_driver_id is null or v.assigned_driver_id=d.id)
     and public.couranr_vehicle_incompatibility(v.id,d.id,v_requirement) is null
     and not exists(select 1 from public.couranr_dispatch_reservations x
       where x.reservation_state='active' and x.expires_at>p_now
         and (x.driver_id=d.id or x.vehicle_id=v.id))
     and not exists(select 1 from public.couranr_route_run_resource_reservations x
       where x.resource_state in ('reserved','committed')
         and (x.driver_id=d.id or x.vehicle_id=v.id))
     and not exists(select 1 from public.couranr_delivery_assignments x
       where x.assignment_state='active'
         and (x.driver_id=d.id or x.vehicle_id=v.id))
   order by d.created_at,v.created_at
   limit 1 for update of d,v skip locked;
  if v_driver_id is null or v_vehicle_id is null then
    update public.couranr_route_run_settlements
       set settlement_state='recovery_required',version=version+1,updated_at=now()
     where id=v_settlement.id;
    insert into public.couranr_route_run_settlement_events(
      settlement_id,actor_user_id,event_type,detail
    ) values(v_settlement.id,p_actor_user_id,'recovery_required',
      jsonb_build_object('reason','route_resource_unavailable',
        'authorizedChildCount',v_authorized));
    perform public.couranr_open_automation_exception(
      i.request_id,'planning','route_resource_unavailable',
      jsonb_build_object('routeRunId',v_route.id,'settlementId',v_settlement.id,
        'sequence',i.sequence,'authorizedChildCount',v_authorized))
      from public.couranr_route_run_settlement_items i
      where i.settlement_id=v_settlement.id;
    return jsonb_build_object('outcome','unavailable',
      'reason','no_compatible_route_resource','settlementState','recovery_required');
  end if;

  insert into public.couranr_route_run_resource_reservations(
    route_run_id,settlement_id,route_version_id,driver_id,vehicle_id,
    market_key,total_payload_lb,package_count,vehicle_requirement,expires_at
  ) values(v_route.id,v_settlement.id,v_settlement.route_version_id,
    v_driver_id,v_vehicle_id,v_market,v_total_lb,v_packages,v_requirement,
    p_now+interval '10 minutes') returning * into v_resource;
  update public.couranr_route_run_settlements
     set settlement_state='resource_reserved',version=version+1,updated_at=now()
   where id=v_settlement.id;
  insert into public.couranr_route_run_resource_events(
    resource_id,actor_user_id,event_type,detail
  ) values(v_resource.id,p_actor_user_id,'reserved',
    jsonb_build_object('marketKey',v_market,'totalPayloadLb',v_total_lb,
      'packageCount',v_packages));
  insert into public.couranr_route_run_settlement_events(
    settlement_id,actor_user_id,event_type,detail
  ) values(v_settlement.id,p_actor_user_id,'resource_reserved',
    jsonb_build_object('resourceId',v_resource.id));
  return jsonb_build_object('outcome','reserved','resourceId',v_resource.id,
    'driverId',v_driver_id,'vehicleId',v_vehicle_id,
    'expiresAt',v_resource.expires_at,'totalPayloadLb',v_total_lb,
    'packageCount',v_packages);
end
$fn$;
revoke all on function public.couranr_reserve_route_run_resource(uuid,uuid,uuid,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_reserve_route_run_resource(uuid,uuid,uuid,timestamptz)
  to service_role;

-- The Checkout UI is not a durable worker. A merchant may close the tab after
-- card authorization, or after reserving a resource. Move either stale case
-- into a recoverable financial state; a server worker then releases only
-- provider-verified holds through the existing canonical release command.
-- This command itself NEVER asserts that a provider hold was released.
create function public.couranr_expire_route_run_checkout(p_route_run_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare
  v_route public.couranr_route_runs;
  v_settlement public.couranr_route_run_settlements;
  v_resource public.couranr_route_run_resource_reservations;
  v_reason text;
  v_item record;
begin
  select * into v_route from public.couranr_route_runs
   where id=p_route_run_id for update;
  if not found then raise exception 'route_draft_not_found' using errcode='CR404'; end if;
  select * into v_settlement from public.couranr_route_run_settlements
   where route_run_id=v_route.id for update;
  if not found then raise exception 'route_settlement_not_found' using errcode='CR404'; end if;
  select * into v_resource from public.couranr_route_run_resource_reservations
   where route_run_id=v_route.id for update;

  if v_route.route_state='accepted'
     and v_settlement.settlement_state='authorized'
     and v_settlement.updated_at<=now()-interval '30 minutes'
     and not exists(select 1 from public.couranr_route_run_settlement_events e
       where e.settlement_id=v_settlement.id and e.event_type='pickup_ready_confirmed') then
    v_reason:='route_pickup_readiness_timeout';
  elsif v_route.route_state='accepted'
     and v_settlement.settlement_state='authorization_required'
     and v_settlement.updated_at<=now()-interval '30 minutes' then
    v_reason:='route_card_authentication_timeout';
  elsif v_route.route_state='accepted'
     and v_settlement.settlement_state='resource_reserved'
     and v_resource.resource_state in ('reserved','expired')
     and v_resource.expires_at<=now() then
    v_reason:='route_resource_reservation_expired';
  else
    return private.couranr_route_settlement_view(v_settlement.id);
  end if;

  if v_resource.id is not null and v_resource.resource_state='reserved' then
    update public.couranr_route_run_resource_reservations
       set resource_state='expired',released_at=now(),
           release_reason=v_reason,version=version+1,updated_at=now()
     where id=v_resource.id;
    insert into public.couranr_route_run_resource_events(resource_id,event_type,detail)
      values(v_resource.id,'expired',jsonb_build_object('reason',v_reason));
  end if;
  update public.couranr_route_run_settlements
     set settlement_state='recovery_required',version=version+1,updated_at=now()
   where id=v_settlement.id;
  insert into public.couranr_route_run_settlement_events(
    settlement_id,event_type,detail)
  values(v_settlement.id,'recovery_required',jsonb_build_object('reason',v_reason));
  for v_item in select i.request_id,i.sequence,p.id as plan_id
      from public.couranr_route_run_settlement_items i
      left join public.couranr_service_plans p on p.request_id=i.request_id
        and p.plan_state='confirmed'
     where i.settlement_id=v_settlement.id order by i.sequence
  loop
    perform public.couranr_open_automation_exception(
      v_item.request_id,'commercial',v_reason,
      jsonb_build_object('routeRunId',v_route.id,'settlementId',v_settlement.id,
        'sequence',v_item.sequence),v_item.plan_id,null);
  end loop;
  return private.couranr_route_settlement_view(v_settlement.id);
end
$fn$;
revoke all on function public.couranr_expire_route_run_checkout(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_expire_route_run_checkout(uuid)
  to service_role;

commit;

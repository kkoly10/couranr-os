-- RR-003d: all accepted Route children receive canonical service plans from
-- one resource-backed command. No parallel plan/delivery model or provider I/O.
begin;
set local lock_timeout='5s';
set local statement_timeout='90s';

do $$ begin
  if to_regclass('public.couranr_route_run_resource_reservations') is null
     or to_regprocedure('public.couranr_confirm_route_pickup_ready(uuid,uuid,uuid,integer,boolean)') is null
     or to_regclass('public.couranr_service_plans') is null then
    raise exception 'route_service_plans_require_rr003_resource_and_readiness';
  end if;
end $$;

alter table public.couranr_service_plans
  add column route_run_id uuid references public.couranr_route_runs(id),
  add column route_version_id uuid references public.couranr_route_run_versions(id);
alter table public.couranr_service_plans
  add constraint couranr_sp_route_version_fk
  foreign key(route_run_id,route_version_id)
  references public.couranr_route_run_versions(route_run_id,id);
alter table public.couranr_service_plans
  add constraint couranr_sp_route_identity_chk check(
    (plan_source='route_run' and route_run_id is not null and route_version_id is not null)
    or (plan_source<>'route_run' and route_run_id is null and route_version_id is null));
create index couranr_sp_route_idx on public.couranr_service_plans(route_run_id,route_version_id);

alter table public.couranr_deliveries
  add column route_run_id uuid references public.couranr_route_runs(id),
  add column route_version_id uuid references public.couranr_route_run_versions(id);
alter table public.couranr_deliveries
  add constraint couranr_dlv_route_version_fk
  foreign key(route_run_id,route_version_id)
  references public.couranr_route_run_versions(route_run_id,id);
alter table public.couranr_deliveries
  add constraint couranr_dlv_route_identity_chk check(
    (plan_source='route_run' and route_run_id is not null and route_version_id is not null)
    or (plan_source<>'route_run' and route_run_id is null and route_version_id is null));
create index couranr_dlv_route_idx on public.couranr_deliveries(route_run_id,route_version_id);

alter table public.couranr_service_plans drop constraint couranr_sp_plan_source_chk;
alter table public.couranr_service_plans add constraint couranr_sp_plan_source_chk
  check(plan_source in ('operations','automatic','route_run'));
alter table public.couranr_service_plans drop constraint couranr_sp_confirmed_stamp_chk;
alter table public.couranr_service_plans add constraint couranr_sp_confirmed_stamp_chk
  check(plan_state<>'confirmed' or (confirmed_at is not null and (
    (plan_source in ('operations','route_run') and confirmed_by is not null)
    or (plan_source='automatic' and confirmed_by is null))));
alter table public.couranr_deliveries drop constraint couranr_dlv_plan_source_chk;
alter table public.couranr_deliveries add constraint couranr_dlv_plan_source_chk
  check(plan_source in ('operations','automatic','route_run'));

-- The existing conversion command still inserts the delivery and its immutable
-- quote snapshot. The existing metadata-copy trigger gives that row its exact
-- Route plan identity, never a caller-supplied Route id.
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
  new.route_run_id:=v_plan.route_run_id;
  new.route_version_id:=v_plan.route_version_id;
  return new;
end
$fn$;

create function private.couranr_guard_route_plan_identity()
returns trigger language plpgsql security definer set search_path='' as $fn$
declare v_claim public.couranr_route_run_claims;
begin
  if tg_op='UPDATE' then
    if (new.route_run_id,new.route_version_id,new.plan_source)
       is distinct from (old.route_run_id,old.route_version_id,old.plan_source) then
      raise exception 'route_plan_identity_immutable' using errcode='CR409';
    end if;
    if old.route_run_id is not null and new.plan_state is distinct from old.plan_state
       and exists(select 1 from public.couranr_route_runs r
         where r.id=old.route_run_id and r.route_state='accepted') then
      raise exception 'route_plan_lifecycle_owned_by_route' using errcode='CR409';
    end if;
    return new;
  end if;
  select * into v_claim from public.couranr_route_run_claims where request_id=new.request_id;
  if found then
    if new.plan_source<>'route_run'
       or new.route_run_id is distinct from v_claim.route_run_id
       or new.route_version_id is distinct from v_claim.route_version_id
       or current_setting('couranr.route_plan_request_id',true) is distinct from new.request_id::text
       or not exists(
         select 1 from public.couranr_route_run_settlement_items i
         join public.couranr_route_run_settlements s on s.id=i.settlement_id
         join public.couranr_route_run_resource_reservations r on r.settlement_id=s.id
          where i.request_id=new.request_id and i.obligation_id=new.payment_obligation_id
            and i.quote_version_id=new.quote_version_id
            and s.route_run_id=v_claim.route_run_id and s.route_version_id=v_claim.route_version_id
            and s.settlement_state='resource_reserved'
            and r.resource_state='reserved' and r.expires_at>now()) then
      raise exception 'route_child_plan_owned_by_route' using errcode='CR409';
    end if;
  elsif new.plan_source='route_run' or new.route_run_id is not null
     or new.route_version_id is not null then
    raise exception 'route_plan_requires_claim' using errcode='CR409';
  end if;
  return new;
end
$fn$;
revoke all on function private.couranr_guard_route_plan_identity()
  from public,anon,authenticated,service_role;
create trigger couranr_route_plan_identity_guard
before insert or update on public.couranr_service_plans
for each row execute function private.couranr_guard_route_plan_identity();

create function private.couranr_guard_route_delivery_identity()
returns trigger language plpgsql security definer set search_path='' as $fn$
declare v_claim public.couranr_route_run_claims;
begin
  if tg_op='UPDATE' then
    if (new.route_run_id,new.route_version_id,new.plan_source)
       is distinct from (old.route_run_id,old.route_version_id,old.plan_source) then
      raise exception 'route_delivery_identity_immutable' using errcode='CR409';
    end if;
    return new;
  end if;
  select * into v_claim from public.couranr_route_run_claims where request_id=new.request_id;
  if found and (new.plan_source<>'route_run'
     or new.route_run_id is distinct from v_claim.route_run_id
     or new.route_version_id is distinct from v_claim.route_version_id) then
    raise exception 'route_child_delivery_requires_route_plan' using errcode='CR409';
  end if;
  return new;
end
$fn$;
revoke all on function private.couranr_guard_route_delivery_identity()
  from public,anon,authenticated,service_role;
-- Alphabetical trigger order places this after the existing plan-metadata
-- copy trigger and before the immutable quote invariant.
create trigger couranr_route_delivery_identity_guard
before insert or update on public.couranr_deliveries
for each row execute function private.couranr_guard_route_delivery_identity();

alter table public.couranr_route_run_settlement_events
  drop constraint couranr_rrsette_type_chk;
alter table public.couranr_route_run_settlement_events
  add constraint couranr_rrsette_type_chk check(event_type in (
    'checkout_confirmed','authorization_attempt_started','provider_uncertain','provider_reconciled',
    'authorization_state_changed','resource_reserved','capture_state_changed',
    'recovery_required','ready_for_execution','checkout_cancelled','pickup_ready_confirmed',
    'service_plans_confirmed'
  ));

create function public.couranr_confirm_route_service_plans(
  p_business_account_id uuid,p_actor_user_id uuid,p_route_run_id uuid,
  p_expected_version integer
) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare
  v_route public.couranr_route_runs;
  v_settlement public.couranr_route_run_settlements;
  v_resource public.couranr_route_run_resource_reservations;
  v_item record;
  v_req public.couranr_delivery_requests;
  v_plan public.couranr_service_plans;
  v_zone text;
  v_timing text;
  v_departure timestamptz;
  v_candidate timestamptz;
  v_local timestamp;
  v_date date;
  v_duration integer:=0;
  v_count integer:=0;
  v_existing integer;
  v_attempt integer:=0;
begin
  perform private.couranr_require_route_checkout_member(p_business_account_id,p_actor_user_id);
  select * into v_route from public.couranr_route_runs
   where id=p_route_run_id and business_account_id=p_business_account_id for update;
  if not found then raise exception 'route_draft_not_found' using errcode='CR404'; end if;
  if v_route.route_state<>'accepted' or v_route.accepted_version is distinct from p_expected_version
     or v_route.current_version is distinct from p_expected_version then
    raise exception 'route_version_conflict' using errcode='CR409';
  end if;
  select * into v_settlement from public.couranr_route_run_settlements
   where route_run_id=v_route.id for update;
  select * into v_resource from public.couranr_route_run_resource_reservations
   where route_run_id=v_route.id for update;
  if v_settlement.id is null or v_resource.id is null
     or v_settlement.settlement_state<>'resource_reserved'
     or v_settlement.route_version_id is distinct from v_resource.route_version_id
     or v_resource.resource_state<>'reserved' or v_resource.expires_at<=now() then
    raise exception 'route_plan_requires_live_resource' using errcode='CR409';
  end if;
  if not exists(select 1 from public.couranr_route_run_settlement_events
    where settlement_id=v_settlement.id and event_type='pickup_ready_confirmed') then
    raise exception 'route_plan_requires_pickup_readiness' using errcode='CR409';
  end if;
  select count(*) into v_existing from public.couranr_service_plans
   where route_run_id=v_route.id and plan_state='confirmed';
  if v_existing>0 then
    if v_existing=(select stop_count from public.couranr_route_run_versions
      where id=v_settlement.route_version_id)
       and not exists(select 1 from public.couranr_route_run_settlement_items i
         left join public.couranr_service_plans p on p.request_id=i.request_id
           and p.plan_state='confirmed' and p.route_run_id=v_route.id
           and p.route_version_id=v_settlement.route_version_id
           and p.payment_obligation_id=i.obligation_id
           and p.quote_version_id=i.quote_version_id
         where i.settlement_id=v_settlement.id and p.id is null) then
      return jsonb_build_object('outcome','already_planned','routeRunId',v_route.id,
        'childCount',v_existing);
    end if;
    raise exception 'route_plan_partial_or_mismatched' using errcode='CR409';
  end if;

  perform q.id from public.couranr_route_run_settlement_items i
    join public.couranr_delivery_requests q on q.id=i.request_id
    where i.settlement_id=v_settlement.id order by q.id for update of q;
  for v_item in
    select i.*,s.pickup_manifest_version,q.route_duration_seconds
      from public.couranr_route_run_settlement_items i
      join public.couranr_route_run_stops s
        on s.route_version_id=v_settlement.route_version_id and s.request_id=i.request_id
      join public.couranr_quote_versions q on q.id=i.quote_version_id
     where i.settlement_id=v_settlement.id order by i.sequence
  loop
    v_count:=v_count+1;
    select * into strict v_req from public.couranr_delivery_requests where id=v_item.request_id;
    if v_req.request_state<>'confirmed' or v_req.readiness_state<>'ready'
       or v_req.current_quote_version_id is distinct from v_item.quote_version_id
       or v_req.pickup_manifest_version is distinct from v_item.pickup_manifest_version
       or not exists(select 1 from public.couranr_payment_obligations o
         where o.id=v_item.obligation_id and o.request_id=v_req.id
           and o.quote_version_id=v_item.quote_version_id and o.payment_state='authorized')
       or exists(select 1 from public.couranr_service_plans p
         where p.request_id=v_req.id and p.plan_state<>'cancelled')
       or v_item.route_duration_seconds is null or v_item.route_duration_seconds<1 then
      raise exception 'route_plan_child_stale_or_unpaid' using errcode='CR409';
    end if;
    if v_zone is null then
      -- ASAP requests store no explicit zone; reuse the existing launch
      -- planner's America/New_York operating authority for that case.
      v_zone:=coalesce(v_req.operating_timezone,'America/New_York');
      v_timing:=coalesce(v_req.timing_intent,'asap');
      v_departure:=v_req.requested_departure_at;
    elsif v_zone is distinct from coalesce(v_req.operating_timezone,'America/New_York')
       or v_timing is distinct from coalesce(v_req.timing_intent,'asap')
       or v_departure is distinct from v_req.requested_departure_at then
      raise exception 'route_plan_common_timing_mismatch' using errcode='CR409';
    end if;
    v_duration:=v_duration+v_item.route_duration_seconds+600;
  end loop;
  if v_count not between 2 and 5 or v_count<>(select stop_count
    from public.couranr_route_run_versions where id=v_settlement.route_version_id)
     or v_zone is null or v_timing not in ('asap','scheduled') then
    raise exception 'route_plan_timing_or_child_count_invalid' using errcode='CR409';
  end if;
  begin perform now() at time zone v_zone;
  exception when others then raise exception 'route_plan_timezone_invalid' using errcode='CR409'; end;
  if v_timing='scheduled' then
    if v_departure is null or v_departure<now()+interval '15 minutes'
       or v_departure>now()+interval '5 days' then
      raise exception 'route_plan_scheduled_time_outside_authorization_horizon'
        using errcode='CR409';
    end if;
    v_candidate:=v_departure;
  else
    v_local:=now() at time zone v_zone;
    v_date:=v_local::date;
    if extract(isodow from v_date) between 1 and 5
       and v_local::time<time '16:00'
       and not exists(select 1 from public.couranr_operating_closures c
         where c.market_key=v_resource.market_key and c.local_date=v_date and c.active) then
      v_candidate:=to_timestamp(ceil(extract(epoch from (greatest(
        v_local+interval '30 minutes',v_date+time '06:00') at time zone v_zone))/900.0)*900);
    else
      loop
        v_attempt:=v_attempt+1;
        if v_attempt>14 then raise exception 'route_plan_no_open_pickup_day' using errcode='CR409'; end if;
        v_date:=v_date+1;
        exit when extract(isodow from v_date) between 1 and 5
          and not exists(select 1 from public.couranr_operating_closures c
            where c.market_key=v_resource.market_key and c.local_date=v_date and c.active);
      end loop;
      v_candidate:=(v_date+time '06:00') at time zone v_zone;
    end if;
  end if;
  v_local:=v_candidate at time zone v_zone;
  v_date:=v_local::date;
  if extract(isodow from v_date) not between 1 and 5
     or v_local::time<time '06:00' or v_local::time>time '17:30'
     or exists(select 1 from public.couranr_operating_closures c
       where c.market_key=v_resource.market_key and c.local_date=v_date and c.active) then
    raise exception 'route_plan_outside_operating_hours' using errcode='CR409';
  end if;

  for v_item in select * from public.couranr_route_run_settlement_items
    where settlement_id=v_settlement.id order by sequence
  loop
    select * into strict v_req from public.couranr_delivery_requests where id=v_item.request_id;
    perform set_config('couranr.route_plan_request_id',v_req.id::text,true);
    insert into public.couranr_service_plans(
      request_id,business_account_id,payment_obligation_id,request_version,quote_version_id,
      scheduled_pickup_start,scheduled_pickup_end,timezone,vehicle_id,vehicle_requirement,
      plan_state,confirmed_by,confirmed_at,plan_source,planner_version,market_key,
      dispatch_not_before,dispatch_deadline,expected_service_end,route_run_id,route_version_id
    ) values(v_req.id,p_business_account_id,v_item.obligation_id,v_req.version,v_item.quote_version_id,
      v_candidate,v_candidate+interval '30 minutes',v_zone,v_resource.vehicle_id,
      v_resource.vehicle_requirement,'confirmed',p_actor_user_id,now(),
      'route_run','route-run-v1',v_resource.market_key,now(),v_candidate,
      v_candidate+make_interval(secs=>v_duration),v_route.id,v_settlement.route_version_id)
    returning * into v_plan;
    perform set_config('couranr.route_plan_request_id','',true);
  end loop;
  insert into public.couranr_route_run_settlement_events(
    settlement_id,actor_user_id,event_type,detail)
  values(v_settlement.id,p_actor_user_id,'service_plans_confirmed',
    jsonb_build_object('routeVersionId',v_settlement.route_version_id,
      'resourceId',v_resource.id,'childCount',v_count,'scheduledPickupStart',v_candidate));
  return jsonb_build_object('outcome','planned','routeRunId',v_route.id,
    'childCount',v_count,'scheduledPickupStart',v_candidate,
    'scheduledPickupEnd',v_candidate+interval '30 minutes');
end
$fn$;
revoke all on function public.couranr_confirm_route_service_plans(uuid,uuid,uuid,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_confirm_route_service_plans(uuid,uuid,uuid,integer)
  to service_role;
commit;

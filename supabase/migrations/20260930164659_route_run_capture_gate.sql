-- RR-003d: sequence existing canonical child capture only after one Route
-- resource is committed. The provider is still called by the existing
-- capture/reconcile machinery; this SQL adds no Stripe path.
begin;
set local lock_timeout='5s';
set local statement_timeout='90s';
do $$ begin
  if to_regprocedure('public.couranr_confirm_route_service_plans(uuid,uuid,uuid,integer)') is null
     or to_regprocedure('public.couranr_begin_payment_capture(uuid,uuid)') is null
     or to_regclass('public.couranr_route_run_resource_reservations') is null then
    raise exception 'route_capture_requires_rr003_plans_and_canonical_capture';
  end if;
end $$;

create function private.couranr_guard_route_child_capture()
returns trigger language plpgsql security definer set search_path='' as $fn$
begin
  if tg_op='UPDATE' and old.payment_state='authorized'
     and new.payment_state='capture_pending'
     and exists(select 1 from public.couranr_route_run_settlement_items i
       where i.obligation_id=old.id) then
    if current_setting('couranr.route_capture_obligation_id',true)
         is distinct from old.id::text
       or not exists(
         select 1 from public.couranr_route_run_settlement_items i
         join public.couranr_route_run_settlements s on s.id=i.settlement_id
         join public.couranr_route_runs rr on rr.id=s.route_run_id
         join public.couranr_route_run_resource_reservations r on r.settlement_id=s.id
         where i.obligation_id=old.id and i.request_id=old.request_id
           and i.quote_version_id=old.quote_version_id
           and s.settlement_state='capture_pending'
           and rr.route_state='accepted' and r.resource_state='committed'
           and r.route_version_id=s.route_version_id) then
      raise exception 'route_child_capture_owned_by_route' using errcode='CR409';
    end if;
  end if;
  return new;
end
$fn$;
revoke all on function private.couranr_guard_route_child_capture()
  from public,anon,authenticated,service_role;
create trigger couranr_route_child_capture_guard
before update of payment_state on public.couranr_payment_obligations
for each row execute function private.couranr_guard_route_child_capture();

-- Until RR-004 binds every child to one execution, no standalone assignment
-- may put a Route child in physical custody. This is a database boundary, not
-- a hidden UI button. RR-004 will replace this with a sequence-aware guard.
create function private.couranr_block_route_child_standalone_assignment()
returns trigger language plpgsql security definer set search_path='' as $fn$
begin
  if new.assignment_state='active' and exists(
    select 1 from public.couranr_deliveries d
    join public.couranr_route_run_claims c on c.request_id=d.request_id
    where d.id=new.delivery_id) then
    raise exception 'route_child_assignment_requires_route_execution' using errcode='CR409';
  end if;
  return new;
end
$fn$;
revoke all on function private.couranr_block_route_child_standalone_assignment()
  from public,anon,authenticated,service_role;
create trigger couranr_route_child_assignment_gate
before insert or update of assignment_state,delivery_id on public.couranr_delivery_assignments
for each row execute function private.couranr_block_route_child_standalone_assignment();

create function public.couranr_begin_route_run_capture(
  p_business_account_id uuid,p_actor_user_id uuid,p_route_run_id uuid,
  p_expected_version integer
) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare
  v_route public.couranr_route_runs;
  v_settlement public.couranr_route_run_settlements;
  v_resource public.couranr_route_run_resource_reservations;
  v_count integer;
  v_valid integer;
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
     or v_resource.route_version_id is distinct from v_settlement.route_version_id then
    raise exception 'route_capture_resource_missing' using errcode='CR409';
  end if;
  if v_settlement.settlement_state='capture_pending'
     and v_resource.resource_state='committed' then
    return jsonb_build_object('outcome','already_started','settlementId',v_settlement.id,
      'resourceId',v_resource.id);
  end if;
  if v_settlement.settlement_state<>'resource_reserved'
     or v_resource.resource_state<>'reserved' or v_resource.expires_at<=now() then
    raise exception 'route_capture_resource_not_live' using errcode='CR409';
  end if;
  select count(*),count(*) filter(where
      o.payment_state='authorized' and o.quote_version_id=i.quote_version_id
      and o.amount_cents=i.amount_cents and o.request_id=i.request_id
      and q.current_quote_version_id=i.quote_version_id
      and q.request_state='confirmed' and q.readiness_state='ready'
      and p.id is not null and p.plan_source='route_run'
      and p.route_run_id=v_route.id and p.route_version_id=v_settlement.route_version_id
      and p.quote_version_id=i.quote_version_id and p.payment_obligation_id=i.obligation_id
      and p.vehicle_id=v_resource.vehicle_id
      and p.plan_state='confirmed') into v_count,v_valid
    from public.couranr_route_run_settlement_items i
    join public.couranr_payment_obligations o on o.id=i.obligation_id
    join public.couranr_delivery_requests q on q.id=i.request_id
    left join public.couranr_service_plans p
      on p.request_id=i.request_id and p.plan_state='confirmed'
   where i.settlement_id=v_settlement.id;
  if v_count not between 2 and 5 or v_count<>v_valid
     or v_count<>(select stop_count from public.couranr_route_run_versions
       where id=v_settlement.route_version_id)
     or not exists(select 1 from public.couranr_route_run_settlement_events
       where settlement_id=v_settlement.id and event_type='pickup_ready_confirmed') then
    raise exception 'route_capture_child_commitment_incomplete' using errcode='CR409';
  end if;
  update public.couranr_route_run_resource_reservations
     set resource_state='committed',committed_at=now(),version=version+1,updated_at=now()
   where id=v_resource.id and resource_state='reserved';
  update public.couranr_route_run_settlements
     set settlement_state='capture_pending',version=version+1,updated_at=now()
   where id=v_settlement.id and settlement_state='resource_reserved';
  insert into public.couranr_route_run_resource_events(
    resource_id,actor_user_id,event_type,detail)
  values(v_resource.id,p_actor_user_id,'committed',
    jsonb_build_object('settlementId',v_settlement.id,'childCount',v_count));
  insert into public.couranr_route_run_settlement_events(
    settlement_id,actor_user_id,event_type,detail)
  values(v_settlement.id,p_actor_user_id,'capture_state_changed',
    jsonb_build_object('from','resource_reserved','to','capture_pending',
      'resourceId',v_resource.id,'childCount',v_count));
  return jsonb_build_object('outcome','capture_started','settlementId',v_settlement.id,
    'resourceId',v_resource.id,'childCount',v_count);
end
$fn$;
revoke all on function public.couranr_begin_route_run_capture(uuid,uuid,uuid,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_begin_route_run_capture(uuid,uuid,uuid,integer)
  to service_role;

create function public.couranr_begin_route_child_capture(
  p_business_account_id uuid,p_actor_user_id uuid,p_route_run_id uuid,
  p_obligation_id uuid
) returns public.couranr_payment_obligations
language plpgsql security definer set search_path='' as $fn$
declare
  v_route public.couranr_route_runs;
  v_settlement public.couranr_route_run_settlements;
  v_item public.couranr_route_run_settlement_items;
  v_ob public.couranr_payment_obligations;
begin
  perform private.couranr_require_route_checkout_member(p_business_account_id,p_actor_user_id);
  select * into v_route from public.couranr_route_runs
   where id=p_route_run_id and business_account_id=p_business_account_id for update;
  if not found or v_route.route_state<>'accepted' then
    raise exception 'route_capture_route_not_accepted' using errcode='CR409';
  end if;
  select * into v_settlement from public.couranr_route_run_settlements
   where route_run_id=v_route.id for update;
  if not found or v_settlement.settlement_state<>'capture_pending' then
    raise exception 'route_capture_not_started' using errcode='CR409';
  end if;
  if not exists(select 1 from public.couranr_route_run_resource_reservations r
    where r.settlement_id=v_settlement.id and r.resource_state='committed') then
    raise exception 'route_capture_resource_not_committed' using errcode='CR409';
  end if;
  select * into v_item from public.couranr_route_run_settlement_items
   where settlement_id=v_settlement.id and obligation_id=p_obligation_id;
  if not found then raise exception 'route_capture_child_not_found' using errcode='CR404'; end if;
  if exists(select 1 from public.couranr_route_run_settlement_items i
    left join public.couranr_payment_obligations o on o.id=i.obligation_id
    left join public.couranr_deliveries d on d.request_id=i.request_id
      and d.payment_obligation_id=i.obligation_id
    where i.settlement_id=v_settlement.id and i.sequence<v_item.sequence
      and (o.payment_state is distinct from 'captured' or d.id is null)) then
    raise exception 'route_capture_order_conflict' using errcode='CR409';
  end if;
  select * into v_ob from public.couranr_payment_obligations
   where id=v_item.obligation_id for update;
  if v_ob.payment_state<>'authorized' then
    raise exception 'route_capture_child_not_authorized_or_in_flight' using errcode='CR409';
  end if;
  perform set_config('couranr.route_capture_obligation_id',v_ob.id::text,true);
  select * into v_ob from public.couranr_begin_payment_capture(v_item.request_id,p_actor_user_id);
  perform set_config('couranr.route_capture_obligation_id','',true);
  if v_ob.id is distinct from p_obligation_id or v_ob.payment_state<>'capture_pending' then
    raise exception 'route_capture_canonical_command_mismatch' using errcode='CR409';
  end if;
  return v_ob;
end
$fn$;
revoke all on function public.couranr_begin_route_child_capture(uuid,uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_begin_route_child_capture(uuid,uuid,uuid,uuid)
  to service_role;

create function public.couranr_complete_route_run_funding(
  p_business_account_id uuid,p_actor_user_id uuid,p_route_run_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_route public.couranr_route_runs;
  v_settlement public.couranr_route_run_settlements;
  v_count integer;
  v_valid integer;
begin
  perform private.couranr_require_route_checkout_member(p_business_account_id,p_actor_user_id);
  select * into v_route from public.couranr_route_runs
   where id=p_route_run_id and business_account_id=p_business_account_id for update;
  if not found or v_route.route_state<>'accepted' then
    raise exception 'route_funding_route_not_accepted' using errcode='CR409';
  end if;
  select * into v_settlement from public.couranr_route_run_settlements
   where route_run_id=v_route.id for update;
  if not found then raise exception 'route_settlement_not_found' using errcode='CR404'; end if;
  if v_settlement.settlement_state='ready_for_execution' then
    return jsonb_build_object('outcome','already_ready','settlementId',v_settlement.id);
  end if;
  if v_settlement.settlement_state<>'capture_pending'
     or not exists(select 1 from public.couranr_route_run_resource_reservations r
       where r.settlement_id=v_settlement.id and r.resource_state='committed') then
    raise exception 'route_funding_capture_incomplete' using errcode='CR409';
  end if;
  select count(*),count(*) filter(where
    o.payment_state='captured' and o.captured_amount_cents=i.amount_cents
    and o.quote_version_id=i.quote_version_id
    and p.id is not null and p.plan_source='route_run'
    and p.route_run_id=v_route.id and p.route_version_id=v_settlement.route_version_id
    and p.payment_obligation_id=i.obligation_id and p.quote_version_id=i.quote_version_id
    and d.id is not null and d.payment_obligation_id=i.obligation_id
    and d.service_plan_id=p.id and d.quote_version_id=i.quote_version_id
    and d.captured_amount_cents=i.amount_cents and d.route_run_id=v_route.id
    and d.route_version_id=v_settlement.route_version_id)
    into v_count,v_valid
    from public.couranr_route_run_settlement_items i
    join public.couranr_payment_obligations o on o.id=i.obligation_id
    left join public.couranr_service_plans p on p.request_id=i.request_id
      and p.plan_state='confirmed'
    left join public.couranr_deliveries d on d.request_id=i.request_id
   where i.settlement_id=v_settlement.id;
  if v_count not between 2 and 5 or v_count<>v_valid
     or v_count<>(select stop_count from public.couranr_route_run_versions
       where id=v_settlement.route_version_id) then
    raise exception 'route_funding_child_capture_or_conversion_incomplete'
      using errcode='CR409';
  end if;
  update public.couranr_route_run_settlements
     set settlement_state='captured',version=version+1,updated_at=now()
   where id=v_settlement.id;
  insert into public.couranr_route_run_settlement_events(
    settlement_id,actor_user_id,event_type,detail)
  values(v_settlement.id,p_actor_user_id,'capture_state_changed',
    jsonb_build_object('from','capture_pending','to','captured','childCount',v_count));
  update public.couranr_route_run_settlements
     set settlement_state='ready_for_execution',version=version+1,updated_at=now()
   where id=v_settlement.id;
  insert into public.couranr_route_run_settlement_events(
    settlement_id,actor_user_id,event_type,detail)
  values(v_settlement.id,p_actor_user_id,'ready_for_execution',
    jsonb_build_object('childCount',v_count));
  return jsonb_build_object('outcome','ready_for_execution',
    'settlementId',v_settlement.id,'childCount',v_count);
end
$fn$;
revoke all on function public.couranr_complete_route_run_funding(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_complete_route_run_funding(uuid,uuid,uuid)
  to service_role;
commit;

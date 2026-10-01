-- RR-004b: one pickup visit, child-scoped proof, ordered drop-off authority.
-- Reuses the canonical driver commands. It does not invent Route-wide custody.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
do $$ begin
  if to_regclass('public.couranr_route_run_executions') is null
    or to_regprocedure('public.couranr_start_route_to_pickup(uuid,integer,uuid)') is null
    or to_regprocedure('public.couranr_complete_pickup_v2(uuid,integer,uuid,numeric,numeric,numeric)') is null
    or to_regprocedure('public.couranr_start_route_to_dropoff(uuid,integer,uuid)') is null then
    raise exception 'route_shared_pickup_requires_rr004a_and_canonical_driver_commands';
  end if;
end $$;

-- This trigger also fences the ordinary per-child driver RPCs. A Route child
-- cannot leave pickup singly, or reach Stop 4 while Stop 2 owns the sequence.
create function private.couranr_guard_route_delivery_transition()
returns trigger language plpgsql security definer set search_path='' as $fn$
declare
  v_exec public.couranr_route_run_executions;
  v_sequence integer;
  v_bulk boolean;
begin
  if new.fulfillment_state=old.fulfillment_state or new.route_run_id is null then
    return new;
  end if;
  select * into v_exec from public.couranr_route_run_executions
   where route_run_id=new.route_run_id for update nowait;
  if not found then
    raise exception 'route_execution_required_for_delivery_transition'
      using errcode='CR409';
  end if;
  select s.sequence into v_sequence from public.couranr_route_run_stops s
   where s.route_version_id=v_exec.route_version_id and s.request_id=new.request_id;
  if v_sequence is null then
    raise exception 'route_delivery_not_in_accepted_stop_set' using errcode='CR409';
  end if;
  v_bulk:=current_setting('couranr.route_bulk_transition',true)=v_exec.id::text;
  if old.fulfillment_state='scheduled' and new.fulfillment_state='assigned'
     and v_exec.execution_state='ready' then return new; end if;
  if old.fulfillment_state='assigned' and new.fulfillment_state='en_route_to_pickup'
     and v_exec.execution_state='ready' and v_bulk then return new; end if;
  if old.fulfillment_state='en_route_to_pickup' and new.fulfillment_state='at_pickup'
     and v_exec.execution_state='en_route_to_pickup' and v_bulk then return new; end if;
  if old.fulfillment_state='at_pickup' and new.fulfillment_state='picked_up'
     and v_exec.execution_state='at_pickup' then return new; end if;
  if old.fulfillment_state='picked_up' and new.fulfillment_state='in_transit'
     and v_exec.execution_state='at_pickup' and v_bulk then return new; end if;
  if old.fulfillment_state='in_transit' and new.fulfillment_state='at_dropoff'
     and v_exec.execution_state='in_progress'
     and v_exec.current_sequence=v_sequence then return new; end if;
  if old.fulfillment_state='at_dropoff' and new.fulfillment_state='delivered'
     and v_exec.execution_state='in_progress'
     and v_exec.current_sequence=v_sequence then return new; end if;
  if ((old.fulfillment_state='at_pickup' and new.fulfillment_state='could_not_deliver'
       and v_exec.current_sequence=0
       and v_exec.execution_state in ('at_pickup','exception','returning'))
    or (old.fulfillment_state in ('picked_up','in_transit','at_dropoff')
       and new.fulfillment_state='return_required'
       and v_exec.execution_state='in_progress'
       and v_exec.current_sequence=v_sequence)) then
    if v_exec.execution_state<>'returning' then
      update public.couranr_route_run_executions
        set execution_state='exception',version=version+1,updated_at=now()
       where id=v_exec.id;
    end if;
    insert into public.couranr_route_run_execution_events(
      execution_id,event_type,detail)
    values(v_exec.id,'exception_paused',
      jsonb_build_object('sequence',v_sequence,'deliveryId',new.id,
        'from',old.fulfillment_state,'to',new.fulfillment_state));
    return new;
  end if;
  if old.fulfillment_state='return_required'
     and new.fulfillment_state='returning'
     and v_exec.execution_state in ('exception','in_progress','returning') then
    return new;
  end if;
  if old.fulfillment_state='returning' and new.fulfillment_state='returned'
     and v_exec.execution_state in ('exception','in_progress','returning') then
    return new;
  end if;
  -- Operations selected an immediate return. Each still-loaded child requires
  -- its own driver discrepancy and governed return command; this transition
  -- does not synthesize either one.
  if old.fulfillment_state in ('picked_up','in_transit','at_dropoff')
     and new.fulfillment_state='return_required'
     and v_exec.execution_state='returning'
     and v_sequence>=v_exec.current_sequence then
    return new;
  end if;
  raise exception 'route_stop_transition_not_authorized' using errcode='CR409';
end $fn$;
revoke all on function private.couranr_guard_route_delivery_transition()
  from public,anon,authenticated,service_role;
create trigger couranr_guard_route_delivery_transition
  before update of fulfillment_state on public.couranr_deliveries
  for each row execute function private.couranr_guard_route_delivery_transition();

create function private.couranr_route_driver_execution(
  p_route_run_id uuid,p_actor_user_id uuid
) returns public.couranr_route_run_executions
language plpgsql security definer set search_path='' as $fn$
declare v_exec public.couranr_route_run_executions;
begin
  select e.* into v_exec from public.couranr_route_run_executions e
   join public.couranr_drivers d on d.id=e.driver_id
   where e.route_run_id=p_route_run_id and d.user_id=p_actor_user_id
   for update of e;
  if not found then raise exception 'not_your_route' using errcode='CR403'; end if;
  return v_exec;
end $fn$;
revoke all on function private.couranr_route_driver_execution(uuid,uuid)
  from public,anon,authenticated,service_role;

create function public.couranr_start_route_run_to_pickup(
  p_route_run_id uuid,p_actor_user_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_exec public.couranr_route_run_executions;
  v_dlv public.couranr_deliveries;
  v_count integer:=0;
begin
  v_exec:=private.couranr_route_driver_execution(p_route_run_id,p_actor_user_id);
  if v_exec.execution_state='en_route_to_pickup' then
    return jsonb_build_object('outcome','already_en_route','executionId',v_exec.id);
  end if;
  if v_exec.execution_state<>'ready' then
    raise exception 'route_pickup_start_wrong_state' using errcode='CR409';
  end if;
  perform set_config('couranr.route_bulk_transition',v_exec.id::text,true);
  for v_dlv in select d.* from public.couranr_deliveries d
    join public.couranr_route_run_stops s on s.request_id=d.request_id
      and s.route_version_id=v_exec.route_version_id
   where d.route_run_id=p_route_run_id order by s.sequence for update of d
  loop
    perform public.couranr_start_route_to_pickup(
      v_dlv.id,v_dlv.version,p_actor_user_id);
    v_count:=v_count+1;
  end loop;
  if v_count not between 2 and 5 then
    raise exception 'route_pickup_child_count_mismatch' using errcode='CR409';
  end if;
  update public.couranr_route_run_executions
     set execution_state='en_route_to_pickup',version=version+1,
       started_at=now(),updated_at=now() where id=v_exec.id;
  insert into public.couranr_route_run_execution_events(
    execution_id,actor_user_id,event_type,detail)
  values(v_exec.id,p_actor_user_id,'departed_for_pickup',
    jsonb_build_object('childCount',v_count));
  perform set_config('couranr.route_bulk_transition','',true);
  return jsonb_build_object('outcome','en_route_to_pickup','executionId',v_exec.id);
end $fn$;
revoke all on function public.couranr_start_route_run_to_pickup(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_start_route_run_to_pickup(uuid,uuid)
  to service_role;

create function public.couranr_arrive_route_run_at_pickup(
  p_route_run_id uuid,p_actor_user_id uuid,p_latitude numeric,
  p_longitude numeric,p_accuracy_m numeric
) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_exec public.couranr_route_run_executions;
  v_dlv public.couranr_deliveries;
  v_count integer:=0;
begin
  v_exec:=private.couranr_route_driver_execution(p_route_run_id,p_actor_user_id);
  if v_exec.execution_state='at_pickup' then
    return jsonb_build_object('outcome','already_at_pickup','executionId',v_exec.id);
  end if;
  if v_exec.execution_state<>'en_route_to_pickup' then
    raise exception 'route_pickup_arrival_wrong_state' using errcode='CR409';
  end if;
  perform set_config('couranr.route_bulk_transition',v_exec.id::text,true);
  for v_dlv in select d.* from public.couranr_deliveries d
    join public.couranr_route_run_stops s on s.request_id=d.request_id
      and s.route_version_id=v_exec.route_version_id
   where d.route_run_id=p_route_run_id order by s.sequence for update of d
  loop
    perform public.couranr_arrive_at_pickup(v_dlv.id,v_dlv.version,
      p_actor_user_id,p_latitude,p_longitude,p_accuracy_m);
    v_count:=v_count+1;
  end loop;
  if v_count not between 2 and 5 then
    raise exception 'route_pickup_child_count_mismatch' using errcode='CR409';
  end if;
  update public.couranr_route_run_executions
     set execution_state='at_pickup',version=version+1,updated_at=now()
   where id=v_exec.id;
  insert into public.couranr_route_run_execution_events(
    execution_id,actor_user_id,event_type,detail)
  values(v_exec.id,p_actor_user_id,'arrived_at_pickup',
    jsonb_build_object('childCount',v_count,'latitude',p_latitude,
      'longitude',p_longitude,'accuracyM',p_accuracy_m));
  perform set_config('couranr.route_bulk_transition','',true);
  return jsonb_build_object('outcome','at_pickup','executionId',v_exec.id);
end $fn$;
revoke all on function public.couranr_arrive_route_run_at_pickup(
  uuid,uuid,numeric,numeric,numeric)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_arrive_route_run_at_pickup(
  uuid,uuid,numeric,numeric,numeric) to service_role;

create function public.couranr_depart_route_run_pickup(
  p_route_run_id uuid,p_actor_user_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_exec public.couranr_route_run_executions;
  v_dlv public.couranr_deliveries;
  v_count integer:=0;
begin
  v_exec:=private.couranr_route_driver_execution(p_route_run_id,p_actor_user_id);
  if v_exec.execution_state='in_progress' then
    return jsonb_build_object('outcome','already_departed','executionId',v_exec.id);
  end if;
  if v_exec.execution_state<>'at_pickup' then
    raise exception 'route_pickup_departure_wrong_state' using errcode='CR409';
  end if;
  if exists(select 1 from public.couranr_deliveries d
    join public.couranr_route_run_stops s on s.request_id=d.request_id
      and s.route_version_id=v_exec.route_version_id
    where d.fulfillment_state<>'picked_up'
      or not exists(select 1 from public.couranr_handoff_records h
        join public.couranr_delivery_assignments a on a.id=h.assignment_id
        where h.delivery_id=d.id and h.handoff_stage='pickup'
          and a.route_execution_id=v_exec.id)
      or not exists(select 1 from public.couranr_delivery_proofs p
        join public.couranr_delivery_assignments a on a.id=p.assignment_id
        where p.delivery_id=d.id and p.proof_stage='pickup'
          and a.route_execution_id=v_exec.id))
    or exists(select 1 from public.couranr_pickup_discrepancies pd
      join public.couranr_deliveries d on d.id=pd.delivery_id
      where d.route_run_id=p_route_run_id and pd.discrepancy_state='open') then
    raise exception 'route_pickup_custody_incomplete' using errcode='CR409';
  end if;
  perform set_config('couranr.route_bulk_transition',v_exec.id::text,true);
  for v_dlv in select d.* from public.couranr_deliveries d
    join public.couranr_route_run_stops s on s.request_id=d.request_id
      and s.route_version_id=v_exec.route_version_id
   where d.route_run_id=p_route_run_id order by s.sequence for update of d
  loop
    perform public.couranr_start_route_to_dropoff(
      v_dlv.id,v_dlv.version,p_actor_user_id);
    v_count:=v_count+1;
  end loop;
  if v_count not between 2 and 5 then
    raise exception 'route_pickup_child_count_mismatch' using errcode='CR409';
  end if;
  update public.couranr_route_run_executions
     set execution_state='in_progress',current_sequence=1,
       version=version+1,updated_at=now() where id=v_exec.id;
  insert into public.couranr_route_run_execution_events(
    execution_id,actor_user_id,event_type,detail)
  values(v_exec.id,p_actor_user_id,'departed_with_cargo',
    jsonb_build_object('childCount',v_count,'nextSequence',1));
  perform set_config('couranr.route_bulk_transition','',true);
  return jsonb_build_object('outcome','in_progress','executionId',v_exec.id,
    'currentSequence',1);
end $fn$;
revoke all on function public.couranr_depart_route_run_pickup(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_depart_route_run_pickup(uuid,uuid)
  to service_role;
commit;

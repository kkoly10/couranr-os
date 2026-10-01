-- RR-004c: ordered stop advancement and one terminal Route resource release.
-- Child proof, PIN, return and incident commands remain canonical.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
do $$ begin
  if to_regclass('public.couranr_route_run_executions') is null
    or to_regprocedure('private.couranr_route_driver_execution(uuid,uuid)') is null
    or to_regprocedure('public.couranr_release_assignment_resources(uuid,uuid)') is null
    or to_regprocedure('private.couranr_guard_accepted_route_child()') is null then
    raise exception 'route_stop_advance_requires_rr004_pickup';
  end if;
end $$;

-- RR-002 freezes accepted children against standalone commercial mutation.
-- CAN-001's final request closure is the one necessary exception after an
-- RR-004 failed shared pickup: the delivery has already closed, and the
-- provider refund (or zero-due governed settlement) is durably final. The
-- trigger still rejects every other field edit, state change and DELETE.
create or replace function private.couranr_guard_accepted_route_child()
returns trigger language plpgsql security invoker set search_path='' as $fn$
begin
  if exists(select 1 from public.couranr_route_run_claims c
    join public.couranr_route_runs r on r.id=c.route_run_id
    where c.request_id=old.id and r.route_state='accepted') then
    -- Preserve RR-003's exact accepted-child checkout and readiness windows.
    if tg_op='UPDATE'
       and current_setting('couranr.route_checkout_request_id',true)=old.id::text
       and old.request_state='draft' and new.request_state='confirmed'
       and old.submitted_at is null and new.submitted_at is not null
       and new.version=old.version+1
       and (to_jsonb(new)-array['request_state','version','submitted_at','updated_at'])
           =(to_jsonb(old)-array['request_state','version','submitted_at','updated_at'])
       and exists(
         select 1 from public.couranr_route_run_claims c
         join public.couranr_route_run_settlements s
           on s.route_run_id=c.route_run_id and s.route_version_id=c.route_version_id
         join public.couranr_route_run_settlement_items i
           on i.settlement_id=s.id and i.request_id=old.id
         where c.request_id=old.id and s.settlement_state='pending_authorization'
           and i.quote_version_id=old.current_quote_version_id
       ) then
      return new;
    end if;
    if tg_op='UPDATE'
       and current_setting('couranr.route_readiness_request_id',true)=old.id::text
       and old.request_state='confirmed' and new.request_state='confirmed'
       and old.readiness_state in ('not_confirmed','preparing','not_ready','unavailable')
       and new.readiness_state='ready' and new.version=old.version+1
       and (to_jsonb(new)-array['readiness_state','version','updated_at'])
           =(to_jsonb(old)-array['readiness_state','version','updated_at'])
       and exists(
         select 1 from public.couranr_route_run_claims c
         join public.couranr_route_run_settlements s
           on s.route_run_id=c.route_run_id and s.route_version_id=c.route_version_id
         join public.couranr_route_run_settlement_items i
           on i.settlement_id=s.id and i.request_id=old.id
         join public.couranr_payment_obligations o on o.id=i.obligation_id
         where c.request_id=old.id and s.settlement_state='authorized'
           and i.quote_version_id=old.current_quote_version_id
           and o.payment_state='authorized'
       ) then
      return new;
    end if;
    if tg_op='UPDATE'
      and new.request_state='cancelled'
      and old.request_state<>'cancelled'
      and new.version=old.version+1
      and (to_jsonb(new)-'request_state'-'version'-'updated_at')=
          (to_jsonb(old)-'request_state'-'version'-'updated_at')
      and exists(select 1 from public.couranr_deliveries d
        join public.couranr_route_run_executions e
          on e.route_run_id=d.route_run_id
         and e.current_sequence=0
         and e.execution_state in ('exception','returning','cancelled')
        where d.request_id=old.id
          and d.fulfillment_state='could_not_deliver'
          and exists(select 1 from public.couranr_payment_refunds r
            where r.obligation_id=d.payment_obligation_id
              and r.attempt_state in ('succeeded','settled_no_refund_due'))) then
      return new;
    end if;
    raise exception 'route_child_claimed' using errcode='CR409';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $fn$;
revoke all on function private.couranr_guard_accepted_route_child()
  from public,anon,authenticated,service_role;

-- Call only after locking the execution and global resource allocator.
-- No child terminal state is fabricated here. The existing child command has
-- already completed proof and closed its own assignment.
create function private.couranr_release_terminal_route_execution(
  p_execution_id uuid,p_actor_user_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_exec public.couranr_route_run_executions;
  v_resource public.couranr_route_run_resource_reservations;
  v_expected integer;
  v_failed_pickup boolean;
  v_release_reason text;
begin
  if not pg_try_advisory_xact_lock(hashtext('couranr-resource-allocation')) then
    raise exception 'resource_allocation_busy_retry' using errcode='CR409';
  end if;
  select * into v_exec from public.couranr_route_run_executions
   where id=p_execution_id for update;
  if not found then raise exception 'route_execution_not_found' using errcode='CR404'; end if;
  if v_exec.execution_state in ('completed','cancelled') then
    return jsonb_build_object('outcome',
      case when v_exec.execution_state='cancelled' then 'already_cancelled'
        else 'already_completed' end,
      'executionId',v_exec.id);
  end if;
  if v_exec.execution_state not in ('in_progress','exception','returning') then
    raise exception 'route_execution_not_terminal_ready' using errcode='CR409';
  end if;
  select stop_count into v_expected from public.couranr_route_run_versions
   where id=v_exec.route_version_id;
  v_failed_pickup:=v_exec.current_sequence=0 and
    v_exec.execution_state='returning';
  if v_expected not between 2 and 5
    or v_expected<>(select count(*) from public.couranr_deliveries d
      join public.couranr_route_run_stops s
        on s.request_id=d.request_id
        and s.route_version_id=v_exec.route_version_id
      where d.route_run_id=v_exec.route_run_id) then
    raise exception 'route_custody_not_terminal' using errcode='CR409';
  end if;
  if v_failed_pickup then
    -- A failed shared pickup is NOT a delivered Route. Every uncollected
    -- child must be closed by CAN-001 and its provider refund fully settled;
    -- a loaded child must complete its governed physical return. The driver
    -- and vehicle remain owned while any child is unresolved.
    if not exists(select 1 from public.couranr_deliveries d
      where d.route_run_id=v_exec.route_run_id
        and d.fulfillment_state='could_not_deliver')
      or exists(select 1 from public.couranr_deliveries d
        join public.couranr_route_run_stops s on s.request_id=d.request_id
       where s.route_version_id=v_exec.route_version_id
         and d.fulfillment_state not in ('could_not_deliver','returned'))
      or exists(select 1 from public.couranr_deliveries d
        join public.couranr_route_run_stops s on s.request_id=d.request_id
        join public.couranr_delivery_requests q on q.id=d.request_id
       where s.route_version_id=v_exec.route_version_id
         and d.fulfillment_state='could_not_deliver'
         and (q.request_state<>'cancelled'
           or not exists(select 1 from public.couranr_payment_refunds r
             where r.obligation_id=d.payment_obligation_id
               and r.attempt_state in ('succeeded','settled_no_refund_due')))) then
      raise exception 'route_failed_pickup_recovery_incomplete' using errcode='CR409';
    end if;
  elsif exists(select 1 from public.couranr_deliveries d
      join public.couranr_route_run_stops s
        on s.request_id=d.request_id
        and s.route_version_id=v_exec.route_version_id
      where d.route_run_id=v_exec.route_run_id
        and (d.fulfillment_state not in ('delivered','returned')
          or (d.fulfillment_state='delivered' and
            (not exists(select 1 from public.couranr_handoff_records h
              join public.couranr_delivery_assignments a on a.id=h.assignment_id
              where h.delivery_id=d.id and h.handoff_stage='dropoff'
                and a.route_execution_id=v_exec.id)
             or not exists(select 1 from public.couranr_delivery_proofs p
              join public.couranr_delivery_assignments a on a.id=p.assignment_id
              where p.delivery_id=d.id and p.proof_stage='dropoff'
                and a.route_execution_id=v_exec.id))))) then
    raise exception 'route_custody_not_terminal' using errcode='CR409';
  end if;
  if exists(select 1 from public.couranr_delivery_assignments a
      where a.route_execution_id=v_exec.id and a.assignment_state='active')
    or exists(select 1 from public.couranr_delivery_returns r
      join public.couranr_deliveries d on d.id=r.delivery_id
      where d.route_run_id=v_exec.route_run_id and r.return_state<>'returned') then
    raise exception 'route_custody_not_terminal' using errcode='CR409';
  end if;
  select * into v_resource from public.couranr_route_run_resource_reservations
   where id=v_exec.resource_id for update;
  if not found or v_resource.resource_state<>'committed'
    or v_resource.driver_id is distinct from v_exec.driver_id
    or v_resource.vehicle_id is distinct from v_exec.vehicle_id then
    raise exception 'route_terminal_resource_mismatch' using errcode='CR409';
  end if;
  v_release_reason:=case when v_failed_pickup then 'failed_shared_pickup'
    else 'route_execution_completed' end;
  update public.couranr_route_run_executions
     set execution_state=case when v_failed_pickup then 'cancelled' else 'completed' end,
       completed_at=case when v_failed_pickup then completed_at else now() end,
       cancelled_at=case when v_failed_pickup then now() else cancelled_at end,
       version=version+1,
       updated_at=now() where id=v_exec.id;
  update public.couranr_route_run_resource_reservations
     set resource_state='released',released_at=now(),
       release_reason=v_release_reason,version=version+1,
       updated_at=now() where id=v_resource.id;
  insert into public.couranr_route_run_resource_events(
    resource_id,actor_user_id,event_type,detail)
  values(v_resource.id,p_actor_user_id,'released',
    jsonb_build_object('reason',v_release_reason,
      'routeExecutionId',v_exec.id));
  perform public.couranr_release_assignment_resources(
    v_exec.driver_id,v_exec.vehicle_id);
  insert into public.couranr_route_run_execution_events(
    execution_id,actor_user_id,event_type,detail)
  values(v_exec.id,p_actor_user_id,
    case when v_failed_pickup then 'route_cancelled' else 'route_completed' end,
    jsonb_build_object('childCount',v_expected));
  insert into public.couranr_route_run_execution_events(
    execution_id,actor_user_id,event_type,detail)
  values(v_exec.id,p_actor_user_id,'resource_released',
    jsonb_build_object('resourceId',v_resource.id));
  return jsonb_build_object('outcome',
    case when v_failed_pickup then 'cancelled' else 'completed' end,
    'executionId',v_exec.id);
end $fn$;
revoke all on function private.couranr_release_terminal_route_execution(uuid,uuid)
  from public,anon,authenticated,service_role;

create function public.couranr_advance_route_run_stop(
  p_route_run_id uuid,p_actor_user_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_exec public.couranr_route_run_executions;
  v_stop_count integer;
  v_current_state text;
  v_next_state text;
begin
  v_exec:=private.couranr_route_driver_execution(p_route_run_id,p_actor_user_id);
  if v_exec.execution_state='completed' then
    return jsonb_build_object('outcome','already_completed',
      'executionId',v_exec.id);
  end if;
  if v_exec.execution_state<>'in_progress' then
    raise exception 'route_stop_advance_wrong_state' using errcode='CR409';
  end if;
  select stop_count into v_stop_count from public.couranr_route_run_versions
   where id=v_exec.route_version_id;
  select d.fulfillment_state into v_current_state
    from public.couranr_route_run_stops s
    join public.couranr_deliveries d on d.request_id=s.request_id
   where s.route_version_id=v_exec.route_version_id
     and s.sequence=v_exec.current_sequence for update of d;
  if v_current_state not in ('delivered','returned') then
    raise exception 'route_current_stop_not_terminal' using errcode='CR409';
  end if;
  if v_exec.current_sequence=v_stop_count then
    return private.couranr_release_terminal_route_execution(
      v_exec.id,p_actor_user_id);
  end if;
  select d.fulfillment_state into v_next_state
    from public.couranr_route_run_stops s
    join public.couranr_deliveries d on d.request_id=s.request_id
   where s.route_version_id=v_exec.route_version_id
     and s.sequence=v_exec.current_sequence+1 for update of d;
  if v_next_state is distinct from 'in_transit' then
    raise exception 'route_next_stop_not_in_transit' using errcode='CR409';
  end if;
  update public.couranr_route_run_executions
     set current_sequence=current_sequence+1,version=version+1,
       updated_at=now() where id=v_exec.id;
  insert into public.couranr_route_run_execution_events(
    execution_id,actor_user_id,event_type,detail)
  values(v_exec.id,p_actor_user_id,'stop_advanced',
    jsonb_build_object('fromSequence',v_exec.current_sequence,
      'toSequence',v_exec.current_sequence+1));
  return jsonb_build_object('outcome','next_stop','executionId',v_exec.id,
    'currentSequence',v_exec.current_sequence+1);
end $fn$;
revoke all on function public.couranr_advance_route_run_stop(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_advance_route_run_stop(uuid,uuid)
  to service_role;

-- A return must physically complete before final Route closure. Operations may
-- choose to carry that return cargo through later stops or return immediately;
-- neither decision changes child money/custody on its own.
create function public.couranr_resolve_route_run_exception(
  p_route_run_id uuid,p_actor_user_id uuid,p_resolution text
) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_role text;
  v_exec public.couranr_route_run_executions;
  v_count integer;
  v_current_state text;
begin
  select role into v_role from public.profiles where id=p_actor_user_id;
  if v_role is distinct from 'admin' then
    raise exception 'operations_access_required' using errcode='CR403';
  end if;
  if p_resolution not in ('continue_later_stops','return_now') then
    raise exception 'route_exception_resolution_invalid' using errcode='CR400';
  end if;
  select * into v_exec from public.couranr_route_run_executions
   where route_run_id=p_route_run_id for update;
  if not found or v_exec.execution_state<>'exception' then
    raise exception 'route_exception_not_open' using errcode='CR409';
  end if;
  select stop_count into v_count from public.couranr_route_run_versions
   where id=v_exec.route_version_id;
  if v_exec.current_sequence=0 then
    if p_resolution<>'return_now'
      or not exists(select 1 from public.couranr_deliveries d
        where d.route_run_id=v_exec.route_run_id
          and d.fulfillment_state='could_not_deliver')
      or exists(select 1 from public.couranr_deliveries d
        where d.route_run_id=v_exec.route_run_id
          and d.fulfillment_state not in
            ('at_pickup','picked_up','could_not_deliver')) then
      raise exception 'route_failed_pickup_requires_return_review'
        using errcode='CR409';
    end if;
    update public.couranr_route_run_executions
      set execution_state='returning',version=version+1,updated_at=now()
     where id=v_exec.id;
    insert into public.couranr_route_run_execution_events(
      execution_id,actor_user_id,event_type,detail)
    values(v_exec.id,p_actor_user_id,'operations_return',
      jsonb_build_object('sequence',0,'failedSharedPickup',true));
    return jsonb_build_object('outcome','return_now','currentSequence',0);
  end if;
  select d.fulfillment_state into v_current_state
    from public.couranr_route_run_stops s
    join public.couranr_deliveries d on d.request_id=s.request_id
   where s.route_version_id=v_exec.route_version_id
     and s.sequence=v_exec.current_sequence for update of d;
  if v_current_state not in ('return_required','returning','returned') then
    raise exception 'route_exception_custody_unresolved' using errcode='CR409';
  end if;
  if p_resolution='continue_later_stops' then
    if v_exec.current_sequence>=v_count then
      raise exception 'route_exception_no_later_stop' using errcode='CR409';
    end if;
    if not exists(select 1 from public.couranr_route_run_stops s
      join public.couranr_deliveries d on d.request_id=s.request_id
      where s.route_version_id=v_exec.route_version_id
        and s.sequence=v_exec.current_sequence+1
        and d.fulfillment_state='in_transit') then
      raise exception 'route_next_stop_not_in_transit' using errcode='CR409';
    end if;
    update public.couranr_route_run_executions
      set execution_state='in_progress',current_sequence=current_sequence+1,
        version=version+1,updated_at=now() where id=v_exec.id;
    insert into public.couranr_route_run_execution_events(
      execution_id,actor_user_id,event_type,detail)
    values(v_exec.id,p_actor_user_id,'operations_continue',
      jsonb_build_object('failedSequence',v_exec.current_sequence,
        'nextSequence',v_exec.current_sequence+1,
        'returnCargoOpen',v_current_state<>'returned'));
    return jsonb_build_object('outcome','continue_later_stops',
      'currentSequence',v_exec.current_sequence+1);
  end if;
  update public.couranr_route_run_executions
    set execution_state='returning',version=version+1,updated_at=now()
   where id=v_exec.id;
  insert into public.couranr_route_run_execution_events(
    execution_id,actor_user_id,event_type,detail)
  values(v_exec.id,p_actor_user_id,'operations_return',
    jsonb_build_object('sequence',v_exec.current_sequence,
      'returnCargoOpen',v_current_state<>'returned'));
  return jsonb_build_object('outcome','return_now',
    'currentSequence',v_exec.current_sequence);
end $fn$;
revoke all on function public.couranr_resolve_route_run_exception(uuid,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_resolve_route_run_exception(uuid,uuid,text)
  to service_role;

create function public.couranr_complete_route_run_execution(
  p_route_run_id uuid,p_actor_user_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_exec public.couranr_route_run_executions;
begin
  v_exec:=private.couranr_route_driver_execution(
    p_route_run_id,p_actor_user_id);
  return private.couranr_release_terminal_route_execution(
    v_exec.id,p_actor_user_id);
end $fn$;
revoke all on function public.couranr_complete_route_run_execution(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_complete_route_run_execution(uuid,uuid)
  to service_role;
commit;

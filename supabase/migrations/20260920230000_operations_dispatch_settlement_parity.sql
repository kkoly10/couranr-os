-- Operations dispatch parity.
--
-- Automatic fulfillment already reserves a compatible driver/vehicle BEFORE
-- settlement, then captures/creates the delivery, then commits the assignment.
-- Manual Operations plans historically captured first and only exposed the
-- assignment screen afterwards. These two service-role-only commands give the
-- manual path the same safe ordering without changing the automatic worker.

begin;
set local statement_timeout = '60s';
set local lock_timeout = '10s';

create or replace function public.couranr_reserve_operations_dispatch_candidate(
  p_request_id uuid,
  p_actor_user_id uuid,
  p_now timestamptz default now()
) returns jsonb
language plpgsql
set search_path = ''
as $fn$
declare
  v_plan public.couranr_service_plans;
  v_existing public.couranr_dispatch_reservations;
  v_driver_id uuid;
  v_vehicle_id uuid;
  v_row public.couranr_dispatch_reservations;
  v_delivery_id uuid;
begin
  if p_actor_user_id is null then
    raise exception 'operations_actor_required' using errcode='CR403';
  end if;

  select * into v_plan
    from public.couranr_service_plans
   where request_id=p_request_id
     and plan_state='confirmed'
     and plan_source='operations'
   order by created_at desc
   limit 1
   for update;
  if not found then
    raise exception 'operations_service_plan_not_confirmed' using errcode='CR409';
  end if;

  perform pg_advisory_xact_lock(hashtext('couranr-dispatch:'||coalesce(v_plan.market_key,'default')));

  update public.couranr_dispatch_reservations
     set reservation_state='expired', release_reason='ttl_expired', updated_at=now()
   where reservation_state='active' and expires_at<=p_now;

  select * into v_existing
    from public.couranr_dispatch_reservations
   where request_id=p_request_id
     and reservation_state='active'
     and expires_at>p_now
   limit 1;
  if found then
    return jsonb_build_object(
      'outcome','reserved',
      'reservationId',v_existing.id,
      'servicePlanId',v_existing.service_plan_id,
      'driverId',v_existing.driver_id,
      'vehicleId',v_existing.vehicle_id,
      'expiresAt',v_existing.expires_at
    );
  end if;

  select id into v_delivery_id
    from public.couranr_deliveries
   where request_id=p_request_id;

  select d.id,v.id into v_driver_id,v_vehicle_id
    from public.couranr_drivers d
    cross join public.couranr_dispatch_vehicles v
   where d.driver_state='active'
     and d.active=true
     and d.availability_state='available'
     and v.active=true
     and v.availability_state='available'
     and (v_plan.vehicle_id is null or v.id=v_plan.vehicle_id)
     and (v.assigned_driver_id is null or v.assigned_driver_id=d.id)
     and public.couranr_vehicle_incompatibility(v.id,d.id,v_plan.vehicle_requirement) is null
     and not exists (
       select 1 from public.couranr_dispatch_reservations x
        where x.driver_id=d.id and x.reservation_state='active' and x.expires_at>p_now
     )
     and not exists (
       select 1 from public.couranr_dispatch_reservations x
        where x.vehicle_id=v.id and x.reservation_state='active' and x.expires_at>p_now
     )
   order by
     case when v_plan.vehicle_id is not null and v.id=v_plan.vehicle_id then 0 else 1 end,
     case when v.assigned_driver_id=d.id then 0 else 1 end,
     d.created_at,
     v.created_at
   limit 1;

  if v_driver_id is null or v_vehicle_id is null then
    return jsonb_build_object('outcome','waiting','reason','no_dispatch_candidate');
  end if;

  insert into public.couranr_dispatch_reservations(
    request_id,service_plan_id,delivery_id,driver_id,vehicle_id,expires_at
  ) values (
    p_request_id,v_plan.id,v_delivery_id,v_driver_id,v_vehicle_id,p_now+interval '5 minutes'
  ) returning * into v_row;

  return jsonb_build_object(
    'outcome','reserved',
    'reservationId',v_row.id,
    'servicePlanId',v_row.service_plan_id,
    'driverId',v_row.driver_id,
    'vehicleId',v_row.vehicle_id,
    'expiresAt',v_row.expires_at
  );
exception when unique_violation then
  select * into v_existing
    from public.couranr_dispatch_reservations
   where request_id=p_request_id
     and reservation_state='active'
     and expires_at>p_now
   limit 1;
  if found then
    return jsonb_build_object(
      'outcome','reserved',
      'reservationId',v_existing.id,
      'servicePlanId',v_existing.service_plan_id,
      'driverId',v_existing.driver_id,
      'vehicleId',v_existing.vehicle_id,
      'expiresAt',v_existing.expires_at
    );
  end if;
  return jsonb_build_object('outcome','waiting','reason','candidate_raced');
end
$fn$;

create or replace function public.couranr_commit_operations_dispatch_assignment(
  p_reservation_id uuid,
  p_delivery_id uuid,
  p_expected_delivery_version integer,
  p_actor_user_id uuid,
  p_idempotency_key text
) returns public.couranr_delivery_assignments
language plpgsql
set search_path = ''
as $fn$
declare
  v_res public.couranr_dispatch_reservations;
  v_dlv public.couranr_deliveries;
  v_plan public.couranr_service_plans;
  v_drv public.couranr_drivers;
  v_veh public.couranr_dispatch_vehicles;
  v_asg public.couranr_delivery_assignments;
  v_reason text;
begin
  if p_actor_user_id is null then
    raise exception 'operations_actor_required' using errcode='CR403';
  end if;
  if nullif(btrim(p_idempotency_key),'') is null then
    raise exception 'idempotency_key_required' using errcode='CR422';
  end if;

  select * into v_asg
    from public.couranr_delivery_assignments
   where idempotency_key=p_idempotency_key;
  if found then return v_asg; end if;

  select * into v_res
    from public.couranr_dispatch_reservations
   where id=p_reservation_id
   for update;
  if not found then
    raise exception 'dispatch_reservation_not_found' using errcode='CR404';
  end if;
  if v_res.reservation_state<>'active' or v_res.expires_at<=now() then
    raise exception 'dispatch_reservation_expired' using errcode='CR409';
  end if;

  select * into v_dlv
    from public.couranr_deliveries
   where id=p_delivery_id
   for update;
  if not found then raise exception 'delivery_not_found' using errcode='CR404'; end if;
  if v_dlv.request_id is distinct from v_res.request_id
     or v_dlv.service_plan_id is distinct from v_res.service_plan_id then
    raise exception 'dispatch_reservation_delivery_mismatch' using errcode='CR409';
  end if;
  if v_dlv.fulfillment_state<>'scheduled'
     or v_dlv.version<>p_expected_delivery_version then
    raise exception 'version_or_state_conflict' using errcode='CR409';
  end if;

  select * into v_plan
    from public.couranr_service_plans
   where id=v_dlv.service_plan_id;
  if not found or v_plan.plan_state<>'confirmed' or v_plan.plan_source<>'operations' then
    raise exception 'operations_service_plan_not_confirmed' using errcode='CR409';
  end if;

  select * into v_drv from public.couranr_drivers where id=v_res.driver_id for update;
  select * into v_veh from public.couranr_dispatch_vehicles where id=v_res.vehicle_id for update;
  if v_drv.id is null or v_drv.driver_state<>'active' or not v_drv.active then
    raise exception 'driver_not_active' using errcode='CR409';
  end if;
  if v_drv.availability_state<>'available' then
    raise exception 'driver_not_available' using errcode='CR409';
  end if;
  if v_veh.id is null or not v_veh.active or v_veh.availability_state<>'available' then
    raise exception 'vehicle_unavailable' using errcode='CR409';
  end if;

  v_reason:=public.couranr_vehicle_incompatibility(v_veh.id,v_drv.id,v_plan.vehicle_requirement);
  if v_reason is not null then
    raise exception using errcode='CR409',message=v_reason;
  end if;

  insert into public.couranr_delivery_assignments(
    delivery_id,driver_id,vehicle_id,assigned_by,idempotency_key,
    assignment_source,dispatch_reservation_id
  ) values (
    v_dlv.id,v_drv.id,v_veh.id,p_actor_user_id,p_idempotency_key,
    'operations',v_res.id
  ) returning * into v_asg;

  update public.couranr_deliveries
     set fulfillment_state='assigned',version=version+1,updated_at=now()
   where id=v_dlv.id
     and version=p_expected_delivery_version
     and fulfillment_state='scheduled'
  returning * into v_dlv;
  if not found then raise exception 'version_or_state_conflict' using errcode='CR409'; end if;

  update public.couranr_drivers
     set availability_state='on_delivery',version=version+1,updated_at=now()
   where id=v_drv.id;
  update public.couranr_dispatch_vehicles
     set availability_state='on_delivery',version=version+1,updated_at=now()
   where id=v_veh.id;

  update public.couranr_dispatch_reservations
     set delivery_id=v_dlv.id,reservation_state='committed',updated_at=now()
   where id=v_res.id;

  insert into public.couranr_assignment_events(
    assignment_id,delivery_id,actor_user_id,actor_type,command,
    from_state,to_state,metadata
  ) values (
    v_asg.id,v_dlv.id,p_actor_user_id,'operations','assign_delivery',
    null,'active',
    jsonb_build_object(
      'driverId',v_drv.id,'vehicleId',v_veh.id,
      'assignmentSource','operations','dispatchReservationId',v_res.id
    )
  );

  insert into public.couranr_delivery_events(
    delivery_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_dlv.id,p_actor_user_id,'operations','assign_delivery',
    'scheduled','assigned',
    jsonb_build_object(
      'assignmentId',v_asg.id,'driverId',v_drv.id,'vehicleId',v_veh.id,
      'assignmentSource','operations','dispatchReservationId',v_res.id
    )
  );

  return v_asg;
exception when unique_violation then
  select * into v_asg
    from public.couranr_delivery_assignments
   where idempotency_key=p_idempotency_key;
  if found then return v_asg; end if;
  raise;
end
$fn$;

revoke all on function public.couranr_reserve_operations_dispatch_candidate(uuid,uuid,timestamptz)
  from public, anon, authenticated;
grant execute on function public.couranr_reserve_operations_dispatch_candidate(uuid,uuid,timestamptz)
  to service_role;

revoke all on function public.couranr_commit_operations_dispatch_assignment(uuid,uuid,integer,uuid,text)
  from public, anon, authenticated;
grant execute on function public.couranr_commit_operations_dispatch_assignment(uuid,uuid,integer,uuid,text)
  to service_role;

commit;

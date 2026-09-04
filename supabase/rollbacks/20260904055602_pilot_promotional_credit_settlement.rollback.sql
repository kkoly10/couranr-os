-- Roll back 20260904055602_pilot_promotional_credit_settlement.
-- REAL PRODUCTION DATA: promotional credits are immutable commercial evidence.
-- Refuse once any credit/evidence exists; an operator must roll forward rather
-- than erase the economic identity of a completed or in-flight pilot.
begin;

do $$
begin
  if exists(select 1 from public.couranr_promotional_credits)
     or exists(select 1 from public.couranr_delivery_request_events where command='apply_promotional_credit')
     or exists(select 1 from public.couranr_delivery_events where command='create_delivery_from_promotional_credit') then
    raise exception 'refusing to restore pre-credit schema: promotional credit evidence exists';
  end if;
end $$;

drop function if exists public.couranr_create_delivery_from_promotional_credit(uuid) restrict;
drop function if exists public.couranr_apply_promotional_credit(uuid,integer,uuid,text,text,text,text) restrict;

create or replace function public.couranr_confirm_service_plan(
  p_request_id uuid,p_expected_version integer,p_actor_user_id uuid,
  p_pickup_start timestamptz,p_pickup_end timestamptz,p_timezone text,
  p_vehicle_id uuid,p_vehicle_requirement jsonb
)
returns public.couranr_service_plans
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_ob public.couranr_payment_obligations;
  v_quote public.couranr_quote_versions;
  v_plan public.couranr_service_plans;
  v_cap numeric;
  v_weight numeric;
begin
  select * into v_req from public.couranr_delivery_requests where id=p_request_id for update;
  if not found then raise exception 'request_not_found' using errcode='CR404'; end if;
  if v_req.version is distinct from p_expected_version then
    raise exception 'version_or_state_conflict' using errcode='CR409';
  end if;
  -- A post-authorization requote deliberately moves the request out of
  -- confirmed. Report its commercial cause before the broader state refusal,
  -- so operators cannot mistake a Q1/Q2 mismatch for a scheduling problem.
  select * into v_ob from public.couranr_payment_obligations
   where request_id=v_req.id and payment_state<>'cancelled' limit 1;
  if found and v_ob.quote_version_id is distinct from v_req.current_quote_version_id then
    raise exception 'authorization_does_not_match_current_quote' using errcode='CR409';
  end if;
  if v_req.request_state<>'confirmed' then
    raise exception 'request_not_confirmed' using errcode='CR409';
  end if;
  select * into v_ob from public.couranr_payment_obligations
   where request_id=v_req.id and payment_state<>'cancelled' limit 1;
  if not found or v_ob.payment_state<>'authorized' then
    raise exception 'payment_not_authorized' using errcode='CR409';
  end if;
  if v_req.current_quote_version_id is null
     or v_ob.quote_version_id is distinct from v_req.current_quote_version_id then
    raise exception 'authorization_does_not_match_current_quote' using errcode='CR409';
  end if;
  select * into v_quote from public.couranr_quote_versions
   where id=v_ob.quote_version_id and request_id=v_req.id;
  if not found then raise exception 'quote_not_found' using errcode='CR409'; end if;

  if p_pickup_start is null or p_pickup_end is null or p_pickup_end<=p_pickup_start then
    raise exception 'invalid_pickup_window' using errcode='CR422';
  end if;
  if nullif(btrim(p_timezone),'') is null then
    raise exception 'timezone_required' using errcode='CR422';
  end if;
  begin perform now() at time zone p_timezone;
  exception when others then raise exception 'unknown_timezone' using errcode='CR422'; end;
  if jsonb_typeof(p_vehicle_requirement) is distinct from 'object'
     or coalesce(p_vehicle_requirement->>'vehicleClass','') not in
        ('car','van','box_truck','cargo_bike') then
    raise exception 'vehicle_requirement_required' using errcode='CR422';
  end if;
  v_cap:=nullif(p_vehicle_requirement->>'maxPayloadLb','')::numeric;
  if v_cap is null or v_cap<=0 then
    raise exception 'vehicle_capacity_required' using errcode='CR422';
  end if;
  v_weight:=coalesce(nullif(v_quote.shipment_snapshot->>'weightLb','')::numeric,0);
  if v_cap<v_weight then
    raise exception 'vehicle_incompatible_with_shipment' using errcode='CR422';
  end if;

  update public.couranr_service_plans set
    plan_state='cancelled',version=version+1,updated_at=now()
  where request_id=v_req.id and plan_state<>'cancelled';
  insert into public.couranr_service_plans(
    request_id,business_account_id,payment_obligation_id,request_version,
    quote_version_id,scheduled_pickup_start,scheduled_pickup_end,timezone,
    vehicle_id,vehicle_requirement,plan_state,confirmed_by,confirmed_at
  ) values (
    v_req.id,v_req.business_account_id,v_ob.id,v_req.version,v_quote.id,
    p_pickup_start,p_pickup_end,p_timezone,p_vehicle_id,p_vehicle_requirement,
    'confirmed',p_actor_user_id,now()
  ) returning * into v_plan;
  return v_plan;
end
$fn$;
revoke all on function public.couranr_confirm_service_plan(
  uuid,integer,uuid,timestamptz,timestamptz,text,uuid,jsonb
) from public,anon,authenticated,service_role;
grant execute on function public.couranr_confirm_service_plan(
  uuid,integer,uuid,timestamptz,timestamptz,text,uuid,jsonb
) to service_role;

create or replace function public.couranr_assign_delivery(
  p_delivery_id      uuid,
  p_expected_version integer,
  p_actor_user_id    uuid,
  p_driver_id        uuid,
  p_vehicle_id       uuid,
  p_idempotency_key  text
)
returns public.couranr_delivery_assignments
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_dlv public.couranr_deliveries;
  v_drv public.couranr_drivers;
  v_asg public.couranr_delivery_assignments;
  v_ob_state text;
  v_plan_state text;
  v_reason text;
begin
  -- Idempotent replay: the same key returns the same assignment, and nothing
  -- is re-checked or re-written.
  if p_idempotency_key is not null then
    select * into v_asg from public.couranr_delivery_assignments
     where idempotency_key = p_idempotency_key;
    if found then
      return v_asg;
    end if;
  end if;

  select * into v_dlv from public.couranr_deliveries where id = p_delivery_id for update;
  if not found then
    raise exception 'delivery_not_found' using errcode = 'CR404';
  end if;
  if v_dlv.fulfillment_state <> 'scheduled' then
    raise exception 'delivery_not_scheduled' using errcode = 'CR409';
  end if;

  -- Money first: a delivery whose capture did not complete must never be
  -- dispatched. The canonical delivery only exists after capture, but the
  -- obligation is re-read rather than assumed.
  select o.payment_state into v_ob_state
    from public.couranr_payment_obligations o
   where o.id = v_dlv.payment_obligation_id;
  if v_ob_state is distinct from 'captured' then
    raise exception 'payment_not_captured' using errcode = 'CR409';
  end if;

  select p.plan_state into v_plan_state
    from public.couranr_service_plans p
   where p.id = v_dlv.service_plan_id;
  if v_plan_state is distinct from 'confirmed' then
    raise exception 'service_plan_not_confirmed' using errcode = 'CR409';
  end if;

  if exists (select 1 from public.couranr_delivery_assignments
              where delivery_id = p_delivery_id and assignment_state = 'active') then
    raise exception 'delivery_already_assigned' using errcode = 'CR409';
  end if;

  select * into v_drv from public.couranr_drivers where id = p_driver_id for update;
  if not found then
    raise exception 'driver_not_found' using errcode = 'CR404';
  end if;
  if v_drv.driver_state <> 'active' or not v_drv.active then
    raise exception 'driver_not_active' using errcode = 'CR409';
  end if;
  if v_drv.availability_state <> 'available' then
    raise exception 'driver_not_available' using errcode = 'CR409';
  end if;

  -- Capability is read from the vehicle row against the plan's IMMUTABLE
  -- requirement. The caller supplied two ids and nothing else.
  v_reason := public.couranr_vehicle_incompatibility(p_vehicle_id, p_driver_id, v_dlv.vehicle_requirement);
  if v_reason is not null then
    raise exception using errcode = 'CR409', message = v_reason;
  end if;

  insert into public.couranr_delivery_assignments (
    delivery_id, driver_id, vehicle_id, assigned_by, idempotency_key
  ) values (
    p_delivery_id, p_driver_id, p_vehicle_id, p_actor_user_id, p_idempotency_key
  )
  returning * into v_asg;

  insert into public.couranr_assignment_events (
    assignment_id, delivery_id, actor_user_id, actor_type, command, from_state, to_state, metadata
  ) values (
    v_asg.id, p_delivery_id, p_actor_user_id, 'operations', 'assign_delivery', null, 'active',
    jsonb_build_object('driverId', p_driver_id, 'vehicleId', p_vehicle_id)
  );

  -- scheduled -> assigned, compare-and-set on the version the caller saw.
  update public.couranr_deliveries
     set fulfillment_state = 'assigned',
         version           = version + 1,
         updated_at        = now()
   where id = p_delivery_id
     and version = p_expected_version
     and fulfillment_state = 'scheduled'
  returning * into v_dlv;

  if not found then
    raise exception 'version_conflict' using errcode = 'CR409';
  end if;

  insert into public.couranr_delivery_events (
    delivery_id, actor_user_id, actor_type, command, from_state, to_state, metadata
  ) values (
    p_delivery_id, p_actor_user_id, 'operations', 'assign_delivery', 'scheduled', 'assigned',
    jsonb_build_object('assignmentId', v_asg.id, 'driverId', p_driver_id, 'vehicleId', p_vehicle_id)
  );

  update public.couranr_drivers
     set availability_state = 'on_delivery', version = version + 1, updated_at = now()
   where id = p_driver_id;

  update public.couranr_dispatch_vehicles
     set availability_state = 'on_delivery', version = version + 1, updated_at = now()
   where id = p_vehicle_id;

  return v_asg;
exception when unique_violation then
  -- A concurrent assign won. Return its row if this was the same request,
  -- otherwise report the conflict rather than silently doing nothing.
  if p_idempotency_key is not null then
    select * into v_asg from public.couranr_delivery_assignments
     where idempotency_key = p_idempotency_key;
    if found then
      return v_asg;
    end if;
  end if;
  raise exception 'delivery_already_assigned' using errcode = 'CR409';
end
$fn$;
revoke all on function public.couranr_assign_delivery(
  uuid,integer,uuid,uuid,uuid,text
) from public,anon,authenticated,service_role;
grant execute on function public.couranr_assign_delivery(
  uuid,integer,uuid,uuid,uuid,text
) to service_role;

alter table public.couranr_delivery_request_events
  drop constraint if exists couranr_dre_command_chk;
alter table public.couranr_delivery_request_events
  add constraint couranr_dre_command_chk check (command in (
    'create_delivery_request_draft','calculate_delivery_request_estimate','create_quote_version',
    'submit_delivery_request','begin_delivery_request_review','accept_delivery_request_as_quoted',
    'requote_delivery_request','decline_delivery_request','record_payer_quote_approval',
    'begin_delivery_preparation','mark_delivery_ready','mark_delivery_not_ready',
    'mark_delivery_unavailable','cancel_delivery_request'
  ));
alter table public.couranr_delivery_events
  drop constraint if exists couranr_dlve_command_chk;
alter table public.couranr_delivery_events
  add constraint couranr_dlve_command_chk check (command in (
    'create_delivery_from_capture','assign_delivery','unassign_delivery_before_pickup',
    'start_route_to_pickup','arrive_at_pickup','report_pickup_discrepancy',
    'resolve_pickup_discrepancy_safe_to_continue','complete_pickup',
    'start_route_to_dropoff','arrive_at_dropoff','complete_direct_handoff_delivery',
    'complete_signature_delivery','complete_leave_at_door_delivery',
    'report_dropoff_exception','close_delivery_undeliverable','cancel_delivery'
  ));

alter table public.couranr_deliveries
  drop constraint if exists couranr_dlv_promotional_amounts_chk;
alter table public.couranr_deliveries
  drop constraint if exists couranr_dlv_promotional_credit_fk;
alter table public.couranr_service_plans
  drop constraint if exists couranr_sp_promotional_credit_fk;
alter table public.couranr_deliveries
  drop constraint if exists couranr_dlv_amount_chk;
alter table public.couranr_deliveries
  add constraint couranr_dlv_amount_chk check (captured_amount_cents > 0);

alter table public.couranr_deliveries
  drop column if exists promotional_credit_id,
  drop column if exists standard_quote_cents,
  drop column if exists amount_paid_cents,
  drop column if exists promotional_credit_cents;
alter table public.couranr_service_plans
  drop column if exists promotional_credit_id;

drop table if exists public.couranr_promotional_credits restrict;
commit;

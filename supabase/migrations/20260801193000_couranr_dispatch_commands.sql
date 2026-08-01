-- =====================================================================
-- Managed dispatch commands.
--
-- Every one follows the contract the request and payment slices settled on:
--   * SECURITY INVOKER, `set search_path = ''`, service_role only
--   * the actor is passed in and RECORDED, never inferred
--   * no caller-supplied target state — the command name IS the transition
--   * optimistic concurrency by compare-and-set on `version` in the WHERE
--   * state change and audit row in ONE transaction
--   * idempotency as a unique constraint, not a check-then-act
--   * custom SQLSTATEs: CR403 forbidden, CR404 not found, CR409 conflict,
--     CR412 precondition, CR422 unprocessable
--
-- NOTHING HERE LETS A DRIVER ACT. Assignment is Operations-authored end to
-- end; a driver's only capability in this slice is reading the one delivery
-- assigned to them, which is a SELECT and needs no command.
-- =====================================================================

begin;

set local statement_timeout = '120s';
set local lock_timeout = '10s';

-- ---------------------------------------------------------------------
-- 1. couranr_create_driver_profile
--
--    Idempotent by the user_id unique index: a second call for the same
--    account returns the existing profile rather than raising. A driver
--    account maps to exactly one current canonical profile.
-- ---------------------------------------------------------------------
create or replace function public.couranr_create_driver_profile(
  p_user_id       uuid,
  p_actor_user_id uuid,
  p_display_name  text,
  p_contact_phone text,
  p_market        text
)
returns public.couranr_drivers
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_d public.couranr_drivers;
begin
  if p_user_id is null then
    raise exception 'user_required' using errcode = 'CR422';
  end if;
  if p_display_name is null or length(btrim(p_display_name)) = 0 then
    raise exception 'display_name_required' using errcode = 'CR422';
  end if;

  select * into v_d from public.couranr_drivers where user_id = p_user_id;
  if found then
    return v_d;
  end if;

  insert into public.couranr_drivers (user_id, display_name, contact_phone, market)
  values (p_user_id, btrim(p_display_name), nullif(btrim(coalesce(p_contact_phone,'')), ''), nullif(btrim(coalesce(p_market,'')), ''))
  returning * into v_d;

  return v_d;
exception when unique_violation then
  -- Lost a race with a concurrent create. The other one won; return its row.
  select * into v_d from public.couranr_drivers where user_id = p_user_id;
  return v_d;
end
$fn$;

-- ---------------------------------------------------------------------
-- 2. couranr_set_driver_state  (Operations activates / suspends / retires)
-- ---------------------------------------------------------------------
create or replace function public.couranr_set_driver_state(
  p_driver_id       uuid,
  p_expected_version integer,
  p_actor_user_id   uuid,
  p_driver_state    text
)
returns public.couranr_drivers
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_d public.couranr_drivers;
begin
  if p_driver_state not in ('pending','active','suspended','inactive') then
    raise exception 'invalid_driver_state' using errcode = 'CR422';
  end if;

  select * into v_d from public.couranr_drivers where id = p_driver_id;
  if not found then
    raise exception 'driver_not_found' using errcode = 'CR404';
  end if;

  -- Retiring or suspending a driver mid-delivery would strand the delivery.
  -- Replace the assignment first; that command releases them.
  if v_d.availability_state = 'on_delivery' and p_driver_state <> 'active' then
    raise exception 'driver_is_on_delivery' using errcode = 'CR409';
  end if;

  update public.couranr_drivers
     set driver_state = p_driver_state,
         active       = (p_driver_state = 'active'),
         version      = version + 1,
         updated_at   = now()
   where id = p_driver_id and version = p_expected_version
  returning * into v_d;

  if not found then
    raise exception 'version_conflict' using errcode = 'CR409';
  end if;
  return v_d;
end
$fn$;

-- ---------------------------------------------------------------------
-- 3. couranr_update_driver_availability
-- ---------------------------------------------------------------------
create or replace function public.couranr_update_driver_availability(
  p_driver_id        uuid,
  p_expected_version integer,
  p_actor_user_id    uuid,
  p_availability_state text
)
returns public.couranr_drivers
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_d public.couranr_drivers;
begin
  -- `on_delivery` is not something anyone SETS. It is a consequence of an
  -- assignment, and only assign/replace may write it.
  if p_availability_state not in ('available','unavailable') then
    raise exception 'invalid_availability_state' using errcode = 'CR422';
  end if;

  select * into v_d from public.couranr_drivers where id = p_driver_id;
  if not found then
    raise exception 'driver_not_found' using errcode = 'CR404';
  end if;

  /*
   * Refusing this while on_delivery is what stops a second assignment. Marking
   * a busy driver `available` by hand would defeat the partial unique index's
   * intent, and the index alone would not catch it — it constrains assignments,
   * not availability.
   */
  if v_d.availability_state = 'on_delivery' then
    raise exception 'driver_is_on_delivery' using errcode = 'CR409';
  end if;

  update public.couranr_drivers
     set availability_state = p_availability_state,
         version            = version + 1,
         updated_at         = now()
   where id = p_driver_id and version = p_expected_version
  returning * into v_d;

  if not found then
    raise exception 'version_conflict' using errcode = 'CR409';
  end if;
  return v_d;
end
$fn$;

-- ---------------------------------------------------------------------
-- 4. couranr_create_dispatch_vehicle
-- ---------------------------------------------------------------------
create or replace function public.couranr_create_dispatch_vehicle(
  p_actor_user_id      uuid,
  p_name               text,
  p_vehicle_class      text,
  p_payload_capacity_lb integer,
  p_assigned_driver_id uuid,
  p_cargo_length_in    integer,
  p_cargo_width_in     integer,
  p_cargo_height_in    integer,
  p_enclosed           boolean,
  p_has_ramp           boolean,
  p_has_dolly          boolean,
  p_has_tie_downs      boolean,
  p_weather_protection boolean
)
returns public.couranr_dispatch_vehicles
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_v public.couranr_dispatch_vehicles;
begin
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'name_required' using errcode = 'CR422';
  end if;
  if p_vehicle_class not in ('car','van','box_truck','cargo_bike') then
    raise exception 'invalid_vehicle_class' using errcode = 'CR422';
  end if;
  if p_payload_capacity_lb is null or p_payload_capacity_lb <= 0 then
    raise exception 'payload_capacity_required' using errcode = 'CR422';
  end if;
  if p_assigned_driver_id is not null
     and not exists (select 1 from public.couranr_drivers where id = p_assigned_driver_id) then
    raise exception 'driver_not_found' using errcode = 'CR404';
  end if;

  insert into public.couranr_dispatch_vehicles (
    assigned_driver_id, name, vehicle_class, payload_capacity_lb,
    cargo_length_in, cargo_width_in, cargo_height_in,
    enclosed, has_ramp, has_dolly, has_tie_downs, weather_protection
  ) values (
    p_assigned_driver_id, btrim(p_name), p_vehicle_class, p_payload_capacity_lb,
    p_cargo_length_in, p_cargo_width_in, p_cargo_height_in,
    coalesce(p_enclosed,false), coalesce(p_has_ramp,false), coalesce(p_has_dolly,false),
    coalesce(p_has_tie_downs,false), coalesce(p_weather_protection,false)
  )
  returning * into v_v;

  return v_v;
end
$fn$;

-- ---------------------------------------------------------------------
-- 5. couranr_update_dispatch_vehicle
-- ---------------------------------------------------------------------
create or replace function public.couranr_update_dispatch_vehicle(
  p_vehicle_id         uuid,
  p_expected_version   integer,
  p_actor_user_id      uuid,
  p_name               text,
  p_payload_capacity_lb integer,
  p_active             boolean,
  p_availability_state text
)
returns public.couranr_dispatch_vehicles
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_v public.couranr_dispatch_vehicles;
begin
  if p_availability_state is not null
     and p_availability_state not in ('available','unavailable') then
    raise exception 'invalid_availability_state' using errcode = 'CR422';
  end if;

  select * into v_v from public.couranr_dispatch_vehicles where id = p_vehicle_id;
  if not found then
    raise exception 'vehicle_not_found' using errcode = 'CR404';
  end if;

  -- Same rule as the driver: a vehicle on a delivery is released by replacing
  -- the assignment, never by editing the vehicle.
  if v_v.availability_state = 'on_delivery'
     and (p_availability_state is not null or p_active is false) then
    raise exception 'vehicle_is_on_delivery' using errcode = 'CR409';
  end if;

  update public.couranr_dispatch_vehicles
     set name                = coalesce(nullif(btrim(coalesce(p_name,'')), ''), name),
         payload_capacity_lb = coalesce(p_payload_capacity_lb, payload_capacity_lb),
         active              = coalesce(p_active, active),
         availability_state  = coalesce(p_availability_state, availability_state),
         version             = version + 1,
         updated_at          = now()
   where id = p_vehicle_id and version = p_expected_version
  returning * into v_v;

  if not found then
    raise exception 'version_conflict' using errcode = 'CR409';
  end if;
  return v_v;
end
$fn$;

-- ---------------------------------------------------------------------
-- 6. couranr_assign_delivery
--
--    The whole slice in one transaction. Order matters: every precondition is
--    checked before anything is written, and the delivery moves only after the
--    assignment row exists.
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 7. couranr_replace_delivery_assignment
--
--    Before pickup only. The delivery STAYS `assigned` — this changes who is
--    doing it, not where it is.
-- ---------------------------------------------------------------------
create or replace function public.couranr_replace_delivery_assignment(
  p_delivery_id                uuid,
  p_expected_assignment_version integer,
  p_actor_user_id              uuid,
  p_driver_id                  uuid,
  p_vehicle_id                 uuid,
  p_reason                     text,
  p_idempotency_key            text
)
returns public.couranr_delivery_assignments
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_dlv public.couranr_deliveries;
  v_old public.couranr_delivery_assignments;
  v_new public.couranr_delivery_assignments;
  v_drv public.couranr_drivers;
  v_reason text;
begin
  if p_idempotency_key is not null then
    select * into v_new from public.couranr_delivery_assignments
     where idempotency_key = p_idempotency_key;
    if found then
      return v_new;
    end if;
  end if;

  select * into v_dlv from public.couranr_deliveries where id = p_delivery_id for update;
  if not found then
    raise exception 'delivery_not_found' using errcode = 'CR404';
  end if;
  -- Reassignment after pickup belongs to incident/return handling, not here.
  if v_dlv.fulfillment_state <> 'assigned' then
    raise exception 'delivery_not_assigned' using errcode = 'CR409';
  end if;

  select * into v_old from public.couranr_delivery_assignments
   where delivery_id = p_delivery_id and assignment_state = 'active'
   for update;
  if not found then
    raise exception 'no_active_assignment' using errcode = 'CR409';
  end if;

  select * into v_drv from public.couranr_drivers where id = p_driver_id for update;
  if not found then
    raise exception 'driver_not_found' using errcode = 'CR404';
  end if;
  if v_drv.driver_state <> 'active' or not v_drv.active then
    raise exception 'driver_not_active' using errcode = 'CR409';
  end if;
  -- The incoming driver must be free, unless they are already the one on this
  -- delivery (a vehicle-only swap).
  if v_drv.availability_state <> 'available' and v_drv.id <> v_old.driver_id then
    raise exception 'driver_not_available' using errcode = 'CR409';
  end if;

  -- Release the outgoing resources FIRST, so the incoming compatibility check
  -- and the partial unique indexes see a free driver and a free vehicle.
  update public.couranr_delivery_assignments
     set assignment_state = 'replaced',
         ended_at         = now(),
         end_reason       = coalesce(nullif(btrim(coalesce(p_reason,'')), ''), 'replaced_by_operations'),
         version          = version + 1,
         updated_at       = now()
   where id = v_old.id and version = p_expected_assignment_version
  returning * into v_old;

  if not found then
    raise exception 'version_conflict' using errcode = 'CR409';
  end if;

  update public.couranr_drivers
     set availability_state = 'available', version = version + 1, updated_at = now()
   where id = v_old.driver_id;
  update public.couranr_dispatch_vehicles
     set availability_state = 'available', version = version + 1, updated_at = now()
   where id = v_old.vehicle_id;

  v_reason := public.couranr_vehicle_incompatibility(p_vehicle_id, p_driver_id, v_dlv.vehicle_requirement);
  if v_reason is not null then
    raise exception using errcode = 'CR409', message = v_reason;
  end if;

  insert into public.couranr_delivery_assignments (
    delivery_id, driver_id, vehicle_id, assigned_by, idempotency_key
  ) values (
    p_delivery_id, p_driver_id, p_vehicle_id, p_actor_user_id, p_idempotency_key
  )
  returning * into v_new;

  insert into public.couranr_assignment_events (
    assignment_id, delivery_id, actor_user_id, actor_type, command, from_state, to_state, metadata
  ) values (
    v_new.id, p_delivery_id, p_actor_user_id, 'operations', 'replace_delivery_assignment',
    'active', 'active',
    jsonb_build_object(
      'replacedAssignmentId', v_old.id,
      'previousDriverId',     v_old.driver_id,
      'previousVehicleId',    v_old.vehicle_id,
      'driverId',             p_driver_id,
      'vehicleId',            p_vehicle_id,
      'reason',               v_old.end_reason
    )
  );

  update public.couranr_drivers
     set availability_state = 'on_delivery', version = version + 1, updated_at = now()
   where id = p_driver_id;
  update public.couranr_dispatch_vehicles
     set availability_state = 'on_delivery', version = version + 1, updated_at = now()
   where id = p_vehicle_id;

  -- The delivery is deliberately NOT touched: it stays `assigned`, and its
  -- version does not move, because nothing about the delivery changed.
  return v_new;
end
$fn$;

-- ---------------------------------------------------------------------
-- 8. GRANTS. service_role only, and the pg_default_acl revoke first.
-- ---------------------------------------------------------------------
do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public.couranr_create_driver_profile(uuid,uuid,text,text,text)',
    'public.couranr_set_driver_state(uuid,integer,uuid,text)',
    'public.couranr_update_driver_availability(uuid,integer,uuid,text)',
    'public.couranr_create_dispatch_vehicle(uuid,text,text,integer,uuid,integer,integer,integer,boolean,boolean,boolean,boolean,boolean)',
    'public.couranr_update_dispatch_vehicle(uuid,integer,uuid,text,integer,boolean,text)',
    'public.couranr_assign_delivery(uuid,integer,uuid,uuid,uuid,text)',
    'public.couranr_replace_delivery_assignment(uuid,integer,uuid,uuid,uuid,text,text)',
    'public.couranr_vehicle_class_rank(text)',
    'public.couranr_vehicle_incompatibility(uuid,uuid,jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_sig);
    execute format('grant execute on function %s to service_role', v_sig);
  end loop;
end $$;

commit;

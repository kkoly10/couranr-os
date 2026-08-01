-- =====================================================================
-- Correction: a driver transition must be a NAMED command, not a target the
-- caller passes in.
--
-- `couranr_set_driver_state(p_driver_state)` and
-- `couranr_update_driver_availability(p_availability_state)` — both added
-- minutes ago in this same unmerged slice — took the destination as an
-- argument and forwarded it to the UPDATE. That is precisely the shape this
-- codebase forbids: "no route should accept an arbitrary target status", and
-- `tests/couranr-server-only.test.ts` caught it on the first full run.
--
-- The readiness slice already established the right shape:
-- `couranr_apply_readiness` is reached through one command per destination and
-- each hard-codes where it lands, so there is no path by which a caller names
-- a state. Dispatch now matches it.
--
-- ADDITIVE in the sense that matters: no table, column or row is touched. The
-- two superseded FUNCTIONS are dropped because they were created in this branch,
-- have never been called by anything, and leaving a
-- pass-the-state-through command in the schema would leave exactly the hole
-- this migration exists to close.
-- =====================================================================

begin;

set local statement_timeout = '60s';
set local lock_timeout = '10s';

-- ---------------------------------------------------------------------
-- Shared guard. Each named command below calls this first, so the rule
-- "a driver on a delivery is released by replacing the assignment, never by
-- editing the driver" is written once.
-- ---------------------------------------------------------------------
create or replace function public.couranr_assert_driver_mutable(p_driver_id uuid)
returns public.couranr_drivers
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_d public.couranr_drivers;
begin
  select * into v_d from public.couranr_drivers where id = p_driver_id;
  if not found then
    raise exception 'driver_not_found' using errcode = 'CR404';
  end if;
  if v_d.availability_state = 'on_delivery' then
    raise exception 'driver_is_on_delivery' using errcode = 'CR409';
  end if;
  return v_d;
end
$fn$;

-- ---------------------------------------------------------------------
-- One command per destination. Each hard-codes its own landing state.
-- ---------------------------------------------------------------------
create or replace function public.couranr_activate_driver(
  p_driver_id uuid, p_expected_version integer, p_actor_user_id uuid
)
returns public.couranr_drivers
language plpgsql security invoker set search_path = ''
as $fn$
declare v_d public.couranr_drivers;
begin
  perform public.couranr_assert_driver_mutable(p_driver_id);
  update public.couranr_drivers
     set driver_state = 'active', active = true,
         version = version + 1, updated_at = now()
   where id = p_driver_id and version = p_expected_version
  returning * into v_d;
  if not found then raise exception 'version_conflict' using errcode = 'CR409'; end if;
  return v_d;
end $fn$;

create or replace function public.couranr_suspend_driver(
  p_driver_id uuid, p_expected_version integer, p_actor_user_id uuid
)
returns public.couranr_drivers
language plpgsql security invoker set search_path = ''
as $fn$
declare v_d public.couranr_drivers;
begin
  perform public.couranr_assert_driver_mutable(p_driver_id);
  update public.couranr_drivers
     set driver_state = 'suspended', active = false,
         availability_state = 'unavailable',
         version = version + 1, updated_at = now()
   where id = p_driver_id and version = p_expected_version
  returning * into v_d;
  if not found then raise exception 'version_conflict' using errcode = 'CR409'; end if;
  return v_d;
end $fn$;

create or replace function public.couranr_deactivate_driver(
  p_driver_id uuid, p_expected_version integer, p_actor_user_id uuid
)
returns public.couranr_drivers
language plpgsql security invoker set search_path = ''
as $fn$
declare v_d public.couranr_drivers;
begin
  perform public.couranr_assert_driver_mutable(p_driver_id);
  update public.couranr_drivers
     set driver_state = 'inactive', active = false,
         availability_state = 'unavailable',
         version = version + 1, updated_at = now()
   where id = p_driver_id and version = p_expected_version
  returning * into v_d;
  if not found then raise exception 'version_conflict' using errcode = 'CR409'; end if;
  return v_d;
end $fn$;

create or replace function public.couranr_mark_driver_available(
  p_driver_id uuid, p_expected_version integer, p_actor_user_id uuid
)
returns public.couranr_drivers
language plpgsql security invoker set search_path = ''
as $fn$
declare v_d public.couranr_drivers;
begin
  v_d := public.couranr_assert_driver_mutable(p_driver_id);
  -- Only an ACTIVE driver can go available; otherwise `available` would be a
  -- state the assignment command still refuses, which reads as a broken button.
  if v_d.driver_state <> 'active' then
    raise exception 'driver_not_active' using errcode = 'CR409';
  end if;
  update public.couranr_drivers
     set availability_state = 'available', version = version + 1, updated_at = now()
   where id = p_driver_id and version = p_expected_version
  returning * into v_d;
  if not found then raise exception 'version_conflict' using errcode = 'CR409'; end if;
  return v_d;
end $fn$;

create or replace function public.couranr_mark_driver_unavailable(
  p_driver_id uuid, p_expected_version integer, p_actor_user_id uuid
)
returns public.couranr_drivers
language plpgsql security invoker set search_path = ''
as $fn$
declare v_d public.couranr_drivers;
begin
  perform public.couranr_assert_driver_mutable(p_driver_id);
  update public.couranr_drivers
     set availability_state = 'unavailable', version = version + 1, updated_at = now()
   where id = p_driver_id and version = p_expected_version
  returning * into v_d;
  if not found then raise exception 'version_conflict' using errcode = 'CR409'; end if;
  return v_d;
end $fn$;

-- Same correction for the vehicle: `p_availability_state` was a pass-through.
create or replace function public.couranr_mark_vehicle_available(
  p_vehicle_id uuid, p_expected_version integer, p_actor_user_id uuid
)
returns public.couranr_dispatch_vehicles
language plpgsql security invoker set search_path = ''
as $fn$
declare v_v public.couranr_dispatch_vehicles;
begin
  select * into v_v from public.couranr_dispatch_vehicles where id = p_vehicle_id;
  if not found then raise exception 'vehicle_not_found' using errcode = 'CR404'; end if;
  if v_v.availability_state = 'on_delivery' then
    raise exception 'vehicle_is_on_delivery' using errcode = 'CR409';
  end if;
  update public.couranr_dispatch_vehicles
     set availability_state = 'available', active = true,
         version = version + 1, updated_at = now()
   where id = p_vehicle_id and version = p_expected_version
  returning * into v_v;
  if not found then raise exception 'version_conflict' using errcode = 'CR409'; end if;
  return v_v;
end $fn$;

create or replace function public.couranr_mark_vehicle_unavailable(
  p_vehicle_id uuid, p_expected_version integer, p_actor_user_id uuid
)
returns public.couranr_dispatch_vehicles
language plpgsql security invoker set search_path = ''
as $fn$
declare v_v public.couranr_dispatch_vehicles;
begin
  select * into v_v from public.couranr_dispatch_vehicles where id = p_vehicle_id;
  if not found then raise exception 'vehicle_not_found' using errcode = 'CR404'; end if;
  if v_v.availability_state = 'on_delivery' then
    raise exception 'vehicle_is_on_delivery' using errcode = 'CR409';
  end if;
  update public.couranr_dispatch_vehicles
     set availability_state = 'unavailable',
         version = version + 1, updated_at = now()
   where id = p_vehicle_id and version = p_expected_version
  returning * into v_v;
  if not found then raise exception 'version_conflict' using errcode = 'CR409'; end if;
  return v_v;
end $fn$;

-- Rename-in-place: the editor keeps only the fields that are DATA, never the
-- availability or the active flag, which now belong to the named commands.
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
language plpgsql security invoker set search_path = ''
as $fn$
declare v_v public.couranr_dispatch_vehicles;
begin
  -- The two state arguments are retained in the signature only so an older
  -- deployed caller cannot silently change meaning; they are REFUSED.
  if p_availability_state is not null or p_active is not null then
    raise exception 'state_is_not_editable_here' using errcode = 'CR422';
  end if;

  select * into v_v from public.couranr_dispatch_vehicles where id = p_vehicle_id;
  if not found then raise exception 'vehicle_not_found' using errcode = 'CR404'; end if;

  update public.couranr_dispatch_vehicles
     set name                = coalesce(nullif(btrim(coalesce(p_name,'')), ''), name),
         payload_capacity_lb = coalesce(p_payload_capacity_lb, payload_capacity_lb),
         version             = version + 1,
         updated_at          = now()
   where id = p_vehicle_id and version = p_expected_version
  returning * into v_v;
  if not found then raise exception 'version_conflict' using errcode = 'CR409'; end if;
  return v_v;
end $fn$;

-- ---------------------------------------------------------------------
-- Drop the two superseded pass-the-state-through commands. Created in this
-- branch, never called, and dangerous to leave reachable.
-- ---------------------------------------------------------------------
drop function if exists public.couranr_set_driver_state(uuid, integer, uuid, text);
drop function if exists public.couranr_update_driver_availability(uuid, integer, uuid, text);

-- ---------------------------------------------------------------------
-- Grants: service_role only, revoke first.
-- ---------------------------------------------------------------------
do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'public.couranr_assert_driver_mutable(uuid)',
    'public.couranr_activate_driver(uuid,integer,uuid)',
    'public.couranr_suspend_driver(uuid,integer,uuid)',
    'public.couranr_deactivate_driver(uuid,integer,uuid)',
    'public.couranr_mark_driver_available(uuid,integer,uuid)',
    'public.couranr_mark_driver_unavailable(uuid,integer,uuid)',
    'public.couranr_mark_vehicle_available(uuid,integer,uuid)',
    'public.couranr_mark_vehicle_unavailable(uuid,integer,uuid)',
    'public.couranr_update_dispatch_vehicle(uuid,integer,uuid,text,integer,boolean,text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_sig);
    execute format('grant execute on function %s to service_role', v_sig);
  end loop;
end $$;

commit;

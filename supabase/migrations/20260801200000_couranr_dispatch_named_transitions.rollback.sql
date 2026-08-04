-- Rollback for 20260801200000_couranr_dispatch_named_transitions.
--
-- Mixed: functions this migration CREATED are dropped, and functions it
-- REPLACED are restored verbatim to their previous definition.

begin;

-- couranr_update_dispatch_vehicle: restored from 20260801193000_couranr_dispatch_commands.sql
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

-- Dropped by catalog lookup rather than by a hardcoded signature: this handles
-- overloads and cannot drift from what was actually created.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname = any (array['couranr_assert_driver_mutable', 'couranr_activate_driver', 'couranr_suspend_driver', 'couranr_deactivate_driver', 'couranr_mark_driver_available', 'couranr_mark_driver_unavailable', 'couranr_mark_vehicle_available', 'couranr_mark_vehicle_unavailable'])
  loop
    -- No CASCADE. DROP FUNCTION ... CASCADE silently removes CHECK
    -- constraints and triggers that depend on the function; RESTRICT (the
    -- default) fails loudly instead, which is the same reason every table
    -- drop in these rollbacks is RESTRICT. The generator was inconsistent
    -- with itself here.
    execute 'drop function if exists ' || r.sig;
  end loop;
end $$;

commit;

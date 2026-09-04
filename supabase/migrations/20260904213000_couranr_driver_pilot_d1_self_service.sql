-- ============================================================================
-- Driver Pilot Readiness D1 — self-scoped availability and vehicle commands
--
-- Browser routes never accept a driver id. The authenticated user is the only
-- identity input and each command resolves that user's canonical driver row.
-- Driver lifecycle remains system-owned: nobody can set on_delivery here.
-- ============================================================================

begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

create or replace function public.couranr_set_my_driver_availability(
  p_actor_user_id uuid,
  p_expected_version integer,
  p_preference text
)
returns public.couranr_drivers
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_driver public.couranr_drivers;
begin
  if p_actor_user_id is null then
    raise exception 'actor_required' using errcode='CR403';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'version_required' using errcode='CR422';
  end if;
  if p_preference not in ('available','unavailable') then
    raise exception 'availability_preference_invalid' using errcode='CR422';
  end if;

  select * into v_driver
    from public.couranr_drivers
   where user_id=p_actor_user_id
   for update;

  if not found then
    raise exception 'driver_profile_not_found' using errcode='CR404';
  end if;

  if p_preference='available'
     and (v_driver.driver_state<>'active' or not v_driver.active) then
    raise exception 'driver_not_active' using errcode='CR409';
  end if;

  update public.couranr_drivers
     set availability_preference=p_preference,
         availability_state=case
           when availability_state='on_delivery' then 'on_delivery'
           else p_preference
         end,
         version=version+1,
         updated_at=now()
   where id=v_driver.id
     and version=p_expected_version
  returning * into v_driver;

  if not found then
    raise exception 'version_conflict' using errcode='CR409';
  end if;

  return v_driver;
end
$fn$;

create or replace function public.couranr_set_my_vehicle_availability(
  p_actor_user_id uuid,
  p_vehicle_id uuid,
  p_expected_version integer,
  p_availability text
)
returns public.couranr_dispatch_vehicles
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_driver public.couranr_drivers;
  v_vehicle public.couranr_dispatch_vehicles;
begin
  if p_actor_user_id is null then
    raise exception 'actor_required' using errcode='CR403';
  end if;
  if p_vehicle_id is null then
    raise exception 'vehicle_required' using errcode='CR422';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'version_required' using errcode='CR422';
  end if;
  if p_availability not in ('available','unavailable') then
    raise exception 'vehicle_availability_invalid' using errcode='CR422';
  end if;

  select * into v_driver
    from public.couranr_drivers
   where user_id=p_actor_user_id;
  if not found then
    raise exception 'driver_profile_not_found' using errcode='CR404';
  end if;

  select * into v_vehicle
    from public.couranr_dispatch_vehicles
   where id=p_vehicle_id
     and assigned_driver_id=v_driver.id
   for update;

  if not found then
    -- Same public result for a nonexistent vehicle and a vehicle belonging to
    -- another driver: never make this endpoint an ownership oracle.
    raise exception 'vehicle_not_found' using errcode='CR404';
  end if;
  if v_vehicle.availability_state='on_delivery' then
    raise exception 'vehicle_is_on_delivery' using errcode='CR409';
  end if;
  if p_availability='available' and not v_vehicle.active then
    raise exception 'vehicle_out_of_service' using errcode='CR409';
  end if;

  update public.couranr_dispatch_vehicles
     set availability_state=p_availability,
         version=version+1,
         updated_at=now()
   where id=v_vehicle.id
     and version=p_expected_version
     and availability_state<>'on_delivery'
  returning * into v_vehicle;

  if not found then
    raise exception 'version_conflict' using errcode='CR409';
  end if;

  return v_vehicle;
end
$fn$;

create or replace function public.couranr_update_my_vehicle_capabilities(
  p_actor_user_id uuid,
  p_vehicle_id uuid,
  p_expected_version integer,
  p_payload_capacity_lb integer,
  p_cargo_length_in integer,
  p_cargo_width_in integer,
  p_cargo_height_in integer,
  p_enclosed boolean,
  p_has_ramp boolean,
  p_has_dolly boolean,
  p_has_tie_downs boolean,
  p_weather_protection boolean
)
returns public.couranr_dispatch_vehicles
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_driver public.couranr_drivers;
  v_vehicle public.couranr_dispatch_vehicles;
begin
  if p_actor_user_id is null then
    raise exception 'actor_required' using errcode='CR403';
  end if;
  if p_vehicle_id is null then
    raise exception 'vehicle_required' using errcode='CR422';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'version_required' using errcode='CR422';
  end if;
  if p_payload_capacity_lb is null or p_payload_capacity_lb <= 0 then
    raise exception 'payload_capacity_invalid' using errcode='CR422';
  end if;
  if (p_cargo_length_in is not null and p_cargo_length_in <= 0)
     or (p_cargo_width_in is not null and p_cargo_width_in <= 0)
     or (p_cargo_height_in is not null and p_cargo_height_in <= 0) then
    raise exception 'cargo_dimensions_invalid' using errcode='CR422';
  end if;

  select * into v_driver
    from public.couranr_drivers
   where user_id=p_actor_user_id;
  if not found then
    raise exception 'driver_profile_not_found' using errcode='CR404';
  end if;

  select * into v_vehicle
    from public.couranr_dispatch_vehicles
   where id=p_vehicle_id
     and assigned_driver_id=v_driver.id
   for update;

  if not found then
    raise exception 'vehicle_not_found' using errcode='CR404';
  end if;
  if v_vehicle.availability_state='on_delivery' then
    raise exception 'vehicle_is_on_delivery' using errcode='CR409';
  end if;

  update public.couranr_dispatch_vehicles
     set payload_capacity_lb=p_payload_capacity_lb,
         cargo_length_in=p_cargo_length_in,
         cargo_width_in=p_cargo_width_in,
         cargo_height_in=p_cargo_height_in,
         enclosed=coalesce(p_enclosed,false),
         has_ramp=coalesce(p_has_ramp,false),
         has_dolly=coalesce(p_has_dolly,false),
         has_tie_downs=coalesce(p_has_tie_downs,false),
         weather_protection=coalesce(p_weather_protection,false),
         version=version+1,
         updated_at=now()
   where id=v_vehicle.id
     and version=p_expected_version
     and availability_state<>'on_delivery'
  returning * into v_vehicle;

  if not found then
    raise exception 'version_conflict' using errcode='CR409';
  end if;

  return v_vehicle;
end
$fn$;

do $grant$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public.couranr_set_my_driver_availability(uuid,integer,text)',
    'public.couranr_set_my_vehicle_availability(uuid,uuid,integer,text)',
    'public.couranr_update_my_vehicle_capabilities(uuid,uuid,integer,integer,integer,integer,integer,boolean,boolean,boolean,boolean,boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_sig);
    execute format('grant execute on function %s to service_role', v_sig);
  end loop;
end
$grant$;

commit;

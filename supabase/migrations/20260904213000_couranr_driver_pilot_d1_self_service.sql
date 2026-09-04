-- ============================================================================
-- Driver Pilot Readiness D1 — self-scoped availability command
--
-- Browser routes never accept a driver id. The authenticated user is the only
-- identity input and the command resolves that user's canonical driver row.
--
-- Vehicle capability and vehicle-availability writes are deliberately NOT part
-- of Driver self-service. Those facts feed dispatch safety/matching and remain
-- Couranr Operations authority until a reviewed proposal/verification workflow
-- exists.
--
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
    raise exception 'version_required' using errcode='CR400';
  end if;
  if p_preference not in ('available','unavailable') then
    raise exception 'availability_preference_invalid' using errcode='CR400';
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
    raise exception 'driver_not_active' using errcode='CR412';
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

revoke all on function public.couranr_set_my_driver_availability(uuid,integer,text)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_set_my_driver_availability(uuid,integer,text)
  to service_role;

commit;

-- Roll back the operational switches.
--
-- REFUSES ON EVIDENCE, and for a sharper reason than most: two of these four
-- switches ARE launch gates. Dropping them while Operations has thrown one
-- would silently restore the behaviour they were thrown to stop — a paused
-- intake would quietly reopen, or a paused AI would quietly resume. That is not
-- a rollback, it is an unlogged production change.
--
-- So it refuses if any switch is away from its FLG-001 launch default, or if
-- any switch event has ever been recorded.

begin;

do $$
declare
  v_thrown integer;
  v_events integer;
begin
  select count(*) into v_thrown from public.couranr_operational_switches
   where enabled is true;
  select count(*) into v_events from public.couranr_operational_switch_events;

  if v_thrown > 0 or v_events > 0 then
    raise exception using
      errcode = 'CR409',
      message = 'operational_switches_rollback_refused',
      detail = format('switches enabled: %s, recorded switch events: %s', v_thrown, v_events),
      hint = 'Operations has used these switches. Dropping them would silently '
             'restore the behaviour they were thrown to stop. Roll forward.';
  end if;
end $$;

drop trigger if exists couranr_dr_intake_pause on public.couranr_delivery_requests;
drop function if exists private.couranr_enforce_request_intake_pause() restrict;
drop function if exists public.couranr_set_operational_switch(text,boolean,uuid,text,integer) restrict;
drop function if exists private.couranr_switch_enabled(text) restrict;

drop index if exists public.couranr_ose_key_time_idx;
drop table if exists public.couranr_operational_switch_events restrict;
drop table if exists public.couranr_operational_switches restrict;

commit;

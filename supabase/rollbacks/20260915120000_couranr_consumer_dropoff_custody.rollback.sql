-- Drops the handoff custody check and the seal-condition command.
--
-- Safe unconditionally: functions and a trigger only. Every recorded
-- dropoff_condition survives on couranr_delivery_security_seals, which is owned
-- by 20260915090000 and whose own rollback refuses while that evidence exists.
--
-- `restrict` on purpose: a dependency is a fact to surface, not to cascade.

begin;

drop trigger if exists couranr_deliveries_consumer_dropoff_custody on public.couranr_deliveries;
drop function if exists private.couranr_enforce_consumer_dropoff_custody() restrict;
drop function if exists public.couranr_record_seal_condition(uuid,uuid,text) restrict;

commit;

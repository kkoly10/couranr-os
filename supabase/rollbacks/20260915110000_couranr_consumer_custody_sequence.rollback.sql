-- Drops the custody-sequence enforcement and the seal-recording command.
--
-- Safe unconditionally: this removes FUNCTIONS and a TRIGGER only. Every seal
-- row already recorded survives, and couranr_delivery_security_seals is owned
-- by 20260915090000, whose own rollback refuses while that evidence exists.
-- Nothing here destroys a record, so there is nothing to refuse over.
--
-- `restrict` on purpose: a dependency is a fact to surface, not to cascade.

begin;

drop trigger if exists couranr_deliveries_consumer_custody_sequence on public.couranr_deliveries;
drop function if exists private.couranr_enforce_consumer_custody_sequence() restrict;
drop function if exists public.couranr_record_delivery_seal(uuid,uuid,text,uuid) restrict;
drop function if exists private.couranr_delivery_protection_level(uuid) restrict;

commit;

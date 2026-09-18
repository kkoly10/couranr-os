-- Drops the trust-recording command.
--
-- Safe to run unconditionally, unlike the 20260915090000 rollback: this removes
-- only the FUNCTION. Every row it wrote keeps its declared value, protection
-- level and consent evidence, and the constraints that police those columns are
-- owned by 20260915090000 and are untouched here. Nothing is destroyed, so
-- there is no evidence to refuse over.
--
-- `restrict` on purpose: if anything has come to depend on this function, that
-- is a fact to surface rather than cascade through.

begin;

drop function if exists public.couranr_record_consumer_trust(uuid,integer,text,boolean,boolean) restrict;

commit;

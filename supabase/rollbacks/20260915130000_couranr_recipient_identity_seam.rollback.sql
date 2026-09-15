-- Drops the identity-recording command.
--
-- Safe unconditionally: one FUNCTION. Every recorded verification survives on
-- couranr_recipient_identity_verifications, which is owned by 20260915090000
-- and whose own rollback refuses while that evidence exists.
--
-- Note what this does NOT do: relax the drop-off trigger's protected-handoff
-- requirement, which lives in 20260915120000. Dropping this function without
-- that one leaves protected handoffs unable to record an attempt and therefore
-- unable to complete — roll both back together, or neither.

begin;

drop function if exists public.couranr_record_recipient_identity_verification(
  uuid,text,text,boolean,boolean,boolean,text) restrict;

commit;

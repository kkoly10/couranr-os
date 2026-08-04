-- Rollback for 20260801122000_couranr_obligation_generation_key.
--
-- Restores the PREVIOUS definition of each function this migration replaced.
-- Dropping them would remove behaviour an earlier migration created and that
-- live code still calls; the bodies below are copied verbatim from the
-- migration named against each one.

begin;

-- couranr_create_payment_obligation: restored from 20260731233000_couranr_payment_commands.sql
-- COULD NOT EXTRACT couranr_create_payment_obligation from supabase/migrations/20260731233000_couranr_payment_commands.sql — restore by hand.
revoke all on function public.couranr_create_payment_obligation(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_create_payment_obligation(uuid, uuid, text)
  to service_role;

commit;

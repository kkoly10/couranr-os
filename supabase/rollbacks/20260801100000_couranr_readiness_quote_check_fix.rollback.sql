-- Rollback for 20260801100000_couranr_readiness_quote_check_fix.
--
-- Restores the PREVIOUS definition of each function this migration replaced.
-- Dropping them would remove behaviour an earlier migration created and that
-- live code still calls; the bodies below are copied verbatim from the
-- migration named against each one.

begin;

-- couranr_apply_readiness: restored from 20260801090000_couranr_merchant_readiness.sql
-- COULD NOT EXTRACT couranr_apply_readiness from supabase/migrations/20260801090000_couranr_merchant_readiness.sql — restore by hand.
revoke all on function public.couranr_apply_readiness(uuid, uuid, integer, uuid, text, text, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_apply_readiness(uuid, uuid, integer, uuid, text, text, text[]) to service_role;

commit;

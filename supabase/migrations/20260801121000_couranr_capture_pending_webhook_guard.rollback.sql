-- Rollback for 20260801121000_couranr_capture_pending_webhook_guard.
--
-- Restores the PREVIOUS definition of each function this migration replaced.
-- Dropping them would remove behaviour an earlier migration created and that
-- live code still calls; the bodies below are copied verbatim from the
-- migration named against each one.

begin;

-- couranr_apply_payment_intent_state: restored from 20260731233000_couranr_payment_commands.sql
-- COULD NOT EXTRACT couranr_apply_payment_intent_state from supabase/migrations/20260731233000_couranr_payment_commands.sql — restore by hand.
revoke all on function public.couranr_apply_payment_intent_state(
  text, text, text, text, integer, integer, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.couranr_apply_payment_intent_state(
  text, text, text, text, integer, integer, text, jsonb
) to service_role;

commit;

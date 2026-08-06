-- =====================================================================
-- ROLLBACK for the payment command functions.
--
-- Drops only the six functions and the result type. Touches no table and no
-- row, so obligations, events and links survive — which is what makes this
-- safe to run on its own, unlike the table rollback.
--
-- After rolling back, the TypeScript payment layer must also be reverted, or
-- every payment call fails with an undefined-function error.
--
--   delete from supabase_migrations.schema_migrations where version = '20260731233000';
--   delete from supabase_migrations.schema_migrations where version = '20260731234500';
-- =====================================================================

begin;

set local statement_timeout = '60s';
set local lock_timeout = '10s';

drop function if exists public.couranr_revoke_payment_access_tokens(uuid, text);
drop function if exists public.couranr_redeem_payment_access_token(text);
drop function if exists public.couranr_issue_payment_access_token(uuid, uuid, text, integer);
drop function if exists public.couranr_apply_payment_intent_state(
  text, text, text, text, integer, integer, text, jsonb);
drop function if exists public.couranr_attach_payment_intent(uuid, integer, text);
drop function if exists public.couranr_create_payment_obligation(uuid, uuid, text);
drop type if exists public.couranr_payment_apply_result;

commit;

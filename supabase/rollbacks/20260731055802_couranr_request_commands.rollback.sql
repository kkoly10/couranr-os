-- =====================================================================
-- ROLLBACK for the atomic delivery-request command functions.
--
-- Drops ONLY the four functions this migration created, by full signature so
-- no same-named overload belonging to anything else can be caught.
--
-- Touches no table, no row, no policy and no grant on any existing object.
-- Running it where the migration was never applied is a no-op.
--
-- NO DATA LOSS: functions hold no state. Delivery requests and their events
-- are untouched. After rolling back, the TypeScript layer must also be
-- reverted to the pre-Commit-I two-call paths, or every command will fail
-- with an undefined-function error.
--
-- Rolling back also requires deleting the tracked history row, or the next
-- apply will believe the migration is already present:
--   delete from supabase_migrations.schema_migrations where version = '20260731055802';
-- =====================================================================

begin;

set local statement_timeout = '60s';
set local lock_timeout = '10s';

drop function if exists public.couranr_begin_delivery_request_review(
  uuid, uuid, integer, uuid
);

drop function if exists public.couranr_submit_delivery_request(
  uuid, uuid, integer, uuid, text, text, integer, integer, numeric, jsonb, jsonb
);

drop function if exists public.couranr_calculate_delivery_request_estimate(
  uuid, uuid, integer, uuid, boolean, text, text, text, text, text, text,
  numeric, numeric, integer, text, boolean, text, jsonb, jsonb, boolean, text,
  text, integer, integer, numeric, jsonb, jsonb
);

drop function if exists public.couranr_create_delivery_request_draft(
  uuid, uuid, text, text, text, text, text, text, text, numeric, numeric,
  integer, text, boolean, text, jsonb, jsonb, boolean, text, text, integer,
  integer, numeric, jsonb, jsonb
);

commit;

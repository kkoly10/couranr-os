-- ============================================================================
-- Rollback of 20260905081000_couranr_cvm_idempotency_nulls_not_distinct
--
-- Restores couranr_cvm_idempotency_uniq to its prior shape (20260804200000):
-- UNIQUE (conversation_id, author_participant_id, idempotency_key) with the
-- default NULLS DISTINCT. This reinstates the Operations null-author dedupe
-- hole; it exists only to reverse the forward migration.
-- ============================================================================

begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

drop index if exists public.couranr_cvm_idempotency_uniq;

create unique index if not exists couranr_cvm_idempotency_uniq
  on public.couranr_conversation_messages
     (conversation_id, author_participant_id, idempotency_key);

commit;

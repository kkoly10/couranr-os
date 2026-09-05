-- ============================================================================
-- Conversation message idempotency: enforce NULLS NOT DISTINCT
--
-- couranr_cvm_idempotency_uniq is UNIQUE (conversation_id, author_participant_id,
-- idempotency_key) with the default NULLS DISTINCT. Operations messages are
-- inserted with author_participant_id = NULL (author_user_id carries identity;
-- the key is namespaced ops:<userId>:<key>), so two concurrent identical
-- Operations sends do NOT collide on the index — both persist, defeating the
-- idempotency the check-then-act in sendOperationsMessage relies on as its
-- durable backstop.
--
-- Rebuild the index with NULLS NOT DISTINCT (PostgreSQL 15+) so NULL
-- author_participant_id values are treated as equal for uniqueness. This closes
-- the Operations hole and is a no-op for participant-authored rows, which carry
-- a non-null author_participant_id (NULLS NOT DISTINCT only changes how NULLs
-- compare). idempotency_key and conversation_id are NOT NULL, so the only null
-- column affected is author_participant_id — exactly the one we want to dedupe.
--
-- Additive: rebuilds an index only. A pre-flight guard refuses (rather than
-- failing with a raw 23505) if any null-author duplicate already exists, so a
-- production apply after live traffic gives a clear, actionable error.
-- ============================================================================

begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

do $guard$
begin
  if exists (
    select 1
      from public.couranr_conversation_messages
     group by conversation_id, author_participant_id, idempotency_key
    having count(*) > 1
  ) then
    raise exception 'refusing to rebuild couranr_cvm_idempotency_uniq NULLS NOT DISTINCT: duplicate (conversation_id, author_participant_id, idempotency_key) rows already exist; deduplicate them first';
  end if;
end
$guard$;

drop index if exists public.couranr_cvm_idempotency_uniq;

create unique index if not exists couranr_cvm_idempotency_uniq
  on public.couranr_conversation_messages
     (conversation_id, author_participant_id, idempotency_key)
  nulls not distinct;

comment on index public.couranr_cvm_idempotency_uniq is
  'Per-author idempotency. NULLS NOT DISTINCT so Operations rows (author_participant_id NULL, author_user_id set, key namespaced ops:<userId>:<key>) dedupe under concurrency. conversation_id and idempotency_key are NOT NULL, so only author_participant_id nulls are affected; participant-authored rows (non-null author_participant_id) are unchanged.';

commit;

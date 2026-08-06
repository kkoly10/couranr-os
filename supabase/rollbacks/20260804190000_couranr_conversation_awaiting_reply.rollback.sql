-- Rollback for the P8-002 awaiting-reply correction.
--
-- Dropping this column restores the defect it exists to fix: without it,
-- `stampDeadlines` cannot tell whether an Operations reply reaches the party
-- who is waiting, so a `couranr_internal` note stops the 15-minute clock
-- permanently and the thread leaves the overdue queue while the merchant is
-- still waiting.
--
-- The column is additive and carries no data any other table references, so
-- the drop cannot fail on a dependency. It DOES discard which party was
-- awaiting a reply on every open thread, and that cannot be reconstructed —
-- the information exists nowhere else.

begin;

alter table public.couranr_conversations
  drop constraint if exists couranr_cv_awaiting_reply_kind_chk;

alter table public.couranr_conversations
  drop column if exists awaiting_reply_kind;

commit;

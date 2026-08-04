-- Rollback for P8-001 conversations.
--
-- This DROPS four tables. If any conversation has been created, running this
-- destroys it and its audit trail. The forward migration is purely additive —
-- it creates new tables and touches no existing one — so there is no partial
-- state to unwind and no reason to run this except to abandon P8-001 entirely
-- before any real thread exists.
--
-- `restrict` rather than `cascade` is deliberate: if something outside this
-- migration has come to depend on these tables, the drop should fail loudly
-- rather than quietly remove the dependent object too.

begin;

drop trigger if exists couranr_cvm_enforce_visibility_trg
  on public.couranr_conversation_messages;
drop trigger if exists couranr_cvp_enforce_kind_trg
  on public.couranr_conversation_participants;

drop function if exists public.couranr_conversation_thread(uuid, uuid);
drop function if exists public.couranr_cvm_enforce_visibility();
drop function if exists public.couranr_cvp_enforce_kind();
drop function if exists public.couranr_cv_visibility_allowed(text, text);
drop function if exists public.couranr_cv_participant_kind_allowed(text, text);

-- Dropped in dependency order: events and messages both reference
-- participants and conversations.
drop table if exists public.couranr_conversation_events       restrict;
drop table if exists public.couranr_conversation_messages     restrict;
drop table if exists public.couranr_conversation_participants restrict;
drop table if exists public.couranr_conversations             restrict;

-- Dropped last: the audit CHECK on the events table referenced it.
drop function if exists public.couranr_jsonb_has_no_key(jsonb, text[]);

commit;

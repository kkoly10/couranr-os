-- Rollback for the P8-001 hardening.
--
-- Applying this reopens four defects: two trigger functions regain EXECUTE for
-- anon and authenticated; a departed participant can be reopened with its
-- original joined_at, widening a driver's read window; a message can be
-- attributed to a participant of a different conversation; and an audit row can
-- carry a message body under an allow-listed key, because the denylist it falls
-- back to inspects key names only.
--
-- The forward migration is additive. This exists for the pairing requirement.
--
-- Note the asymmetry: the EXECUTE grants are NOT restored. pg_default_acl
-- granted them in the first place, and deliberately re-granting EXECUTE on a
-- trigger function to a browser-reachable role is not something a rollback
-- should do on its own initiative.

begin;

alter table public.couranr_conversation_events
  drop constraint if exists couranr_cve_audit_shape_chk;
drop function if exists public.couranr_jsonb_audit_shape_ok(jsonb, text[], integer);

alter table public.couranr_conversation_messages
  drop constraint if exists couranr_cvm_author_in_conversation_fkey;
alter table public.couranr_conversation_participants
  drop constraint if exists couranr_cvp_id_conv_uniq;

drop trigger if exists couranr_cvp_tenure_monotone_trg
  on public.couranr_conversation_participants;
drop function if exists public.couranr_cvp_tenure_monotone();

commit;

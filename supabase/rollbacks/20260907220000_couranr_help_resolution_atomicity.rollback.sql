-- Paired rollback for 20260907220000_couranr_help_resolution_atomicity.sql.
--
-- Resolution-request evidence is immutable operational evidence. Refuse to
-- remove the command or narrow the audit allow-list once any such evidence
-- exists.

begin;

do $$
begin
  if exists (
    select 1
      from public.couranr_conversation_events
     where event_type = 'help_resolution_requested'
  ) then
    raise exception
      'rollback_refused: help_resolution_requested evidence exists';
  end if;
end
$$;

drop function if exists public.couranr_help_post_resolution_request(
  uuid, uuid, text, text, text, text, text
);

alter table public.couranr_conversation_events
  drop constraint if exists couranr_cve_audit_shape_chk;

alter table public.couranr_conversation_events
  add constraint couranr_cve_audit_shape_chk
  check (public.couranr_jsonb_audit_shape_ok(
    metadata,
    array[
      'topic', 'visibility', 'authorship', 'via', 'queued', 'reason',
      'message_id', 'participant_id', 'delivery_id', 'request_id',
      'from', 'to', 'previous_state', 'next_state', 'due_state'
    ],
    200
  ));

commit;

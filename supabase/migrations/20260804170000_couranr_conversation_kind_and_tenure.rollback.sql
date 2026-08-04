-- Rollback for the P8-001 kind-immutability and tenure corrections.
--
-- READ THIS BEFORE RUNNING IT. Applying this file reopens both defects the
-- forward migration closed, and the first is a privacy leak:
--
--   * `couranr_conversations.kind` becomes mutable again. One UPDATE flipping a
--     delivery_help thread to delivery_chat strands the customer participant,
--     after which a driver and a merchant insert cleanly and the reader hands
--     them the customer's messages. Reproduced end to end before the fix.
--   * the tenure window goes back to applying to EVERY participant kind, so
--     Operations escalated into an existing thread reads zero messages.
--
-- Restoring the 20260804150000 body of couranr_conversation_thread is what
-- reverts the second. The `create or replace` below is that original body,
-- copied verbatim.

begin;

drop trigger if exists couranr_cv_kind_immutable_trg on public.couranr_conversations;
drop function if exists public.couranr_cv_kind_immutable();

create or replace function public.couranr_conversation_thread(
  p_conversation_id uuid,
  p_viewer_user_id  uuid
) returns setof public.couranr_conversation_messages
language sql
stable
security definer
set search_path = ''
as $$
  select m.*
    from public.couranr_conversation_messages m
    join public.couranr_conversation_participants p
      on p.conversation_id = m.conversation_id
   where m.conversation_id = p_conversation_id
     and p.user_id         = p_viewer_user_id
     and p.left_at is null
     and m.authorship <> 'ai_draft'
     and m.created_at >= p.joined_at
     and (
          m.visibility = 'participants'
       or (m.visibility = 'couranr_internal'     and p.participant_kind = 'operations')
       or (m.visibility = 'driver_and_couranr'   and p.participant_kind in ('driver', 'operations'))
       or (m.visibility = 'merchant_and_couranr' and p.participant_kind in ('merchant', 'operations'))
     )
   order by m.created_at asc;
$$;

revoke all on function public.couranr_conversation_thread(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_conversation_thread(uuid, uuid) to service_role;

commit;

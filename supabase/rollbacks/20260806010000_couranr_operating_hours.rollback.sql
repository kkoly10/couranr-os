-- Rollback for 20260806010000_couranr_operating_hours.sql (HRS-002).
--
-- DATA LOSS: none. This migration created no table and no column. It added
-- five clock functions and rewrote one existing function's deadline
-- arithmetic. Rows already written keep their values — a conversation whose
-- `response_due_at` was computed in operating minutes keeps that instant, and
-- a `next_operating_period_at` already written keeps it too. Reverting changes
-- what FUTURE writes compute, never what past writes recorded.
--
-- RESTORING couranr_help_post_message. This drops the five clock functions
-- with RESTRICT, which would FAIL while `couranr_help_post_message` still
-- calls them. So the function is restored to its 20260804200000 body FIRST,
-- and only then are the clock functions dropped. Ordering is the whole content
-- of this file; getting it backwards produces a 2BP01 and a half-reverted
-- database.

begin;

-- 1. Restore couranr_help_post_message to its pre-HRS-002 body, byte-for-byte
--    from 20260804200000. The flat 15 wall-clock minutes return with it, which
--    is the behaviour this rollback exists to restore.
create or replace function public.couranr_help_post_message(
  p_token_id uuid, p_body text, p_topic text, p_idempotency_key text
) returns uuid
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_part public.couranr_conversation_participants;
  v_id   uuid;
begin
  if p_body is null or length(btrim(p_body)) = 0 or length(p_body) > 4000 then
    raise exception 'body_out_of_range' using errcode = 'CR400';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'idempotency_key_required' using errcode = 'CR400';
  end if;
  if p_topic is null or p_topic not in (
    'availability', 'access', 'address_concern', 'handoff_concern',
    'unrecognized_delivery', 'delivery_problem', 'other'
  ) then
    raise exception 'topic_not_recognized' using errcode = 'CR400';
  end if;

  select p.* into v_part from public.couranr_conversation_participants p
   where p.access_token_id = p_token_id and p.participant_kind = 'customer' and p.left_at is null;

  if v_part.id is null then
    raise exception 'help_link_not_available' using errcode = 'CR404';
  end if;

  select m.id into v_id from public.couranr_conversation_messages m
   where m.conversation_id       = v_part.conversation_id
     and m.author_participant_id = v_part.id
     and m.idempotency_key       = p_idempotency_key;
  if v_id is not null then return v_id; end if;

  insert into public.couranr_conversation_messages
    (conversation_id, author_participant_id, visibility, authorship, topic, body, idempotency_key)
  values
    (v_part.conversation_id, v_part.id, 'participants', 'human', p_topic, btrim(p_body), p_idempotency_key)
  returning id into v_id;

  insert into public.couranr_conversation_events
    (conversation_id, message_id, event_type, actor_kind, actor_user_id, metadata)
  values
    (v_part.conversation_id, v_id, 'message_sent', 'customer', null,
     jsonb_build_object('topic', p_topic, 'via', 'delivery_help'));

  update public.couranr_conversations c
     set received_at         = coalesce(c.received_at, now()),
         response_due_at     = coalesce(c.response_due_at, now() + interval '15 minutes'),
         waiting_on          = 'couranr',
         awaiting_reply_kind = coalesce(c.awaiting_reply_kind, 'customer'),
         status              = case when c.status in ('resolved', 'closed') then 'open' else c.status end,
         updated_at          = now()
   where c.id = v_part.conversation_id;

  return v_id;
end;
$fn$;

revoke all on function public.couranr_help_post_message(uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_help_post_message(uuid, text, text, text) to service_role;

-- 2. Now nothing references the clock functions, so RESTRICT can succeed.
--    RESTRICT, never CASCADE: a dependency here means something still calls
--    them, and that is a fact to surface rather than to drop silently.
drop function if exists public.couranr_operating_minutes_between(timestamptz, timestamptz) restrict;
drop function if exists public.couranr_add_operating_minutes(timestamptz, integer) restrict;
drop function if exists public.couranr_next_operating_period_start(timestamptz) restrict;
drop function if exists public.couranr_is_within_operating_hours(timestamptz) restrict;
drop function if exists public.couranr_operating_timezone() restrict;

comment on column public.couranr_conversations.next_operating_period_at is
  'Reserved for the next operating period. Not written: HRS-002 is unresolved.';

commit;

-- P8-002 correction: the response clock must only stop on a message the
-- waiting party can actually receive.
--
-- THE DEFECT, reproduced on a live cluster with an A/B and a control.
--
-- `stampDeadlines` took only `{conversationId, actorKind}`. The `visibility`
-- computed one screen earlier in `sendMessage` was never passed to it, so ANY
-- Operations message stamped `first_couranr_response_at` and forced
-- `due_state = 'on_time'` — including a `couranr_internal` note, which by
-- design reaches nobody at all.
--
-- `refreshDueStates` filters on `first_couranr_response_at is null`, so once
-- stamped a thread is excluded from recomputation FOREVER. The merchant is
-- still waiting and the thread has silently left the overdue queue.
--
-- The A/B: two identical threads aged 99 minutes past `received_at`, both
-- proven `overdue` by `refreshDueStates` moments before. Arm A got a
-- `participants` reply and the merchant saw it. Arm B got a `couranr_internal`
-- reply and the merchant saw NOTHING — yet both went to `on_time`, and a
-- re-run of `refreshDueStates` returned `{dueSoon: 0, overdue: 0}`.
--
-- Broader than a visibility bug: a `driver_and_couranr` reply in a
-- `delivery_chat` where the MERCHANT asked does the same thing.
--
-- The spec already legislates the principle for the analogous case —
-- "Automated acknowledgement does not count as Operations response" — and
-- `states.ts` carries a comment saying `automated` exists as a distinct
-- authorship value precisely so that rule can be applied at the row level. The
-- same distinction for visibility was never wired through.
--
--
-- WHY A COLUMN IS NEEDED.
--
-- Deciding whether a reply reaches the waiting party requires knowing WHO is
-- waiting. `waiting_on` cannot answer that: it stores the party who OWES a
-- reply — it reads `'couranr'` while a merchant waits — not the party owed one.
--
-- `awaiting_reply_kind` records the participant kind that asked, stamped at the
-- same moment as `received_at` and by the same write. It is nullable because a
-- thread with nothing outstanding has nobody waiting.

begin;

alter table public.couranr_conversations
  add column if not exists awaiting_reply_kind text;

alter table public.couranr_conversations
  drop constraint if exists couranr_cv_awaiting_reply_kind_chk;

alter table public.couranr_conversations
  add constraint couranr_cv_awaiting_reply_kind_chk
  check (
    awaiting_reply_kind is null
    or awaiting_reply_kind in ('merchant', 'driver', 'customer')
  );

comment on column public.couranr_conversations.awaiting_reply_kind is
  'The participant kind waiting for Couranr to reply, stamped with received_at. '
  'Distinct from waiting_on, which names the party who OWES a reply and reads '
  '"couranr" in exactly this situation. Used to decide whether an Operations '
  'message actually reaches the person waiting: an internal note stops no '
  'clock, for the same reason an automated acknowledgement does not. P8-002.';

-- `operations` is deliberately absent from the CHECK. Couranr never waits on
-- itself, and allowing it would let a thread be marked as awaiting a reply from
-- the party whose reply is being measured.

-- The customer write path stamps the same fields in SQL rather than in
-- TypeScript, so it needs the same column set or a Delivery Help thread would
-- record that someone is waiting without recording who — and every Operations
-- reply to it would then fail the deliverability check and never stop the
-- clock. Replaced whole rather than patched: `create or replace` is how the
-- rest of this sequence amends a function.
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
   where m.conversation_id = v_part.conversation_id and m.idempotency_key = p_idempotency_key;
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
         -- WHO is waiting, so an Operations reply can be checked for
         -- deliverability. Without it every reply to a Delivery Help thread
         -- would fail that check and the clock would never stop.
         awaiting_reply_kind = coalesce(c.awaiting_reply_kind, 'customer'),
         updated_at          = now()
   where c.id = v_part.conversation_id;

  return v_id;
end;
$fn$;

revoke all on function public.couranr_help_post_message(uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_help_post_message(uuid, text, text, text) to service_role;

commit;

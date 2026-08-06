-- Rollback for the P8-004 hardening.
--
-- Applying this reopens four defects, one of which loses customer messages:
--
--   * the idempotency lookup goes back to matching on (conversation, key)
--     alone, so a customer key colliding with an Operations internal note
--     returns that note's id and the customer's message is never written —
--     while they are told it sent;
--   * concurrent first use of a link raises an unhandled 23505 and the
--     customer sees HTTP 500 on a valid link;
--   * duplicate customer participants become possible again, which makes
--     `select p.* into v_part` raise and duplicates every message in the
--     thread read;
--   * a resolved or closed thread stops reopening on a customer reply.
--
-- Restoring the previous function bodies verbatim from
-- 20260804190000_couranr_conversation_awaiting_reply, which is where they were
-- last defined.

begin;

drop index if exists public.couranr_cvp_live_token_uniq;

-- couranr_redeem_help_token: restored to the SELECT-then-INSERT form from
-- 20260804160000, which is where it was last defined before this migration.
create or replace function public.couranr_redeem_help_token(p_token_hash text)
returns table (out_token_id uuid, out_delivery_id uuid, out_conversation_id uuid)
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_tok  public.couranr_help_access_tokens;
  v_conv uuid;
  v_part uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'token_hash_must_be_sha256_hex' using errcode = 'CR400';
  end if;

  select t.* into v_tok from public.couranr_help_access_tokens t
   where t.token_hash = p_token_hash;

  if v_tok.id is null or v_tok.revoked_at is not null or v_tok.expires_at <= now() then
    raise exception 'help_link_not_available' using errcode = 'CR404';
  end if;

  select c.id into v_conv from public.couranr_conversations c
   where c.delivery_id = v_tok.delivery_id and c.kind = 'delivery_help';

  if v_conv is null then
    insert into public.couranr_conversations (kind, business_account_id, delivery_id, status)
    values ('delivery_help', v_tok.business_account_id, v_tok.delivery_id, 'open')
    returning id into v_conv;
  end if;

  select p.id into v_part from public.couranr_conversation_participants p
   where p.conversation_id = v_conv and p.access_token_id = v_tok.id and p.left_at is null;

  if v_part is null then
    insert into public.couranr_conversation_participants
      (conversation_id, participant_kind, user_id, access_token_id)
    values (v_conv, 'customer', null, v_tok.id);
  end if;

  update public.couranr_help_access_tokens set last_used_at = now() where id = v_tok.id;
  return query select v_tok.id, v_tok.delivery_id, v_conv;
end;
$fn$;

-- couranr_help_post_message: restored verbatim from
-- 20260804190000_couranr_conversation_awaiting_reply.
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
         awaiting_reply_kind = coalesce(c.awaiting_reply_kind, 'customer'),
         updated_at          = now()
   where c.id = v_part.conversation_id;

  return v_id;
end;
$fn$;

commit;

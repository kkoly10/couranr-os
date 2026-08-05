-- P8-004 hardening. Five defects from the adversarial verification whose
-- judges died on a rate limit and which were judged by inspection instead.
-- Each is stated with the exact mechanism rather than a summary.
--
--
-- 1. A COLLIDING IDEMPOTENCY KEY RETURNS ANOTHER MESSAGE AND DISCARDS THE
--    CUSTOMER'S.
--
-- The replay lookup matched on `(conversation_id, idempotency_key)` only —
-- never on WHO is replaying. The key is caller-supplied from the browser, and a
-- `delivery_help` thread admits `couranr_internal` (couranr_cv_visibility_
-- allowed), so an Operations internal note lives in the same conversation and
-- is matched by the same lookup.
--
-- Consequence: a customer whose key collides with an internal note receives a
-- 201 carrying THAT NOTE'S ID, and their own message is never written. They are
-- told it sent. It did not.
--
-- Fixed by scoping the lookup to the author's own participant row. A replay is
-- "this participant sending this key again", which is what idempotency means.
--
--
-- 2. CONCURRENT FIRST USE OF A LINK RAISES AN UNHANDLED 23505.
--
-- `couranr_redeem_help_token` did SELECT-then-INSERT on both the conversation
-- and the participant with no conflict handling, while
-- `couranr_cv_one_thread_per_delivery_kind` enforces one thread per
-- (delivery, kind). Two requests arriving together — a customer double-tapping
-- a link, or a prefetch racing the click — meant one INSERT raised 23505,
-- which no handler caught, which `classifyDatabaseError` maps to `internal`,
-- which is HTTP 500. A perfectly valid link failed with a server error.
--
--
-- 3. DUPLICATE CUSTOMER PARTICIPANTS WERE POSSIBLE.
--
-- `couranr_cvp_live_user_uniq` is `(conversation_id, user_id) WHERE left_at IS
-- NULL AND user_id IS NOT NULL`. A customer participant has `user_id IS NULL`
-- by construction — the identity CHECK requires it — so the index excluded
-- exactly the rows that needed protecting.
--
-- Two rows would then make `select p.* into v_part` raise
-- "query returned more than one row", and `couranr_help_thread`'s join would
-- return every message twice.
--
--
-- 4. A RESOLVED OR CLOSED THREAD STILL ACCEPTED MESSAGES.
--
-- `couranr_help_post_message` never read `status`. Closing a conversation did
-- nothing to it.
--
-- Deliberately NOT a refusal: a customer replying to a thread Couranr closed
-- has something to say, and losing it is worse than reopening. The thread
-- REOPENS instead, which is also what makes the response clock start again.
--
--
-- 5. NOTHING EVER ISSUED A HELP TOKEN — see the route added alongside this
--    migration. Not fixable in SQL; `couranr_issue_help_token` already existed
--    and simply had no caller.

begin;

-- ── 3. one live customer participant per token ──────────────────────────────
--
-- Partial on `access_token_id IS NOT NULL`, which is exactly the customer case:
-- the identity CHECK gives an account-holding participant a NULL token and a
-- customer a NULL user. Together with the existing user index, every
-- participant kind is now covered by one or the other.
create unique index if not exists couranr_cvp_live_token_uniq
  on public.couranr_conversation_participants (conversation_id, access_token_id)
  where left_at is null and access_token_id is not null;

-- ── 2. redemption survives a race ───────────────────────────────────────────
create or replace function public.couranr_redeem_help_token(
  p_token_hash text
) returns table (
  out_token_id       uuid,
  out_delivery_id    uuid,
  out_conversation_id uuid
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tok  public.couranr_help_access_tokens;
  v_conv uuid;
  v_part uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'token_hash_must_be_sha256_hex' using errcode = 'CR400';
  end if;

  select t.* into v_tok
    from public.couranr_help_access_tokens t
   where t.token_hash = p_token_hash;

  -- ONE refusal for unknown, revoked and expired. Three answers would tell a
  -- holder which kind of bad their link is, and "revoked" confirms it existed.
  if v_tok.id is null
     or v_tok.revoked_at is not null
     or v_tok.expires_at <= now() then
    raise exception 'help_link_not_available' using errcode = 'CR404';
  end if;

  -- INSERT-then-reselect rather than SELECT-then-insert. `on conflict do
  -- nothing` makes the loser of a race a no-op instead of a 23505, and the
  -- unconditional select afterwards means both racers return the same row.
  insert into public.couranr_conversations (kind, business_account_id, delivery_id, status)
  values ('delivery_help', v_tok.business_account_id, v_tok.delivery_id, 'open')
  on conflict (delivery_id, kind) where delivery_id is not null do nothing;

  select c.id into v_conv
    from public.couranr_conversations c
   where c.delivery_id = v_tok.delivery_id
     and c.kind = 'delivery_help';

  if v_conv is null then
    -- Only reachable if the row vanished between the insert and the read.
    raise exception 'help_link_not_available' using errcode = 'CR404';
  end if;

  insert into public.couranr_conversation_participants
    (conversation_id, participant_kind, user_id, access_token_id)
  values (v_conv, 'customer', null, v_tok.id)
  on conflict (conversation_id, access_token_id) where left_at is null and access_token_id is not null
  do nothing;

  select p.id into v_part
    from public.couranr_conversation_participants p
   where p.conversation_id = v_conv
     and p.access_token_id = v_tok.id
     and p.left_at is null;

  if v_part is null then
    raise exception 'help_link_not_available' using errcode = 'CR404';
  end if;

  update public.couranr_help_access_tokens
     set last_used_at = now()
   where id = v_tok.id;

  return query select v_tok.id, v_tok.delivery_id, v_conv;
end;
$fn$;

revoke all on function public.couranr_redeem_help_token(text)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_redeem_help_token(text) to service_role;

-- ── 1 and 4. author-scoped idempotency, and reopening a closed thread ───────
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

  -- SCOPED TO THIS AUTHOR. Matching on (conversation, key) alone meant a
  -- customer key colliding with an Operations internal note returned that
  -- note's id and silently dropped the customer's message.
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

  -- A customer message REOPENS a resolved or closed thread rather than being
  -- refused. Someone replying to a closed thread has something to say, and
  -- losing it is worse than reopening; reopening is also what restarts the
  -- response clock, which a refusal would leave stopped.
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

commit;

-- ── 1 (continued). idempotency is PER AUTHOR, so the constraint must be too ──
--
-- Scoping the lookup to the author fixed the id-theft but exposed the other
-- half of the same mistake: `couranr_cvm_idempotency_uniq` was
-- `(conversation_id, idempotency_key)`, table-wide. So a customer key that
-- collides with an Operations note no longer returns the wrong id — it raises
-- 23505 instead, which `classifyDatabaseError` maps to `internal`, which is
-- HTTP 500. The customer's valid message still fails, just differently.
--
-- Verified by running it: with only the lookup fixed, the insert failed with
-- 'duplicate key value violates unique constraint "couranr_cvm_idempotency_uniq"'.
--
-- A replay is "this author sending this key again". Two different participants
-- choosing the same random key is a coincidence, not a duplicate, and the
-- constraint now says so. The lookup above and this index are the same rule
-- expressed twice, which is why they must agree.
begin;

alter table public.couranr_conversation_messages
  drop constraint if exists couranr_cvm_idempotency_uniq;

create unique index if not exists couranr_cvm_idempotency_uniq
  on public.couranr_conversation_messages
     (conversation_id, author_participant_id, idempotency_key);

commit;

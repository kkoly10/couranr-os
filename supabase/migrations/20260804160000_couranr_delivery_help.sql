-- P8-004 — secure Delivery Help.
--
-- Acceptance criterion, verbatim from
-- couranr_claude_code_package/08_WORK_BREAKDOWN.csv: "One-delivery token scope
-- passes". Dependencies: P8-001 (this builds on the conversation schema) and
-- P2-003 (idempotency and audit, whose message half landed with P8-001).
--
-- Authority, verbatim: "Customer Delivery Help is limited by one signed token
-- and one delivery. Customer may report availability, access, address concern,
-- handoff concern, unrecognized delivery, delivery problem, or other. A message
-- never directly mutates address, price, payer, cancellation, return, proof, or
-- state."
--
--
-- WHY A SECOND TOKEN TABLE RATHER THAN WIDENING THE FIRST
--
-- `couranr_delivery_access_tokens` already exists and already points a customer
-- at one delivery. Reusing it was the obvious move and is the wrong one: that
-- table's own comment says it is "read-only: redeeming one grants a sanitized
-- status projection and the right to request a short-lived signed proof URL,
-- never the ability to change anything." Adding a `purpose` column that
-- sometimes makes it a write credential would falsify a comment that is doing
-- real work, and would mean every existing tracking link is one column default
-- away from being able to post.
--
-- A tracking link is also a DIFFERENT ARTEFACT with a different lifetime. It is
-- sent with the delivery, it may be forwarded, and it rotates. A Delivery Help
-- credential should not inherit "may be forwarded" from it.
--
-- So: a separate table, a separate hash, a separate expiry, and a scope of
-- exactly one delivery.
--
--
-- WHAT THE TOKEN CAN DO. Two things, both mediated by SECURITY DEFINER
-- functions that no browser-reachable role may execute:
--   * read the ONE Delivery Help thread for its delivery, already filtered by
--     the P8-001 visibility rule;
--   * post a message into that thread, with a topic from the seven.
-- It cannot read any other conversation, reach a delivery_chat, see an internal
-- note, or write to any table outside the conversation set.

begin;

create table if not exists public.couranr_help_access_tokens (
  id uuid primary key default gen_random_uuid(),

  -- ONE DELIVERY. The cardinality the spec states, as a column.
  delivery_id uuid not null references public.couranr_deliveries(id),

  -- Carried so a read can be tenant-scoped without joining back through the
  -- delivery, matching the shipped tracking token's shape.
  business_account_id uuid not null references public.business_accounts(id),

  -- SHA-256 hex of the raw token. The raw value is returned once at creation
  -- and never persisted — same discipline as couranr_delivery_access_tokens.
  token_hash text not null,

  issued_at   timestamptz not null default now(),
  expires_at  timestamptz not null,
  last_used_at timestamptz,
  revoked_at  timestamptz,

  constraint couranr_hat_hash_uniq unique (token_hash),
  constraint couranr_hat_hash_shape_chk check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint couranr_hat_expiry_chk check (expires_at > issued_at)
);

create index if not exists couranr_hat_delivery_idx
  on public.couranr_help_access_tokens (delivery_id)
  where revoked_at is null;

comment on table public.couranr_help_access_tokens is
  'Delivery Help credentials. Stores a SHA-256 hash only; the raw token is '
  'returned once at creation and never persisted. Scoped to exactly one '
  'delivery. Unlike couranr_delivery_access_tokens this DOES authorize a write '
  '— but only one: appending a message to that delivery''s Delivery Help '
  'thread. It cannot change an address, a price, a payer, a cancellation, a '
  'refund, a return, proof or state. P8-004.';

-- ------------------------------------------------------------- redemption
--
-- Resolves a token hash to its delivery and its Delivery Help conversation,
-- creating the conversation and the customer participant on first use.
--
-- Lazily created rather than provisioned with the delivery because most
-- deliveries never need support, and an empty thread per delivery would be 29
-- rows of nothing today and a row per delivery forever.
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
as $$
declare
  v_tok  public.couranr_help_access_tokens;
  v_conv uuid;
  v_part uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    -- Caller input, so CR400. CR422 maps to `internal` -> HTTP 500 in
    -- lib/couranr/errors.ts, which would report a bad link as our fault.
    raise exception 'token_hash_must_be_sha256_hex' using errcode = 'CR400';
  end if;

  select t.* into v_tok
    from public.couranr_help_access_tokens t
   where t.token_hash = p_token_hash;

  -- ONE refusal for every reason a link does not work: unknown, revoked or
  -- expired. Three different answers would tell a holder of a bad link which
  -- kind of bad it is, and "revoked" confirms it once existed.
  if v_tok.id is null
     or v_tok.revoked_at is not null
     or v_tok.expires_at <= now() then
    raise exception 'help_link_not_available' using errcode = 'CR404';
  end if;

  select c.id into v_conv
    from public.couranr_conversations c
   where c.delivery_id = v_tok.delivery_id
     and c.kind = 'delivery_help';

  if v_conv is null then
    insert into public.couranr_conversations (kind, business_account_id, delivery_id, status)
    values ('delivery_help', v_tok.business_account_id, v_tok.delivery_id, 'open')
    returning id into v_conv;
  end if;

  -- The customer participant. `user_id` is null and `access_token_id` points at
  -- this token, which is what couranr_cvp_identity_chk requires of a customer.
  select p.id into v_part
    from public.couranr_conversation_participants p
   where p.conversation_id = v_conv
     and p.access_token_id = v_tok.id
     and p.left_at is null;

  if v_part is null then
    insert into public.couranr_conversation_participants
      (conversation_id, participant_kind, user_id, access_token_id)
    values (v_conv, 'customer', null, v_tok.id);
  end if;

  update public.couranr_help_access_tokens
     set last_used_at = now()
   where id = v_tok.id;

  return query select v_tok.id, v_tok.delivery_id, v_conv;
end;
$$;

revoke all on function public.couranr_redeem_help_token(text)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_redeem_help_token(text) to service_role;

-- ------------------------------------------------------------ the reader
--
-- The customer's view of their own thread.
--
-- A SEPARATE function from couranr_conversation_thread because a customer has
-- no `user_id` — they are a token, not an account — so that function's
-- `p.user_id = p_viewer_user_id` predicate can never match for them. Writing
-- one function that took "a user id OR a token id" would mean a NULL user id
-- matching a customer row, which is exactly the kind of predicate that leaks.
--
-- The visibility rule is applied again here rather than delegated, and it is
-- deliberately the NARROWEST case: a customer sees `participants` only. Not
-- `couranr_internal`, and there is no `driver_and_couranr` or
-- `merchant_and_couranr` in a delivery_help thread because
-- couranr_cv_visibility_allowed refuses them at write time.
create or replace function public.couranr_help_thread(
  p_token_id uuid
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
   where p.access_token_id  = p_token_id
     and p.participant_kind = 'customer'
     and p.left_at is null
     and m.authorship <> 'ai_draft'
     -- NOT windowed by joined_at. A Delivery Help token rotates, and a new
     -- token means a new participant row with a later joined_at — windowing
     -- here would hide the customer's OWN earlier messages from them the moment
     -- their link was reissued. The scope is the thread, which is already one
     -- delivery.
     and m.visibility  = 'participants'
   order by m.created_at asc;
$$;

revoke all on function public.couranr_help_thread(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_help_thread(uuid) to service_role;

comment on function public.couranr_help_thread(uuid) is
  'The customer''s view of one Delivery Help thread, scoped by token id. '
  'Returns `participants` messages only — never an internal note, never an AI '
  'draft. Separate from couranr_conversation_thread because a customer has no '
  'user id. P8-004.';

-- -------------------------------------------------------------- the write
--
-- Appending a message as the token holder.
--
-- A FUNCTION rather than an INSERT from the application, because the
-- participant row has to be resolved from the token and the two must not be
-- allowed to drift apart. The route never learns the participant id.
create or replace function public.couranr_help_post_message(
  p_token_id        uuid,
  p_body            text,
  p_topic           text,
  p_idempotency_key text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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

  -- The seven topics. A customer message MUST carry one: the topic is what
  -- routes it in the Operations Inbox, and "other" exists so there is always a
  -- valid answer.
  if p_topic is null or p_topic not in (
    'availability', 'access', 'address_concern', 'handoff_concern',
    'unrecognized_delivery', 'delivery_problem', 'other'
  ) then
    raise exception 'topic_not_recognized' using errcode = 'CR400';
  end if;

  select p.* into v_part
    from public.couranr_conversation_participants p
   where p.access_token_id  = p_token_id
     and p.participant_kind = 'customer'
     and p.left_at is null;

  if v_part.id is null then
    raise exception 'help_link_not_available' using errcode = 'CR404';
  end if;

  -- Idempotent by the same scoped UNIQUE the rest of the system uses. A replay
  -- returns the original id rather than raising, so a customer double-tapping
  -- Send on a bad connection does not post twice.
  select m.id into v_id
    from public.couranr_conversation_messages m
   where m.conversation_id = v_part.conversation_id
     and m.idempotency_key = p_idempotency_key;

  if v_id is not null then
    return v_id;
  end if;

  -- `participants` visibility, always. A customer cannot address a message to
  -- Couranr internally, and delivery_help admits no other value anyway.
  insert into public.couranr_conversation_messages
    (conversation_id, author_participant_id, visibility, authorship, topic, body, idempotency_key)
  values
    (v_part.conversation_id, v_part.id, 'participants', 'human', p_topic, btrim(p_body), p_idempotency_key)
  returning id into v_id;

  -- Audit. Records the topic and that a customer acted, never the words.
  insert into public.couranr_conversation_events
    (conversation_id, message_id, event_type, actor_kind, actor_user_id, metadata)
  values
    (v_part.conversation_id, v_id, 'message_sent', 'customer', null,
     jsonb_build_object('topic', p_topic, 'via', 'delivery_help'));

  -- Deadline bookkeeping: the customer is now waiting on Couranr. Only the two
  -- timezone-free fields are written; next_operating_period_at stays null while
  -- HRS-002 is unresolved.
  update public.couranr_conversations c
     set received_at     = coalesce(c.received_at, now()),
         response_due_at = coalesce(c.response_due_at, now() + interval '15 minutes'),
         waiting_on      = 'couranr',
         updated_at      = now()
   where c.id = v_part.conversation_id;

  return v_id;
end;
$$;

revoke all on function public.couranr_help_post_message(uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_help_post_message(uuid, text, text, text) to service_role;

-- ------------------------------------------------------------- issuance

create or replace function public.couranr_issue_help_token(
  p_delivery_id uuid,
  p_token_hash  text,
  p_ttl_days    integer default 14
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid;
  v_id uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'token_hash_must_be_sha256_hex' using errcode = 'CR400';
  end if;

  select d.business_account_id into v_business
    from public.couranr_deliveries d
   where d.id = p_delivery_id;

  if v_business is null then
    raise exception 'delivery_not_found' using errcode = 'CR404';
  end if;

  insert into public.couranr_help_access_tokens
    (delivery_id, business_account_id, token_hash, expires_at)
  values
    (p_delivery_id, v_business, p_token_hash, now() + make_interval(days => greatest(1, p_ttl_days)))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.couranr_issue_help_token(uuid, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_issue_help_token(uuid, text, integer) to service_role;

-- The token table itself follows the conversation tables: no browser-reachable
-- role touches it, and pg_default_acl would otherwise have granted everything.
alter table public.couranr_help_access_tokens enable row level security;
revoke all on public.couranr_help_access_tokens from public, anon, authenticated, service_role;
grant select, insert, update on public.couranr_help_access_tokens to service_role;

commit;

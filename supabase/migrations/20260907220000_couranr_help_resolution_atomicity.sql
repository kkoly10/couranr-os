-- CUS-002 post-merge hardening.
--
-- Two defects were found by the post-merge adversarial review of PR #69:
-- 1) the application read fulfillment_state and only later appended the review
--    request, so a driver transition could commit between those operations;
-- 2) a lost HTTP response followed by a lifecycle transition made an
--    idempotent retry fail before the existing request could be rediscovered.
--
-- This migration makes "is a NEW resolution request allowed?" and the message
-- insert one PostgreSQL transaction. Existing idempotency keys are resolved
-- before lifecycle eligibility, and the delivery row is locked before a new
-- request is accepted. Browser input still cannot author lifecycle state,
-- pricing, payer, custody, cancellation, return or refund facts.

begin;

-- Resolution-request evidence stores only short machine facts. Extend the
-- existing audit allow-list rather than putting semantic data in a misleading
-- pre-existing key.
alter table public.couranr_conversation_events
  drop constraint if exists couranr_cve_audit_shape_chk;

alter table public.couranr_conversation_events
  add constraint couranr_cve_audit_shape_chk
  check (public.couranr_jsonb_audit_shape_ok(
    metadata,
    array[
      'topic', 'visibility', 'authorship', 'via', 'queued', 'reason',
      'message_id', 'participant_id', 'delivery_id', 'request_id',
      'from', 'to', 'previous_state', 'next_state', 'due_state',
      'request_kind', 'fulfillment_state'
    ],
    200
  ));

create or replace function public.couranr_help_post_resolution_request(
  p_token_id                    uuid,
  p_delivery_id                 uuid,
  p_expected_fulfillment_state  text,
  p_request_kind                text,
  p_body                        text,
  p_topic                       text,
  p_idempotency_key             text
) returns table (
  out_message_id   uuid,
  out_request_kind text
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_part   public.couranr_conversation_participants;
  v_id     uuid;
  v_kind   text;
  v_state  text;
begin
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'idempotency_key_required' using errcode = 'CR400';
  end if;

  -- Resolve the token-scoped customer participant and bind it to this exact
  -- delivery_help conversation. The browser never supplies participant or
  -- conversation identity.
  select p.* into v_part
    from public.couranr_conversation_participants p
    join public.couranr_conversations c on c.id = p.conversation_id
   where p.access_token_id = p_token_id
     and p.participant_kind = 'customer'
     and p.left_at is null
     and c.kind = 'delivery_help'
     and c.delivery_id = p_delivery_id;

  if v_part.id is null then
    raise exception 'help_link_not_available' using errcode = 'CR404';
  end if;

  -- LOST-RESPONSE RULE: resolve an existing request BEFORE looking at current
  -- lifecycle eligibility. A retry remains successful even if the delivery
  -- advanced after the first commit.
  select m.id into v_id
    from public.couranr_conversation_messages m
   where m.conversation_id = v_part.conversation_id
     and m.author_participant_id = v_part.id
     and m.idempotency_key = p_idempotency_key;

  if v_id is not null then
    select e.metadata ->> 'request_kind' into v_kind
      from public.couranr_conversation_events e
     where e.message_id = v_id
       and e.event_type = 'help_resolution_requested'
     order by e.created_at asc
     limit 1;

    if v_kind is null then
      -- Same key belongs to a generic Help message, not this command.
      raise exception 'idempotency_key_already_used' using errcode = 'CR409';
    end if;

    return query select v_id, v_kind;
    return;
  end if;

  -- The row lock is the atomicity boundary. Every lifecycle transition updates
  -- this delivery row, so a competing transition must finish before this read
  -- or wait until this request commits.
  select d.fulfillment_state into v_state
    from public.couranr_deliveries d
   where d.id = p_delivery_id
   for update;

  if v_state is null then
    raise exception 'delivery_not_found' using errcode = 'CR404';
  end if;

  -- Re-check idempotency AFTER acquiring the row lock. A concurrent first
  -- attempt may have committed while this transaction was waiting.
  select m.id into v_id
    from public.couranr_conversation_messages m
   where m.conversation_id = v_part.conversation_id
     and m.author_participant_id = v_part.id
     and m.idempotency_key = p_idempotency_key;

  if v_id is not null then
    select e.metadata ->> 'request_kind' into v_kind
      from public.couranr_conversation_events e
     where e.message_id = v_id
       and e.event_type = 'help_resolution_requested'
     order by e.created_at asc
     limit 1;

    if v_kind is null then
      raise exception 'idempotency_key_already_used' using errcode = 'CR409';
    end if;

    return query select v_id, v_kind;
    return;
  end if;

  -- The server read a snapshot immediately before calling this RPC. If a
  -- lifecycle transition won the race, reject the NEW request rather than
  -- writing policy text for a stale stage.
  if p_expected_fulfillment_state is null
     or v_state <> p_expected_fulfillment_state then
    raise exception 'delivery_state_changed' using errcode = 'CR409';
  end if;

  -- Defense in depth: the request kind must agree with the locked state.
  if not (
    (v_state in ('not_scheduled', 'scheduled', 'assigned', 'en_route_to_pickup')
      and p_request_kind = 'cancellation_review')
    or
    (v_state = 'at_pickup' and p_request_kind = 'operations_review')
    or
    (v_state in ('picked_up', 'in_transit', 'at_dropoff')
      and p_request_kind = 'return_review')
  ) then
    raise exception 'resolution_request_not_open' using errcode = 'CR409';
  end if;

  if p_body is null or length(btrim(p_body)) = 0 or length(p_body) > 4000 then
    raise exception 'body_out_of_range' using errcode = 'CR400';
  end if;

  if p_topic is null or p_topic not in (
    'availability', 'access', 'address_concern', 'handoff_concern',
    'unrecognized_delivery', 'delivery_problem', 'other'
  ) then
    raise exception 'topic_not_recognized' using errcode = 'CR400';
  end if;

  insert into public.couranr_conversation_messages
    (conversation_id, author_participant_id, visibility, authorship, topic, body, idempotency_key)
  values
    (v_part.conversation_id, v_part.id, 'participants', 'human', p_topic, btrim(p_body), p_idempotency_key)
  on conflict (conversation_id, author_participant_id, idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    -- A non-resolution Help write won the same idempotency key. Never attach
    -- resolution semantics to a message this command did not create.
    raise exception 'idempotency_key_already_used' using errcode = 'CR409';
  end if;

  insert into public.couranr_conversation_events
    (conversation_id, message_id, event_type, actor_kind, actor_user_id, metadata)
  values
    (v_part.conversation_id, v_id, 'message_sent', 'customer', null,
     jsonb_build_object('topic', p_topic, 'via', 'delivery_help'));

  insert into public.couranr_conversation_events
    (conversation_id, message_id, event_type, actor_kind, actor_user_id, metadata)
  values
    (v_part.conversation_id, v_id, 'help_resolution_requested', 'customer', null,
     jsonb_build_object(
       'via', 'delivery_help_resolution',
       'request_kind', p_request_kind,
       'fulfillment_state', v_state
     ));

  update public.couranr_conversations c
     set received_at         = coalesce(c.received_at, now()),
         response_due_at     = coalesce(c.response_due_at, now() + interval '15 minutes'),
         waiting_on          = 'couranr',
         awaiting_reply_kind = coalesce(c.awaiting_reply_kind, 'customer'),
         status              = case when c.status in ('resolved', 'closed') then 'open' else c.status end,
         updated_at          = now()
   where c.id = v_part.conversation_id;

  return query select v_id, p_request_kind;
end;
$fn$;

revoke all on function public.couranr_help_post_resolution_request(
  uuid, uuid, text, text, text, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.couranr_help_post_resolution_request(
  uuid, uuid, text, text, text, text, text
) to service_role;

comment on function public.couranr_help_post_resolution_request(
  uuid, uuid, text, text, text, text, text
) is
  'CUS-002 atomic reviewed-resolution request. Existing idempotency replays are '
  'resolved before lifecycle eligibility; new requests lock the delivery row '
  'and require the server snapshot to still match before appending one Help '
  'message. No cancellation, return, refund, custody, payer, price or lifecycle '
  'mutation occurs.';

commit;

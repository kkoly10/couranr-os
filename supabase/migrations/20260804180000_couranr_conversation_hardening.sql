-- P8-001 hardening. Four defects found by adversarial review, each reproduced
-- against a throwaway cluster before being fixed here.
--
--
-- 1. TWO TRIGGER FUNCTIONS WERE NEVER REVOKED.
--
-- 20260804150000 revokes EXECUTE on its three helper functions and says in a
-- comment that the revoke is "load-bearing rather than decorative", because
-- this project's pg_default_acl grants EXECUTE on every new function in
-- `public` to anon and authenticated. It then MISSED the two trigger functions
-- it created in the same migration, and 20260804170000 missed the third.
--
-- The exposure is small — a trigger function called directly outside a trigger
-- context errors, and none of the three reads a message body — but it is the
-- exact omission that migration's own comment warns about, in the migration
-- that warns about it.
--
--
-- 2. PARTICIPANT TENURE WAS NOT MONOTONE.
--
-- A departed participant row could be reopened by setting `left_at` back to
-- null, and it kept its ORIGINAL `joined_at`. For a driver that means the
-- tenure window reopens to the beginning of time: unassign a driver, reopen the
-- row, and they read the whole history of a delivery that was someone else's
-- while they were away.
--
-- The tenure window is the only thing standing between a reassigned driver and
-- another driver's conversation, so a way to widen it silently is worth closing
-- even though no shipped command does it.
--
--
-- 3. AUTHORSHIP WAS NOT TIED TO THE MESSAGE'S OWN CONVERSATION.
--
-- `author_participant_id` referenced couranr_conversation_participants(id) with
-- nothing requiring that participant to belong to the message's conversation.
-- So a message in thread A could be attributed to a participant of thread B.
-- Nothing reads authorship for an authorization decision today, which is why
-- this is low rather than high — but the projection returns
-- `authorParticipantId` to clients, and a future "who said this" feature would
-- inherit a cross-thread pointer.
--
--
-- 4. THE AUDIT BODY GUARD INSPECTED KEY NAMES ONLY.
--
-- `couranr_jsonb_has_no_key(metadata, array['body','message',...])` walks the
-- whole document — that part is correct, and it does catch a body nested inside
-- an array. But it never looks at VALUES, so `{"topic": "<the entire message>"}`
-- passes cleanly. A denylist of five names cannot be complete; the set of keys
-- someone might store a body under is unbounded.
--
-- Inverted to an ALLOW-LIST plus a length cap. An audit row records what
-- happened, not what was said, so every legitimate value is short and its key
-- is known in advance. The old function is kept — the CHECK on
-- couranr_conversation_events still uses it as a first line — and the new
-- constraint is added beside it, because two cheap independent checks are worth
-- more than one clever one.

begin;

-- ------------------------------------------------- 1. the missing revokes

revoke all on function public.couranr_cvp_enforce_kind()
  from public, anon, authenticated;
revoke all on function public.couranr_cvm_enforce_visibility()
  from public, anon, authenticated;
revoke all on function public.couranr_cv_kind_immutable()
  from public, anon, authenticated;

-- ------------------------------------------------ 2. monotone tenure

create or replace function public.couranr_cvp_tenure_monotone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A departure is final. Rejoining is a NEW row with a new joined_at, which is
  -- what makes the window mean "while you were assigned this time".
  if old.left_at is not null and new.left_at is null then
    raise exception 'a departed participant may not be reopened; insert a new row'
      using errcode = 'CR403';
  end if;

  -- The window may never widen. Moving joined_at backwards would hand a driver
  -- history from before they were assigned.
  if new.joined_at < old.joined_at then
    raise exception 'joined_at may not move backwards (% -> %)', old.joined_at, new.joined_at
      using errcode = 'CR403';
  end if;

  return new;
end;
$$;

drop trigger if exists couranr_cvp_tenure_monotone_trg
  on public.couranr_conversation_participants;

create trigger couranr_cvp_tenure_monotone_trg
  before update of left_at, joined_at
  on public.couranr_conversation_participants
  for each row execute function public.couranr_cvp_tenure_monotone();

revoke all on function public.couranr_cvp_tenure_monotone()
  from public, anon, authenticated;

comment on function public.couranr_cvp_tenure_monotone() is
  'Tenure only ever narrows. Reopening a departed participant, or moving '
  'joined_at backwards, would widen a driver''s read window to cover a '
  'delivery that was someone else''s while they were away. P8-001 hardening.';

-- --------------------------------- 3. authorship belongs to the conversation

-- The composite target the message FK needs. `id` is already the primary key,
-- so this UNIQUE is redundant for uniqueness and exists purely to give the
-- foreign key something to point at.
alter table public.couranr_conversation_participants
  drop constraint if exists couranr_cvp_id_conv_uniq;
alter table public.couranr_conversation_participants
  add constraint couranr_cvp_id_conv_uniq unique (id, conversation_id);

alter table public.couranr_conversation_messages
  drop constraint if exists couranr_cvm_author_in_conversation_fkey;
alter table public.couranr_conversation_messages
  add constraint couranr_cvm_author_in_conversation_fkey
  foreign key (author_participant_id, conversation_id)
  references public.couranr_conversation_participants (id, conversation_id);

-- ------------------------------------------- 4. the audit guard, inverted

/**
 * True when every key in the document is on the allow-list AND every string
 * value is short.
 *
 * A denylist of key names cannot be complete — `{"topic": "<the whole
 * message>"}` defeated the previous one, verified. An allow-list is complete by
 * construction: an audit row records what happened, so its keys are known in
 * advance and its values are enums, ids and short labels.
 *
 * The length cap is the second half. Without it an allow-listed key like
 * `topic` could still carry 4000 characters of message body.
 */
create or replace function public.couranr_jsonb_audit_shape_ok(
  p_doc      jsonb,
  p_keys     text[],
  p_max_len  integer
) returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    -- every key, at any depth, is allowed
    not exists (
      select 1
        from jsonb_path_query(p_doc, '$.**') as node
       cross join lateral (
         select k from jsonb_object_keys(
           case when jsonb_typeof(node) = 'object' then node else '{}'::jsonb end
         ) as k
       ) keys
       where lower(keys.k) <> all (select lower(x) from unnest(p_keys) x)
    )
    and
    -- and no string value is long enough to be a message
    not exists (
      select 1
        from jsonb_path_query(p_doc, '$.**') as node
       where jsonb_typeof(node) = 'string'
         and length(node #>> '{}') > p_max_len
    );
$$;

revoke all on function public.couranr_jsonb_audit_shape_ok(jsonb, text[], integer)
  from public, anon, authenticated;

comment on function public.couranr_jsonb_audit_shape_ok(jsonb, text[], integer) is
  'Allow-list of audit metadata keys plus a value-length cap. Replaces a '
  'five-name denylist that never inspected values, so {"topic": "<whole '
  'message>"} passed it. P8-001 hardening.';

-- Added ALONGSIDE couranr_cve_no_body_chk rather than replacing it. Two cheap
-- independent checks beat one clever one, and the denylist still catches the
-- obvious `body` key with a clearer constraint name in the error.
alter table public.couranr_conversation_events
  drop constraint if exists couranr_cve_audit_shape_chk;
alter table public.couranr_conversation_events
  add constraint couranr_cve_audit_shape_chk
  check (public.couranr_jsonb_audit_shape_ok(
    metadata,
    array[
      -- what happened
      'topic', 'visibility', 'authorship', 'via', 'queued', 'reason',
      -- which thing
      'message_id', 'participant_id', 'delivery_id', 'request_id',
      -- transitions
      'from', 'to', 'previous_state', 'next_state', 'due_state'
    ],
    200
  ));

commit;

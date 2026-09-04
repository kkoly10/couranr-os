-- ============================================================================
-- Driver Pilot Readiness D0 — authority corrections
--
-- This migration closes two authority gaps before the Driver UI becomes
-- reachable for a real pilot:
--   1. message visibility is authorized by the HUMAN AUTHOR, not merely by the
--      conversation kind;
--   2. a driver's "offline after this delivery" intent can survive every
--      release path, including older commands that still write 'available'
--      directly.
--
-- No delivery, pricing, routing, payment, or assignment destination is changed.
-- ============================================================================

begin;

set local statement_timeout = '120s';
set local lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. Message addressing is an ACTOR permission.
--
-- The existing couranr_cv_visibility_allowed(kind, visibility) answers a
-- different question: "can this visibility exist in this conversation kind?"
-- It does not answer "may THIS participant address it?" A hidden UI control is
-- not authorization, so enforce the actor matrix in the database as defence in
-- depth behind the named server command.
-- ---------------------------------------------------------------------------

create or replace function public.couranr_cv_actor_visibility_allowed(
  p_participant_kind text,
  p_visibility text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_participant_kind
    when 'operations' then p_visibility in (
      'participants',
      'couranr_internal',
      'driver_and_couranr',
      'merchant_and_couranr'
    )
    when 'driver' then p_visibility in (
      'participants',
      'driver_and_couranr'
    )
    when 'merchant' then p_visibility in (
      'participants',
      'merchant_and_couranr'
    )
    when 'customer' then p_visibility = 'participants'
    else false
  end;
$$;

create or replace function public.couranr_cvm_enforce_author_addressing()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_kind text;
  v_conversation_id uuid;
  v_left_at timestamptz;
begin
  -- Automated notices and AI drafts are system-authored and are governed by
  -- their own issuance path. This trigger closes the HUMAN browser/server path.
  if new.authorship <> 'human' then
    return new;
  end if;

  if new.author_participant_id is null then
    raise exception 'human_message_author_required' using errcode = 'CR403';
  end if;

  select p.participant_kind, p.conversation_id, p.left_at
    into v_kind, v_conversation_id, v_left_at
    from public.couranr_conversation_participants p
   where p.id = new.author_participant_id;

  if not found
     or v_conversation_id is distinct from new.conversation_id
     or v_left_at is not null then
    -- One refusal for missing, foreign-conversation, and ended participation:
    -- do not turn the write path into an existence oracle.
    raise exception 'message_author_not_current_participant' using errcode = 'CR403';
  end if;

  if not public.couranr_cv_actor_visibility_allowed(v_kind, new.visibility) then
    raise exception 'message_visibility_not_permitted' using errcode = 'CR403';
  end if;

  return new;
end
$fn$;

drop trigger if exists couranr_cvm_author_addressing_trg
  on public.couranr_conversation_messages;

create trigger couranr_cvm_author_addressing_trg
before insert or update of conversation_id, author_participant_id, visibility, authorship
on public.couranr_conversation_messages
for each row execute function public.couranr_cvm_enforce_author_addressing();

revoke all on function public.couranr_cv_actor_visibility_allowed(text,text)
  from public, anon, authenticated;
grant execute on function public.couranr_cv_actor_visibility_allowed(text,text)
  to service_role;

revoke all on function public.couranr_cvm_enforce_author_addressing()
  from public, anon, authenticated;
grant execute on function public.couranr_cvm_enforce_author_addressing()
  to service_role;

-- ---------------------------------------------------------------------------
-- 2. Driver availability intent survives assignment release.
--
-- availability_state is operational truth:
--   available | unavailable | on_delivery
--
-- availability_preference is the driver's next-idle intent:
--   available | unavailable
--
-- Assignment remains the only thing that owns on_delivery. An in-flight driver
-- may change preference without changing operational truth; every release path
-- that tries to return that driver to available is forced to respect the stored
-- preference. This intentionally catches older replacement/unassignment
-- commands too, rather than requiring every release caller to remember a new
-- branch.
-- ---------------------------------------------------------------------------

alter table public.couranr_drivers
  add column if not exists availability_preference text not null default 'available';

-- Backfill only rows whose current idle truth is unavailable. The new column's
-- default already represents available/on_delivery correctly, and this WHERE
-- makes the migration safe to re-run without erasing a future
-- "offline after this delivery" preference on an in-flight driver.
update public.couranr_drivers
   set availability_preference = 'unavailable'
 where availability_state = 'unavailable'
   and availability_preference is distinct from 'unavailable';

alter table public.couranr_drivers
  drop constraint if exists couranr_drv_availability_preference_chk;

alter table public.couranr_drivers
  add constraint couranr_drv_availability_preference_chk
  check (availability_preference in ('available','unavailable'));

create or replace function private.couranr_driver_availability_intent_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
begin
  if old.availability_state = 'on_delivery' then
    -- A release may never convert "offline after this delivery" into available.
    -- on_delivery itself stays system-owned; changing only the preference while
    -- on delivery is allowed.
    if new.availability_state = 'available'
       and old.availability_preference = 'unavailable' then
      new.availability_state := 'unavailable';
    end if;
  elsif new.availability_state in ('available','unavailable') then
    -- Existing Operations availability commands remain coherent with the new
    -- intent field without gaining a second target parameter.
    new.availability_preference := new.availability_state;
  end if;

  return new;
end
$fn$;

drop trigger if exists couranr_driver_availability_intent_trg
  on public.couranr_drivers;

create trigger couranr_driver_availability_intent_trg
before update of availability_state, availability_preference
on public.couranr_drivers
for each row execute function private.couranr_driver_availability_intent_guard();

commit;

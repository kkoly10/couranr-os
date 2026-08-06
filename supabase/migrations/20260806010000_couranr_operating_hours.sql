-- HRS-002 in the database. The SECOND half of a dual path.
--
-- WHY THIS MIGRATION EXISTS AT ALL.
--
-- The response deadline is written in TWO places, and only one of them is
-- TypeScript:
--
--   `stampDeadlines` in lib/couranr/conversations/commands.ts — the merchant,
--   driver and Operations paths.
--
--   `couranr_help_post_message` — the CUSTOMER path. A Delivery Help message
--   never passes through the TypeScript command; the SQL function sets the
--   deadline itself, and it set a flat `now() + interval '15 minutes'`.
--
-- Fixing only the TypeScript would have left every customer-initiated support
-- thread on the old wall-clock deadline, so a customer writing at 02:00 Sunday
-- would still be recorded overdue by 02:15 Sunday. The two halves must agree,
-- and `tests/couranr-operating-hours.test.ts` plus the disposable-database
-- acceptance matrix compare them across the same instants.
--
-- WHY POSTGRESQL AND NOT A CONSTANT OFFSET. `AT TIME ZONE 'America/New_York'`
-- uses the same IANA tzdata the Intl implementation does, so both transitions
-- are handled by the database rather than by arithmetic. A hardcoded -5 would
-- be wrong for roughly seven months a year.

begin;

-- ── the zone, named once ────────────────────────────────────────────────────
create or replace function public.couranr_operating_timezone()
returns text language sql immutable
set search_path = ''
as $fn$ select 'America/New_York'::text $fn$;

comment on function public.couranr_operating_timezone() is
  'HRS-002, decided by the owner 2026-08-06. The single IANA zone for every '
  'Couranr operating hour and support deadline, across every market.';

-- ── is an instant inside Monday-Friday 06:00-18:00 local? ───────────────────
--
-- HRS-002 fixes the boundary semantics: start inclusive, end exclusive. 06:00:00
-- is inside and 18:00:00 is outside. `extract(isodow)` gives 1..7 with Monday=1,
-- so `<= 5` is exactly Monday-Friday.
create or replace function public.couranr_is_within_operating_hours(p_at timestamptz)
returns boolean language sql stable
set search_path = ''
as $fn$
  select p_at is not null
     and extract(isodow from (p_at at time zone public.couranr_operating_timezone())) <= 5
     and (p_at at time zone public.couranr_operating_timezone())::time >= time '06:00'
     and (p_at at time zone public.couranr_operating_timezone())::time <  time '18:00'
$fn$;

-- ── the start of the next operating period at or after an instant ───────────
--
-- Idempotent inside the window, so it is safe to apply more than once.
--
-- Steps a LOCAL CALENDAR DAY at a time. Adding `interval '24 hours'` would be
-- wrong across a transition, because a DST day is 23 or 25 hours long; adding
-- `interval '1 day'` to a local `timestamp` (not `timestamptz`) is calendar
-- arithmetic and is correct. The conversion back to `timestamptz` re-applies
-- whichever offset is in force on the destination day.
create or replace function public.couranr_next_operating_period_start(p_at timestamptz)
returns timestamptz language plpgsql stable
set search_path = ''
as $fn$
declare
  v_tz    text := public.couranr_operating_timezone();
  v_local timestamp;
  v_open  timestamptz;
  i       integer;
begin
  if p_at is null then
    return null;
  end if;
  if public.couranr_is_within_operating_hours(p_at) then
    return p_at;
  end if;

  v_local := p_at at time zone v_tz;

  -- Before opening on an operating day: today's 06:00.
  if extract(isodow from v_local) <= 5 and v_local::time < time '06:00' then
    return (date_trunc('day', v_local) + interval '6 hours') at time zone v_tz;
  end if;

  -- Otherwise walk forward to the next operating day's opening. Three steps
  -- covers Friday-evening to Monday-morning; eight leaves room and turns a
  -- broken assumption into an error rather than an infinite loop.
  for i in 1..8 loop
    v_local := date_trunc('day', v_local) + interval '1 day';
    if extract(isodow from v_local) <= 5 then
      v_open := (v_local + interval '6 hours') at time zone v_tz;
      return v_open;
    end if;
  end loop;

  raise exception 'couranr_next_operating_period_start: no operating day within 8 days'
    using errcode = 'CR422';
end;
$fn$;

-- ── add N OPERATING minutes, skipping every closed period ───────────────────
--
-- This is what TRM-001's `support_target_applies: "during operating hours"`
-- means arithmetically. A message received two minutes before Friday close
-- consumes those two minutes on Friday and the remaining thirteen on Monday.
--
-- Mirrors `addOperatingMinutes` in lib/couranr/hours/operatingHours.ts,
-- including the end-exclusive rule: when the remainder exactly fills a period
-- the deadline is the close instant, which is OUTSIDE the window, so it rolls
-- forward rather than sitting on a closed boundary.
create or replace function public.couranr_add_operating_minutes(
  p_from timestamptz, p_minutes integer
) returns timestamptz language plpgsql stable
set search_path = ''
as $fn$
declare
  v_tz        text := public.couranr_operating_timezone();
  v_cursor    timestamptz;
  v_close     timestamptz;
  v_remaining interval;
  v_available interval;
  i           integer;
begin
  if p_from is null then
    return null;
  end if;

  v_cursor    := public.couranr_next_operating_period_start(p_from);
  v_remaining := make_interval(mins => greatest(coalesce(p_minutes, 0), 0));

  for i in 1..400 loop
    if v_remaining = interval '0' then
      return v_cursor;
    end if;

    v_close := (date_trunc('day', (v_cursor at time zone v_tz)) + interval '18 hours')
                 at time zone v_tz;
    v_available := v_close - v_cursor;

    if v_remaining < v_available then
      return v_cursor + v_remaining;
    end if;

    v_remaining := v_remaining - v_available;
    v_cursor := public.couranr_next_operating_period_start(v_close + interval '1 minute');
    if v_remaining = interval '0' then
      return v_cursor;
    end if;
  end loop;

  raise exception 'couranr_add_operating_minutes: did not converge'
    using errcode = 'CR422';
end;
$fn$;

-- ── operating minutes elapsed between two instants ──────────────────────────
create or replace function public.couranr_operating_minutes_between(
  p_start timestamptz, p_end timestamptz
) returns numeric language plpgsql stable
set search_path = ''
as $fn$
declare
  v_tz     text := public.couranr_operating_timezone();
  v_cursor timestamptz;
  v_close  timestamptz;
  v_next   timestamptz;
  v_total  interval := interval '0';
  i        integer;
begin
  if p_start is null or p_end is null or p_end <= p_start then
    return 0;
  end if;

  v_cursor := public.couranr_next_operating_period_start(p_start);
  if v_cursor >= p_end then
    return 0;
  end if;

  for i in 1..400 loop
    v_close := (date_trunc('day', (v_cursor at time zone v_tz)) + interval '18 hours')
                 at time zone v_tz;
    if p_end <= v_close then
      v_total := v_total + (p_end - v_cursor);
      return extract(epoch from v_total) / 60.0;
    end if;
    v_total := v_total + (v_close - v_cursor);
    v_next := public.couranr_next_operating_period_start(v_close + interval '1 minute');
    if v_next >= p_end then
      return extract(epoch from v_total) / 60.0;
    end if;
    v_cursor := v_next;
  end loop;

  raise exception 'couranr_operating_minutes_between: did not converge'
    using errcode = 'CR422';
end;
$fn$;

-- These are pure clock arithmetic over no rows, so they are safe for every
-- role to execute. The REVOKE-then-GRANT is still explicit because
-- `pg_default_acl` grants EXECUTE on every new function in `public` to anon,
-- authenticated and service_role, and a function that is readable by default
-- should be so because someone decided it, not because nobody noticed.
revoke all on function public.couranr_operating_timezone() from public, anon, authenticated, service_role;
revoke all on function public.couranr_is_within_operating_hours(timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.couranr_next_operating_period_start(timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.couranr_add_operating_minutes(timestamptz, integer) from public, anon, authenticated, service_role;
revoke all on function public.couranr_operating_minutes_between(timestamptz, timestamptz) from public, anon, authenticated, service_role;

grant execute on function public.couranr_operating_timezone() to service_role;
grant execute on function public.couranr_is_within_operating_hours(timestamptz) to service_role;
grant execute on function public.couranr_next_operating_period_start(timestamptz) to service_role;
grant execute on function public.couranr_add_operating_minutes(timestamptz, integer) to service_role;
grant execute on function public.couranr_operating_minutes_between(timestamptz, timestamptz) to service_role;

-- ── the customer path, corrected ────────────────────────────────────────────
--
-- Identical to 20260804200000 except for the deadline arithmetic and the
-- newly-written `next_operating_period_at`. Every other line — the author-scoped
-- idempotency lookup, the reopen rule, the topic allow-list — is carried across
-- unchanged, because this migration is about the clock and nothing else.
create or replace function public.couranr_help_post_message(
  p_token_id uuid, p_body text, p_topic text, p_idempotency_key text
) returns uuid
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_part public.couranr_conversation_participants;
  v_id   uuid;
  v_now  timestamptz := now();
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
     set received_at         = coalesce(c.received_at, v_now),
         -- HRS-002. Was `now() + interval '15 minutes'`, which put a Sunday
         -- 02:00 message overdue at 02:15 Sunday.
         response_due_at     = coalesce(
                                 c.response_due_at,
                                 public.couranr_add_operating_minutes(v_now, 15)
                               ),
         -- Non-null ONLY when the message arrived while Couranr was closed.
         next_operating_period_at = coalesce(
                                 c.next_operating_period_at,
                                 case
                                   when public.couranr_is_within_operating_hours(v_now) then null
                                   else public.couranr_next_operating_period_start(v_now)
                                 end
                               ),
         waiting_on          = 'couranr',
         awaiting_reply_kind = coalesce(c.awaiting_reply_kind, 'customer'),
         status              = case when c.status in ('resolved', 'closed') then 'open' else c.status end,
         updated_at          = v_now
   where c.id = v_part.conversation_id;

  return v_id;
end;
$fn$;

revoke all on function public.couranr_help_post_message(uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_help_post_message(uuid, text, text, text) to service_role;

comment on column public.couranr_conversations.next_operating_period_at is
  'HRS-002. Non-null only when the conversation was received while Couranr was '
  'CLOSED, and then it holds the instant the response clock starts. Null for an '
  'in-hours conversation, because there is no rollover to record. Created in '
  '20260804150000 and never written until HRS-002 was decided.';

commit;

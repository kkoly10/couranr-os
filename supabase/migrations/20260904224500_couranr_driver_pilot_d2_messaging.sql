-- ============================================================================
-- Driver Pilot Readiness D2 — reachable delivery chat + Operations context
--
-- Goals:
--   * every canonical delivery can have exactly one delivery_chat;
--   * authorized merchant members join when the chat is issued;
--   * the assigned driver joins/leaves with assignment tenure;
--   * assignment/delivery writes NEVER roll back because messaging issuance
--     failed — trigger hooks catch and warn, then reconciliation can retry;
--   * Operations reads/writes in an explicit Operations context without
--     requiring a second LIVE participant row, so an admin who is also a
--     merchant owner cannot bleed Operations authority into /app/business.
-- ============================================================================

begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. Real Operations authorship without a fake shared participant.
--
-- A participant author is still the normal path. Operations is different:
-- OPS-005 is a cross-business projection, not a fourth conversation kind, and
-- a real admin may simultaneously be the merchant participant in the same
-- thread. The existing live-participant uniqueness therefore cannot represent
-- "merchant here, Operations there" safely.
--
-- Keep the real human identity on the message row instead. Participant-facing
-- projections already forbid author_user_id from leaving the server.
-- ---------------------------------------------------------------------------

alter table public.couranr_conversation_messages
  add column if not exists author_user_id uuid references auth.users(id);

alter table public.couranr_conversation_messages
  drop constraint if exists couranr_cvm_human_author_identity_chk;

alter table public.couranr_conversation_messages
  add constraint couranr_cvm_human_author_identity_chk
  check (
    authorship <> 'human'
    or (
      (author_participant_id is not null and author_user_id is null)
      or
      (author_participant_id is null and author_user_id is not null)
    )
  );

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
  v_profile_role text;
begin
  if new.authorship <> 'human' then
    return new;
  end if;

  if new.author_participant_id is not null and new.author_user_id is null then
    select p.participant_kind, p.conversation_id, p.left_at
      into v_kind, v_conversation_id, v_left_at
      from public.couranr_conversation_participants p
     where p.id = new.author_participant_id;

    if not found
       or v_conversation_id is distinct from new.conversation_id
       or v_left_at is not null then
      raise exception 'message_author_not_current_participant' using errcode = 'CR403';
    end if;

    if not public.couranr_cv_actor_visibility_allowed(v_kind, new.visibility) then
      raise exception 'message_visibility_not_permitted' using errcode = 'CR403';
    end if;

    return new;
  end if;

  if new.author_participant_id is null and new.author_user_id is not null then
    select p.role into v_profile_role
      from public.profiles p
     where p.id = new.author_user_id;

    if v_profile_role is distinct from 'admin' then
      raise exception 'operations_author_required' using errcode = 'CR403';
    end if;

    if not public.couranr_cv_actor_visibility_allowed('operations', new.visibility) then
      raise exception 'message_visibility_not_permitted' using errcode = 'CR403';
    end if;

    return new;
  end if;

  raise exception 'human_message_author_identity_invalid' using errcode = 'CR403';
end
$fn$;

-- ---------------------------------------------------------------------------
-- 2. Operations reader.
--
-- Participant reads continue through couranr_conversation_thread and therefore
-- through a live participant row. Operations gets a different RPC that verifies
-- the real admin identity before returning the Operations visibility envelope.
-- No Operations participant is inserted, so dual-role users remain merchant
-- participants on the merchant surface.
-- ---------------------------------------------------------------------------

create or replace function public.couranr_operations_conversation_thread(
  p_conversation_id uuid,
  p_actor_user_id uuid
)
returns setof public.couranr_conversation_messages
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not exists (
    select 1
      from public.profiles p
     where p.id = p_actor_user_id
       and p.role = 'admin'
  ) then
    raise exception 'operations_access_required' using errcode = 'CR403';
  end if;

  if not exists (
    select 1 from public.couranr_conversations c where c.id = p_conversation_id
  ) then
    raise exception 'conversation_not_found' using errcode = 'CR404';
  end if;

  return query
    select m.*
      from public.couranr_conversation_messages m
     where m.conversation_id = p_conversation_id
       and m.authorship <> 'ai_draft'
     order by m.created_at asc;
end
$fn$;

revoke all on function public.couranr_operations_conversation_thread(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_operations_conversation_thread(uuid,uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. Idempotent delivery-chat issuance.
-- ---------------------------------------------------------------------------

create or replace function public.couranr_ensure_delivery_chat(
  p_delivery_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_business_account_id uuid;
  v_conversation_id uuid;
begin
  select d.business_account_id
    into v_business_account_id
    from public.couranr_deliveries d
   where d.id = p_delivery_id;

  if not found then
    raise exception 'delivery_not_found' using errcode = 'CR404';
  end if;
  if v_business_account_id is null then
    raise exception 'delivery_business_scope_missing' using errcode = 'CR422';
  end if;

  insert into public.couranr_conversations(
    kind,
    business_account_id,
    delivery_id,
    status,
    urgency,
    due_state
  )
  values (
    'delivery_chat',
    v_business_account_id,
    p_delivery_id,
    'open',
    'routine',
    'on_time'
  )
  on conflict (delivery_id, kind) where delivery_id is not null
  do nothing;

  select c.id
    into v_conversation_id
    from public.couranr_conversations c
   where c.delivery_id = p_delivery_id
     and c.kind = 'delivery_chat';

  if v_conversation_id is null then
    raise exception 'delivery_chat_issue_failed' using errcode = 'CR422';
  end if;

  -- TRM-002 closed allow-list: owner / manager / dispatcher may read + send.
  -- Only LIVE membership rows are issued as live participants.
  insert into public.couranr_conversation_participants(
    conversation_id,
    participant_kind,
    user_id,
    member_role
  )
  select
    v_conversation_id,
    'merchant',
    bm.user_id,
    bm.role
  from public.business_members bm
  where bm.business_account_id = v_business_account_id
    and bm.status = 'active'
    and bm.role in ('owner','manager','dispatcher')
    and not exists (
      select 1
        from public.couranr_conversation_participants p
       where p.conversation_id = v_conversation_id
         and p.user_id = bm.user_id
         and p.participant_kind = 'merchant'
         and p.left_at is null
    );

  return v_conversation_id;
end
$fn$;

create or replace function public.couranr_join_assignment_delivery_chat(
  p_delivery_id uuid,
  p_driver_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_conversation_id uuid;
  v_driver_user_id uuid;
begin
  v_conversation_id := public.couranr_ensure_delivery_chat(p_delivery_id);

  select d.user_id
    into v_driver_user_id
    from public.couranr_drivers d
   where d.id = p_driver_id;

  if not found then
    raise exception 'driver_not_found' using errcode = 'CR404';
  end if;

  insert into public.couranr_conversation_participants(
    conversation_id,
    participant_kind,
    user_id
  )
  select
    v_conversation_id,
    'driver',
    v_driver_user_id
  where not exists (
    select 1
      from public.couranr_conversation_participants p
     where p.conversation_id = v_conversation_id
       and p.user_id = v_driver_user_id
       and p.participant_kind = 'driver'
       and p.left_at is null
  );

  return v_conversation_id;
end
$fn$;

create or replace function public.couranr_leave_assignment_delivery_chat(
  p_delivery_id uuid,
  p_driver_id uuid,
  p_left_at timestamptz default now()
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_driver_user_id uuid;
  v_count integer := 0;
begin
  select d.user_id
    into v_driver_user_id
    from public.couranr_drivers d
   where d.id = p_driver_id;

  if not found then
    return 0;
  end if;

  update public.couranr_conversation_participants p
     set left_at = greatest(p.joined_at, coalesce(p_left_at, now()))
   where p.participant_kind = 'driver'
     and p.user_id = v_driver_user_id
     and p.left_at is null
     and exists (
       select 1
         from public.couranr_conversations c
        where c.id = p.conversation_id
          and c.kind = 'delivery_chat'
          and c.delivery_id = p_delivery_id
     );

  get diagnostics v_count = row_count;
  return v_count;
end
$fn$;

-- Reconciliation is explicit and safe to rerun. It closes no deliveries and
-- changes no assignments; it only makes the conversation projection catch up
-- with canonical delivery/assignment truth.
create or replace function public.couranr_reconcile_delivery_chats()
returns table(deliveries_checked integer, active_drivers_checked integer)
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_delivery record;
  v_assignment record;
  v_deliveries integer := 0;
  v_drivers integer := 0;
begin
  for v_delivery in
    select d.id from public.couranr_deliveries d
  loop
    perform public.couranr_ensure_delivery_chat(v_delivery.id);
    v_deliveries := v_deliveries + 1;
  end loop;

  for v_assignment in
    select a.delivery_id, a.driver_id
      from public.couranr_delivery_assignments a
     where a.assignment_state = 'active'
       and a.ended_at is null
  loop
    perform public.couranr_join_assignment_delivery_chat(
      v_assignment.delivery_id,
      v_assignment.driver_id
    );
    v_drivers := v_drivers + 1;
  end loop;

  return query select v_deliveries, v_drivers;
end
$fn$;

-- ---------------------------------------------------------------------------
-- 4. Best-effort hooks. Messaging can lag, but it cannot break fulfillment.
-- ---------------------------------------------------------------------------

create or replace function private.couranr_delivery_chat_after_delivery()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
begin
  begin
    perform public.couranr_ensure_delivery_chat(new.id);
  exception when others then
    raise warning 'couranr delivery-chat issuance failed for delivery %: %', new.id, sqlerrm;
  end;
  return new;
end
$fn$;

drop trigger if exists couranr_delivery_chat_after_delivery_trg
  on public.couranr_deliveries;
create trigger couranr_delivery_chat_after_delivery_trg
after insert on public.couranr_deliveries
for each row execute function private.couranr_delivery_chat_after_delivery();

create or replace function private.couranr_delivery_chat_assignment_tenure()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
begin
  if tg_op = 'INSERT' then
    if new.assignment_state = 'active' and new.ended_at is null then
      begin
        perform public.couranr_join_assignment_delivery_chat(new.delivery_id, new.driver_id);
      exception when others then
        raise warning 'couranr driver-chat join failed for assignment %: %', new.id, sqlerrm;
      end;
    end if;
    return new;
  end if;

  if old.assignment_state = 'active'
     and (
       new.assignment_state <> 'active'
       or new.ended_at is not null
       or new.driver_id is distinct from old.driver_id
     ) then
    begin
      perform public.couranr_leave_assignment_delivery_chat(
        old.delivery_id,
        old.driver_id,
        coalesce(new.ended_at, now())
      );
    exception when others then
      raise warning 'couranr driver-chat leave failed for assignment %: %', old.id, sqlerrm;
    end;
  end if;

  if new.assignment_state = 'active'
     and new.ended_at is null
     and (
       old.assignment_state <> 'active'
       or old.ended_at is not null
       or new.driver_id is distinct from old.driver_id
     ) then
    begin
      perform public.couranr_join_assignment_delivery_chat(new.delivery_id, new.driver_id);
    exception when others then
      raise warning 'couranr driver-chat join failed for assignment %: %', new.id, sqlerrm;
    end;
  end if;

  return new;
end
$fn$;

drop trigger if exists couranr_delivery_chat_assignment_tenure_trg
  on public.couranr_delivery_assignments;
create trigger couranr_delivery_chat_assignment_tenure_trg
after insert or update of assignment_state, ended_at, driver_id
on public.couranr_delivery_assignments
for each row execute function private.couranr_delivery_chat_assignment_tenure();

-- ---------------------------------------------------------------------------
-- 5. Privilege boundary + one-time reconciliation.
-- ---------------------------------------------------------------------------

do $grant$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public.couranr_ensure_delivery_chat(uuid)',
    'public.couranr_join_assignment_delivery_chat(uuid,uuid)',
    'public.couranr_leave_assignment_delivery_chat(uuid,uuid,timestamp with time zone)',
    'public.couranr_reconcile_delivery_chats()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_sig);
    execute format('grant execute on function %s to service_role', v_sig);
  end loop;
end
$grant$;

revoke all on function private.couranr_delivery_chat_after_delivery()
  from public, anon, authenticated, service_role;
revoke all on function private.couranr_delivery_chat_assignment_tenure()
  from public, anon, authenticated, service_role;

-- Existing canonical rows (including Pilot #1) become reachable now. This is
-- idempotent and mutates conversation substrate only.
select * from public.couranr_reconcile_delivery_chats();

commit;

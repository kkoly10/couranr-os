-- Roll back Driver Pilot Readiness D2.
--
-- WARNING: if Operations-authored messages exist, dropping author_user_id
-- removes their explicit human audit identity. Inspect before using this rollback
-- on a live environment. Conversation/data rows themselves are not deleted.

begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

do $guard$
begin
  if exists (
    select 1
      from public.couranr_conversation_messages
     where authorship='human'
       and author_user_id is not null
  ) then
    raise exception
      'unsafe rollback: Operations-authored human messages depend on author_user_id; use a forward repair';
  end if;
end
$guard$;

drop trigger if exists couranr_delivery_chat_membership_tenure_trg
  on public.business_members;
drop function if exists private.couranr_delivery_chat_membership_tenure() restrict;

drop trigger if exists couranr_delivery_chat_assignment_tenure_trg
  on public.couranr_delivery_assignments;
drop function if exists private.couranr_delivery_chat_assignment_tenure() restrict;

drop trigger if exists couranr_delivery_chat_after_delivery_trg
  on public.couranr_deliveries;
drop function if exists private.couranr_delivery_chat_after_delivery() restrict;

drop function if exists public.couranr_reconcile_delivery_chats() restrict;
drop function if exists public.couranr_leave_assignment_delivery_chat(uuid,uuid,timestamp with time zone) restrict;
drop function if exists public.couranr_join_assignment_delivery_chat(uuid,uuid) restrict;
drop function if exists public.couranr_ensure_delivery_chat(uuid) restrict;
drop function if exists public.couranr_operations_conversation_thread(uuid,uuid) restrict;

alter table public.couranr_conversation_messages
  drop constraint if exists couranr_cvm_human_author_identity_chk;

-- Restore the D0 participant-only human-author rule before removing the column.
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
    raise exception 'message_author_not_current_participant' using errcode = 'CR403';
  end if;

  if not public.couranr_cv_actor_visibility_allowed(v_kind, new.visibility) then
    raise exception 'message_visibility_not_permitted' using errcode = 'CR403';
  end if;

  return new;
end
$fn$;

alter table public.couranr_conversation_messages
  drop column if exists author_user_id;

commit;

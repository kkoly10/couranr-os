-- ============================================================================
-- CUS-004 correction: resolve_report must update Delivery Help conversation
-- bookkeeping (Codex P2).
--
-- couranr_transition_customer_problem_report only updated the associated
-- Delivery Help conversation on the 'request_evidence' command. Resolving a
-- newly submitted report (reported/under_review/awaiting_evidence -> resolved)
-- therefore left the conversation with waiting_on='couranr',
-- awaiting_reply_kind='customer' and first_couranr_response_at IS NULL, so
-- refreshDueStates (which ages every open thread whose first Couranr response
-- is still unrecorded) kept aging the completed case and could mark it overdue
-- in the Operations inbox.
--
-- Resolving a report IS the visible Operations response to the customer (the
-- report renders as resolved), exactly like requesting evidence is. So this
-- correction makes BOTH visible-response commands record the HRS-002 first
-- response and clear the outstanding turn, using one update that differs only
-- in who (if anyone) then owes a reply:
--   * request_evidence  -> waiting_on='customer'  (customer must upload)
--   * resolve_report    -> waiting_on=null         (case done; nobody owes)
-- both set awaiting_reply_kind=null and stamp first_couranr_response_at with
-- coalesce so an already-recorded legitimate first response is never
-- overwritten, and due_state moves to 'on_time' only when this is the first
-- response — identical to the pre-existing request_evidence semantics.
--
-- 'start_review' is an internal Operations action the customer never sees, so
-- it deliberately leaves the conversation untouched (unchanged from before).
--
-- The conversation status is intentionally NOT set to resolved/closed: a
-- delivery-help thread can carry other activity, and refreshDueStates already
-- stops aging once first_couranr_response_at is set, so clearing the turn is
-- sufficient without closing unrelated support work.
--
-- Additive, function-body-only correction. Bare CREATE OR REPLACE at the exact
-- 4-arg signature; grants re-asserted to match 20260908142000.
-- ============================================================================

begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

create or replace function public.couranr_transition_customer_problem_report(
  p_report_id uuid,
  p_expected_version integer,
  p_actor_user_id uuid,
  p_command text
) returns public.couranr_customer_problem_reports
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_role text;
  v_row public.couranr_customer_problem_reports;
  v_from text;
  v_to text;
  v_evidence_slots integer;
  v_now timestamptz:=now();
begin
  select role into v_role from public.profiles where id=p_actor_user_id;
  if v_role is distinct from 'admin' then
    raise exception 'operations_access_required' using errcode='CR403';
  end if;

  select * into v_row
  from public.couranr_customer_problem_reports
  where id=p_report_id
  for update;

  if v_row.id is null then
    raise exception 'problem_report_not_found' using errcode='CR404';
  end if;
  if p_expected_version is distinct from v_row.version then
    raise exception 'version_conflict' using errcode='CR409';
  end if;

  v_from:=v_row.report_state;
  v_to:=case p_command
    when 'start_review' then 'under_review'
    when 'request_evidence' then 'awaiting_evidence'
    when 'resolve_report' then 'resolved'
    else null
  end;

  if v_to is null then
    raise exception 'problem_report_command_invalid' using errcode='CR400';
  end if;
  if v_from='draft' then
    raise exception 'problem_report_not_submitted' using errcode='CR409';
  end if;
  if p_command='start_review' and v_from not in ('reported','awaiting_evidence') then
    raise exception 'problem_report_transition_invalid' using errcode='CR409';
  elsif p_command='request_evidence' and v_from not in ('reported','under_review') then
    raise exception 'problem_report_transition_invalid' using errcode='CR409';
  elsif p_command='resolve_report' and v_from not in ('reported','under_review','awaiting_evidence') then
    raise exception 'problem_report_transition_invalid' using errcode='CR409';
  end if;

  if p_command='request_evidence' then
    select count(*) into v_evidence_slots
    from public.couranr_customer_problem_evidence e
    where e.report_id=v_row.id
      and (
        e.upload_state='verified'
        or (
          e.upload_state in ('pending','abandoned')
          and e.expires_at>v_now
        )
      );

    if v_evidence_slots>=5 then
      raise exception 'problem_evidence_limit_reached' using errcode='CR409';
    end if;
  end if;

  update public.couranr_customer_problem_reports
     set report_state=v_to,
         resolved_at=case when v_to='resolved' then v_now else resolved_at end,
         version=version+1,
         updated_at=v_now
   where id=v_row.id and version=p_expected_version
  returning * into v_row;

  if v_row.id is null then
    raise exception 'version_conflict' using errcode='CR409';
  end if;

  insert into public.couranr_customer_problem_report_events(
    report_id,actor_kind,actor_user_id,command,from_state,to_state,metadata
  ) values (
    v_row.id,'operations',p_actor_user_id,
    case p_command
      when 'start_review' then 'start_review'
      when 'request_evidence' then 'request_evidence'
      else 'resolve_report'
    end,
    v_from,v_to,'{}'::jsonb
  );

  -- Both request_evidence and resolve_report are the VISIBLE Operations
  -- response to the customer, so each records the HRS-002 first response and
  -- clears the outstanding turn. resolve_report ends the case (waiting_on=null:
  -- nobody owes a reply); request_evidence hands the turn to the customer
  -- (waiting_on='customer'). start_review is internal and touches nothing. The
  -- conversation status is NOT closed here — a delivery-help thread may hold
  -- other activity, and refreshDueStates already stops aging once
  -- first_couranr_response_at is set.
  if p_command in ('request_evidence','resolve_report') then
    update public.couranr_conversations c
       set first_couranr_response_at=coalesce(c.first_couranr_response_at,v_now),
           due_state=case
             when c.first_couranr_response_at is null then 'on_time'
             else c.due_state
           end,
           waiting_on=case when p_command='request_evidence' then 'customer' else null end,
           awaiting_reply_kind=null,
           updated_at=v_now
      from public.couranr_conversation_participants p
     where p.id=v_row.participant_id
       and c.id=p.conversation_id;
  end if;

  return v_row;
end
$fn$;

revoke all on function public.couranr_transition_customer_problem_report(
  uuid,integer,uuid,text
) from public,anon,authenticated,service_role;
grant execute on function public.couranr_transition_customer_problem_report(
  uuid,integer,uuid,text
) to service_role;

commit;

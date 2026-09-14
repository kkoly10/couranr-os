-- ============================================================================
-- Rollback of 20260908160000_couranr_customer_problem_resolve_bookkeeping.
--
-- Restores the prior (20260908142000) body of
-- couranr_transition_customer_problem_report, whose conversation update fires
-- ONLY on 'request_evidence' — i.e. resolve_report again leaves the Delivery
-- Help conversation bookkeeping untouched. Additive, function-body-only.
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

  if p_command='request_evidence' then
    update public.couranr_conversations c
       set first_couranr_response_at=coalesce(c.first_couranr_response_at,v_now),
           due_state=case
             when c.first_couranr_response_at is null then 'on_time'
             else c.due_state
           end,
           waiting_on='customer',
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

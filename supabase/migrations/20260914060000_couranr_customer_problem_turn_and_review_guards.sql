-- CUS-004 review findings: preserve a newer customer turn, and refuse to start
-- review while requested evidence is still owed.
--
-- WHY A NEW MIGRATION. 20260908160000 is APPLIED in production. Editing it
-- would make the file stop describing what ran, which is the exact condition
-- the migration ledger exists to prevent. This replaces the function forward.
--
-- ── P1. A newer customer turn must survive an Operations response ──────────
--
-- couranr_transition_customer_problem_report cleared the conversation's
-- outstanding turn unconditionally on request_evidence and resolve_report:
--
--     waiting_on = case when 'request_evidence' then 'customer' else null end,
--     awaiting_reply_kind = null
--
-- A Delivery Help thread carries more than one report's worth of activity. If
-- the customer sent an unrelated Help message AFTER their last activity on this
-- report, resolving the report set waiting_on=null and awaiting_reply_kind=null
-- — telling the queue that nobody owes a reply to a message Couranr has never
-- answered. The turn was silently dropped and refreshDueStates had nothing left
-- to age.
--
-- THE GUARD. `received_at` is stamped with `awaiting_reply_kind` by the same
-- write when a party asks (20260804190000), so it IS the outstanding turn's
-- timestamp. Compare it against this report's latest CUSTOMER activity — the
-- newest customer-authored report event, or the newest verified evidence,
-- whichever is later, falling back to the report's own creation. If the
-- conversation's outstanding turn is STRICTLY NEWER than that, it belongs to
-- something else and both turn fields are left exactly as they are.
--
-- `first_couranr_response_at` and `due_state` are stamped either way, because
-- Operations really did respond and HRS-002's first response is a fact about
-- the thread, not about which turn is outstanding.
--
-- ── P2. awaiting_evidence -> under_review needs the evidence to have ARRIVED ──
--
-- start_review accepted `awaiting_evidence` unconditionally. Moving the report
-- out of awaiting_evidence removes the customer's upload UI, so doing it while
-- the requested photos are still owed strands the customer: Operations asked
-- for evidence and then took away the means to send it.
--
-- THE GUARD uses existing state and adds no new report state. The distinction
-- between "requested but still owed" and "requested and received" is whether a
-- VERIFIED evidence row was finalized AFTER the most recent request_evidence
-- event. Zero such rows raises problem_evidence_not_received (CR409).
-- start_review from 'reported' is untouched — nothing was requested there.

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
  v_requested_at timestamptz;
  v_received integer;
  v_customer_activity_at timestamptz;
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

  -- P2: the requested evidence has to have actually arrived.
  if p_command='start_review' and v_from='awaiting_evidence' then
    select max(ev.created_at) into v_requested_at
    from public.couranr_customer_problem_report_events ev
    where ev.report_id=v_row.id
      and ev.command='request_evidence';

    select count(*) into v_received
    from public.couranr_customer_problem_evidence e
    where e.report_id=v_row.id
      and e.upload_state='verified'
      and (v_requested_at is null or e.finalized_at>v_requested_at);

    if v_received=0 then
      raise exception 'problem_evidence_not_received' using errcode='CR409';
    end if;
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

  -- P1: this report's newest CUSTOMER activity, read BEFORE the write below so
  -- the Operations event about to be inserted cannot count as customer input.
  select greatest(
           v_row.created_at,
           coalesce((
             select max(ev.created_at)
             from public.couranr_customer_problem_report_events ev
             where ev.report_id=v_row.id
               and ev.actor_kind='customer'
           ), v_row.created_at),
           coalesce((
             select max(e.finalized_at)
             from public.couranr_customer_problem_evidence e
             where e.report_id=v_row.id
               and e.upload_state='verified'
           ), v_row.created_at)
         )
    into v_customer_activity_at;

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
  -- response to the customer, so each records the HRS-002 first response.
  -- resolve_report ends the case (waiting_on=null); request_evidence hands the
  -- turn to the customer (waiting_on='customer'). start_review is internal and
  -- touches nothing. The conversation status is NOT closed here.
  --
  -- The turn fields are conditional: an outstanding turn NEWER than this
  -- report's last customer activity belongs to some other customer message, and
  -- answering this report does not answer that.
  if p_command in ('request_evidence','resolve_report') then
    update public.couranr_conversations c
       set first_couranr_response_at=coalesce(c.first_couranr_response_at,v_now),
           due_state=case
             when c.first_couranr_response_at is null then 'on_time'
             else c.due_state
           end,
           waiting_on=case
             when c.received_at is not null
              and c.received_at>v_customer_activity_at then c.waiting_on
             when p_command='request_evidence' then 'customer'
             else null
           end,
           awaiting_reply_kind=case
             when c.received_at is not null
              and c.received_at>v_customer_activity_at then c.awaiting_reply_kind
             else null
           end,
           updated_at=v_now
      from public.couranr_conversation_participants p
     where p.id=v_row.participant_id
       and c.id=p.conversation_id;
  end if;

  return v_row;
end
$fn$;

comment on function public.couranr_transition_customer_problem_report(uuid,integer,uuid,text) is
  'Operations-only CUS-004 report transition. start_review out of awaiting_evidence '
  'requires verified evidence finalized after the latest request_evidence '
  '(problem_evidence_not_received, CR409). Conversation turn bookkeeping is skipped '
  'when the thread carries an outstanding turn newer than this report''s last '
  'customer activity, so an unrelated Help message is never cleared.';

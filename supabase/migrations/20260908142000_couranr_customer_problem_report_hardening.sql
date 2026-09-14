begin;

-- CUS-004 post-cutover hardening. The initial substrate is already live in
-- production as 20260907234017_couranr_customer_problem_reports. This migration
-- is intentionally additive/replace-only.

create or replace function public.couranr_renew_customer_problem_evidence_grant(
  p_token_id uuid,
  p_evidence_id uuid
) returns public.couranr_customer_problem_evidence
language plpgsql security definer set search_path=''
as $fn$
declare
  v_delivery uuid;
  v_row public.couranr_customer_problem_evidence;
begin
  select h.delivery_id into v_delivery
  from public.couranr_help_access_tokens h
  where h.id=p_token_id and h.revoked_at is null and h.expires_at>now();

  if v_delivery is null then
    raise exception 'help_link_not_available' using errcode='CR404';
  end if;

  select e.* into v_row
  from public.couranr_customer_problem_evidence e
  join public.couranr_customer_problem_reports r on r.id=e.report_id
  where e.id=p_evidence_id and r.delivery_id=v_delivery
  for update of e;

  if v_row.id is null then
    raise exception 'problem_evidence_not_found' using errcode='CR404';
  end if;
  if v_row.upload_state='verified' then
    return v_row;
  end if;
  if v_row.upload_state<>'pending' then
    raise exception 'problem_evidence_not_open' using errcode='CR409';
  end if;
  if v_row.expires_at<=now() then
    raise exception 'problem_evidence_grant_expired' using errcode='CR409';
  end if;

  -- Supabase signed-upload URLs are two hours. Every time the server issues a
  -- fresh provider grant, renew the database envelope FIRST so DB authorization
  -- remains alive five minutes longer than that newly minted provider URL.
  update public.couranr_customer_problem_evidence
     set expires_at=now()+interval '125 minutes'
   where id=v_row.id
  returning * into v_row;

  return v_row;
end
$fn$;

revoke all on function public.couranr_renew_customer_problem_evidence_grant(
  uuid,uuid
) from public,anon,authenticated,service_role;
grant execute on function public.couranr_renew_customer_problem_evidence_grant(
  uuid,uuid
) to service_role;


create or replace function public.couranr_collect_expired_problem_evidence_ops(
  p_actor_user_id uuid,
  p_limit integer default 100
) returns table (
  out_id uuid,
  out_object_path text
)
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_role text;
begin
  select role into v_role
  from public.profiles
  where id=p_actor_user_id;

  if v_role is distinct from 'admin' then
    raise exception 'operations_access_required' using errcode='CR403';
  end if;
  if p_limit is null or p_limit<1 or p_limit>500 then
    raise exception 'cleanup_limit_invalid' using errcode='CR400';
  end if;

  -- Lock candidates so a concurrent customer grant renewal and this cleanup
  -- cannot disagree about whether a provider URL is still alive. Expired
  -- abandoned rows are returned again until Storage deletion succeeds.
  return query
  with candidates as (
    select e.id
    from public.couranr_customer_problem_evidence e
    where e.upload_state in ('pending','abandoned')
      and e.expires_at<=now()
    order by e.expires_at asc,e.id
    limit p_limit
    for update skip locked
  ),
  changed as (
    update public.couranr_customer_problem_evidence e
       set upload_state='abandoned'
      from candidates c
     where e.id=c.id
    returning e.id,e.object_path
  )
  select c.id,c.object_path
  from changed c;
end
$fn$;

revoke all on function public.couranr_collect_expired_problem_evidence_ops(
  uuid,integer
) from public,anon,authenticated,service_role;
grant execute on function public.couranr_collect_expired_problem_evidence_ops(
  uuid,integer
) to service_role;


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

comment on function public.couranr_renew_customer_problem_evidence_grant(uuid,uuid) is
  'CUS-004 provider-grant lifetime alignment. Renews a token-scoped pending DB '
  'envelope to 125 minutes immediately before a fresh two-hour Storage upload URL.';
comment on function public.couranr_collect_expired_problem_evidence_ops(uuid,integer) is
  'Operations-authorized orphan cleanup selector. Marks expired pending evidence '
  'abandoned and returns paths for retryable private Storage deletion.';

commit;

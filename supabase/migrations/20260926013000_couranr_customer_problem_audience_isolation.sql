-- CUS-004 audience isolation correction.
-- Sender, recipient and legacy Help audiences are separate privacy boundaries.
-- A valid token for one audience may not read, revise, upload evidence to or
-- submit the other audience's delivery-problem case.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

alter table public.couranr_customer_problem_reports
  add column customer_audience text;

update public.couranr_customer_problem_reports r
   set customer_audience=h.audience
  from public.couranr_help_access_tokens h
 where h.id=r.help_token_id;

do $$ begin
  if exists (
    select 1 from public.couranr_customer_problem_reports
     where customer_audience is null
        or customer_audience not in ('legacy','sender','recipient')
  ) then
    raise exception 'customer_problem_audience_backfill_failed';
  end if;
end $$;

alter table public.couranr_customer_problem_reports
  alter column customer_audience set not null;
alter table public.couranr_customer_problem_reports
  add constraint couranr_cpr_customer_audience_chk
  check(customer_audience in ('legacy','sender','recipient'));

drop index public.couranr_cpr_one_draft_per_delivery_uniq;
drop index public.couranr_cpr_one_open_per_delivery_uniq;
drop index public.couranr_cpr_submit_key_uniq;
create unique index couranr_cpr_one_draft_per_delivery_audience_uniq
  on public.couranr_customer_problem_reports(delivery_id,customer_audience)
  where report_state='draft';
create unique index couranr_cpr_one_open_per_delivery_audience_uniq
  on public.couranr_customer_problem_reports(delivery_id,customer_audience)
  where report_state<>'resolved';
create unique index couranr_cpr_submit_key_audience_uniq
  on public.couranr_customer_problem_reports(
    delivery_id,customer_audience,submit_idempotency_key
  )
  where submit_idempotency_key is not null;

create or replace function public.couranr_customer_problem_report_view(
  p_token_id uuid
) returns table (
  out_id uuid,
  out_problem_type text,
  out_details text,
  out_report_state text,
  out_evidence_count bigint,
  out_submitted_at timestamptz,
  out_resolved_at timestamptz,
  out_version integer,
  out_created_at timestamptz
)
language sql stable security definer set search_path=''
as $fn$
  select
    r.id,r.problem_type,r.details,r.report_state,
    (
      select count(*) from public.couranr_customer_problem_evidence e
      where e.report_id=r.id and e.upload_state='verified'
    ),
    r.submitted_at,r.resolved_at,r.version,r.created_at
  from public.couranr_customer_problem_reports r
  join public.couranr_help_access_tokens h
    on h.id=p_token_id
   and h.delivery_id=r.delivery_id
   and h.audience=r.customer_audience
   and h.revoked_at is null
   and h.expires_at>now()
  order by r.created_at desc;
$fn$;

create or replace function public.couranr_save_customer_problem_draft(
  p_token_id uuid,
  p_problem_type text,
  p_details text
) returns public.couranr_customer_problem_reports
language plpgsql security definer set search_path=''
as $fn$
declare
  v_delivery uuid;
  v_audience text;
  v_request uuid;
  v_participant uuid;
  v_row public.couranr_customer_problem_reports;
begin
  if p_problem_type not in ('damaged','missing','wrong_item','undelivered') then
    raise exception 'problem_type_invalid' using errcode='CR400';
  end if;
  if p_details is null or length(p_details)>4000 then
    raise exception 'problem_details_invalid' using errcode='CR400';
  end if;

  -- Serialize first-draft creation on the canonical delivery row. Without
  -- this lock, two concurrent first saves can both observe "no draft" and the
  -- loser reaches the partial unique index as an opaque database error.
  select d.id,d.request_id,h.audience
    into v_delivery,v_request,v_audience
  from public.couranr_deliveries d
  join public.couranr_help_access_tokens h on h.delivery_id=d.id
  where h.id=p_token_id and h.revoked_at is null and h.expires_at>now()
  for update of d;

  if v_delivery is null then
    raise exception 'help_link_not_available' using errcode='CR404';
  end if;

  select p.id into v_participant
  from public.couranr_conversation_participants p
  join public.couranr_conversations c on c.id=p.conversation_id
  where p.access_token_id=p_token_id
    and p.participant_kind='customer'
    and p.left_at is null
    and c.kind='delivery_help'
    and c.delivery_id=v_delivery
    and c.customer_audience=v_audience;

  if v_participant is null then
    raise exception 'help_link_not_available' using errcode='CR404';
  end if;

  select * into v_row
  from public.couranr_customer_problem_reports
  where delivery_id=v_delivery and customer_audience=v_audience and report_state<>'resolved'
  order by created_at desc
  limit 1
  for update;

  if v_row.id is not null and v_row.report_state<>'draft' then
    raise exception 'problem_report_open' using errcode='CR409';
  end if;

  if v_row.id is null then
    insert into public.couranr_customer_problem_reports(
      request_id,delivery_id,help_token_id,participant_id,customer_audience,
      problem_type,details,report_state
    ) values (
      v_request,v_delivery,p_token_id,v_participant,v_audience,
      p_problem_type,btrim(p_details),'draft'
    ) returning * into v_row;
  else
    update public.couranr_customer_problem_reports
       set help_token_id=p_token_id,
           participant_id=v_participant,
           problem_type=p_problem_type,
           details=btrim(p_details),
           version=version+1,
           updated_at=now()
     where id=v_row.id
    returning * into v_row;
  end if;

  insert into public.couranr_customer_problem_report_events(
    report_id,actor_kind,actor_user_id,command,from_state,to_state,metadata
  ) values (
    v_row.id,'customer',null,'draft_saved','draft','draft',
    jsonb_build_object('problemType',v_row.problem_type)
  );
  return v_row;
end
$fn$;

create or replace function public.couranr_prepare_customer_problem_evidence(
  p_token_id uuid,
  p_report_id uuid,
  p_client_evidence_id uuid,
  p_object_path text,
  p_expected_mime text,
  p_expected_bytes integer,
  p_evidence_sha256 text
) returns public.couranr_customer_problem_evidence
language plpgsql security definer set search_path=''
as $fn$
declare
  v_delivery uuid;
  v_audience text;
  v_report public.couranr_customer_problem_reports;
  v_existing public.couranr_customer_problem_evidence;
  v_row public.couranr_customer_problem_evidence;
  v_count integer;
  v_prefix text;
begin
  select h.delivery_id,h.audience into v_delivery,v_audience
  from public.couranr_help_access_tokens h
  where h.id=p_token_id and h.revoked_at is null and h.expires_at>now();

  if v_delivery is null then
    raise exception 'help_link_not_available' using errcode='CR404';
  end if;

  select * into v_report
  from public.couranr_customer_problem_reports
  where id=p_report_id and delivery_id=v_delivery and customer_audience=v_audience
  for update;

  if v_report.id is null then
    raise exception 'problem_report_not_found' using errcode='CR404';
  end if;
  if v_report.report_state not in ('draft','awaiting_evidence') then
    raise exception 'problem_evidence_not_open' using errcode='CR409';
  end if;
  if p_expected_mime not in ('image/jpeg','image/png','image/webp','image/heic') then
    raise exception 'problem_evidence_mime_invalid' using errcode='CR400';
  end if;
  if p_expected_bytes is null or p_expected_bytes<1 or p_expected_bytes>10485760 then
    raise exception 'problem_evidence_size_invalid' using errcode='CR400';
  end if;
  if p_evidence_sha256 is null or p_evidence_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'problem_evidence_digest_invalid' using errcode='CR400';
  end if;

  select * into v_existing
  from public.couranr_customer_problem_evidence
  where report_id=p_report_id and client_evidence_id=p_client_evidence_id;

  if v_existing.id is not null then
    if v_existing.expected_mime is distinct from p_expected_mime
       or v_existing.expected_bytes is distinct from p_expected_bytes
       or v_existing.evidence_sha256 is distinct from p_evidence_sha256 then
      raise exception 'problem_evidence_identity_conflict' using errcode='CR409';
    end if;

    if v_existing.upload_state='verified' then
      return v_existing;
    end if;

    if v_existing.expires_at<=now() then
      -- The server wrapper cleans the expired object's old storage path BEFORE
      -- calling this refresh. Reuse the logical client evidence identity but
      -- rotate its server-owned destination only after the provider URL is
      -- certainly dead.
      update public.couranr_customer_problem_evidence
         set object_path=p_object_path,
             upload_state='pending',
             finalized_at=null,
             storage_cleaned_at=null,
             expires_at=now()+interval '125 minutes'
       where id=v_existing.id
      returning * into v_existing;
      return v_existing;
    end if;

    if v_existing.upload_state='abandoned' then
      -- The old provider URL is still alive and still consumes one of the
      -- five technical grant slots until its two-hour lifetime ends.
      raise exception 'problem_evidence_grant_still_active' using errcode='CR409';
    end if;

    return v_existing;
  end if;

  select count(*) into v_count
  from public.couranr_customer_problem_evidence
  where report_id=p_report_id
    and (
      upload_state='verified'
      or (upload_state in ('pending','abandoned') and expires_at>now())
    );

  -- Technical storage/abuse guard, not a claim/compensation policy.
  if v_count>=5 then
    raise exception 'problem_evidence_limit_reached' using errcode='CR400';
  end if;

  v_prefix:='customer-problem/v1/'||v_delivery::text||'/'||
            p_report_id::text||'/'||p_client_evidence_id::text||'/';
  if p_object_path is null
     or left(p_object_path,length(v_prefix))<>v_prefix
     or p_object_path !~ '^customer-problem/v1/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{32}\.(jpg|png|webp|heic)$' then
    raise exception 'problem_evidence_path_invalid' using errcode='CR422';
  end if;

  insert into public.couranr_customer_problem_evidence(
    report_id,client_evidence_id,object_path,
    expected_mime,expected_bytes,evidence_sha256
  ) values (
    p_report_id,p_client_evidence_id,p_object_path,
    p_expected_mime,p_expected_bytes,p_evidence_sha256
  ) returning * into v_row;

  insert into public.couranr_customer_problem_report_events(
    report_id,actor_kind,actor_user_id,command,from_state,to_state,metadata
  ) values (
    p_report_id,'customer',null,'photo_prepared',
    v_report.report_state,v_report.report_state,
    jsonb_build_object('evidenceId',v_row.id)
  );
  return v_row;
end
$fn$;

create or replace function public.couranr_collect_expired_customer_problem_evidence(
  p_token_id uuid,
  p_report_id uuid
) returns table (
  out_id uuid,
  out_object_path text
)
language plpgsql security definer set search_path=''
as $fn$
declare
  v_delivery uuid;
  v_audience text;
  v_report public.couranr_customer_problem_reports;
begin
  select h.delivery_id,h.audience into v_delivery,v_audience
  from public.couranr_help_access_tokens h
  where h.id=p_token_id and h.revoked_at is null and h.expires_at>now();

  if v_delivery is null then
    raise exception 'help_link_not_available' using errcode='CR404';
  end if;

  select * into v_report
  from public.couranr_customer_problem_reports
  where id=p_report_id and delivery_id=v_delivery and customer_audience=v_audience
  for update;

  if v_report.id is null then
    raise exception 'problem_report_not_found' using errcode='CR404';
  end if;

  update public.couranr_customer_problem_evidence
     set upload_state='abandoned'
   where report_id=p_report_id
     and upload_state='pending'
     and expires_at<=now();

  -- These paths are safe to delete: our 125-minute envelope outlives the
  -- provider's two-hour signed-upload URL, so no valid upload grant remains.
  return query
  select e.id,e.object_path
  from public.couranr_customer_problem_evidence e
  where e.report_id=p_report_id
    and e.upload_state='abandoned'
    and e.expires_at<=now();
end
$fn$;

create or replace function public.couranr_abandon_customer_problem_evidence(
  p_token_id uuid,
  p_evidence_id uuid
) returns public.couranr_customer_problem_evidence
language plpgsql security definer set search_path=''
as $fn$
declare
  v_delivery uuid;
  v_audience text;
  v_row public.couranr_customer_problem_evidence;
begin
  select h.delivery_id,h.audience into v_delivery,v_audience
  from public.couranr_help_access_tokens h
  where h.id=p_token_id and h.revoked_at is null and h.expires_at>now();

  if v_delivery is null then
    raise exception 'help_link_not_available' using errcode='CR404';
  end if;

  select e.* into v_row
  from public.couranr_customer_problem_evidence e
  join public.couranr_customer_problem_reports r on r.id=e.report_id
  where e.id=p_evidence_id and r.delivery_id=v_delivery and r.customer_audience=v_audience
  for update of e;

  if v_row.id is null then
    raise exception 'problem_evidence_not_found' using errcode='CR404';
  end if;
  if v_row.upload_state='verified' then
    raise exception 'problem_evidence_already_verified' using errcode='CR409';
  end if;
  if v_row.upload_state='abandoned' then
    return v_row;
  end if;

  update public.couranr_customer_problem_evidence
     set upload_state='abandoned'
   where id=v_row.id
  returning * into v_row;

  return v_row;
end
$fn$;

create or replace function public.couranr_customer_problem_evidence_authorization(
  p_token_id uuid,
  p_evidence_id uuid
) returns table (
  out_id uuid,
  out_object_path text,
  out_expected_bytes integer,
  out_expected_mime text,
  out_upload_state text,
  out_expires_at timestamptz
)
language sql stable security definer set search_path=''
as $fn$
  select
    e.id,
    e.object_path,
    e.expected_bytes,
    e.expected_mime,
    e.upload_state,
    e.expires_at
  from public.couranr_customer_problem_evidence e
  join public.couranr_customer_problem_reports r on r.id=e.report_id
  join public.couranr_help_access_tokens h
    on h.id=p_token_id
   and h.delivery_id=r.delivery_id
   and h.audience=r.customer_audience
   and h.revoked_at is null
   and h.expires_at>now()
  where e.id=p_evidence_id;
$fn$;

create or replace function public.couranr_finalize_customer_problem_evidence(
  p_token_id uuid,
  p_evidence_id uuid,
  p_actual_path text,
  p_actual_bytes integer,
  p_actual_mime text
) returns public.couranr_customer_problem_evidence
language plpgsql security definer set search_path=''
as $fn$
declare
  v_delivery uuid;
  v_audience text;
  v_report public.couranr_customer_problem_reports;
  v_row public.couranr_customer_problem_evidence;
begin
  select h.delivery_id,h.audience into v_delivery,v_audience
  from public.couranr_help_access_tokens h
  where h.id=p_token_id and h.revoked_at is null and h.expires_at>now();

  if v_delivery is null then
    raise exception 'help_link_not_available' using errcode='CR404';
  end if;

  select e.* into v_row
  from public.couranr_customer_problem_evidence e
  join public.couranr_customer_problem_reports r on r.id=e.report_id
  where e.id=p_evidence_id and r.delivery_id=v_delivery and r.customer_audience=v_audience
  for update of e;

  if v_row.id is null then
    raise exception 'problem_evidence_not_found' using errcode='CR404';
  end if;

  -- Lost-response convergence: a finalized authorization stays successful even
  -- if Operations changed the report state after the upload.
  if v_row.upload_state='verified' then
    return v_row;
  end if;
  if v_row.upload_state<>'pending' then
    raise exception 'problem_evidence_not_open' using errcode='CR409';
  end if;
  if v_row.expires_at<=now() then
    -- The server wrapper persists abandonment and removes the object before
    -- returning an expired-grant refusal. A race that expires here still fails
    -- closed; the next prepare/submit cleanup converges it.
    raise exception 'problem_evidence_grant_expired' using errcode='CR409';
  end if;

  if p_actual_path is distinct from v_row.object_path
     or p_actual_bytes is distinct from v_row.expected_bytes
     or p_actual_mime is distinct from v_row.expected_mime then
    raise exception 'problem_evidence_storage_mismatch' using errcode='CR409';
  end if;

  select * into v_report
  from public.couranr_customer_problem_reports
  where id=v_row.report_id;

  update public.couranr_customer_problem_evidence
     set upload_state='verified',finalized_at=now()
   where id=v_row.id
  returning * into v_row;

  insert into public.couranr_customer_problem_report_events(
    report_id,actor_kind,actor_user_id,command,from_state,to_state,metadata
  ) values (
    v_row.report_id,'customer',null,'photo_verified',
    v_report.report_state,v_report.report_state,
    jsonb_build_object('evidenceId',v_row.id)
  );

  -- If Operations explicitly asked for evidence, a verified customer upload
  -- hands the support turn back to Couranr. This changes conversation
  -- ownership only; it does not invent a second response SLA or change report,
  -- delivery, custody or money state.
  if v_report.report_state='awaiting_evidence' then
    update public.couranr_conversations c
       set waiting_on='couranr',
           awaiting_reply_kind='customer',
           updated_at=now()
      from public.couranr_conversation_participants p
     where p.id=v_report.participant_id
       and c.id=p.conversation_id;
  end if;

  return v_row;
end
$fn$;

create or replace function public.couranr_submit_customer_problem_report(
  p_token_id uuid,
  p_report_id uuid,
  p_idempotency_key text
) returns public.couranr_customer_problem_reports
language plpgsql security definer set search_path=''
as $fn$
declare
  v_delivery uuid;
  v_audience text;
  v_participant uuid;
  v_conversation uuid;
  v_row public.couranr_customer_problem_reports;
  v_pending integer;
  v_now timestamptz:=now();
begin
  if p_idempotency_key is null or btrim(p_idempotency_key)='' then
    raise exception 'idempotency_key_required' using errcode='CR400';
  end if;

  select h.delivery_id,h.audience into v_delivery,v_audience
  from public.couranr_help_access_tokens h
  where h.id=p_token_id and h.revoked_at is null and h.expires_at>now();

  if v_delivery is null then
    raise exception 'help_link_not_available' using errcode='CR404';
  end if;

  select p.id,p.conversation_id into v_participant,v_conversation
  from public.couranr_conversation_participants p
  join public.couranr_conversations c on c.id=p.conversation_id
  where p.access_token_id=p_token_id
    and p.participant_kind='customer'
    and p.left_at is null
    and c.kind='delivery_help'
    and c.delivery_id=v_delivery
    and c.customer_audience=v_audience;

  if v_participant is null then
    raise exception 'help_link_not_available' using errcode='CR404';
  end if;

  select * into v_row
  from public.couranr_customer_problem_reports
  where id=p_report_id and delivery_id=v_delivery and customer_audience=v_audience
  for update;

  if v_row.id is null then
    raise exception 'problem_report_not_found' using errcode='CR404';
  end if;

  -- LOST-RESPONSE RULE: replay resolves before current-state eligibility.
  if v_row.report_state<>'draft' then
    if v_row.submit_idempotency_key=p_idempotency_key then
      return v_row;
    end if;
    raise exception 'problem_report_already_submitted' using errcode='CR409';
  end if;

  if length(btrim(v_row.details))<1 then
    raise exception 'problem_details_required' using errcode='CR400';
  end if;

  -- The server wrapper cleans expired paths before this command. Never
  -- silently convert a pending row here because doing so would lose the object
  -- path before Storage cleanup. A race that expires between cleanup and this
  -- lock simply asks the caller to retry.
  select count(*) into v_pending
  from public.couranr_customer_problem_evidence
  where report_id=v_row.id
    and (
      upload_state='pending'
      or (upload_state='abandoned' and expires_at>v_now)
    );
  if v_pending>0 then
    raise exception 'problem_evidence_upload_pending' using errcode='CR412';
  end if;

  update public.couranr_customer_problem_reports
     set report_state='reported',
         submit_idempotency_key=p_idempotency_key,
         submitted_at=v_now,
         version=version+1,
         updated_at=v_now
   where id=v_row.id and report_state='draft'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'problem_report_changed' using errcode='CR409';
  end if;

  insert into public.couranr_customer_problem_report_events(
    report_id,actor_kind,actor_user_id,command,from_state,to_state,metadata
  ) values (
    v_row.id,'customer',null,'submit_report','draft','reported',
    jsonb_build_object('problemType',v_row.problem_type)
  );

  -- CUS-004 is Delivery Help and inherits HRS-002 operating minutes.
  update public.couranr_conversations c
     set received_at=coalesce(c.received_at,v_now),
         response_due_at=coalesce(
           c.response_due_at,
           public.couranr_add_operating_minutes(v_now,15)
         ),
         next_operating_period_at=coalesce(
           c.next_operating_period_at,
           case
             when public.couranr_is_within_operating_hours(v_now) then null
             else public.couranr_next_operating_period_start(v_now)
           end
         ),
         waiting_on='couranr',
         awaiting_reply_kind=coalesce(c.awaiting_reply_kind,'customer'),
         status=case when c.status in ('resolved','closed') then 'open' else c.status end,
         updated_at=v_now
   where c.id=v_conversation;

  return v_row;
end
$fn$;

create or replace function public.couranr_renew_customer_problem_evidence_grant(
  p_token_id uuid,
  p_evidence_id uuid
) returns public.couranr_customer_problem_evidence
language plpgsql security definer set search_path=''
as $fn$
declare
  v_delivery uuid;
  v_audience text;
  v_row public.couranr_customer_problem_evidence;
begin
  select h.delivery_id,h.audience into v_delivery,v_audience
  from public.couranr_help_access_tokens h
  where h.id=p_token_id and h.revoked_at is null and h.expires_at>now();

  if v_delivery is null then
    raise exception 'help_link_not_available' using errcode='CR404';
  end if;

  select e.* into v_row
  from public.couranr_customer_problem_evidence e
  join public.couranr_customer_problem_reports r on r.id=e.report_id
  where e.id=p_evidence_id and r.delivery_id=v_delivery and r.customer_audience=v_audience
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

-- Re-state the customer-problem RPC ACLs after every replacement. These are
-- service-role adapters behind token validation; browser roles never execute
-- them directly.
revoke all on function public.couranr_customer_problem_report_view(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_customer_problem_report_view(uuid) to service_role;

revoke all on function public.couranr_save_customer_problem_draft(uuid,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_save_customer_problem_draft(uuid,text,text) to service_role;

revoke all on function public.couranr_prepare_customer_problem_evidence(
  uuid,uuid,uuid,text,text,integer,text
) from public,anon,authenticated,service_role;
grant execute on function public.couranr_prepare_customer_problem_evidence(
  uuid,uuid,uuid,text,text,integer,text
) to service_role;

revoke all on function public.couranr_collect_expired_customer_problem_evidence(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_collect_expired_customer_problem_evidence(uuid,uuid)
  to service_role;

revoke all on function public.couranr_abandon_customer_problem_evidence(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_abandon_customer_problem_evidence(uuid,uuid)
  to service_role;

revoke all on function public.couranr_customer_problem_evidence_authorization(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_customer_problem_evidence_authorization(uuid,uuid)
  to service_role;

revoke all on function public.couranr_finalize_customer_problem_evidence(
  uuid,uuid,text,integer,text
) from public,anon,authenticated,service_role;
grant execute on function public.couranr_finalize_customer_problem_evidence(
  uuid,uuid,text,integer,text
) to service_role;

revoke all on function public.couranr_submit_customer_problem_report(uuid,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_submit_customer_problem_report(uuid,uuid,text)
  to service_role;

revoke all on function public.couranr_renew_customer_problem_evidence_grant(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_renew_customer_problem_evidence_grant(uuid,uuid)
  to service_role;

comment on column public.couranr_customer_problem_reports.customer_audience is
  'Privacy boundary inherited from the issuing Help token. Sender, recipient and legacy cases for the same delivery are distinct.';

commit;

-- CUS-004 — token-scoped customer delivery-problem reporting.
--
-- Customer authority stops at report evidence. A Delivery Help token may create
-- and submit a report for its one delivery and attach private photos. It cannot
-- create/mutate couranr_delivery_incidents, delivery lifecycle, custody, money,
-- returns, refunds, payer facts or merchandise responsibility. Operations alone
-- moves a submitted report through review states.
--
-- Additive and rolling-safe: old application code ignores every object here.

begin;

create table if not exists public.couranr_customer_problem_reports (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.couranr_delivery_requests(id)
    on update cascade on delete restrict,
  delivery_id uuid not null references public.couranr_deliveries(id)
    on update cascade on delete restrict,
  help_token_id uuid not null references public.couranr_help_access_tokens(id)
    on update cascade on delete restrict,
  participant_id uuid not null references public.couranr_conversation_participants(id)
    on update cascade on delete restrict,
  problem_type text not null,
  details text not null default '',
  report_state text not null default 'draft',
  submit_idempotency_key text,
  submitted_at timestamptz,
  resolved_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint couranr_cpr_problem_chk check (
    problem_type in ('damaged','missing','wrong_item','undelivered')
  ),
  constraint couranr_cpr_state_chk check (
    report_state in ('draft','reported','awaiting_evidence','under_review','resolved')
  ),
  constraint couranr_cpr_details_chk check (length(details) <= 4000),
  constraint couranr_cpr_version_chk check (version >= 1),
  constraint couranr_cpr_submit_stamp_chk check (
    (report_state='draft' and submitted_at is null and submit_idempotency_key is null)
    or
    (report_state<>'draft' and submitted_at is not null and submit_idempotency_key is not null)
  ),
  constraint couranr_cpr_resolved_stamp_chk check (
    report_state<>'resolved' or resolved_at is not null
  )
);

create unique index if not exists couranr_cpr_one_draft_per_delivery_uniq
  on public.couranr_customer_problem_reports(delivery_id)
  where report_state='draft';

create unique index if not exists couranr_cpr_submit_key_uniq
  on public.couranr_customer_problem_reports(delivery_id,submit_idempotency_key)
  where submit_idempotency_key is not null;

create index if not exists couranr_cpr_delivery_idx
  on public.couranr_customer_problem_reports(delivery_id,created_at desc);
create index if not exists couranr_cpr_state_idx
  on public.couranr_customer_problem_reports(report_state,created_at);

alter table public.couranr_customer_problem_reports enable row level security;
revoke all on public.couranr_customer_problem_reports
  from public,anon,authenticated,service_role;
grant select,insert,update on public.couranr_customer_problem_reports to service_role;

create table if not exists public.couranr_customer_problem_evidence (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.couranr_customer_problem_reports(id)
    on update cascade on delete restrict,
  client_evidence_id uuid not null,
  storage_bucket text not null default 'delivery-photos',
  object_path text not null,
  expected_mime text not null,
  expected_bytes integer not null,
  evidence_sha256 text not null,
  upload_state text not null default 'pending',
  finalized_at timestamptz,
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  created_at timestamptz not null default now(),
  constraint couranr_cpe_client_uniq unique(report_id,client_evidence_id),
  constraint couranr_cpe_path_uniq unique(object_path),
  constraint couranr_cpe_bucket_chk check (storage_bucket='delivery-photos'),
  constraint couranr_cpe_path_chk check (
    object_path ~ '^customer-problem/v1/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{32}\.(jpg|png|webp|heic)$'
  ),
  constraint couranr_cpe_mime_chk check (
    expected_mime in ('image/jpeg','image/png','image/webp','image/heic')
  ),
  constraint couranr_cpe_bytes_chk check (expected_bytes between 1 and 10485760),
  constraint couranr_cpe_sha_chk check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint couranr_cpe_state_chk check (upload_state in ('pending','verified','abandoned')),
  constraint couranr_cpe_expiry_chk check (expires_at > created_at),
  constraint couranr_cpe_finalize_chk check (
    (upload_state='verified' and finalized_at is not null)
    or (upload_state<>'verified' and finalized_at is null)
  )
);

create index if not exists couranr_cpe_report_idx
  on public.couranr_customer_problem_evidence(report_id,created_at);

alter table public.couranr_customer_problem_evidence enable row level security;
revoke all on public.couranr_customer_problem_evidence
  from public,anon,authenticated,service_role;
grant select,insert,update on public.couranr_customer_problem_evidence to service_role;

create table if not exists public.couranr_customer_problem_report_events (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.couranr_customer_problem_reports(id)
    on update cascade on delete restrict,
  actor_kind text not null,
  actor_user_id uuid references public.profiles(id)
    on update cascade on delete restrict,
  command text not null,
  from_state text,
  to_state text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint couranr_cpre_actor_chk check (actor_kind in ('customer','operations')),
  constraint couranr_cpre_command_chk check (
    command in (
      'draft_saved','photo_prepared','photo_verified','submit_report',
      'start_review','request_evidence','resolve_report'
    )
  ),
  constraint couranr_cpre_state_chk check (
    to_state in ('draft','reported','awaiting_evidence','under_review','resolved')
  ),
  constraint couranr_cpre_from_state_chk check (
    from_state is null or
    from_state in ('draft','reported','awaiting_evidence','under_review','resolved')
  ),
  constraint couranr_cpre_metadata_chk check (jsonb_typeof(metadata)='object')
);

create index if not exists couranr_cpre_report_idx
  on public.couranr_customer_problem_report_events(report_id,created_at);

alter table public.couranr_customer_problem_report_events enable row level security;
revoke all on public.couranr_customer_problem_report_events
  from public,anon,authenticated,service_role;
grant select,insert on public.couranr_customer_problem_report_events to service_role;

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
   and h.revoked_at is null
   and h.expires_at>now()
  order by r.created_at desc;
$fn$;

revoke all on function public.couranr_customer_problem_report_view(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_customer_problem_report_view(uuid) to service_role;

create or replace function public.couranr_save_customer_problem_draft(
  p_token_id uuid,
  p_problem_type text,
  p_details text
) returns public.couranr_customer_problem_reports
language plpgsql security definer set search_path=''
as $fn$
declare
  v_delivery uuid;
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
  select d.id,d.request_id
    into v_delivery,v_request
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
    and c.delivery_id=v_delivery;

  if v_participant is null then
    raise exception 'help_link_not_available' using errcode='CR404';
  end if;

  select * into v_row
  from public.couranr_customer_problem_reports
  where delivery_id=v_delivery and report_state='draft'
  for update;

  if v_row.id is null then
    insert into public.couranr_customer_problem_reports(
      request_id,delivery_id,help_token_id,participant_id,
      problem_type,details,report_state
    ) values (
      v_request,v_delivery,p_token_id,v_participant,
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

revoke all on function public.couranr_save_customer_problem_draft(uuid,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_save_customer_problem_draft(uuid,text,text)
  to service_role;

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
  v_report public.couranr_customer_problem_reports;
  v_existing public.couranr_customer_problem_evidence;
  v_row public.couranr_customer_problem_evidence;
  v_count integer;
  v_prefix text;
begin
  select h.delivery_id into v_delivery
  from public.couranr_help_access_tokens h
  where h.id=p_token_id and h.revoked_at is null and h.expires_at>now();

  if v_delivery is null then
    raise exception 'help_link_not_available' using errcode='CR404';
  end if;

  select * into v_report
  from public.couranr_customer_problem_reports
  where id=p_report_id and delivery_id=v_delivery
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
    if v_existing.upload_state='pending' and v_existing.expires_at<=now() then
      -- No verified evidence exists yet. Refresh only the short-lived upload
      -- authorization so a reload can recover instead of leaving a permanent
      -- pending row that blocks submission.
      update public.couranr_customer_problem_evidence
         set object_path=p_object_path,
             upload_state='pending',
             finalized_at=null,
             expires_at=now()+interval '15 minutes'
       where id=v_existing.id
      returning * into v_existing;
    end if;
    return v_existing;
  end if;

  update public.couranr_customer_problem_evidence
     set upload_state='abandoned'
   where report_id=p_report_id
     and upload_state='pending'
     and expires_at<=now();

  select count(*) into v_count
  from public.couranr_customer_problem_evidence
  where report_id=p_report_id
    and (
      upload_state='verified'
      or (upload_state='pending' and expires_at>now())
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

revoke all on function public.couranr_prepare_customer_problem_evidence(
  uuid,uuid,uuid,text,text,integer,text
) from public,anon,authenticated,service_role;
grant execute on function public.couranr_prepare_customer_problem_evidence(
  uuid,uuid,uuid,text,text,integer,text
) to service_role;

create or replace function public.couranr_refresh_customer_problem_evidence(
  p_token_id uuid,
  p_evidence_id uuid,
  p_object_path text
) returns public.couranr_customer_problem_evidence
language plpgsql security definer set search_path=''
as $fn$
declare
  v_delivery uuid;
  v_report_id uuid;
  v_client_evidence_id uuid;
  v_row public.couranr_customer_problem_evidence;
  v_prefix text;
begin
  select h.delivery_id into v_delivery
  from public.couranr_help_access_tokens h
  where h.id=p_token_id and h.revoked_at is null and h.expires_at>now();

  if v_delivery is null then
    raise exception 'help_link_not_available' using errcode='CR404';
  end if;

  select e,r.id,e.client_evidence_id
    into v_row,v_report_id,v_client_evidence_id
  from public.couranr_customer_problem_evidence e
  join public.couranr_customer_problem_reports r on r.id=e.report_id
  where e.id=p_evidence_id
    and r.delivery_id=v_delivery
    and r.report_state in ('draft','awaiting_evidence')
  for update of e;

  if v_row.id is null then
    raise exception 'problem_evidence_not_found' using errcode='CR404';
  end if;
  if v_row.upload_state<>'pending' then
    raise exception 'problem_evidence_not_open' using errcode='CR409';
  end if;

  v_prefix:='customer-problem/v1/'||v_delivery::text||'/'||
            v_report_id::text||'/'||v_client_evidence_id::text||'/';
  if p_object_path is null
     or left(p_object_path,length(v_prefix))<>v_prefix
     or p_object_path !~ '^customer-problem/v1/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{32}\.(jpg|png|webp|heic)$' then
    raise exception 'problem_evidence_path_invalid' using errcode='CR422';
  end if;

  -- Server-only recovery for a path whose stored bytes are known to disagree
  -- with the immutable expected envelope. Rotate to a fresh opaque object
  -- rather than overwriting ambiguous evidence in place.
  update public.couranr_customer_problem_evidence
     set object_path=p_object_path,
         expires_at=now()+interval '15 minutes'
   where id=v_row.id
  returning * into v_row;

  insert into public.couranr_customer_problem_report_events(
    report_id,actor_kind,actor_user_id,command,from_state,to_state,metadata
  )
  select
    r.id,'customer',null,'photo_prepared',r.report_state,r.report_state,
    jsonb_build_object('evidenceId',v_row.id,'reason','storage_mismatch_refresh')
  from public.couranr_customer_problem_reports r
  where r.id=v_row.report_id;

  return v_row;
end
$fn$;

revoke all on function public.couranr_refresh_customer_problem_evidence(
  uuid,uuid,text
) from public,anon,authenticated,service_role;
grant execute on function public.couranr_refresh_customer_problem_evidence(
  uuid,uuid,text
) to service_role;

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
  v_report public.couranr_customer_problem_reports;
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

  -- Lost-response convergence: a finalized authorization stays successful even
  -- if Operations changed the report state after the upload.
  if v_row.upload_state='verified' then
    return v_row;
  end if;
  if v_row.upload_state<>'pending' then
    raise exception 'problem_evidence_not_open' using errcode='CR409';
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

revoke all on function public.couranr_finalize_customer_problem_evidence(
  uuid,uuid,text,integer,text
) from public,anon,authenticated,service_role;
grant execute on function public.couranr_finalize_customer_problem_evidence(
  uuid,uuid,text,integer,text
) to service_role;

create or replace function public.couranr_submit_customer_problem_report(
  p_token_id uuid,
  p_report_id uuid,
  p_idempotency_key text
) returns public.couranr_customer_problem_reports
language plpgsql security definer set search_path=''
as $fn$
declare
  v_delivery uuid;
  v_participant uuid;
  v_conversation uuid;
  v_row public.couranr_customer_problem_reports;
  v_pending integer;
  v_now timestamptz:=now();
begin
  if p_idempotency_key is null or btrim(p_idempotency_key)='' then
    raise exception 'idempotency_key_required' using errcode='CR400';
  end if;

  select h.delivery_id into v_delivery
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
    and c.delivery_id=v_delivery;

  if v_participant is null then
    raise exception 'help_link_not_available' using errcode='CR404';
  end if;

  select * into v_row
  from public.couranr_customer_problem_reports
  where id=p_report_id and delivery_id=v_delivery
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

  update public.couranr_customer_problem_evidence
     set upload_state='abandoned'
   where report_id=v_row.id and upload_state='pending' and expires_at<=v_now;

  select count(*) into v_pending
  from public.couranr_customer_problem_evidence
  where report_id=v_row.id and upload_state='pending' and expires_at>v_now;
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

revoke all on function public.couranr_submit_customer_problem_report(uuid,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_submit_customer_problem_report(uuid,uuid,text)
  to service_role;

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
    -- "waiting_on" names the party who OWES the next response. The customer
    -- can see awaiting_evidence on CUS-004, so this human Operations action is
    -- a real response and the turn now belongs to the customer. Mirror the
    -- established conversation response bookkeeping rather than leaving an
    -- answered case ageing in the Operations overdue queue.
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

comment on table public.couranr_customer_problem_reports is
  'CUS-004 customer-authored delivery-problem report evidence. Customer may '
  'draft/submit only; Operations owns review-state transitions. No delivery, '
  'money, custody, return, refund or merchandise-responsibility mutation.';
comment on table public.couranr_customer_problem_evidence is
  'Private CUS-004 photo evidence. Server-owned object path; signed URLs are '
  'short-lived and never persisted.';

commit;

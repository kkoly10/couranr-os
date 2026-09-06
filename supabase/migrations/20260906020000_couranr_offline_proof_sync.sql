begin;

/*
 * P7-004 / DRV-007 — Offline Proof Sync.
 *
 * Additive and rolling-deploy safe:
 * - legacy proof rows and the legacy create/finalize RPCs are untouched;
 * - V2 evidence identity is opt-in through nullable columns + V2 RPCs;
 * - old app instances continue using the old functions during a rolling deploy.
 *
 * The stable client_evidence_id exists only to reconcile retries of the SAME
 * physical evidence. It is not authorization. Every V2 command still verifies
 * the driver/delivery relationship server-side.
 */

/* --------------------------- stable evidence identity ------------------- */

alter table public.couranr_proof_uploads
  add column if not exists client_evidence_id uuid,
  add column if not exists evidence_sha256 text,
  add column if not exists captured_at timestamptz,
  add column if not exists captured_latitude numeric(9,6),
  add column if not exists captured_longitude numeric(9,6),
  add column if not exists captured_accuracy_m numeric(8,2),
  add column if not exists discrepancy_id uuid;

alter table public.couranr_delivery_proofs
  add column if not exists client_evidence_id uuid,
  add column if not exists evidence_sha256 text,
  add column if not exists captured_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='couranr_pu_v2_identity_shape_chk') then
    alter table public.couranr_proof_uploads
      add constraint couranr_pu_v2_identity_shape_chk check (
        (client_evidence_id is null and evidence_sha256 is null and captured_at is null)
        or
        (client_evidence_id is not null and evidence_sha256 ~ '^[0-9a-f]{64}$' and captured_at is not null)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname='couranr_pu_v2_location_pair_chk') then
    alter table public.couranr_proof_uploads
      add constraint couranr_pu_v2_location_pair_chk
      check ((captured_latitude is null) = (captured_longitude is null));
  end if;
  if not exists (select 1 from pg_constraint where conname='couranr_pu_v2_lat_chk') then
    alter table public.couranr_proof_uploads
      add constraint couranr_pu_v2_lat_chk
      check (captured_latitude is null or captured_latitude between -90 and 90);
  end if;
  if not exists (select 1 from pg_constraint where conname='couranr_pu_v2_lng_chk') then
    alter table public.couranr_proof_uploads
      add constraint couranr_pu_v2_lng_chk
      check (captured_longitude is null or captured_longitude between -180 and 180);
  end if;
  if not exists (select 1 from pg_constraint where conname='couranr_pu_v2_accuracy_chk') then
    alter table public.couranr_proof_uploads
      add constraint couranr_pu_v2_accuracy_chk
      check (captured_accuracy_m is null or captured_accuracy_m >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='couranr_pu_v2_discrepancy_fk') then
    alter table public.couranr_proof_uploads
      add constraint couranr_pu_v2_discrepancy_fk
      foreign key (discrepancy_id)
      references public.couranr_pickup_discrepancies(id)
      on update cascade on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname='couranr_dp_v2_identity_shape_chk') then
    alter table public.couranr_delivery_proofs
      add constraint couranr_dp_v2_identity_shape_chk check (
        (client_evidence_id is null and evidence_sha256 is null and captured_at is null)
        or
        (client_evidence_id is not null and evidence_sha256 ~ '^[0-9a-f]{64}$' and captured_at is not null)
      );
  end if;
end
$$;

create index if not exists couranr_pu_client_evidence_idx
  on public.couranr_proof_uploads(client_evidence_id)
  where client_evidence_id is not null;

create unique index if not exists couranr_dp_client_evidence_uniq
  on public.couranr_delivery_proofs(client_evidence_id)
  where client_evidence_id is not null;

comment on column public.couranr_proof_uploads.client_evidence_id is
  'Opaque client-generated UUID used only to reconcile retries of one immutable evidence envelope.';
comment on column public.couranr_proof_uploads.evidence_sha256 is
  'Client-computed digest used to detect local queue corruption and enforce retry identity. Storage size/MIME remain server-verified.';
comment on column public.couranr_proof_uploads.captured_at is
  'Device-reported capture instant. finalized_at remains the canonical server verification instant.';

/* --------------------------- terminal proof-sync attention -------------- */

create table if not exists public.couranr_proof_sync_failures (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.couranr_delivery_requests(id)
    on update cascade on delete restrict,
  delivery_id uuid not null references public.couranr_deliveries(id)
    on update cascade on delete restrict,
  assignment_id uuid references public.couranr_delivery_assignments(id)
    on update cascade on delete restrict,
  driver_id uuid not null references public.couranr_drivers(id)
    on update cascade on delete restrict,
  client_evidence_id uuid not null,
  proof_stage text not null,
  proof_type text not null,
  reason text not null,
  attempts integer not null,
  failure_state text not null default 'open',
  first_reported_at timestamptz not null default now(),
  last_reported_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint couranr_psf_stage_chk check (proof_stage in ('pickup','pickup_discrepancy','dropoff')),
  constraint couranr_psf_reason_chk check (
    reason in ('local_evidence_corrupt','assignment_or_stage_changed','server_rejected','retry_limit')
  ),
  constraint couranr_psf_attempts_chk check (attempts between 1 and 100),
  constraint couranr_psf_state_chk check (failure_state in ('open','resolved')),
  constraint couranr_psf_resolved_chk check ((failure_state='resolved')=(resolved_at is not null))
);

create unique index if not exists couranr_psf_client_evidence_uniq
  on public.couranr_proof_sync_failures(client_evidence_id);
create index if not exists couranr_psf_request_open_idx
  on public.couranr_proof_sync_failures(request_id,last_reported_at)
  where failure_state='open';

alter table public.couranr_proof_sync_failures enable row level security;
revoke all on public.couranr_proof_sync_failures from public,anon,authenticated,service_role;
grant select,insert,update on public.couranr_proof_sync_failures to service_role;

/* --------------------------- prepare / dedupe --------------------------- */

create or replace function public.couranr_prepare_proof_upload_v2(
  p_delivery_id uuid,
  p_actor_user_id uuid,
  p_proof_stage text,
  p_proof_type text,
  p_storage_bucket text,
  p_object_path text,
  p_expected_mime text,
  p_expected_bytes integer,
  p_upload_nonce text,
  p_ttl_minutes integer,
  p_client_evidence_id uuid,
  p_evidence_sha256 text,
  p_captured_at timestamptz,
  p_latitude numeric,
  p_longitude numeric,
  p_accuracy_m numeric,
  p_discrepancy_id uuid
)
returns jsonb
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_drv public.couranr_drivers;
  v_asg public.couranr_delivery_assignments;
  v_dlv public.couranr_deliveries;
  v_pr public.couranr_delivery_proofs;
  v_up public.couranr_proof_uploads;
  v_lat numeric(9,6);
  v_lng numeric(9,6);
  v_acc numeric(8,2);
begin
  if p_client_evidence_id is null
     or p_evidence_sha256 !~ '^[0-9a-f]{64}$'
     or p_captured_at is null then
    raise exception 'invalid_evidence_identity' using errcode='CR422';
  end if;
  if p_expected_bytes is null or p_expected_bytes <= 0 or p_expected_bytes > 10485760 then
    raise exception 'invalid_evidence_size' using errcode='CR422';
  end if;
  if p_expected_mime not in ('image/jpeg','image/png','image/webp','image/heic') then
    raise exception 'invalid_evidence_mime' using errcode='CR422';
  end if;
  if (p_latitude is null) <> (p_longitude is null) then
    raise exception 'invalid_evidence_location' using errcode='CR422';
  end if;
  if p_latitude is not null and (p_latitude < -90 or p_latitude > 90) then
    raise exception 'invalid_evidence_location' using errcode='CR422';
  end if;
  if p_longitude is not null and (p_longitude < -180 or p_longitude > 180) then
    raise exception 'invalid_evidence_location' using errcode='CR422';
  end if;
  if p_accuracy_m is not null and p_accuracy_m < 0 then
    raise exception 'invalid_evidence_location' using errcode='CR422';
  end if;

  v_lat := case when p_latitude is null then null else round(p_latitude,6) end;
  v_lng := case when p_longitude is null then null else round(p_longitude,6) end;
  v_acc := case when p_accuracy_m is null then null else round(p_accuracy_m,2) end;

  select * into v_drv from public.couranr_drivers where user_id=p_actor_user_id;
  if not found then raise exception 'not_your_delivery' using errcode='CR404'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_client_evidence_id::text,0));

  /* A dropped response after successful finalization converges here first. */
  select * into v_pr
    from public.couranr_delivery_proofs
   where client_evidence_id=p_client_evidence_id;
  if found then
    if v_pr.delivery_id is distinct from p_delivery_id
       or v_pr.actor_driver_id is distinct from v_drv.id
       or v_pr.proof_stage is distinct from p_proof_stage
       or v_pr.proof_type is distinct from p_proof_type
       or v_pr.mime_type is distinct from p_expected_mime
       or v_pr.byte_size is distinct from p_expected_bytes
       or v_pr.evidence_sha256 is distinct from p_evidence_sha256
       or v_pr.captured_at is distinct from p_captured_at
       or v_pr.captured_latitude is distinct from v_lat
       or v_pr.captured_longitude is distinct from v_lng
       or v_pr.captured_accuracy_m is distinct from v_acc
       or v_pr.discrepancy_id is distinct from p_discrepancy_id then
      raise exception 'evidence_identity_conflict' using errcode='CR409';
    end if;
    update public.couranr_proof_sync_failures
       set failure_state='resolved',resolved_at=now(),last_reported_at=now()
     where client_evidence_id=p_client_evidence_id and failure_state='open';
    return jsonb_build_object(
      'status','verified','proofId',v_pr.id,'proofStage',v_pr.proof_stage,
      'proofType',v_pr.proof_type,'finalizedAt',v_pr.finalized_at,'byteSize',v_pr.byte_size
    );
  end if;

  v_asg := public.couranr_driver_assignment_for(p_delivery_id,p_actor_user_id);
  select * into v_dlv from public.couranr_deliveries where id=p_delivery_id;

  if p_proof_stage in ('pickup','pickup_discrepancy') and v_dlv.fulfillment_state <> 'at_pickup' then
    raise exception 'proof_stage_not_valid_here' using errcode='CR409';
  end if;
  if p_proof_stage='dropoff' and v_dlv.fulfillment_state <> 'at_dropoff' then
    raise exception 'proof_stage_not_valid_here' using errcode='CR409';
  end if;

  select * into v_up
    from public.couranr_proof_uploads
   where client_evidence_id=p_client_evidence_id
   order by created_at desc
   limit 1
   for update;

  if found then
    if v_up.delivery_id is distinct from p_delivery_id
       or v_up.assignment_id is distinct from v_asg.id
       or v_up.proof_stage is distinct from p_proof_stage
       or v_up.proof_type is distinct from p_proof_type
       or v_up.expected_mime is distinct from p_expected_mime
       or v_up.expected_bytes is distinct from p_expected_bytes
       or v_up.evidence_sha256 is distinct from p_evidence_sha256
       or v_up.captured_at is distinct from p_captured_at
       or v_up.captured_latitude is distinct from v_lat
       or v_up.captured_longitude is distinct from v_lng
       or v_up.captured_accuracy_m is distinct from v_acc
       or v_up.discrepancy_id is distinct from p_discrepancy_id then
      raise exception 'evidence_identity_conflict' using errcode='CR409';
    end if;

    if v_up.upload_state='issued' and v_up.expires_at > now() then
      return jsonb_build_object(
        'status','upload','uploadId',v_up.id,'objectPath',v_up.object_path,
        'expectedBytes',v_up.expected_bytes,'expectedMime',v_up.expected_mime,
        'expiresAt',v_up.expires_at
      );
    end if;

    if v_up.upload_state='issued' then
      update public.couranr_proof_uploads
         set upload_state='expired',version=version+1,updated_at=now()
       where id=v_up.id;
    elsif v_up.upload_state='consumed' then
      raise exception 'evidence_finalization_inconsistent' using errcode='CR409';
    end if;
  end if;

  insert into public.couranr_proof_uploads(
    delivery_id,assignment_id,assignment_version,proof_stage,proof_type,
    storage_bucket,object_path,expected_mime,expected_bytes,
    upload_nonce,upload_state,issued_to_driver,issued_at,expires_at,
    client_evidence_id,evidence_sha256,captured_at,
    captured_latitude,captured_longitude,captured_accuracy_m,discrepancy_id
  ) values (
    p_delivery_id,v_asg.id,v_asg.version,p_proof_stage,p_proof_type,
    p_storage_bucket,p_object_path,p_expected_mime,p_expected_bytes,
    p_upload_nonce,'issued',v_drv.id,now(),
    now()+make_interval(mins=>greatest(coalesce(p_ttl_minutes,15),1)),
    p_client_evidence_id,p_evidence_sha256,p_captured_at,
    v_lat,v_lng,v_acc,p_discrepancy_id
  )
  returning * into v_up;

  return jsonb_build_object(
    'status','upload','uploadId',v_up.id,'objectPath',v_up.object_path,
    'expectedBytes',v_up.expected_bytes,'expectedMime',v_up.expected_mime,
    'expiresAt',v_up.expires_at
  );
end
$fn$;

create or replace function public.couranr_abandon_proof_upload_v2(
  p_upload_id uuid,
  p_actor_user_id uuid,
  p_client_evidence_id uuid
)
returns public.couranr_proof_uploads
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_up public.couranr_proof_uploads;
  v_asg public.couranr_delivery_assignments;
begin
  select * into v_up from public.couranr_proof_uploads where id=p_upload_id for update;
  if not found then raise exception 'upload_not_found' using errcode='CR404'; end if;
  if v_up.client_evidence_id is null or v_up.client_evidence_id is distinct from p_client_evidence_id then
    raise exception 'evidence_identity_conflict' using errcode='CR409';
  end if;
  v_asg := public.couranr_driver_assignment_for(v_up.delivery_id,p_actor_user_id);
  if v_asg.id is distinct from v_up.assignment_id then
    raise exception 'assignment_changed' using errcode='CR409';
  end if;
  if v_up.upload_state='issued' then
    update public.couranr_proof_uploads
       set upload_state='expired',version=version+1,updated_at=now()
     where id=v_up.id
     returning * into v_up;
  end if;
  return v_up;
end
$fn$;

create or replace function public.couranr_finalize_proof_upload_v2(
  p_upload_id uuid,
  p_actor_user_id uuid,
  p_actual_path text,
  p_actual_bytes integer,
  p_actual_mime text
)
returns public.couranr_delivery_proofs
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_up public.couranr_proof_uploads;
  v_drv public.couranr_drivers;
  v_asg public.couranr_delivery_assignments;
  v_dlv public.couranr_deliveries;
  v_pr public.couranr_delivery_proofs;
begin
  select * into v_up from public.couranr_proof_uploads where id=p_upload_id for update;
  if not found then raise exception 'upload_not_found' using errcode='CR404'; end if;
  if v_up.client_evidence_id is null then
    raise exception 'offline_evidence_identity_required' using errcode='CR409';
  end if;

  select * into v_drv from public.couranr_drivers where user_id=p_actor_user_id;
  if not found then raise exception 'not_your_delivery' using errcode='CR404'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_up.client_evidence_id::text,0));

  select * into v_pr
    from public.couranr_delivery_proofs
   where client_evidence_id=v_up.client_evidence_id;
  if found then
    if v_pr.delivery_id is distinct from v_up.delivery_id
       or v_pr.actor_driver_id is distinct from v_drv.id
       or v_pr.assignment_id is distinct from v_up.assignment_id
       or v_pr.proof_stage is distinct from v_up.proof_stage
       or v_pr.proof_type is distinct from v_up.proof_type
       or v_pr.mime_type is distinct from v_up.expected_mime
       or v_pr.byte_size is distinct from v_up.expected_bytes
       or v_pr.evidence_sha256 is distinct from v_up.evidence_sha256
       or v_pr.captured_at is distinct from v_up.captured_at
       or v_pr.discrepancy_id is distinct from v_up.discrepancy_id then
      raise exception 'evidence_identity_conflict' using errcode='CR409';
    end if;
    if v_up.upload_state='issued' then
      update public.couranr_proof_uploads
         set upload_state='consumed',consumed_at=coalesce(consumed_at,now()),
             finalized_at=coalesce(finalized_at,v_pr.finalized_at),
             version=version+1,updated_at=now()
       where id=v_up.id;
    end if;
    update public.couranr_proof_sync_failures
       set failure_state='resolved',resolved_at=now(),last_reported_at=now()
     where client_evidence_id=v_up.client_evidence_id and failure_state='open';
    return v_pr;
  end if;

  v_asg := public.couranr_driver_assignment_for(v_up.delivery_id,p_actor_user_id);

  if v_up.upload_state <> 'issued' then
    raise exception 'upload_already_used' using errcode='CR409';
  end if;
  if v_up.expires_at <= now() then
    update public.couranr_proof_uploads
       set upload_state='expired',version=version+1,updated_at=now()
     where id=v_up.id;
    raise exception 'upload_expired' using errcode='CR409';
  end if;
  if v_up.assignment_id is distinct from v_asg.id then
    raise exception 'assignment_changed' using errcode='CR409';
  end if;
  if v_up.assignment_version is distinct from v_asg.version then
    raise exception 'assignment_version_changed' using errcode='CR409';
  end if;

  select * into v_dlv from public.couranr_deliveries where id=v_up.delivery_id;
  if v_up.proof_stage in ('pickup','pickup_discrepancy') and v_dlv.fulfillment_state <> 'at_pickup' then
    raise exception 'proof_stage_not_valid_here' using errcode='CR409';
  end if;
  if v_up.proof_stage='dropoff' and v_dlv.fulfillment_state <> 'at_dropoff' then
    raise exception 'proof_stage_not_valid_here' using errcode='CR409';
  end if;

  if p_actual_path is distinct from v_up.object_path then
    raise exception 'object_path_mismatch' using errcode='CR409';
  end if;
  if p_actual_bytes is null or p_actual_bytes <= 0 then
    raise exception 'object_empty' using errcode='CR409';
  end if;
  if p_actual_bytes is distinct from v_up.expected_bytes then
    raise exception 'object_size_mismatch' using errcode='CR409';
  end if;
  if p_actual_bytes > 10485760 then
    raise exception 'object_too_large' using errcode='CR409';
  end if;
  if p_actual_mime is distinct from v_up.expected_mime
     or p_actual_mime not in ('image/jpeg','image/png','image/webp','image/heic') then
    raise exception 'object_mime_mismatch' using errcode='CR409';
  end if;

  insert into public.couranr_delivery_proofs(
    delivery_id,assignment_id,discrepancy_id,proof_stage,proof_type,
    storage_bucket,storage_object_path,byte_size,mime_type,
    captured_latitude,captured_longitude,captured_accuracy_m,
    actor_driver_id,metadata,finalized_at,
    client_evidence_id,evidence_sha256,captured_at
  ) values (
    v_up.delivery_id,v_up.assignment_id,v_up.discrepancy_id,v_up.proof_stage,v_up.proof_type,
    v_up.storage_bucket,v_up.object_path,p_actual_bytes,p_actual_mime,
    v_up.captured_latitude,v_up.captured_longitude,v_up.captured_accuracy_m,
    v_drv.id,'{}'::jsonb,now(),
    v_up.client_evidence_id,v_up.evidence_sha256,v_up.captured_at
  )
  returning * into v_pr;

  update public.couranr_proof_uploads
     set upload_state='consumed',consumed_at=now(),finalized_at=v_pr.finalized_at,
         version=version+1,updated_at=now()
   where id=v_up.id;

  update public.couranr_proof_sync_failures
     set failure_state='resolved',resolved_at=now(),last_reported_at=now()
   where client_evidence_id=v_up.client_evidence_id and failure_state='open';

  return v_pr;
end
$fn$;

/* --------------------------- terminal alert writer ---------------------- */

create or replace function public.couranr_report_proof_sync_failure(
  p_delivery_id uuid,
  p_actor_user_id uuid,
  p_client_evidence_id uuid,
  p_proof_stage text,
  p_proof_type text,
  p_reason text,
  p_attempts integer
)
returns public.couranr_proof_sync_failures
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_drv public.couranr_drivers;
  v_asg public.couranr_delivery_assignments;
  v_request_id uuid;
  v_existing public.couranr_proof_sync_failures;
  v_row public.couranr_proof_sync_failures;
begin
  if p_client_evidence_id is null
     or p_proof_stage not in ('pickup','pickup_discrepancy','dropoff')
     or p_reason not in ('local_evidence_corrupt','assignment_or_stage_changed','server_rejected','retry_limit')
     or p_attempts is null or p_attempts < 1 or p_attempts > 100 then
    raise exception 'invalid_proof_sync_failure' using errcode='CR422';
  end if;

  select * into v_drv from public.couranr_drivers where user_id=p_actor_user_id;
  if not found then raise exception 'not_your_delivery' using errcode='CR404'; end if;

  select d.request_id into v_request_id
    from public.couranr_deliveries d where d.id=p_delivery_id;
  if not found then raise exception 'delivery_not_found' using errcode='CR404'; end if;

  select * into v_asg
    from public.couranr_delivery_assignments
   where delivery_id=p_delivery_id and driver_id=v_drv.id
   order by assigned_at desc
   limit 1;
  if not found then raise exception 'not_your_delivery' using errcode='CR404'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_client_evidence_id::text,0));

  select * into v_existing
    from public.couranr_proof_sync_failures
   where client_evidence_id=p_client_evidence_id
   for update;

  if found then
    if v_existing.delivery_id is distinct from p_delivery_id
       or v_existing.driver_id is distinct from v_drv.id
       or v_existing.proof_stage is distinct from p_proof_stage
       or v_existing.proof_type is distinct from p_proof_type then
      raise exception 'evidence_identity_conflict' using errcode='CR409';
    end if;
    if v_existing.failure_state='resolved' then return v_existing; end if;
    update public.couranr_proof_sync_failures
       set reason=p_reason,attempts=greatest(attempts,p_attempts),last_reported_at=now()
     where id=v_existing.id
     returning * into v_row;
    return v_row;
  end if;

  insert into public.couranr_proof_sync_failures(
    request_id,delivery_id,assignment_id,driver_id,client_evidence_id,
    proof_stage,proof_type,reason,attempts
  ) values (
    v_request_id,p_delivery_id,v_asg.id,v_drv.id,p_client_evidence_id,
    p_proof_stage,p_proof_type,p_reason,p_attempts
  )
  returning * into v_row;
  return v_row;
end
$fn$;

/* --------------------------- Operations queue visibility ---------------- */

create or replace function public.couranr_operations_queue_candidates(
  p_limit integer default 200
)
returns table(request_id uuid,total_count bigint)
language sql security invoker set search_path=''
as $fn$
  with candidate as (
    select r.id,r.submitted_at,r.created_at
      from public.couranr_delivery_requests r
     where r.request_state in (
       'pending_couranr_review','confirmed','awaiting_quote_acceptance','quote_revision_required'
     )
       and (
         exists (
           select 1 from public.couranr_automation_exceptions ax
            where ax.request_id=r.id and ax.exception_state='open'
         )
         or exists (
           select 1 from public.couranr_proof_sync_failures psf
            where psf.request_id=r.id and psf.failure_state='open'
         )
         or (
           not exists (
             select 1 from public.couranr_service_plans p
              where p.request_id=r.id
                and p.plan_state='confirmed'
                and p.plan_source='automatic'
           )
           and (
             not exists (
               select 1 from public.couranr_deliveries d where d.request_id=r.id
             )
             or exists (
               select 1
                 from public.couranr_deliveries d
                 join public.couranr_service_plans p on p.id=d.service_plan_id
                where d.request_id=r.id
                  and p.plan_source='operations'
                  and d.fulfillment_state='scheduled'
                  and not exists (
                    select 1 from public.couranr_delivery_assignments a
                     where a.delivery_id=d.id and a.assignment_state='active'
                  )
             )
           )
         )
       )
  ),
  ranked as (
    select id,submitted_at,created_at,count(*) over() as total_count
      from candidate
  )
  select id,total_count
    from ranked
   order by submitted_at asc nulls last,created_at asc
   limit greatest(1,least(coalesce(p_limit,200),200));
$fn$;

/* --------------------------- grants ------------------------------------- */

revoke all on function public.couranr_prepare_proof_upload_v2(
  uuid,uuid,text,text,text,text,text,integer,text,integer,uuid,text,timestamptz,numeric,numeric,numeric,uuid
) from public,anon,authenticated;
grant execute on function public.couranr_prepare_proof_upload_v2(
  uuid,uuid,text,text,text,text,text,integer,text,integer,uuid,text,timestamptz,numeric,numeric,numeric,uuid
) to service_role;

revoke all on function public.couranr_abandon_proof_upload_v2(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.couranr_abandon_proof_upload_v2(uuid,uuid,uuid)
  to service_role;

revoke all on function public.couranr_finalize_proof_upload_v2(uuid,uuid,text,integer,text)
  from public,anon,authenticated;
grant execute on function public.couranr_finalize_proof_upload_v2(uuid,uuid,text,integer,text)
  to service_role;

revoke all on function public.couranr_report_proof_sync_failure(uuid,uuid,uuid,text,text,text,integer)
  from public,anon,authenticated;
grant execute on function public.couranr_report_proof_sync_failure(uuid,uuid,uuid,text,text,text,integer)
  to service_role;

revoke all on function public.couranr_operations_queue_candidates(integer)
  from public,anon,authenticated;
grant execute on function public.couranr_operations_queue_candidates(integer)
  to service_role;

commit;

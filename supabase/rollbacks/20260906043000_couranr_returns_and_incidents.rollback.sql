-- Roll back P7-005 return/incident substrate only while it is evidence-free.
--
-- Once a return, incident, return proof, return credential or new return state
-- exists, rollback refuses rather than erasing custody evidence.

begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

do $guard$
begin
  if exists (
       select 1 from public.couranr_pickup_discrepancies
        where reported_latitude is not null or reported_longitude is not null
        limit 1
     )
     or exists (select 1 from public.couranr_delivery_returns limit 1)
     or exists (select 1 from public.couranr_delivery_incidents limit 1)
     or exists (select 1 from public.couranr_delivery_incident_events limit 1)
     or exists (select 1 from public.couranr_handoff_codes where code_kind='merchant_return' limit 1)
     or exists (select 1 from public.couranr_delivery_proofs where proof_stage='return' limit 1)
     or exists (select 1 from public.couranr_proof_uploads where proof_stage='return' limit 1)
     or exists (select 1 from public.couranr_proof_sync_failures where proof_stage='return' limit 1)
     or exists (
       select 1 from public.couranr_deliveries
        where fulfillment_state in ('return_required','returning','returned') limit 1
     ) then
    raise exception 'P7-005 rollback refused: return or incident evidence exists';
  end if;
end
$guard$;

drop function if exists public.couranr_report_dropoff_exception_v2(
  uuid,uuid,text,text,numeric,numeric,numeric
);
drop function if exists public.couranr_complete_return(uuid,integer,uuid);
drop function if exists public.couranr_start_return(uuid,integer,uuid);
drop function if exists public.couranr_require_return(uuid,integer,uuid,text,text);
drop function if exists public.couranr_transition_delivery_incident(uuid,integer,uuid,text,text);
drop function if exists public.couranr_open_delivery_incident(uuid,uuid,text,text,text);

drop table if exists public.couranr_delivery_incident_events;
drop table if exists public.couranr_delivery_incidents;
drop table if exists public.couranr_delivery_returns;

alter table public.couranr_pickup_discrepancies
  drop constraint if exists couranr_pd_reported_location_chk,
  drop column if exists reported_latitude,
  drop column if exists reported_longitude,
  drop column if exists reported_accuracy_m;

alter table public.couranr_deliveries drop constraint if exists couranr_dlv_fulfillment_chk;
alter table public.couranr_deliveries add constraint couranr_dlv_fulfillment_chk check (
  fulfillment_state in (
    'scheduled','assigned','en_route_to_pickup','at_pickup','picked_up',
    'in_transit','at_dropoff','delivered','could_not_deliver','cancelled'
  )
);

alter table public.couranr_delivery_events drop constraint if exists couranr_dlve_command_chk;
alter table public.couranr_delivery_events add constraint couranr_dlve_command_chk check (command in (
  'create_delivery_from_capture','create_delivery_from_promotional_credit',
  'assign_delivery','unassign_delivery_before_pickup','start_route_to_pickup',
  'arrive_at_pickup','report_pickup_discrepancy',
  'resolve_pickup_discrepancy_safe_to_continue','complete_pickup',
  'start_route_to_dropoff','arrive_at_dropoff','complete_direct_handoff_delivery',
  'complete_signature_delivery','complete_leave_at_door_delivery',
  'report_dropoff_exception','close_delivery_undeliverable','cancel_delivery'
));

alter table public.couranr_assignment_events drop constraint if exists couranr_ae_command_chk;
alter table public.couranr_assignment_events add constraint couranr_ae_command_chk check (command in (
  'assign_delivery','replace_delivery_assignment','unassign_delivery_before_pickup',
  'complete_assignment','close_delivery_undeliverable','cancel_delivery'
));

alter table public.couranr_pickup_discrepancies drop constraint if exists couranr_pd_reason_chk;
alter table public.couranr_pickup_discrepancies add constraint couranr_pd_reason_chk check (reason in (
  'package_count_mismatch','weight_or_size_mismatch','visible_damage','unsafe_packaging',
  'wrong_item','vehicle_mismatch','prohibited_item_concern','loading_not_available',
  'recipient_unavailable','address_or_access_problem','other'
));

alter table public.couranr_handoff_codes drop constraint if exists couranr_hc_kind_chk;
alter table public.couranr_handoff_codes add constraint couranr_hc_kind_chk check (
  code_kind in ('merchant_pickup','recipient_dropoff')
);

alter table public.couranr_delivery_proofs drop constraint if exists couranr_dp_stage_chk;
alter table public.couranr_delivery_proofs add constraint couranr_dp_stage_chk check (
  proof_stage in ('pickup','dropoff','pickup_discrepancy')
);
alter table public.couranr_delivery_proofs drop constraint if exists couranr_dp_type_chk;
alter table public.couranr_delivery_proofs add constraint couranr_dp_type_chk check (proof_type in (
  'shipment_photo','condition_photo','securement_photo','discrepancy_evidence',
  'delivery_photo','signature','recipient_pin'
));

alter table public.couranr_proof_sync_failures drop constraint if exists couranr_psf_stage_chk;
alter table public.couranr_proof_sync_failures add constraint couranr_psf_stage_chk check (
  proof_stage in ('pickup','pickup_discrepancy','dropoff')
);

drop function if exists public.couranr_issue_handoff_code_cas(uuid,text,integer,text,uuid,integer);
create function public.couranr_issue_handoff_code_cas(
  p_delivery_id         uuid,
  p_code_kind           text,
  p_expected_generation integer,
  p_code_digest         text,
  p_actor_user_id       uuid,
  p_ttl_minutes         integer
)
returns public.couranr_handoff_codes
language plpgsql security invoker set search_path = ''
as $fn$
declare
  v_dlv public.couranr_deliveries;
  v_gen integer;
  v_row public.couranr_handoff_codes;
begin
  if p_code_kind not in ('merchant_pickup', 'recipient_dropoff') then
    raise exception 'unknown_code_kind' using errcode = 'CR400';
  end if;
  if p_expected_generation is null or p_expected_generation < 1 then
    raise exception 'handoff_generation_conflict' using errcode = 'CR409';
  end if;
  if p_code_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'digest_required' using errcode = 'CR400';
  end if;
  if p_actor_user_id is null then
    raise exception 'actor_required' using errcode = 'CR403';
  end if;

  -- Serializes issuers for this delivery. The generation check happens only
  -- after this lock is held, so a caller can never sign generation N and have
  -- the database silently store that digest as N+1.
  select * into v_dlv
    from public.couranr_deliveries
   where id = p_delivery_id
   for update;
  if not found then
    raise exception 'delivery_not_found' using errcode = 'CR404';
  end if;
  if v_dlv.fulfillment_state in ('delivered', 'cancelled', 'could_not_deliver') then
    raise exception 'delivery_already_settled' using errcode = 'CR409';
  end if;

  select coalesce(max(generation), 0) + 1
    into v_gen
    from public.couranr_handoff_codes
   where delivery_id = p_delivery_id
     and code_kind = p_code_kind;

  if p_expected_generation <> v_gen then
    raise exception 'handoff_generation_conflict' using errcode = 'CR409';
  end if;

  -- Only a caller whose generation still matches may supersede the current
  -- credential. A conflict leaves the existing code untouched and retryable.
  update public.couranr_handoff_codes
     set code_state = 'superseded',
         superseded_at = now(),
         version = version + 1,
         updated_at = now()
   where delivery_id = p_delivery_id
     and code_kind = p_code_kind
     and code_state in ('active', 'locked');

  insert into public.couranr_handoff_codes (
    delivery_id, code_kind, generation, code_digest, code_state,
    issued_by, issued_at, expires_at, failed_attempts
  ) values (
    p_delivery_id, p_code_kind, v_gen, p_code_digest, 'active',
    p_actor_user_id, now(),
    now() + make_interval(mins => greatest(coalesce(p_ttl_minutes, 1440), 5)),
    0
  )
  returning * into v_row;

  return v_row;
end
$fn$;

create or replace function public.couranr_verify_handoff_code(
  p_delivery_id   uuid,
  p_code_kind     text,
  p_code_digest   text,
  p_actor_user_id uuid
)
returns public.couranr_pin_attempt_result
language plpgsql security invoker set search_path = ''
as $fn$
declare
  v_row public.couranr_handoff_codes;
  v_out public.couranr_pin_attempt_result;
begin
  if p_code_kind not in ('merchant_pickup', 'recipient_dropoff') then
    raise exception 'unknown_code_kind' using errcode = 'CR400';
  end if;

  -- The gate. Raises CR403 before any row is read or any counter moves.
  perform public.couranr_driver_assignment_for(p_delivery_id, p_actor_user_id);

  select * into v_row from public.couranr_handoff_codes
   where delivery_id = p_delivery_id
     and code_kind = p_code_kind
     and code_state in ('active', 'locked')
   order by generation desc
   limit 1
   for update;

  if not found then
    v_out := row('expired', p_code_kind, null)::public.couranr_pin_attempt_result;
    return v_out;
  end if;

  if v_row.code_state = 'locked' then
    return row('locked', p_code_kind, v_row.generation)::public.couranr_pin_attempt_result;
  end if;

  if v_row.expires_at <= now() then
    update public.couranr_handoff_codes
       set code_state = 'expired', version = version + 1, updated_at = now()
     where id = v_row.id;
    return row('expired', p_code_kind, v_row.generation)::public.couranr_pin_attempt_result;
  end if;

  if p_code_digest is not null and p_code_digest = v_row.code_digest then
    update public.couranr_handoff_codes
       set code_state = 'consumed',
           consumed_at = coalesce(consumed_at, now()),
           last_attempt_at = now(),
           version = version + 1,
           updated_at = now()
     where id = v_row.id;
    return row('accepted', p_code_kind, v_row.generation)::public.couranr_pin_attempt_result;
  end if;

  update public.couranr_handoff_codes
     set failed_attempts = failed_attempts + 1,
         last_attempt_at = now(),
         code_state = case when failed_attempts + 1 >= 5 then 'locked' else code_state end,
         locked_at  = case when failed_attempts + 1 >= 5 then now() else locked_at end,
         version = version + 1,
         updated_at = now()
   where id = v_row.id
  returning * into v_row;

  if v_row.code_state = 'locked' then
    return row('locked', p_code_kind, v_row.generation)::public.couranr_pin_attempt_result;
  end if;
  return row('invalid', p_code_kind, v_row.generation)::public.couranr_pin_attempt_result;
end $fn$;

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

create or replace function public.couranr_driver_completion_receipt(
  p_actor_user_id uuid
)
returns table (
  delivery_id             uuid,
  assignment_id           uuid,
  delivered_at            timestamptz,
  proof_method            text,
  pickup_proof_complete   boolean,
  delivery_proof_complete boolean
)
language sql security invoker set search_path = ''
as $fn$
  select
    d.id,
    a.id,
    a.ended_at,
    d.proof_method,
    exists (select 1 from public.couranr_delivery_proofs p
             where p.assignment_id = a.id and p.proof_stage = 'pickup'),
    exists (select 1 from public.couranr_delivery_proofs p
             where p.assignment_id = a.id and p.proof_stage = 'dropoff')
  from public.couranr_delivery_assignments a
  join public.couranr_drivers dr on dr.id = a.driver_id
  join public.couranr_deliveries d on d.id = a.delivery_id
  where dr.user_id = p_actor_user_id
    and a.assignment_state = 'completed'
    and a.ended_at is not null
    and a.ended_at > now() - interval '24 hours'
  order by a.ended_at desc
  limit 1;
$fn$;

-- =====================================================================
-- EXECUTE boundary.
--
-- `pg_default_acl` grants EXECUTE on every new function in `public` to anon,
-- authenticated AND service_role, so the REVOKE is what creates the boundary
-- and the GRANT alone would be a silent no-op. Verified with
-- has_function_privilege, never with information_schema grantee rows — those
-- miss privileges inherited through PUBLIC.
-- =====================================================================
do $$
declare
  v_sig text;
begin
  for v_sig in
    select p.oid::regprocedure::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'couranr_driver_assignment_for',
         'couranr_release_assignment_resources',
         'couranr_start_route_to_pickup',
         'couranr_arrive_at_pickup',
         'couranr_start_route_to_dropoff',
         'couranr_arrive_at_dropoff',
         'couranr_complete_pickup',
         'couranr_finish_delivered',
         'couranr_assert_dropoff_ready',
         'couranr_complete_direct_handoff_delivery',
         'couranr_complete_signature_delivery',
         'couranr_complete_leave_at_door_delivery',
         'couranr_unassign_delivery_before_pickup',
         'couranr_issue_handoff_code',
         'couranr_verify_handoff_code',
         'couranr_create_proof_upload',
         'couranr_finalize_proof_upload',
         'couranr_report_pickup_discrepancy',
         'couranr_resolve_pickup_discrepancy_safe_to_continue',
         'couranr_driver_completion_receipt')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_sig);
    execute format('revoke all on function %s from service_role', v_sig);
    execute format('grant execute on function %s to service_role', v_sig);
  end loop;
end
$$;

commit;

revoke all on function public.couranr_issue_handoff_code_cas(uuid,text,integer,text,uuid,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_issue_handoff_code_cas(uuid,text,integer,text,uuid,integer)
  to service_role;
revoke all on function public.couranr_verify_handoff_code(uuid,text,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_verify_handoff_code(uuid,text,text,uuid)
  to service_role;
revoke all on function public.couranr_prepare_proof_upload_v2(
  uuid,uuid,text,text,text,text,text,integer,text,integer,uuid,text,timestamptz,numeric,numeric,numeric,uuid
) from public,anon,authenticated,service_role;
grant execute on function public.couranr_prepare_proof_upload_v2(
  uuid,uuid,text,text,text,text,text,integer,text,integer,uuid,text,timestamptz,numeric,numeric,numeric,uuid
) to service_role;
revoke all on function public.couranr_finalize_proof_upload_v2(uuid,uuid,text,integer,text)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_finalize_proof_upload_v2(uuid,uuid,text,integer,text)
  to service_role;
revoke all on function public.couranr_report_proof_sync_failure(uuid,uuid,uuid,text,text,text,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_report_proof_sync_failure(uuid,uuid,uuid,text,text,text,integer)
  to service_role;
revoke all on function public.couranr_driver_completion_receipt(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_driver_completion_receipt(uuid)
  to service_role;

commit;

-- Couranr P7-005 — governed return custody + incident substrate.
--
-- This migration intentionally DOES NOT assess a return charge and makes no
-- provider call. REF-003 says a physical return is a NEW Pricing V2 route; the
-- retired 70%-of-original / $14.99-minimum formula is not revived here.
-- Non-Couranr-caused returns therefore remain pending_route_quote until a
-- separately governed route quote exists. Couranr-caused corrective returns
-- are pinned to $0.
--
-- Rolling-deploy safe: the new fulfillment states are only entered by the new
-- named commands. Applying this migration alone does not move any live row.
-- Existing pickup/drop-off commands and legacy handoff kinds remain valid.

begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

/* ------------------------------------------------ canonical vocabularies */

alter table public.couranr_deliveries
  drop constraint if exists couranr_dlv_fulfillment_chk;
alter table public.couranr_deliveries
  add constraint couranr_dlv_fulfillment_chk check (fulfillment_state in (
    'scheduled','assigned','en_route_to_pickup','at_pickup','picked_up',
    'in_transit','at_dropoff','delivered','could_not_deliver','cancelled',
    'return_required','returning','returned'
  ));

alter table public.couranr_delivery_events
  drop constraint if exists couranr_dlve_command_chk;
alter table public.couranr_delivery_events
  add constraint couranr_dlve_command_chk check (command in (
    'create_delivery_from_capture',
    'create_delivery_from_promotional_credit',
    'assign_delivery',
    'unassign_delivery_before_pickup',
    'start_route_to_pickup',
    'arrive_at_pickup',
    'report_pickup_discrepancy',
    'resolve_pickup_discrepancy_safe_to_continue',
    'complete_pickup',
    'start_route_to_dropoff',
    'arrive_at_dropoff',
    'complete_direct_handoff_delivery',
    'complete_signature_delivery',
    'complete_leave_at_door_delivery',
    'report_dropoff_exception',
    'close_delivery_undeliverable',
    'cancel_delivery',
    'require_return',
    'start_return',
    'complete_return'
  ));

alter table public.couranr_assignment_events
  drop constraint if exists couranr_ae_command_chk;
alter table public.couranr_assignment_events
  add constraint couranr_ae_command_chk check (command in (
    'assign_delivery',
    'replace_delivery_assignment',
    'unassign_delivery_before_pickup',
    'complete_assignment',
    'close_delivery_undeliverable',
    'cancel_delivery',
    'complete_return'
  ));

alter table public.couranr_pickup_discrepancies
  drop constraint if exists couranr_pd_reason_chk;
alter table public.couranr_pickup_discrepancies
  add constraint couranr_pd_reason_chk check (reason in (
    'package_count_mismatch',
    'weight_or_size_mismatch',
    'visible_damage',
    'unsafe_packaging',
    'wrong_item',
    'vehicle_mismatch',
    'prohibited_item_concern',
    'loading_not_available',
    'recipient_unavailable',
    'address_or_access_problem',
    'weather_or_safety',
    'other'
  ));

/* ------------------------------------------- return + incident evidence */

create table if not exists public.couranr_delivery_returns (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.couranr_delivery_requests(id)
    on update cascade on delete restrict,
  delivery_id uuid not null references public.couranr_deliveries(id)
    on update cascade on delete restrict,
  assignment_id uuid not null references public.couranr_delivery_assignments(id)
    on update cascade on delete restrict,
  source_discrepancy_id uuid not null references public.couranr_pickup_discrepancies(id)
    on update cascade on delete restrict,
  return_state text not null default 'required',
  reason text not null,
  source_fulfillment_state text not null,
  route_origin_snapshot jsonb,
  return_destination_snapshot jsonb not null,
  pricing_status text not null,
  payer_responsibility text not null,
  payer_owes_cents integer,
  required_by uuid not null references public.profiles(id)
    on update cascade on delete restrict,
  required_at timestamptz not null default now(),
  started_at timestamptz,
  returned_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint couranr_dr_state_chk check (return_state in ('required','returning','returned')),
  constraint couranr_dr_reason_chk check (reason in (
    'recipient_unavailable',
    'address_or_access_problem',
    'weather_or_safety',
    'damage_or_condition',
    'customer_request',
    'merchant_request',
    'couranr_caused',
    'other'
  )),
  constraint couranr_dr_source_state_chk check (
    source_fulfillment_state in ('picked_up','in_transit','at_dropoff')
  ),
  constraint couranr_dr_origin_obj_chk check (
    route_origin_snapshot is null or jsonb_typeof(route_origin_snapshot)='object'
  ),
  constraint couranr_dr_destination_obj_chk check (
    jsonb_typeof(return_destination_snapshot)='object'
  ),
  constraint couranr_dr_pricing_chk check (
    (pricing_status='couranr_covered' and payer_responsibility='couranr' and payer_owes_cents=0)
    or
    (pricing_status in ('pending_route_quote','pending_current_location')
      and payer_responsibility='payer' and payer_owes_cents is null)
  ),
  constraint couranr_dr_timestamps_chk check (
    (return_state='required' and started_at is null and returned_at is null)
    or (return_state='returning' and started_at is not null and returned_at is null)
    or (return_state='returned' and started_at is not null and returned_at is not null)
  ),
  constraint couranr_dr_version_chk check (version >= 1),
  constraint couranr_dr_delivery_uniq unique (delivery_id)
);

create index if not exists couranr_dr_request_idx
  on public.couranr_delivery_returns(request_id);
create index if not exists couranr_dr_state_idx
  on public.couranr_delivery_returns(return_state, required_at);

alter table public.couranr_delivery_returns enable row level security;
revoke all on public.couranr_delivery_returns from public,anon,authenticated,service_role;
grant select,insert,update on public.couranr_delivery_returns to service_role;

create table if not exists public.couranr_delivery_incidents (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.couranr_delivery_requests(id)
    on update cascade on delete restrict,
  delivery_id uuid not null references public.couranr_deliveries(id)
    on update cascade on delete restrict,
  return_id uuid references public.couranr_delivery_returns(id)
    on update cascade on delete restrict,
  source_discrepancy_id uuid references public.couranr_pickup_discrepancies(id)
    on update cascade on delete restrict,
  incident_type text not null,
  incident_state text not null default 'reported',
  severity text not null default 'normal',
  summary text,
  opened_by uuid not null references public.profiles(id)
    on update cascade on delete restrict,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  closed_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint couranr_di_type_chk check (incident_type in (
    'recipient_unavailable','address_access','weather_safety','damage',
    'wrong_item','missing_item','unsafe_handling','delivery_failure','other'
  )),
  constraint couranr_di_state_chk check (
    incident_state in ('reported','under_review','awaiting_evidence','resolved','closed')
  ),
  constraint couranr_di_severity_chk check (severity in ('normal','urgent')),
  constraint couranr_di_summary_chk check (summary is null or length(btrim(summary)) between 1 and 2000),
  constraint couranr_di_resolution_stamp_chk check (
    (incident_state not in ('resolved','closed')) or resolved_at is not null
  ),
  constraint couranr_di_closed_stamp_chk check (
    incident_state <> 'closed' or closed_at is not null
  ),
  constraint couranr_di_version_chk check (version >= 1)
);

create unique index if not exists couranr_di_discrepancy_once_uniq
  on public.couranr_delivery_incidents(source_discrepancy_id)
  where source_discrepancy_id is not null;
create index if not exists couranr_di_state_idx
  on public.couranr_delivery_incidents(incident_state, opened_at);
create index if not exists couranr_di_delivery_idx
  on public.couranr_delivery_incidents(delivery_id, opened_at desc);

alter table public.couranr_delivery_incidents enable row level security;
revoke all on public.couranr_delivery_incidents from public,anon,authenticated,service_role;
grant select,insert,update on public.couranr_delivery_incidents to service_role;

create table if not exists public.couranr_delivery_incident_events (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.couranr_delivery_incidents(id)
    on update cascade on delete restrict,
  actor_user_id uuid not null references public.profiles(id)
    on update cascade on delete restrict,
  command text not null,
  from_state text,
  to_state text not null,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint couranr_die_command_chk check (command in (
    'open_incident','start_incident_review','request_incident_evidence',
    'add_incident_note','escalate_incident','resolve_incident','close_incident','return_required'
  )),
  constraint couranr_die_state_chk check (
    to_state in ('reported','under_review','awaiting_evidence','resolved','closed')
  ),
  constraint couranr_die_from_state_chk check (
    from_state is null or from_state in (
      'reported','under_review','awaiting_evidence','resolved','closed'
    )
  ),
  constraint couranr_die_note_chk check (note is null or length(btrim(note)) between 1 and 2000),
  constraint couranr_die_metadata_obj_chk check (jsonb_typeof(metadata)='object')
);

create index if not exists couranr_die_incident_idx
  on public.couranr_delivery_incident_events(incident_id,created_at);

alter table public.couranr_delivery_incident_events enable row level security;
revoke all on public.couranr_delivery_incident_events from public,anon,authenticated,service_role;
grant select,insert on public.couranr_delivery_incident_events to service_role;

/* --------------------------------------------------- return credentials */

alter table public.couranr_handoff_codes
  drop constraint if exists couranr_hc_kind_chk;
alter table public.couranr_handoff_codes
  add constraint couranr_hc_kind_chk check (
    code_kind in ('merchant_pickup','recipient_dropoff','merchant_return')
  );

create or replace function public.couranr_issue_handoff_code_cas(
  p_delivery_id uuid,
  p_code_kind text,
  p_expected_generation integer,
  p_code_digest text,
  p_actor_user_id uuid,
  p_ttl_minutes integer
)
returns public.couranr_handoff_codes
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_dlv public.couranr_deliveries;
  v_gen integer;
  v_row public.couranr_handoff_codes;
begin
  if p_code_kind not in ('merchant_pickup','recipient_dropoff','merchant_return') then
    raise exception 'unknown_code_kind' using errcode='CR400';
  end if;
  if p_expected_generation is null or p_expected_generation < 1 then
    raise exception 'handoff_generation_conflict' using errcode='CR409';
  end if;
  if p_code_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'digest_required' using errcode='CR400';
  end if;
  if p_actor_user_id is null then
    raise exception 'actor_required' using errcode='CR403';
  end if;

  select * into v_dlv from public.couranr_deliveries
   where id=p_delivery_id for update;
  if not found then raise exception 'delivery_not_found' using errcode='CR404'; end if;

  if p_code_kind='merchant_return' then
    if v_dlv.fulfillment_state not in ('return_required','returning') then
      raise exception 'return_not_active' using errcode='CR409';
    end if;
  elsif v_dlv.fulfillment_state in (
    'delivered','cancelled','could_not_deliver','returned'
  ) then
    raise exception 'delivery_already_settled' using errcode='CR409';
  end if;

  select coalesce(max(generation),0)+1 into v_gen
    from public.couranr_handoff_codes
   where delivery_id=p_delivery_id and code_kind=p_code_kind;

  if p_expected_generation <> v_gen then
    raise exception 'handoff_generation_conflict' using errcode='CR409';
  end if;

  update public.couranr_handoff_codes
     set code_state='superseded',superseded_at=now(),version=version+1,updated_at=now()
   where delivery_id=p_delivery_id and code_kind=p_code_kind
     and code_state in ('active','locked');

  insert into public.couranr_handoff_codes(
    delivery_id,code_kind,generation,code_digest,code_state,
    issued_by,issued_at,expires_at,failed_attempts
  ) values (
    p_delivery_id,p_code_kind,v_gen,p_code_digest,'active',
    p_actor_user_id,now(),
    now()+make_interval(mins=>greatest(coalesce(p_ttl_minutes,1440),5)),0
  ) returning * into v_row;

  return v_row;
end
$fn$;

create or replace function public.couranr_verify_handoff_code(
  p_delivery_id uuid,
  p_code_kind text,
  p_code_digest text,
  p_actor_user_id uuid
)
returns public.couranr_pin_attempt_result
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_row public.couranr_handoff_codes;
  v_out public.couranr_pin_attempt_result;
  v_dlv public.couranr_deliveries;
begin
  if p_code_kind not in ('merchant_pickup','recipient_dropoff','merchant_return') then
    raise exception 'unknown_code_kind' using errcode='CR400';
  end if;

  perform public.couranr_driver_assignment_for(p_delivery_id,p_actor_user_id);
  select * into v_dlv from public.couranr_deliveries where id=p_delivery_id;

  if p_code_kind='merchant_return'
     and v_dlv.fulfillment_state<>'returning' then
    raise exception 'return_not_active' using errcode='CR409';
  end if;

  select * into v_row from public.couranr_handoff_codes
   where delivery_id=p_delivery_id
     and code_kind=p_code_kind
     and code_state in ('active','locked')
   order by generation desc
   limit 1
   for update;

  if not found then
    return row('expired',p_code_kind,null)::public.couranr_pin_attempt_result;
  end if;
  if v_row.code_state='locked' then
    return row('locked',p_code_kind,v_row.generation)::public.couranr_pin_attempt_result;
  end if;
  if v_row.expires_at <= now() then
    update public.couranr_handoff_codes
       set code_state='expired',version=version+1,updated_at=now()
     where id=v_row.id;
    return row('expired',p_code_kind,v_row.generation)::public.couranr_pin_attempt_result;
  end if;

  if p_code_digest is not null and p_code_digest=v_row.code_digest then
    update public.couranr_handoff_codes
       set code_state='consumed',consumed_at=coalesce(consumed_at,now()),
           last_attempt_at=now(),version=version+1,updated_at=now()
     where id=v_row.id;
    return row('accepted',p_code_kind,v_row.generation)::public.couranr_pin_attempt_result;
  end if;

  update public.couranr_handoff_codes
     set failed_attempts=failed_attempts+1,
         last_attempt_at=now(),
         code_state=case when failed_attempts+1>=5 then 'locked' else code_state end,
         locked_at=case when failed_attempts+1>=5 then now() else locked_at end,
         version=version+1,updated_at=now()
   where id=v_row.id
  returning * into v_row;

  if v_row.code_state='locked' then
    return row('locked',p_code_kind,v_row.generation)::public.couranr_pin_attempt_result;
  end if;
  return row('invalid',p_code_kind,v_row.generation)::public.couranr_pin_attempt_result;
end
$fn$;

/* ------------------------------------------------------ return proof V2 */

alter table public.couranr_delivery_proofs
  drop constraint if exists couranr_dp_stage_chk;
alter table public.couranr_delivery_proofs
  add constraint couranr_dp_stage_chk check (
    proof_stage in ('pickup','dropoff','pickup_discrepancy','return')
  );
alter table public.couranr_delivery_proofs
  drop constraint if exists couranr_dp_type_chk;
alter table public.couranr_delivery_proofs
  add constraint couranr_dp_type_chk check (proof_type in (
    'shipment_photo','condition_photo','securement_photo','discrepancy_evidence',
    'delivery_photo','signature','recipient_pin','return_condition_photo'
  ));

alter table public.couranr_proof_sync_failures
  drop constraint if exists couranr_psf_stage_chk;
alter table public.couranr_proof_sync_failures
  add constraint couranr_psf_stage_chk check (
    proof_stage in ('pickup','pickup_discrepancy','dropoff','return')
  );

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
  if p_expected_bytes is null or p_expected_bytes<=0 or p_expected_bytes>10485760 then
    raise exception 'invalid_evidence_size' using errcode='CR422';
  end if;
  if p_expected_mime not in ('image/jpeg','image/png','image/webp','image/heic') then
    raise exception 'invalid_evidence_mime' using errcode='CR422';
  end if;
  if p_proof_stage not in ('pickup','pickup_discrepancy','dropoff','return') then
    raise exception 'proof_stage_not_valid_here' using errcode='CR409';
  end if;
  if p_proof_stage='return' and p_proof_type<>'return_condition_photo' then
    raise exception 'return_condition_photo_required' using errcode='CR409';
  end if;
  if (p_latitude is null)<>(p_longitude is null)
     or (p_latitude is not null and (p_latitude < -90 or p_latitude > 90))
     or (p_longitude is not null and (p_longitude < -180 or p_longitude > 180))
     or (p_accuracy_m is not null and p_accuracy_m < 0) then
    raise exception 'invalid_evidence_location' using errcode='CR422';
  end if;

  v_lat:=case when p_latitude is null then null else round(p_latitude,6) end;
  v_lng:=case when p_longitude is null then null else round(p_longitude,6) end;
  v_acc:=case when p_accuracy_m is null then null else round(p_accuracy_m,2) end;

  select * into v_drv from public.couranr_drivers where user_id=p_actor_user_id;
  if not found then raise exception 'not_your_delivery' using errcode='CR404'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_client_evidence_id::text,0));

  select * into v_pr from public.couranr_delivery_proofs
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

  v_asg:=public.couranr_driver_assignment_for(p_delivery_id,p_actor_user_id);
  select * into v_dlv from public.couranr_deliveries where id=p_delivery_id;

  if p_proof_stage in ('pickup','pickup_discrepancy') and v_dlv.fulfillment_state<>'at_pickup' then
    raise exception 'proof_stage_not_valid_here' using errcode='CR409';
  end if;
  if p_proof_stage='dropoff' and v_dlv.fulfillment_state<>'at_dropoff' then
    raise exception 'proof_stage_not_valid_here' using errcode='CR409';
  end if;
  if p_proof_stage='return' and v_dlv.fulfillment_state<>'returning' then
    raise exception 'proof_stage_not_valid_here' using errcode='CR409';
  end if;

  select * into v_up from public.couranr_proof_uploads
   where client_evidence_id=p_client_evidence_id
   order by created_at desc limit 1 for update;

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
    if v_up.upload_state='issued' and v_up.expires_at>now() then
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
  ) returning * into v_up;

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

  select * into v_pr from public.couranr_delivery_proofs
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

  v_asg:=public.couranr_driver_assignment_for(v_up.delivery_id,p_actor_user_id);

  if v_up.upload_state<>'issued' then
    raise exception 'upload_already_used' using errcode='CR409';
  end if;
  if v_up.expires_at<=now() then
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
  if v_up.proof_stage in ('pickup','pickup_discrepancy') and v_dlv.fulfillment_state<>'at_pickup' then
    raise exception 'proof_stage_not_valid_here' using errcode='CR409';
  end if;
  if v_up.proof_stage='dropoff' and v_dlv.fulfillment_state<>'at_dropoff' then
    raise exception 'proof_stage_not_valid_here' using errcode='CR409';
  end if;
  if v_up.proof_stage='return' and v_dlv.fulfillment_state<>'returning' then
    raise exception 'proof_stage_not_valid_here' using errcode='CR409';
  end if;

  if p_actual_path is distinct from v_up.object_path then
    raise exception 'object_path_mismatch' using errcode='CR409';
  end if;
  if p_actual_bytes is null or p_actual_bytes<=0 then
    raise exception 'object_empty' using errcode='CR409';
  end if;
  if p_actual_bytes is distinct from v_up.expected_bytes then
    raise exception 'object_size_mismatch' using errcode='CR409';
  end if;
  if p_actual_bytes>10485760 then
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
  ) returning * into v_pr;

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
     or p_proof_stage not in ('pickup','pickup_discrepancy','dropoff','return')
     or p_reason not in (
       'local_evidence_corrupt','assignment_or_stage_changed','server_rejected','retry_limit'
     )
     or p_attempts is null or p_attempts<1 or p_attempts>100 then
    raise exception 'invalid_proof_sync_failure' using errcode='CR422';
  end if;

  select * into v_drv from public.couranr_drivers where user_id=p_actor_user_id;
  if not found then raise exception 'not_your_delivery' using errcode='CR404'; end if;
  select d.request_id into v_request_id from public.couranr_deliveries d where d.id=p_delivery_id;
  if not found then raise exception 'delivery_not_found' using errcode='CR404'; end if;

  select * into v_asg from public.couranr_delivery_assignments
   where delivery_id=p_delivery_id and driver_id=v_drv.id
   order by assigned_at desc limit 1;
  if not found then raise exception 'not_your_delivery' using errcode='CR404'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_client_evidence_id::text,0));

  select * into v_existing from public.couranr_proof_sync_failures
   where client_evidence_id=p_client_evidence_id for update;
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
     where id=v_existing.id returning * into v_row;
    return v_row;
  end if;

  insert into public.couranr_proof_sync_failures(
    request_id,delivery_id,assignment_id,driver_id,client_evidence_id,
    proof_stage,proof_type,reason,attempts
  ) values (
    v_request_id,p_delivery_id,v_asg.id,v_drv.id,p_client_evidence_id,
    p_proof_stage,p_proof_type,p_reason,p_attempts
  ) returning * into v_row;
  return v_row;
end
$fn$;

/* ----------------------------------------------------- incident commands */

create or replace function public.couranr_open_delivery_incident(
  p_delivery_id uuid,
  p_actor_user_id uuid,
  p_incident_type text,
  p_severity text,
  p_summary text
)
returns public.couranr_delivery_incidents
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_role text;
  v_dlv public.couranr_deliveries;
  v_row public.couranr_delivery_incidents;
begin
  select role into v_role from public.profiles where id=p_actor_user_id;
  if v_role is distinct from 'admin' then
    raise exception 'operations_access_required' using errcode='CR403';
  end if;
  if p_incident_type not in (
    'recipient_unavailable','address_access','weather_safety','damage',
    'wrong_item','missing_item','unsafe_handling','delivery_failure','other'
  ) then raise exception 'incident_type_invalid' using errcode='CR400'; end if;
  if p_severity not in ('normal','urgent') then
    raise exception 'incident_severity_invalid' using errcode='CR400';
  end if;
  if p_summary is not null and (length(btrim(p_summary))<1 or length(btrim(p_summary))>2000) then
    raise exception 'incident_summary_invalid' using errcode='CR400';
  end if;

  select * into v_dlv from public.couranr_deliveries where id=p_delivery_id;
  if not found then raise exception 'delivery_not_found' using errcode='CR404'; end if;

  insert into public.couranr_delivery_incidents(
    request_id,delivery_id,incident_type,incident_state,severity,summary,opened_by
  ) values (
    v_dlv.request_id,v_dlv.id,p_incident_type,'reported',p_severity,
    nullif(btrim(coalesce(p_summary,'')),''),p_actor_user_id
  ) returning * into v_row;

  insert into public.couranr_delivery_incident_events(
    incident_id,actor_user_id,command,from_state,to_state,note
  ) values (
    v_row.id,p_actor_user_id,'open_incident',null,'reported',
    nullif(btrim(coalesce(p_summary,'')),'')
  );
  return v_row;
end
$fn$;

create or replace function public.couranr_transition_delivery_incident(
  p_incident_id uuid,
  p_expected_version integer,
  p_actor_user_id uuid,
  p_command text,
  p_note text
)
returns public.couranr_delivery_incidents
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_role text;
  v_row public.couranr_delivery_incidents;
  v_from text;
  v_to text;
begin
  select role into v_role from public.profiles where id=p_actor_user_id;
  if v_role is distinct from 'admin' then
    raise exception 'operations_access_required' using errcode='CR403';
  end if;
  select * into v_row from public.couranr_delivery_incidents where id=p_incident_id for update;
  if not found then raise exception 'incident_not_found' using errcode='CR404'; end if;
  if p_expected_version is distinct from v_row.version then
    raise exception 'version_conflict' using errcode='CR409';
  end if;
  if p_note is not null and (length(btrim(p_note))<1 or length(btrim(p_note))>2000) then
    raise exception 'incident_note_invalid' using errcode='CR400';
  end if;

  v_from:=v_row.incident_state;
  v_to:=case p_command
    when 'start_incident_review' then 'under_review'
    when 'request_incident_evidence' then 'awaiting_evidence'
    when 'add_incident_note' then v_row.incident_state
    when 'escalate_incident' then v_row.incident_state
    when 'resolve_incident' then 'resolved'
    when 'close_incident' then 'closed'
    else null end;
  if v_to is null then raise exception 'incident_command_invalid' using errcode='CR400'; end if;
  if p_command='add_incident_note' and nullif(btrim(coalesce(p_note,'')),'') is null then
    raise exception 'incident_note_required' using errcode='CR400';
  end if;

  if p_command='start_incident_review' and v_from not in ('reported','awaiting_evidence') then
    raise exception 'incident_transition_invalid' using errcode='CR409';
  elsif p_command='request_incident_evidence' and v_from not in ('reported','under_review') then
    raise exception 'incident_transition_invalid' using errcode='CR409';
  elsif p_command='resolve_incident' and v_from not in ('reported','under_review','awaiting_evidence') then
    raise exception 'incident_transition_invalid' using errcode='CR409';
  elsif p_command='close_incident' and v_from<>'resolved' then
    raise exception 'incident_transition_invalid' using errcode='CR409';
  end if;

  update public.couranr_delivery_incidents
     set incident_state=v_to,
         severity=case when p_command='escalate_incident' then 'urgent' else severity end,
         resolved_at=case when v_to in ('resolved','closed') then coalesce(resolved_at,now()) else resolved_at end,
         closed_at=case when v_to='closed' then now() else closed_at end,
         version=version+1,updated_at=now()
   where id=v_row.id and version=p_expected_version
  returning * into v_row;
  if not found then raise exception 'version_conflict' using errcode='CR409'; end if;

  insert into public.couranr_delivery_incident_events(
    incident_id,actor_user_id,command,from_state,to_state,note
  ) values (
    v_row.id,p_actor_user_id,p_command,v_from,v_to,
    nullif(btrim(coalesce(p_note,'')),'')
  );
  return v_row;
end
$fn$;

/* ------------------------------------------------------- return commands */

create or replace function public.couranr_require_return(
  p_delivery_id uuid,
  p_expected_version integer,
  p_actor_user_id uuid,
  p_reason text,
  p_note text
)
returns public.couranr_delivery_returns
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_role text;
  v_dlv public.couranr_deliveries;
  v_asg public.couranr_delivery_assignments;
  v_disc public.couranr_pickup_discrepancies;
  v_existing public.couranr_delivery_returns;
  v_ret public.couranr_delivery_returns;
  v_inc public.couranr_delivery_incidents;
  v_incident_type text;
  v_pricing text;
  v_payer text;
  v_origin jsonb;
begin
  select role into v_role from public.profiles where id=p_actor_user_id;
  if v_role is distinct from 'admin' then
    raise exception 'operations_access_required' using errcode='CR403';
  end if;
  if p_reason not in (
    'recipient_unavailable','address_or_access_problem','weather_or_safety',
    'damage_or_condition','customer_request','merchant_request','couranr_caused','other'
  ) then raise exception 'return_reason_invalid' using errcode='CR400'; end if;
  if p_note is not null and length(btrim(p_note))>2000 then
    raise exception 'return_note_invalid' using errcode='CR400';
  end if;

  select * into v_dlv from public.couranr_deliveries where id=p_delivery_id for update;
  if not found then raise exception 'delivery_not_found' using errcode='CR404'; end if;

  select * into v_existing from public.couranr_delivery_returns
   where delivery_id=p_delivery_id for update;
  if found then
    if v_existing.reason is distinct from p_reason then
      raise exception 'return_reason_conflict' using errcode='CR409';
    end if;
    return v_existing;
  end if;

  if v_dlv.fulfillment_state not in ('picked_up','in_transit','at_dropoff') then
    raise exception 'return_not_allowed_from_state' using errcode='CR409';
  end if;
  if v_dlv.version is distinct from p_expected_version then
    raise exception 'version_conflict' using errcode='CR409';
  end if;

  select * into v_asg from public.couranr_delivery_assignments
   where delivery_id=p_delivery_id and assignment_state='active'
   order by assigned_at desc limit 1 for update;
  if not found then raise exception 'active_assignment_required' using errcode='CR409'; end if;

  select * into v_disc from public.couranr_pickup_discrepancies
   where delivery_id=p_delivery_id and discrepancy_state='open' and stage='dropoff'
   order by reported_at desc limit 1 for update;
  if not found then
    raise exception 'dropoff_exception_evidence_required' using errcode='CR409';
  end if;
  if v_disc.assignment_id is distinct from v_asg.id then
    raise exception 'return_assignment_changed' using errcode='CR409';
  end if;

  v_pricing:=case when p_reason='couranr_caused' then 'couranr_covered'
                  when v_dlv.fulfillment_state='at_dropoff' then 'pending_route_quote'
                  else 'pending_current_location' end;
  v_payer:=case when p_reason='couranr_caused' then 'couranr' else 'payer' end;
  v_origin:=case when v_dlv.fulfillment_state='at_dropoff' then v_dlv.dropoff_address else null end;

  insert into public.couranr_delivery_returns(
    request_id,delivery_id,assignment_id,source_discrepancy_id,
    return_state,reason,source_fulfillment_state,route_origin_snapshot,
    return_destination_snapshot,pricing_status,payer_responsibility,payer_owes_cents,
    required_by
  ) values (
    v_dlv.request_id,v_dlv.id,v_asg.id,v_disc.id,
    'required',p_reason,v_dlv.fulfillment_state,v_origin,
    v_dlv.pickup_address,v_pricing,v_payer,
    case when p_reason='couranr_caused' then 0 else null end,
    p_actor_user_id
  ) returning * into v_ret;

  v_incident_type:=case p_reason
    when 'recipient_unavailable' then 'recipient_unavailable'
    when 'address_or_access_problem' then 'address_access'
    when 'weather_or_safety' then 'weather_safety'
    when 'damage_or_condition' then 'damage'
    else 'delivery_failure' end;

  insert into public.couranr_delivery_incidents(
    request_id,delivery_id,return_id,source_discrepancy_id,
    incident_type,incident_state,severity,summary,opened_by
  ) values (
    v_dlv.request_id,v_dlv.id,v_ret.id,v_disc.id,
    v_incident_type,'reported',
    case when p_reason in ('weather_or_safety','damage_or_condition') then 'urgent' else 'normal' end,
    nullif(btrim(coalesce(p_note,'')),''),p_actor_user_id
  )
  on conflict (source_discrepancy_id) where source_discrepancy_id is not null
  do update set return_id=excluded.return_id,updated_at=now()
  returning * into v_inc;

  insert into public.couranr_delivery_incident_events(
    incident_id,actor_user_id,command,from_state,to_state,note,
    metadata
  ) values (
    v_inc.id,p_actor_user_id,'return_required',v_inc.incident_state,v_inc.incident_state,
    nullif(btrim(coalesce(p_note,'')),''),
    jsonb_build_object('returnId',v_ret.id,'reason',p_reason)
  );

  update public.couranr_deliveries
     set fulfillment_state='return_required',version=version+1,updated_at=now()
   where id=v_dlv.id and version=p_expected_version
  returning * into v_dlv;
  if not found then raise exception 'version_conflict' using errcode='CR409'; end if;

  insert into public.couranr_delivery_events(
    delivery_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_dlv.id,p_actor_user_id,'operations','require_return',
    v_ret.source_fulfillment_state,'return_required',
    jsonb_build_object(
      'returnId',v_ret.id,'incidentId',v_inc.id,'reason',p_reason,
      'pricingStatus',v_ret.pricing_status,
      'payerResponsibility',v_ret.payer_responsibility
    )
  );

  return v_ret;
end
$fn$;

create or replace function public.couranr_start_return(
  p_delivery_id uuid,
  p_expected_version integer,
  p_actor_user_id uuid
)
returns public.couranr_deliveries
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_asg public.couranr_delivery_assignments;
  v_dlv public.couranr_deliveries;
  v_ret public.couranr_delivery_returns;
begin
  v_asg:=public.couranr_driver_assignment_for(p_delivery_id,p_actor_user_id);
  select * into v_dlv from public.couranr_deliveries where id=p_delivery_id for update;
  if v_dlv.fulfillment_state='returning' then return v_dlv; end if;
  if v_dlv.fulfillment_state<>'return_required' then
    raise exception 'delivery_not_in_expected_state' using errcode='CR409';
  end if;
  if v_dlv.version is distinct from p_expected_version then
    raise exception 'version_conflict' using errcode='CR409';
  end if;

  select * into v_ret from public.couranr_delivery_returns
   where delivery_id=p_delivery_id for update;
  if not found or v_ret.return_state<>'required' then
    raise exception 'return_record_not_ready' using errcode='CR409';
  end if;
  if v_ret.assignment_id is distinct from v_asg.id then
    raise exception 'return_assignment_changed' using errcode='CR409';
  end if;

  update public.couranr_delivery_returns
     set return_state='returning',started_at=now(),version=version+1,updated_at=now()
   where id=v_ret.id;

  update public.couranr_deliveries
     set fulfillment_state='returning',version=version+1,updated_at=now()
   where id=v_dlv.id and version=p_expected_version
  returning * into v_dlv;
  if not found then raise exception 'version_conflict' using errcode='CR409'; end if;

  insert into public.couranr_delivery_events(
    delivery_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_dlv.id,p_actor_user_id,'driver','start_return','return_required','returning',
    jsonb_build_object('returnId',v_ret.id)
  );
  return v_dlv;
end
$fn$;

create or replace function public.couranr_complete_return(
  p_delivery_id uuid,
  p_expected_version integer,
  p_actor_user_id uuid
)
returns public.couranr_deliveries
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_asg public.couranr_delivery_assignments;
  v_dlv public.couranr_deliveries;
  v_ret public.couranr_delivery_returns;
  v_code public.couranr_handoff_codes;
  v_proof public.couranr_delivery_proofs;
begin
  /*
   * Lost-response replay must work after the active assignment has already
   * been closed. First prove the caller owns the completed return assignment;
   * only the live path uses couranr_driver_assignment_for.
   */
  select * into v_dlv from public.couranr_deliveries where id=p_delivery_id for update;
  if not found then raise exception 'delivery_not_found' using errcode='CR404'; end if;
  if v_dlv.fulfillment_state='returned' then
    select a.* into v_asg
      from public.couranr_delivery_assignments a
      join public.couranr_drivers dr on dr.id=a.driver_id
      join public.couranr_delivery_returns r on r.assignment_id=a.id
     where a.delivery_id=p_delivery_id
       and dr.user_id=p_actor_user_id
       and a.assignment_state='completed'
       and a.end_reason='returned'
       and r.return_state='returned'
     order by a.ended_at desc
     limit 1;
    if not found then raise exception 'not_your_delivery' using errcode='CR404'; end if;
    return v_dlv;
  end if;

  v_asg:=public.couranr_driver_assignment_for(p_delivery_id,p_actor_user_id);
  if v_dlv.fulfillment_state<>'returning' then
    raise exception 'delivery_not_in_expected_state' using errcode='CR409';
  end if;
  if v_dlv.version is distinct from p_expected_version then
    raise exception 'version_conflict' using errcode='CR409';
  end if;

  select * into v_ret from public.couranr_delivery_returns
   where delivery_id=p_delivery_id for update;
  if not found or v_ret.return_state<>'returning' then
    raise exception 'return_record_not_ready' using errcode='CR409';
  end if;
  if v_ret.assignment_id is distinct from v_asg.id then
    raise exception 'return_assignment_changed' using errcode='CR409';
  end if;

  select * into v_code from public.couranr_handoff_codes
   where delivery_id=p_delivery_id and code_kind='merchant_return'
   order by generation desc limit 1;
  if not found or v_code.code_state<>'consumed' then
    raise exception 'return_code_not_accepted' using errcode='CR409';
  end if;

  select * into v_proof from public.couranr_delivery_proofs
   where delivery_id=p_delivery_id and assignment_id=v_asg.id
     and proof_stage='return' and proof_type='return_condition_photo'
   order by finalized_at desc limit 1;
  if not found then
    raise exception 'return_condition_photo_required' using errcode='CR409';
  end if;

  update public.couranr_delivery_returns
     set return_state='returned',returned_at=now(),version=version+1,updated_at=now()
   where id=v_ret.id;

  update public.couranr_deliveries
     set fulfillment_state='returned',version=version+1,updated_at=now()
   where id=v_dlv.id and version=p_expected_version
  returning * into v_dlv;
  if not found then raise exception 'version_conflict' using errcode='CR409'; end if;

  update public.couranr_delivery_assignments
     set assignment_state='completed',ended_at=now(),end_reason='returned',
         version=version+1,updated_at=now()
   where id=v_asg.id and assignment_state='active';

  perform public.couranr_release_assignment_resources(v_asg.driver_id,v_asg.vehicle_id);

  insert into public.couranr_assignment_events(
    assignment_id,delivery_id,actor_user_id,actor_type,command,
    from_state,to_state,metadata
  ) values (
    v_asg.id,v_dlv.id,p_actor_user_id,'driver','complete_return',
    'active','completed',jsonb_build_object('returnId',v_ret.id)
  );

  insert into public.couranr_delivery_events(
    delivery_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_dlv.id,p_actor_user_id,'driver','complete_return','returning','returned',
    jsonb_build_object(
      'returnId',v_ret.id,'returnProofId',v_proof.id,
      'returnCredentialGeneration',v_code.generation
    )
  );
  return v_dlv;
end
$fn$;

/* Completed return assignments must never masquerade as delivered receipts. */
create or replace function public.couranr_driver_completion_receipt(p_actor_user_id uuid)
returns table(
  delivery_id uuid,
  assignment_id uuid,
  delivered_at timestamptz,
  proof_method text,
  pickup_proof_complete boolean,
  delivery_proof_complete boolean
)
language sql set search_path=''
as $fn$
  select
    d.id,
    a.id,
    a.ended_at,
    d.proof_method,
    exists (
      select 1 from public.couranr_delivery_proofs p
       where p.assignment_id=a.id and p.proof_stage='pickup'
    ),
    exists (
      select 1 from public.couranr_delivery_proofs p
       where p.assignment_id=a.id and p.proof_stage='dropoff'
    )
  from public.couranr_delivery_assignments a
  join public.couranr_drivers dr on dr.id=a.driver_id
  join public.couranr_deliveries d on d.id=a.delivery_id
  where dr.user_id=p_actor_user_id
    and a.assignment_state='completed'
    and d.fulfillment_state='delivered'
    and a.ended_at is not null
    and a.ended_at>now()-interval '24 hours'
  order by a.ended_at desc
  limit 1;
$fn$;

/* --------------------------------------------------------- execute fence */

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

revoke all on function public.couranr_open_delivery_incident(uuid,uuid,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_open_delivery_incident(uuid,uuid,text,text,text)
  to service_role;
revoke all on function public.couranr_transition_delivery_incident(uuid,integer,uuid,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_transition_delivery_incident(uuid,integer,uuid,text,text)
  to service_role;
revoke all on function public.couranr_require_return(uuid,integer,uuid,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_require_return(uuid,integer,uuid,text,text)
  to service_role;
revoke all on function public.couranr_start_return(uuid,integer,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_start_return(uuid,integer,uuid)
  to service_role;
revoke all on function public.couranr_complete_return(uuid,integer,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_complete_return(uuid,integer,uuid)
  to service_role;
revoke all on function public.couranr_driver_completion_receipt(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_driver_completion_receipt(uuid)
  to service_role;

commit;

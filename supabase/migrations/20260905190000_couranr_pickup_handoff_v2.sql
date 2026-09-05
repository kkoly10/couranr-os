-- Couranr Pickup Handoff V2.
--
-- Founder decision 2026-09-05:
--   sender declares expected pickup -> Couranr freezes it -> driver confirms
--   physical custody with one pickup photo + location + sender credential.
--
-- Additive compatibility:
--   * historical requests may have no pickup_manifest;
--   * old couranr_complete_pickup remains callable during deploy cutover;
--   * old authenticated merchant/Operations handoff issuer remains unchanged;
--   * no existing delivery row is rewritten (Pilot #1 is untouched).
--
-- No provider calls are made by this migration.

begin;

set local statement_timeout = '120s';
set local lock_timeout = '10s';

/* ------------------------------------------------ pickup manifest -------- */

alter table public.couranr_delivery_requests
  add column if not exists pickup_manifest jsonb;

alter table public.couranr_delivery_requests
  add column if not exists pickup_manifest_version integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname='couranr_dr_pickup_manifest_obj_chk'
  ) then
    alter table public.couranr_delivery_requests
      add constraint couranr_dr_pickup_manifest_obj_chk
      check (pickup_manifest is null or jsonb_typeof(pickup_manifest)='object');
  end if;
  if not exists (
    select 1 from pg_constraint where conname='couranr_dr_pickup_manifest_version_chk'
  ) then
    alter table public.couranr_delivery_requests
      add constraint couranr_dr_pickup_manifest_version_chk
      check (pickup_manifest_version >= 0);
  end if;
end
$$;

comment on column public.couranr_delivery_requests.pickup_manifest is
  'Sender-declared expected pickup identity. Server-built only; copied into the delivery shipment snapshot before assignment.';
comment on column public.couranr_delivery_requests.pickup_manifest_version is
  'Independent CAS generation for pickup-manifest edits. Does not mutate commercial request/quote version.';

create or replace function private.couranr_build_pickup_manifest(
  p_description text,
  p_package_count integer,
  p_order_reference text,
  p_handling_notes text,
  p_source text
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_description text := nullif(btrim(coalesce(p_description,'')),'');
  v_reference text := nullif(btrim(coalesce(p_order_reference,'')),'');
  v_handling text := nullif(btrim(coalesce(p_handling_notes,'')),'');
begin
  if v_description is null then
    raise exception 'pickup_description_required' using errcode='CR422';
  end if;
  if length(v_description) > 1000 then
    raise exception 'pickup_description_too_long' using errcode='CR422';
  end if;
  if p_package_count is not null and (p_package_count < 1 or p_package_count > 9999) then
    raise exception 'pickup_package_count_invalid' using errcode='CR422';
  end if;
  if v_reference is not null and length(v_reference) > 120 then
    raise exception 'pickup_reference_too_long' using errcode='CR422';
  end if;
  if v_handling is not null and length(v_handling) > 500 then
    raise exception 'pickup_handling_too_long' using errcode='CR422';
  end if;
  if p_source not in (
    'merchant_statement',
    'consumer_statement',
    'hosted_customer_statement',
    'merchant_confirmed',
    'operations_statement'
  ) then
    raise exception 'pickup_manifest_source_invalid' using errcode='CR422';
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'description', v_description,
    'packageCount', p_package_count,
    'orderReference', v_reference,
    'handlingNotes', v_handling,
    'source', p_source
  ));
end
$fn$;

revoke all on function private.couranr_build_pickup_manifest(text,integer,text,text,text)
  from public,anon,authenticated;
grant execute on function private.couranr_build_pickup_manifest(text,integer,text,text,text)
  to service_role;

/* One internal write primitive: independent manifest CAS, no commercial
   request-version bump. Every public wrapper establishes its own actor scope. */
create or replace function private.couranr_write_pickup_manifest(
  p_request_id uuid,
  p_expected_manifest_version integer,
  p_manifest jsonb
)
returns public.couranr_delivery_requests
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_row public.couranr_delivery_requests;
begin
  if p_expected_manifest_version is null or p_expected_manifest_version < 0 then
    raise exception 'pickup_manifest_version_required' using errcode='CR409';
  end if;
  if p_manifest is null or jsonb_typeof(p_manifest) <> 'object' then
    raise exception 'pickup_manifest_required' using errcode='CR422';
  end if;

  select * into v_row
    from public.couranr_delivery_requests
   where id=p_request_id
   for update;
  if not found then
    raise exception 'request_not_found' using errcode='CR404';
  end if;

  -- Exact replay is idempotent even when its expected generation is stale.
  -- This makes network retries converge without letting a stale DIFFERENT
  -- manifest overwrite the current sender statement.
  if v_row.pickup_manifest is not distinct from p_manifest then
    return v_row;
  end if;
  if v_row.pickup_manifest_version <> p_expected_manifest_version then
    raise exception 'pickup_manifest_version_conflict' using errcode='CR409';
  end if;

  update public.couranr_delivery_requests
     set pickup_manifest=p_manifest,
         pickup_manifest_version=pickup_manifest_version+1,
         updated_at=now()
   where id=p_request_id
  returning * into v_row;
  return v_row;
end
$fn$;

revoke all on function private.couranr_write_pickup_manifest(uuid,integer,jsonb)
  from public,anon,authenticated;
grant execute on function private.couranr_write_pickup_manifest(uuid,integer,jsonb)
  to service_role;

create or replace function public.couranr_set_business_pickup_manifest(
  p_request_id uuid,
  p_business_account_id uuid,
  p_actor_user_id uuid,
  p_expected_manifest_version integer,
  p_description text,
  p_package_count integer,
  p_order_reference text,
  p_handling_notes text
)
returns public.couranr_delivery_requests
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_role text;
  v_req public.couranr_delivery_requests;
  v_manifest jsonb;
begin
  v_role := public.couranr_require_active_member(p_business_account_id,p_actor_user_id);
  if v_role not in ('owner','manager','dispatcher') then
    raise exception 'not_permitted' using errcode='CR403';
  end if;

  select * into v_req
    from public.couranr_delivery_requests
   where id=p_request_id
     and business_account_id=p_business_account_id
     and requester_kind='business'
   for update;
  if not found then raise exception 'request_not_found' using errcode='CR404'; end if;
  if v_req.request_state <> 'draft' then
    raise exception 'pickup_manifest_locked' using errcode='CR409';
  end if;

  v_manifest := private.couranr_build_pickup_manifest(
    p_description,p_package_count,p_order_reference,p_handling_notes,'merchant_statement'
  );
  return private.couranr_write_pickup_manifest(
    p_request_id,p_expected_manifest_version,v_manifest
  );
end
$fn$;

create or replace function public.couranr_set_operations_pickup_manifest(
  p_request_id uuid,
  p_actor_user_id uuid,
  p_expected_manifest_version integer,
  p_description text,
  p_package_count integer,
  p_order_reference text,
  p_handling_notes text
)
returns public.couranr_delivery_requests
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_role text;
  v_req public.couranr_delivery_requests;
  v_manifest jsonb;
begin
  select role into v_role from public.profiles where id=p_actor_user_id;
  if v_role is distinct from 'admin' then
    raise exception 'operations_access_required' using errcode='CR403';
  end if;

  select * into v_req from public.couranr_delivery_requests
   where id=p_request_id for update;
  if not found then raise exception 'request_not_found' using errcode='CR404'; end if;
  if v_req.request_state <> 'draft' then
    raise exception 'pickup_manifest_locked' using errcode='CR409';
  end if;

  v_manifest := private.couranr_build_pickup_manifest(
    p_description,p_package_count,p_order_reference,p_handling_notes,'operations_statement'
  );
  return private.couranr_write_pickup_manifest(
    p_request_id,p_expected_manifest_version,v_manifest
  );
end
$fn$;

create or replace function public.couranr_set_consumer_pickup_manifest(
  p_guest_session_id uuid,
  p_expected_manifest_version integer,
  p_description text,
  p_package_count integer,
  p_order_reference text,
  p_handling_notes text
)
returns public.couranr_delivery_requests
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_session public.couranr_consumer_guest_sessions;
  v_req public.couranr_delivery_requests;
  v_manifest jsonb;
begin
  select * into v_session
    from public.couranr_consumer_guest_sessions
   where id=p_guest_session_id
     and revoked_at is null
     and expires_at > now()
   for update;
  if not found or v_session.request_id is null then
    raise exception 'guest_session_not_available' using errcode='CR404';
  end if;

  select * into v_req
    from public.couranr_delivery_requests
   where id=v_session.request_id
     and requester_kind='consumer'
     and business_account_id is null
     and idempotency_scope='consumer:' || p_guest_session_id::text
   for update;
  if not found then raise exception 'request_not_found' using errcode='CR404'; end if;
  if v_req.request_state <> 'draft' then
    raise exception 'pickup_manifest_locked' using errcode='CR409';
  end if;

  v_manifest := private.couranr_build_pickup_manifest(
    p_description,p_package_count,p_order_reference,p_handling_notes,'consumer_statement'
  );
  return private.couranr_write_pickup_manifest(
    v_req.id,p_expected_manifest_version,v_manifest
  );
end
$fn$;

create or replace function public.couranr_set_hosted_customer_pickup_manifest(
  p_intake_id uuid,
  p_expected_manifest_version integer,
  p_description text,
  p_package_count integer,
  p_order_reference text,
  p_handling_notes text
)
returns public.couranr_delivery_requests
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_intake public.couranr_hosted_request_intakes;
  v_req public.couranr_delivery_requests;
  v_manifest jsonb;
begin
  select * into v_intake from public.couranr_hosted_request_intakes
   where id=p_intake_id and expires_at > now()
   for update;
  if not found or v_intake.request_id is null then
    raise exception 'hosted_request_not_found' using errcode='CR404';
  end if;

  select * into v_req from public.couranr_delivery_requests
   where id=v_intake.request_id
     and source='hosted_request'
     and requester_kind='consumer'
     and business_account_id is null
   for update;
  if not found then raise exception 'request_not_found' using errcode='CR404'; end if;
  if v_req.request_state <> 'awaiting_merchant_confirmation' then
    raise exception 'pickup_manifest_locked' using errcode='CR409';
  end if;

  v_manifest := private.couranr_build_pickup_manifest(
    p_description,p_package_count,p_order_reference,p_handling_notes,'hosted_customer_statement'
  );
  return private.couranr_write_pickup_manifest(
    v_req.id,p_expected_manifest_version,v_manifest
  );
end
$fn$;

create or replace function public.couranr_confirm_hosted_pickup_manifest(
  p_request_id uuid,
  p_host_business_account_id uuid,
  p_actor_user_id uuid,
  p_expected_manifest_version integer,
  p_description text,
  p_package_count integer,
  p_order_reference text,
  p_handling_notes text
)
returns public.couranr_delivery_requests
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_role text;
  v_req public.couranr_delivery_requests;
  v_manifest jsonb;
begin
  v_role := public.couranr_require_active_member(p_host_business_account_id,p_actor_user_id);
  if v_role not in ('owner','manager','dispatcher') then
    raise exception 'not_permitted' using errcode='CR403';
  end if;

  select r.* into v_req
    from public.couranr_delivery_requests r
   where r.id=p_request_id
     and r.source='hosted_request'
     and r.requester_kind='consumer'
     and r.business_account_id is null
     and exists (
       select 1 from public.couranr_hosted_request_intakes h
        where h.request_id=r.id
          and h.host_business_account_id=p_host_business_account_id
     )
   for update;
  if not found then raise exception 'request_not_found' using errcode='CR404'; end if;
  if v_req.request_state <> 'awaiting_merchant_confirmation' then
    raise exception 'pickup_manifest_locked' using errcode='CR409';
  end if;

  v_manifest := private.couranr_build_pickup_manifest(
    p_description,p_package_count,p_order_reference,p_handling_notes,'merchant_confirmed'
  );
  return private.couranr_write_pickup_manifest(
    p_request_id,p_expected_manifest_version,v_manifest
  );
end
$fn$;

revoke all on function public.couranr_set_business_pickup_manifest(uuid,uuid,uuid,integer,text,integer,text,text)
  from public,anon,authenticated;
revoke all on function public.couranr_set_operations_pickup_manifest(uuid,uuid,integer,text,integer,text,text)
  from public,anon,authenticated;
revoke all on function public.couranr_set_consumer_pickup_manifest(uuid,integer,text,integer,text,text)
  from public,anon,authenticated;
revoke all on function public.couranr_set_hosted_customer_pickup_manifest(uuid,integer,text,integer,text,text)
  from public,anon,authenticated;
revoke all on function public.couranr_confirm_hosted_pickup_manifest(uuid,uuid,uuid,integer,text,integer,text,text)
  from public,anon,authenticated;
grant execute on function public.couranr_set_business_pickup_manifest(uuid,uuid,uuid,integer,text,integer,text,text)
  to service_role;
grant execute on function public.couranr_set_operations_pickup_manifest(uuid,uuid,integer,text,integer,text,text)
  to service_role;
grant execute on function public.couranr_set_consumer_pickup_manifest(uuid,integer,text,integer,text,text)
  to service_role;
grant execute on function public.couranr_set_hosted_customer_pickup_manifest(uuid,integer,text,integer,text,text)
  to service_role;
grant execute on function public.couranr_confirm_hosted_pickup_manifest(uuid,uuid,uuid,integer,text,integer,text,text)
  to service_role;

/* Freeze the request's expected pickup into every NEW delivery snapshot.
   Existing deliveries are deliberately not backfilled. */
create or replace function private.couranr_freeze_pickup_manifest_on_delivery()
returns trigger
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_manifest jsonb;
begin
  select pickup_manifest into v_manifest
    from public.couranr_delivery_requests
   where id=new.request_id;
  if v_manifest is not null then
    new.shipment := jsonb_set(
      coalesce(new.shipment,'{}'::jsonb),
      '{pickupManifest}',
      v_manifest,
      true
    );
  end if;
  return new;
end
$fn$;

revoke all on function private.couranr_freeze_pickup_manifest_on_delivery()
  from public,anon,authenticated;
grant execute on function private.couranr_freeze_pickup_manifest_on_delivery()
  to service_role;

drop trigger if exists couranr_freeze_pickup_manifest_trg on public.couranr_deliveries;
create trigger couranr_freeze_pickup_manifest_trg
before insert on public.couranr_deliveries
for each row execute function private.couranr_freeze_pickup_manifest_on_delivery();

/* --------------------------------------- consumer pickup credential ------ */

/* Existing credentials have an authenticated issuer. New consumer credentials
   are attributed to the guest session instead. The XOR CHECK makes a missing or
   double issuer structurally impossible. */
alter table public.couranr_handoff_codes
  add column if not exists issued_by_guest_session_id uuid
    references public.couranr_consumer_guest_sessions(id)
    on update cascade on delete restrict;

alter table public.couranr_handoff_codes
  alter column issued_by drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname='couranr_hc_issuer_xor_chk'
  ) then
    alter table public.couranr_handoff_codes
      add constraint couranr_hc_issuer_xor_chk
      check ((issued_by is null) <> (issued_by_guest_session_id is null));
  end if;
end
$$;

create or replace function public.couranr_issue_guest_pickup_code_cas(
  p_delivery_id uuid,
  p_expected_generation integer,
  p_code_digest text,
  p_guest_session_id uuid,
  p_ttl_minutes integer
)
returns public.couranr_handoff_codes
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_session public.couranr_consumer_guest_sessions;
  v_dlv public.couranr_deliveries;
  v_gen integer;
  v_row public.couranr_handoff_codes;
begin
  if p_expected_generation is null or p_expected_generation < 1 then
    raise exception 'handoff_generation_conflict' using errcode='CR409';
  end if;
  if p_code_digest is null or p_code_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'digest_required' using errcode='CR400';
  end if;

  select * into v_session
    from public.couranr_consumer_guest_sessions
   where id=p_guest_session_id
     and revoked_at is null
     and expires_at > now()
   for update;
  if not found or v_session.request_id is null then
    raise exception 'guest_session_not_available' using errcode='CR404';
  end if;

  select * into v_dlv from public.couranr_deliveries
   where id=p_delivery_id
     and request_id=v_session.request_id
   for update;
  if not found then
    raise exception 'delivery_not_found' using errcode='CR404';
  end if;
  if v_dlv.fulfillment_state in ('delivered','cancelled','could_not_deliver') then
    raise exception 'delivery_already_settled' using errcode='CR409';
  end if;

  select coalesce(max(generation),0)+1 into v_gen
    from public.couranr_handoff_codes
   where delivery_id=p_delivery_id
     and code_kind='merchant_pickup';
  if p_expected_generation <> v_gen then
    raise exception 'handoff_generation_conflict' using errcode='CR409';
  end if;

  update public.couranr_handoff_codes
     set code_state='superseded',
         superseded_at=now(),
         version=version+1,
         updated_at=now()
   where delivery_id=p_delivery_id
     and code_kind='merchant_pickup'
     and code_state in ('active','locked');

  insert into public.couranr_handoff_codes(
    delivery_id,code_kind,generation,code_digest,code_state,
    issued_by,issued_by_guest_session_id,issued_at,expires_at,failed_attempts
  ) values (
    p_delivery_id,'merchant_pickup',v_gen,p_code_digest,'active',
    null,p_guest_session_id,now(),
    now()+make_interval(mins=>least(greatest(coalesce(p_ttl_minutes,1440),5),4320)),
    0
  ) returning * into v_row;
  return v_row;
end
$fn$;

revoke all on function public.couranr_issue_guest_pickup_code_cas(uuid,integer,text,uuid,integer)
  from public,anon,authenticated;
grant execute on function public.couranr_issue_guest_pickup_code_cas(uuid,integer,text,uuid,integer)
  to service_role;

/* ------------------------------------------- simplified pickup custody ---- */

create or replace function public.couranr_complete_pickup_v2(
  p_delivery_id uuid,
  p_expected_version integer,
  p_actor_user_id uuid,
  p_latitude numeric,
  p_longitude numeric,
  p_accuracy_m numeric
)
returns public.couranr_deliveries
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_asg public.couranr_delivery_assignments;
  v_dlv public.couranr_deliveries;
  v_large boolean;
  v_weight numeric;
  v_count numeric;
  v_manifest jsonb;
begin
  v_asg := public.couranr_driver_assignment_for(p_delivery_id,p_actor_user_id);

  select * into v_dlv from public.couranr_deliveries
   where id=p_delivery_id for update;
  if v_dlv.fulfillment_state <> 'at_pickup' then
    raise exception 'delivery_not_in_expected_state' using errcode='CR409';
  end if;
  if p_latitude is null or p_longitude is null then
    raise exception 'location_required' using errcode='CR400';
  end if;
  if p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'location_out_of_range' using errcode='CR400';
  end if;

  if exists (
    select 1 from public.couranr_pickup_discrepancies
     where delivery_id=p_delivery_id and discrepancy_state='open'
  ) then
    raise exception 'pickup_discrepancy_open' using errcode='CR409';
  end if;

  if not exists (
    select 1 from public.couranr_handoff_codes
     where delivery_id=p_delivery_id
       and code_kind='merchant_pickup'
       and code_state='consumed'
  ) then
    raise exception 'pickup_code_not_accepted' using errcode='CR409';
  end if;

  if not exists (
    select 1 from public.couranr_delivery_proofs
     where delivery_id=p_delivery_id
       and assignment_id=v_asg.id
       and proof_stage='pickup'
       and proof_type='shipment_photo'
  ) then
    raise exception 'shipment_photo_required' using errcode='CR409';
  end if;

  v_manifest := v_dlv.shipment->'pickupManifest';
  v_weight := nullif(v_dlv.shipment->>'weightLb','')::numeric;
  v_count := case
    when jsonb_typeof(v_manifest->'packageCount')='number'
      then (v_manifest->>'packageCount')::numeric
    else nullif(v_dlv.shipment->>'packageCount','')::numeric
  end;
  v_large := (v_dlv.vehicle_requirement->>'vehicleClass')='box_truck'
             or coalesce(v_weight,0)>=150
             or coalesce(v_count,0)>=10;

  if v_large and not exists (
    select 1 from public.couranr_delivery_proofs
     where delivery_id=p_delivery_id
       and assignment_id=v_asg.id
       and proof_stage='pickup'
       and proof_type='securement_photo'
  ) then
    raise exception 'securement_photo_required' using errcode='CR409';
  end if;

  insert into public.couranr_handoff_records(
    delivery_id,assignment_id,handoff_stage,
    observed_package_count,counterparty_first_name,confirmed_vehicle_id,
    latitude,longitude,accuracy_m,large_or_unusual,
    actor_driver_id,recorded_at
  ) values (
    p_delivery_id,v_asg.id,'pickup',
    null,null,v_asg.vehicle_id,
    p_latitude,p_longitude,p_accuracy_m,v_large,
    v_asg.driver_id,now()
  );

  update public.couranr_deliveries
     set fulfillment_state='picked_up',version=version+1,updated_at=now()
   where id=p_delivery_id
     and version=p_expected_version
     and fulfillment_state='at_pickup'
  returning * into v_dlv;
  if not found then
    raise exception 'delivery_not_in_expected_state' using errcode='CR409';
  end if;

  insert into public.couranr_delivery_events(
    delivery_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    p_delivery_id,p_actor_user_id,'driver','complete_pickup',
    'at_pickup','picked_up',
    jsonb_strip_nulls(jsonb_build_object(
      'assignmentId',v_asg.id,
      'matchedExpected',true,
      'expectedPackageCount',v_count,
      'pickupManifestPresent',v_manifest is not null,
      'largeOrUnusual',v_large,
      'latitude',p_latitude,
      'longitude',p_longitude,
      'accuracyM',p_accuracy_m
    ))
  );

  return v_dlv;
end
$fn$;

revoke all on function public.couranr_complete_pickup_v2(uuid,integer,uuid,numeric,numeric,numeric)
  from public,anon,authenticated;
grant execute on function public.couranr_complete_pickup_v2(uuid,integer,uuid,numeric,numeric,numeric)
  to service_role;

commit;

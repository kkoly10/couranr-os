-- =====================================================================
-- FOUNDATION GATE A / M4
-- Runtime authority cutover.
--
-- request.version remains a compare-and-set generation only. Commercial
-- identity is the immutable quote UUID propagated through payment, planning
-- and delivery conversion. Existing public function signatures remain as
-- compatibility wrappers where the Business application already calls them;
-- browser-supplied quote arguments on the legacy submit signature are ignored.
-- =====================================================================

begin;
set local statement_timeout = '300s';
set local lock_timeout = '10s';

do $guard$
begin
  if to_regclass('public.couranr_quote_versions') is null
     or not exists (
       select 1 from information_schema.columns
        where table_schema='public' and table_name='couranr_delivery_requests'
          and column_name='current_quote_version_id'
     ) then
    raise exception 'Gate A M4 requires M1-M3';
  end if;
  if exists (select 1 from public.couranr_payment_obligations where quote_version_id is null)
     or exists (select 1 from public.couranr_service_plans where quote_version_id is null)
     or exists (select 1 from public.couranr_deliveries where quote_version_id is null) then
    raise exception 'Gate A M4 refuses an incomplete historical quote mapping';
  end if;
end
$guard$;

-- ---------------------------------------------------------------------
-- One internal primitive performs the append + compatibility projection.
-- It assumes its caller has already locked and CAS-advanced the request.
-- ---------------------------------------------------------------------
create function private.couranr_append_quote_version(
  p_request_id              uuid,
  p_created_by_user_id      uuid,
  p_request_version         integer,
  p_quote_status            text,
  p_pricing_policy_version  text,
  p_delivery_subtotal_cents integer,
  p_included_loaded_miles   integer,
  p_billable_loaded_miles   numeric,
  p_quote_line_items        jsonb,
  p_review_reasons          jsonb
)
returns public.couranr_quote_versions
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_req          public.couranr_delivery_requests;
  v_quote        public.couranr_quote_versions;
  v_quote_number integer;
  v_previous_id  uuid;
  v_total        bigint;
begin
  select * into v_req
    from public.couranr_delivery_requests
   where id = p_request_id
   for update;
  if not found then
    raise exception 'request_not_found' using errcode = 'CR404';
  end if;
  if v_req.version is distinct from p_request_version then
    raise exception 'version_or_state_conflict' using errcode = 'CR409';
  end if;
  if p_quote_status not in ('estimated','manual_review_required','invalid') then
    raise exception 'invalid_quote_status' using errcode = 'CR422';
  end if;
  if jsonb_typeof(p_quote_line_items) is distinct from 'array'
     or jsonb_typeof(p_review_reasons) is distinct from 'array' then
    raise exception 'quote_arrays_required' using errcode = 'CR422';
  end if;

  v_total := public.couranr_quote_line_items_total(p_quote_line_items);
  if p_quote_status = 'estimated' then
    if p_pricing_policy_version is null or p_delivery_subtotal_cents is null
       or p_delivery_subtotal_cents < 0 then
      raise exception 'quote_incomplete' using errcode = 'CR422';
    end if;
    if v_total is distinct from p_delivery_subtotal_cents::bigint then
      raise exception 'quote_subtotal_mismatch' using errcode = 'CR422';
    end if;
  elsif p_delivery_subtotal_cents is not null
        or p_pricing_policy_version is not null
        or v_total is distinct from 0 then
    raise exception 'unpriced_quote_contains_commercial_amount' using errcode = 'CR422';
  end if;

  select coalesce(max(quote_number), 0) + 1
    into v_quote_number
    from public.couranr_quote_versions
   where request_id = p_request_id;
  v_previous_id := v_req.current_quote_version_id;

  insert into public.couranr_quote_versions (
    request_id, quote_number, supersedes_quote_version_id,
    created_by_user_id, request_version_at_creation,
    quote_status, pricing_policy_version, payer_type, currency,
    subtotal_cents, included_loaded_miles, billable_loaded_miles,
    quote_line_items, review_reasons,
    pickup_address_snapshot, dropoff_address_snapshot, recipient_snapshot,
    shipment_snapshot, service_configuration_snapshot,
    loaded_distance_miles, route_duration_seconds, distance_source,
    provenance_state, record_origin, legacy_evidence
  ) values (
    v_req.id, v_quote_number, v_previous_id,
    p_created_by_user_id, v_req.version,
    p_quote_status, p_pricing_policy_version, v_req.payer_type, 'usd',
    p_delivery_subtotal_cents, p_included_loaded_miles, p_billable_loaded_miles,
    p_quote_line_items, p_review_reasons,
    v_req.pickup_address, v_req.dropoff_address,
    jsonb_build_object('name', v_req.recipient_name, 'phone', v_req.recipient_phone,
                       'email', v_req.recipient_email),
    jsonb_build_object('loadedMiles', v_req.loaded_miles, 'weightLb', v_req.weight_lb,
                       'additionalStops', v_req.additional_stops),
    jsonb_build_object('serviceLevel', v_req.service_level,
                       'signatureRequired', v_req.signature_required,
                       'proofMethod', v_req.proof_method),
    v_req.loaded_miles, null,
    case when v_req.loaded_miles is not null then 'request_supplied' else null end,
    'verified', 'runtime', null
  ) returning * into v_quote;

  perform set_config('couranr.quote_projection_write', 'on', true);
  update public.couranr_delivery_requests
     set current_quote_version_id = v_quote.id,
         quote_status = v_quote.quote_status,
         pricing_policy_version = v_quote.pricing_policy_version,
         delivery_subtotal_cents = v_quote.subtotal_cents,
         included_loaded_miles = v_quote.included_loaded_miles,
         billable_loaded_miles = v_quote.billable_loaded_miles,
         quote_line_items = coalesce(v_quote.quote_line_items, '[]'::jsonb),
         review_reasons = v_quote.review_reasons,
         rounding_applied = false,
         tax_included = false,
         payment_due_cents = null,
         updated_at = now()
   where id = v_req.id;
  perform set_config('couranr.quote_projection_write', 'off', true);

  -- Any previously-issued link remains tied to its obligation/old quote and
  -- is revoked at the moment the current quote pointer moves.
  if v_previous_id is not null and v_previous_id is distinct from v_quote.id then
    update public.couranr_payment_access_tokens
       set revoked_at = now(), revoked_reason = 'quote_superseded'
     where request_id = v_req.id and revoked_at is null;
  end if;

  return v_quote;
end
$fn$;

revoke all on function private.couranr_append_quote_version(
  uuid,uuid,integer,text,text,integer,integer,numeric,jsonb,jsonb
) from public, anon, authenticated, service_role;
grant execute on function private.couranr_append_quote_version(
  uuid,uuid,integer,text,text,integer,integer,numeric,jsonb,jsonb
) to service_role;

-- ---------------------------------------------------------------------
-- Named general quote command. It is deliberately service_role-only and takes
-- a CAS version. Browser routes never receive table/function grants.
-- ---------------------------------------------------------------------
create function public.couranr_create_quote_version(
  p_request_id              uuid,
  p_business_account_id     uuid,
  p_expected_version        integer,
  p_actor_user_id           uuid,
  p_quote_status            text,
  p_pricing_policy_version  text,
  p_delivery_subtotal_cents integer,
  p_included_loaded_miles   integer,
  p_billable_loaded_miles   numeric,
  p_quote_line_items        jsonb,
  p_review_reasons          jsonb
)
returns public.couranr_delivery_requests
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_req            public.couranr_delivery_requests;
  v_quote          public.couranr_quote_versions;
  v_previous_state text;
  v_target_state   text;
begin
  select request_state into v_previous_state
    from public.couranr_delivery_requests
   where id = p_request_id
     and business_account_id is not distinct from p_business_account_id
   for update;
  if not found then
    raise exception 'request_not_found' using errcode='CR404';
  end if;

  v_target_state := case
    when v_previous_state = 'draft' then 'draft'
    else 'quote_revision_required'
  end;

  update public.couranr_delivery_requests
     set version = p_expected_version + 1,
         request_state = v_target_state,
         review_state = case
           when v_target_state = 'quote_revision_required' then 'requoted'
           else review_state
         end,
         updated_at = now()
   where id = p_request_id
     and business_account_id is not distinct from p_business_account_id
     and version = p_expected_version
     and request_state in (
       'draft','pending_couranr_review','confirmed',
       'awaiting_quote_acceptance','quote_revision_required'
     )
  returning * into v_req;
  if not found then
    raise exception 'version_or_state_conflict' using errcode='CR409';
  end if;

  v_quote := private.couranr_append_quote_version(
    v_req.id, p_actor_user_id, v_req.version,
    p_quote_status, p_pricing_policy_version, p_delivery_subtotal_cents,
    p_included_loaded_miles, p_billable_loaded_miles,
    p_quote_line_items, p_review_reasons
  );

  insert into public.couranr_delivery_request_events (
    request_id, actor_user_id, actor_type, command, from_state, to_state, metadata
  ) values (
    v_req.id, p_actor_user_id,
    case when v_req.requester_kind='business' then 'merchant' else 'customer' end,
    case when v_previous_state='draft'
      then 'calculate_delivery_request_estimate'
      else 'create_quote_version'
    end,
    v_previous_state, v_target_state,
    jsonb_build_object('quoteVersionId',v_quote.id,'quoteNumber',v_quote.quote_number,
      'payerType',v_quote.payer_type,'quoteStatus',v_quote.quote_status,
      'reviewReasons',v_quote.review_reasons)
  );

  select * into v_req from public.couranr_delivery_requests where id=v_req.id;
  return v_req;
end
$fn$;

revoke all on function public.couranr_create_quote_version(
  uuid,uuid,integer,uuid,text,text,integer,integer,numeric,jsonb,jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.couranr_create_quote_version(
  uuid,uuid,integer,uuid,text,text,integer,integer,numeric,jsonb,jsonb
) to service_role;

-- ---------------------------------------------------------------------
-- Existing Business create/estimate functions now mint immutable quotes.
-- Their signatures remain stable so the current UI does not need a flag day.
-- ---------------------------------------------------------------------
create or replace function public.couranr_create_delivery_request_draft(
  p_business_account_id uuid, p_created_by uuid, p_idempotency_key text,
  p_source text, p_readiness_state text, p_payer_type text,
  p_recipient_name text, p_recipient_phone text, p_recipient_email text,
  p_loaded_miles numeric, p_weight_lb numeric, p_additional_stops integer,
  p_service_level text, p_signature_required boolean, p_proof_method text,
  p_pickup_address jsonb, p_dropoff_address jsonb, p_overnight_requested boolean,
  p_quote_status text, p_pricing_policy_version text,
  p_delivery_subtotal_cents integer, p_included_loaded_miles integer,
  p_billable_loaded_miles numeric, p_quote_line_items jsonb, p_review_reasons jsonb
)
returns public.couranr_delivery_requests
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_quote public.couranr_quote_versions;
begin
  begin
    insert into public.couranr_delivery_requests (
      business_account_id, created_by, idempotency_key,
      request_state, review_state, service_area_review_state,
      source, readiness_state, payer_type,
      recipient_name, recipient_phone, recipient_email,
      loaded_miles, weight_lb, additional_stops,
      service_level, signature_required, proof_method,
      pickup_address, dropoff_address, normalized_request_payload,
      quote_status, quote_line_items, review_reasons,
      rounding_applied, tax_included, payment_due_cents
    ) values (
      p_business_account_id,p_created_by,p_idempotency_key,
      'draft','not_required','pending',p_source,p_readiness_state,p_payer_type,
      p_recipient_name,p_recipient_phone,p_recipient_email,
      p_loaded_miles,p_weight_lb,p_additional_stops,
      p_service_level,p_signature_required,p_proof_method,
      p_pickup_address,p_dropoff_address,
      jsonb_build_object('overnightRequested',coalesce(p_overnight_requested,false)),
      'not_quoted','[]'::jsonb,'[]'::jsonb,false,false,null
    ) returning * into v_req;
  exception when unique_violation then
    select * into v_req from public.couranr_delivery_requests
     where idempotency_scope='business:'||p_business_account_id::text
       and idempotency_key=p_idempotency_key;
    if not found then raise; end if;
    return v_req;
  end;

  if p_quote_status <> 'not_quoted' then
    v_quote := private.couranr_append_quote_version(
      v_req.id,p_created_by,v_req.version,p_quote_status,p_pricing_policy_version,
      p_delivery_subtotal_cents,p_included_loaded_miles,p_billable_loaded_miles,
      p_quote_line_items,p_review_reasons
    );
  end if;

  insert into public.couranr_delivery_request_events(
    request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_req.id,p_created_by,'merchant','create_delivery_request_draft',null,'draft',
    jsonb_build_object('quoteVersionId',v_quote.id,'quoteStatus',p_quote_status,
                       'reviewReasons',p_review_reasons)
  );
  select * into v_req from public.couranr_delivery_requests where id=v_req.id;
  return v_req;
end
$fn$;

create or replace function public.couranr_calculate_delivery_request_estimate(
  p_request_id uuid, p_business_account_id uuid, p_expected_version integer,
  p_actor_user_id uuid, p_update_shipment boolean,
  p_source text, p_readiness_state text, p_payer_type text,
  p_recipient_name text, p_recipient_phone text, p_recipient_email text,
  p_loaded_miles numeric, p_weight_lb numeric, p_additional_stops integer,
  p_service_level text, p_signature_required boolean, p_proof_method text,
  p_pickup_address jsonb, p_dropoff_address jsonb, p_overnight_requested boolean,
  p_quote_status text, p_pricing_policy_version text,
  p_delivery_subtotal_cents integer, p_included_loaded_miles integer,
  p_billable_loaded_miles numeric, p_quote_line_items jsonb, p_review_reasons jsonb
)
returns public.couranr_delivery_requests
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_quote public.couranr_quote_versions;
begin
  if p_quote_status='not_quoted' then
    raise exception 'quote_version_required' using errcode='CR422';
  end if;
  if p_update_shipment then
    update public.couranr_delivery_requests set
      source=p_source, readiness_state=p_readiness_state, payer_type=p_payer_type,
      recipient_name=p_recipient_name,recipient_phone=p_recipient_phone,
      recipient_email=p_recipient_email,loaded_miles=p_loaded_miles,
      weight_lb=p_weight_lb,additional_stops=p_additional_stops,
      service_level=p_service_level,signature_required=p_signature_required,
      proof_method=p_proof_method,pickup_address=p_pickup_address,
      dropoff_address=p_dropoff_address,
      normalized_request_payload=jsonb_build_object(
        'overnightRequested',coalesce(p_overnight_requested,false)),
      version=p_expected_version+1,updated_at=now()
    where id=p_request_id and business_account_id=p_business_account_id
      and version=p_expected_version and request_state='draft'
    returning * into v_req;
  else
    update public.couranr_delivery_requests
       set version=p_expected_version+1,updated_at=now()
     where id=p_request_id and business_account_id=p_business_account_id
       and version=p_expected_version and request_state='draft'
    returning * into v_req;
  end if;
  if not found then
    if not exists(select 1 from public.couranr_delivery_requests
      where id=p_request_id and business_account_id=p_business_account_id) then
      raise exception 'request_not_found' using errcode='CR404';
    end if;
    raise exception 'version_or_state_conflict' using errcode='CR409';
  end if;

  v_quote := private.couranr_append_quote_version(
    v_req.id,p_actor_user_id,v_req.version,p_quote_status,p_pricing_policy_version,
    p_delivery_subtotal_cents,p_included_loaded_miles,p_billable_loaded_miles,
    p_quote_line_items,p_review_reasons
  );
  insert into public.couranr_delivery_request_events(
    request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_req.id,p_actor_user_id,'merchant','calculate_delivery_request_estimate',
    'draft','draft',jsonb_build_object('quoteVersionId',v_quote.id,
      'quoteNumber',v_quote.quote_number,'quoteStatus',v_quote.quote_status,
      'reviewReasons',v_quote.review_reasons)
  );
  select * into v_req from public.couranr_delivery_requests where id=v_req.id;
  return v_req;
end
$fn$;

-- ---------------------------------------------------------------------
-- Submission v2 references the existing current quote; it never defines one.
-- ---------------------------------------------------------------------
create function public.couranr_submit_delivery_request_v2(
  p_request_id uuid, p_business_account_id uuid, p_expected_version integer,
  p_actor_user_id uuid, p_acknowledged boolean default false
)
returns public.couranr_delivery_requests
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_quote public.couranr_quote_versions;
begin
  select * into v_req from public.couranr_delivery_requests
   where id=p_request_id and business_account_id is not distinct from p_business_account_id
   for update;
  if not found then raise exception 'request_not_found' using errcode='CR404'; end if;
  if v_req.version is distinct from p_expected_version or v_req.request_state<>'draft' then
    raise exception 'version_or_state_conflict' using errcode='CR409';
  end if;
  if v_req.current_quote_version_id is null then
    raise exception 'current_quote_required' using errcode='CR422';
  end if;
  select * into v_quote from public.couranr_quote_versions
   where id=v_req.current_quote_version_id and request_id=v_req.id;
  if not found or v_quote.quote_status='invalid' then
    raise exception 'current_quote_invalid' using errcode='CR422';
  end if;

  update public.couranr_delivery_requests set
    request_state='pending_couranr_review',review_state='pending',submitted_at=now(),
    version=p_expected_version+1,updated_at=now()
  where id=v_req.id and version=p_expected_version
  returning * into v_req;
  if not found then raise exception 'version_or_state_conflict' using errcode='CR409'; end if;

  insert into public.couranr_delivery_request_events(
    request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_req.id,p_actor_user_id,
    case when v_req.requester_kind='business' then 'merchant' else 'customer' end,
    'submit_delivery_request','draft','pending_couranr_review',
    jsonb_build_object(
      'quoteVersionId',v_quote.id,'quoteNumber',v_quote.quote_number,
      'payerType',v_quote.payer_type,'acknowledgment',coalesce(p_acknowledged,false),
      'quoteStatus',v_quote.quote_status,'reviewReasons',v_quote.review_reasons)
  );
  return v_req;
end
$fn$;

revoke all on function public.couranr_submit_delivery_request_v2(uuid,uuid,integer,uuid,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_submit_delivery_request_v2(uuid,uuid,integer,uuid,boolean)
  to service_role;

create or replace function public.couranr_submit_delivery_request(
  p_request_id uuid,p_business_account_id uuid,p_expected_version integer,
  p_actor_user_id uuid,p_quote_status text,p_pricing_policy_version text,
  p_delivery_subtotal_cents integer,p_included_loaded_miles integer,
  p_billable_loaded_miles numeric,p_quote_line_items jsonb,p_review_reasons jsonb,
  p_merchant_acknowledged boolean default false
)
returns public.couranr_delivery_requests
language plpgsql security invoker set search_path=''
as $fn$
declare v_req public.couranr_delivery_requests;
begin
  -- All quote-shaped compatibility arguments are intentionally ignored.
  select * into v_req from public.couranr_submit_delivery_request_v2(
    p_request_id,p_business_account_id,p_expected_version,p_actor_user_id,
    p_merchant_acknowledged
  );
  return v_req;
end
$fn$;

create or replace function public.couranr_accept_delivery_request_as_quoted(
  p_request_id uuid,p_business_account_id uuid,p_expected_version integer,
  p_actor_user_id uuid
)
returns public.couranr_delivery_requests
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_quote public.couranr_quote_versions;
  v_ack jsonb;
  v_target text;
begin
  select * into v_req from public.couranr_delivery_requests
   where id=p_request_id and business_account_id is not distinct from p_business_account_id
   for update;
  if not found then raise exception 'request_not_found' using errcode='CR404'; end if;
  if v_req.current_quote_version_id is null then
    raise exception 'no_server_quote_to_confirm' using errcode='CR422';
  end if;
  select * into v_quote from public.couranr_quote_versions
   where id=v_req.current_quote_version_id and request_id=v_req.id;
  if not found or v_quote.quote_status<>'estimated' or v_quote.subtotal_cents is null then
    raise exception 'no_server_quote_to_confirm' using errcode='CR422';
  end if;

  if v_quote.payer_type='merchant' then
    select metadata into v_ack from public.couranr_delivery_request_events
     where request_id=v_req.id and command='submit_delivery_request'
     order by created_at desc limit 1;
    if v_ack is null
       or coalesce((v_ack->>'acknowledgment')::boolean,false) is not true then
      raise exception 'merchant_acknowledgment_missing' using errcode='CR412';
    end if;
    if (v_ack->>'quoteVersionId') is distinct from v_quote.id::text then
      raise exception 'quote_revised_since_acknowledgment' using errcode='CR412';
    end if;
    v_target:='confirmed';
  else
    v_target:='awaiting_quote_acceptance';
  end if;

  update public.couranr_delivery_requests set
    request_state=v_target,review_state='accepted_as_quoted',
    version=p_expected_version+1,updated_at=now()
  where id=v_req.id and version=p_expected_version
    and request_state='pending_couranr_review' and review_state='pending'
  returning * into v_req;
  if not found then raise exception 'version_or_state_conflict' using errcode='CR409'; end if;

  insert into public.couranr_delivery_request_events(
    request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_req.id,p_actor_user_id,'operations','accept_delivery_request_as_quoted',
    'pending_couranr_review',v_target,
    jsonb_build_object('quoteVersionId',v_quote.id,'quoteNumber',v_quote.quote_number,
      'payerType',v_quote.payer_type,'reviewState','accepted_as_quoted',
      'quoteChanged',false)
  );
  return v_req;
end
$fn$;

create or replace function public.couranr_requote_delivery_request(
  p_request_id uuid,p_business_account_id uuid,p_expected_version integer,
  p_actor_user_id uuid,p_pricing_policy_version text,
  p_delivery_subtotal_cents integer,p_included_loaded_miles integer,
  p_billable_loaded_miles numeric,p_quote_line_items jsonb,p_requote_reason text
)
returns public.couranr_delivery_requests
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_before public.couranr_quote_versions;
  v_quote public.couranr_quote_versions;
begin
  if nullif(btrim(p_requote_reason),'') is null then
    raise exception 'requote_reason_required' using errcode='CR422';
  end if;
  select q.* into v_before
    from public.couranr_delivery_requests r
    left join public.couranr_quote_versions q on q.id=r.current_quote_version_id
   where r.id=p_request_id and r.business_account_id is not distinct from p_business_account_id;

  update public.couranr_delivery_requests set
    request_state='quote_revision_required',review_state='requoted',
    version=p_expected_version+1,updated_at=now()
  where id=p_request_id and business_account_id is not distinct from p_business_account_id
    and version=p_expected_version and request_state='pending_couranr_review'
    and review_state='pending'
  returning * into v_req;
  if not found then
    if not exists(select 1 from public.couranr_delivery_requests where id=p_request_id
      and business_account_id is not distinct from p_business_account_id) then
      raise exception 'request_not_found' using errcode='CR404';
    end if;
    raise exception 'version_or_state_conflict' using errcode='CR409';
  end if;

  v_quote:=private.couranr_append_quote_version(
    v_req.id,p_actor_user_id,v_req.version,'estimated',p_pricing_policy_version,
    p_delivery_subtotal_cents,p_included_loaded_miles,p_billable_loaded_miles,
    p_quote_line_items,'[]'::jsonb
  );
  insert into public.couranr_delivery_request_events(
    request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_req.id,p_actor_user_id,'operations','requote_delivery_request',
    'pending_couranr_review','quote_revision_required',
    jsonb_build_object('previousQuoteVersionId',v_before.id,
      'quoteVersionId',v_quote.id,'quoteNumber',v_quote.quote_number,
      'payerType',v_quote.payer_type,'reason',p_requote_reason,'quoteChanged',true)
  );
  select * into v_req from public.couranr_delivery_requests where id=v_req.id;
  return v_req;
end
$fn$;

-- ---------------------------------------------------------------------
-- Payment obligation: amount, policy, payer and currency come only from the
-- exact current quote row. An authorization on Q1 is never reused for Q2.
-- ---------------------------------------------------------------------
create or replace function public.couranr_create_payment_obligation(
  p_request_id uuid,p_business_account_id uuid,p_idempotency_key text
)
returns public.couranr_payment_obligations
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_quote public.couranr_quote_versions;
  v_ob public.couranr_payment_obligations;
  v_gen integer;
begin
  select * into v_req from public.couranr_delivery_requests
   where id=p_request_id and business_account_id is not distinct from p_business_account_id
   for update;
  if not found then raise exception 'request_not_found' using errcode='CR404'; end if;
  if v_req.request_state not in
     ('confirmed','awaiting_quote_acceptance','quote_revision_required') then
    raise exception 'request_not_payable' using errcode='CR409';
  end if;
  select * into v_quote from public.couranr_quote_versions
   where id=v_req.current_quote_version_id and request_id=v_req.id;
  if not found or v_quote.quote_status<>'estimated'
     or v_quote.subtotal_cents is null or v_quote.subtotal_cents<=0 then
    raise exception 'request_has_no_quote' using errcode='CR409';
  end if;

  select * into v_ob from public.couranr_payment_obligations
   where request_id=v_req.id and payment_state<>'cancelled' limit 1;
  if found then
    if v_ob.quote_version_id is not distinct from v_quote.id then
      return v_ob;
    end if;
    if v_ob.payment_state in ('authorized','capture_pending','captured') then
      raise exception 'payment_quote_superseded_requires_resolution' using errcode='CR409';
    end if;
    update public.couranr_payment_obligations set
      payment_state='cancelled',cancelled_at=now(),version=version+1,updated_at=now()
    where id=v_ob.id;
    update public.couranr_payment_access_tokens set
      revoked_at=now(),revoked_reason='quote_superseded'
    where request_id=v_req.id and revoked_at is null;
  end if;

  select count(*)+1 into v_gen from public.couranr_payment_obligations
   where request_id=v_req.id;
  insert into public.couranr_payment_obligations(
    request_id,business_account_id,payer_type,request_version,quote_version_id,
    pricing_policy_version,amount_cents,currency,payment_state,provider,idempotency_key
  ) values (
    v_req.id,v_req.business_account_id,v_quote.payer_type,v_req.version,v_quote.id,
    v_quote.pricing_policy_version,v_quote.subtotal_cents,v_quote.currency,
    'not_started','stripe',p_idempotency_key||':g'||v_gen::text
  ) returning * into v_ob;
  return v_ob;
end
$fn$;

comment on function public.couranr_create_payment_obligation is
  'Creates the obligation for request.current_quote_version_id. Amount, policy, payer and currency are copied from that immutable quote; request_version is historical CAS evidence only. An authorized/capturing/captured obligation on an older quote hard-refuses replacement.';

create or replace function public.couranr_issue_payment_access_token(
  p_request_id uuid,p_obligation_id uuid,p_token_hash text,p_ttl_days integer
)
returns public.couranr_payment_access_tokens
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_ob public.couranr_payment_obligations;
  v_tok public.couranr_payment_access_tokens;
  v_ttl integer;
begin
  v_ttl:=least(greatest(coalesce(p_ttl_days,7),1),7);
  if p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'token_hash_must_be_sha256_hex' using errcode='CR422';
  end if;
  select * into v_req from public.couranr_delivery_requests where id=p_request_id;
  if not found then raise exception 'request_not_found' using errcode='CR404'; end if;
  if v_req.request_state not in
     ('confirmed','awaiting_quote_acceptance','quote_revision_required') then
    raise exception 'request_not_payable' using errcode='CR409';
  end if;
  select * into v_ob from public.couranr_payment_obligations
   where id=p_obligation_id and request_id=v_req.id and payment_state<>'cancelled';
  if not found then raise exception 'obligation_not_found' using errcode='CR404'; end if;
  if v_ob.quote_version_id is distinct from v_req.current_quote_version_id then
    raise exception 'obligation_quote_is_not_current' using errcode='CR409';
  end if;

  update public.couranr_payment_access_tokens set
    revoked_at=now(),revoked_reason='replaced_by_new_link'
  where request_id=v_req.id and revoked_at is null;
  insert into public.couranr_payment_access_tokens(
    request_id,business_account_id,obligation_id,token_hash,action,expires_at
  ) values (
    v_req.id,v_req.business_account_id,v_ob.id,p_token_hash,'authorize_payment',
    now()+make_interval(days=>v_ttl)
  ) returning * into v_tok;
  return v_tok;
end
$fn$;

create or replace function public.couranr_redeem_payment_access_token(p_token_hash text)
returns table(
  valid boolean,reason text,request_id uuid,obligation_id uuid,
  request_state text,payment_state text,payer_type text,amount_cents integer
)
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_tok public.couranr_payment_access_tokens;
  v_req public.couranr_delivery_requests;
  v_ob public.couranr_payment_obligations;
begin
  select * into v_tok from public.couranr_payment_access_tokens where token_hash=p_token_hash;
  if not found then
    return query select false,'not_found'::text,null::uuid,null::uuid,
      null::text,null::text,null::text,null::integer; return;
  end if;
  if v_tok.revoked_at is not null then
    return query select false,'revoked'::text,v_tok.request_id,v_tok.obligation_id,
      null::text,null::text,null::text,null::integer; return;
  end if;
  if v_tok.expires_at<=now() then
    return query select false,'expired'::text,v_tok.request_id,v_tok.obligation_id,
      null::text,null::text,null::text,null::integer; return;
  end if;
  select * into v_req from public.couranr_delivery_requests where id=v_tok.request_id;
  if not found then
    return query select false,'not_found'::text,null::uuid,null::uuid,
      null::text,null::text,null::text,null::integer; return;
  end if;
  if v_req.request_state not in
     ('confirmed','awaiting_quote_acceptance','quote_revision_required') then
    return query select false,'request_not_payable'::text,v_req.id,v_tok.obligation_id,
      v_req.request_state,null::text,null::text,null::integer; return;
  end if;
  select * into v_ob from public.couranr_payment_obligations
   where id=v_tok.obligation_id and request_id=v_req.id and payment_state<>'cancelled';
  if not found then
    return query select false,'no_obligation'::text,v_req.id,null::uuid,
      v_req.request_state,null::text,null::text,null::integer; return;
  end if;
  if v_ob.quote_version_id is distinct from v_req.current_quote_version_id then
    return query select false,'quote_changed'::text,v_req.id,v_ob.id,
      v_req.request_state,v_ob.payment_state,v_ob.payer_type,v_ob.amount_cents; return;
  end if;
  if v_ob.payment_state='authorized' then
    return query select false,'already_authorized'::text,v_req.id,v_ob.id,
      v_req.request_state,v_ob.payment_state,v_ob.payer_type,v_ob.amount_cents; return;
  end if;
  update public.couranr_payment_access_tokens set last_used_at=now() where id=v_tok.id;
  return query select true,null::text,v_req.id,v_ob.id,v_req.request_state,
    v_ob.payment_state,v_ob.payer_type,v_ob.amount_cents;
end
$fn$;

-- Readiness is pickup readiness. Its CAS bump does not change quote identity.
create or replace function public.couranr_apply_readiness(
  p_request_id uuid,p_business_account_id uuid,p_expected_version integer,
  p_actor_user_id uuid,p_command text,p_to text,p_from text[]
)
returns public.couranr_delivery_requests
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_ob public.couranr_payment_obligations;
  v_before text;
begin
  select * into v_req from public.couranr_delivery_requests
   where id=p_request_id and business_account_id is not distinct from p_business_account_id;
  if not found then raise exception 'request_not_found' using errcode='CR404'; end if;
  perform public.couranr_assert_readiness_mutable(p_request_id);
  if v_req.request_state<>'confirmed' then
    raise exception 'request_not_confirmed' using errcode='CR409';
  end if;
  if p_to='ready' then
    select * into v_ob from public.couranr_payment_obligations
     where request_id=v_req.id and payment_state<>'cancelled' limit 1;
    if not found or v_ob.payment_state<>'authorized' then
      raise exception 'payment_not_authorized' using errcode='CR409';
    end if;
    if v_ob.quote_version_id is distinct from v_req.current_quote_version_id then
      raise exception 'authorization_does_not_match_current_quote' using errcode='CR409';
    end if;
  end if;
  v_before:=v_req.readiness_state;
  update public.couranr_delivery_requests set
    readiness_state=p_to,version=p_expected_version+1,updated_at=now()
  where id=v_req.id and version=p_expected_version and readiness_state=any(p_from)
  returning * into v_req;
  if not found then raise exception 'version_or_state_conflict' using errcode='CR409'; end if;
  insert into public.couranr_delivery_request_events(
    request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_req.id,p_actor_user_id,
    case when v_req.requester_kind='business' then 'merchant' else 'customer' end,
    p_command,v_before,p_to,
    jsonb_build_object('readinessFrom',v_before,'readinessTo',p_to,
      'readinessMeaning','pickup','requestState',v_req.request_state,
      'quoteVersionId',v_req.current_quote_version_id)
  );
  return v_req;
end
$fn$;

-- ---------------------------------------------------------------------
-- Plan and capture require exact quote UUID equality. Plan vehicle capacity
-- checks the immutable quote shipment, not mutable request facts.
-- ---------------------------------------------------------------------
create or replace function public.couranr_confirm_service_plan(
  p_request_id uuid,p_expected_version integer,p_actor_user_id uuid,
  p_pickup_start timestamptz,p_pickup_end timestamptz,p_timezone text,
  p_vehicle_id uuid,p_vehicle_requirement jsonb
)
returns public.couranr_service_plans
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_ob public.couranr_payment_obligations;
  v_quote public.couranr_quote_versions;
  v_plan public.couranr_service_plans;
  v_cap numeric;
  v_weight numeric;
begin
  select * into v_req from public.couranr_delivery_requests where id=p_request_id for update;
  if not found then raise exception 'request_not_found' using errcode='CR404'; end if;
  if v_req.version is distinct from p_expected_version then
    raise exception 'version_or_state_conflict' using errcode='CR409';
  end if;
  -- A post-authorization requote deliberately moves the request out of
  -- confirmed. Report its commercial cause before the broader state refusal,
  -- so operators cannot mistake a Q1/Q2 mismatch for a scheduling problem.
  select * into v_ob from public.couranr_payment_obligations
   where request_id=v_req.id and payment_state<>'cancelled' limit 1;
  if found and v_ob.quote_version_id is distinct from v_req.current_quote_version_id then
    raise exception 'authorization_does_not_match_current_quote' using errcode='CR409';
  end if;
  if v_req.request_state<>'confirmed' then
    raise exception 'request_not_confirmed' using errcode='CR409';
  end if;
  select * into v_ob from public.couranr_payment_obligations
   where request_id=v_req.id and payment_state<>'cancelled' limit 1;
  if not found or v_ob.payment_state<>'authorized' then
    raise exception 'payment_not_authorized' using errcode='CR409';
  end if;
  if v_req.current_quote_version_id is null
     or v_ob.quote_version_id is distinct from v_req.current_quote_version_id then
    raise exception 'authorization_does_not_match_current_quote' using errcode='CR409';
  end if;
  select * into v_quote from public.couranr_quote_versions
   where id=v_ob.quote_version_id and request_id=v_req.id;
  if not found then raise exception 'quote_not_found' using errcode='CR409'; end if;

  if p_pickup_start is null or p_pickup_end is null or p_pickup_end<=p_pickup_start then
    raise exception 'invalid_pickup_window' using errcode='CR422';
  end if;
  if nullif(btrim(p_timezone),'') is null then
    raise exception 'timezone_required' using errcode='CR422';
  end if;
  begin perform now() at time zone p_timezone;
  exception when others then raise exception 'unknown_timezone' using errcode='CR422'; end;
  if jsonb_typeof(p_vehicle_requirement) is distinct from 'object'
     or coalesce(p_vehicle_requirement->>'vehicleClass','') not in
        ('car','van','box_truck','cargo_bike') then
    raise exception 'vehicle_requirement_required' using errcode='CR422';
  end if;
  v_cap:=nullif(p_vehicle_requirement->>'maxPayloadLb','')::numeric;
  if v_cap is null or v_cap<=0 then
    raise exception 'vehicle_capacity_required' using errcode='CR422';
  end if;
  v_weight:=coalesce(nullif(v_quote.shipment_snapshot->>'weightLb','')::numeric,0);
  if v_cap<v_weight then
    raise exception 'vehicle_incompatible_with_shipment' using errcode='CR422';
  end if;

  update public.couranr_service_plans set
    plan_state='cancelled',version=version+1,updated_at=now()
  where request_id=v_req.id and plan_state<>'cancelled';
  insert into public.couranr_service_plans(
    request_id,business_account_id,payment_obligation_id,request_version,
    quote_version_id,scheduled_pickup_start,scheduled_pickup_end,timezone,
    vehicle_id,vehicle_requirement,plan_state,confirmed_by,confirmed_at
  ) values (
    v_req.id,v_req.business_account_id,v_ob.id,v_req.version,v_quote.id,
    p_pickup_start,p_pickup_end,p_timezone,p_vehicle_id,p_vehicle_requirement,
    'confirmed',p_actor_user_id,now()
  ) returning * into v_plan;
  return v_plan;
end
$fn$;

create or replace function public.couranr_begin_payment_capture(
  p_request_id uuid,p_actor_user_id uuid
)
returns public.couranr_payment_obligations
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_ob public.couranr_payment_obligations;
  v_plan public.couranr_service_plans;
begin
  select * into v_req from public.couranr_delivery_requests where id=p_request_id;
  if not found then raise exception 'request_not_found' using errcode='CR404'; end if;
  if v_req.request_state<>'confirmed' then raise exception 'request_not_confirmed' using errcode='CR409'; end if;
  if v_req.readiness_state<>'ready' then raise exception 'pickup_not_ready' using errcode='CR409'; end if;
  if exists(select 1 from public.couranr_deliveries where request_id=v_req.id) then
    raise exception 'delivery_already_exists' using errcode='CR409';
  end if;
  select * into v_ob from public.couranr_payment_obligations
   where request_id=v_req.id and payment_state<>'cancelled' limit 1;
  if not found then raise exception 'no_obligation' using errcode='CR409'; end if;
  if v_ob.payment_state in ('capture_pending','captured') then return v_ob; end if;
  if v_ob.payment_state<>'authorized' then raise exception 'payment_not_authorized' using errcode='CR409'; end if;
  select * into v_plan from public.couranr_service_plans
   where request_id=v_req.id and plan_state='confirmed' limit 1;
  if not found then raise exception 'service_plan_not_confirmed' using errcode='CR409'; end if;
  if v_req.current_quote_version_id is null
     or v_ob.quote_version_id is distinct from v_req.current_quote_version_id
     or v_plan.quote_version_id is distinct from v_req.current_quote_version_id
     or v_plan.payment_obligation_id is distinct from v_ob.id then
    raise exception 'commercial_quote_identity_mismatch' using errcode='CR409';
  end if;
  update public.couranr_payment_obligations set
    payment_state='capture_pending',capture_requested_at=now(),
    version=version+1,updated_at=now()
  where id=v_ob.id and payment_state='authorized' returning * into v_ob;
  if not found then raise exception 'version_or_state_conflict' using errcode='CR409'; end if;
  insert into public.couranr_payment_events(
    obligation_id,request_id,provider,provider_event_id,event_type,
    payment_state_before,payment_state_after,outcome,detail
  ) values (
    v_ob.id,v_req.id,'stripe',
    'couranr:capture_requested:'||v_ob.id::text||':v'||v_ob.version::text,
    'couranr.capture.requested','authorized','capture_pending','applied',
    jsonb_build_object('amountCents',v_ob.amount_cents,'servicePlanId',v_plan.id,
                       'quoteVersionId',v_ob.quote_version_id)
  );
  return v_ob;
end
$fn$;

create or replace function public.couranr_create_delivery_from_capture(p_request_id uuid)
returns public.couranr_deliveries
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_ob public.couranr_payment_obligations;
  v_plan public.couranr_service_plans;
  v_quote public.couranr_quote_versions;
  v_d public.couranr_deliveries;
begin
  select * into v_d from public.couranr_deliveries where request_id=p_request_id;
  if found then return v_d; end if;
  select * into v_req from public.couranr_delivery_requests where id=p_request_id;
  if not found then raise exception 'request_not_found' using errcode='CR404'; end if;
  select * into v_ob from public.couranr_payment_obligations
   where request_id=v_req.id and payment_state<>'cancelled' limit 1;
  if not found or v_ob.payment_state<>'captured' then
    raise exception 'payment_not_captured' using errcode='CR409';
  end if;
  select * into v_plan from public.couranr_service_plans
   where request_id=v_req.id and plan_state='confirmed' limit 1;
  if not found then raise exception 'service_plan_not_confirmed' using errcode='CR409'; end if;
  if v_req.current_quote_version_id is null
     or v_ob.quote_version_id is distinct from v_req.current_quote_version_id
     or v_plan.quote_version_id is distinct from v_req.current_quote_version_id
     or v_plan.payment_obligation_id is distinct from v_ob.id then
    raise exception 'commercial_quote_identity_mismatch' using errcode='CR409';
  end if;
  select * into v_quote from public.couranr_quote_versions
   where id=v_ob.quote_version_id and request_id=v_req.id;
  if not found then raise exception 'quote_not_found' using errcode='CR409'; end if;
  if jsonb_typeof(v_quote.pickup_address_snapshot) is distinct from 'object'
     or jsonb_typeof(v_quote.dropoff_address_snapshot) is distinct from 'object'
     or jsonb_typeof(v_quote.recipient_snapshot) is distinct from 'object'
     or jsonb_typeof(v_quote.shipment_snapshot) is distinct from 'object'
     or jsonb_typeof(v_quote.service_configuration_snapshot) is distinct from 'object' then
    raise exception 'commercial_quote_snapshot_incomplete' using errcode='CR409';
  end if;

  insert into public.couranr_deliveries(
    request_id,business_account_id,payment_obligation_id,service_plan_id,
    request_version,quote_version_id,pricing_policy_version,
    captured_amount_cents,currency,pickup_address,dropoff_address,recipient,shipment,
    service_level,signature_required,proof_method,
    scheduled_pickup_start,scheduled_pickup_end,timezone,vehicle_id,
    vehicle_requirement,fulfillment_state
  ) values (
    v_req.id,v_req.business_account_id,v_ob.id,v_plan.id,
    v_ob.request_version,v_quote.id,v_quote.pricing_policy_version,
    coalesce(v_ob.captured_amount_cents,v_ob.amount_cents),v_ob.currency,
    v_quote.pickup_address_snapshot,v_quote.dropoff_address_snapshot,
    v_quote.recipient_snapshot,v_quote.shipment_snapshot,
    v_quote.service_configuration_snapshot->>'serviceLevel',
    coalesce((v_quote.service_configuration_snapshot->>'signatureRequired')::boolean,false),
    v_quote.service_configuration_snapshot->>'proofMethod',
    v_plan.scheduled_pickup_start,v_plan.scheduled_pickup_end,v_plan.timezone,
    v_plan.vehicle_id,v_plan.vehicle_requirement,'scheduled'
  ) returning * into v_d;
  insert into public.couranr_delivery_events(
    delivery_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_d.id,null,'system','create_delivery_from_capture',null,'scheduled',
    jsonb_build_object('requestId',v_req.id,'paymentObligationId',v_ob.id,
      'servicePlanId',v_plan.id,'quoteVersionId',v_quote.id,
      'capturedAmountCents',v_d.captured_amount_cents,'driverAssigned',false)
  );
  return v_d;
exception when unique_violation then
  select * into v_d from public.couranr_deliveries where request_id=p_request_id;
  if found then return v_d; end if;
  raise;
end
$fn$;

-- Stripe reconciliation validates the exact quote metadata. Pre-cutover
-- PaymentIntents are accepted only when their mapped quote is explicitly a
-- legacy_backfill row and all prior identity metadata still matches.
create or replace function public.couranr_apply_payment_intent_state(
  p_provider_event_id text,p_event_type text,p_payment_intent_id text,
  p_intent_status text,p_amount integer,p_amount_capturable integer,
  p_currency text,p_metadata jsonb
)
returns public.couranr_payment_apply_result
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_ob public.couranr_payment_obligations;
  v_quote public.couranr_quote_versions;
  v_req public.couranr_delivery_requests;
  v_out public.couranr_payment_apply_result;
  v_outcome text;
  v_reason text;
  v_target text;
  v_before text;
  v_reqstate text;
  v_ob_id uuid;
  v_req_id uuid;
  v_quote_is_current boolean;
begin
  if nullif(btrim(p_provider_event_id),'') is null then
    raise exception 'provider_event_id_required' using errcode='CR422';
  end if;
  select * into v_ob from public.couranr_payment_obligations
   where provider_payment_intent_id=p_payment_intent_id;
  if not found then
    return row('rejected',null,null,null,null,'unknown_payment_intent')
      ::public.couranr_payment_apply_result;
  end if;
  select * into v_quote from public.couranr_quote_versions
   where id=v_ob.quote_version_id and request_id=v_ob.request_id;
  select * into v_req from public.couranr_delivery_requests where id=v_ob.request_id;
  v_quote_is_current := found and v_req.current_quote_version_id is not distinct from v_ob.quote_version_id;

  if not found or v_quote.id is null then
    v_outcome:='rejected';v_reason:='obligation_quote_missing';
  elsif p_amount is distinct from v_ob.amount_cents then
    v_outcome:='rejected';v_reason:='amount_mismatch';
  elsif lower(coalesce(p_currency,'')) is distinct from v_ob.currency then
    v_outcome:='rejected';v_reason:='currency_mismatch';
  elsif coalesce(p_metadata->>'paymentObligationId','')<>v_ob.id::text then
    v_outcome:='rejected';v_reason:='metadata_obligation_mismatch';
  elsif coalesce(p_metadata->>'couranrRequestId','')<>v_ob.request_id::text then
    v_outcome:='rejected';v_reason:='metadata_request_mismatch';
  elsif v_ob.business_account_id is not null
        and coalesce(p_metadata->>'businessAccountId','')<>v_ob.business_account_id::text then
    v_outcome:='rejected';v_reason:='metadata_business_mismatch';
  elsif v_ob.business_account_id is null
        and nullif(p_metadata->>'businessAccountId','') is not null then
    v_outcome:='rejected';v_reason:='metadata_business_mismatch';
  elsif nullif(p_metadata->>'quoteVersionId','') is null
        and v_quote.record_origin<>'legacy_backfill' then
    v_outcome:='rejected';v_reason:='metadata_quote_missing';
  elsif nullif(p_metadata->>'quoteVersionId','') is not null
        and (p_metadata->>'quoteVersionId')<>v_ob.quote_version_id::text then
    v_outcome:='rejected';v_reason:='metadata_quote_mismatch';
  elsif v_ob.payment_state='capture_pending' then
    v_outcome:='ignored';v_reason:='capture_reconciliation_is_authoritative';
  else
    case p_event_type
      when 'payment_intent.amount_capturable_updated' then
        if p_intent_status='requires_capture'
           and p_amount_capturable is not distinct from v_ob.amount_cents then
          v_target:='authorized';v_outcome:='applied';
          if not v_quote_is_current then v_reason:='authorized_for_superseded_quote'; end if;
        else
          v_outcome:='rejected';v_reason:='not_fully_capturable';
        end if;
      when 'payment_intent.requires_action' then
        v_target:='requires_action';v_outcome:='applied';
      when 'payment_intent.payment_failed' then
        v_target:='failed';v_outcome:='applied';
      when 'payment_intent.canceled' then
        v_target:='cancelled';v_outcome:='applied';
      else
        v_outcome:='ignored';v_reason:='unhandled_event_type';
    end case;
  end if;
  if v_outcome='applied' and v_ob.payment_state=v_target then
    v_outcome:='ignored';v_reason:='already_in_state';
  end if;
  v_before:=v_ob.payment_state;

  begin
    insert into public.couranr_payment_events(
      obligation_id,request_id,provider,provider_event_id,event_type,
      payment_state_before,payment_state_after,outcome,detail
    ) values (
      v_ob.id,v_ob.request_id,'stripe',p_provider_event_id,p_event_type,v_before,
      case when v_outcome='applied' then v_target else v_before end,v_outcome,
      jsonb_build_object('paymentIntentId',p_payment_intent_id,
        'intentStatus',p_intent_status,'amount',p_amount,
        'amountCapturable',p_amount_capturable,'currency',p_currency,
        'quoteVersionId',v_ob.quote_version_id,
        'currentQuoteVersionId',v_req.current_quote_version_id,'reason',v_reason)
    );
  exception when unique_violation then
    return row('duplicate',v_ob.id,v_ob.request_id,v_ob.payment_state,null,null)
      ::public.couranr_payment_apply_result;
  end;
  if v_outcome<>'applied' then
    return row(v_outcome,v_ob.id,v_ob.request_id,v_ob.payment_state,null,v_reason)
      ::public.couranr_payment_apply_result;
  end if;

  v_ob_id:=v_ob.id;v_req_id:=v_ob.request_id;
  update public.couranr_payment_obligations set
    payment_state=v_target,
    authorized_at=case when v_target='authorized' then now() else authorized_at end,
    failed_at=case when v_target='failed' then now() else failed_at end,
    cancelled_at=case when v_target='cancelled' then now() else cancelled_at end,
    version=version+1,updated_at=now()
  where id=v_ob_id and payment_state=v_before and payment_state<>'capture_pending'
  returning * into v_ob;
  if not found then
    return row('ignored',v_ob_id,v_req_id,v_before,null,'state_changed_during_apply')
      ::public.couranr_payment_apply_result;
  end if;

  if v_target='authorized' then
    select * into v_req from public.couranr_delivery_requests
     where id=v_ob.request_id for update;
    if v_req.current_quote_version_id is not distinct from v_ob.quote_version_id
       and v_req.request_state in ('awaiting_quote_acceptance','quote_revision_required') then
      v_reqstate:=v_req.request_state;
      update public.couranr_delivery_requests set
        request_state='confirmed',version=version+1,updated_at=now()
      where id=v_req.id returning * into v_req;
      insert into public.couranr_delivery_request_events(
        request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
      ) values (
        v_req.id,null,'system','record_payer_quote_approval',v_reqstate,'confirmed',
        jsonb_build_object('quoteVersionId',v_ob.quote_version_id,
          'payerType',v_ob.payer_type,'paymentObligationId',v_ob.id,
          'authorizedAmountCents',v_ob.amount_cents,
          'pricingPolicyVersion',v_ob.pricing_policy_version,
          'paymentState','authorized','captured',false)
      );
    end if;
    update public.couranr_payment_access_tokens set
      revoked_at=now(),revoked_reason='payment_authorized'
    where request_id=v_ob.request_id and revoked_at is null;
  end if;
  select request_state into v_reqstate from public.couranr_delivery_requests
   where id=v_ob.request_id;
  return row('applied',v_ob.id,v_ob.request_id,v_ob.payment_state,v_reqstate,v_reason)
    ::public.couranr_payment_apply_result;
end
$fn$;

comment on function public.couranr_apply_payment_intent_state is
  'Reconciles a verified Stripe event to the exact obligation quote. Authorization of a superseded quote is recorded on that obligation but cannot confirm the request current quote.';

-- Reassert exact execute boundaries, including PostgreSQL default EXECUTE.
revoke all on function public.couranr_create_delivery_request_draft(
  uuid,uuid,text,text,text,text,text,text,text,numeric,numeric,integer,text,boolean,
  text,jsonb,jsonb,boolean,text,text,integer,integer,numeric,jsonb,jsonb
) from public,anon,authenticated,service_role;
revoke all on function public.couranr_calculate_delivery_request_estimate(
  uuid,uuid,integer,uuid,boolean,text,text,text,text,text,text,numeric,numeric,
  integer,text,boolean,text,jsonb,jsonb,boolean,text,text,integer,integer,numeric,jsonb,jsonb
) from public,anon,authenticated,service_role;
revoke all on function public.couranr_submit_delivery_request(
  uuid,uuid,integer,uuid,text,text,integer,integer,numeric,jsonb,jsonb,boolean
) from public,anon,authenticated,service_role;
revoke all on function public.couranr_accept_delivery_request_as_quoted(uuid,uuid,integer,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.couranr_requote_delivery_request(
  uuid,uuid,integer,uuid,text,integer,integer,numeric,jsonb,text
) from public,anon,authenticated,service_role;
revoke all on function public.couranr_create_payment_obligation(uuid,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.couranr_issue_payment_access_token(uuid,uuid,text,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.couranr_redeem_payment_access_token(text)
  from public,anon,authenticated,service_role;
revoke all on function public.couranr_apply_readiness(uuid,uuid,integer,uuid,text,text,text[])
  from public,anon,authenticated,service_role;
revoke all on function public.couranr_confirm_service_plan(
  uuid,integer,uuid,timestamptz,timestamptz,text,uuid,jsonb
) from public,anon,authenticated,service_role;
revoke all on function public.couranr_begin_payment_capture(uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.couranr_create_delivery_from_capture(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.couranr_apply_payment_intent_state(
  text,text,text,text,integer,integer,text,jsonb
) from public,anon,authenticated,service_role;

grant execute on function public.couranr_create_delivery_request_draft(
  uuid,uuid,text,text,text,text,text,text,text,numeric,numeric,integer,text,boolean,
  text,jsonb,jsonb,boolean,text,text,integer,integer,numeric,jsonb,jsonb
) to service_role;
grant execute on function public.couranr_calculate_delivery_request_estimate(
  uuid,uuid,integer,uuid,boolean,text,text,text,text,text,text,numeric,numeric,
  integer,text,boolean,text,jsonb,jsonb,boolean,text,text,integer,integer,numeric,jsonb,jsonb
) to service_role;
grant execute on function public.couranr_submit_delivery_request(
  uuid,uuid,integer,uuid,text,text,integer,integer,numeric,jsonb,jsonb,boolean
) to service_role;
grant execute on function public.couranr_accept_delivery_request_as_quoted(uuid,uuid,integer,uuid)
  to service_role;
grant execute on function public.couranr_requote_delivery_request(
  uuid,uuid,integer,uuid,text,integer,integer,numeric,jsonb,text
) to service_role;
grant execute on function public.couranr_create_payment_obligation(uuid,uuid,text)
  to service_role;
grant execute on function public.couranr_issue_payment_access_token(uuid,uuid,text,integer)
  to service_role;
grant execute on function public.couranr_redeem_payment_access_token(text)
  to service_role;
grant execute on function public.couranr_apply_readiness(uuid,uuid,integer,uuid,text,text,text[])
  to service_role;
grant execute on function public.couranr_confirm_service_plan(
  uuid,integer,uuid,timestamptz,timestamptz,text,uuid,jsonb
) to service_role;
grant execute on function public.couranr_begin_payment_capture(uuid,uuid) to service_role;
grant execute on function public.couranr_create_delivery_from_capture(uuid) to service_role;
grant execute on function public.couranr_apply_payment_intent_state(
  text,text,text,text,integer,integer,text,jsonb
) to service_role;

commit;

-- =====================================================================
-- ROLLBACK — weight band (SUR-001 cutover) and requested timing (TMZ-001)
--
-- ORDER MATTERS IF THE APPLICATION HAS ALREADY SHIPPED. The new application
-- sends p_weight_band and the timing arguments by name; after this rollback
-- those match nothing and every create/estimate becomes a PGRST202. Roll the
-- APPLICATION back first, then run this. The pre-batch application works on
-- either side of it.
--
-- EVIDENCE GUARD. Once any request carries a weight band or requested-timing
-- evidence, dropping the columns would destroy shipment evidence that quotes
-- were minted against — so this rollback HARD-REFUSES and requires forward
-- repair instead. On a database where the feature was never used it rolls
-- back completely.
--
-- Function bodies are restored VERBATIM from the migrations that defined
-- them (20260902042602 for the two commands, 20260902161642 for the
-- appender), extracted rather than retyped so they cannot drift.
--
-- Idempotent: create-or-replace and drop-if-exists throughout.
-- =====================================================================

begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

do $evidence$
declare
  v_count bigint;
begin
  select count(*) into v_count
    from public.couranr_delivery_requests
   where weight_band is not null
      or restricted_class is not null
      or timing_intent is not null
      or requested_pickup_local is not null
      or requested_departure_at is not null;
  if v_count > 0 then
    raise exception
      'weight_band_rollback_would_destroy_shipment_evidence: % request(s) carry band or timing evidence; forward repair required',
      v_count;
  end if;
exception when undefined_column then
  -- Already rolled back (or never applied): nothing to guard.
  null;
end
$evidence$;

drop function if exists private.couranr_assert_safety_declaration(text,text);
drop function if exists private.couranr_assert_requested_timing(text,timestamptz,jsonb);

/* ---------------- restore the two commands at their ORIGINAL arity ------ */
/* New arity dropped first for the same ambiguity reason the forward
   migration dropped the old one first. */

drop function if exists public.couranr_create_routed_delivery_request_draft(
  uuid,uuid,text,text,text,text,text,text,text,numeric,integer,text,boolean,text,jsonb,jsonb,boolean,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,text,text,text,timestamptz,jsonb,text
);

create or replace function public.couranr_create_routed_delivery_request_draft(
  p_business_account_id uuid,p_created_by uuid,p_idempotency_key text,
  p_source text,p_readiness_state text,p_payer_type text,
  p_recipient_name text,p_recipient_phone text,p_recipient_email text,
  p_weight_lb numeric,p_additional_stops integer,
  p_service_level text,p_signature_required boolean,p_proof_method text,
  p_pickup_address jsonb,p_dropoff_address jsonb,p_overnight_requested boolean,
  p_route_distance_meters bigint,p_route_duration_seconds integer,
  p_route_static_duration_seconds integer,
  p_route_traffic_delay_seconds  integer,
  p_distance_source text,p_serviceability_outcome text,p_route_review_reason text,
  p_quote_status text,p_pricing_policy_version text,
  p_delivery_subtotal_cents integer,p_included_loaded_miles integer,
  p_billable_loaded_miles numeric,p_quote_line_items jsonb,p_review_reasons jsonb
)
returns public.couranr_delivery_requests
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_quote public.couranr_quote_versions;
  v_loaded_miles numeric(10,3);
begin
  if p_route_distance_meters is not null then
    v_loaded_miles := round(p_route_distance_meters::numeric / 1609.344,3);
  else
    v_loaded_miles := null;
  end if;

  begin
    insert into public.couranr_delivery_requests(
      business_account_id,created_by,idempotency_key,
      request_state,review_state,service_area_review_state,
      source,readiness_state,payer_type,
      recipient_name,recipient_phone,recipient_email,
      loaded_miles,weight_lb,additional_stops,
      service_level,signature_required,proof_method,
      pickup_address,dropoff_address,normalized_request_payload,
      quote_status,quote_line_items,review_reasons,
      rounding_applied,tax_included,payment_due_cents
    ) values (
      p_business_account_id,p_created_by,p_idempotency_key,
      'draft','not_required','pending',p_source,p_readiness_state,p_payer_type,
      p_recipient_name,p_recipient_phone,p_recipient_email,
      v_loaded_miles,p_weight_lb,p_additional_stops,
      p_service_level,p_signature_required,p_proof_method,
      p_pickup_address,p_dropoff_address,
      jsonb_build_object(
        'overnightRequested',coalesce(p_overnight_requested,false),
        'route',jsonb_build_object(
          'serviceabilityOutcome',p_serviceability_outcome,
          'distanceSource',p_distance_source,
          'reviewReason',p_route_review_reason)),
      'not_quoted','[]'::jsonb,'[]'::jsonb,false,false,null
    ) returning * into v_req;
  exception when unique_violation then
    select * into v_req from public.couranr_delivery_requests
     where idempotency_scope='business:'||p_business_account_id::text
       and idempotency_key=p_idempotency_key;
    if not found then raise; end if;
    return v_req;
  end;

  v_quote := private.couranr_append_routed_quote_version(
    v_req.id,p_created_by,v_req.version,p_quote_status,p_pricing_policy_version,
    p_delivery_subtotal_cents,p_included_loaded_miles,p_billable_loaded_miles,
    p_quote_line_items,p_review_reasons,p_route_distance_meters,
    p_route_duration_seconds,p_route_static_duration_seconds,
    p_route_traffic_delay_seconds,p_distance_source,p_serviceability_outcome,
    p_route_review_reason
  );

  insert into public.couranr_delivery_request_events(
    request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_req.id,p_created_by,'merchant','create_delivery_request_draft',null,'draft',
    jsonb_build_object(
      'quoteVersionId',v_quote.id,'quoteStatus',v_quote.quote_status,
      'reviewReasons',v_quote.review_reasons,
      'serviceabilityOutcome',p_serviceability_outcome,
      'distanceSource',p_distance_source,
      'routeDistanceMeters',p_route_distance_meters,
      'routeDurationSeconds',p_route_duration_seconds)
  );
  select * into v_req from public.couranr_delivery_requests where id=v_req.id;
  return v_req;
end
$fn$;

drop function if exists public.couranr_calculate_routed_delivery_request_estimate(
  uuid,uuid,integer,uuid,boolean,text,text,text,text,text,text,numeric,integer,text,boolean,text,jsonb,jsonb,boolean,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,text,text,text,timestamptz,jsonb,text
);

create or replace function public.couranr_calculate_routed_delivery_request_estimate(
  p_request_id uuid,p_business_account_id uuid,p_expected_version integer,
  p_actor_user_id uuid,p_update_shipment boolean,
  p_source text,p_readiness_state text,p_payer_type text,
  p_recipient_name text,p_recipient_phone text,p_recipient_email text,
  p_weight_lb numeric,p_additional_stops integer,
  p_service_level text,p_signature_required boolean,p_proof_method text,
  p_pickup_address jsonb,p_dropoff_address jsonb,p_overnight_requested boolean,
  p_route_distance_meters bigint,p_route_duration_seconds integer,
  p_route_static_duration_seconds integer,
  p_route_traffic_delay_seconds  integer,
  p_distance_source text,p_serviceability_outcome text,p_route_review_reason text,
  p_quote_status text,p_pricing_policy_version text,
  p_delivery_subtotal_cents integer,p_included_loaded_miles integer,
  p_billable_loaded_miles numeric,p_quote_line_items jsonb,p_review_reasons jsonb
)
returns public.couranr_delivery_requests
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_quote public.couranr_quote_versions;
  v_loaded_miles numeric(10,3);
  v_payload jsonb;
begin
  if p_route_distance_meters is not null then
    v_loaded_miles := round(p_route_distance_meters::numeric / 1609.344,3);
  else
    v_loaded_miles := null;
  end if;
  v_payload := jsonb_build_object(
    'overnightRequested',coalesce(p_overnight_requested,false),
    'route',jsonb_build_object(
      'serviceabilityOutcome',p_serviceability_outcome,
      'distanceSource',p_distance_source,
      'reviewReason',p_route_review_reason));

  if p_update_shipment then
    update public.couranr_delivery_requests set
      source=p_source,readiness_state=p_readiness_state,payer_type=p_payer_type,
      recipient_name=p_recipient_name,recipient_phone=p_recipient_phone,
      recipient_email=p_recipient_email,loaded_miles=v_loaded_miles,
      weight_lb=p_weight_lb,additional_stops=p_additional_stops,
      service_level=p_service_level,signature_required=p_signature_required,
      proof_method=p_proof_method,pickup_address=p_pickup_address,
      dropoff_address=p_dropoff_address,normalized_request_payload=v_payload,
      version=p_expected_version+1,updated_at=now()
    where id=p_request_id and business_account_id=p_business_account_id
      and version=p_expected_version and request_state='draft'
    returning * into v_req;
  else
    update public.couranr_delivery_requests set
      loaded_miles=v_loaded_miles,normalized_request_payload=v_payload,
      version=p_expected_version+1,updated_at=now()
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

  v_quote := private.couranr_append_routed_quote_version(
    v_req.id,p_actor_user_id,v_req.version,p_quote_status,p_pricing_policy_version,
    p_delivery_subtotal_cents,p_included_loaded_miles,p_billable_loaded_miles,
    p_quote_line_items,p_review_reasons,p_route_distance_meters,
    p_route_duration_seconds,p_route_static_duration_seconds,
    p_route_traffic_delay_seconds,p_distance_source,p_serviceability_outcome,
    p_route_review_reason
  );
  insert into public.couranr_delivery_request_events(
    request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_req.id,p_actor_user_id,'merchant','calculate_delivery_request_estimate',
    'draft','draft',jsonb_build_object(
      'quoteVersionId',v_quote.id,'quoteNumber',v_quote.quote_number,
      'quoteStatus',v_quote.quote_status,'reviewReasons',v_quote.review_reasons,
      'serviceabilityOutcome',p_serviceability_outcome,
      'distanceSource',p_distance_source,
      'routeDistanceMeters',p_route_distance_meters,
      'routeDurationSeconds',p_route_duration_seconds)
  );
  select * into v_req from public.couranr_delivery_requests where id=v_req.id;
  return v_req;
end
$fn$;

/* -------------------------- restore the pre-batch appender ------------- */

create or replace function private.couranr_append_routed_quote_version(
  p_request_id               uuid,
  p_created_by_user_id       uuid,
  p_request_version          integer,
  p_quote_status             text,
  p_pricing_policy_version   text,
  p_delivery_subtotal_cents  integer,
  p_included_loaded_miles    integer,
  p_billable_loaded_miles    numeric,
  p_quote_line_items         jsonb,
  p_review_reasons           jsonb,
  p_route_distance_meters    bigint,
  p_route_duration_seconds   integer,
  p_route_static_duration_seconds integer,
  p_route_traffic_delay_seconds  integer,
  p_distance_source          text,
  p_serviceability_outcome   text,
  p_route_review_reason      text
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
  v_loaded_miles numeric(10,3);
begin
  select * into v_req
    from public.couranr_delivery_requests
   where id=p_request_id
   for update;
  if not found then raise exception 'request_not_found' using errcode='CR404'; end if;
  if v_req.version is distinct from p_request_version then
    raise exception 'version_or_state_conflict' using errcode='CR409';
  end if;
  if p_quote_status not in ('estimated','manual_review_required','invalid') then
    raise exception 'invalid_quote_status' using errcode='CR422';
  end if;
  if jsonb_typeof(p_quote_line_items) is distinct from 'array'
     or jsonb_typeof(p_review_reasons) is distinct from 'array' then
    raise exception 'quote_arrays_required' using errcode='CR422';
  end if;
  if p_distance_source is distinct from 'google_routes_v2'
     or p_serviceability_outcome not in ('available_for_request','needs_review') then
    raise exception 'google_route_authority_required' using errcode='CR422';
  end if;
  if nullif(v_req.pickup_address->>'googlePlaceId','') is null
     or nullif(v_req.dropoff_address->>'googlePlaceId','') is null
     or nullif(v_req.pickup_address->>'formattedAddress','') is null
     or nullif(v_req.dropoff_address->>'formattedAddress','') is null
     or nullif(v_req.pickup_address->>'line1','') is null
     or nullif(v_req.dropoff_address->>'line1','') is null
     or nullif(v_req.pickup_address->>'city','') is null
     or nullif(v_req.dropoff_address->>'city','') is null
     or nullif(v_req.pickup_address->>'region','') is null
     or nullif(v_req.dropoff_address->>'region','') is null
     or nullif(v_req.pickup_address->>'postalCode','') is null
     or nullif(v_req.dropoff_address->>'postalCode','') is null
     or nullif(v_req.pickup_address->>'countryCode','') is null
     or nullif(v_req.dropoff_address->>'countryCode','') is null
     or jsonb_typeof(v_req.pickup_address->'latitude') is distinct from 'number'
     or jsonb_typeof(v_req.pickup_address->'longitude') is distinct from 'number'
     or jsonb_typeof(v_req.dropoff_address->'latitude') is distinct from 'number'
     or jsonb_typeof(v_req.dropoff_address->'longitude') is distinct from 'number'
     or v_req.pickup_address->>'addressSource' is distinct from 'google_places_new'
     or v_req.dropoff_address->>'addressSource' is distinct from 'google_places_new' then
    raise exception 'google_place_identity_required' using errcode='CR422';
  end if;

  if p_serviceability_outcome='available_for_request' then
    if p_route_distance_meters is null or p_route_distance_meters < 0
       or p_route_duration_seconds is null or p_route_duration_seconds < 0
       or p_route_review_reason is not null then
      raise exception 'complete_google_route_evidence_required' using errcode='CR422';
    end if;
    v_loaded_miles := round(p_route_distance_meters::numeric / 1609.344, 3);
    if v_req.loaded_miles is distinct from v_loaded_miles then
      raise exception 'request_route_distance_mismatch' using errcode='CR422';
    end if;
    /* TRF-001. An automatically priced route must carry BOTH durations and a
       delay that is exactly their clamped difference. A caller cannot hand in
       a flattering delay, and a missing baseline is refused rather than read
       as a zero delay. */
    if p_route_static_duration_seconds is null
       or p_route_static_duration_seconds < 0
       or p_route_traffic_delay_seconds is null
       or p_route_traffic_delay_seconds < 0 then
      raise exception 'complete_traffic_evidence_required' using errcode='CR422';
    end if;
    if p_route_traffic_delay_seconds is distinct from
       greatest(p_route_duration_seconds - p_route_static_duration_seconds,0) then
      raise exception 'traffic_delay_must_equal_route_evidence' using errcode='CR422';
    end if;
    if p_review_reasons ? 'route_needs_review' then
      raise exception 'available_route_cannot_need_route_review' using errcode='CR422';
    end if;
  else
    if nullif(p_route_review_reason,'') is null
       or p_quote_status <> 'manual_review_required'
       or not (p_review_reasons ? 'route_needs_review') then
      raise exception 'route_review_evidence_invalid' using errcode='CR422';
    end if;
    if p_route_distance_meters is null then
      if p_route_duration_seconds is not null or v_req.loaded_miles is not null then
        raise exception 'route_review_evidence_invalid' using errcode='CR422';
      end if;
      v_loaded_miles := null;
    else
      if p_route_distance_meters < 0
         or p_route_duration_seconds is null or p_route_duration_seconds < 0 then
        raise exception 'route_review_evidence_invalid' using errcode='CR422';
      end if;
      v_loaded_miles := round(p_route_distance_meters::numeric / 1609.344, 3);
      if v_req.loaded_miles is distinct from v_loaded_miles then
        raise exception 'request_route_distance_mismatch' using errcode='CR422';
      end if;
    end if;
  end if;

  v_total := public.couranr_quote_line_items_total(p_quote_line_items);
  if p_quote_status='estimated' then
    if p_pricing_policy_version is null or p_delivery_subtotal_cents is null
       or p_delivery_subtotal_cents < 0 then
      raise exception 'quote_incomplete' using errcode='CR422';
    end if;
    /* PRC-007. An automatic priced quote minted here must be EXACTLY the
       current policy. A denylist of the superseded identifier was the earlier
       shape and it was too weak: it let every typo, invented string and
       ungoverned future version through, and a stored quote whose policy
       nobody recognises cannot be explained later. Historical rows are
       untouched - this constrains MINTING only, and manual-review/unpriced
       quotes keep their nullable rules below. */
    if p_pricing_policy_version is distinct from 'couranr-pricing-v2-2026-09-01' then
      raise exception 'unsupported_pricing_policy_version' using errcode='CR422';
    end if;
    if v_total is distinct from p_delivery_subtotal_cents::bigint then
      raise exception 'quote_subtotal_mismatch' using errcode='CR422';
    end if;
  elsif p_delivery_subtotal_cents is not null
        or p_pricing_policy_version is not null
        or v_total is distinct from 0 then
    raise exception 'unpriced_quote_contains_commercial_amount' using errcode='CR422';
  end if;

  select coalesce(max(quote_number),0)+1 into v_quote_number
    from public.couranr_quote_versions where request_id=p_request_id;
  v_previous_id := v_req.current_quote_version_id;

  insert into public.couranr_quote_versions(
    request_id,quote_number,supersedes_quote_version_id,
    created_by_user_id,request_version_at_creation,
    quote_status,pricing_policy_version,payer_type,currency,
    subtotal_cents,included_loaded_miles,billable_loaded_miles,
    quote_line_items,review_reasons,
    pickup_address_snapshot,dropoff_address_snapshot,recipient_snapshot,
    shipment_snapshot,service_configuration_snapshot,
    loaded_distance_miles,route_distance_meters,route_duration_seconds,
    route_static_duration_seconds,route_traffic_delay_seconds,
    distance_source,serviceability_outcome,
    provenance_state,record_origin,legacy_evidence
  ) values (
    v_req.id,v_quote_number,v_previous_id,
    p_created_by_user_id,v_req.version,
    p_quote_status,p_pricing_policy_version,v_req.payer_type,'usd',
    p_delivery_subtotal_cents,p_included_loaded_miles,p_billable_loaded_miles,
    p_quote_line_items,p_review_reasons,
    v_req.pickup_address,v_req.dropoff_address,
    jsonb_build_object('name',v_req.recipient_name,'phone',v_req.recipient_phone,
                       'email',v_req.recipient_email),
    jsonb_build_object('loadedMiles',v_loaded_miles,'weightLb',v_req.weight_lb,
                       'additionalStops',v_req.additional_stops),
    jsonb_build_object('serviceLevel',v_req.service_level,
                       'signatureRequired',v_req.signature_required,
                       'proofMethod',v_req.proof_method,
                       'routeAuthority','google_routes_v2',
                       'serviceabilityOutcome',p_serviceability_outcome,
                       'routeReviewReason',p_route_review_reason),
    v_loaded_miles,p_route_distance_meters,p_route_duration_seconds,
    p_route_static_duration_seconds,p_route_traffic_delay_seconds,
    p_distance_source,p_serviceability_outcome,
    'verified','runtime',null
  ) returning * into v_quote;

  perform set_config('couranr.quote_projection_write','on',true);
  update public.couranr_delivery_requests set
    current_quote_version_id=v_quote.id,
    quote_status=v_quote.quote_status,
    pricing_policy_version=v_quote.pricing_policy_version,
    delivery_subtotal_cents=v_quote.subtotal_cents,
    included_loaded_miles=v_quote.included_loaded_miles,
    billable_loaded_miles=v_quote.billable_loaded_miles,
    quote_line_items=coalesce(v_quote.quote_line_items,'[]'::jsonb),
    review_reasons=v_quote.review_reasons,
    rounding_applied=false,tax_included=false,payment_due_cents=null,
    updated_at=now()
  where id=v_req.id;
  perform set_config('couranr.quote_projection_write','off',true);

  if v_previous_id is not null and v_previous_id is distinct from v_quote.id then
    update public.couranr_payment_access_tokens set
      revoked_at=now(),revoked_reason='quote_superseded'
    where request_id=v_req.id and revoked_at is null;
  end if;
  return v_quote;
end
$fn$;

/* ---------------------------------------------------------------- grants */

revoke all on function public.couranr_create_routed_delivery_request_draft(
  uuid,uuid,text,text,text,text,text,text,text,numeric,integer,text,boolean,text,jsonb,jsonb,boolean,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.couranr_create_routed_delivery_request_draft(
  uuid,uuid,text,text,text,text,text,text,text,numeric,integer,text,boolean,text,jsonb,jsonb,boolean,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb
) to service_role;

revoke all on function public.couranr_calculate_routed_delivery_request_estimate(
  uuid,uuid,integer,uuid,boolean,text,text,text,text,text,text,numeric,integer,text,boolean,text,jsonb,jsonb,boolean,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.couranr_calculate_routed_delivery_request_estimate(
  uuid,uuid,integer,uuid,boolean,text,text,text,text,text,text,numeric,integer,text,boolean,text,jsonb,jsonb,boolean,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb
) to service_role;

revoke all on function private.couranr_append_routed_quote_version(
  uuid,uuid,integer,text,text,integer,integer,numeric,jsonb,jsonb,bigint,integer,integer,integer,text,text,text
) from public, anon, authenticated, service_role;
grant execute on function private.couranr_append_routed_quote_version(
  uuid,uuid,integer,text,text,integer,integer,numeric,jsonb,jsonb,bigint,integer,integer,integer,text,text,text
) to service_role;

/* ------------------------- columns, only on an evidence-free database --- */

alter table public.couranr_delivery_requests
  drop constraint if exists couranr_dr_weight_band_chk,
  drop constraint if exists couranr_dr_timing_intent_chk,
  drop constraint if exists couranr_dr_operating_tz_chk,
  drop constraint if exists couranr_dr_scheduled_complete_chk,
  drop constraint if exists couranr_dr_requested_local_format_chk,
  drop constraint if exists couranr_dr_timing_reasons_array_chk;

alter table public.couranr_delivery_requests
  drop column if exists weight_band,
  drop column if exists timing_intent,
  drop column if exists requested_pickup_local,
  drop column if exists operating_timezone,
  drop column if exists requested_departure_at,
  drop column if exists timing_review_reasons,
  drop column if exists restricted_class;

commit;

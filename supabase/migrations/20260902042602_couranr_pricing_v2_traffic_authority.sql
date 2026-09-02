-- =====================================================================
-- COURANR PRICING AUTHORITY V2 — traffic evidence and policy cutover
--
-- Pricing V2 supersedes the historical $22.99 / first-3-loaded-mile model
-- for NEW quotes. This migration makes the DATABASE enforce two things the
-- application layer also enforces, so neither can be the only guard:
--
--   1. TRAFFIC EVIDENCE. An automatically priced route must carry BOTH the
--      traffic-aware duration and the static (baseline) duration from ONE
--      canonical Google Routes response, and a delay that is exactly their
--      clamped difference. A caller cannot hand in a flattering delay, and a
--      missing baseline is REFUSED rather than read as a zero delay.
--
--   2. POLICY CUTOVER. The superseded identifier
--      'couranr-pricing-2026-07-31' can never be MINTED again. Historical
--      rows keep it forever — that is what makes an old quote explainable —
--      but no command may create a new one under it.
--
-- ADDITIVE AND FORWARD-SAFE. No historical quote amount is rewritten, no
-- column or table is dropped, no row is deleted. The two new columns are
-- nullable, so every pre-existing quote row stays exactly as it was.
--
-- The five routing functions below are the PR #38 implementations with the
-- two traffic parameters threaded through. They are DROPPED and recreated
-- rather than replaced because adding a parameter changes the signature, and
-- `create or replace` would leave the old arity behind as a live overload
-- that still accepts a quote with no traffic evidence.
-- =====================================================================

begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

do $guard$
begin
  if to_regclass('public.couranr_quote_versions') is null then
    raise exception 'Pricing V2 requires the immutable quote spine';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='couranr_quote_versions'
       and column_name='route_duration_seconds'
  ) then
    raise exception 'Pricing V2 requires the Batch 1 Google routing authority';
  end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='couranr_quote_versions'
       and column_name in ('route_static_duration_seconds','route_traffic_delay_seconds')
  ) then
    raise exception 'Pricing V2 traffic columns already exist; refusing a partial application';
  end if;
end
$guard$;

/* ------------------------------------------------------- traffic evidence */

alter table public.couranr_quote_versions
  add column route_static_duration_seconds integer,
  add column route_traffic_delay_seconds   integer;

comment on column public.couranr_quote_versions.route_static_duration_seconds is
  'Google routes.staticDuration: baseline seconds for this route EXCLUDING traffic. Immutable evidence for the traffic charge on this quote.';
comment on column public.couranr_quote_versions.route_traffic_delay_seconds is
  'max(route_duration_seconds - route_static_duration_seconds, 0). Priced up front; later real-world traffic never reprices an accepted quote.';

alter table public.couranr_quote_versions
  add constraint couranr_qv_traffic_nonneg_chk check (
    (route_static_duration_seconds is null or route_static_duration_seconds >= 0)
    and (route_traffic_delay_seconds is null or route_traffic_delay_seconds >= 0)
  );

/* The delay is DERIVED, never asserted. Where both durations exist the stored
   delay must equal their clamped difference, so a row cannot claim a delay its
   own evidence does not support. Historical rows predate the columns and are
   exempt by the null branch — they are not reinterpreted. */
alter table public.couranr_quote_versions
  add constraint couranr_qv_traffic_delay_derived_chk check (
    route_traffic_delay_seconds is null
    or (route_duration_seconds is not null
        and route_static_duration_seconds is not null
        and route_traffic_delay_seconds
            = greatest(route_duration_seconds - route_static_duration_seconds, 0))
  );
/* ------------------------------------------------ functions, re-signatured */
/* Wrappers first, then the private function they call. */
drop function if exists public.couranr_calculate_routed_delivery_request_estimate(
  uuid,uuid,integer,uuid,boolean,text,text,text,text,text,text,numeric,integer,text,
  boolean,text,jsonb,jsonb,boolean,bigint,integer,text,text,text,text,text,integer,
  integer,numeric,jsonb,jsonb
);
drop function if exists public.couranr_create_routed_delivery_request_draft(
  uuid,uuid,text,text,text,text,text,text,text,numeric,integer,text,boolean,text,
  jsonb,jsonb,boolean,bigint,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb
);
drop function if exists public.couranr_requote_routed_delivery_request(
  uuid,uuid,integer,uuid,text,integer,integer,numeric,jsonb,
  bigint,integer,text,text,text,text
);
drop function if exists public.couranr_create_routed_quote_version(
  uuid,uuid,integer,uuid,text,text,integer,integer,numeric,jsonb,jsonb,
  bigint,integer,text,text,text
);
drop function if exists private.couranr_append_routed_quote_version(
  uuid,uuid,integer,text,text,integer,integer,numeric,jsonb,jsonb,
  bigint,integer,text,text,text
);

create function private.couranr_append_routed_quote_version(
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
  /* PRC-001 V2 cutover. Historical rows keep their own identifier forever;
     this command may never MINT the superseded one again. */
  if p_pricing_policy_version = 'couranr-pricing-2026-07-31' then
    raise exception 'superseded_pricing_policy_cannot_be_minted' using errcode='CR422';
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

create function public.couranr_create_routed_quote_version(
  p_request_id uuid,p_business_account_id uuid,p_expected_version integer,
  p_actor_user_id uuid,p_quote_status text,p_pricing_policy_version text,
  p_delivery_subtotal_cents integer,p_included_loaded_miles integer,
  p_billable_loaded_miles numeric,p_quote_line_items jsonb,p_review_reasons jsonb,
  p_route_distance_meters bigint,p_route_duration_seconds integer,
  p_route_static_duration_seconds integer,
  p_route_traffic_delay_seconds  integer,
  p_distance_source text,p_serviceability_outcome text,p_route_review_reason text
)
returns public.couranr_delivery_requests
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_quote public.couranr_quote_versions;
  v_previous_state text;
  v_target_state text;
  v_loaded_miles numeric(10,3);
  v_route_payload jsonb;
begin
  if p_route_distance_meters is not null then
    v_loaded_miles := round(p_route_distance_meters::numeric / 1609.344,3);
  else
    v_loaded_miles := null;
  end if;
  v_route_payload := jsonb_build_object(
    'serviceabilityOutcome',p_serviceability_outcome,
    'distanceSource',p_distance_source,'reviewReason',p_route_review_reason);

  select request_state into v_previous_state
    from public.couranr_delivery_requests
   where id=p_request_id
     and business_account_id is not distinct from p_business_account_id
   for update;
  if not found then raise exception 'request_not_found' using errcode='CR404'; end if;
  v_target_state := case when v_previous_state='draft' then 'draft'
                         else 'quote_revision_required' end;

  update public.couranr_delivery_requests set
    loaded_miles=v_loaded_miles,
    normalized_request_payload=jsonb_set(
      coalesce(normalized_request_payload,'{}'::jsonb),'{route}',v_route_payload,true),
    version=p_expected_version+1,request_state=v_target_state,
    review_state=case when v_target_state='quote_revision_required' then 'requoted'
                      else review_state end,
    updated_at=now()
  where id=p_request_id
    and business_account_id is not distinct from p_business_account_id
    and version=p_expected_version
    and request_state in (
      'draft','pending_couranr_review','confirmed',
      'awaiting_quote_acceptance','quote_revision_required')
  returning * into v_req;
  if not found then raise exception 'version_or_state_conflict' using errcode='CR409'; end if;

  v_quote := private.couranr_append_routed_quote_version(
    v_req.id,p_actor_user_id,v_req.version,p_quote_status,p_pricing_policy_version,
    p_delivery_subtotal_cents,p_included_loaded_miles,p_billable_loaded_miles,
    p_quote_line_items,p_review_reasons,p_route_distance_meters,
    p_route_duration_seconds,p_route_static_duration_seconds,
    p_route_traffic_delay_seconds,p_distance_source,p_serviceability_outcome,
    p_route_review_reason);

  insert into public.couranr_delivery_request_events(
    request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_req.id,p_actor_user_id,
    case when v_req.requester_kind='business' then 'merchant' else 'customer' end,
    case when v_previous_state='draft' then 'calculate_delivery_request_estimate'
         else 'create_quote_version' end,
    v_previous_state,v_target_state,
    jsonb_build_object(
      'quoteVersionId',v_quote.id,'quoteNumber',v_quote.quote_number,
      'payerType',v_quote.payer_type,'quoteStatus',v_quote.quote_status,
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

create function public.couranr_requote_routed_delivery_request(
  p_request_id uuid,p_business_account_id uuid,p_expected_version integer,
  p_actor_user_id uuid,p_pricing_policy_version text,
  p_delivery_subtotal_cents integer,p_included_loaded_miles integer,
  p_billable_loaded_miles numeric,p_quote_line_items jsonb,
  p_route_distance_meters bigint,p_route_duration_seconds integer,
  p_route_static_duration_seconds integer,
  p_route_traffic_delay_seconds  integer,
  p_distance_source text,p_serviceability_outcome text,p_route_review_reason text,
  p_requote_reason text
)
returns public.couranr_delivery_requests
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_before public.couranr_quote_versions;
  v_quote public.couranr_quote_versions;
  v_loaded_miles numeric(10,3);
  v_route_payload jsonb;
begin
  if nullif(btrim(p_requote_reason),'') is null then
    raise exception 'requote_reason_required' using errcode='CR422';
  end if;
  if p_serviceability_outcome is distinct from 'available_for_request'
     or p_route_distance_meters is null then
    raise exception 'requote_requires_available_route' using errcode='CR422';
  end if;
  v_loaded_miles := round(p_route_distance_meters::numeric / 1609.344,3);
  v_route_payload := jsonb_build_object(
    'serviceabilityOutcome',p_serviceability_outcome,
    'distanceSource',p_distance_source,'reviewReason',p_route_review_reason);

  select q.* into v_before
    from public.couranr_delivery_requests r
    left join public.couranr_quote_versions q on q.id=r.current_quote_version_id
   where r.id=p_request_id
     and r.business_account_id is not distinct from p_business_account_id;

  update public.couranr_delivery_requests set
    loaded_miles=v_loaded_miles,
    normalized_request_payload=jsonb_set(
      coalesce(normalized_request_payload,'{}'::jsonb),'{route}',v_route_payload,true),
    request_state='quote_revision_required',review_state='requoted',
    version=p_expected_version+1,updated_at=now()
  where id=p_request_id
    and business_account_id is not distinct from p_business_account_id
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

  v_quote := private.couranr_append_routed_quote_version(
    v_req.id,p_actor_user_id,v_req.version,'estimated',p_pricing_policy_version,
    p_delivery_subtotal_cents,p_included_loaded_miles,p_billable_loaded_miles,
    p_quote_line_items,'[]'::jsonb,p_route_distance_meters,
    p_route_duration_seconds,p_route_static_duration_seconds,
    p_route_traffic_delay_seconds,p_distance_source,p_serviceability_outcome,
    p_route_review_reason);
  insert into public.couranr_delivery_request_events(
    request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_req.id,p_actor_user_id,'operations','requote_delivery_request',
    'pending_couranr_review','quote_revision_required',
    jsonb_build_object(
      'previousQuoteVersionId',v_before.id,'quoteVersionId',v_quote.id,
      'quoteNumber',v_quote.quote_number,'payerType',v_quote.payer_type,
      'reason',p_requote_reason,'quoteChanged',true,
      'serviceabilityOutcome',p_serviceability_outcome,
      'distanceSource',p_distance_source,
      'routeDistanceMeters',p_route_distance_meters,
      'routeDurationSeconds',p_route_duration_seconds)
  );
  select * into v_req from public.couranr_delivery_requests where id=v_req.id;
  return v_req;
end
$fn$;

create function public.couranr_create_routed_delivery_request_draft(
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

create function public.couranr_calculate_routed_delivery_request_estimate(
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
revoke all on function private.couranr_append_routed_quote_version(
  uuid,uuid,integer,text,text,integer,integer,numeric,jsonb,jsonb,
  bigint,integer,integer,integer,text,text,text
) from public,anon,authenticated,service_role;
grant execute on function private.couranr_append_routed_quote_version(
  uuid,uuid,integer,text,text,integer,integer,numeric,jsonb,jsonb,
  bigint,integer,integer,integer,text,text,text
) to service_role;

revoke all on function public.couranr_calculate_routed_delivery_request_estimate(
  uuid,uuid,integer,uuid,boolean,text,text,text,text,text,text,numeric,integer,text,
  boolean,text,jsonb,jsonb,boolean,bigint,integer,integer,integer,text,text,text,text,text,integer,
  integer,numeric,jsonb,jsonb
) from public,anon,authenticated,service_role;
grant execute on function public.couranr_calculate_routed_delivery_request_estimate(
  uuid,uuid,integer,uuid,boolean,text,text,text,text,text,text,numeric,integer,text,
  boolean,text,jsonb,jsonb,boolean,bigint,integer,integer,integer,text,text,text,text,text,integer,
  integer,numeric,jsonb,jsonb
) to service_role;

revoke all on function public.couranr_create_routed_delivery_request_draft(
  uuid,uuid,text,text,text,text,text,text,text,numeric,integer,text,boolean,text,
  jsonb,jsonb,boolean,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb
) from public,anon,authenticated,service_role;
grant execute on function public.couranr_create_routed_delivery_request_draft(
  uuid,uuid,text,text,text,text,text,text,text,numeric,integer,text,boolean,text,
  jsonb,jsonb,boolean,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb
) to service_role;

revoke all on function public.couranr_requote_routed_delivery_request(
  uuid,uuid,integer,uuid,text,integer,integer,numeric,jsonb,
  bigint,integer,integer,integer,text,text,text,text
) from public,anon,authenticated,service_role;
grant execute on function public.couranr_requote_routed_delivery_request(
  uuid,uuid,integer,uuid,text,integer,integer,numeric,jsonb,
  bigint,integer,integer,integer,text,text,text,text
) to service_role;

revoke all on function public.couranr_create_routed_quote_version(
  uuid,uuid,integer,uuid,text,text,integer,integer,numeric,jsonb,jsonb,
  bigint,integer,integer,integer,text,text,text
) from public,anon,authenticated,service_role;
grant execute on function public.couranr_create_routed_quote_version(
  uuid,uuid,integer,uuid,text,text,integer,integer,numeric,jsonb,jsonb,
  bigint,integer,integer,integer,text,text,text
) to service_role;

commit;

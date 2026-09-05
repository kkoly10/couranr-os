-- Roll back only the runtime quote-appender authority repair.
-- Historical rows are never modified.
begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

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
    jsonb_build_object(
      'loadedMiles',v_loaded_miles,
      /* SUR-001 band cutover: the snapshot TELLS THE TRUTH. Exact weight when
         it is actually known; the governed band when only the band is known;
         'unresolved' when neither is. Nothing here converts a band into
         pounds or a null into a zero. */
      'weightLb',v_req.weight_lb,
      'weightBand',v_req.weight_band,
      'weightKnowledge',case
        when v_req.weight_lb is not null then 'exact'
        when v_req.weight_band is not null and v_req.weight_band <> 'unknown' then 'band'
        else 'unresolved' end,
      /* The safety declaration this quote was minted under. */
      'restrictedClass',v_req.restricted_class,
      'additionalStops',v_req.additional_stops,
      /* TMZ-001: the requested timing this quote was minted against, local
         words AND canonical instant, so the quote can explain itself. */
      'timing',jsonb_build_object(
        'intent',v_req.timing_intent,
        'requestedPickupLocal',v_req.requested_pickup_local,
        'operatingTimezone',v_req.operating_timezone,
        'requestedDepartureAt',v_req.requested_departure_at,
        'reviewReasons',coalesce(v_req.timing_review_reasons,'[]'::jsonb))),
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

revoke all on function private.couranr_append_routed_quote_version(
  uuid,uuid,integer,text,text,integer,integer,numeric,jsonb,jsonb,
  bigint,integer,integer,integer,text,text,text
) from public,anon,authenticated;
grant execute on function private.couranr_append_routed_quote_version(
  uuid,uuid,integer,text,text,integer,integer,numeric,jsonb,jsonb,
  bigint,integer,integer,integer,text,text,text
) to service_role;

commit;

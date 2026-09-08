-- =====================================================================
-- ROLLBACK — hosted legacy validate deploy-gap guard (20260908220500)
--
-- Restores the v1 26-argument couranr_validate_hosted_delivery_request body
-- VERBATIM from 20260905040000 (extracted, not retyped) plus its service_role-
-- only grants, and only while the legacy arity still exists: if the fence has
-- retired it this is a no-op, never a resurrection.
--
-- Note the hazard this reopens: with the v1 body live, a scheduled hosted row
-- validated through the legacy arity is rewritten to asap. Only roll this back
-- once no application that could store a scheduled hosted row is serving.
--
-- Idempotent: create-or-replace throughout. Grants restated unconditionally.
-- =====================================================================

begin;
set local statement_timeout = '60s';
set local lock_timeout = '10s';

do $restore$
begin
  if to_regprocedure('public.couranr_validate_hosted_delivery_request(uuid,uuid,integer,uuid,text,numeric,text,text,boolean,jsonb,jsonb,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,jsonb)') is null then
    raise notice 'legacy 26-argument hosted validate is absent (fence applied); no-op';
    return;
  end if;
  execute $body$
create or replace function public.couranr_validate_hosted_delivery_request(
  p_request_id uuid,
  p_host_business_account_id uuid,
  p_expected_version integer,
  p_actor_user_id uuid,
  p_payer_type text,
  p_weight_lb numeric,
  p_weight_band text,
  p_restricted_class text,
  p_signature_required boolean,
  p_pickup_address jsonb,
  p_dropoff_address jsonb,
  p_route_distance_meters bigint,
  p_route_duration_seconds integer,
  p_route_static_duration_seconds integer,
  p_route_traffic_delay_seconds integer,
  p_distance_source text,
  p_serviceability_outcome text,
  p_route_review_reason text,
  p_quote_status text,
  p_pricing_policy_version text,
  p_delivery_subtotal_cents integer,
  p_included_loaded_miles integer,
  p_billable_loaded_miles numeric,
  p_quote_line_items jsonb,
  p_review_reasons jsonb,
  p_timing_review_reasons jsonb
)
returns public.couranr_delivery_requests
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_role text;
  v_intake public.couranr_hosted_request_intakes;
  v_req public.couranr_delivery_requests;
  v_quote public.couranr_quote_versions;
  v_loaded_miles numeric(10,3);
begin
  v_role:=public.couranr_require_active_member(
    p_host_business_account_id,p_actor_user_id);
  if v_role not in ('owner','manager','dispatcher') then
    raise exception 'role_may_not_validate_hosted_request' using errcode='CR403';
  end if;

  select * into v_intake
    from public.couranr_hosted_request_intakes
   where request_id=p_request_id
     and host_business_account_id=p_host_business_account_id
   for update;
  if not found then raise exception 'request_not_found' using errcode='CR404'; end if;

  select * into v_req from public.couranr_delivery_requests
   where id=p_request_id
     and requester_kind='consumer'
     and business_account_id is null
     and source='hosted_request'
   for update;
  if not found then raise exception 'request_not_found' using errcode='CR404'; end if;
  if v_req.version is distinct from p_expected_version
     or v_req.request_state<>'awaiting_merchant_confirmation'
     or v_req.current_quote_version_id is not null
     or v_req.quote_status<>'not_quoted' then
    raise exception 'version_or_state_conflict' using errcode='CR409';
  end if;

  if p_payer_type not in ('merchant','customer') then
    raise exception 'payer_type_invalid' using errcode='CR422';
  end if;
  if p_weight_lb is null and p_weight_band is null then
    raise exception 'weight_or_band_required' using errcode='CR422';
  end if;
  if p_weight_lb is not null and p_weight_lb<=0 then
    raise exception 'weight_must_be_positive' using errcode='CR422';
  end if;
  if p_weight_band is not null and p_weight_band not in
     ('0_25_lb','over_25_to_50_lb','over_50_lb','unknown') then
    raise exception 'weight_band_invalid' using errcode='CR422';
  end if;
  perform private.couranr_assert_safety_declaration(p_restricted_class,p_quote_status);

  if p_pickup_address->>'googlePlaceId' is distinct from v_req.pickup_address->>'googlePlaceId'
     or p_dropoff_address->>'googlePlaceId' is distinct from v_intake.destination_place_id then
    raise exception 'hosted_address_identity_mismatch' using errcode='CR409';
  end if;

  if p_route_distance_meters is not null then
    v_loaded_miles:=round(p_route_distance_meters::numeric/1609.344,3);
  else
    v_loaded_miles:=null;
  end if;

  -- Material customer facts become trusted only because this named merchant
  -- command confirms them. The host relationship itself remains separate.
  update public.couranr_delivery_requests set
    payer_type=p_payer_type,
    weight_lb=p_weight_lb,
    weight_band=p_weight_band,
    restricted_class=p_restricted_class,
    signature_required=coalesce(p_signature_required,false),
    proof_method=case when coalesce(p_signature_required,false)
                      then 'signature' else 'photo_or_pin' end,
    pickup_address=p_pickup_address,
    dropoff_address=p_dropoff_address,
    loaded_miles=v_loaded_miles,
    timing_intent='asap',
    operating_timezone='America/New_York',
    timing_review_reasons=coalesce(p_timing_review_reasons,'[]'::jsonb),
    normalized_request_payload=
      jsonb_set(
        coalesce(normalized_request_payload,'{}'::jsonb),
        '{route}',
        jsonb_build_object(
          'serviceabilityOutcome',p_serviceability_outcome,
          'distanceSource',p_distance_source,
          'reviewReason',p_route_review_reason),
        true
      ),
    updated_at=now()
  where id=v_req.id and version=p_expected_version;
  if not found then raise exception 'version_or_state_conflict' using errcode='CR409'; end if;

  v_quote:=private.couranr_append_routed_quote_version(
    v_req.id,p_actor_user_id,p_expected_version,
    p_quote_status,p_pricing_policy_version,p_delivery_subtotal_cents,
    p_included_loaded_miles,p_billable_loaded_miles,p_quote_line_items,
    p_review_reasons,p_route_distance_meters,p_route_duration_seconds,
    p_route_static_duration_seconds,p_route_traffic_delay_seconds,
    p_distance_source,p_serviceability_outcome,p_route_review_reason
  );

  update public.couranr_delivery_requests set
    request_state='pending_couranr_review',
    review_state='pending',
    submitted_at=now(),
    version=p_expected_version+1,
    updated_at=now()
  where id=v_req.id and version=p_expected_version
    and request_state='awaiting_merchant_confirmation'
  returning * into v_req;
  if not found then raise exception 'version_or_state_conflict' using errcode='CR409'; end if;

  insert into public.couranr_delivery_request_events(
    request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_req.id,p_actor_user_id,'merchant','validate_hosted_delivery_request',
    'awaiting_merchant_confirmation','pending_couranr_review',
    jsonb_build_object(
      'quoteVersionId',v_quote.id,
      'quoteNumber',v_quote.quote_number,
      'payerType',v_quote.payer_type,
      'acknowledgment',false,
      'quoteStatus',v_quote.quote_status,
      'reviewReasons',v_quote.review_reasons,
      'hostBusinessAccountId',p_host_business_account_id,
      'merchantValidated',true,
      'requestedPayerType',v_intake.requested_payer_type
    )
  );

  return v_req;
end
$fn$;
$body$;
  execute $g$revoke all on function public.couranr_validate_hosted_delivery_request(uuid,uuid,integer,uuid,text,numeric,text,text,boolean,jsonb,jsonb,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,jsonb)
    from public,anon,authenticated,service_role$g$;
  execute $g$grant execute on function public.couranr_validate_hosted_delivery_request(uuid,uuid,integer,uuid,text,numeric,text,text,boolean,jsonb,jsonb,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,jsonb) to service_role$g$;
end
$restore$;

commit;

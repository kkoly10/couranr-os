-- =====================================================================
-- ROLLBACK — hosted legacy arity fence (20260908230000)
--
-- Restores the pre-timing 13/26-argument hosted create/validate commands,
-- bodies VERBATIM from 20260905040000 (extracted, not retyped), plus their
-- service_role-only grants. After this rollback both arities are live again —
-- the PREDEPLOY compatibility state — so the pre-batch application can be
-- redeployed.
--
-- ORDER: this is the FIRST database step of any application rollback after
-- cutover (restore old arity → redeploy old application SHA). It is safe to
-- run while the NEW application is serving: the new application's 17/29-key
-- calls still resolve only to the strict arity.
--
-- Idempotent: create-or-replace throughout. Grants restated unconditionally.
-- =====================================================================

begin;
set local statement_timeout = '60s';
set local lock_timeout = '10s';

create or replace function public.couranr_create_hosted_delivery_request(
  p_intake_id uuid,
  p_order_reference text,
  p_requested_payer_type text,
  p_destination_place_id text,
  p_destination_label text,
  p_recipient_name text,
  p_recipient_phone text,
  p_recipient_email text,
  p_weight_lb numeric,
  p_weight_band text,
  p_customer_restricted_class text,
  p_signature_requested boolean,
  p_shipment_description text
)
returns public.couranr_delivery_requests
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_intake public.couranr_hosted_request_intakes;
  v_workspace public.couranr_merchant_workspaces;
  v_host record;
  v_req public.couranr_delivery_requests;
  v_phone text:=nullif(btrim(coalesce(p_recipient_phone,'')),'');
  v_email text:=nullif(btrim(coalesce(p_recipient_email,'')),'');
  v_name text:=nullif(btrim(coalesce(p_recipient_name,'')),'');
  v_place text:=nullif(btrim(coalesce(p_destination_place_id,'')),'');
  v_label text:=nullif(btrim(coalesce(p_destination_label,'')),'');
  v_desc text:=nullif(btrim(coalesce(p_shipment_description,'')),'');
  v_order text:=nullif(btrim(coalesce(p_order_reference,'')),'');
begin
  select * into v_intake
    from public.couranr_hosted_request_intakes
   where id=p_intake_id for update;
  if not found or v_intake.expires_at<=now() then
    raise exception 'hosted_request_not_found' using errcode='CR404';
  end if;

  if v_intake.request_id is not null then
    select * into v_req from public.couranr_delivery_requests
     where id=v_intake.request_id
       and requester_kind='consumer'
       and business_account_id is null
       and source='hosted_request';
    if not found then raise exception 'hosted_request_binding_invalid' using errcode='CR409'; end if;
    return v_req;
  end if;

  -- A session created while published cannot be used to create a NEW request
  -- after the merchant disables the link or loses live activation.
  select * into v_host
    from public.couranr_resolve_hosted_request_merchant(v_intake.host_slug_snapshot);
  if not found or v_host.business_account_id is distinct from v_intake.host_business_account_id then
    raise exception 'hosted_request_not_available' using errcode='CR409';
  end if;

  select * into v_workspace from public.couranr_merchant_workspaces
   where business_account_id=v_intake.host_business_account_id;
  if not found or v_workspace.pickup_address is null then
    raise exception 'hosted_request_not_available' using errcode='CR409';
  end if;

  if v_name is null or (v_phone is null and v_email is null) then
    raise exception 'hosted_contact_required' using errcode='CR422';
  end if;
  if v_place is null or v_label is null then
    raise exception 'hosted_destination_required' using errcode='CR422';
  end if;
  if length(v_place)>300 or length(v_label)>500 or length(coalesce(v_desc,''))>2000
     or length(coalesce(v_order,''))>120 then
    raise exception 'hosted_input_too_long' using errcode='CR422';
  end if;
  if p_requested_payer_type not in ('merchant','customer') then
    raise exception 'hosted_payer_invalid' using errcode='CR422';
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
  if p_customer_restricted_class not in ('none','unknown','alcohol','tobacco','vaping_nicotine','cannabis_thc','firearms','ammunition','prescription_medication','controlled_substances','fuel','compressed_gas','corrosive_hazmat','toxic_hazmat','infectious_material','regulated_dangerous_goods','fireworks','explosives','illegal_goods','stolen_goods','cash','negotiable_instruments','biological_specimens','live_animals','people') then
    raise exception 'restricted_class_invalid' using errcode='CR422';
  end if;

  insert into public.couranr_delivery_requests(
    requester_kind,business_account_id,created_by,
    idempotency_scope,idempotency_key,consumer_contact_snapshot,
    request_state,review_state,service_area_review_state,
    source,readiness_state,payer_type,
    recipient_name,recipient_phone,recipient_email,
    weight_lb,weight_band,restricted_class,additional_stops,
    timing_intent,operating_timezone,
    service_level,signature_required,proof_method,
    pickup_address,dropoff_address,normalized_request_payload
  ) values (
    'consumer',null,null,
    'consumer:hosted:'||v_intake.id::text,'hosted-request-v1',
    jsonb_strip_nulls(jsonb_build_object('name',v_name,'phone',v_phone,'email',v_email)),
    'awaiting_merchant_confirmation','not_required','pending',
    'hosted_request','not_confirmed',v_workspace.payer_default,
    v_name,v_phone,v_email,
    p_weight_lb,p_weight_band,'unknown',0,
    'asap','America/New_York',
    'standard',coalesce(p_signature_requested,false),
    case when coalesce(p_signature_requested,false) then 'signature' else 'photo_or_pin' end,
    v_workspace.pickup_address,
    jsonb_build_object(
      'googlePlaceId',v_place,
      'line2',null,
      'instructions',null,
      'displayLabel',v_label,
      'addressSource','customer_place_selection_unverified'
    ),
    jsonb_build_object(
      'hostedRequest',true,
      'hostBusinessAccountId',v_intake.host_business_account_id
    )
  )
  returning * into v_req;

  update public.couranr_hosted_request_intakes set
    request_id=v_req.id,
    order_reference=v_order,
    requested_payer_type=p_requested_payer_type,
    destination_place_id=v_place,
    destination_label=v_label,
    shipment_description=v_desc,
    customer_weight_lb=p_weight_lb,
    customer_weight_band=p_weight_band,
    customer_restricted_class=p_customer_restricted_class,
    signature_requested=coalesce(p_signature_requested,false),
    submitted_at=now(),
    last_used_at=now()
  where id=v_intake.id;

  insert into public.couranr_delivery_request_events(
    request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_req.id,null,'customer','create_hosted_delivery_request',null,
    'awaiting_merchant_confirmation',
    jsonb_build_object(
      'source','hosted_request',
      'hostBusinessAccountId',v_intake.host_business_account_id,
      'merchantValidationRequired',true,
      'paymentAllowed',false
    )
  );

  return v_req;
end
$fn$;

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

revoke all on function public.couranr_create_hosted_delivery_request(uuid,text,text,text,text,text,text,text,numeric,text,text,boolean,text)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_create_hosted_delivery_request(uuid,text,text,text,text,text,text,text,numeric,text,text,boolean,text) to service_role;

revoke all on function public.couranr_validate_hosted_delivery_request(uuid,uuid,integer,uuid,text,numeric,text,text,boolean,jsonb,jsonb,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_validate_hosted_delivery_request(uuid,uuid,integer,uuid,text,numeric,text,text,boolean,jsonb,jsonb,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,jsonb) to service_role;

commit;

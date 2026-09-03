-- =====================================================================
-- ROLLBACK — legacy arity fence (20260902220000)
--
-- Restores the pre-batch 31/33-argument routed create/estimate commands,
-- bodies VERBATIM from 20260902042602 (extracted, not retyped — the same
-- provenance as 20260902200000's rollback), plus their service_role-only
-- grants. After this rollback both arities are live again — the PREDEPLOY
-- compatibility state — so the pre-batch application can be redeployed.
--
-- ORDER: this is the FIRST database step of any application rollback after
-- cutover (restore old arity → redeploy old application SHA). It is safe to
-- run while the NEW application is serving: the new application's 37/39-key
-- calls still resolve only to the strict arity.
--
-- Idempotent: create-or-replace throughout. Grants restated unconditionally.
-- =====================================================================

begin;
set local statement_timeout = '60s';
set local lock_timeout = '10s';

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

/* ---------------------------------------------------------------- grants - */
/* pg_default_acl grants arwdDxtm to anon/authenticated/service_role on every
   function (re)created here, so each restored arity is locked down by hand. */

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

commit;

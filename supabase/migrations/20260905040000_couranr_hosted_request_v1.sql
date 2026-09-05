-- ============================================================================
-- Merchant-hosted customer requests V1 (/request/[merchantSlug])
--
-- The requester stays a Consumer (business_account_id NULL). A separate,
-- immutable host relationship tells Couranr which merchant published the
-- intake and owns validation. No quote or payment can exist before that
-- merchant validates the customer-entered delivery facts.
--
-- Paid-provider discipline: customer submit performs NO Place Details, route,
-- pricing or Stripe work. Google Place Details + Mapbox routing happen only
-- when the merchant explicitly validates the request, through the existing
-- guarded canonical provider seams.
-- ============================================================================

begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

do $guard$
begin
  if to_regclass('public.couranr_delivery_requests') is null
     or to_regclass('public.couranr_website_tool_configs') is null
     or to_regclass('public.couranr_workspace_activations') is null
     or to_regclass('public.couranr_merchant_workspaces') is null then
    raise exception 'Hosted Request V1 requires the canonical merchant/request foundation';
  end if;
  if to_regprocedure('private.couranr_append_routed_quote_version(uuid,uuid,integer,text,text,integer,integer,numeric,jsonb,jsonb,bigint,integer,integer,integer,text,text,text)') is null then
    raise exception 'Hosted Request V1 requires the canonical quote appender';
  end if;
end
$guard$;

alter table public.couranr_delivery_request_events
  drop constraint couranr_dre_command_chk;
alter table public.couranr_delivery_request_events
  add constraint couranr_dre_command_chk check (command in (
    'create_delivery_request_draft',
    'create_hosted_delivery_request',
    'calculate_delivery_request_estimate',
    'create_quote_version',
    'submit_delivery_request',
    'validate_hosted_delivery_request',
    'begin_delivery_request_review',
    'accept_delivery_request_as_quoted',
    'auto_accept_delivery_request',
    'auto_plan_delivery_request',
    'requote_delivery_request',
    'decline_delivery_request',
    'record_payer_quote_approval',
    'begin_delivery_preparation',
    'mark_delivery_ready',
    'mark_delivery_not_ready',
    'mark_delivery_unavailable',
    'cancel_delivery_request',
    'apply_promotional_credit'
  ));

create table public.couranr_hosted_request_intakes (
  id uuid primary key default gen_random_uuid(),
  host_business_account_id uuid not null
    references public.business_accounts(id) on update restrict on delete restrict,
  host_slug_snapshot text not null,
  token_hash text not null unique,
  request_id uuid unique
    references public.couranr_delivery_requests(id) on update restrict on delete restrict,

  order_reference text,
  requested_payer_type text,
  destination_place_id text,
  destination_label text,
  shipment_description text,
  customer_weight_lb numeric(8,2),
  customer_weight_band text,
  customer_restricted_class text,
  signature_requested boolean,

  expires_at timestamptz not null,
  last_used_at timestamptz not null default now(),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),

  constraint couranr_hri_slug_chk check (
    host_slug_snapshot ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    and length(host_slug_snapshot) between 1 and 120
  ),
  constraint couranr_hri_token_chk check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint couranr_hri_payer_chk check (
    requested_payer_type is null or requested_payer_type in ('merchant','customer')
  ),
  constraint couranr_hri_weight_chk check (
    (customer_weight_lb is null or customer_weight_lb > 0)
    and (customer_weight_band is null or customer_weight_band in
      ('0_25_lb','over_25_to_50_lb','over_50_lb','unknown'))
  ),
  constraint couranr_hri_restricted_chk check (
    customer_restricted_class is null or customer_restricted_class in ('none','unknown','alcohol','tobacco','vaping_nicotine','cannabis_thc','firearms','ammunition','prescription_medication','controlled_substances','fuel','compressed_gas','corrosive_hazmat','toxic_hazmat','infectious_material','regulated_dangerous_goods','fireworks','explosives','illegal_goods','stolen_goods','cash','negotiable_instruments','biological_specimens','live_animals','people')
  ),
  constraint couranr_hri_submit_pair_chk check (
    (request_id is null and submitted_at is null)
    or (request_id is not null and submitted_at is not null)
  ),
  constraint couranr_hri_expiry_chk check (expires_at > created_at)
);

create index couranr_hri_host_created_idx
  on public.couranr_hosted_request_intakes(host_business_account_id,created_at desc);

alter table public.couranr_hosted_request_intakes enable row level security;
revoke all on public.couranr_hosted_request_intakes from public,anon,authenticated;
revoke all on public.couranr_hosted_request_intakes from service_role;
grant select,insert,update on public.couranr_hosted_request_intakes to service_role;

comment on table public.couranr_hosted_request_intakes is
  'Durable merchant-host relationship and hash-only guest resume credential for /request/[merchantSlug]. Requester ownership remains Consumer; this table never becomes commercial tenancy.';

create function private.couranr_hosted_intake_identity_immutable()
returns trigger
language plpgsql security invoker set search_path=''
as $fn$
begin
  if new.host_business_account_id is distinct from old.host_business_account_id
     or new.host_slug_snapshot is distinct from old.host_slug_snapshot
     or new.token_hash is distinct from old.token_hash
     or new.expires_at is distinct from old.expires_at
     or old.request_id is not null and new.request_id is distinct from old.request_id
     or old.submitted_at is not null and new.submitted_at is distinct from old.submitted_at
     or old.request_id is not null and (
       new.order_reference is distinct from old.order_reference
       or new.requested_payer_type is distinct from old.requested_payer_type
       or new.destination_place_id is distinct from old.destination_place_id
       or new.destination_label is distinct from old.destination_label
       or new.shipment_description is distinct from old.shipment_description
       or new.customer_weight_lb is distinct from old.customer_weight_lb
       or new.customer_weight_band is distinct from old.customer_weight_band
       or new.customer_restricted_class is distinct from old.customer_restricted_class
       or new.signature_requested is distinct from old.signature_requested
     ) then
    raise exception 'hosted_intake_identity_is_immutable' using errcode='CR409';
  end if;
  return new;
end
$fn$;

create trigger couranr_hri_identity_immutable_trg
before update on public.couranr_hosted_request_intakes
for each row execute function private.couranr_hosted_intake_identity_immutable();

revoke all on function private.couranr_hosted_intake_identity_immutable()
  from public,anon,authenticated,service_role;
grant execute on function private.couranr_hosted_intake_identity_immutable()
  to service_role;

-- Only a published Website Tools config on a LIVE workspace resolves.
create function public.couranr_resolve_hosted_request_merchant(p_slug text)
returns table(
  business_account_id uuid,
  business_name text,
  slug text,
  pickup_address jsonb,
  payer_default text
)
language sql security invoker stable set search_path=''
as $fn$
  select b.id,b.name,b.slug,w.pickup_address,w.payer_default
    from public.business_accounts b
    join public.couranr_website_tool_configs c on c.business_account_id=b.id
    join public.couranr_merchant_workspaces w on w.business_account_id=b.id
    join public.couranr_workspace_activations a on a.business_account_id=b.id
   where b.slug=lower(btrim(p_slug))
     and c.status='published'
     and a.activation_state='live'
     and w.pickup_address is not null
   limit 1;
$fn$;

create function public.couranr_create_hosted_request_intake(
  p_slug text,
  p_token_hash text,
  p_ttl_minutes integer
)
returns public.couranr_hosted_request_intakes
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_host record;
  v_row public.couranr_hosted_request_intakes;
  v_slug text:=lower(btrim(coalesce(p_slug,'')));
  v_ttl integer:=least(greatest(coalesce(p_ttl_minutes,1440),5),1440);
begin
  if v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' or length(v_slug)>120 then
    raise exception 'hosted_merchant_not_found' using errcode='CR404';
  end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'hosted_token_invalid' using errcode='CR404';
  end if;

  select * into v_host from public.couranr_resolve_hosted_request_merchant(v_slug);
  if not found then
    raise exception 'hosted_merchant_not_found' using errcode='CR404';
  end if;

  insert into public.couranr_hosted_request_intakes(
    host_business_account_id,host_slug_snapshot,token_hash,expires_at
  ) values (
    v_host.business_account_id,v_slug,p_token_hash,now()+make_interval(mins=>v_ttl)
  )
  returning * into v_row;
  return v_row;
end
$fn$;

create function public.couranr_redeem_hosted_request_intake(
  p_token_hash text,
  p_slug text
)
returns public.couranr_hosted_request_intakes
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_row public.couranr_hosted_request_intakes;
  v_slug text:=lower(btrim(coalesce(p_slug,'')));
begin
  if p_token_hash !~ '^[0-9a-f]{64}$'
     or v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'hosted_request_not_found' using errcode='CR404';
  end if;

  update public.couranr_hosted_request_intakes
     set last_used_at=now()
   where token_hash=p_token_hash
     and host_slug_snapshot=v_slug
     and expires_at>now()
  returning * into v_row;

  if not found then
    raise exception 'hosted_request_not_found' using errcode='CR404';
  end if;
  return v_row;
end
$fn$;

-- Customer submit creates an UNQUOTED Consumer-owned request. The destination
-- is only a Place-ID selection until the merchant validates; coordinates,
-- mileage and money are deliberately absent here.
create function public.couranr_create_hosted_delivery_request(
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

-- Merchant validation is one CAS transaction: host authorization, canonical
-- address replacement, material fact confirmation, immutable quote mint and
-- transition into Couranr review. No browser supplies money or route evidence.
create function public.couranr_validate_hosted_delivery_request(
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

-- Hosted merchant readiness must audit the real merchant actor even though the
-- requester is Consumer. Reusing the generic requester-kind-derived helper
-- would incorrectly record this host action as a customer action.
create function private.couranr_apply_hosted_merchant_readiness(
  p_request_id uuid,
  p_host_business_account_id uuid,
  p_expected_version integer,
  p_actor_user_id uuid,
  p_command text,
  p_to text,
  p_from text[]
)
returns public.couranr_delivery_requests
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_role text;
  v_req public.couranr_delivery_requests;
  v_ob public.couranr_payment_obligations;
  v_before text;
begin
  v_role:=public.couranr_require_active_member(
    p_host_business_account_id,p_actor_user_id);
  if v_role not in ('owner','manager','dispatcher') then
    raise exception 'role_may_not_update_readiness' using errcode='CR403';
  end if;
  if not exists (
    select 1 from public.couranr_hosted_request_intakes
     where request_id=p_request_id
       and host_business_account_id=p_host_business_account_id
  ) then
    raise exception 'request_not_found' using errcode='CR404';
  end if;

  select * into v_req from public.couranr_delivery_requests
   where id=p_request_id and requester_kind='consumer'
     and business_account_id is null and source='hosted_request'
   for update;
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
    v_req.id,p_actor_user_id,'merchant',p_command,v_before,p_to,
    jsonb_build_object(
      'readinessFrom',v_before,
      'readinessTo',p_to,
      'readinessMeaning','pickup',
      'requestState',v_req.request_state,
      'quoteVersionId',v_req.current_quote_version_id,
      'hostBusinessAccountId',p_host_business_account_id
    )
  );
  return v_req;
end
$fn$;

create function public.couranr_begin_hosted_delivery_preparation(
  p_request_id uuid,p_host_business_account_id uuid,p_expected_version integer,p_actor_user_id uuid
)
returns public.couranr_delivery_requests
language sql security invoker set search_path=''
as $fn$
  select private.couranr_apply_hosted_merchant_readiness(
    p_request_id,p_host_business_account_id,p_expected_version,p_actor_user_id,
    'begin_delivery_preparation','preparing',
    array['not_confirmed','not_ready','unavailable','ready']);
$fn$;

create function public.couranr_mark_hosted_delivery_ready(
  p_request_id uuid,p_host_business_account_id uuid,p_expected_version integer,p_actor_user_id uuid
)
returns public.couranr_delivery_requests
language sql security invoker set search_path=''
as $fn$
  select private.couranr_apply_hosted_merchant_readiness(
    p_request_id,p_host_business_account_id,p_expected_version,p_actor_user_id,
    'mark_delivery_ready','ready',
    array['not_confirmed','preparing','not_ready','unavailable']);
$fn$;

create function public.couranr_mark_hosted_delivery_not_ready(
  p_request_id uuid,p_host_business_account_id uuid,p_expected_version integer,p_actor_user_id uuid
)
returns public.couranr_delivery_requests
language sql security invoker set search_path=''
as $fn$
  select private.couranr_apply_hosted_merchant_readiness(
    p_request_id,p_host_business_account_id,p_expected_version,p_actor_user_id,
    'mark_delivery_not_ready','not_ready',
    array['not_confirmed','preparing','ready']);
$fn$;

create function public.couranr_mark_hosted_delivery_unavailable(
  p_request_id uuid,p_host_business_account_id uuid,p_expected_version integer,p_actor_user_id uuid
)
returns public.couranr_delivery_requests
language sql security invoker set search_path=''
as $fn$
  select private.couranr_apply_hosted_merchant_readiness(
    p_request_id,p_host_business_account_id,p_expected_version,p_actor_user_id,
    'mark_delivery_unavailable','unavailable',
    array['not_confirmed','preparing','not_ready','ready']);
$fn$;

-- Source-aware consumer review ordering. Same Day remains payment-before-review;
-- hosted requests are merchant-validation-before-payment.
create or replace function public.couranr_try_auto_accept_standard_request(
  p_request_id uuid
)
returns public.couranr_delivery_requests
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_quote public.couranr_quote_versions;
  v_submit jsonb;
  v_target text;
  v_lane_reason text;
begin
  select * into v_req from public.couranr_delivery_requests
   where id=p_request_id for update;
  if not found then raise exception 'request_not_found' using errcode='CR404'; end if;

  if v_req.request_state<>'pending_couranr_review' or v_req.review_state<>'pending' then
    return v_req;
  end if;

  v_lane_reason:=private.couranr_automatic_lane_reason(v_req.id);
  if v_lane_reason is not null then return v_req; end if;

  select * into v_quote from public.couranr_quote_versions
   where id=v_req.current_quote_version_id and request_id=v_req.id;
  if not found then return v_req; end if;

  if v_req.requester_kind='consumer' and v_req.source='consumer_send' then
    -- CAP-001 is preserved for Same Day: the consumer authorizes first, then
    -- the standard lane can be accepted automatically.
    if not private.couranr_quote_payer_approved(v_quote) then return v_req; end if;
    v_target:='confirmed';
  elsif v_req.requester_kind='consumer' and v_req.source='hosted_request' then
    -- Hosted requests invert ONLY the validation/payment order: the host
    -- merchant has already validated the customer-entered order before this
    -- row enters review. Couranr may accept service now, but the real payer
    -- still owns price approval. If payment was already approved by a retry
    -- race, converge to confirmed; otherwise wait for the payer.
    if private.couranr_quote_payer_approved(v_quote) then
      v_target:='confirmed';
    else
      if private.couranr_quote_version_is_expired(v_quote) then return v_req; end if;
      v_target:='awaiting_quote_acceptance';
    end if;
  elsif v_req.requester_kind='consumer' then
    -- Unknown future consumer origins fail closed instead of inheriting one
    -- funnel's commercial ordering.
    return v_req;
  elsif v_quote.payer_type='customer' then
    -- Couranr accepts service; the real customer still approves the amount.
    if private.couranr_quote_version_is_expired(v_quote) then return v_req; end if;
    v_target:='awaiting_quote_acceptance';
  else
    select metadata into v_submit
      from public.couranr_delivery_request_events
     where request_id=v_req.id and command='submit_delivery_request'
     order by created_at desc limit 1;

    if v_submit is not null
       and coalesce((v_submit->>'acknowledgment')::boolean,false)
       and (v_submit->>'quoteVersionId') is not distinct from v_quote.id::text then
      if private.couranr_quote_version_is_expired(v_quote) then return v_req; end if;
      v_target:='confirmed';
    else
      -- Service can be accepted, but the business still owns price approval.
      if private.couranr_quote_version_is_expired(v_quote) then return v_req; end if;
      v_target:='awaiting_quote_acceptance';
    end if;
  end if;

  update public.couranr_delivery_requests
     set request_state=v_target,
         review_state='accepted_as_quoted',
         version=version+1,
         updated_at=now()
   where id=v_req.id
     and version=v_req.version
     and request_state='pending_couranr_review'
     and review_state='pending'
  returning * into v_req;

  if not found then
    select * into v_req from public.couranr_delivery_requests where id=p_request_id;
    return v_req;
  end if;

  insert into public.couranr_delivery_request_events(
    request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_req.id,null,'system','auto_accept_delivery_request',
    'pending_couranr_review',v_target,
    jsonb_build_object(
      'quoteVersionId',v_quote.id,
      'quoteNumber',v_quote.quote_number,
      'payerType',v_quote.payer_type,
      'reviewState','accepted_as_quoted',
      'quoteChanged',false,
      'automaticLane',true,
      'payerApprovalPending',v_target='awaiting_quote_acceptance'
    )
  );

  perform public.couranr_resolve_automation_exception(v_req.id,'review');
  return v_req;
end
$fn$;

-- Operations review follows the same distinction for manual-review/requote
-- cases: hosted service may be accepted before the real payer approves.
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
  v_submit_actor text;
  v_target text;
  v_operations_assisted boolean := false;
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

  if v_req.requester_kind='consumer' and v_req.source='hosted_request' then
    -- The host merchant validated the order BEFORE Couranr review. Operations
    -- may accept the service without impersonating the payer. The exact quote
    -- remains awaiting the real customer or merchant payer unless it was
    -- already approved in a concurrent retry.
    if private.couranr_quote_payer_approved(v_quote) then
      v_target:='confirmed';
    else
      if private.couranr_quote_version_is_expired(v_quote) then
        raise exception 'quote_expired' using errcode='CR410';
      end if;
      v_target:='awaiting_quote_acceptance';
    end if;
  elsif v_req.requester_kind='consumer' then
    if private.couranr_quote_payer_approved(v_quote) then
      v_target:='confirmed';
    else
      raise exception 'consumer_quote_not_payer_approved' using errcode='CR409';
    end if;
  elsif v_quote.payer_type='merchant' then
    select metadata, actor_type into v_ack, v_submit_actor
      from public.couranr_delivery_request_events
     where request_id=v_req.id and command='submit_delivery_request'
     order by created_at desc limit 1;

    if v_ack is not null
       and coalesce((v_ack->>'acknowledgment')::boolean,false) is true then
      if (v_ack->>'quoteVersionId') is distinct from v_quote.id::text then
        raise exception 'quote_revised_since_acknowledgment' using errcode='CR412';
      end if;
      v_target:='confirmed';
    elsif v_req.source='operations'
       and v_submit_actor='operations'
       and v_ack is not null
       and (v_ack->>'quoteVersionId') is not distinct from v_quote.id::text then
      /*
       * Couranr may approve SERVICE, but it may not approve the merchant's
       * price. Leave the exact immutable quote waiting for the real Business
       * payer to authorize it through the existing payment path.
       *
       * Because that approval has not happened yet, the 15-minute commercial
       * window still applies now. Refusing before the state transition keeps
       * the request in review where Operations can mint Quote N+1.
       */
      if private.couranr_quote_version_is_expired(v_quote) then
        raise exception 'quote_expired' using errcode='CR410';
      end if;
      v_operations_assisted:=true;
      v_target:='awaiting_quote_acceptance';
    else
      raise exception 'merchant_acknowledgment_missing' using errcode='CR412';
    end if;
  else
    v_target:='awaiting_quote_acceptance';
  end if;

  if v_target='confirmed'
     and private.couranr_quote_version_is_expired(v_quote) then
    raise exception 'quote_expired' using errcode='CR410';
  end if;

  update public.couranr_delivery_requests set
    request_state=v_target,review_state='accepted_as_quoted',
    version=p_expected_version+1,updated_at=now()
  where id=v_req.id and version=p_expected_version
    and request_state='pending_couranr_review' and review_state='pending'
  returning * into v_req;
  if not found then
    raise exception 'version_or_state_conflict' using errcode='CR409';
  end if;

  insert into public.couranr_delivery_request_events(
    request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_req.id,p_actor_user_id,'operations','accept_delivery_request_as_quoted',
    'pending_couranr_review',v_target,
    jsonb_build_object(
      'quoteVersionId',v_quote.id,
      'quoteNumber',v_quote.quote_number,
      'payerType',v_quote.payer_type,
      'reviewState','accepted_as_quoted',
      'quoteChanged',false,
      'operationsAssisted',v_operations_assisted,
      'payerApprovalPending',v_target='awaiting_quote_acceptance'
    )
  );
  return v_req;
end
$fn$;

-- Explicit grants. pg_default_acl in this project is permissive for new public
-- functions, so every new entrypoint is closed to browser database roles.
revoke all on function public.couranr_resolve_hosted_request_merchant(text)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_resolve_hosted_request_merchant(text) to service_role;

revoke all on function public.couranr_create_hosted_request_intake(text,text,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_create_hosted_request_intake(text,text,integer) to service_role;

revoke all on function public.couranr_redeem_hosted_request_intake(text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_redeem_hosted_request_intake(text,text) to service_role;

revoke all on function public.couranr_create_hosted_delivery_request(
  uuid,text,text,text,text,text,text,text,numeric,text,text,boolean,text
) from public,anon,authenticated,service_role;
grant execute on function public.couranr_create_hosted_delivery_request(
  uuid,text,text,text,text,text,text,text,numeric,text,text,boolean,text
) to service_role;

revoke all on function public.couranr_validate_hosted_delivery_request(
  uuid,uuid,integer,uuid,text,numeric,text,text,boolean,jsonb,jsonb,
  bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,jsonb
) from public,anon,authenticated,service_role;
grant execute on function public.couranr_validate_hosted_delivery_request(
  uuid,uuid,integer,uuid,text,numeric,text,text,boolean,jsonb,jsonb,
  bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,jsonb
) to service_role;

revoke all on function private.couranr_apply_hosted_merchant_readiness(
  uuid,uuid,integer,uuid,text,text,text[]
) from public,anon,authenticated,service_role;
grant execute on function private.couranr_apply_hosted_merchant_readiness(
  uuid,uuid,integer,uuid,text,text,text[]
) to service_role;

revoke all on function public.couranr_begin_hosted_delivery_preparation(uuid,uuid,integer,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.couranr_mark_hosted_delivery_ready(uuid,uuid,integer,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.couranr_mark_hosted_delivery_not_ready(uuid,uuid,integer,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.couranr_mark_hosted_delivery_unavailable(uuid,uuid,integer,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_begin_hosted_delivery_preparation(uuid,uuid,integer,uuid) to service_role;
grant execute on function public.couranr_mark_hosted_delivery_ready(uuid,uuid,integer,uuid) to service_role;
grant execute on function public.couranr_mark_hosted_delivery_not_ready(uuid,uuid,integer,uuid) to service_role;
grant execute on function public.couranr_mark_hosted_delivery_unavailable(uuid,uuid,integer,uuid) to service_role;

-- Reassert the existing replacement functions' service-only posture.
revoke all on function public.couranr_try_auto_accept_standard_request(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_try_auto_accept_standard_request(uuid) to service_role;
revoke all on function public.couranr_accept_delivery_request_as_quoted(uuid,uuid,integer,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_accept_delivery_request_as_quoted(uuid,uuid,integer,uuid) to service_role;

commit;

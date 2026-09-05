-- ============================================================================
-- Merchant-hosted customer request flow (/request/[merchantSlug])
--
-- A hosted request is still CONSUMER-owned request identity:
-- requester_kind='consumer', business_account_id IS NULL.  The merchant that
-- hosts and validates the intake is a separate durable relationship in
-- couranr_hosted_request_intakes.  This preserves Foundation Gate A instead of
-- inventing a fake requester tenancy.
--
-- No quote and no payment can exist before the host merchant validates the
-- request.  Validation is one CAS command that writes canonical route/shipment
-- facts, appends the immutable quote, and only then opens the payer/review path.
-- ============================================================================
begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

create table if not exists public.couranr_hosted_request_intakes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique
    references public.couranr_delivery_requests(id) on update cascade on delete restrict,
  guest_session_id uuid not null unique
    references public.couranr_consumer_guest_sessions(id) on update cascade on delete restrict,
  host_business_account_id uuid not null
    references public.business_accounts(id) on update cascade on delete restrict,

  order_reference text not null,
  dropoff_place_id text not null,
  dropoff_display_text text not null,
  shipment_description text not null,
  requested_payer_type text not null,

  intake_state text not null default 'awaiting_merchant_confirmation',
  validated_by uuid null references auth.users(id) on update cascade on delete restrict,
  validated_at timestamptz null,
  declined_by uuid null references auth.users(id) on update cascade on delete restrict,
  declined_at timestamptz null,
  decline_reason text null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint couranr_hri_order_reference_chk
    check (length(btrim(order_reference)) between 1 and 120),
  constraint couranr_hri_dropoff_place_chk
    check (length(btrim(dropoff_place_id)) between 1 and 512),
  constraint couranr_hri_dropoff_display_chk
    check (length(btrim(dropoff_display_text)) between 1 and 500),
  constraint couranr_hri_description_chk
    check (length(btrim(shipment_description)) between 1 and 2000),
  constraint couranr_hri_requested_payer_chk
    check (requested_payer_type in ('merchant','customer')),
  constraint couranr_hri_state_chk
    check (intake_state in ('awaiting_merchant_confirmation','validated','declined')),
  constraint couranr_hri_decline_reason_chk
    check (decline_reason is null or decline_reason in
      ('order_not_found','details_do_not_match','merchant_cannot_fulfill')),
  constraint couranr_hri_terminal_evidence_chk check (
    (intake_state='awaiting_merchant_confirmation'
      and validated_by is null and validated_at is null
      and declined_by is null and declined_at is null and decline_reason is null)
    or
    (intake_state='validated'
      and validated_by is not null and validated_at is not null
      and declined_by is null and declined_at is null and decline_reason is null)
    or
    (intake_state='declined'
      and declined_by is not null and declined_at is not null and decline_reason is not null
      and validated_by is null and validated_at is null)
  )
);

create index if not exists couranr_hri_host_created_idx
  on public.couranr_hosted_request_intakes(host_business_account_id,created_at desc);

alter table public.couranr_hosted_request_intakes enable row level security;
revoke all on table public.couranr_hosted_request_intakes from public,anon,authenticated;
grant select,insert,update on table public.couranr_hosted_request_intakes to service_role;

-- The append-only request event vocabulary gains only the three named hosted
-- commands.  Existing automatic/payment/readiness commands are preserved.
alter table public.couranr_delivery_request_events
  drop constraint if exists couranr_dre_command_chk;
alter table public.couranr_delivery_request_events
  add constraint couranr_dre_command_chk check (command in (
    'create_delivery_request_draft','calculate_delivery_request_estimate','create_quote_version',
    'submit_delivery_request','begin_delivery_request_review',
    'accept_delivery_request_as_quoted','auto_accept_delivery_request','auto_plan_delivery_request',
    'requote_delivery_request','decline_delivery_request','record_payer_quote_approval',
    'begin_delivery_preparation','mark_delivery_ready','mark_delivery_not_ready',
    'mark_delivery_unavailable','cancel_delivery_request','apply_promotional_credit',
    'create_hosted_delivery_request','validate_hosted_delivery_request',
    'decline_hosted_delivery_request'
  ));

create or replace function public.couranr_create_hosted_delivery_request(
  p_guest_session_id uuid,
  p_merchant_slug text,
  p_idempotency_key text,
  p_order_reference text,
  p_contact jsonb,
  p_dropoff_place_id text,
  p_dropoff_display_text text,
  p_shipment_description text,
  p_weight_lb numeric,
  p_weight_band text,
  p_restricted_class text,
  p_signature_required boolean,
  p_requested_payer_type text
)
returns public.couranr_delivery_requests
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_ses public.couranr_consumer_guest_sessions;
  v_req public.couranr_delivery_requests;
  v_host uuid;
  v_scope text;
  v_contact jsonb;
  v_ref text;
  v_desc text;
  v_place text;
  v_display text;
begin
  -- A public URL is eligible only while ALL three authorities agree:
  -- active account + published website tool + live Couranr activation.
  select b.id into v_host
    from public.business_accounts b
    join public.couranr_website_tool_configs wt
      on wt.business_account_id=b.id and wt.status='published'
    join public.couranr_workspace_activations a
      on a.business_account_id=b.id and a.activation_state='live'
    join public.couranr_merchant_workspaces w
      on w.business_account_id=b.id
   where lower(b.slug)=lower(btrim(coalesce(p_merchant_slug,'')))
     and b.status='active'
   limit 1;
  if v_host is null then
    raise exception 'hosted_request_not_available' using errcode='CR404';
  end if;

  select s.* into v_ses
    from public.couranr_consumer_guest_sessions s
   where s.id=p_guest_session_id
   for update;
  if not found or v_ses.revoked_at is not null or v_ses.expires_at<=now() then
    raise exception 'guest_session_not_available' using errcode='CR404';
  end if;
  v_scope := 'consumer:' || v_ses.id::text;

  -- One guest session = one request. A network retry with the same key
  -- converges; reusing the token for another merchant/request is refused.
  if v_ses.request_id is not null then
    select r.* into v_req
      from public.couranr_delivery_requests r
      join public.couranr_hosted_request_intakes h on h.request_id=r.id
     where r.id=v_ses.request_id
       and r.idempotency_scope=v_scope
       and r.idempotency_key=p_idempotency_key
       and h.guest_session_id=v_ses.id
       and h.host_business_account_id=v_host;
    if found then return v_req; end if;
    raise exception 'guest_session_already_bound' using errcode='CR409';
  end if;

  if p_contact is null or jsonb_typeof(p_contact) is distinct from 'object' then
    raise exception 'consumer_contact_must_be_object' using errcode='CR422';
  end if;
  v_contact := jsonb_strip_nulls(jsonb_build_object(
    'name',nullif(btrim(coalesce(p_contact->>'name','')),''),
    'phone',nullif(btrim(coalesce(p_contact->>'phone','')),''),
    'email',nullif(btrim(coalesce(p_contact->>'email','')),'')
  ));
  -- Requester identity freezes at insert. Do not create an unrecoverable
  -- contactless request that could never leave the merchant-confirmation gate.
  if nullif(v_contact->>'phone','') is null and nullif(v_contact->>'email','') is null then
    raise exception 'consumer_contact_required' using errcode='CR422';
  end if;

  v_ref:=btrim(coalesce(p_order_reference,''));
  v_desc:=btrim(coalesce(p_shipment_description,''));
  v_place:=btrim(coalesce(p_dropoff_place_id,''));
  v_display:=btrim(coalesce(p_dropoff_display_text,''));
  if length(v_ref) not between 1 and 120 then
    raise exception 'order_reference_invalid' using errcode='CR422';
  end if;
  if length(v_desc) not between 1 and 2000 then
    raise exception 'shipment_description_invalid' using errcode='CR422';
  end if;
  if length(v_place) not between 1 and 512 or length(v_display) not between 1 and 500 then
    raise exception 'dropoff_place_invalid' using errcode='CR422';
  end if;
  if p_weight_lb is null and p_weight_band is null then
    raise exception 'weight_or_band_required' using errcode='CR422';
  end if;
  if p_weight_lb is not null and p_weight_lb<=0 then
    raise exception 'weight_must_be_positive' using errcode='CR422';
  end if;
  if p_weight_lb is not null and p_weight_band is not null then
    raise exception 'weight_exact_or_band_not_both' using errcode='CR422';
  end if;
  if p_weight_band is not null
     and p_weight_band not in ('0_25_lb','over_25_to_50_lb','over_50_lb','unknown') then
    raise exception 'weight_band_invalid' using errcode='CR422';
  end if;
  if p_restricted_class is null or p_restricted_class not in (
      'none','unknown','alcohol','tobacco','vaping_nicotine','cannabis_thc',
      'firearms','ammunition','prescription_medication','controlled_substances',
      'fuel','compressed_gas','corrosive_hazmat','toxic_hazmat',
      'infectious_material','regulated_dangerous_goods','fireworks','explosives',
      'illegal_goods','stolen_goods','cash','negotiable_instruments',
      'biological_specimens','live_animals','people') then
    raise exception 'restricted_class_invalid' using errcode='CR422';
  end if;
  if p_requested_payer_type not in ('merchant','customer') then
    raise exception 'payer_type_invalid' using errcode='CR422';
  end if;
  if p_signature_required is null then
    raise exception 'signature_choice_required' using errcode='CR422';
  end if;

  begin
    insert into public.couranr_delivery_requests(
      requester_kind,business_account_id,created_by,
      idempotency_scope,idempotency_key,consumer_contact_snapshot,
      request_state,review_state,service_area_review_state,
      source,readiness_state,payer_type,
      recipient_name,recipient_phone,recipient_email,
      loaded_miles,weight_lb,weight_band,restricted_class,additional_stops,
      timing_intent,requested_pickup_local,operating_timezone,
      requested_departure_at,timing_review_reasons,
      service_level,signature_required,proof_method,
      pickup_address,dropoff_address,normalized_request_payload,
      quote_status,quote_line_items,review_reasons,
      rounding_applied,tax_included,payment_due_cents
    ) values (
      'consumer',null,null,
      v_scope,p_idempotency_key,v_contact,
      'awaiting_merchant_confirmation','not_required','pending',
      'hosted_request','not_confirmed',p_requested_payer_type,
      nullif(v_contact->>'name',''),nullif(v_contact->>'phone',''),nullif(v_contact->>'email',''),
      null,p_weight_lb,p_weight_band,p_restricted_class,0,
      'asap',null,'America/New_York',
      null,'[]'::jsonb,
      'standard',p_signature_required,'photo_or_pin',
      null,null,
      jsonb_build_object(
        'consumerDescription',v_desc,
        'overnightRequested',false,
        'hostedRequest',jsonb_build_object('orderReference',v_ref)
      ),
      'not_quoted','[]'::jsonb,'[]'::jsonb,
      false,false,null
    ) returning * into v_req;
  exception when unique_violation then
    select r.* into v_req
      from public.couranr_delivery_requests r
      join public.couranr_hosted_request_intakes h on h.request_id=r.id
     where r.idempotency_scope=v_scope
       and r.idempotency_key=p_idempotency_key
       and h.host_business_account_id=v_host;
    if not found then raise; end if;
    update public.couranr_consumer_guest_sessions
       set request_id=v_req.id,last_used_at=now()
     where id=v_ses.id and request_id is null;
    return v_req;
  end;

  insert into public.couranr_hosted_request_intakes(
    request_id,guest_session_id,host_business_account_id,
    order_reference,dropoff_place_id,dropoff_display_text,
    shipment_description,requested_payer_type
  ) values (
    v_req.id,v_ses.id,v_host,v_ref,v_place,v_display,v_desc,p_requested_payer_type
  );

  update public.couranr_consumer_guest_sessions
     set request_id=v_req.id,last_used_at=now()
   where id=v_ses.id and request_id is null;
  if not found then
    raise exception 'guest_session_already_bound' using errcode='CR409';
  end if;

  insert into public.couranr_delivery_request_events(
    request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_req.id,null,'customer','create_hosted_delivery_request',null,
    'awaiting_merchant_confirmation',
    jsonb_build_object(
      'hostBusinessAccountId',v_host,
      'requestedPayerType',p_requested_payer_type,
      'commercialState','not_quoted'
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
  p_timing_intent text,
  p_requested_pickup_local text,
  p_requested_departure_at timestamptz,
  p_timing_review_reasons jsonb
)
returns public.couranr_delivery_requests
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_intake public.couranr_hosted_request_intakes;
  v_quote public.couranr_quote_versions;
  v_loaded numeric(10,3);
  v_target text;
begin
  if not exists (
    select 1 from public.business_members m
     where m.business_account_id=p_host_business_account_id
       and m.user_id=p_actor_user_id and m.status='active'
       and m.role in ('owner','manager','dispatcher')
  ) then
    raise exception 'merchant_write_access_required' using errcode='CR403';
  end if;
  if not exists (
    select 1 from public.business_accounts b
    join public.couranr_workspace_activations a on a.business_account_id=b.id
     where b.id=p_host_business_account_id and b.status='active'
       and a.activation_state='live'
  ) then
    raise exception 'merchant_not_live' using errcode='CR409';
  end if;

  select h.* into v_intake
    from public.couranr_hosted_request_intakes h
   where h.request_id=p_request_id
     and h.host_business_account_id=p_host_business_account_id
   for update;
  if not found then raise exception 'request_not_found' using errcode='CR404'; end if;

  select r.* into v_req from public.couranr_delivery_requests r
   where r.id=p_request_id
     and r.requester_kind='consumer'
     and r.business_account_id is null
     and r.source='hosted_request'
   for update;
  if not found then raise exception 'request_not_found' using errcode='CR404'; end if;

  -- Retry-safe after a lost response. Never remint Quote N+1 on a replay.
  if v_intake.intake_state='validated' then return v_req; end if;
  if v_intake.intake_state='declined' then
    raise exception 'hosted_request_already_declined' using errcode='CR409';
  end if;
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
  if p_weight_lb is not null and p_weight_band is not null then
    raise exception 'weight_exact_or_band_not_both' using errcode='CR422';
  end if;
  if p_weight_band is not null
     and p_weight_band not in ('0_25_lb','over_25_to_50_lb','over_50_lb','unknown') then
    raise exception 'weight_band_invalid' using errcode='CR422';
  end if;
  if p_signature_required is null then
    raise exception 'signature_choice_required' using errcode='CR422';
  end if;
  if p_timing_intent is distinct from 'asap' or p_requested_pickup_local is not null then
    raise exception 'hosted_request_asap_only' using errcode='CR422';
  end if;
  if nullif(btrim(coalesce(v_req.consumer_contact_snapshot->>'phone','')),'') is null
     and nullif(btrim(coalesce(v_req.consumer_contact_snapshot->>'email','')),'') is null then
    raise exception 'consumer_contact_required' using errcode='CR422';
  end if;
  perform private.couranr_assert_safety_declaration(p_restricted_class,p_quote_status);

  if p_route_distance_meters is null then v_loaded:=null;
  else v_loaded:=round(p_route_distance_meters::numeric/1609.344,3);
  end if;

  -- One CAS generation for the WHOLE validation command. The private appender
  -- locks this same row and records the immutable quote against this generation.
  update public.couranr_delivery_requests set
    payer_type=p_payer_type,
    weight_lb=p_weight_lb,weight_band=p_weight_band,
    restricted_class=p_restricted_class,
    signature_required=p_signature_required,
    pickup_address=p_pickup_address,dropoff_address=p_dropoff_address,
    loaded_miles=v_loaded,
    service_area_review_state=case
      when p_serviceability_outcome='available_for_request' then 'in_area'
      when p_route_review_reason='market_needs_review' then 'out_of_area_review'
      else 'pending' end,
    timing_intent=p_timing_intent,
    requested_pickup_local=p_requested_pickup_local,
    operating_timezone='America/New_York',
    requested_departure_at=p_requested_departure_at,
    timing_review_reasons=coalesce(p_timing_review_reasons,'[]'::jsonb),
    normalized_request_payload=
      (coalesce(normalized_request_payload,'{}'::jsonb)-'route')
      || jsonb_build_object('route',jsonb_build_object(
           'serviceabilityOutcome',p_serviceability_outcome,
           'distanceSource',p_distance_source,
           'reviewReason',p_route_review_reason)),
    version=p_expected_version+1,updated_at=now()
  where id=v_req.id and version=p_expected_version
    and request_state='awaiting_merchant_confirmation'
  returning * into v_req;
  if not found then raise exception 'version_or_state_conflict' using errcode='CR409'; end if;

  v_quote:=private.couranr_append_routed_quote_version(
    v_req.id,p_actor_user_id,v_req.version,
    p_quote_status,p_pricing_policy_version,p_delivery_subtotal_cents,
    p_included_loaded_miles,p_billable_loaded_miles,p_quote_line_items,p_review_reasons,
    p_route_distance_meters,p_route_duration_seconds,p_route_static_duration_seconds,
    p_route_traffic_delay_seconds,p_distance_source,p_serviceability_outcome,p_route_review_reason
  );

  -- There is intentionally no payment command above this line.
  -- Estimated => payer approval next; unpriced review => Couranr review next.
  if v_quote.quote_status='estimated' then
    v_target:='awaiting_quote_acceptance';
  elsif v_quote.quote_status='manual_review_required' then
    v_target:='pending_couranr_review';
  else
    raise exception 'invalid_hosted_request_cannot_be_validated' using errcode='CR422';
  end if;

  update public.couranr_delivery_requests set
    request_state=v_target,review_state='pending',submitted_at=now(),updated_at=now()
  where id=v_req.id and version=v_req.version
  returning * into v_req;
  if not found then raise exception 'version_or_state_conflict' using errcode='CR409'; end if;

  update public.couranr_hosted_request_intakes set
    intake_state='validated',validated_by=p_actor_user_id,validated_at=now(),updated_at=now()
  where id=v_intake.id and intake_state='awaiting_merchant_confirmation';

  insert into public.couranr_delivery_request_events(
    request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_req.id,p_actor_user_id,'merchant','validate_hosted_delivery_request',
    'awaiting_merchant_confirmation',v_target,
    jsonb_build_object(
      'hostBusinessAccountId',p_host_business_account_id,
      'quoteVersionId',v_quote.id,'quoteNumber',v_quote.quote_number,
      'quoteStatus',v_quote.quote_status,'payerType',v_quote.payer_type,
      'reviewReasons',v_quote.review_reasons
    )
  );
  return v_req;
end
$fn$;

create or replace function public.couranr_decline_hosted_delivery_request(
  p_request_id uuid,
  p_host_business_account_id uuid,
  p_expected_version integer,
  p_actor_user_id uuid,
  p_reason text
)
returns public.couranr_delivery_requests
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_intake public.couranr_hosted_request_intakes;
begin
  if p_reason not in ('order_not_found','details_do_not_match','merchant_cannot_fulfill') then
    raise exception 'hosted_decline_reason_invalid' using errcode='CR422';
  end if;
  if not exists (
    select 1 from public.business_members m
     where m.business_account_id=p_host_business_account_id
       and m.user_id=p_actor_user_id and m.status='active'
       and m.role in ('owner','manager','dispatcher')
  ) then
    raise exception 'merchant_write_access_required' using errcode='CR403';
  end if;

  select h.* into v_intake
    from public.couranr_hosted_request_intakes h
   where h.request_id=p_request_id
     and h.host_business_account_id=p_host_business_account_id
   for update;
  if not found then raise exception 'request_not_found' using errcode='CR404'; end if;
  select r.* into v_req from public.couranr_delivery_requests r
   where r.id=p_request_id and r.requester_kind='consumer'
     and r.business_account_id is null and r.source='hosted_request'
   for update;
  if not found then raise exception 'request_not_found' using errcode='CR404'; end if;

  if v_intake.intake_state='declined' and v_req.request_state='declined' then
    return v_req;
  end if;
  if v_intake.intake_state='validated' then
    raise exception 'hosted_request_already_validated' using errcode='CR409';
  end if;
  if v_req.version is distinct from p_expected_version
     or v_req.request_state<>'awaiting_merchant_confirmation'
     or v_req.current_quote_version_id is not null then
    raise exception 'version_or_state_conflict' using errcode='CR409';
  end if;

  update public.couranr_delivery_requests set
    request_state='declined',review_state='declined',submitted_at=now(),
    version=p_expected_version+1,updated_at=now()
  where id=v_req.id and version=p_expected_version
  returning * into v_req;
  if not found then raise exception 'version_or_state_conflict' using errcode='CR409'; end if;

  update public.couranr_hosted_request_intakes set
    intake_state='declined',declined_by=p_actor_user_id,declined_at=now(),
    decline_reason=p_reason,updated_at=now()
  where id=v_intake.id and intake_state='awaiting_merchant_confirmation';

  insert into public.couranr_delivery_request_events(
    request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_req.id,p_actor_user_id,'merchant','decline_hosted_delivery_request',
    'awaiting_merchant_confirmation','declined',
    jsonb_build_object('hostBusinessAccountId',p_host_business_account_id,'reason',p_reason)
  );
  return v_req;
end
$fn$;

revoke all on function public.couranr_create_hosted_delivery_request(
  uuid,text,text,text,jsonb,text,text,text,numeric,text,text,boolean,text
) from public,anon,authenticated;
grant execute on function public.couranr_create_hosted_delivery_request(
  uuid,text,text,text,jsonb,text,text,text,numeric,text,text,boolean,text
) to service_role;

revoke all on function public.couranr_validate_hosted_delivery_request(
  uuid,uuid,integer,uuid,text,numeric,text,text,boolean,jsonb,jsonb,
  bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,
  text,text,timestamptz,jsonb
) from public,anon,authenticated;
grant execute on function public.couranr_validate_hosted_delivery_request(
  uuid,uuid,integer,uuid,text,numeric,text,text,boolean,jsonb,jsonb,
  bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,
  text,text,timestamptz,jsonb
) to service_role;

revoke all on function public.couranr_decline_hosted_delivery_request(
  uuid,uuid,integer,uuid,text
) from public,anon,authenticated;
grant execute on function public.couranr_decline_hosted_delivery_request(
  uuid,uuid,integer,uuid,text
) to service_role;

commit;

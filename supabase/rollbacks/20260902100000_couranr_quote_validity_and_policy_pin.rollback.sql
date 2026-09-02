-- =====================================================================
-- ROLLBACK — quote validity (QVL-001) and pricing policy pin (PRC-007)
--
-- Purely behavioural: this batch added no column, no constraint and no row,
-- so there is nothing here that can destroy evidence and nothing to refuse
-- over. It restores the eight PRE-QVL bodies verbatim from the migrations
-- that defined them, extracted rather than retyped so they cannot drift, and
-- drops the two predicates last.
--
-- WHAT ROLLING BACK COSTS, stated plainly: quotes stop expiring, the customer
-- authorization boundary stops checking the window, and minting falls back to
-- denying only the superseded V1 identifier. Approvals and authorizations
-- already recorded are unaffected either way - nothing here reads or writes
-- commercial evidence.
--
-- ORDER MATTERS IF THE APPLICATION HAS ALREADY SHIPPED. This removes
-- public.couranr_obligation_quote_expired and the 9-argument apply command,
-- both of which PR #40's application calls BY NAME - supabaseAdmin.rpc() posts
-- named arguments and PostgREST resolves overloads by argument name, so a
-- p_authorized_at key would no longer match anything. If that application is
-- live, roll the APPLICATION back first, then run this. Rolling this back
-- under the new application turns PaymentIntent reuse and every webhook
-- application into a PGRST202.
--
-- ONE DELIBERATE NON-RESTORATION. couranr_redeem_payment_access_token comes
-- back as the ALIASED body from 20260731234500, not as the body that is live
-- in production today. Production's current copy is m4's, which lost the alias
-- and raises 42702 on every call - token redemption is dead there right now.
-- Restoring a function that is known to be broken would be fidelity to the
-- wrong thing, so this restores the last body that actually worked.
--
-- Idempotent: every statement is create-or-replace or drop-if-exists, so a
-- second run is a clean no-op rather than "function already exists".
-- =====================================================================

begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

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

create or replace function public.couranr_submit_delivery_request_v2(
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
  /* ALIASED even on the rollback path. `returns table (… request_id …)` makes
     that an OUT parameter, so the unaliased form raises 42702 on EVERY call -
     migration 20260731234500 exists solely to fix it and the Gate A cutover
     reintroduced it. Rolling QVL-001 back must not also roll back a bug fix
     that has nothing to do with quote validity. */
  select o.* into v_ob from public.couranr_payment_obligations o
   where o.id=v_tok.obligation_id and o.request_id=v_req.id and o.payment_state<>'cancelled';
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

create or replace function public.couranr_attach_payment_intent(
  p_obligation_id     uuid,
  p_expected_version  integer,
  p_payment_intent_id text
)
returns public.couranr_payment_obligations
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_ob public.couranr_payment_obligations;
begin
  if p_payment_intent_id is null or length(btrim(p_payment_intent_id)) = 0 then
    raise exception 'payment_intent_id_required' using errcode = 'CR422';
  end if;

  select * into v_ob from public.couranr_payment_obligations where id = p_obligation_id;
  if not found then
    raise exception 'obligation_not_found' using errcode = 'CR404';
  end if;

  -- Already attached to this intent: idempotent no-op.
  if v_ob.provider_payment_intent_id = p_payment_intent_id then
    return v_ob;
  end if;
  -- Attached to a DIFFERENT intent: refuse rather than repoint. Repointing
  -- would orphan a PaymentIntent that may already be holding funds.
  if v_ob.provider_payment_intent_id is not null then
    raise exception 'obligation_already_has_a_payment_intent' using errcode = 'CR409';
  end if;

  update public.couranr_payment_obligations
     set provider_payment_intent_id = p_payment_intent_id,
         payment_state = case when payment_state = 'not_started'
                              then 'requires_action' else payment_state end,
         version    = p_expected_version + 1,
         updated_at = now()
   where id = p_obligation_id
     and version = p_expected_version
     and payment_state in ('not_started','requires_action','failed')
  returning * into v_ob;

  if not found then
    raise exception 'version_or_state_conflict' using errcode = 'CR409';
  end if;

  insert into public.couranr_payment_events (
    obligation_id, request_id, provider, provider_event_id, event_type,
    payment_state_before, payment_state_after, outcome, detail
  ) values (
    v_ob.id, v_ob.request_id, 'stripe',
    'couranr:attach:' || v_ob.id::text || ':' || p_payment_intent_id,
    'couranr.payment_intent.attached',
    'not_started', v_ob.payment_state, 'applied',
    jsonb_build_object('paymentIntentId', p_payment_intent_id)
  );

  return v_ob;
end
$fn$;

/* The forward migration DROPPED the 8-argument form to add the authorization
   timestamp, so rolling back must drop the 9-argument form and recreate the 8
   - otherwise both arities exist and every call is ambiguous. */
drop function if exists public.couranr_apply_payment_intent_state(
  text,text,text,text,integer,integer,text,jsonb,timestamptz
);

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

/* Dropped FIRST: its body calls the predicates below, so leaving it behind
   would turn every PaymentIntent reuse into a 500 against a function that no
   longer exists. */
drop function if exists public.couranr_obligation_quote_expired(uuid);

drop function if exists private.couranr_quote_version_is_expired(
  public.couranr_quote_versions, timestamptz
);
drop function if exists private.couranr_quote_payer_approved(
  public.couranr_quote_versions
);

/* The forward migration DROPs the 8-argument form, which discards its
   pg_description row with it, and the recreate below is a fresh CREATE on a
   name that no longer exists. Without this the object would come back with no
   comment at all, so forward-then-rollback would not restore what it found. */
comment on function public.couranr_apply_payment_intent_state(
  text,text,text,text,integer,integer,text,jsonb
) is 'Applies a signature-verified Stripe PaymentIntent observation to the obligation and, on authorization, to the request. Governed outcomes only; never a raw driver error.';

revoke all on function public.couranr_apply_payment_intent_state(
  text,text,text,text,integer,integer,text,jsonb
) from public,anon,authenticated,service_role;
grant execute on function public.couranr_apply_payment_intent_state(
  text,text,text,text,integer,integer,text,jsonb
) to service_role;

commit;

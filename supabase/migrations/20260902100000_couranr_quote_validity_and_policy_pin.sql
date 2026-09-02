-- =====================================================================
-- COURANR QUOTE VALIDITY (QVL-001) AND PRICING POLICY PIN (PRC-007)
--
--   1. QUOTE VALIDITY. An immediate V2 quote is valid for 15 minutes UNTIL
--      THE ACTUAL PAYER APPROVES that exact immutable Quote Version. Once the
--      payer approves it inside the window the price is LOCKED: later passage
--      of time never reprices or expires it.
--
--      WHAT COUNTS AS PAYER APPROVAL, and nothing else does:
--
--        merchant-paid  p_acknowledged=true at submit, identifying THIS exact
--                       quote version. The merchant is the payer, so their
--                       acknowledgment is the approval.
--        customer-paid  the Stripe authorization reaching `requires_capture`
--                       for the exact obligation - the transition that makes
--                       the obligation 'authorized', moves the request to
--                       'confirmed' and records record_payer_quote_approval.
--
--      EXPLICITLY NOT APPROVAL. Creating a payment obligation is not: it
--      begins 'not_started'. Issuing or redeeming a payment access token is
--      not. Attaching or creating a PaymentIntent is not - it only reaches
--      'requires_action'. Operations `accept_as_quoted` is not: Couranr is not
--      the payer. An earlier revision of this migration confused the EXISTENCE
--      of these commands and rows with approval, which both expired quotes a
--      payer had already approved and left the real customer authorization
--      boundary unguarded.
--
--      The window therefore gates only the ACT OF OBTAINING approval, never
--      anything downstream of an approval already obtained. The 7-day payment
--      token TTL is a CREDENTIAL ceiling and never extends the commercial
--      window.
--
--      SERVER TIME is the authority - now() inside the command. No browser
--      timer participates. An expired quote is REFUSED, never silently
--      repriced: repricing at approval time would move the number under the
--      payer. Quote N is never mutated; the caller reroutes and recalculates,
--      minting Quote N+1.
--
--      Exempt from the window entirely: historical policy versions,
--      manual-review and invalid quotes, and any quote the payer approved.
--
--   2. POLICY PIN. A newly minted automatic priced quote must carry EXACTLY
--      'couranr-pricing-v2-2026-09-01'. A denylist of the superseded
--      identifier let every typo, invented string and ungoverned future
--      version through, and a quote whose policy nobody recognises cannot be
--      explained later.
--
-- ADDITIVE. No column or table dropped, no row rewritten, no historical quote
-- reinterpreted. Signatures unchanged, so every function is replaced in place
-- and no stale arity survives as an overload.
-- =====================================================================

begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

do $guard$
begin
  if to_regprocedure('private.couranr_append_routed_quote_version(uuid,uuid,integer,text,text,integer,integer,numeric,jsonb,jsonb,bigint,integer,integer,integer,text,text,text)') is null then
    raise exception 'Quote validity requires the Pricing V2 traffic authority migration';
  end if;
  if to_regprocedure('public.couranr_create_payment_obligation(uuid,uuid,text)') is null
     or to_regprocedure('public.couranr_submit_delivery_request_v2(uuid,uuid,integer,uuid,boolean)') is null
     or to_regprocedure('public.couranr_accept_delivery_request_as_quoted(uuid,uuid,integer,uuid)') is null
     or to_regprocedure('public.couranr_apply_payment_intent_state(text,text,text,text,integer,integer,text,jsonb)') is null then
    raise exception 'Quote validity requires the Foundation Gate A command cutover';
  end if;
end
$guard$;

/* ------------------------------------------------- payer approval, derived */
/* Derived from the evidence that already exists rather than duplicated into a
   flag, so it cannot drift from the facts it describes. */
create or replace function private.couranr_quote_payer_approved(
  p_quote public.couranr_quote_versions
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $fn$
  select
    /* An obligation that actually reached authorization is payer approval for
       EITHER payer. Money changing hands is the strongest evidence there is,
       and scoping this to customers only would leave a merchant quote
       expirable after its own payment was authorized. 'not_started' and
       'requires_action' are deliberately absent: an obligation that merely
       exists, or an intent merely attached, is not approval. */
    exists (
      select 1 from public.couranr_payment_obligations o
       where o.quote_version_id = p_quote.id
         and o.payment_state in ('authorized','capture_pending','captured'))
    /* And for a merchant-paid quote the merchant IS the payer, so their
       acknowledgment - which names the exact quote version it approved - is
       approval on its own, before any payment exists. */
    or (p_quote.payer_type = 'merchant' and exists (
      select 1 from public.couranr_delivery_request_events e
       where e.request_id = p_quote.request_id
         and e.command    = 'submit_delivery_request'
         and coalesce((e.metadata ->> 'acknowledgment')::boolean, false) is true
         and (e.metadata ->> 'quoteVersionId') = p_quote.id::text));
$fn$;

/* Explicitly revoked. This project's pg_default_acl grants arwdDxtm to anon,
   authenticated AND service_role on every new function, so a private-schema
   predicate is executable by anon unless it is taken away by hand - which is
   why private.couranr_append_routed_quote_version does exactly this. Not
   reachable over PostgREST (db-schemas is public only), but defence in depth
   and consistent with the rest of the private surface. */
comment on function private.couranr_quote_payer_approved is
  'QVL-001. True once the ACTUAL payer approved this exact quote version: merchant acknowledgment at submit, or a customer Stripe authorization that reached the obligation. Obligation, token and PaymentIntent existence are NOT approval.';

/* ------------------------------------------------------- the rule itself */
/* Half-open window: valid for [0, 15:00), expired at exactly 15:00 and beyond,
   which is why the tests probe 14:59 and 15:00 rather than one point. */
create or replace function private.couranr_quote_version_is_expired(
  p_quote public.couranr_quote_versions,
  p_now   timestamptz default now()
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $fn$
  select p_quote.quote_status = 'estimated'
     and p_quote.pricing_policy_version = 'couranr-pricing-v2-2026-09-01'
     and p_quote.created_at is not null
     and (p_now - p_quote.created_at) >= interval '15 minutes'
     and not private.couranr_quote_payer_approved(p_quote);
$fn$;

comment on function private.couranr_quote_version_is_expired is
  'QVL-001. True only for a V2 estimated quote at or past 15 minutes old that the PAYER has not approved. An approved quote never expires; historical policy versions and unpriced quotes never expire.';

revoke all on function private.couranr_quote_payer_approved(
  public.couranr_quote_versions
) from public, anon, authenticated, service_role;
grant execute on function private.couranr_quote_payer_approved(
  public.couranr_quote_versions
) to service_role;

revoke all on function private.couranr_quote_version_is_expired(
  public.couranr_quote_versions, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function private.couranr_quote_version_is_expired(
  public.couranr_quote_versions, timestamptz
) to service_role;

/* ------------------------------------ read-only check for the app layer */
/* ensurePaymentIntent REUSES an existing PaymentIntent without calling attach,
   so the guard inside attach is never reached on that path and an intent
   minted while the quote was fresh would stay confirmable indefinitely. The
   application needs to ask the same question attach asks, and it must ask the
   DATABASE rather than compute an age from a clock of its own. */
create or replace function public.couranr_obligation_quote_expired(
  p_obligation_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $fn$
  select coalesce(
    (select private.couranr_quote_version_is_expired(q.*)
       from public.couranr_payment_obligations o
       join public.couranr_quote_versions q
         on q.id = o.quote_version_id and q.request_id = o.request_id
      where o.id = p_obligation_id),
    false);
$fn$;

comment on function public.couranr_obligation_quote_expired is
  'QVL-001. True when this obligation''s quote is a V2 estimated quote past 15 minutes that the payer has not approved. Read-only; server time is the authority.';

revoke all on function public.couranr_obligation_quote_expired(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_obligation_quote_expired(uuid)
  to service_role;

/* ------------------------------------------------- commands, re-enforced */
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
  /* QVL-001. p_acknowledged=true IS the merchant payer approving THIS exact
     quote, so it may only be recorded while the quote is still current.
     Submitting WITHOUT acknowledgment is not payer approval and is therefore
     never blocked by the window - a stale unacknowledged request may enter
     review, it just cannot later be confirmed at that price. */
  if coalesce(p_acknowledged,false)
     and private.couranr_quote_version_is_expired(v_quote) then
    raise exception 'quote_expired' using errcode = 'CR410';
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
  /* QVL-001. Operations accepting is NOT payer approval. The predicate exempts
     a quote the PAYER already approved, so a merchant who acknowledged inside
     the window is confirmable at any later time, while an unapproved quote -
     every customer-paid one at this point - is not. */
  if private.couranr_quote_version_is_expired(v_quote) then
    raise exception 'quote_expired' using errcode = 'CR410';
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

  /* QVL-001, positioned after the idempotent return above: only the creation
     of a NEW obligation is time-limited. A merchant who approved in time keeps
     an exempt quote, so their obligation can still be created later. Creating
     an obligation is NOT itself payer approval - it starts 'not_started'. */
  if private.couranr_quote_version_is_expired(v_quote) then
    raise exception 'quote_expired' using errcode = 'CR410';
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
  v_quote public.couranr_quote_versions;
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
  /* QVL-001. The TTL below is a CREDENTIAL ceiling and must never extend the
     commercial window: a link valid for days cannot authorize a quote whose
     15 minutes have passed without payer approval. */
  select * into v_quote from public.couranr_quote_versions
   where id=v_ob.quote_version_id and request_id=v_req.id;
  if private.couranr_quote_version_is_expired(v_quote) then
    raise exception 'quote_expired' using errcode = 'CR410';
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
  v_quote public.couranr_quote_versions;
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
  /* ALIASED, and it must stay aliased. `returns table (… request_id uuid,
     obligation_id uuid, payment_state text …)` makes those names OUT
     parameters - ordinary PL/pgSQL variables in the body - so a bare
     `request_id` here is ambiguous with the column and PostgreSQL refuses with
     42702 rather than guessing. Migration 20260731234500 exists solely to fix
     this, and the Gate A command cutover reintroduced it by re-declaring the
     function without the alias, so redemption has been raising 42702 on every
     call since. Restored here because this function is being replaced anyway. */
  select o.* into v_ob from public.couranr_payment_obligations o
   where o.id=v_tok.obligation_id and o.request_id=v_req.id and o.payment_state<>'cancelled';
  if not found then
    return query select false,'no_obligation'::text,v_req.id,null::uuid,
      v_req.request_state,null::text,null::text,null::integer; return;
  end if;
  /* QVL-001. A token with days of TTL left still cannot open an expired,
     unapproved commercial quote. Refused as a governed reason on this
     function's own result shape, never a raw driver error. */
  /* Qualified: this function RETURNS TABLE with a `request_id` output column,
     so a bare `request_id` here is ambiguous (42702) rather than the table's. */
  select * into v_quote from public.couranr_quote_versions q
   where q.id=v_ob.quote_version_id and q.request_id=v_req.id;
  if found and private.couranr_quote_version_is_expired(v_quote) then
    return query select false,'quote_expired'::text,v_req.id,v_ob.id,
      v_req.request_state,v_ob.payment_state,v_ob.payer_type,v_ob.amount_cents; return;
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
  v_quote public.couranr_quote_versions;
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
  /* QVL-001, after the idempotent return so an existing attachment survives.
     Attaching an intent is NOT payer approval - it only moves the obligation
     to 'requires_action' - so it may not happen on an expired unapproved
     quote. */
  select * into v_quote from public.couranr_quote_versions
   where id = v_ob.quote_version_id and request_id = v_ob.request_id;
  if found and private.couranr_quote_version_is_expired(v_quote) then
    raise exception 'quote_expired' using errcode = 'CR410';
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
          /* QVL-001. THIS is the customer payer approving the quote: reaching
             requires_capture is what makes the obligation 'authorized', moves
             the request to 'confirmed' and records record_payer_quote_approval
             below. So it is the last boundary at which the 15-minute window
             can still refuse - and it must, because an obligation or intent
             created while the quote was fresh must not make the price
             immortal. Refused as a governed 'rejected' outcome, so nothing is
             authorized, no approval is recorded and Quote N is untouched. */
          if private.couranr_quote_version_is_expired(v_quote) then
            v_outcome:='rejected';v_reason:='quote_expired';
          else
            v_target:='authorized';v_outcome:='applied';
            if not v_quote_is_current then v_reason:='authorized_for_superseded_quote'; end if;
          end if;
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

commit;

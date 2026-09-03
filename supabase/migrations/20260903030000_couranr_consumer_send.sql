-- =====================================================================
-- COURANR CONSUMER /send (launch batch 3 §D)
--
--   1. GUEST SESSIONS. couranr_consumer_guest_sessions holds the anonymous
--      consumer's server-minted session: a SHA-256 hash of a 256-bit token
--      (the raw value is returned exactly once and never persisted), a TTL
--      clamped in SQL to at most 3 days, and at most ONE delivery request per
--      session. Redemption has ONE uniform refusal — CR404
--      'guest_session_not_available' for unknown, revoked and expired alike —
--      copying the tracking-token doctrine so probing tokens reveals nothing.
--
--   2. CONSUMER SIBLING COMMANDS. The strict routed create/estimate pair
--      (20260902200000) is BUSINESS-ONLY by construction: NOT NULL business
--      path, 'business:' idempotency recovery, hardcoded 'merchant' event
--      actor. It is NOT modified here. The consumer siblings mirror its
--      guards EXACTLY — weight honesty, private.couranr_assert_safety_declaration,
--      private.couranr_assert_requested_timing, and the SAME
--      private.couranr_append_routed_quote_version call (reused, never
--      forked) — with the requester identity turned around: requester_kind
--      'consumer', business_account_id NULL, created_by NULL, source
--      'consumer_send', payer_type hardcoded 'customer' (PAY-001: consumer
--      requests are customer-paid; there is no payer parameter), event actor
--      'customer' with a NULL actor id, and the idempotency scope derived
--      inside the command as 'consumer:<guest-session-id>' so a guest can
--      never choose an authority scope and can never touch another guest's or
--      any business's row: every read and write is scoped by that derived
--      value in the WHERE clause.
--
--   3. CONSUMER SUBMIT — CAP-001 ORDER (corrected per independent review).
--      couranr_submit_delivery_request_v2 already branches its event actor on
--      requester_kind, but it cannot verify a guest session, and leaving
--      draft trips couranr_dr_consumer_submitted_contact_chk (23514 ->
--      opaque 'internal') when the frozen contact snapshot has neither phone
--      nor email. couranr_submit_consumer_delivery_request verifies the
--      session INSIDE SQL and refuses CR422 'consumer_contact_required'
--      before the CHECK can. Per CAP-001 ("payment is authorized BEFORE
--      Couranr review and captured only after Couranr confirms"), an
--      automatic 'estimated' quote submits into the payable
--      'awaiting_quote_acceptance' with review_state 'pending' — payer
--      authorization comes first and NOTHING claims Operations reviewed
--      anything. A 'manual_review_required' quote has no payable price and
--      goes to Couranr review first — the governed exception, since no
--      amount may be fabricated for it. Still NO auto-accept anywhere.
--
--   3b. CONSUMER-AWARE AUTHORIZE + ACCEPT. This migration REPLACES (in
--      apply-order, after 20260903010000/20260902161642 defined them)
--      couranr_apply_payment_intent_state and
--      couranr_accept_delivery_request_as_quoted with bodies that differ
--      ONLY in the consumer branch: a consumer authorization records payer
--      approval for the exact quote version and moves the request INTO
--      Couranr review (pending_couranr_review, review_state still
--      'pending'); Operations acceptance then recognises the standing payer
--      approval and confirms WITHOUT demanding a second authorization.
--      Business behavior is byte-preserved. The rollback restores both
--      predecessor bodies verbatim.
--
--   4. TRACKING. couranr_delivery_access_tokens.business_account_id becomes
--      NULLABLE (additive relaxation) so a confirmed consumer request can
--      carry a tracking link. The issue command copies
--      request.business_account_id verbatim, so a business request still
--      always stamps its business and only a consumer request produces NULL;
--      a CHECK cannot express that join, so the command remains the enforcer.
--
-- ADDITIVE: one table, one column relaxation, six commands. No column or
-- table dropped, no historical row rewritten. RE-RUNNABLE: create-table-if-
-- not-exists, create-or-replace, and DROP NOT NULL is idempotent.
-- =====================================================================

begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

do $guard$
begin
  if to_regclass('public.couranr_delivery_requests') is null
     or to_regclass('public.couranr_delivery_access_tokens') is null then
    raise exception 'consumer send requires the canonical request and tracking tables';
  end if;
  if to_regprocedure('private.couranr_append_routed_quote_version(uuid,uuid,integer,text,text,integer,integer,numeric,jsonb,jsonb,bigint,integer,integer,integer,text,text,text)') is null
     or to_regprocedure('private.couranr_assert_safety_declaration(text,text)') is null
     or to_regprocedure('private.couranr_assert_requested_timing(text,timestamptz,jsonb)') is null then
    raise exception 'consumer send requires the strict routed command guards (20260902200000)';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'couranr_delivery_requests'
       and column_name = 'idempotency_scope'
  ) then
    raise exception 'consumer send requires the Gate A universal requester model (20260901051549)';
  end if;
end
$guard$;

/* ------------------------------------------------ tracking relaxation --- */
/* Additive: NULL becomes representable; every existing row keeps its value.
   The issue command copies request.business_account_id verbatim, so NULL can
   only ever mean "this request has no business tenant" — a consumer request. */
alter table public.couranr_delivery_access_tokens
  alter column business_account_id drop not null;

comment on column public.couranr_delivery_access_tokens.business_account_id is
  'The request''s business tenant, copied verbatim by the issue command. NULL only for a consumer (requester_kind=consumer) request, which has no business tenant by the Gate A tenancy CHECK.';

/* ------------------------------------------------- 1. guest sessions ---- */

create table if not exists public.couranr_consumer_guest_sessions (
  id               uuid primary key default gen_random_uuid(),
  -- 64 lower-case hex characters. Never the raw token itself.
  token_hash       text not null,
  -- At most ONE delivery request per session, bound once and never re-pointed.
  request_id       uuid,
  contact_snapshot jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  last_used_at     timestamptz,
  revoked_at       timestamptz,

  constraint couranr_cgs_hash_uniq unique (token_hash),
  constraint couranr_cgs_hash_shape_chk check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint couranr_cgs_request_uniq unique (request_id),
  constraint couranr_cgs_request_fk foreign key (request_id)
    references public.couranr_delivery_requests (id)
    on update cascade on delete restrict,
  constraint couranr_cgs_contact_object_chk
    check (jsonb_typeof(contact_snapshot) = 'object'),
  constraint couranr_cgs_expiry_chk check (expires_at > created_at)
);

comment on table public.couranr_consumer_guest_sessions is
  'Anonymous consumer /send sessions. Stores a SHA-256 hash only — the raw token is returned once at creation and never persisted. One delivery request per session; the request''s idempotency scope is derived from this session''s id, which is what makes the scope server-minted.';

alter table public.couranr_consumer_guest_sessions enable row level security;
-- pg_default_acl grants ALL on every new public object to anon, authenticated
-- AND service_role, so the narrow grant below means nothing without these.
revoke all on public.couranr_consumer_guest_sessions from public, anon, authenticated;
revoke all on public.couranr_consumer_guest_sessions from service_role;
-- Created, read for redemption, updated to bind/stamp/revoke. Never deleted.
grant select, insert, update on public.couranr_consumer_guest_sessions to service_role;

create or replace function public.couranr_create_consumer_guest_session(
  p_token_hash  text,
  p_ttl_minutes integer
)
returns public.couranr_consumer_guest_sessions
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_ses public.couranr_consumer_guest_sessions;
  v_ttl integer;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'token_hash_must_be_sha256_hex' using errcode = 'CR422';
  end if;
  -- 5 minutes to 3 days, defaulting to 24 hours. Clamped in SQL so a caller
  -- cannot ask for more; a guest session is a funnel credential, not a login.
  v_ttl := least(greatest(coalesce(p_ttl_minutes, 1440), 5), 4320);

  insert into public.couranr_consumer_guest_sessions (token_hash, expires_at)
  values (p_token_hash, now() + make_interval(mins => v_ttl))
  returning * into v_ses;
  return v_ses;
end
$fn$;

comment on function public.couranr_create_consumer_guest_session is
  'Mints one anonymous consumer session from a SHA-256 hash. TTL clamped to [5 min, 3 days], default 24 h. SECURITY INVOKER, service_role only.';

create or replace function public.couranr_redeem_consumer_guest_session(
  p_token_hash text
)
returns public.couranr_consumer_guest_sessions
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_ses public.couranr_consumer_guest_sessions;
begin
  /* ONE uniform refusal. Unknown, revoked and expired are indistinguishable
     to the caller (tracking-token doctrine): probing tokens must reveal
     nothing about whether a session ever existed. */
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'guest_session_not_available' using errcode = 'CR404';
  end if;
  select s.* into v_ses
    from public.couranr_consumer_guest_sessions s
   where s.token_hash = p_token_hash;
  if not found or v_ses.revoked_at is not null or v_ses.expires_at <= now() then
    raise exception 'guest_session_not_available' using errcode = 'CR404';
  end if;

  update public.couranr_consumer_guest_sessions s
     set last_used_at = now()
   where s.id = v_ses.id
  returning s.* into v_ses;
  return v_ses;
end
$fn$;

comment on function public.couranr_redeem_consumer_guest_session is
  'Resolves a guest session by SHA-256 hash and stamps last_used_at. Unknown, revoked and expired all refuse identically (CR404 guest_session_not_available). SECURITY INVOKER, service_role only.';

create or replace function public.couranr_bind_consumer_guest_request(
  p_session_id uuid,
  p_request_id uuid
)
returns public.couranr_consumer_guest_sessions
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_ses public.couranr_consumer_guest_sessions;
begin
  select s.* into v_ses
    from public.couranr_consumer_guest_sessions s
   where s.id = p_session_id
     for update;
  if not found or v_ses.revoked_at is not null or v_ses.expires_at <= now() then
    raise exception 'guest_session_not_available' using errcode = 'CR404';
  end if;

  -- Idempotent for the same request; a re-point is refused outright.
  if v_ses.request_id is not null then
    if v_ses.request_id = p_request_id then
      return v_ses;
    end if;
    raise exception 'guest_session_already_bound' using errcode = 'CR409';
  end if;

  /* Only a request THIS session's scope created may be bound. The scope is
     derived from the session id, so another guest's request — or any business
     request — is simply not found here, revealing nothing. */
  if not exists (
    select 1 from public.couranr_delivery_requests r
     where r.id = p_request_id
       and r.requester_kind = 'consumer'
       and r.idempotency_scope = 'consumer:' || p_session_id::text
  ) then
    raise exception 'request_not_found' using errcode = 'CR404';
  end if;

  update public.couranr_consumer_guest_sessions s
     set request_id = p_request_id, last_used_at = now()
   where s.id = p_session_id
  returning s.* into v_ses;
  return v_ses;
end
$fn$;

comment on function public.couranr_bind_consumer_guest_request is
  'Binds a guest session to the ONE request its own scope created. Idempotent for the same request; CR409 on any re-point; a foreign request is CR404. SECURITY INVOKER, service_role only.';

/* -------------------------------- 2. consumer create / estimate siblings - */
/* STRICT arity, NO defaults — same doctrine as 20260902200000: every
   argument must be stated (null is a statement), so no partial named call can
   resolve here and no default can silently supply governed behavior. */

create or replace function public.couranr_create_consumer_delivery_request_draft(
  p_guest_session_id uuid, p_idempotency_key text, p_contact jsonb,
  p_shipment_description text,
  p_recipient_name text, p_recipient_phone text, p_recipient_email text,
  p_weight_lb numeric, p_additional_stops integer,
  p_service_level text, p_signature_required boolean, p_proof_method text,
  p_pickup_address jsonb, p_dropoff_address jsonb, p_overnight_requested boolean,
  p_route_distance_meters bigint, p_route_duration_seconds integer,
  p_route_static_duration_seconds integer,
  p_route_traffic_delay_seconds integer,
  p_distance_source text, p_serviceability_outcome text, p_route_review_reason text,
  p_quote_status text, p_pricing_policy_version text,
  p_delivery_subtotal_cents integer, p_included_loaded_miles integer,
  p_billable_loaded_miles numeric, p_quote_line_items jsonb, p_review_reasons jsonb,
  p_weight_band text, p_timing_intent text, p_requested_pickup_local text,
  p_requested_departure_at timestamptz, p_timing_review_reasons jsonb,
  p_restricted_class text
)
returns public.couranr_delivery_requests
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_ses public.couranr_consumer_guest_sessions;
  v_req public.couranr_delivery_requests;
  v_quote public.couranr_quote_versions;
  v_loaded_miles numeric(10,3);
  v_scope text;
  v_contact jsonb;
  v_desc text;
begin
  /* THE ACTOR CHECK. The guest session row IS the consumer's identity: it is
     locked, must be live, and every scope below derives from ITS id — never
     from a caller-supplied string. Unknown, revoked and expired refuse
     identically. */
  select s.* into v_ses
    from public.couranr_consumer_guest_sessions s
   where s.id = p_guest_session_id
     for update;
  if not found or v_ses.revoked_at is not null or v_ses.expires_at <= now() then
    raise exception 'guest_session_not_available' using errcode = 'CR404';
  end if;
  v_scope := 'consumer:' || p_guest_session_id::text;

  /* One request per session. A replay with the original idempotency key
     converges on it; asking for a second draft needs a second session. */
  if v_ses.request_id is not null then
    select r.* into v_req from public.couranr_delivery_requests r
     where r.id = v_ses.request_id
       and r.idempotency_scope = v_scope
       and r.idempotency_key = p_idempotency_key;
    if found then
      return v_req;
    end if;
    raise exception 'guest_session_already_bound' using errcode = 'CR409';
  end if;

  if p_contact is null or jsonb_typeof(p_contact) is distinct from 'object' then
    raise exception 'consumer_contact_must_be_object' using errcode = 'CR422';
  end if;
  -- Only the three governed keys survive; blank strings become absence. The
  -- Gate A trigger freezes this snapshot at insert, so it is final here.
  v_contact := jsonb_strip_nulls(jsonb_build_object(
    'name',  nullif(btrim(coalesce(p_contact->>'name','')),  ''),
    'phone', nullif(btrim(coalesce(p_contact->>'phone','')), ''),
    'email', nullif(btrim(coalesce(p_contact->>'email','')), '')));

  /* Mirrored strict guards — SUR-001 weight honesty, the shipment-safety
     declaration and TMZ-001 two-sided timing, via the SAME private helpers
     the business command calls. Never forked. */
  if p_weight_lb is null and p_weight_band is null then
    raise exception 'weight_or_band_required' using errcode='CR422';
  end if;
  if p_weight_lb is not null and p_weight_lb <= 0 then
    raise exception 'weight_must_be_positive' using errcode='CR422';
  end if;
  perform private.couranr_assert_safety_declaration(p_restricted_class, p_quote_status);
  if p_timing_intent = 'scheduled' then
    perform private.couranr_assert_requested_timing(
      p_requested_pickup_local, p_requested_departure_at, p_timing_review_reasons);
  end if;

  if p_route_distance_meters is not null then
    v_loaded_miles := round(p_route_distance_meters::numeric / 1609.344,3);
  else
    v_loaded_miles := null;
  end if;
  v_desc := nullif(btrim(coalesce(p_shipment_description,'')), '');

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
      'draft','not_required','pending',
      'consumer_send','not_confirmed','customer',
      p_recipient_name,p_recipient_phone,p_recipient_email,
      v_loaded_miles,p_weight_lb,p_weight_band,p_restricted_class,p_additional_stops,
      p_timing_intent,p_requested_pickup_local,
      case when p_timing_intent is not null then 'America/New_York' end,
      p_requested_departure_at,coalesce(p_timing_review_reasons,'[]'::jsonb),
      p_service_level,p_signature_required,p_proof_method,
      p_pickup_address,p_dropoff_address,
      jsonb_build_object(
        'overnightRequested',coalesce(p_overnight_requested,false),
        'route',jsonb_build_object(
          'serviceabilityOutcome',p_serviceability_outcome,
          'distanceSource',p_distance_source,
          'reviewReason',p_route_review_reason))
      || case when v_desc is null then '{}'::jsonb
              else jsonb_build_object('consumerDescription', left(v_desc, 2000)) end,
      'not_quoted','[]'::jsonb,'[]'::jsonb,false,false,null
    ) returning * into v_req;
  exception when unique_violation then
    select * into v_req from public.couranr_delivery_requests
     where idempotency_scope=v_scope and idempotency_key=p_idempotency_key;
    if not found then raise; end if;
    -- Converge the binding too, so a replay leaves nothing half-done.
    update public.couranr_consumer_guest_sessions s
       set request_id = v_req.id, last_used_at = now()
     where s.id = v_ses.id and s.request_id is null;
    return v_req;
  end;

  /* Bind IN THE SAME TRANSACTION as the insert, so no crash can leave a
     consumer request no session can reach. */
  update public.couranr_consumer_guest_sessions s
     set request_id = v_req.id, last_used_at = now()
   where s.id = v_ses.id;

  v_quote := private.couranr_append_routed_quote_version(
    v_req.id,null,v_req.version,p_quote_status,p_pricing_policy_version,
    p_delivery_subtotal_cents,p_included_loaded_miles,p_billable_loaded_miles,
    p_quote_line_items,p_review_reasons,p_route_distance_meters,
    p_route_duration_seconds,p_route_static_duration_seconds,
    p_route_traffic_delay_seconds,p_distance_source,p_serviceability_outcome,
    p_route_review_reason
  );

  insert into public.couranr_delivery_request_events(
    request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_req.id,null,'customer','create_delivery_request_draft',null,'draft',
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

comment on function public.couranr_create_consumer_delivery_request_draft is
  'Consumer sibling of the strict routed create: same guards via the same private helpers, requester_kind consumer, NULL business/creator, payer hardcoded customer (PAY-001), source consumer_send, idempotency scope derived from the guest session inside SQL, session bound atomically. SECURITY INVOKER, service_role only.';

create or replace function public.couranr_calculate_consumer_delivery_request_estimate(
  p_request_id uuid, p_guest_session_id uuid, p_expected_version integer,
  p_update_shipment boolean,
  p_shipment_description text,
  p_recipient_name text, p_recipient_phone text, p_recipient_email text,
  p_weight_lb numeric, p_additional_stops integer,
  p_service_level text, p_signature_required boolean, p_proof_method text,
  p_pickup_address jsonb, p_dropoff_address jsonb, p_overnight_requested boolean,
  p_route_distance_meters bigint, p_route_duration_seconds integer,
  p_route_static_duration_seconds integer,
  p_route_traffic_delay_seconds integer,
  p_distance_source text, p_serviceability_outcome text, p_route_review_reason text,
  p_quote_status text, p_pricing_policy_version text,
  p_delivery_subtotal_cents integer, p_included_loaded_miles integer,
  p_billable_loaded_miles numeric, p_quote_line_items jsonb, p_review_reasons jsonb,
  p_weight_band text, p_timing_intent text, p_requested_pickup_local text,
  p_requested_departure_at timestamptz, p_timing_review_reasons jsonb,
  p_restricted_class text
)
returns public.couranr_delivery_requests
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_ses public.couranr_consumer_guest_sessions;
  v_stored public.couranr_delivery_requests;
  v_req public.couranr_delivery_requests;
  v_quote public.couranr_quote_versions;
  v_loaded_miles numeric(10,3);
  v_scope text;
  v_payload jsonb;
  v_desc text;
begin
  select s.* into v_ses
    from public.couranr_consumer_guest_sessions s
   where s.id = p_guest_session_id
     for update;
  if not found or v_ses.revoked_at is not null or v_ses.expires_at <= now() then
    raise exception 'guest_session_not_available' using errcode = 'CR404';
  end if;
  v_scope := 'consumer:' || p_guest_session_id::text;

  /* The session must be BOUND to this request, and the request must carry
     THIS session's derived scope. Another guest's request — or any business
     row — is indistinguishable from an absent one. */
  if v_ses.request_id is distinct from p_request_id then
    raise exception 'request_not_found' using errcode = 'CR404';
  end if;
  select r.* into v_stored from public.couranr_delivery_requests r
   where r.id = p_request_id
     and r.requester_kind = 'consumer'
     and r.idempotency_scope = v_scope;
  if not found then
    raise exception 'request_not_found' using errcode = 'CR404';
  end if;

  /* Mirrored strict guards, exactly as the business estimate applies them. */
  if p_update_shipment and p_weight_lb is null and p_weight_band is null then
    raise exception 'weight_or_band_required' using errcode='CR422';
  end if;
  if p_update_shipment and p_weight_lb is not null and p_weight_lb <= 0 then
    raise exception 'weight_must_be_positive' using errcode='CR422';
  end if;
  perform private.couranr_assert_safety_declaration(
    case when p_update_shipment then p_restricted_class
         else coalesce(p_restricted_class, v_stored.restricted_class) end,
    p_quote_status);
  if p_timing_intent = 'scheduled' then
    perform private.couranr_assert_requested_timing(
      p_requested_pickup_local, p_requested_departure_at, p_timing_review_reasons);
  end if;

  if p_route_distance_meters is not null then
    v_loaded_miles := round(p_route_distance_meters::numeric / 1609.344,3);
  else
    v_loaded_miles := null;
  end if;
  v_desc := nullif(btrim(coalesce(p_shipment_description,'')), '');
  if not p_update_shipment then
    v_desc := coalesce(v_desc, v_stored.normalized_request_payload->>'consumerDescription');
  end if;
  v_payload := jsonb_build_object(
    'overnightRequested',coalesce(p_overnight_requested,false),
    'route',jsonb_build_object(
      'serviceabilityOutcome',p_serviceability_outcome,
      'distanceSource',p_distance_source,
      'reviewReason',p_route_review_reason))
    || case when v_desc is null then '{}'::jsonb
            else jsonb_build_object('consumerDescription', left(v_desc, 2000)) end;

  if p_update_shipment then
    /* Requester identity — kind, business, creator, scope, contact snapshot —
       is NEVER touched: the Gate A trigger freezes it, and payer_type/source
       are fixed by this funnel ('customer' / 'consumer_send'), so neither is
       an updatable column here. */
    update public.couranr_delivery_requests set
      recipient_name=p_recipient_name,recipient_phone=p_recipient_phone,
      recipient_email=p_recipient_email,loaded_miles=v_loaded_miles,
      weight_lb=p_weight_lb,weight_band=p_weight_band,
      restricted_class=p_restricted_class,
      additional_stops=p_additional_stops,
      timing_intent=p_timing_intent,
      requested_pickup_local=p_requested_pickup_local,
      operating_timezone=case when p_timing_intent is not null
                              then 'America/New_York' end,
      requested_departure_at=p_requested_departure_at,
      timing_review_reasons=coalesce(p_timing_review_reasons,timing_review_reasons),
      service_level=p_service_level,signature_required=p_signature_required,
      proof_method=p_proof_method,pickup_address=p_pickup_address,
      dropoff_address=p_dropoff_address,normalized_request_payload=v_payload,
      version=p_expected_version+1,updated_at=now()
    where id=p_request_id and requester_kind='consumer'
      and idempotency_scope=v_scope
      and version=p_expected_version
      -- CAP-001 recovery seam (review item 2): the consumer may re-price
      -- their OWN request while it awaits payer authorization — the quote
      -- may have expired under QVL before payment. Never past authorization,
      -- never once Couranr review begins.
      and request_state in ('draft','awaiting_quote_acceptance')
    returning * into v_req;
  else
    update public.couranr_delivery_requests set
      loaded_miles=v_loaded_miles,normalized_request_payload=v_payload,
      timing_review_reasons=coalesce(p_timing_review_reasons,timing_review_reasons),
      version=p_expected_version+1,updated_at=now()
    where id=p_request_id and requester_kind='consumer'
      and idempotency_scope=v_scope
      and version=p_expected_version
      -- CAP-001 recovery seam (review item 2): the consumer may re-price
      -- their OWN request while it awaits payer authorization — the quote
      -- may have expired under QVL before payment. Never past authorization,
      -- never once Couranr review begins.
      and request_state in ('draft','awaiting_quote_acceptance')
    returning * into v_req;
  end if;
  if not found then
    raise exception 'version_or_state_conflict' using errcode='CR409';
  end if;

  v_quote := private.couranr_append_routed_quote_version(
    v_req.id,null,v_req.version,p_quote_status,p_pricing_policy_version,
    p_delivery_subtotal_cents,p_included_loaded_miles,p_billable_loaded_miles,
    p_quote_line_items,p_review_reasons,p_route_distance_meters,
    p_route_duration_seconds,p_route_static_duration_seconds,
    p_route_traffic_delay_seconds,p_distance_source,p_serviceability_outcome,
    p_route_review_reason
  );
  insert into public.couranr_delivery_request_events(
    request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_req.id,null,'customer','calculate_delivery_request_estimate',
    v_req.request_state,v_req.request_state,jsonb_build_object(
      'quoteVersionId',v_quote.id,'quoteNumber',v_quote.quote_number,
      'quoteStatus',v_quote.quote_status,'reviewReasons',v_quote.review_reasons,
      'serviceabilityOutcome',p_serviceability_outcome,
      'distanceSource',p_distance_source,
      'routeDistanceMeters',p_route_distance_meters,
      'routeDurationSeconds',p_route_duration_seconds)
  );
  update public.couranr_consumer_guest_sessions s
     set last_used_at = now()
   where s.id = v_ses.id;
  select * into v_req from public.couranr_delivery_requests where id=v_req.id;
  return v_req;
end
$fn$;

comment on function public.couranr_calculate_consumer_delivery_request_estimate is
  'Consumer sibling of the strict routed estimate: same guards via the same private helpers, every read and write scoped by the session-derived idempotency scope so a guest can never touch another guest''s or any business''s row. SECURITY INVOKER, service_role only.';

/* ------------------------------------------------- 3. consumer submit --- */

create or replace function public.couranr_submit_consumer_delivery_request(
  p_request_id uuid, p_guest_session_id uuid, p_expected_version integer
)
returns public.couranr_delivery_requests
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_ses public.couranr_consumer_guest_sessions;
  v_req public.couranr_delivery_requests;
  v_quote public.couranr_quote_versions;
  v_scope text;
begin
  select s.* into v_ses
    from public.couranr_consumer_guest_sessions s
   where s.id = p_guest_session_id
     for update;
  if not found or v_ses.revoked_at is not null or v_ses.expires_at <= now() then
    raise exception 'guest_session_not_available' using errcode = 'CR404';
  end if;
  v_scope := 'consumer:' || p_guest_session_id::text;
  if v_ses.request_id is distinct from p_request_id then
    raise exception 'request_not_found' using errcode = 'CR404';
  end if;

  select r.* into v_req from public.couranr_delivery_requests r
   where r.id = p_request_id
     and r.requester_kind = 'consumer'
     and r.idempotency_scope = v_scope
   for update;
  if not found then
    raise exception 'request_not_found' using errcode = 'CR404';
  end if;
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

  /* The Gate A contact CHECK (couranr_dr_consumer_submitted_contact_chk)
     trips on leaving draft. Refuse it HERE as a governed CR422 the funnel can
     act on, rather than letting 23514 surface as an opaque internal error.
     The snapshot is frozen at creation, so a contactless draft needs a fresh
     session — this command cannot repair it. */
  if nullif(btrim(coalesce(v_req.consumer_contact_snapshot->>'phone','')),'') is null
     and nullif(btrim(coalesce(v_req.consumer_contact_snapshot->>'email','')),'') is null then
    raise exception 'consumer_contact_required' using errcode='CR422';
  end if;

  /* NO QVL gate, deliberately, mirroring the v2 unacknowledged branch: a
     consumer submit is NOT payer approval (PAY-001: the customer approves by
     authorizing payment, and that boundary is guarded in the payment
     commands).

     CAP-001 ORDER (correction pass, review item 2): payment is authorized
     BEFORE Couranr review. An automatic 'estimated' quote therefore submits
     into 'awaiting_quote_acceptance' — the payable posture that says exactly
     "waiting for the payer", with review_state 'pending' saying exactly
     "Couranr review has not happened". Nothing here pretends Operations
     accepted anything. A 'manual_review_required' quote has no payable
     price, so it goes to Couranr review FIRST ('pending_couranr_review') —
     the one governed exception CAP-001's order allows, because no amount may
     be fabricated for it. */
  update public.couranr_delivery_requests set
    request_state=case when v_quote.quote_status='estimated'
                       then 'awaiting_quote_acceptance'
                       else 'pending_couranr_review' end,
    review_state='pending',submitted_at=now(),
    version=p_expected_version+1,updated_at=now()
  where id=v_req.id and version=p_expected_version
  returning * into v_req;
  if not found then raise exception 'version_or_state_conflict' using errcode='CR409'; end if;

  insert into public.couranr_delivery_request_events(
    request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_req.id,null,'customer','submit_delivery_request','draft',v_req.request_state,
    jsonb_build_object(
      'quoteVersionId',v_quote.id,'quoteNumber',v_quote.quote_number,
      'payerType',v_quote.payer_type,'acknowledgment',false,
      'quoteStatus',v_quote.quote_status,'reviewReasons',v_quote.review_reasons)
  );
  update public.couranr_consumer_guest_sessions s
     set last_used_at = now()
   where s.id = v_ses.id;
  return v_req;
end
$fn$;

comment on function public.couranr_submit_consumer_delivery_request is
  'Submits a guest consumer draft FOR COURANR REVIEW (no auto-accept; payment unlocks only after Operations accepts, per the customer-paid spine). Verifies the session binding inside SQL and refuses CR422 consumer_contact_required when the frozen contact snapshot has neither phone nor email. SECURITY INVOKER, service_role only.';

/* ---------------------------------------------------------------- grants - */
/* pg_default_acl grants arwdDxtm to anon/authenticated/service_role on every
   new function here, so each one is locked down by hand. */


/* -------------------- 3b. CAP-001 consumer payment order ---------------- */

/*
 * REPLACEMENTS, not new commands. In apply order this migration runs after
 * 20260903010000 (which owns couranr_apply_payment_intent_state's evidence
 * semantics) and 20260902161642 (which owns
 * couranr_accept_delivery_request_as_quoted). Each body below is that
 * predecessor's text with ONLY the consumer branch added; business behavior
 * is byte-preserved, and the rollback restores both predecessor bodies
 * verbatim. Signatures unchanged, so grants carry over (CREATE OR REPLACE
 * preserves ACLs) and the QVL pin tests still count exactly one 9-argument
 * apply command.
 */

create or replace function public.couranr_apply_payment_intent_state(
  p_provider_event_id text,p_event_type text,p_payment_intent_id text,
  p_intent_status text,p_amount integer,p_amount_capturable integer,
  p_currency text,p_metadata jsonb,
  /* When Stripe actually authorized. The payer approved THEN, not when this
     webhook happened to be processed. */
  p_authorized_at timestamptz default null
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
  v_req_target text;
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
          /* Evaluated AS OF THE AUTHORIZATION, not as of now(). A payer who
             confirmed at 14:30 approved inside the window even if 3DS, a
             retry or a webhook backlog delivers this at 15:20 - and the rule
             is that an approval obtained in time is never undone by later
             time passing. Falls back to now() only when the caller cannot
             supply the moment. */
          if private.couranr_quote_version_is_expired(
               v_quote, coalesce(p_authorized_at, now())) then
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
  /* §A EVIDENCE UPGRADE. The synchronous reconcile path authorizes with NO
     provider instant (processing_fallback, by design — PaymentIntent.created
     is mint time, not approval). When the signature-verified webhook for the
     SAME authorization later arrives with the trusted event.created, the row
     is already 'authorized' and the state machine would shrug it off as
     already_in_state — losing the audit truth forever. Instead: converge the
     provider evidence onto the same obligation. State does not move, no
     approval is re-evaluated (an approval already granted is never undone),
     the event id keeps webhook idempotency, and only a fallback-sourced row
     can upgrade — trusted provider evidence is never overwritten. */
  if v_outcome='applied' and v_target='authorized'
     and v_ob.payment_state='authorized'
     and p_authorized_at is not null
     and v_ob.authorized_at_source='processing_fallback' then
    begin
      insert into public.couranr_payment_events(
        obligation_id,request_id,provider,provider_event_id,event_type,
        payment_state_before,payment_state_after,outcome,detail
      ) values (
        v_ob.id,v_ob.request_id,'stripe',p_provider_event_id,p_event_type,
        'authorized','authorized','applied',
        jsonb_build_object('paymentIntentId',p_payment_intent_id,
          'reason','authorization_time_reconciled',
          'providerAuthorizedAt',p_authorized_at,
          'previousAuthorizedAt',v_ob.authorized_at,
          'previousSource','processing_fallback')
      );
    exception when unique_violation then
      return row('duplicate',v_ob.id,v_ob.request_id,v_ob.payment_state,null,null)
        ::public.couranr_payment_apply_result;
    end;
    update public.couranr_payment_obligations set
      authorized_at=p_authorized_at,
      authorized_at_source='provider_event',
      version=version+1,updated_at=now()
    where id=v_ob.id and payment_state='authorized';
    select request_state into v_reqstate from public.couranr_delivery_requests
     where id=v_ob.request_id;
    return row('applied',v_ob.id,v_ob.request_id,'authorized',v_reqstate,
               'authorization_time_reconciled')
      ::public.couranr_payment_apply_result;
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
    /* Correction (batch 3 §A): the provider's trusted authorization instant is
       the commercial evidence; Couranr's processing moment is bookkeeping.
       When the caller cannot supply a trustworthy provider instant the row
       says so (processing_fallback) instead of dressing processing time up
       as an authorization time. */
    authorized_at=case when v_target='authorized'
                       then coalesce(p_authorized_at, now()) else authorized_at end,
    authorization_processed_at=case when v_target='authorized'
                       then now() else authorization_processed_at end,
    authorized_at_source=case when v_target='authorized'
                       then case when p_authorized_at is not null
                                 then 'provider_event' else 'processing_fallback' end
                       else authorized_at_source end,
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
      /* CAP-001 (correction pass, review item 2): the payer's approval is
         recorded for the EXACT quote version either way. WHERE the request
         goes next depends on whether Couranr review already happened: a
         consumer request still awaiting review (review_state 'pending')
         truthfully ENTERS Couranr review — nothing claims Operations
         accepted anything — while a business request, or a consumer request
         Operations already reviewed via requote ('requoted'), confirms
         exactly as before. review_state itself is NOT touched. */
      if v_req.requester_kind='consumer' and v_req.review_state='pending' then
        v_req_target:='pending_couranr_review';
      else
        v_req_target:='confirmed';
      end if;
      update public.couranr_delivery_requests set
        request_state=v_req_target,version=version+1,updated_at=now()
      where id=v_req.id returning * into v_req;
      insert into public.couranr_delivery_request_events(
        request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
      ) values (
        v_req.id,null,'system','record_payer_quote_approval',v_reqstate,v_req_target,
        jsonb_build_object('quoteVersionId',v_ob.quote_version_id,
          'payerType',v_ob.payer_type,'paymentObligationId',v_ob.id,
          'authorizedAmountCents',v_ob.amount_cents,
          'pricingPolicyVersion',v_ob.pricing_policy_version,
          'paymentState','authorized','captured',false,
          'couranrReviewPending',v_req_target='pending_couranr_review')
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

  if v_req.requester_kind='consumer' then
    /* CAP-001 (correction pass, review item 2): the consumer payer
       authorizes BEFORE Couranr review, so by the time Operations accepts,
       payer approval for the EXACT current quote must already stand — the
       same derived predicate QVL-001 trusts. Acceptance then CONFIRMS with
       NO second authorization; a consumer request here without approval is
       a governed refusal, never a silent confirm and never a bounce back to
       awaiting_quote_acceptance. */
    if private.couranr_quote_payer_approved(v_quote) then
      v_target:='confirmed';
    else
      raise exception 'consumer_quote_not_payer_approved' using errcode='CR409';
    end if;
  elsif v_quote.payer_type='merchant' then
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

  /* QVL-001, and ONLY on the branch that CONFIRMS. Operations accepting is not
     payer approval, and Couranr's own review latency must not expire a quote:
     a customer-paid request reviewed at 09:16 moves to awaiting_quote_acceptance
     normally, and the window is then enforced where the CUSTOMER actually
     approves. The merchant branch does confirm, so it is guarded - and a
     merchant who acknowledged in time is exempt via the predicate, so this only
     ever refuses a price nobody approved. */
  if v_target = 'confirmed'
     and private.couranr_quote_version_is_expired(v_quote) then
    raise exception 'quote_expired' using errcode = 'CR410';
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

revoke all on function public.couranr_apply_payment_intent_state(
  text,text,text,text,integer,integer,text,jsonb,timestamptz
) from public,anon,authenticated,service_role;
grant execute on function public.couranr_apply_payment_intent_state(
  text,text,text,text,integer,integer,text,jsonb,timestamptz
) to service_role;
revoke all on function public.couranr_accept_delivery_request_as_quoted(uuid,uuid,integer,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_accept_delivery_request_as_quoted(uuid,uuid,integer,uuid)
  to service_role;

revoke all on function public.couranr_create_consumer_guest_session(text,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_create_consumer_guest_session(text,integer)
  to service_role;

revoke all on function public.couranr_redeem_consumer_guest_session(text)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_redeem_consumer_guest_session(text)
  to service_role;

revoke all on function public.couranr_bind_consumer_guest_request(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_bind_consumer_guest_request(uuid,uuid)
  to service_role;

revoke all on function public.couranr_create_consumer_delivery_request_draft(
  uuid,text,jsonb,text,text,text,text,numeric,integer,text,boolean,text,jsonb,jsonb,boolean,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,text,text,text,timestamptz,jsonb,text
) from public, anon, authenticated, service_role;
grant execute on function public.couranr_create_consumer_delivery_request_draft(
  uuid,text,jsonb,text,text,text,text,numeric,integer,text,boolean,text,jsonb,jsonb,boolean,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,text,text,text,timestamptz,jsonb,text
) to service_role;

revoke all on function public.couranr_calculate_consumer_delivery_request_estimate(
  uuid,uuid,integer,boolean,text,text,text,text,numeric,integer,text,boolean,text,jsonb,jsonb,boolean,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,text,text,text,timestamptz,jsonb,text
) from public, anon, authenticated, service_role;
grant execute on function public.couranr_calculate_consumer_delivery_request_estimate(
  uuid,uuid,integer,boolean,text,text,text,text,numeric,integer,text,boolean,text,jsonb,jsonb,boolean,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,text,text,text,timestamptz,jsonb,text
) to service_role;

revoke all on function public.couranr_submit_consumer_delivery_request(uuid,uuid,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_submit_consumer_delivery_request(uuid,uuid,integer)
  to service_role;

commit;

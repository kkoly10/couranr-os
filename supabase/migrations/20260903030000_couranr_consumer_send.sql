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
--   3. CONSUMER SUBMIT. couranr_submit_delivery_request_v2 already branches
--      its event actor on requester_kind, but it cannot verify a guest
--      session, and leaving draft trips couranr_dr_consumer_submitted_contact_chk
--      (23514 -> opaque 'internal') when the frozen contact snapshot has
--      neither phone nor email. couranr_submit_consumer_delivery_request
--      verifies the session INSIDE SQL and refuses CR422
--      'consumer_contact_required' before the CHECK can. It submits FOR
--      COURANR REVIEW ONLY — no auto-accept: a customer-paid request reaches
--      its payable state (awaiting_quote_acceptance) through the existing
--      Operations accept command, exactly as a customer-paid business request
--      does, and payment unlocks only after that acceptance.
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
      and version=p_expected_version and request_state='draft'
    returning * into v_req;
  else
    update public.couranr_delivery_requests set
      loaded_miles=v_loaded_miles,normalized_request_payload=v_payload,
      timing_review_reasons=coalesce(p_timing_review_reasons,timing_review_reasons),
      version=p_expected_version+1,updated_at=now()
    where id=p_request_id and requester_kind='consumer'
      and idempotency_scope=v_scope
      and version=p_expected_version and request_state='draft'
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
    'draft','draft',jsonb_build_object(
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
     commands). A stale-quoted request may enter Couranr review; it just can
     never be paid at that price. NO AUTO-ACCEPT either: the request goes to
     pending_couranr_review, and only the existing Operations accept command
     moves a customer-paid request to its payable awaiting_quote_acceptance. */
  update public.couranr_delivery_requests set
    request_state='pending_couranr_review',review_state='pending',submitted_at=now(),
    version=p_expected_version+1,updated_at=now()
  where id=v_req.id and version=p_expected_version
  returning * into v_req;
  if not found then raise exception 'version_or_state_conflict' using errcode='CR409'; end if;

  insert into public.couranr_delivery_request_events(
    request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_req.id,null,'customer','submit_delivery_request','draft','pending_couranr_review',
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

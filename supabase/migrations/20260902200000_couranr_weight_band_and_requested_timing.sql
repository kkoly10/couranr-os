-- =====================================================================
-- COURANR WEIGHT BAND (SUR-001 cutover) AND REQUESTED TIMING (TMZ-001)
--
--   1. WEIGHT BAND. `weight_lb` stays nullable and gains a governed sibling,
--      `weight_band`. A request must say SOMETHING honest about weight —
--      an exact number when genuinely known, else a band (including
--      'unknown') — and nothing anywhere converts a band into pounds.
--      Historical rows keep their exact weights untouched; the quote
--      snapshot now records which KIND of weight knowledge priced it
--      ('exact' | 'band' | 'unresolved').
--
--   2. REQUESTED TIMING. The MVP operating timezone is the IANA zone
--      America/New_York by owner decision (TMZ-001). A request carries the
--      merchant's LOCAL wall-clock words verbatim plus the canonical
--      instant, validated TWO-SIDED like the traffic delay: the server
--      derives the instant with Intl tzdata, and this database re-derives it
--      with its own America/New_York rules and refuses a mismatch. Requested
--      timing is evidence of what was ASKED — never a confirmation.
--
-- ARITY. The two routed commands each gain five DEFAULTED parameters,
-- appended at the END. The old arity is DROPPED FIRST: with defaults, both
-- arities alive would make every named PostgREST call ambiguous (PGRST203).
-- Defaults are what keep the deploy gap safe — the already-deployed
-- application's calls, which do not send the new arguments, still resolve.
--
-- ADDITIVE otherwise: no column dropped, no row rewritten, no historical
-- quote reinterpreted. RE-RUNNABLE: every statement is create-or-replace,
-- drop-if-exists, add-column-if-exists-guarded or constraint drop+add.
-- =====================================================================

begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

do $guard$
begin
  if to_regprocedure('private.couranr_append_routed_quote_version(uuid,uuid,integer,text,text,integer,integer,numeric,jsonb,jsonb,bigint,integer,integer,integer,text,text,text)') is null then
    raise exception 'Weight band cutover requires the routing authority migration';
  end if;
  /* EITHER arity satisfies these — the old one on a first run, the new one on
     a re-run. Naming only the old arity would falsify the precondition on the
     recovery path, which is the PR #40 guard bug this shape exists to avoid. */
  if to_regprocedure('public.couranr_create_routed_delivery_request_draft(uuid,uuid,text,text,text,text,text,text,text,numeric,integer,text,boolean,text,jsonb,jsonb,boolean,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb)') is null
     and to_regprocedure('public.couranr_create_routed_delivery_request_draft(uuid,uuid,text,text,text,text,text,text,text,numeric,integer,text,boolean,text,jsonb,jsonb,boolean,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,text,text,text,timestamptz,jsonb,text)') is null then
    raise exception 'Weight band cutover requires the routed create command';
  end if;
  if to_regprocedure('public.couranr_calculate_routed_delivery_request_estimate(uuid,uuid,integer,uuid,boolean,text,text,text,text,text,text,numeric,integer,text,boolean,text,jsonb,jsonb,boolean,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb)') is null
     and to_regprocedure('public.couranr_calculate_routed_delivery_request_estimate(uuid,uuid,integer,uuid,boolean,text,text,text,text,text,text,numeric,integer,text,boolean,text,jsonb,jsonb,boolean,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,text,text,text,timestamptz,jsonb,text)') is null then
    raise exception 'Weight band cutover requires the routed estimate command';
  end if;
end
$guard$;

/* ------------------------------------------------------------- columns -- */

alter table public.couranr_delivery_requests
  add column if not exists weight_band            text,
  add column if not exists timing_intent          text,
  add column if not exists requested_pickup_local text,
  add column if not exists operating_timezone     text,
  add column if not exists requested_departure_at timestamptz,
  add column if not exists timing_review_reasons  jsonb not null default '[]'::jsonb,
  add column if not exists restricted_class       text;

comment on column public.couranr_delivery_requests.restricted_class is
  'The merchant''s shipment-safety declaration: none (affirms no prohibited class is present — the only value that permits an automatic estimated quote), a confirmed prohibited class (invalid quote only), or unknown (Couranr review). NULL on rows created before the declaration existed.';

comment on column public.couranr_delivery_requests.weight_band is
  'SUR-001 governed band when only the band is known. NEVER read back as pounds. weight_lb null + band present is the honest "band-only" state.';
comment on column public.couranr_delivery_requests.requested_pickup_local is
  'TMZ-001 merchant-entered LOCAL wall-clock time (YYYY-MM-DDTHH:MM) under America/New_York, preserved verbatim as evidence.';
comment on column public.couranr_delivery_requests.requested_departure_at is
  'TMZ-001 canonical instant of the requested departure. Two-sided validated against requested_pickup_local at the command boundary.';

alter table public.couranr_delivery_requests
  drop constraint if exists couranr_dr_weight_band_chk;
alter table public.couranr_delivery_requests
  add constraint couranr_dr_weight_band_chk check (
    weight_band is null
    or weight_band in ('0_25_lb','over_25_to_50_lb','over_50_lb','unknown'));

alter table public.couranr_delivery_requests
  drop constraint if exists couranr_dr_restricted_class_chk;
alter table public.couranr_delivery_requests
  add constraint couranr_dr_restricted_class_chk check (
    restricted_class is null or restricted_class in ('none','unknown',
      'alcohol','tobacco','vaping_nicotine','cannabis_thc','firearms','ammunition','prescription_medication','controlled_substances','fuel','compressed_gas','corrosive_hazmat','toxic_hazmat','infectious_material','regulated_dangerous_goods','fireworks','explosives','illegal_goods','stolen_goods','cash','negotiable_instruments','biological_specimens','live_animals','people'));

alter table public.couranr_delivery_requests
  drop constraint if exists couranr_dr_timing_intent_chk;
alter table public.couranr_delivery_requests
  add constraint couranr_dr_timing_intent_chk check (
    timing_intent is null or timing_intent in ('asap','scheduled'));

alter table public.couranr_delivery_requests
  drop constraint if exists couranr_dr_operating_tz_chk;
alter table public.couranr_delivery_requests
  add constraint couranr_dr_operating_tz_chk check (
    operating_timezone is null or operating_timezone = 'America/New_York');

alter table public.couranr_delivery_requests
  drop constraint if exists couranr_dr_scheduled_complete_chk;
alter table public.couranr_delivery_requests
  add constraint couranr_dr_scheduled_complete_chk check (
    timing_intent is distinct from 'scheduled'
    or (requested_pickup_local is not null
        and (requested_departure_at is not null
             /* TMZ-001 DST edges: a wall clock that does not exist or exists
                twice has NO canonical instant until the merchant clarifies;
                the row says which, and nothing shifts or picks for them. */
             or timing_review_reasons ?| array['requested_time_nonexistent','requested_time_ambiguous'])));

alter table public.couranr_delivery_requests
  drop constraint if exists couranr_dr_requested_local_format_chk;
alter table public.couranr_delivery_requests
  add constraint couranr_dr_requested_local_format_chk check (
    requested_pickup_local is null
    or requested_pickup_local ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$');

alter table public.couranr_delivery_requests
  drop constraint if exists couranr_dr_timing_reasons_array_chk;
alter table public.couranr_delivery_requests
  add constraint couranr_dr_timing_reasons_array_chk check (
    jsonb_typeof(timing_review_reasons) = 'array');


/* ------------------------------------------------ shared command guards -- */
/* Both routed commands share these; defined in `private` like the appender
   so nothing outside the command boundary can call them. */

create or replace function private.couranr_assert_safety_declaration(
  p_restricted_class text, p_quote_status text
) returns void language plpgsql security invoker set search_path='' as $fn$
begin
  /* Shipment-safety declaration (correction pass §2). The database holds the
     rule so NO application path — AI-assisted or manual — can mint an
     automatic payable quote without the merchant's trusted affirmation that
     none of Couranr's prohibited classes is present, and a confirmed
     prohibited class can only ever be stored as an invalid quote.
     DEPLOY GAP: an application that does not yet send the declaration is
     refused for estimated quotes (never silently allowed); apply this
     migration and deploy the application in the same release window. */
  if p_restricted_class is not null and p_restricted_class not in ('none','unknown',
      'alcohol','tobacco','vaping_nicotine','cannabis_thc','firearms','ammunition','prescription_medication','controlled_substances','fuel','compressed_gas','corrosive_hazmat','toxic_hazmat','infectious_material','regulated_dangerous_goods','fireworks','explosives','illegal_goods','stolen_goods','cash','negotiable_instruments','biological_specimens','live_animals','people') then
    raise exception 'restricted_class_invalid' using errcode='CR422';
  end if;
  if p_quote_status = 'estimated' and coalesce(p_restricted_class,'unknown') <> 'none' then
    raise exception 'safety_declaration_required' using errcode='CR422';
  end if;
  if p_restricted_class not in ('none','unknown') and p_restricted_class is not null
     and p_quote_status <> 'invalid' then
    raise exception 'prohibited_class_requires_invalid_quote' using errcode='CR422';
  end if;
end
$fn$;

create or replace function private.couranr_assert_requested_timing(
  p_requested_pickup_local text, p_requested_departure_at timestamptz,
  p_timing_review_reasons jsonb
) returns void language plpgsql security invoker set search_path='' as $fn$
declare
  v_reasons jsonb := coalesce(p_timing_review_reasons,'[]'::jsonb);
  v_pg_instant timestamptz;
begin
  if p_requested_pickup_local is null then
    raise exception 'scheduled_timing_incomplete' using errcode='CR422';
  end if;
  v_pg_instant := replace(p_requested_pickup_local,'T',' ')::timestamp
                    at time zone 'America/New_York';
  if p_requested_departure_at is not null then
    /* TMZ-001 two-sided timing validation, same shape as the traffic-delay
       rule: the caller supplies BOTH the merchant's local wall-clock words
       and the canonical instant, and the database re-derives the instant
       with its own America/New_York tzdata and refuses a mismatch. Neither
       side is trusted alone. */
    if p_requested_departure_at is distinct from v_pg_instant then
      raise exception 'requested_departure_mismatch' using errcode='CR422';
    end if;
    return;
  end if;
  /* No canonical instant. The ONLY legitimate reason is a DST edge the
     caller has classified: a wall clock that does not exist (spring-forward
     gap) or exists twice (fall-back repeat). Nothing shifts or picks for the
     merchant — the words are preserved, the instant stays unresolved, and
     the request goes to review. The database checks the classification
     with its own tzdata so the claim cannot be used to skip the two-sided
     rule for an ordinary time. */
  if not (v_reasons ?| array['requested_time_nonexistent','requested_time_ambiguous']) then
    raise exception 'scheduled_timing_incomplete' using errcode='CR422';
  end if;
  if v_reasons ? 'requested_time_nonexistent'
     and to_char(v_pg_instant at time zone 'America/New_York','YYYY-MM-DD"T"HH24:MI')
         = p_requested_pickup_local then
    -- PostgreSQL shows the same wall clock back: the time exists after all.
    raise exception 'nonexistent_time_claim_rejected' using errcode='CR422';
  end if;
  if v_reasons ? 'requested_time_ambiguous'
     and to_char((v_pg_instant - interval '1 hour') at time zone 'America/New_York',
                 'YYYY-MM-DD"T"HH24:MI') <> p_requested_pickup_local
     and to_char((v_pg_instant + interval '1 hour') at time zone 'America/New_York',
                 'YYYY-MM-DD"T"HH24:MI') <> p_requested_pickup_local then
    -- Neither neighbouring hour shows the same wall clock: not a repeat.
    raise exception 'ambiguous_time_claim_rejected' using errcode='CR422';
  end if;
end
$fn$;

revoke all on function private.couranr_assert_safety_declaration(text,text)
  from public, anon, authenticated;
revoke all on function private.couranr_assert_requested_timing(text,timestamptz,jsonb)
  from public, anon, authenticated;

/* ------------------------------------------- routed commands, new arity -- */
/* Old arity dropped FIRST — see the ARITY note in the header. */

drop function if exists public.couranr_create_routed_delivery_request_draft(
  uuid,uuid,text,text,text,text,text,text,text,numeric,integer,text,boolean,text,jsonb,jsonb,boolean,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb
);

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
  p_billable_loaded_miles numeric,p_quote_line_items jsonb,p_review_reasons jsonb,
  /* SUR-001 / TMZ-001 — appended with defaults so the deploy gap is safe:
     the already-deployed application's named calls, which do not send these,
     still resolve against this function. */
  p_weight_band text default null,
  p_timing_intent text default null,
  p_requested_pickup_local text default null,
  p_requested_departure_at timestamptz default null,
  p_timing_review_reasons jsonb default null,
  /* Shipment-safety declaration (correction pass §2). Appended with a default
     for the same deploy-gap reason; a caller that does not send it is
     treated as "unknown", which cannot mint an estimated quote. */
  p_restricted_class text default null
)
returns public.couranr_delivery_requests
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_quote public.couranr_quote_versions;
  v_loaded_miles numeric(10,3);
begin
  /* SUR-001: at least one honest weight statement. NULL exact weight is a
     legitimate state; what is refused is a request that says NOTHING about
     weight, because nothing downstream may invent it. */
  if p_weight_lb is null and p_weight_band is null then
    raise exception 'weight_or_band_required' using errcode='CR422';
  end if;
  /* 0 lb is never a measured weight and never a synthetic "unknown": unknown
     is weight_band = unknown with a NULL exact weight. Historical rows are
     untouched (this is a command guard, not a table CHECK). */
  if p_weight_lb is not null and p_weight_lb <= 0 then
    raise exception 'weight_must_be_positive' using errcode='CR422';
  end if;
  perform private.couranr_assert_safety_declaration(p_restricted_class, p_quote_status);
  /* TMZ-001 two-sided timing validation, same shape as the traffic-delay
     rule: the caller supplies BOTH the merchant's local wall-clock words and
     the canonical instant, and the database re-derives the instant with its
     own America/New_York tzdata and refuses a mismatch. Neither side is
     trusted alone. */
  if p_timing_intent = 'scheduled' then
    perform private.couranr_assert_requested_timing(
      p_requested_pickup_local, p_requested_departure_at, p_timing_review_reasons);
  end if;

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
      loaded_miles,weight_lb,weight_band,restricted_class,additional_stops,
      timing_intent,requested_pickup_local,operating_timezone,
      requested_departure_at,timing_review_reasons,
      service_level,signature_required,proof_method,
      pickup_address,dropoff_address,normalized_request_payload,
      quote_status,quote_line_items,review_reasons,
      rounding_applied,tax_included,payment_due_cents
    ) values (
      p_business_account_id,p_created_by,p_idempotency_key,
      'draft','not_required','pending',p_source,p_readiness_state,p_payer_type,
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

drop function if exists public.couranr_calculate_routed_delivery_request_estimate(
  uuid,uuid,integer,uuid,boolean,text,text,text,text,text,text,numeric,integer,text,boolean,text,jsonb,jsonb,boolean,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb
);

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
  p_billable_loaded_miles numeric,p_quote_line_items jsonb,p_review_reasons jsonb,
  /* SUR-001 / TMZ-001 — appended with defaults so the deploy gap is safe:
     the already-deployed application's named calls, which do not send these,
     still resolve against this function. */
  p_weight_band text default null,
  p_timing_intent text default null,
  p_requested_pickup_local text default null,
  p_requested_departure_at timestamptz default null,
  p_timing_review_reasons jsonb default null,
  /* Shipment-safety declaration (correction pass §2), see the create command. */
  p_restricted_class text default null
)
returns public.couranr_delivery_requests
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_quote public.couranr_quote_versions;
  v_loaded_miles numeric(10,3);
  v_payload jsonb;
  v_stored_declaration text;
begin
  /* SUR-001: at least one honest weight statement — but ONLY when this call
     REWRITES the shipment. In the no-update branch the stored row is
     authoritative and already satisfied the rule at creation; found by
     executing this function, not by reading it. */
  if p_update_shipment and p_weight_lb is null and p_weight_band is null then
    raise exception 'weight_or_band_required' using errcode='CR422';
  end if;
  if p_update_shipment and p_weight_lb is not null and p_weight_lb <= 0 then
    raise exception 'weight_must_be_positive' using errcode='CR422';
  end if;
  /* The declaration being committed is the argument when the shipment is
     rewritten, else the stored one; either way an estimated quote needs a
     trusted "none". */
  select restricted_class into v_stored_declaration
    from public.couranr_delivery_requests
   where id = p_request_id and business_account_id = p_business_account_id;
  perform private.couranr_assert_safety_declaration(
    case when p_update_shipment then p_restricted_class
         else coalesce(p_restricted_class, v_stored_declaration) end,
    p_quote_status);
  /* TMZ-001 two-sided timing validation, same shape as the traffic-delay
     rule: the caller supplies BOTH the merchant's local wall-clock words and
     the canonical instant, and the database re-derives the instant with its
     own America/New_York tzdata and refuses a mismatch. Neither side is
     trusted alone. */
  if p_timing_intent = 'scheduled' then
    perform private.couranr_assert_requested_timing(
      p_requested_pickup_local, p_requested_departure_at, p_timing_review_reasons);
  end if;

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
    where id=p_request_id and business_account_id=p_business_account_id
      and version=p_expected_version and request_state='draft'
    returning * into v_req;
  else
    update public.couranr_delivery_requests set
      loaded_miles=v_loaded_miles,normalized_request_payload=v_payload,
      /* The stored shipment (weight, band, requested timing) is authoritative
         in this branch; only the SERVER-derived timing evaluation refreshes,
         because "is that requested time still fine" legitimately changes as
         the clock moves. */
      timing_review_reasons=coalesce(p_timing_review_reasons,timing_review_reasons),
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

/* -------------------------------------- appender: truthful snapshots ---- */
/* Same signature, replaced in place. Produced by transforming the live body
   from 20260902161642 — only the shipment-snapshot object changed. */

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

/* ---------------------------------------------------------------- grants - */
/* pg_default_acl grants arwdDxtm to anon/authenticated/service_role on every
   new function here, so each new arity is locked down by hand. */

revoke all on function public.couranr_create_routed_delivery_request_draft(
  uuid,uuid,text,text,text,text,text,text,text,numeric,integer,text,boolean,text,jsonb,jsonb,boolean,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,text,text,text,timestamptz,jsonb,text
) from public, anon, authenticated, service_role;
grant execute on function public.couranr_create_routed_delivery_request_draft(
  uuid,uuid,text,text,text,text,text,text,text,numeric,integer,text,boolean,text,jsonb,jsonb,boolean,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,text,text,text,timestamptz,jsonb,text
) to service_role;

revoke all on function public.couranr_calculate_routed_delivery_request_estimate(
  uuid,uuid,integer,uuid,boolean,text,text,text,text,text,text,numeric,integer,text,boolean,text,jsonb,jsonb,boolean,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,text,text,text,timestamptz,jsonb,text
) from public, anon, authenticated, service_role;
grant execute on function public.couranr_calculate_routed_delivery_request_estimate(
  uuid,uuid,integer,uuid,boolean,text,text,text,text,text,text,numeric,integer,text,boolean,text,jsonb,jsonb,boolean,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,text,text,text,timestamptz,jsonb,text
) to service_role;

revoke all on function private.couranr_append_routed_quote_version(
  uuid,uuid,integer,text,text,integer,integer,numeric,jsonb,jsonb,bigint,integer,integer,integer,text,text,text
) from public, anon, authenticated, service_role;
grant execute on function private.couranr_append_routed_quote_version(
  uuid,uuid,integer,text,text,integer,integer,numeric,jsonb,jsonb,bigint,integer,integer,integer,text,text,text
) to service_role;

commit;

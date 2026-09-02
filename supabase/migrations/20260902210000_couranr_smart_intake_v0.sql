-- =====================================================================
-- COURANR SMART INTAKE V0 (P5-001) — durable input enrichment
--
-- Smart Intake is NOT a second request system. The canonical request stays
-- couranr_delivery_requests; the canonical commercial quote stays
-- couranr_quote_versions. What lives here is the evidence layer between a
-- merchant's sentence and the canonical command boundary:
--
--   couranr_intake_sessions               mutable head (one per request)
--   couranr_intake_description_revisions  APPEND-ONLY raw merchant words
--   couranr_intake_runs                   interpretation attempts + AI audit
--   couranr_intake_facts                  current fact set with provenance
--   couranr_intake_fact_events            APPEND-ONLY correction history
--
-- Append-only is enforced the M2 way: by the GRANT shape (SELECT+INSERT and
-- no UPDATE/DELETE), not by trusting callers.
--
-- THE GOVERNING RULE. AI proposes; Couranr validates; a trusted actor
-- confirms material facts; the server commits. Concretely here:
--
--   * a completion whose source_revision is no longer current is recorded as
--     'superseded' evidence and CANNOT touch facts, the clarification, or
--     the session head (§6 stale-result safety);
--   * a proposal NEVER replaces a fact whose authority is confirmed or
--     overridden — the disagreement is retained as an audit event instead
--     (§5 confirmed-fact protection);
--   * begin_intake_run converges on (session_id, idempotency_key), so a
--     double click or lost HTTP response cannot mint two authoritative
--     interpretations (§7);
--   * fact keys are a CLOSED vocabulary CHECK — an unknown model field has
--     nowhere to land (§16);
--   * commit-to-request wraps the routed estimate command in ONE
--     transaction, re-validating the committed shipment arguments against
--     the CURRENT trusted facts, so a stale read cannot mint a quote from
--     facts the merchant has since changed (§26).
--
-- ADDITIVE and RE-RUNNABLE throughout.
-- =====================================================================

begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

do $guard$
begin
  if to_regclass('public.couranr_delivery_requests') is null
     or to_regclass('public.couranr_quote_versions') is null then
    raise exception 'Smart Intake requires the Foundation request/quote spine';
  end if;
  if to_regprocedure('public.couranr_calculate_routed_delivery_request_estimate(uuid,uuid,integer,uuid,boolean,text,text,text,text,text,text,numeric,integer,text,boolean,text,jsonb,jsonb,boolean,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,text,text,text,timestamptz,jsonb)') is null then
    raise exception 'Smart Intake requires the weight-band/timing arity of the routed estimate';
  end if;
end
$guard$;

/* -------------------------------------------------------------- tables -- */

create table if not exists public.couranr_intake_sessions (
  id                    uuid primary key default gen_random_uuid(),
  business_account_id   uuid not null,
  request_id            uuid references public.couranr_delivery_requests(id),
  created_by_user_id    uuid not null,
  current_revision      integer not null default 1,
  current_run_id        uuid,
  current_clarification jsonb,
  interpretation_status text not null default 'none',
  fact_schema_version   text not null,
  -- Deterministic policy evaluation snapshot (§13). Reasons and signals are
  -- persisted SEPARATELY so an Ops screen can show "Couranr's rules said X"
  -- and "the model worried about Y" as the different things they are.
  policy_disposition    text,
  policy_reasons        jsonb not null default '[]'::jsonb,
  policy_risk_signals   jsonb not null default '[]'::jsonb,
  policy_unresolved     jsonb not null default '[]'::jsonb,
  policy_version        text,
  operational_capability text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint couranr_is_status_chk check (interpretation_status in
    ('none','pending','interpreted','manual','provider_unavailable')),
  constraint couranr_is_policy_chk check (policy_disposition is null
    or policy_disposition in ('allowed','needs_review','prohibited')),
  constraint couranr_is_capability_chk check (operational_capability is null
    or operational_capability in ('standard_lane','needs_review','unsupported')),
  constraint couranr_is_revision_chk check (current_revision >= 1),
  -- One intake session per canonical request: intake ENRICHES the request,
  -- it never forks a rival identity.
  constraint couranr_is_request_uniq unique (request_id)
);

create index if not exists couranr_is_business_idx
  on public.couranr_intake_sessions(business_account_id, created_at desc);

create table if not exists public.couranr_intake_description_revisions (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.couranr_intake_sessions(id),
  revision      integer not null,
  raw_description text not null,
  actor_user_id uuid not null,
  source        text not null default 'merchant_statement',
  created_at    timestamptz not null default now(),

  constraint couranr_idr_uniq unique (session_id, revision),
  constraint couranr_idr_source_chk check (source in
    ('merchant_statement','clarification_response')),
  -- Bounded evidence: long enough for any honest description, short enough
  -- that nobody can park a novel (or a prompt-injection payload of arbitrary
  -- size) in the evidence store.
  constraint couranr_idr_length_chk check (
    length(raw_description) between 1 and 4000)
);

create table if not exists public.couranr_intake_runs (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null references public.couranr_intake_sessions(id),
  source_revision     integer not null,
  prompt_version      text not null,
  fact_schema_version text not null,
  provider            text not null,
  provider_model      text,
  idempotency_key     text not null,
  status              text not null default 'pending',
  -- §19 audit: what CLASSES of data went to the provider (never the payload
  -- itself), when, how long, and the hash of the validated output.
  input_data_classes  jsonb not null default '[]'::jsonb,
  output_hash         text,
  proposals           jsonb,
  started_at          timestamptz not null default now(),
  completed_at        timestamptz,
  latency_ms          integer,
  created_at          timestamptz not null default now(),

  constraint couranr_ir_uniq unique (session_id, idempotency_key),
  constraint couranr_ir_status_chk check (status in
    ('pending','success','timeout','unavailable','malformed','validation_failed','superseded')),
  constraint couranr_ir_revision_chk check (source_revision >= 1)
);

create table if not exists public.couranr_intake_facts (
  id                    uuid primary key default gen_random_uuid(),
  session_id            uuid not null references public.couranr_intake_sessions(id),
  fact_key              text not null,
  value                 jsonb not null,
  confidence            integer,
  source                text not null,
  source_evidence       text,
  requires_confirmation boolean not null default false,
  authority             text not null,
  actor_user_id         uuid,
  revision              integer not null default 1,
  run_id                uuid references public.couranr_intake_runs(id),
  updated_at            timestamptz not null default now(),

  constraint couranr_if_uniq unique (session_id, fact_key),
  -- §16: the CLOSED V0 fact vocabulary. An unknown model field has nowhere
  -- to land — this CHECK is the database half of that promise.
  constraint couranr_if_key_chk check (fact_key in (
    'merchant_reference','item_category','item_subtype','quantity',
    'package_count','weight_lb_exact','weight_band','dimensions_in',
    'size_bulk','declared_value_band','fragile','temperature_sensitive',
    'handling_requirements','loading_uncertainty','stairs_access',
    'setup_breakdown','special_equipment','vehicle_requirement',
    'restricted_class','battery_condition','timing_intent',
    'requested_pickup_local','service_level','payer_type','proof_signature')),
  constraint couranr_if_source_chk check (source in
    ('merchant_statement','saved_preset','merchant_default',
     'previous_confirmed_delivery','ai_inference','deterministic_policy','unknown')),
  constraint couranr_if_authority_chk check (authority in
    ('proposed','confirmed','overridden','unknown')),
  constraint couranr_if_confidence_chk check (confidence is null
    or (confidence >= 0 and confidence <= 100)),
  constraint couranr_if_evidence_len_chk check (source_evidence is null
    or length(source_evidence) <= 500)
);

create table if not exists public.couranr_intake_fact_events (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.couranr_intake_sessions(id),
  fact_key       text not null,
  event          text not null,
  from_value     jsonb,
  to_value       jsonb,
  from_authority text,
  to_authority   text,
  actor_user_id  uuid,
  run_id         uuid references public.couranr_intake_runs(id),
  created_at     timestamptz not null default now(),

  constraint couranr_ife_event_chk check (event in
    ('proposed','confirmed','overridden','ai_disagreement_retained',
     'committed_to_request'))
);

create index if not exists couranr_ife_session_idx
  on public.couranr_intake_fact_events(session_id, created_at);

/* ------------------------------------------------------ table privileges */
/* Server-only, like every canonical couranr_* table: RLS on, zero policies,
   and the GRANT is the real boundary (service_role bypasses RLS). The two
   evidence tables get NO update/delete grant — append-only by privilege. */

alter table public.couranr_intake_sessions enable row level security;
revoke all on table public.couranr_intake_sessions
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.couranr_intake_sessions to service_role;

alter table public.couranr_intake_description_revisions enable row level security;
revoke all on table public.couranr_intake_description_revisions
  from public, anon, authenticated, service_role;
grant select, insert on table public.couranr_intake_description_revisions to service_role;

alter table public.couranr_intake_runs enable row level security;
revoke all on table public.couranr_intake_runs
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.couranr_intake_runs to service_role;

alter table public.couranr_intake_facts enable row level security;
revoke all on table public.couranr_intake_facts
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.couranr_intake_facts to service_role;

alter table public.couranr_intake_fact_events enable row level security;
revoke all on table public.couranr_intake_fact_events
  from public, anon, authenticated, service_role;
grant select, insert on table public.couranr_intake_fact_events to service_role;

/* ------------------------------------------------------------ commands -- */

create or replace function public.couranr_create_intake_session(
  p_business_account_id uuid,
  p_request_id          uuid,
  p_actor_user_id       uuid,
  p_description         text,
  p_fact_schema_version text
)
returns public.couranr_intake_sessions
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_session public.couranr_intake_sessions;
begin
  if p_description is null or length(btrim(p_description)) = 0
     or length(p_description) > 4000 then
    raise exception 'description_required' using errcode='CR422';
  end if;
  if p_request_id is not null and not exists (
    select 1 from public.couranr_delivery_requests
     where id = p_request_id and business_account_id = p_business_account_id) then
    -- Cross-tenant linkage refused with the same NOT-FOUND shape a probe
    -- would get for a request that does not exist at all.
    raise exception 'request_not_found' using errcode='CR404';
  end if;

  insert into public.couranr_intake_sessions(
    business_account_id, request_id, created_by_user_id, fact_schema_version,
    interpretation_status
  ) values (
    p_business_account_id, p_request_id, p_actor_user_id,
    coalesce(p_fact_schema_version,'couranr-shipment-facts-v0-2026-09-02'),
    'none'
  ) returning * into v_session;

  insert into public.couranr_intake_description_revisions(
    session_id, revision, raw_description, actor_user_id, source
  ) values (v_session.id, 1, p_description, p_actor_user_id, 'merchant_statement');

  return v_session;
end
$fn$;

create or replace function public.couranr_add_intake_revision(
  p_session_id        uuid,
  p_business_account_id uuid,
  p_actor_user_id     uuid,
  p_description       text,
  p_expected_revision integer,
  p_source            text
)
returns public.couranr_intake_sessions
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_session public.couranr_intake_sessions;
begin
  if p_description is null or length(btrim(p_description)) = 0
     or length(p_description) > 4000 then
    raise exception 'description_required' using errcode='CR422';
  end if;

  update public.couranr_intake_sessions
     set current_revision = p_expected_revision + 1,
         updated_at = now()
   where id = p_session_id
     and business_account_id = p_business_account_id
     and current_revision = p_expected_revision
  returning * into v_session;
  if not found then
    if not exists (select 1 from public.couranr_intake_sessions
                    where id = p_session_id
                      and business_account_id = p_business_account_id) then
      raise exception 'intake_session_not_found' using errcode='CR404';
    end if;
    raise exception 'version_or_state_conflict' using errcode='CR409';
  end if;

  -- The ORIGINAL merchant statement is never overwritten: every edit and
  -- every clarification answer is a NEW append-only revision.
  insert into public.couranr_intake_description_revisions(
    session_id, revision, raw_description, actor_user_id, source
  ) values (
    p_session_id, v_session.current_revision, p_description, p_actor_user_id,
    case when p_source = 'clarification_response'
         then 'clarification_response' else 'merchant_statement' end
  );

  return v_session;
end
$fn$;

create or replace function public.couranr_begin_intake_run(
  p_session_id          uuid,
  p_business_account_id uuid,
  p_source_revision     integer,
  p_prompt_version      text,
  p_fact_schema_version text,
  p_provider            text,
  p_idempotency_key     text,
  p_input_data_classes  jsonb
)
returns public.couranr_intake_runs
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_session public.couranr_intake_sessions;
  v_run public.couranr_intake_runs;
begin
  select * into v_session from public.couranr_intake_sessions
   where id = p_session_id and business_account_id = p_business_account_id;
  if not found then
    raise exception 'intake_session_not_found' using errcode='CR404';
  end if;
  if p_source_revision is distinct from v_session.current_revision then
    -- Interpreting anything but the CURRENT words is wasted provider money
    -- and a stale-result hazard; refuse up front.
    raise exception 'stale_source_revision' using errcode='CR409';
  end if;
  if jsonb_typeof(coalesce(p_input_data_classes,'[]'::jsonb)) <> 'array' then
    raise exception 'input_data_classes_must_be_array' using errcode='CR422';
  end if;

  -- §7 idempotency: one logical operation converges onto one run, however
  -- many times the HTTP layer retried it.
  insert into public.couranr_intake_runs(
    session_id, source_revision, prompt_version, fact_schema_version,
    provider, idempotency_key, input_data_classes, status
  ) values (
    p_session_id, p_source_revision, p_prompt_version,
    coalesce(p_fact_schema_version, v_session.fact_schema_version),
    p_provider, p_idempotency_key, coalesce(p_input_data_classes,'[]'::jsonb),
    'pending'
  )
  on conflict (session_id, idempotency_key) do nothing;

  select * into v_run from public.couranr_intake_runs
   where session_id = p_session_id and idempotency_key = p_idempotency_key;

  update public.couranr_intake_sessions
     set interpretation_status = case when interpretation_status = 'none'
                                      then 'pending' else interpretation_status end,
         updated_at = now()
   where id = p_session_id;

  return v_run;
end
$fn$;

create or replace function public.couranr_complete_intake_run(
  p_run_id              uuid,
  p_business_account_id uuid,
  p_status              text,
  p_proposals           jsonb,
  p_output_hash         text,
  p_latency_ms          integer,
  p_clarification       jsonb
)
returns public.couranr_intake_runs
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_run public.couranr_intake_runs;
  v_session public.couranr_intake_sessions;
  v_proposal jsonb;
  v_key text;
  v_existing public.couranr_intake_facts;
  v_effective_status text;
begin
  if p_status not in ('success','timeout','unavailable','malformed','validation_failed') then
    raise exception 'invalid_run_status' using errcode='CR422';
  end if;

  select r.* into v_run
    from public.couranr_intake_runs r
    join public.couranr_intake_sessions s on s.id = r.session_id
   where r.id = p_run_id and s.business_account_id = p_business_account_id
   for update of r;
  if not found then
    raise exception 'intake_run_not_found' using errcode='CR404';
  end if;
  if v_run.status <> 'pending' then
    -- Idempotent completion: the first outcome stands; a duplicate delivery
    -- of the same completion is answered with the stored row, and a
    -- CONFLICTING second completion cannot rewrite history.
    return v_run;
  end if;

  select * into v_session from public.couranr_intake_sessions
   where id = v_run.session_id for update;

  /* §6 STALE GATE. A completion for words the merchant has since changed is
     evidence, never authority: it keeps its proposals for audit, is marked
     superseded, and touches NOTHING current — not facts, not the
     clarification, not the session head. */
  if v_run.source_revision is distinct from v_session.current_revision then
    v_effective_status := 'superseded';
  else
    v_effective_status := p_status;
  end if;

  update public.couranr_intake_runs
     set status = v_effective_status,
         proposals = p_proposals,
         output_hash = p_output_hash,
         latency_ms = p_latency_ms,
         completed_at = now()
   where id = p_run_id
  returning * into v_run;

  if v_effective_status = 'success' then
    for v_proposal in
      select jsonb_array_elements(coalesce(p_proposals,'[]'::jsonb))
    loop
      v_key := v_proposal->>'key';
      -- §16: unknown model fields never become canonical facts. The validated
      -- TS layer already dropped them; this skip is the database's own copy of
      -- the rule, so one junk key cannot abort an otherwise-valid completion
      -- against the facts table CHECK.
      if v_key is null or v_key not in (
        'merchant_reference','item_category','item_subtype','quantity',
        'package_count','weight_lb_exact','weight_band','dimensions_in',
        'size_bulk','declared_value_band','fragile','temperature_sensitive',
        'handling_requirements','loading_uncertainty','stairs_access',
        'setup_breakdown','special_equipment','vehicle_requirement',
        'restricted_class','battery_condition','timing_intent',
        'requested_pickup_local','service_level','payer_type','proof_signature'
      ) then continue; end if;

      select * into v_existing from public.couranr_intake_facts
       where session_id = v_run.session_id and fact_key = v_key;

      if found and v_existing.authority in ('confirmed','overridden') then
        -- §5: the trusted fact stands. The model's disagreement is retained
        -- as evidence, never applied.
        if v_existing.value is distinct from v_proposal->'value' then
          insert into public.couranr_intake_fact_events(
            session_id, fact_key, event, from_value, to_value,
            from_authority, to_authority, run_id
          ) values (
            v_run.session_id, v_key, 'ai_disagreement_retained',
            v_existing.value, v_proposal->'value',
            v_existing.authority, v_existing.authority, p_run_id
          );
        end if;
        continue;
      end if;

      insert into public.couranr_intake_facts(
        session_id, fact_key, value, confidence, source, source_evidence,
        requires_confirmation, authority, revision, run_id, updated_at
      ) values (
        v_run.session_id, v_key, v_proposal->'value',
        nullif(v_proposal->>'confidence','')::integer,
        coalesce(v_proposal->>'source','ai_inference'),
        left(v_proposal->>'sourceEvidence', 500),
        coalesce((v_proposal->>'requiresConfirmation')::boolean, true),
        'proposed', 1, p_run_id, now()
      )
      on conflict (session_id, fact_key) do update set
        value = excluded.value,
        confidence = excluded.confidence,
        source = excluded.source,
        source_evidence = excluded.source_evidence,
        requires_confirmation = excluded.requires_confirmation,
        authority = 'proposed',
        revision = public.couranr_intake_facts.revision + 1,
        run_id = excluded.run_id,
        updated_at = now();

      insert into public.couranr_intake_fact_events(
        session_id, fact_key, event, to_value, to_authority, run_id
      ) values (
        v_run.session_id, v_key, 'proposed', v_proposal->'value', 'proposed', p_run_id
      );
    end loop;

    update public.couranr_intake_sessions
       set current_run_id = p_run_id,
           interpretation_status = 'interpreted',
           current_clarification = p_clarification,
           updated_at = now()
     where id = v_run.session_id;
  elsif v_effective_status in ('timeout','unavailable','malformed','validation_failed') then
    -- Provider trouble degrades to MANUAL immediately; the request flow is
    -- never blocked on a model.
    update public.couranr_intake_sessions
       set interpretation_status = case when v_effective_status = 'unavailable'
                                        then 'provider_unavailable' else 'manual' end,
           updated_at = now()
     where id = v_run.session_id;
  end if;
  -- 'superseded' deliberately falls through: nothing current changes.

  return v_run;
end
$fn$;

create or replace function public.couranr_confirm_intake_fact(
  p_session_id          uuid,
  p_business_account_id uuid,
  p_actor_user_id       uuid,
  p_fact_key            text,
  p_value               jsonb,
  p_authority           text
)
returns public.couranr_intake_facts
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_session public.couranr_intake_sessions;
  v_existing public.couranr_intake_facts;
  v_fact public.couranr_intake_facts;
begin
  if p_authority not in ('confirmed','overridden') then
    raise exception 'authority_must_be_trusted' using errcode='CR422';
  end if;
  select * into v_session from public.couranr_intake_sessions
   where id = p_session_id and business_account_id = p_business_account_id
   for update;
  if not found then
    raise exception 'intake_session_not_found' using errcode='CR404';
  end if;

  select * into v_existing from public.couranr_intake_facts
   where session_id = p_session_id and fact_key = p_fact_key;

  insert into public.couranr_intake_facts(
    session_id, fact_key, value, confidence, source, requires_confirmation,
    authority, actor_user_id, revision, updated_at
  ) values (
    p_session_id, p_fact_key, p_value, null, 'merchant_statement', false,
    p_authority, p_actor_user_id, 1, now()
  )
  on conflict (session_id, fact_key) do update set
    value = excluded.value,
    confidence = null,
    source = 'merchant_statement',
    requires_confirmation = false,
    authority = excluded.authority,
    actor_user_id = excluded.actor_user_id,
    revision = public.couranr_intake_facts.revision + 1,
    updated_at = now()
  returning * into v_fact;

  insert into public.couranr_intake_fact_events(
    session_id, fact_key, event, from_value, to_value,
    from_authority, to_authority, actor_user_id
  ) values (
    p_session_id, p_fact_key,
    case when p_authority = 'overridden' then 'overridden' else 'confirmed' end,
    v_existing.value, p_value, v_existing.authority, p_authority, p_actor_user_id
  );

  -- Answering the current clarification clears it; the next interpretation
  -- or policy pass may set a new one.
  update public.couranr_intake_sessions
     set current_clarification = case
           when current_clarification->>'factKey' = p_fact_key then null
           else current_clarification end,
         updated_at = now()
   where id = p_session_id;

  return v_fact;
end
$fn$;

create or replace function public.couranr_record_intake_policy(
  p_session_id            uuid,
  p_business_account_id   uuid,
  p_policy_disposition    text,
  p_policy_reasons        jsonb,
  p_policy_risk_signals   jsonb,
  p_policy_unresolved     jsonb,
  p_policy_version        text,
  p_operational_capability text,
  p_clarification         jsonb,
  /* The run this evaluation was derived from. A policy pass computed after a
     run that has since been superseded must NOT overwrite the current
     clarification/policy — the same §6 stale rule, one layer up. Null means
     a manual-path evaluation with no run. */
  p_run_id                uuid default null
)
returns public.couranr_intake_sessions
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_session public.couranr_intake_sessions;
begin
  if p_run_id is not null then
    select * into v_session from public.couranr_intake_sessions
     where id = p_session_id and business_account_id = p_business_account_id
     for update;
    if not found then
      raise exception 'intake_session_not_found' using errcode='CR404';
    end if;
    if v_session.current_run_id is distinct from p_run_id then
      raise exception 'stale_interpretation_run' using errcode='CR409';
    end if;
  end if;
  update public.couranr_intake_sessions
     set policy_disposition = p_policy_disposition,
         policy_reasons = coalesce(p_policy_reasons,'[]'::jsonb),
         policy_risk_signals = coalesce(p_policy_risk_signals,'[]'::jsonb),
         policy_unresolved = coalesce(p_policy_unresolved,'[]'::jsonb),
         policy_version = p_policy_version,
         operational_capability = p_operational_capability,
         current_clarification = p_clarification,
         updated_at = now()
   where id = p_session_id and business_account_id = p_business_account_id
  returning * into v_session;
  if not found then
    raise exception 'intake_session_not_found' using errcode='CR404';
  end if;
  return v_session;
end
$fn$;

/* §26 — commit confirmed intake facts through the CANONICAL command, in one
   transaction. The routed estimate performs the actual request/quote write
   under its own CAS; this wrapper's added value is that the shipment
   arguments being committed are RE-VALIDATED against the CURRENT trusted
   facts while both are locked, so a stale read in the application cannot
   mint a quote from facts the merchant has since changed. */
create or replace function public.couranr_commit_intake_to_request(
  p_session_id uuid,
  p_expected_intake_revision integer,
  -- everything the routed estimate takes, passed through verbatim:
  p_request_id uuid,p_business_account_id uuid,p_expected_version integer,
  p_actor_user_id uuid,p_update_shipment boolean,
  p_source text,p_readiness_state text,p_payer_type text,
  p_recipient_name text,p_recipient_phone text,p_recipient_email text,
  p_weight_lb numeric,p_additional_stops integer,
  p_service_level text,p_signature_required boolean,p_proof_method text,
  p_pickup_address jsonb,p_dropoff_address jsonb,p_overnight_requested boolean,
  p_route_distance_meters bigint,p_route_duration_seconds integer,
  p_route_static_duration_seconds integer,
  p_route_traffic_delay_seconds integer,
  p_distance_source text,p_serviceability_outcome text,p_route_review_reason text,
  p_quote_status text,p_pricing_policy_version text,
  p_delivery_subtotal_cents integer,p_included_loaded_miles integer,
  p_billable_loaded_miles numeric,p_quote_line_items jsonb,p_review_reasons jsonb,
  p_weight_band text default null,
  p_timing_intent text default null,
  p_requested_pickup_local text default null,
  p_requested_departure_at timestamptz default null,
  p_timing_review_reasons jsonb default null
)
returns public.couranr_delivery_requests
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_session public.couranr_intake_sessions;
  v_fact public.couranr_intake_facts;
  v_req public.couranr_delivery_requests;
begin
  select * into v_session from public.couranr_intake_sessions
   where id = p_session_id and business_account_id = p_business_account_id
   for update;
  if not found then
    raise exception 'intake_session_not_found' using errcode='CR404';
  end if;
  if v_session.request_id is distinct from p_request_id then
    raise exception 'intake_session_request_mismatch' using errcode='CR409';
  end if;
  if v_session.current_revision is distinct from p_expected_intake_revision then
    raise exception 'stale_intake_revision' using errcode='CR409';
  end if;

  /* Each TRUSTED commercial fact must match the argument being committed.
     A mismatch means the application read old facts — refuse, never guess. */
  for v_fact in
    select * from public.couranr_intake_facts
     where session_id = p_session_id
       and authority in ('confirmed','overridden')
       and fact_key in ('weight_lb_exact','weight_band','service_level',
                        'timing_intent','requested_pickup_local')
  loop
    if v_fact.fact_key = 'weight_lb_exact'
       and p_weight_lb is distinct from (v_fact.value #>> '{}')::numeric then
      raise exception 'intake_fact_mismatch: weight_lb_exact' using errcode='CR409';
    elsif v_fact.fact_key = 'weight_band'
       and p_weight_band is distinct from (v_fact.value #>> '{}') then
      raise exception 'intake_fact_mismatch: weight_band' using errcode='CR409';
    elsif v_fact.fact_key = 'service_level'
       and p_service_level is distinct from (v_fact.value #>> '{}') then
      raise exception 'intake_fact_mismatch: service_level' using errcode='CR409';
    elsif v_fact.fact_key = 'timing_intent'
       and p_timing_intent is distinct from (v_fact.value #>> '{}') then
      raise exception 'intake_fact_mismatch: timing_intent' using errcode='CR409';
    elsif v_fact.fact_key = 'requested_pickup_local'
       and p_requested_pickup_local is distinct from (v_fact.value #>> '{}') then
      raise exception 'intake_fact_mismatch: requested_pickup_local' using errcode='CR409';
    end if;
  end loop;

  v_req := public.couranr_calculate_routed_delivery_request_estimate(
    p_request_id,p_business_account_id,p_expected_version,p_actor_user_id,
    p_update_shipment,p_source,p_readiness_state,p_payer_type,
    p_recipient_name,p_recipient_phone,p_recipient_email,
    p_weight_lb,p_additional_stops,p_service_level,p_signature_required,
    p_proof_method,p_pickup_address,p_dropoff_address,p_overnight_requested,
    p_route_distance_meters,p_route_duration_seconds,
    p_route_static_duration_seconds,p_route_traffic_delay_seconds,
    p_distance_source,p_serviceability_outcome,p_route_review_reason,
    p_quote_status,p_pricing_policy_version,p_delivery_subtotal_cents,
    p_included_loaded_miles,p_billable_loaded_miles,p_quote_line_items,
    p_review_reasons,p_weight_band,p_timing_intent,p_requested_pickup_local,
    p_requested_departure_at,p_timing_review_reasons
  );

  insert into public.couranr_intake_fact_events(
    session_id, fact_key, event, to_value, actor_user_id
  ) values (
    p_session_id, 'weight_band', 'committed_to_request',
    jsonb_build_object('requestId', p_request_id,
                       'requestVersion', v_req.version,
                       'intakeRevision', p_expected_intake_revision),
    p_actor_user_id
  );

  return v_req;
end
$fn$;

/* --------------------------------------------------------------- grants - */
/* pg_default_acl grants arwdDxtm to anon/authenticated/service_role on every
   new function in public — each one is locked down by hand. */

revoke all on function public.couranr_create_intake_session(uuid,uuid,uuid,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_create_intake_session(uuid,uuid,uuid,text,text)
  to service_role;

revoke all on function public.couranr_add_intake_revision(uuid,uuid,uuid,text,integer,text)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_add_intake_revision(uuid,uuid,uuid,text,integer,text)
  to service_role;

revoke all on function public.couranr_begin_intake_run(uuid,uuid,integer,text,text,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_begin_intake_run(uuid,uuid,integer,text,text,text,text,jsonb)
  to service_role;

revoke all on function public.couranr_complete_intake_run(uuid,uuid,text,jsonb,text,integer,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_complete_intake_run(uuid,uuid,text,jsonb,text,integer,jsonb)
  to service_role;

revoke all on function public.couranr_confirm_intake_fact(uuid,uuid,uuid,text,jsonb,text)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_confirm_intake_fact(uuid,uuid,uuid,text,jsonb,text)
  to service_role;

revoke all on function public.couranr_record_intake_policy(uuid,uuid,text,jsonb,jsonb,jsonb,text,text,jsonb,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_record_intake_policy(uuid,uuid,text,jsonb,jsonb,jsonb,text,text,jsonb,uuid)
  to service_role;

revoke all on function public.couranr_commit_intake_to_request(
  uuid,integer,uuid,uuid,integer,uuid,boolean,text,text,text,text,text,text,
  numeric,integer,text,boolean,text,jsonb,jsonb,boolean,bigint,integer,integer,
  integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,
  text,text,text,timestamptz,jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.couranr_commit_intake_to_request(
  uuid,integer,uuid,uuid,integer,uuid,boolean,text,text,text,text,text,text,
  numeric,integer,text,boolean,text,jsonb,jsonb,boolean,bigint,integer,integer,
  integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,
  text,text,text,timestamptz,jsonb
) to service_role;

commit;

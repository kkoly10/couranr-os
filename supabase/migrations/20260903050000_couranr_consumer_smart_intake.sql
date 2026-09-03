-- =====================================================================
-- COURANR CONSUMER SMART INTAKE (INT-002)
--
-- The guest on /send becomes the TRUSTED ACTOR for their OWN shipment on the
-- SAME Smart Intake substrate merchants use — one durable model, one
-- provider seam, one policy engine. INT-001's rule is unchanged:
--   AI PROPOSES. COURANR VALIDATES. A TRUSTED ACTOR CONFIRMS. SERVER COMMITS.
--
-- WHAT CHANGES (all additive):
--   1. couranr_intake_sessions gains a second scope, guest_session_id, with a
--      one-or-the-other CHECK; the business columns become nullable for the
--      guest case only (created_by_user_id must still be set for a business).
--   2. 'consumer_statement' joins both source vocabularies (revisions, facts).
--   3. ONE new command upserts the guest's description (identical trimmed
--      words never add a revision, so they never buy a second paid call).
--   4. SIX existing commands gain a trailing `p_guest_session_id uuid default
--      null`. The old signatures are DROPPED first: a defaulted overload left
--      beside the original makes every positional business call ambiguous.
--      Business behaviour is byte-preserved except the scope predicate, and
--      the rollback restores the predecessor bodies VERBATIM (generated from
--      20260902210000's text, not retyped).
--   5. The paid-provider budget gains the consumer branch: 12 calls per guest
--      session per rolling hour (same as a merchant session) plus ONE global
--      consumer allowance of 300 per rolling hour under its own advisory
--      lock. Minting more guest sessions cannot widen it — that global cap is
--      the spend bound the anonymous surface relies on.
--
-- NOT changed: create/add-revision (merchant-only shapes), commit_intake /
-- create_request_from_intake (the consumer estimate stores form facts on the
-- request itself; intake facts are evidence, confirmed at estimate time).
--
-- Re-runnable throughout.
-- =====================================================================

begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

/* ------------------------------------------------ 1. the consumer scope --- */

alter table public.couranr_intake_sessions
  add column if not exists guest_session_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'couranr_is_guest_session_fk') then
    alter table public.couranr_intake_sessions
      add constraint couranr_is_guest_session_fk
      foreign key (guest_session_id) references public.couranr_consumer_guest_sessions(id)
      on update cascade on delete restrict;
  end if;
end
$$;

alter table public.couranr_intake_sessions alter column business_account_id drop not null;
alter table public.couranr_intake_sessions alter column created_by_user_id drop not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'couranr_is_scope_chk') then
    alter table public.couranr_intake_sessions
      add constraint couranr_is_scope_chk check (
        (business_account_id is not null and guest_session_id is null
           and created_by_user_id is not null)
        or (business_account_id is null and guest_session_id is not null
           and created_by_user_id is null)
      );
  end if;
end
$$;

create unique index if not exists couranr_is_guest_session_uniq
  on public.couranr_intake_sessions (guest_session_id)
  where guest_session_id is not null;

alter table public.couranr_intake_description_revisions
  alter column actor_user_id drop not null;

/* ------------------------------------------ 2. the source vocabularies --- */

alter table public.couranr_intake_description_revisions
  drop constraint if exists couranr_idr_source_chk;
alter table public.couranr_intake_description_revisions
  add constraint couranr_idr_source_chk check (source in
    ('merchant_statement','clarification_response','consumer_statement'));

alter table public.couranr_intake_facts
  drop constraint if exists couranr_if_source_chk;
alter table public.couranr_intake_facts
  add constraint couranr_if_source_chk check (source in
    ('merchant_statement','saved_preset','merchant_default',
     'previous_confirmed_delivery','ai_inference','deterministic_policy','unknown',
     'consumer_statement'));

/* ------------------------------------------------- 3. scope assertion --- */

/* Exactly one scope per call. A call naming both, or neither, is a bug in the
   application, refused before any row is read. */
create or replace function private.couranr_assert_intake_scope(
  p_business_account_id uuid, p_guest_session_id uuid
) returns void language plpgsql immutable set search_path='' as $fn$
begin
  if (p_business_account_id is null) = (p_guest_session_id is null) then
    raise exception 'intake_scope_required' using errcode='CR422';
  end if;
end
$fn$;
revoke all on function private.couranr_assert_intake_scope(uuid,uuid)
  from public, anon, authenticated;
grant execute on function private.couranr_assert_intake_scope(uuid,uuid)
  to service_role;

/* ---------------------------------------- 4. the guest's description --- */

/* INT-002: the guest's description, upserted. One intake session per guest
   session; the SAME words (trimmed) never add a revision — so a repeated
   blur or a whitespace edit can never buy a second paid call. Changed words
   append revision N+1 exactly as a merchant edit does. The guest session is
   locked first, then the intake session (link_intake_session takes only the
   intake row, and reads the guest session without a lock, so the two
   commands cannot deadlock). */
create or replace function public.couranr_upsert_consumer_intake_description(
  p_guest_session_id    uuid,
  p_description         text,
  p_fact_schema_version text default null
)
returns jsonb
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_guest   public.couranr_consumer_guest_sessions;
  v_session public.couranr_intake_sessions;
  v_current text;
  v_added   boolean := false;
begin
  if p_description is null or length(btrim(p_description)) = 0
     or length(p_description) > 4000 then
    raise exception 'description_required' using errcode='CR422';
  end if;
  select * into v_guest from public.couranr_consumer_guest_sessions
   where id = p_guest_session_id for update;
  if not found or v_guest.revoked_at is not null or v_guest.expires_at <= now() then
    raise exception 'guest_session_not_available' using errcode='CR404';
  end if;
  select * into v_session from public.couranr_intake_sessions
   where guest_session_id = p_guest_session_id for update;
  if not found then
    insert into public.couranr_intake_sessions(
      business_account_id, guest_session_id, request_id, created_by_user_id,
      fact_schema_version, interpretation_status
    ) values (
      null, p_guest_session_id, v_guest.request_id, null,
      coalesce(p_fact_schema_version,'couranr-shipment-facts-v0-2026-09-02'), 'none'
    ) returning * into v_session;
    insert into public.couranr_intake_description_revisions(
      session_id, revision, raw_description, actor_user_id, source
    ) values (v_session.id, 1, p_description, null, 'consumer_statement');
    v_added := true;
  else
    select raw_description into v_current
      from public.couranr_intake_description_revisions
     where session_id = v_session.id and revision = v_session.current_revision;
    if btrim(coalesce(v_current,'')) is distinct from btrim(p_description) then
      update public.couranr_intake_sessions
         set current_revision = current_revision + 1, updated_at = now()
       where id = v_session.id
      returning * into v_session;
      insert into public.couranr_intake_description_revisions(
        session_id, revision, raw_description, actor_user_id, source
      ) values (v_session.id, v_session.current_revision, p_description, null, 'consumer_statement');
      v_added := true;
    end if;
  end if;
  update public.couranr_consumer_guest_sessions
     set last_used_at = now()
   where id = p_guest_session_id;
  return jsonb_build_object('session', to_jsonb(v_session), 'revisionAdded', v_added);
end
$fn$;
comment on function public.couranr_upsert_consumer_intake_description is
  'INT-002 Consumer Smart Intake: creates or revises the ONE intake session bound to a live guest session. Identical trimmed words add no revision (no second paid call); changed words append revision N+1 with source consumer_statement and no actor. SECURITY INVOKER, service_role only.';

/* ------------------------------- 5. the six widened commands (scope) --- */
/* Drop the predecessor signatures FIRST — see the header on overload ambiguity. */
drop function if exists public.couranr_begin_intake_run(uuid,uuid,integer,text,text,text,text,jsonb,text);
drop function if exists public.couranr_complete_intake_run(uuid,uuid,text,jsonb,text,integer,jsonb,text,integer,integer);
drop function if exists public.couranr_confirm_intake_fact(uuid,uuid,uuid,text,jsonb,text);
drop function if exists public.couranr_retract_intake_fact(uuid,uuid,uuid,text);
drop function if exists public.couranr_link_intake_session(uuid,uuid,uuid);
drop function if exists public.couranr_record_intake_policy(uuid,uuid,text,jsonb,jsonb,jsonb,text,text,jsonb,uuid,jsonb);


create or replace function public.couranr_begin_intake_run(
  p_session_id          uuid,
  p_business_account_id uuid,
  p_source_revision     integer,
  p_prompt_version      text,
  p_fact_schema_version text,
  p_provider            text,
  p_idempotency_key     text,
  p_input_data_classes  jsonb,
  p_requested_model     text default null,
  /* INT-002: the consumer scope. Exactly one of p_business_account_id /
     p_guest_session_id must be given; the private assert enforces it. */
  p_guest_session_id    uuid default null
)
returns jsonb
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_session public.couranr_intake_sessions;
  -- jsonb, not the row type: PL/pgSQL refuses a record variable inside a
  -- multi-item INTO list, and the run leaves this function as jsonb anyway.
  v_run jsonb;
  v_claimed boolean;
  v_existing public.couranr_intake_runs;
  v_session_calls integer;
  v_tenant_calls integer;
  v_tenant_budget integer;
  -- Launch limits (correction pass §4): paid provider invocations per rolling
  -- hour. Persistent and server-authoritative: the audit rows ARE the counter.
  c_session_budget constant integer := 12;
  c_business_budget constant integer := 60;
  -- INT-002: every anonymous guest shares ONE consumer allowance per rolling
  -- hour (the real spend bound — minting more guest sessions cannot widen it).
  c_consumer_budget constant integer := 300;
begin
  perform private.couranr_assert_intake_scope(p_business_account_id, p_guest_session_id);
  select * into v_session from public.couranr_intake_sessions
   where id = p_session_id
     and ((p_business_account_id is not null and business_account_id = p_business_account_id)
       or (p_guest_session_id is not null and guest_session_id = p_guest_session_id));
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

  /* §7 idempotency, and the part a row-level converge alone does not give:
     exactly ONE caller is told it CLAIMED the run. Two concurrent callers
     both converge on the same row, but only the inserter gets claimed=true
     and is the one that spends provider money; the other returns the
     pending run and waits for it. The `xmax = 0` test is the standard way
     to tell an inserted row from a conflict-updated one in one statement. */
  /* Idempotent convergence first: a retry of the same logical operation
     returns the existing run and spends nothing — before any budget is
     consulted, so retries never eat the allowance. */
  select * into v_existing from public.couranr_intake_runs
   where session_id = p_session_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('run', to_jsonb(v_existing), 'claimed', false);
  end if;

  if p_provider <> 'none' then
    /* §4 paid-provider budget. The per-business advisory lock serializes
       every "count then insert" for that business inside this transaction,
       so two simultaneous requests cannot both see 59 and both proceed.
       Rate-limited rows are audit evidence, not spend: they are excluded
       from the count and carry a suffixed idempotency key so a later retry
       (next hour) can claim a real run. */
    if p_business_account_id is not null then
      perform pg_advisory_xact_lock(hashtext('couranr_intake_budget:' || p_business_account_id::text));
    else
      /* INT-002: one lock for the whole consumer surface, so two guests cannot
         both see 299 and both proceed. */
      perform pg_advisory_xact_lock(hashtext('couranr_intake_budget:consumer'));
    end if;
    select count(*) into v_session_calls
      from public.couranr_intake_runs
     where session_id = p_session_id
       and provider <> 'none' and status <> 'rate_limited'
       and started_at > now() - interval '1 hour';
    if p_business_account_id is not null then
      select count(*) into v_tenant_calls
        from public.couranr_intake_runs r
        join public.couranr_intake_sessions s on s.id = r.session_id
       where s.business_account_id = p_business_account_id
         and r.provider <> 'none' and r.status <> 'rate_limited'
         and r.started_at > now() - interval '1 hour';
      v_tenant_budget := c_business_budget;
    else
      select count(*) into v_tenant_calls
        from public.couranr_intake_runs r
        join public.couranr_intake_sessions s on s.id = r.session_id
       where s.guest_session_id is not null
         and r.provider <> 'none' and r.status <> 'rate_limited'
         and r.started_at > now() - interval '1 hour';
      v_tenant_budget := c_consumer_budget;
    end if;
    if v_session_calls >= c_session_budget or v_tenant_calls >= v_tenant_budget then
      insert into public.couranr_intake_runs (
        session_id, source_revision, prompt_version, fact_schema_version,
        provider, requested_model, idempotency_key, input_data_classes, status, completed_at
      ) values (
        p_session_id, p_source_revision, p_prompt_version,
        coalesce(p_fact_schema_version, v_session.fact_schema_version),
        p_provider, p_requested_model,
        p_idempotency_key || ':rate_limited:' || to_char(clock_timestamp(),'YYYYMMDDHH24MISSUS'),
        coalesce(p_input_data_classes,'[]'::jsonb), 'rate_limited', now()
      ) returning to_jsonb(couranr_intake_runs) into v_run;
      update public.couranr_intake_sessions
         set interpretation_status = 'rate_limited', updated_at = now()
       where id = p_session_id;
      return jsonb_build_object('run', v_run, 'claimed', false, 'rateLimited', true,
                                'sessionCallsLastHour', v_session_calls,
                                case when p_business_account_id is not null
                                     then 'businessCallsLastHour' else 'consumerCallsLastHour' end,
                                v_tenant_calls);
    end if;
  end if;

  insert into public.couranr_intake_runs as r (
    session_id, source_revision, prompt_version, fact_schema_version,
    provider, requested_model, idempotency_key, input_data_classes, status
  ) values (
    p_session_id, p_source_revision, p_prompt_version,
    coalesce(p_fact_schema_version, v_session.fact_schema_version),
    p_provider, p_requested_model, p_idempotency_key,
    coalesce(p_input_data_classes,'[]'::jsonb), 'pending'
  )
  on conflict (session_id, idempotency_key)
    do update set idempotency_key = excluded.idempotency_key
  returning to_jsonb(r), (r.xmax = 0) into v_run, v_claimed;

  update public.couranr_intake_sessions
     set interpretation_status = case when interpretation_status = 'none'
                                      then 'pending' else interpretation_status end,
         updated_at = now()
   where id = p_session_id;

  return jsonb_build_object('run', v_run, 'claimed', v_claimed);
end
$fn$;

create or replace function public.couranr_complete_intake_run(
  p_run_id              uuid,
  p_business_account_id uuid,
  p_status              text,
  p_proposals           jsonb,
  p_output_hash         text,
  p_latency_ms          integer,
  p_clarification       jsonb,
  /* Provider audit (correction pass §1): the model the provider reported and
     the token counts it supplied, when it supplied them. */
  p_provider_model      text default null,
  p_input_tokens        integer default null,
  p_output_tokens       integer default null,
  /* INT-002: the consumer scope. Exactly one of p_business_account_id /
     p_guest_session_id must be given; the private assert enforces it. */
  p_guest_session_id    uuid default null
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
  perform private.couranr_assert_intake_scope(p_business_account_id, p_guest_session_id);
  if p_status not in ('success','timeout','unavailable','malformed','validation_failed') then
    raise exception 'invalid_run_status' using errcode='CR422';
  end if;

  select r.* into v_run
    from public.couranr_intake_runs r
    join public.couranr_intake_sessions s on s.id = r.session_id
   where r.id = p_run_id
     and ((p_business_account_id is not null and s.business_account_id = p_business_account_id)
       or (p_guest_session_id is not null and s.guest_session_id = p_guest_session_id))
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
         provider_model = coalesce(p_provider_model, provider_model),
         input_tokens = p_input_tokens,
         output_tokens = p_output_tokens,
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
  p_authority           text,
  /* INT-002: the consumer scope. Exactly one of p_business_account_id /
     p_guest_session_id must be given; the private assert enforces it. */
  p_guest_session_id    uuid default null
)
returns public.couranr_intake_facts
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_session public.couranr_intake_sessions;
  v_existing public.couranr_intake_facts;
  v_fact public.couranr_intake_facts;
  -- INT-002: the guest's own statement is a trusted source for their own request.
  v_source text := case when p_guest_session_id is not null
                        then 'consumer_statement' else 'merchant_statement' end;
begin
  perform private.couranr_assert_intake_scope(p_business_account_id, p_guest_session_id);
  if p_authority not in ('confirmed','overridden') then
    raise exception 'authority_must_be_trusted' using errcode='CR422';
  end if;
  select * into v_session from public.couranr_intake_sessions
   where id = p_session_id
     and ((p_business_account_id is not null and business_account_id = p_business_account_id)
       or (p_guest_session_id is not null and guest_session_id = p_guest_session_id))
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
    p_session_id, p_fact_key, p_value, null, v_source, false,
    p_authority, p_actor_user_id, 1, now()
  )
  on conflict (session_id, fact_key) do update set
    value = excluded.value,
    confidence = null,
    source = v_source,
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

create or replace function public.couranr_retract_intake_fact(
  p_session_id          uuid,
  p_business_account_id uuid,
  p_actor_user_id       uuid,
  p_fact_key            text,
  /* INT-002: the consumer scope. Exactly one of p_business_account_id /
     p_guest_session_id must be given; the private assert enforces it. */
  p_guest_session_id    uuid default null
)
returns public.couranr_intake_facts
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_session public.couranr_intake_sessions;
  v_existing public.couranr_intake_facts;
  v_fact public.couranr_intake_facts;
  v_source text := case when p_guest_session_id is not null
                        then 'consumer_statement' else 'merchant_statement' end;
begin
  perform private.couranr_assert_intake_scope(p_business_account_id, p_guest_session_id);
  select * into v_session from public.couranr_intake_sessions
   where id = p_session_id
     and ((p_business_account_id is not null and business_account_id = p_business_account_id)
       or (p_guest_session_id is not null and guest_session_id = p_guest_session_id))
   for update;
  if not found then
    raise exception 'intake_session_not_found' using errcode='CR404';
  end if;

  select * into v_existing from public.couranr_intake_facts
   where session_id = p_session_id and fact_key = p_fact_key;
  if not found then
    raise exception 'intake_fact_not_found' using errcode='CR404';
  end if;
  if v_existing.authority = 'unknown' then
    -- Already withdrawn: idempotent, no second event.
    return v_existing;
  end if;

  update public.couranr_intake_facts
     set value = 'null'::jsonb,
         confidence = null,
         source = v_source,
         requires_confirmation = false,
         authority = 'unknown',
         actor_user_id = p_actor_user_id,
         revision = revision + 1,
         updated_at = now()
   where session_id = p_session_id and fact_key = p_fact_key
  returning * into v_fact;

  insert into public.couranr_intake_fact_events(
    session_id, fact_key, event, from_value, to_value,
    from_authority, to_authority, actor_user_id
  ) values (
    p_session_id, p_fact_key, 'retracted',
    v_existing.value, 'null'::jsonb, v_existing.authority, 'unknown', p_actor_user_id
  );

  update public.couranr_intake_sessions set updated_at = now() where id = p_session_id;
  return v_fact;
end
$fn$;

create or replace function public.couranr_link_intake_session(
  p_session_id          uuid,
  p_business_account_id uuid,
  p_request_id          uuid,
  /* INT-002: the consumer scope. Exactly one of p_business_account_id /
     p_guest_session_id must be given; the private assert enforces it. */
  p_guest_session_id    uuid default null
)
returns public.couranr_intake_sessions
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_session public.couranr_intake_sessions;
begin
  perform private.couranr_assert_intake_scope(p_business_account_id, p_guest_session_id);
  select * into v_session from public.couranr_intake_sessions
   where id = p_session_id
     and ((p_business_account_id is not null and business_account_id = p_business_account_id)
       or (p_guest_session_id is not null and guest_session_id = p_guest_session_id))
   for update;
  if not found then
    raise exception 'intake_session_not_found' using errcode='CR404';
  end if;
  if p_business_account_id is not null then
    if not exists (select 1 from public.couranr_delivery_requests
                    where id = p_request_id
                      and business_account_id = p_business_account_id) then
      raise exception 'request_not_found' using errcode='CR404';
    end if;
  elsif not exists (select 1 from public.couranr_consumer_guest_sessions
                     where id = p_guest_session_id and request_id = p_request_id) then
    -- INT-002: a guest may link only the ONE request their session owns.
    raise exception 'request_not_found' using errcode='CR404';
  end if;
  if v_session.request_id is not null and v_session.request_id <> p_request_id then
    raise exception 'intake_session_already_linked' using errcode='CR409';
  end if;
  update public.couranr_intake_sessions
     set request_id = p_request_id, updated_at = now()
   where id = p_session_id
  returning * into v_session;
  return v_session;
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
  p_run_id                uuid default null,
  /* The deterministic lexical scan of the current words (audit evidence). */
  p_restricted_signals    jsonb default null,
  /* INT-002: the consumer scope. Exactly one of p_business_account_id /
     p_guest_session_id must be given; the private assert enforces it. */
  p_guest_session_id    uuid default null
)
returns public.couranr_intake_sessions
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_session public.couranr_intake_sessions;
begin
  perform private.couranr_assert_intake_scope(p_business_account_id, p_guest_session_id);
  if p_run_id is not null then
    select * into v_session from public.couranr_intake_sessions
     where id = p_session_id
       and ((p_business_account_id is not null and business_account_id = p_business_account_id)
       or (p_guest_session_id is not null and guest_session_id = p_guest_session_id))
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
         -- The evaluation is stamped with the revision it read, so a commit
         -- can refuse a policy computed for words that have since changed.
         policy_revision = current_revision,
         restricted_signal_scan = p_restricted_signals,
         updated_at = now()
   where id = p_session_id
     and ((p_business_account_id is not null and business_account_id = p_business_account_id)
       or (p_guest_session_id is not null and guest_session_id = p_guest_session_id))
  returning * into v_session;
  if not found then
    raise exception 'intake_session_not_found' using errcode='CR404';
  end if;
  return v_session;
end
$fn$;

/* ----------------------------------------------------------- grants --- */
/* pg_default_acl grants arwdDxtm to anon/authenticated/service_role on every
   new function; every signature here is locked down by hand. */
revoke all on function public.couranr_upsert_consumer_intake_description(uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.couranr_upsert_consumer_intake_description(uuid,text,text)
  to service_role;
revoke all on function public.couranr_begin_intake_run(uuid,uuid,integer,text,text,text,text,jsonb,text,uuid)
  from public, anon, authenticated;
grant execute on function public.couranr_begin_intake_run(uuid,uuid,integer,text,text,text,text,jsonb,text,uuid)
  to service_role;
revoke all on function public.couranr_complete_intake_run(uuid,uuid,text,jsonb,text,integer,jsonb,text,integer,integer,uuid)
  from public, anon, authenticated;
grant execute on function public.couranr_complete_intake_run(uuid,uuid,text,jsonb,text,integer,jsonb,text,integer,integer,uuid)
  to service_role;
revoke all on function public.couranr_confirm_intake_fact(uuid,uuid,uuid,text,jsonb,text,uuid)
  from public, anon, authenticated;
grant execute on function public.couranr_confirm_intake_fact(uuid,uuid,uuid,text,jsonb,text,uuid)
  to service_role;
revoke all on function public.couranr_retract_intake_fact(uuid,uuid,uuid,text,uuid)
  from public, anon, authenticated;
grant execute on function public.couranr_retract_intake_fact(uuid,uuid,uuid,text,uuid)
  to service_role;
revoke all on function public.couranr_link_intake_session(uuid,uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.couranr_link_intake_session(uuid,uuid,uuid,uuid)
  to service_role;
revoke all on function public.couranr_record_intake_policy(uuid,uuid,text,jsonb,jsonb,jsonb,text,text,jsonb,uuid,jsonb,uuid)
  from public, anon, authenticated;
grant execute on function public.couranr_record_intake_policy(uuid,uuid,text,jsonb,jsonb,jsonb,text,text,jsonb,uuid,jsonb,uuid)
  to service_role;

commit;

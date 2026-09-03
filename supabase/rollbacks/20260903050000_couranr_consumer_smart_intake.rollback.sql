-- =====================================================================
-- ROLLBACK — Consumer Smart Intake (INT-002)
--
-- ORDER MATTERS IF THE APPLICATION HAS ALREADY SHIPPED: the consumer
-- interpret route and the scope-aware commands call the widened signatures
-- by name. Roll the APPLICATION back first, then run this.
--
-- EVIDENCE GUARD (the same rule 20260902210000 applies): intake evidence
-- that has been COMMITTED to a canonical request is commercial provenance
-- and is never destroyed here. Consumer intake facts are confirmed at
-- estimate time as EVIDENCE only — the consumer estimate prices from the
-- request's own stored facts, never from an intake commit — so with no
-- committed event the consumer rows belong to the feature being removed and
-- are deleted, exactly as 20260902210000 drops its own tables.
--
-- The six predecessor function bodies below are the VERBATIM text of
-- 20260902210000 (generated from that file, not retyped).
-- Idempotent: drop-if-exists throughout.
-- =====================================================================

begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

do $evidence$
declare
  v_count bigint;
begin
  select count(*) into v_count
    from public.couranr_intake_fact_events e
    join public.couranr_intake_sessions s on s.id = e.session_id
   where s.guest_session_id is not null
     and e.event = 'committed_to_request';
  if v_count > 0 then
    raise exception
      'consumer_smart_intake_rollback_would_orphan_commercial_provenance: % committed fact event(s); forward repair required',
      v_count;
  end if;
exception when undefined_table or undefined_column then
  null; -- already rolled back (or never applied)
end
$evidence$;

/* 1. the widened signatures and the new commands */
drop function if exists public.couranr_begin_intake_run(uuid,uuid,integer,text,text,text,text,jsonb,text,uuid);
drop function if exists public.couranr_complete_intake_run(uuid,uuid,text,jsonb,text,integer,jsonb,text,integer,integer,uuid);
drop function if exists public.couranr_confirm_intake_fact(uuid,uuid,uuid,text,jsonb,text,uuid);
drop function if exists public.couranr_retract_intake_fact(uuid,uuid,uuid,text,uuid);
drop function if exists public.couranr_link_intake_session(uuid,uuid,uuid,uuid);
drop function if exists public.couranr_record_intake_policy(uuid,uuid,text,jsonb,jsonb,jsonb,text,text,jsonb,uuid,jsonb,uuid);
drop function if exists public.couranr_upsert_consumer_intake_description(uuid,text,text);
drop function if exists private.couranr_assert_intake_scope(uuid,uuid);

/* 2. the predecessor bodies, verbatim */

create or replace function public.couranr_begin_intake_run(
  p_session_id          uuid,
  p_business_account_id uuid,
  p_source_revision     integer,
  p_prompt_version      text,
  p_fact_schema_version text,
  p_provider            text,
  p_idempotency_key     text,
  p_input_data_classes  jsonb,
  p_requested_model     text default null
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
  v_business_calls integer;
  -- Launch limits (correction pass §4): paid provider invocations per rolling
  -- hour. Persistent and server-authoritative: the audit rows ARE the counter.
  c_session_budget constant integer := 12;
  c_business_budget constant integer := 60;
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
    perform pg_advisory_xact_lock(hashtext('couranr_intake_budget:' || p_business_account_id::text));
    select count(*) into v_session_calls
      from public.couranr_intake_runs
     where session_id = p_session_id
       and provider <> 'none' and status <> 'rate_limited'
       and started_at > now() - interval '1 hour';
    select count(*) into v_business_calls
      from public.couranr_intake_runs r
      join public.couranr_intake_sessions s on s.id = r.session_id
     where s.business_account_id = p_business_account_id
       and r.provider <> 'none' and r.status <> 'rate_limited'
       and r.started_at > now() - interval '1 hour';
    if v_session_calls >= c_session_budget or v_business_calls >= c_business_budget then
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
                                'businessCallsLastHour', v_business_calls);
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
  p_output_tokens       integer default null
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

create or replace function public.couranr_retract_intake_fact(
  p_session_id          uuid,
  p_business_account_id uuid,
  p_actor_user_id       uuid,
  p_fact_key            text
)
returns public.couranr_intake_facts
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_session public.couranr_intake_sessions;
  v_existing public.couranr_intake_facts;
  v_fact public.couranr_intake_facts;
begin
  select * into v_session from public.couranr_intake_sessions
   where id = p_session_id and business_account_id = p_business_account_id
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
         source = 'merchant_statement',
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
  p_request_id          uuid
)
returns public.couranr_intake_sessions
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_session public.couranr_intake_sessions;
begin
  select * into v_session from public.couranr_intake_sessions
   where id = p_session_id and business_account_id = p_business_account_id
   for update;
  if not found then
    raise exception 'intake_session_not_found' using errcode='CR404';
  end if;
  if not exists (select 1 from public.couranr_delivery_requests
                  where id = p_request_id
                    and business_account_id = p_business_account_id) then
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
  p_restricted_signals    jsonb default null
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
         -- The evaluation is stamped with the revision it read, so a commit
         -- can refuse a policy computed for words that have since changed.
         policy_revision = current_revision,
         restricted_signal_scan = p_restricted_signals,
         updated_at = now()
   where id = p_session_id and business_account_id = p_business_account_id
  returning * into v_session;
  if not found then
    raise exception 'intake_session_not_found' using errcode='CR404';
  end if;
  return v_session;
end
$fn$;

revoke all on function public.couranr_begin_intake_run(uuid,uuid,integer,text,text,text,text,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.couranr_begin_intake_run(uuid,uuid,integer,text,text,text,text,jsonb,text)
  to service_role;
revoke all on function public.couranr_complete_intake_run(uuid,uuid,text,jsonb,text,integer,jsonb,text,integer,integer)
  from public, anon, authenticated;
grant execute on function public.couranr_complete_intake_run(uuid,uuid,text,jsonb,text,integer,jsonb,text,integer,integer)
  to service_role;
revoke all on function public.couranr_confirm_intake_fact(uuid,uuid,uuid,text,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.couranr_confirm_intake_fact(uuid,uuid,uuid,text,jsonb,text)
  to service_role;
revoke all on function public.couranr_retract_intake_fact(uuid,uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.couranr_retract_intake_fact(uuid,uuid,uuid,text)
  to service_role;
revoke all on function public.couranr_link_intake_session(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.couranr_link_intake_session(uuid,uuid,uuid)
  to service_role;
revoke all on function public.couranr_record_intake_policy(uuid,uuid,text,jsonb,jsonb,jsonb,text,text,jsonb,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.couranr_record_intake_policy(uuid,uuid,text,jsonb,jsonb,jsonb,text,text,jsonb,uuid,jsonb)
  to service_role;

/* 3. consumer intake evidence (feature-owned, uncommitted by the guard above) */
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'couranr_intake_sessions'
                and column_name = 'guest_session_id') then
    delete from public.couranr_intake_fact_events e
     using public.couranr_intake_sessions s
     where s.id = e.session_id and s.guest_session_id is not null;
    delete from public.couranr_intake_facts f
     using public.couranr_intake_sessions s
     where s.id = f.session_id and s.guest_session_id is not null;
    delete from public.couranr_intake_runs r
     using public.couranr_intake_sessions s
     where s.id = r.session_id and s.guest_session_id is not null;
    delete from public.couranr_intake_description_revisions d
     using public.couranr_intake_sessions s
     where s.id = d.session_id and s.guest_session_id is not null;
    delete from public.couranr_intake_sessions where guest_session_id is not null;
  end if;
end
$$;

/* 4. the source vocabularies, restored */
alter table public.couranr_intake_facts
  drop constraint if exists couranr_if_source_chk;
alter table public.couranr_intake_facts
  add constraint couranr_if_source_chk check (source in
    ('merchant_statement','saved_preset','merchant_default',
     'previous_confirmed_delivery','ai_inference','deterministic_policy','unknown'));
alter table public.couranr_intake_description_revisions
  drop constraint if exists couranr_idr_source_chk;
alter table public.couranr_intake_description_revisions
  add constraint couranr_idr_source_chk check (source in
    ('merchant_statement','clarification_response'));
alter table public.couranr_intake_description_revisions
  alter column actor_user_id set not null;

/* 5. the consumer scope, removed */
drop index if exists public.couranr_is_guest_session_uniq;
alter table public.couranr_intake_sessions drop constraint if exists couranr_is_scope_chk;
alter table public.couranr_intake_sessions alter column business_account_id set not null;
alter table public.couranr_intake_sessions alter column created_by_user_id set not null;
alter table public.couranr_intake_sessions drop constraint if exists couranr_is_guest_session_fk;
alter table public.couranr_intake_sessions drop column if exists guest_session_id;

commit;

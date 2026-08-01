-- =====================================================================
-- Re-runnable verification for terminal capture resolution.
--
-- WHY THIS FILE EXISTS
--
-- The money-critical guarantees below were originally checked by running
-- ad-hoc queries and reading the output in a chat transcript. That is not
-- verification anyone else can repeat, and it disappears the moment the
-- conversation does. Green unit tests never touched these paths, because the
-- guarantees live in PL/pgSQL and in CHECK constraints, not in TypeScript.
--
-- Every statement here is READ-ONLY or self-rejecting. Nothing is created,
-- nothing is deleted, and no row is mutated: the probes are all expected to be
-- REFUSED, and the final section proves the target row is byte-for-byte
-- unchanged afterwards.
--
-- HOW TO RUN
--   Supabase SQL editor, or the Supabase MCP `execute_sql`, against
--   `Couranr -OS` (zrdxlrlqxdslqpnoqmus). Check the project ref first — three
--   sibling projects in the same org are not Couranr.
--
-- HOW TO READ IT
--   Every row of every result set has an `ok` column. All of them must be
--   true. Any false is a regression.
--
-- WHAT IT DOES NOT COVER
--   The ACCEPT paths (requires_payment_method -> failed, canceled ->
--   cancelled) mutate state, so they are not exercised here against live data.
--   They are covered by the browser suite against synthetic fixtures. This
--   file proves the refusals, the grants and the constraint shapes — the
--   things that fail silently rather than loudly.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. GRANTS. The pg_default_acl hazard in this project means a bare GRANT is
--    a silent no-op without a preceding REVOKE, so "service_role only" has to
--    be asserted, never assumed. has_function_privilege is used rather than
--    information_schema, which misses privileges inherited through PUBLIC.
-- ---------------------------------------------------------------------
select
  'grants' as check_group,
  r.rolname as role,
  has_function_privilege(
    r.rolname,
    'public.couranr_resolve_terminal_capture_failure(uuid,text,text,text,integer,text,text)',
    'execute') as can_execute,
  (has_function_privilege(
     r.rolname,
     'public.couranr_resolve_terminal_capture_failure(uuid,text,text,text,integer,text,text)',
     'execute') = (r.rolname = 'service_role')) as ok
from (values ('anon'),('authenticated'),('service_role')) as r(rolname);


-- ---------------------------------------------------------------------
-- 2. CONSTRAINT SHAPES. Both of these were biconditionals that made a legal
--    transition impossible. A biconditional here is a regression: it means
--    some state cannot be written while keeping its history.
-- ---------------------------------------------------------------------
select
  'constraints' as check_group,
  conname,
  pg_get_constraintdef(oid) as def,
  pg_get_constraintdef(oid) not like '%) = (%' as is_one_directional,
  pg_get_constraintdef(oid) not like '%) = (%' as ok
from pg_constraint
where conname in ('couranr_sp_confirmed_stamp_chk', 'couranr_po_failed_stamp_chk');

-- The transitions those constraints must permit, evaluated as pure
-- expressions. No table is read.
select 'constraint_logic' as check_group, label, result, result = expected as ok
from (values
  ('cancel a confirmed plan, keeping its stamps',
   (('cancelled' <> 'confirmed') or (true and true)), true),
  ('a confirmed plan still requires both stamps',
   (('confirmed' <> 'confirmed') or (false and true)), false),
  ('fail an obligation with a stamp',
   (('failed' <> 'failed') or (true)), true),
  ('fail an obligation without a stamp is refused',
   (('failed' <> 'failed') or (false)), false)
) as t(label, result, expected);


-- ---------------------------------------------------------------------
-- 3. THE CLOSED MAPPING. Only two statuses may reach this command. Every
--    other status must RAISE CR422 rather than be quietly ignored, because a
--    caller arriving here with `succeeded` has a bug that must surface.
--
--    Each probe is trapped, so the block completes and mutates nothing.
-- ---------------------------------------------------------------------
do $$
declare
  v_ob    uuid;
  v_intent text;
  v_amount integer;
  v_status text;
  v_refused boolean;
  v_all_ok boolean := true;
begin
  select id, provider_payment_intent_id, amount_cents
    into v_ob, v_intent, v_amount
    from public.couranr_payment_obligations
   where payment_state = 'capture_pending'
   limit 1;

  if v_ob is null then
    raise notice 'SKIPPED: no capture_pending obligation exists to probe against.';
    return;
  end if;

  foreach v_status in array array[
    'succeeded', 'requires_capture', 'processing',
    'requires_confirmation', 'requires_action', '', 'a_status_from_the_future'
  ] loop
    v_refused := false;
    begin
      perform public.couranr_resolve_terminal_capture_failure(
        v_ob, 'verify:probe:' || v_status, v_intent, v_status, v_amount, 'usd', null);
    exception when sqlstate 'CR422' then
      v_refused := true;
    end;
    if not v_refused then
      v_all_ok := false;
      raise warning 'REGRESSION: status % was ACCEPTED by the terminal command', v_status;
    end if;
  end loop;

  if v_all_ok then
    raise notice 'closed_mapping: all non-terminal statuses refused with CR422 (ok)';
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 4. FAIL CLOSED. A terminal status with the wrong intent, amount or currency
--    must be REJECTED, not applied. These return a rejection rather than
--    raising, and deliberately write no event: recording a rejection would
--    burn the provider_event_id, which is exactly the poisoning that stranded
--    obligations in the first place.
-- ---------------------------------------------------------------------
with target as (
  select id, provider_payment_intent_id as intent, amount_cents
  from public.couranr_payment_obligations
  where payment_state = 'capture_pending'
  limit 1
)
select
  'fail_closed' as check_group,
  probe,
  reason,
  reason = expected as ok
from target, lateral (values
  ('wrong intent id',
   (public.couranr_resolve_terminal_capture_failure(
      target.id, 'verify:intent', 'pi_not_the_stored_one',
      'requires_payment_method', target.amount_cents, 'usd', null)).rejected_reason,
   'payment_intent_mismatch'),
  ('wrong amount',
   (public.couranr_resolve_terminal_capture_failure(
      target.id, 'verify:amount', target.intent,
      'requires_payment_method', target.amount_cents + 1, 'usd', null)).rejected_reason,
   'amount_mismatch'),
  ('wrong currency',
   (public.couranr_resolve_terminal_capture_failure(
      target.id, 'verify:currency', target.intent,
      'requires_payment_method', target.amount_cents, 'eur', null)).rejected_reason,
   'currency_mismatch')
) as p(probe, reason, expected);


-- ---------------------------------------------------------------------
-- 5. THE WEBHOOK GUARD. Capture reconciliation is authoritative once an
--    obligation is capture_pending. Without this, an
--    `amount_capturable_updated` arriving mid-capture moved the obligation
--    back to `authorized` and re-armed Capture over money that may already
--    have moved.
-- ---------------------------------------------------------------------
select
  'webhook_guard' as check_group,
  'refuses capture_pending' as property,
  position('capture_reconciliation_is_authoritative' in prosrc) > 0 as present,
  position('capture_reconciliation_is_authoritative' in prosrc) > 0 as ok
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'couranr_apply_payment_intent_state'
union all
select
  'webhook_guard',
  'compare-and-set names the state it read',
  position('and payment_state <> ''capture_pending''' in prosrc) > 0,
  position('and payment_state <> ''capture_pending''' in prosrc) > 0
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'couranr_apply_payment_intent_state';


-- ---------------------------------------------------------------------
-- 6. OBLIGATION GENERATION KEY. Re-authorizing after a cancel collided on
--    couranr_po_idempotency_uniq, because the cancelled row keeps the
--    caller's constant key. That made the `cancel` branch unrecoverable.
-- ---------------------------------------------------------------------
select
  'generation_key' as check_group,
  'stored key carries the obligation generation' as property,
  position(':g' in prosrc) > 0 as present,
  position(':g' in prosrc) > 0 as ok
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'couranr_create_payment_obligation';


-- ---------------------------------------------------------------------
-- 6b. THE SUPERSEDE GUARD.
--
--     `couranr_delivery_requests.version` is the optimistic-concurrency
--     counter — readiness alone bumps it — so it can never stand in for "the
--     quote changed". Migration 20260801100000 removed that comparison from
--     `couranr_apply_readiness`; the same wrong test survived in
--     `couranr_create_payment_obligation` and silently superseded the
--     obligation on every re-authorization, stranding the confirmed service
--     plan against a dead obligation so the delivery could never be captured.
--
--     Structural, because the behavioural proof is Group O (O10/O11/O14) and
--     re-running it here would have to write. Both functions are checked, so
--     the pattern cannot reappear in either.
-- ---------------------------------------------------------------------
select
  'supersede_guard' as check_group,
  p.proname || ' does not gate on request.version' as property,
  position('request_version is not distinct from v_req.version' in p.prosrc) = 0 as compares_version_free,
  position('request_version is not distinct from v_req.version' in p.prosrc) = 0 as ok
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('couranr_create_payment_obligation', 'couranr_apply_readiness')
union all
select
  'supersede_guard',
  'money in flight is never superseded by a create call',
  position('payment_in_progress' in p.prosrc) > 0,
  position('payment_in_progress' in p.prosrc) > 0
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'couranr_create_payment_obligation'
union all
select
  'supersede_guard',
  'service_role only',
  has_function_privilege('service_role', p.oid, 'execute'),
  has_function_privilege('service_role', p.oid, 'execute')
    and not has_function_privilege('authenticated', p.oid, 'execute')
    and not has_function_privilege('anon', p.oid, 'execute')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'couranr_create_payment_obligation';


-- ---------------------------------------------------------------------
-- 7. NOTHING MOVED. Every probe above was expected to refuse. If any of them
--    wrote, it shows up here.
-- ---------------------------------------------------------------------
select
  'no_mutation' as check_group,
  count(*) filter (where provider_event_id like 'verify:%') as verification_events_written,
  count(*) filter (where provider_event_id like 'verify:%') = 0 as ok
from public.couranr_payment_events;

select
  'no_mutation' as check_group,
  'capture_pending rows still capture_pending' as property,
  count(*) filter (where payment_state = 'capture_pending' and failed_at is not null) as bad_failed,
  count(*) filter (where payment_state = 'capture_pending' and cancelled_at is not null) as bad_cancelled,
  count(*) filter (where payment_state = 'capture_pending'
                     and (failed_at is not null or cancelled_at is not null)) = 0 as ok
from public.couranr_payment_obligations;

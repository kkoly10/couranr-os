-- =====================================================================
-- ROLLBACK — payment recovery (20260903020000)
--
-- Restores couranr_begin/complete_payment_release VERBATIM from
-- 20260806195405 (extracted, not retyped) and removes the refund substrate.
--
-- EVIDENCE GUARD. A refund attempt is commercial history: once any row
-- exists in couranr_payment_refunds — even a failed one — dropping the table
-- would erase the record of money movement that was at least attempted.
-- HARD-REFUSE and require forward repair.
-- =====================================================================

begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

do $evidence$
declare v_count bigint;
begin
  select count(*) into v_count from public.couranr_payment_refunds;
  if v_count > 0 then
    raise exception
      'payment_recovery_rollback_would_destroy_refund_history: % refund attempt(s) recorded; forward repair required',
      v_count;
  end if;
exception when undefined_table then
  null;
end
$evidence$;

drop function if exists public.couranr_complete_payment_refund(uuid,text,text,integer);
drop function if exists public.couranr_mark_payment_refund_unknown(uuid,jsonb);
drop function if exists public.couranr_begin_payment_refund(uuid,uuid,integer,text);

create or replace function public.couranr_begin_payment_release(
  p_obligation_id    uuid,
  p_actor_user_id    uuid,
  p_expected_version integer,
  p_reason           text
)
returns public.couranr_payment_apply_result
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_role text;
  v_ob   public.couranr_payment_obligations;
begin
  -- OPS-010 is an Operations screen. Same predicate couranr_decide_activation
  -- uses, so there is one definition of "Operations" in SQL rather than two.
  select role into v_role from public.profiles where id = p_actor_user_id;
  if v_role is distinct from 'admin' then
    raise exception 'operations_access_required' using errcode = 'CR403';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'release_requires_a_reason' using errcode = 'CR400';
  end if;

  select * into v_ob
    from public.couranr_payment_obligations
   where id = p_obligation_id
     for update;
  if not found then
    raise exception 'obligation_not_found' using errcode = 'CR404';
  end if;

  -- Idempotent replay: an operator who retries after a timeout must be told
  -- what already happened, not handed a conflict. CAP-001's capture branch
  -- makes the same promise for the same reason.
  if v_ob.payment_state = 'cancelled' then
    return row('ignored', v_ob.id, v_ob.request_id, v_ob.payment_state, null,
               'already_released')::public.couranr_payment_apply_result;
  end if;

  if v_ob.payment_state <> 'authorized' then
    raise exception 'only_an_authorized_hold_may_be_released' using errcode = 'CR409';
  end if;
  -- UNREACHABLE, and kept deliberately. couranr_po_authorized_needs_intent_chk
  -- is `payment_state <> 'authorized' OR provider_payment_intent_id IS NOT NULL`,
  -- so the database already forbids the row this branch describes - proven by
  -- R19 in e2e/disposable/releaseAuthorization.mjs, which gets 23514 trying to
  -- insert one. Defence in depth against that CHECK being relaxed later, not a
  -- live path, and no test claims to cover it.
  if v_ob.provider_payment_intent_id is null then
    raise exception 'obligation_has_no_payment_intent' using errcode = 'CR422';
  end if;
  if p_expected_version is null or p_expected_version <> v_ob.version then
    raise exception 'version_or_state_conflict' using errcode = 'CR409';
  end if;

  /*
   * BUMP THE VERSION FIRST, so this ATTEMPT has an identity.
   *
   * This is not bookkeeping - it is what makes a retry possible, and getting it
   * wrong made the first version of this command worse than not having it.
   *
   * The event id below is version-scoped, copying the captureEventId convention
   * in lib/couranr/payments/states.ts. That convention works for capture ONLY
   * because couranr_begin_payment_capture bumps the version on every cycle.
   * This command originally did not, on the reasoning that a release should not
   * move the row - so a second attempt rebuilt the SAME id and died on
   * couranr_pe_provider_event_uniq with 23505. Measured, not theorised: attempt
   * one returned `applied` with version still 1, attempt two returned
   * `23505 duplicate key value violates unique constraint`.
   *
   * The consequence was that ONE failed Stripe call made a hold permanently
   * un-releasable - strictly worse than shipping nothing, because the operator
   * has a button that can never work again.
   *
   * payment_state is still NOT changed here; that part of the design stands.
   * Only `version` moves, which is exactly what "a distinct attempt" means.
   */
  update public.couranr_payment_obligations
     set version    = version + 1,
         updated_at = now()
   where id = p_obligation_id
     and version = p_expected_version
     and payment_state = 'authorized'
  returning * into v_ob;
  if not found then
    raise exception 'version_or_state_conflict' using errcode = 'CR409';
  end if;

  insert into public.couranr_payment_events (
    obligation_id, request_id, provider, provider_event_id, event_type,
    payment_state_before, payment_state_after, outcome, detail
  ) values (
    v_ob.id, v_ob.request_id, 'stripe',
    'couranr:release_begun:' || v_ob.id::text || ':v' || v_ob.version::text,
    'couranr.release.begun',
    v_ob.payment_state, v_ob.payment_state, 'applied',
    jsonb_build_object('reason', btrim(p_reason), 'actorUserId', p_actor_user_id)
  );

  return row('applied', v_ob.id, v_ob.request_id, v_ob.payment_state, null,
             null)::public.couranr_payment_apply_result;
end
$fn$;

create or replace function public.couranr_complete_payment_release(
  p_obligation_id     uuid,
  p_payment_intent_id text,
  p_intent_status     text
)
returns public.couranr_payment_apply_result
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_ob public.couranr_payment_obligations;
begin
  if p_intent_status is distinct from 'canceled' then
    raise exception 'status_not_a_cancellation' using errcode = 'CR422';
  end if;

  select * into v_ob
    from public.couranr_payment_obligations
   where id = p_obligation_id
     for update;
  if not found then
    raise exception 'obligation_not_found' using errcode = 'CR404';
  end if;

  -- Already recorded, by this command or by the webhook. Both are legitimate
  -- and they race by design, so this is `ignored`, not an error.
  if v_ob.payment_state = 'cancelled' then
    return row('ignored', v_ob.id, v_ob.request_id, v_ob.payment_state, null,
               'already_released')::public.couranr_payment_apply_result;
  end if;

  -- FAIL CLOSED, and return BEFORE the event insert. Recording a rejection
  -- would burn the provider_event_id, which is the poisoning that stranded
  -- obligations once already (see 20260801120000).
  if v_ob.provider_payment_intent_id is distinct from p_payment_intent_id then
    return row('rejected', v_ob.id, v_ob.request_id, v_ob.payment_state, null,
               'payment_intent_mismatch')::public.couranr_payment_apply_result;
  end if;
  if v_ob.payment_state <> 'authorized' then
    return row('rejected', v_ob.id, v_ob.request_id, v_ob.payment_state, null,
               'not_authorized')::public.couranr_payment_apply_result;
  end if;

  insert into public.couranr_payment_events (
    obligation_id, request_id, provider, provider_event_id, event_type,
    payment_state_before, payment_state_after, outcome, detail
  ) values (
    v_ob.id, v_ob.request_id, 'stripe',
    'couranr:release_done:' || v_ob.id::text || ':v' || v_ob.version::text,
    'couranr.release.completed',
    v_ob.payment_state, 'cancelled', 'applied',
    jsonb_build_object('paymentIntentId', p_payment_intent_id)
  );

  -- cancelled_at is not optional: couranr_po_cancelled_stamp_chk is an IFF, so
  -- a `cancelled` row without the stamp is refused by the database.
  update public.couranr_payment_obligations
     set payment_state = 'cancelled',
         cancelled_at  = now(),
         version       = version + 1,
         updated_at    = now()
   where id = p_obligation_id
     and payment_state = 'authorized'
  returning * into v_ob;
  if not found then
    raise exception 'version_or_state_conflict' using errcode = 'CR409';
  end if;

  return row('applied', v_ob.id, v_ob.request_id, v_ob.payment_state, null,
             null)::public.couranr_payment_apply_result;
end
$fn$;

revoke all on function public.couranr_begin_payment_release(uuid, uuid, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_begin_payment_release(uuid, uuid, integer, text)
  to service_role;
revoke all on function public.couranr_complete_payment_release(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_complete_payment_release(uuid, text, text)
  to service_role;

do $refguard$
declare v_refunded bigint;
begin
  select count(*) into v_refunded from public.couranr_payment_obligations
   where refunded_amount_cents is not null or payment_state = 'refunded';
  if v_refunded > 0 then
    raise exception
      'payment_recovery_rollback_would_destroy_refund_evidence: % obligation(s) carry refund stamps; forward repair required',
      v_refunded;
  end if;
exception when undefined_column then
  null;
end
$refguard$;

alter table public.couranr_payment_obligations
  drop constraint if exists couranr_po_refund_bounds_chk;
alter table public.couranr_payment_obligations
  drop constraint if exists couranr_po_refunded_stamp_chk;
alter table public.couranr_payment_obligations
  drop column if exists refunded_amount_cents,
  drop column if exists refunded_at;

drop table if exists public.couranr_payment_refunds;

commit;

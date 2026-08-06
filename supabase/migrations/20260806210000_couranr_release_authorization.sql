-- ---------------------------------------------------------------------------
-- ACP-032 slice 1: release a payment authorization.
--
-- WHY THIS EXISTS
--
-- Measured at 5221e3d against the connected project: `rg "paymentIntents\.cancel"
-- lib/ app/` returns ZERO hits. The `cancelled` payment state exists, a
-- `release` ReconcileAction exists in lib/couranr/payments/states.ts, and the
-- webhook already maps `payment_intent.canceled` -> `cancelled`. So Couranr can
-- OBSERVE a release and record it, but nothing can INITIATE one. At the time of
-- writing 37 obligations hold money (25 `authorized`, 12 `capture_pending`) with
-- no code path able to give it back; the hold sits until the card network
-- expires it.
--
-- CAN-001 specifies `action: 'release'` with `charge_cents: 0` for two lifecycle
-- stages and UI_SCREEN_REGISTRY.md lists release as an OPS-010 allowed action,
-- so this is a decided requirement that was never built - not an open question.
-- It computes no amount, so it touches neither PRC-004 nor TAX-001.
--
-- WHY TWO FUNCTIONS AND NOT ONE
--
-- The obvious shape is one command that flips the row to `cancelled` and then
-- calls Stripe. That is the wrong order for THIS operation, and the reason is
-- not symmetry with capture - it is which failure is recoverable.
--
--   * Capture's risk is taking money twice, so capture records intent FIRST
--     (`capture_pending`) and only then calls Stripe.
--   * Release's risk is the opposite: claiming money is freed when it is not.
--     If we wrote `cancelled` and the Stripe call then failed, the row would
--     assert released funds that are still held, and NOTHING would correct it -
--     no webhook fires for a cancel that never happened.
--
-- So: `begin` gates and guards WITHOUT changing payment_state, the caller
-- cancels at Stripe, and `complete` records the outcome. If the process dies
-- between them the obligation stays `authorized` - truthful, still held, and
-- self-healing, because the existing webhook maps a real `payment_intent.canceled`
-- to `cancelled` on its own.
--
-- No new payment_state value is introduced. `couranr_po_payment_state_chk` and
-- the TypeScript PaymentState union are untouched, so every existing reader
-- keeps working. The in-flight release is recorded as an EVENT, not a state.
--
-- Additive only: two new functions, no table, column, constraint or grant is
-- dropped or narrowed.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- couranr_begin_payment_release
--
-- Operations-gated. Refuses anything that is not `authorized`, so a capture in
-- flight (`capture_pending`) or money already taken (`captured`) is never
-- released out from under itself - those are a reconcile and a refund
-- respectively, neither of which is this command.
--
-- Returns the composite so the caller can read the intent id it must cancel.
-- ---------------------------------------------------------------------------
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

  -- Append-only record that a release was authorised by a named operator, at a
  -- known version. Version-scoped per the captureEventId convention in
  -- lib/couranr/payments/states.ts, so a retry after a failed Stripe call is a
  -- distinct row rather than a swallowed duplicate.
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

  -- payment_state is deliberately NOT changed here. See the header.
  return row('applied', v_ob.id, v_ob.request_id, v_ob.payment_state, null,
             null)::public.couranr_payment_apply_result;
end
$fn$;

comment on function public.couranr_begin_payment_release(uuid, uuid, integer, text) is
  'Operations-gated precondition check for releasing an authorized hold. Records that a release was authorised and returns the obligation so the caller can cancel the intent at Stripe. Does NOT change payment_state - couranr_complete_payment_release does that once Stripe has confirmed, so a failed Stripe call leaves the row truthfully still authorized.';

-- ---------------------------------------------------------------------------
-- couranr_complete_payment_release
--
-- Records the outcome AFTER Stripe has answered. Takes the provider's status
-- rather than a target state (TRN-001: no caller names a destination), and
-- refuses any status that is not a real cancellation.
-- ---------------------------------------------------------------------------
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

comment on function public.couranr_complete_payment_release(uuid, text, text) is
  'Records a confirmed Stripe cancellation as authorized -> cancelled. Takes the provider status rather than a target state (TRN-001) and refuses anything that is not `canceled`. Safe to race the webhook: whichever arrives second reads `cancelled` and returns `ignored`.';

-- ---------------------------------------------------------------------------
-- Grants. public.* inherits pg_default_acl granting arwdDxtm to anon,
-- authenticated AND service_role, so a bare GRANT is a silent no-op - the
-- REVOKE is what actually closes it.
-- ---------------------------------------------------------------------------
revoke all on function public.couranr_begin_payment_release(uuid, uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.couranr_begin_payment_release(uuid, uuid, integer, text)
  to service_role;

revoke all on function public.couranr_complete_payment_release(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.couranr_complete_payment_release(uuid, text, text)
  to service_role;

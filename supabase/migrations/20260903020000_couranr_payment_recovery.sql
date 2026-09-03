-- =====================================================================
-- COURANR PAYMENT RECOVERY (launch batch 3 §B)
--
--   1. STALE-HOLD RELEASE. couranr_begin/complete_payment_release accept the
--      two states in which Stripe can hold money that Couranr never
--      commercially authorized ('not_started', 'requires_action' with an
--      attached intent — the quote_expired / metadata-rejected paths), so
--      Operations can cancel the provider hold through the SAME
--      begin -> Stripe -> complete discipline. Captured money stays refused
--      here: that is a refund.
--
--   2. REFUND SUBSTRATE. couranr_payment_refunds persists every refund
--      ATTEMPT before the provider is called (obligation, request, provider
--      intent identity, server-computed amount, governed reason, idempotency
--      key, actor, attempt state), the same
--      persist -> external call -> reconcile shape capture uses. Amounts are
--      NEVER caller-supplied: the command derives them from the captured
--      amount and the governed cancellation retention — CAN-001, verbatim:
--      $0 before confirmation / $8 after confirmation before driver arrival /
--      $15 failed pickup after arrival / $0 Couranr-caused — so no browser,
--      merchant, consumer or operator can type a refund figure. A timeout
--      after submitting to the provider parks the attempt at
--      'pending_unknown' — UNKNOWN, not failed — and reconciliation converges
--      onto the SAME attempt row LIST-FIRST: the provider's refunds are read,
--      a match completes the row, and only a fully-read list that proves
--      absence permits a create. A read failure leaves the row unknown with
--      zero writes, so a retry can never issue a second provider refund.
--
-- ADDITIVE: one table, two obligation columns, two CHECKs, four commands,
-- two in-place function replacements (same signatures). No historical row
-- rewritten. Re-runnable throughout.
-- =====================================================================

begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

do $guard$
begin
  if to_regprocedure('public.couranr_begin_payment_release(uuid,uuid,integer,text)') is null
     or to_regprocedure('public.couranr_complete_payment_release(uuid,text,text)') is null then
    raise exception 'payment recovery requires the release commands (20260806195405)';
  end if;
end
$guard$;

/* ---------------------------------------------- 1. stale-hold release --- */

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

  /* Batch 3 §B: THE STALE-QUOTE HOLD. Stripe can place a real authorization
     hold while Couranr's commercial authorization is refused (quote_expired
     and the metadata rejections in couranr_apply_payment_intent_state) — the
     obligation then sits in 'not_started' or 'requires_action' with a LIVE
     provider hold and, before this change, no command could release it
     ('only_an_authorized_hold_may_be_released'). Those two states join
     'authorized' as releasable; everything at or past capture stays refused —
     captured money is a REFUND, never a release. */
  if v_ob.payment_state not in ('authorized','not_started','requires_action') then
    raise exception 'only_an_authorized_hold_may_be_released' using errcode = 'CR409';
  end if;
  -- UNREACHABLE, and kept deliberately. couranr_po_authorized_needs_intent_chk
  -- is `payment_state <> 'authorized' OR provider_payment_intent_id IS NOT NULL`,
  -- so the database already forbids the row this branch describes - proven by
  -- R19 in e2e/disposable/releaseAuthorization.mjs, which gets 23514 trying to
  -- insert one. Defence in depth against that CHECK being relaxed later, not a
  -- live path, and no test claims to cover it.
  if v_ob.provider_payment_intent_id is null then
    -- Reachable since §B for the stale states: a not_started obligation with
    -- no intent attached has no provider hold, so there is nothing to release.
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
     and payment_state in ('authorized','not_started','requires_action')
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
  if v_ob.payment_state not in ('authorized','not_started','requires_action') then
    return row('rejected', v_ob.id, v_ob.request_id, v_ob.payment_state, null,
               'not_releasable')::public.couranr_payment_apply_result;
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
     and payment_state in ('authorized','not_started','requires_action')
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

/* -------------------------------------------------- 2. refund substrate - */

create table if not exists public.couranr_payment_refunds (
  id                          uuid primary key default gen_random_uuid(),
  obligation_id               uuid not null,
  request_id                  uuid not null,
  provider                    text not null default 'stripe',
  provider_payment_intent_id  text not null,
  -- Known only after the provider answers; NULL while requested/unknown.
  provider_refund_id          text,
  -- Server-computed integer cents. Never a parameter anywhere.
  amount_cents                integer not null,
  retained_cents              integer not null default 0,
  reason                      text not null,
  -- The provider idempotency key, derived from this row's id. Request-level
  -- hygiene only: provider keys expire, so duplicate protection is the app's
  -- list-first convergence (a provider match, or a fully-read list proving
  -- absence, before any create) — never this key.
  refund_key                  text not null,
  attempt_state               text not null default 'requested',
  actor_user_id               uuid not null,
  failure_detail              jsonb,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  constraint couranr_pr_obligation_fk foreign key (obligation_id)
    references public.couranr_payment_obligations (id)
    on update cascade on delete restrict,
  constraint couranr_pr_request_fk foreign key (request_id)
    references public.couranr_delivery_requests (id)
    on update cascade on delete restrict,
  constraint couranr_pr_provider_chk check (provider = 'stripe'),
  -- A provider refund always moves money; the zero-due settlement (final
  -- closure pass §3: the governed retention consumed the capture) is the ONE
  -- shape allowed to carry amount 0 — and it must then retain something and
  -- name no provider refund, because none exists.
  constraint couranr_pr_amount_chk check (
    amount_cents > 0
    or (attempt_state = 'settled_no_refund_due' and amount_cents = 0)),
  constraint couranr_pr_retained_chk check (retained_cents >= 0),
  constraint couranr_pr_settled_zero_chk check (
    attempt_state <> 'settled_no_refund_due'
    or (amount_cents = 0 and retained_cents > 0 and provider_refund_id is null)),
  constraint couranr_pr_reason_chk check (reason in (
    'full_refund','cancel_before_confirmation',
    'cancel_after_confirmation_before_arrival','failed_pickup_after_arrival',
    'couranr_caused_failure')),
  constraint couranr_pr_state_chk check (attempt_state in (
    'requested','pending_unknown','succeeded','failed','settled_no_refund_due')),
  constraint couranr_pr_refund_key_uniq unique (refund_key),
  constraint couranr_pr_succeeded_has_provider_id_chk check (
    attempt_state <> 'succeeded' or provider_refund_id is not null)
);

comment on table public.couranr_payment_refunds is
  'One provider refund ATTEMPT, persisted BEFORE Stripe is called (batch 3 §B). Amounts are server-derived from the captured amount and the governed cancellation retention; there is no caller-supplied amount anywhere. pending_unknown means the provider outcome is genuinely unknown and reconciliation must converge on this row under refund_key.';

-- At most one LIVE attempt chain per obligation: a failed attempt may be
-- retried with a fresh row; requested/unknown/succeeded — and the settled
-- zero-due outcome, which is a COMPLETED settlement — block a second one.
create unique index if not exists couranr_pr_one_live_attempt_uniq
  on public.couranr_payment_refunds (obligation_id)
  where attempt_state in ('requested','pending_unknown','succeeded','settled_no_refund_due');

create index if not exists couranr_pr_request_idx
  on public.couranr_payment_refunds (request_id);

alter table public.couranr_payment_refunds enable row level security;
revoke all on public.couranr_payment_refunds from public, anon, authenticated;
revoke all on public.couranr_payment_refunds from service_role;
-- Append + advance; never deleted. Refund history is not erasable.
grant select, insert, update on public.couranr_payment_refunds to service_role;

alter table public.couranr_payment_obligations
  add column if not exists refunded_at timestamptz,
  add column if not exists refunded_amount_cents integer;

comment on column public.couranr_payment_obligations.refunded_amount_cents is
  'Total provider-confirmed refunded cents. Less than captured_amount_cents after a governed partial (cancellation-difference) refund — the row stays captured; equal means fully refunded and the state says refunded.';

alter table public.couranr_payment_obligations
  drop constraint if exists couranr_po_refunded_stamp_chk;
alter table public.couranr_payment_obligations
  add constraint couranr_po_refunded_stamp_chk check (
    payment_state <> 'refunded'
    or (refunded_at is not null and refunded_amount_cents is not null));
alter table public.couranr_payment_obligations
  drop constraint if exists couranr_po_refund_bounds_chk;
alter table public.couranr_payment_obligations
  add constraint couranr_po_refund_bounds_chk check (
    refunded_amount_cents is null
    or (refunded_amount_cents > 0
        and captured_amount_cents is not null
        and refunded_amount_cents <= captured_amount_cents));

/* -------------------------------------------------- refund commands ----- */

create or replace function public.couranr_begin_payment_refund(
  p_obligation_id    uuid,
  p_actor_user_id    uuid,
  p_expected_version integer,
  p_reason           text
)
returns public.couranr_payment_refunds
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_role     text;
  v_ob       public.couranr_payment_obligations;
  v_existing public.couranr_payment_refunds;
  v_retained integer;
  v_amount   integer;
  v_refund   public.couranr_payment_refunds;
begin
  select role into v_role from public.profiles where id = p_actor_user_id;
  if v_role is distinct from 'admin' then
    raise exception 'operations_access_required' using errcode = 'CR403';
  end if;

  select * into v_ob from public.couranr_payment_obligations
   where id = p_obligation_id for update;
  if not found then
    raise exception 'obligation_not_found' using errcode = 'CR404';
  end if;

  /* Idempotent replay FIRST — but ONLY onto the SAME governed settlement
     (B3-I §3). A live attempt (requested, unknown, succeeded, or the
     zero-due settlement) is resumed as-is when the incoming reason MATCHES
     the money settlement it represents; a DIFFERENT reason must never
     converge onto it, or a cancellation could complete a standing
     full_refund attempt as though it were the $8 settlement, and a
     standalone full_refund could ride an unfinished cancellation refund.
     Two different money settlements on one obligation is the conflict this
     refuses — no second provider write is issued while one is unresolved. */
  select * into v_existing from public.couranr_payment_refunds
   where obligation_id = p_obligation_id
     and attempt_state in ('requested','pending_unknown','succeeded','settled_no_refund_due')
   order by created_at desc limit 1;
  if found then
    if v_existing.reason is distinct from p_reason then
      raise exception 'refund_settlement_reason_conflict' using errcode = 'CR409';
    end if;
    /* Same reason: a retried cancellation, or a retried standalone full
       refund, resumes THIS attempt (including a settled_no_refund_due) via
       the list-first convergence in the app layer. */
    return v_existing;
  end if;

  /* B3-I §4 / B3-J #2 — a cancellation-governed settlement, once established,
     cannot be REPLACED by a standalone full refund merely because its refund
     attempt is no longer live (e.g. a `failed` attempt). The evidence is a
     refund attempt carrying ANY governed CANCELLATION reason, in ANY state —
     that is EVERY reason except `full_refund`. In V0 the reason CHECK
     (couranr_pr_reason_chk) pins the vocabulary to exactly
     {full_refund, cancel_before_confirmation,
      cancel_after_confirmation_before_arrival, failed_pickup_after_arrival,
      couranr_caused_failure}, so `reason <> 'full_refund'` IS the complete set
     of cancellation-governed reasons — the earlier two-reason list silently
     let a failed `couranr_caused_failure` (and, defensively,
     `cancel_before_confirmation`) attempt be overwritten by a generic full
     refund, diverging from the Ops panel, which already treats any failed
     non-full_refund attempt as cancellation-governed (Resume, never Full
     refund). The recovery is to retry the SAME cancellation reason (which
     resumes that settlement), never to route captured money out through a
     full refund. The server, not the Ops screen, is what makes this
     impossible. */
  if p_reason = 'full_refund' and exists (
    select 1 from public.couranr_payment_refunds
     where obligation_id = p_obligation_id
       and reason <> 'full_refund'
  ) then
    raise exception 'refund_settlement_reason_conflict' using errcode = 'CR409';
  end if;

  /* Refunds move CAPTURED money only (§7). A hold is a release, an
     uncaptured obligation has nothing to give back. */
  if v_ob.payment_state not in ('captured','refunded') then
    raise exception 'only_captured_money_may_be_refunded' using errcode = 'CR409';
  end if;
  if v_ob.payment_state = 'refunded' then
    raise exception 'already_fully_refunded' using errcode = 'CR409';
  end if;
  if v_ob.captured_amount_cents is null or v_ob.captured_amount_cents <= 0 then
    raise exception 'captured_amount_missing' using errcode = 'CR422';
  end if;
  if v_ob.provider_payment_intent_id is null then
    raise exception 'obligation_has_no_payment_intent' using errcode = 'CR422';
  end if;
  if p_expected_version is null or p_expected_version <> v_ob.version then
    raise exception 'version_or_state_conflict' using errcode = 'CR409';
  end if;

  /* THE GOVERNED AMOUNT. Owner-approved cancellation retention (CAN-001)
     only — there is no parameter through which any caller chooses a figure.
     A physical return is a NEW Pricing V2 route per REF-003, never a refund
     calculation, and Quote N is never mutated. */
  v_retained := case p_reason
    when 'full_refund'                              then 0
    when 'couranr_caused_failure'                   then 0
    when 'cancel_before_confirmation'               then 0
    when 'cancel_after_confirmation_before_arrival' then 800
    when 'failed_pickup_after_arrival'              then 1500
    else null end;
  if v_retained is null then
    raise exception 'refund_reason_invalid' using errcode = 'CR422';
  end if;

  v_amount := v_ob.captured_amount_cents
              - coalesce(v_ob.refunded_amount_cents, 0)
              - v_retained;
  if v_amount <= 0 and v_retained > 0 then
    /* THE RETENTION CONSUMED THE CAPTURE (final closure pass §3). CAN-001's
       $8/$15 can exceed a small Pricing V2 capture ($7.99): the refund due
       is max(captured - retention, 0) = 0, Stripe is called ZERO times, and
       the outcome is a REAL settled record — never a fake $0 provider
       refund and never a dangling error. The retained figure is the ACTUAL
       amount kept: never more than what was captured. */
    insert into public.couranr_payment_refunds(
      obligation_id, request_id, provider_payment_intent_id,
      amount_cents, retained_cents, reason, refund_key, attempt_state,
      actor_user_id
    ) values (
      v_ob.id, v_ob.request_id, v_ob.provider_payment_intent_id,
      0,
      least(v_retained, v_ob.captured_amount_cents - coalesce(v_ob.refunded_amount_cents, 0)),
      p_reason,
      'couranr:refund:' || gen_random_uuid()::text, 'settled_no_refund_due',
      p_actor_user_id
    ) returning * into v_refund;
    update public.couranr_payment_obligations
       set version = version + 1, updated_at = now()
     where id = p_obligation_id and version = p_expected_version;
    insert into public.couranr_payment_events(
      obligation_id, request_id, provider, provider_event_id, event_type,
      payment_state_before, payment_state_after, outcome, detail
    ) values (
      v_ob.id, v_ob.request_id, 'stripe',
      'couranr:refund_settled:' || v_refund.id::text,
      'couranr.refund.settled_no_refund_due',
      v_ob.payment_state, v_ob.payment_state, 'applied',
      jsonb_build_object('refundId', v_refund.id, 'reason', p_reason,
        'retainedCents', v_refund.retained_cents,
        'governedRetentionCents', v_retained,
        'capturedCents', v_ob.captured_amount_cents,
        'actorUserId', p_actor_user_id)
    );
    return v_refund;
  end if;
  if v_amount <= 0 then
    /* Defence only: with a $0 retention this is reachable solely through
       shapes the earlier guards already refuse. No negative refund exists
       by construction. */
    raise exception 'nothing_to_refund_after_retention' using errcode = 'CR422';
  end if;

  update public.couranr_payment_obligations
     set version = version + 1, updated_at = now()
   where id = p_obligation_id and version = p_expected_version;

  insert into public.couranr_payment_refunds(
    obligation_id, request_id, provider_payment_intent_id,
    amount_cents, retained_cents, reason, refund_key, attempt_state,
    actor_user_id
  ) values (
    v_ob.id, v_ob.request_id, v_ob.provider_payment_intent_id,
    v_amount, v_retained, p_reason,
    'couranr:refund:' || gen_random_uuid()::text, 'requested',
    p_actor_user_id
  ) returning * into v_refund;

  insert into public.couranr_payment_events(
    obligation_id, request_id, provider, provider_event_id, event_type,
    payment_state_before, payment_state_after, outcome, detail
  ) values (
    v_ob.id, v_ob.request_id, 'stripe',
    'couranr:refund_begun:' || v_refund.id::text,
    'couranr.refund.begun', v_ob.payment_state, v_ob.payment_state, 'applied',
    jsonb_build_object('refundId', v_refund.id, 'reason', p_reason,
      'amountCents', v_amount, 'retainedCents', v_retained,
      'actorUserId', p_actor_user_id)
  );
  return v_refund;
end
$fn$;

create or replace function public.couranr_mark_payment_refund_unknown(
  p_refund_id uuid,
  p_detail    jsonb
)
returns public.couranr_payment_refunds
language plpgsql security invoker set search_path=''
as $fn$
declare v_r public.couranr_payment_refunds;
begin
  update public.couranr_payment_refunds
     set attempt_state = 'pending_unknown',
         failure_detail = coalesce(p_detail, '{}'::jsonb),
         updated_at = now()
   where id = p_refund_id and attempt_state in ('requested','pending_unknown')
  returning * into v_r;
  if not found then
    select * into v_r from public.couranr_payment_refunds where id = p_refund_id;
    if not found then
      raise exception 'refund_not_found' using errcode = 'CR404';
    end if;
    return v_r; -- already settled; the settled row is the answer
  end if;
  return v_r;
end
$fn$;

create or replace function public.couranr_complete_payment_refund(
  p_refund_id          uuid,
  p_provider_refund_id text,
  p_refund_status      text,
  p_amount_cents       integer
)
returns public.couranr_payment_refunds
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_r  public.couranr_payment_refunds;
  v_ob public.couranr_payment_obligations;
  v_total integer;
begin
  select * into v_r from public.couranr_payment_refunds
   where id = p_refund_id for update;
  if not found then
    raise exception 'refund_not_found' using errcode = 'CR404';
  end if;

  /* Duplicate provider outcome (webhook + reconcile racing, or a retried
     reconcile): already succeeded is already succeeded. Money moved once. */
  if v_r.attempt_state = 'succeeded' then
    return v_r;
  end if;
  if v_r.attempt_state = 'failed' then
    raise exception 'refund_attempt_already_failed' using errcode = 'CR409';
  end if;

  if p_refund_status = 'succeeded' then
    if p_amount_cents is distinct from v_r.amount_cents then
      raise exception 'refund_amount_mismatch' using errcode = 'CR422';
    end if;
    if nullif(btrim(coalesce(p_provider_refund_id,'')),'') is null then
      raise exception 'provider_refund_id_required' using errcode = 'CR422';
    end if;

    select * into v_ob from public.couranr_payment_obligations
     where id = v_r.obligation_id for update;

    begin
      insert into public.couranr_payment_events(
        obligation_id, request_id, provider, provider_event_id, event_type,
        payment_state_before, payment_state_after, outcome, detail
      ) values (
        v_ob.id, v_ob.request_id, 'stripe',
        'couranr:refund_done:' || v_r.id::text,
        'couranr.refund.completed', v_ob.payment_state,
        case when coalesce(v_ob.refunded_amount_cents,0) + v_r.amount_cents
                  = v_ob.captured_amount_cents
             then 'refunded' else v_ob.payment_state end,
        'applied',
        jsonb_build_object('refundId', v_r.id,
          'providerRefundId', p_provider_refund_id,
          'amountCents', v_r.amount_cents, 'retainedCents', v_r.retained_cents,
          'reason', v_r.reason)
      );
    exception when unique_violation then
      -- The completion event already landed: this outcome was recorded by a
      -- racing path. The attempt row is authoritative; return it unchanged.
      select * into v_r from public.couranr_payment_refunds where id = p_refund_id;
      return v_r;
    end;

    update public.couranr_payment_refunds
       set attempt_state = 'succeeded',
           provider_refund_id = p_provider_refund_id,
           updated_at = now()
     where id = v_r.id
    returning * into v_r;

    v_total := coalesce(v_ob.refunded_amount_cents, 0) + v_r.amount_cents;
    update public.couranr_payment_obligations
       set refunded_amount_cents = v_total,
           refunded_at = now(),
           payment_state = case when v_total = captured_amount_cents
                                then 'refunded' else payment_state end,
           version = version + 1,
           updated_at = now()
     where id = v_ob.id;
    return v_r;
  elsif p_refund_status in ('pending') then
    update public.couranr_payment_refunds
       set attempt_state = 'pending_unknown', updated_at = now()
     where id = v_r.id returning * into v_r;
    return v_r;
  elsif p_refund_status in ('failed','canceled','requires_action') then
    update public.couranr_payment_refunds
       set attempt_state = 'failed',
           provider_refund_id = coalesce(nullif(btrim(coalesce(p_provider_refund_id,'')),''), provider_refund_id),
           failure_detail = jsonb_build_object('providerStatus', p_refund_status),
           updated_at = now()
     where id = v_r.id returning * into v_r;
    insert into public.couranr_payment_events(
      obligation_id, request_id, provider, provider_event_id, event_type,
      payment_state_before, payment_state_after, outcome, detail
    ) values (
      v_r.obligation_id, v_r.request_id, 'stripe',
      'couranr:refund_failed:' || v_r.id::text || ':' || p_refund_status,
      'couranr.refund.failed', null, null, 'ignored',
      jsonb_build_object('refundId', v_r.id, 'providerStatus', p_refund_status)
    );
    return v_r;
  else
    raise exception 'refund_status_unrecognized' using errcode = 'CR422';
  end if;
end
$fn$;

/* ---------------- cancellation receivable (final closure pass §4) ------- */

/*
 * A CONFIRMED request cancelled BEFORE its canonical delivery exists (the
 * delivery is created only after capture) owes the $8 CAN-001 settlement,
 * but the money is still only an authorization and PARTIAL CAPTURE IS NOT
 * BUILT in V0. The provider-safe action is releasing the full hold; the $8
 * is then a Couranr RECEIVABLE — owed, not collected, and never fabricated
 * as a provider charge. This records it as the smallest explicit durable
 * primitive: one immutable payment event under a deterministic id, so a
 * retried cancellation converges on the SAME receivable instead of minting
 * a second one. Collection (if ever) is a future owner decision.
 */
create or replace function public.couranr_record_cancellation_settlement(
  p_obligation_id      uuid,
  p_actor_user_id      uuid,
  p_retained_due_cents integer,
  p_reason             text
)
returns public.couranr_payment_events
language plpgsql security invoker set search_path = ''
as $fn$
declare
  v_role text;
  v_ob   public.couranr_payment_obligations;
  v_ev   public.couranr_payment_events;
begin
  select role into v_role from public.profiles where id = p_actor_user_id;
  if v_role is distinct from 'admin' then
    raise exception 'operations_access_required' using errcode = 'CR403';
  end if;
  -- CAN-001's closed retention figures; no caller invents an amount.
  if p_retained_due_cents not in (800, 1500) then
    raise exception 'settlement_amount_not_governed' using errcode = 'CR422';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'reason_required' using errcode = 'CR400';
  end if;

  select * into v_ob from public.couranr_payment_obligations
   where id = p_obligation_id for update;
  if not found then
    raise exception 'obligation_not_found' using errcode = 'CR404';
  end if;

  begin
    insert into public.couranr_payment_events(
      obligation_id, request_id, provider, provider_event_id, event_type,
      payment_state_before, payment_state_after, outcome, detail
    ) values (
      v_ob.id, v_ob.request_id, 'stripe',
      'couranr:cancellation_receivable:' || v_ob.id::text,
      'couranr.cancellation.receivable',
      v_ob.payment_state, v_ob.payment_state, 'applied',
      jsonb_build_object('retainedDueCents', p_retained_due_cents,
        'reason', btrim(p_reason), 'collected', false,
        'actorUserId', p_actor_user_id)
    ) returning * into v_ev;
  exception when unique_violation then
    -- The receivable already stands; a retry converges on it unchanged.
    select * into v_ev from public.couranr_payment_events
     where provider = 'stripe'
       and provider_event_id = 'couranr:cancellation_receivable:' || v_ob.id::text;
  end;
  return v_ev;
end
$fn$;

revoke all on function public.couranr_record_cancellation_settlement(uuid,uuid,integer,text)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_record_cancellation_settlement(uuid,uuid,integer,text)
  to service_role;

/* ------------- governed cancellation IDENTITY (B3-J #1) ---------------- */

/*
 * The DURABLE, IDEMPOTENT governed-cancellation identity for a CONFIRMED
 * request cancelled BEFORE its canonical delivery exists — the ONE anchor the
 * no-delivery saga (cancelBeforeDelivery) reads on every retry. It is recorded
 * BEFORE any provider I/O and locks BOTH the closed governed reason and its
 * server-derived retained-due amount, for the $8 receivable AND the $0
 * couranr-caused case alike.
 *
 * WHY a distinct primitive from couranr_record_cancellation_settlement: that
 * function models a RECEIVABLE ($8/$15 owed) and cannot truthfully represent a
 * $0 couranr-caused cancellation, which owes nothing — modelling $0 as a
 * "receivable" would be a fake debt. This records the governed DECISION: for
 * $0 it writes a `couranr.cancellation.no_charge` event (nothing owed), for
 * $8 a `couranr.cancellation.receivable` (owed, collected=false). The event id
 * is keyed on the OBLIGATION ONLY — `couranr:cancellation_governed:<ob>` — so
 * the FIRST recorded reason WINS: a retry posting a DIFFERENT reason collides
 * on the unique (provider, provider_event_id) and gets back the ORIGINAL row,
 * reason and amount unchanged. The database, not the app, is what makes the
 * original governed reason authoritative; the retry body is never trusted.
 *
 * The retained-due amount is DERIVED FROM the reason and re-checked here, so a
 * caller cannot pass an amount that contradicts the governed reason:
 *   merchant_request / customer_request -> 800     couranr_caused -> 0
 */
create or replace function public.couranr_record_cancellation_identity(
  p_obligation_id      uuid,
  p_actor_user_id      uuid,
  p_governed_reason    text,
  p_retained_due_cents integer
)
returns public.couranr_payment_events
language plpgsql security invoker set search_path = ''
as $fn$
declare
  v_role text;
  v_ob   public.couranr_payment_obligations;
  v_ev   public.couranr_payment_events;
begin
  select role into v_role from public.profiles where id = p_actor_user_id;
  if v_role is distinct from 'admin' then
    raise exception 'operations_access_required' using errcode = 'CR403';
  end if;

  -- Closed governed-reason vocabulary for a no-delivery cancellation. failed_
  -- pickup is a with-delivery stage and never reaches this path.
  if p_governed_reason not in ('merchant_request','customer_request','couranr_caused') then
    raise exception 'cancellation_reason_not_governed' using errcode = 'CR400';
  end if;

  -- The amount is derived from the reason, server-side; a contradictory pair is
  -- refused rather than trusted.
  if (p_governed_reason in ('merchant_request','customer_request') and p_retained_due_cents <> 800)
     or (p_governed_reason = 'couranr_caused' and p_retained_due_cents <> 0) then
    raise exception 'settlement_amount_not_governed' using errcode = 'CR422';
  end if;

  select * into v_ob from public.couranr_payment_obligations
   where id = p_obligation_id for update;
  if not found then
    raise exception 'obligation_not_found' using errcode = 'CR404';
  end if;

  begin
    insert into public.couranr_payment_events(
      obligation_id, request_id, provider, provider_event_id, event_type,
      payment_state_before, payment_state_after, outcome, detail
    ) values (
      v_ob.id, v_ob.request_id, 'stripe',
      'couranr:cancellation_governed:' || v_ob.id::text,
      -- Truthful: a receivable is owed only when something is retained.
      case when p_retained_due_cents > 0
           then 'couranr.cancellation.receivable'
           else 'couranr.cancellation.no_charge' end,
      v_ob.payment_state, v_ob.payment_state, 'applied',
      jsonb_build_object('governedReason', p_governed_reason,
        'retainedDueCents', p_retained_due_cents,
        'actorUserId', p_actor_user_id)
      || case when p_retained_due_cents > 0
              then jsonb_build_object('collected', false)
              else '{}'::jsonb end
    ) returning * into v_ev;
  exception when unique_violation then
    -- The governed identity already stands; the ORIGINAL reason wins. A retry
    -- posting a different reason converges on the first-recorded identity.
    select * into v_ev from public.couranr_payment_events
     where provider = 'stripe'
       and provider_event_id = 'couranr:cancellation_governed:' || v_ob.id::text;
  end;
  return v_ev;
end
$fn$;

revoke all on function public.couranr_record_cancellation_identity(uuid,uuid,text,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_record_cancellation_identity(uuid,uuid,text,integer)
  to service_role;

revoke all on function public.couranr_begin_payment_refund(uuid,uuid,integer,text)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_begin_payment_refund(uuid,uuid,integer,text)
  to service_role;
revoke all on function public.couranr_mark_payment_refund_unknown(uuid,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_mark_payment_refund_unknown(uuid,jsonb)
  to service_role;
revoke all on function public.couranr_complete_payment_refund(uuid,text,text,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_complete_payment_refund(uuid,text,text,integer)
  to service_role;

commit;

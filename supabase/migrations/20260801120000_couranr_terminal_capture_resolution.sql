-- =====================================================================
-- Terminal capture resolution — the last unreachable exit from
-- `capture_pending`.
--
-- `reconcileCapture` could already settle two provider answers:
--   requires_capture -> release back to authorized (funds still only held)
--   succeeded        -> complete the capture and convert
--
-- Everything else fell into a default-deny `wait`, which is right for an
-- INDETERMINATE answer like `processing` and wrong for a TERMINAL one. An
-- intent that comes back `requires_payment_method` or `canceled` is a settled
-- fact: the money was definitively not taken and never will be on that intent.
-- Leaving those in `capture_pending` stranded the obligation forever — no
-- capture, no delivery, no payer recovery, and a queue row saying "do not
-- retry" that nothing ever resolves.
--
-- OWNER-APPROVED CLOSED MAPPING (2026-08-01). Maps ONLY:
--   requires_payment_method -> failed     (payer must authorize again)
--   canceled                -> cancelled  (obligation cannot be reused)
-- Every other status is REJECTED here. `succeeded`, `requires_capture`,
-- `processing` and anything unknown belong to the existing commands or to the
-- deliberate no-op; letting this function accept them would give one caller
-- two ways to reach the same state.
--
-- APPLIED to the live project as migration 20260801120450.
-- ADDITIVE. One new function, one new CHECK, one CHECK relaxed.
-- =====================================================================

begin;

set local statement_timeout = '120s';
set local lock_timeout = '10s';

-- ---------------------------------------------------------------------
-- 0. Make cancelling a confirmed service plan possible at all.
--
-- `couranr_sp_confirmed_stamp_chk` was a BICONDITIONAL:
--   (plan_state = 'confirmed') = (confirmed_at is not null and confirmed_by is not null)
-- A cancelled plan that keeps its historical stamps makes the left side false
-- and the right side true, so the row is rejected. `couranr_cancel_service_plan`
-- therefore raises 23514 on any plan it would actually be called for, and so
-- does the re-plan branch of `couranr_confirm_service_plan`.
--
-- Proof it had never run: 12 service plans existed and every one was
-- `confirmed`. Zero cancelled rows, because a cancelled row could not be
-- written. Verified by expression evaluation before the change:
--   (('cancelled' = 'confirmed') = (true and true))  -> false   (rejected)
--   (('cancelled' <> 'confirmed') or (true and true)) -> true   (accepted)
--
-- Relaxed to the one-directional form — the same correction already applied to
-- `couranr_po_authorized_stamp_chk` in 20260801103000. A confirmed plan must
-- still carry both stamps; a cancelled plan keeps them as the record of who
-- committed to that window and when. Owner-approved 2026-08-01.
-- ---------------------------------------------------------------------

alter table public.couranr_service_plans
  drop constraint if exists couranr_sp_confirmed_stamp_chk;

alter table public.couranr_service_plans
  add constraint couranr_sp_confirmed_stamp_chk check (
    plan_state <> 'confirmed'
    or (confirmed_at is not null and confirmed_by is not null)
  );

-- ---------------------------------------------------------------------
-- 1. A `failed` obligation must carry its stamp.
--
-- The table had stamp checks for authorized, captured and cancelled but none
-- for failed, so `failed` was the one state writable without evidence of when
-- it happened. Verified safe before adding: zero rows `failed` without a
-- stamp, zero rows carrying a stamp without being `failed`.
--
-- One-directional, so a later state that legitimately keeps a historical
-- failed_at — a re-authorized obligation — is not blocked.
-- ---------------------------------------------------------------------

alter table public.couranr_payment_obligations
  drop constraint if exists couranr_po_failed_stamp_chk;

alter table public.couranr_payment_obligations
  add constraint couranr_po_failed_stamp_chk check (
    payment_state <> 'failed' or failed_at is not null
  );

-- ---------------------------------------------------------------------
-- 2. couranr_resolve_terminal_capture_failure
--
-- One command, one transaction: verify, write the append-only event, move the
-- state, do the state-specific side effects. Everything is verified against the
-- STORED obligation before anything moves. The caller supplies what Stripe
-- said; it does not supply what should happen.
-- ---------------------------------------------------------------------

create or replace function public.couranr_resolve_terminal_capture_failure(
  p_obligation_id     uuid,
  p_provider_event_id text,
  p_payment_intent_id text,
  p_intent_status     text,
  p_amount            integer,
  p_currency          text,
  p_failure_code      text default null
)
returns public.couranr_payment_apply_result
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_ob     public.couranr_payment_obligations;
  v_to     text;
  v_event  text;
  v_out    public.couranr_payment_apply_result;
  v_reason text;
  v_tokens integer := 0;
  v_plans  integer := 0;
begin
  -- THE CLOSED MAPPING. Decided here from a verified provider status, never
  -- passed in as a target state. Anything else is refused outright rather than
  -- ignored, because a caller reaching this with `succeeded` has a bug that
  -- must surface.
  if p_intent_status = 'requires_payment_method' then
    v_to := 'failed';    v_event := 'couranr.capture.terminal_failed';
  elsif p_intent_status = 'canceled' then
    v_to := 'cancelled'; v_event := 'couranr.capture.terminal_cancelled';
  else
    raise exception 'status_not_terminal_for_this_command' using errcode = 'CR422';
  end if;

  select * into v_ob
    from public.couranr_payment_obligations
   where id = p_obligation_id;
  if not found then
    raise exception 'obligation_not_found' using errcode = 'CR404';
  end if;

  -- FAIL CLOSED on every mismatch. A resolution written against the wrong
  -- intent, amount or currency would move money's state on evidence about
  -- something else. Note these return BEFORE the event insert: recording a
  -- rejection would burn the provider_event_id, which is exactly the poisoning
  -- that stranded obligations in the first place.
  if v_ob.payment_state <> 'capture_pending' then
    v_out := row('rejected', v_ob.id, v_ob.request_id, v_ob.payment_state, null,
                 'not_capture_pending')::public.couranr_payment_apply_result;
    return v_out;
  end if;
  if v_ob.provider_payment_intent_id is distinct from p_payment_intent_id then
    v_out := row('rejected', v_ob.id, v_ob.request_id, v_ob.payment_state, null,
                 'payment_intent_mismatch')::public.couranr_payment_apply_result;
    return v_out;
  end if;
  if p_amount is distinct from v_ob.amount_cents then
    v_out := row('rejected', v_ob.id, v_ob.request_id, v_ob.payment_state, null,
                 'amount_mismatch')::public.couranr_payment_apply_result;
    return v_out;
  end if;
  if lower(coalesce(p_currency, '')) is distinct from v_ob.currency then
    v_out := row('rejected', v_ob.id, v_ob.request_id, v_ob.payment_state, null,
                 'currency_mismatch')::public.couranr_payment_apply_result;
    return v_out;
  end if;

  v_reason := coalesce(nullif(btrim(p_failure_code), ''), p_intent_status);

  -- The append-only event is the idempotency key. Insert FIRST: a duplicate
  -- provider event id collides here and returns without touching anything,
  -- which is what makes a redelivered webhook and a manual reconcile safe to
  -- race.
  begin
    insert into public.couranr_payment_events (
      obligation_id, request_id, provider, provider_event_id, event_type,
      payment_state_before, payment_state_after, outcome, detail
    ) values (
      v_ob.id, v_ob.request_id, 'stripe', p_provider_event_id, v_event,
      'capture_pending', v_to, 'applied',
      jsonb_build_object(
        'paymentIntentId', p_payment_intent_id,
        'intentStatus',    p_intent_status,
        'failureCode',     p_failure_code,
        'amount',          p_amount,
        'currency',        p_currency,
        'reason',          v_reason));
  exception when unique_violation then
    v_out := row('duplicate', v_ob.id, v_ob.request_id, v_ob.payment_state, null, null)
              ::public.couranr_payment_apply_result;
    return v_out;
  end;

  if v_to = 'failed' then
    -- The hold is gone and the payer must authorize again. `authorized_at` is
    -- deliberately NOT cleared: it is the historical fact that this obligation
    -- was once authorized, and erasing it would make the ledger disagree with
    -- the events. The service plan and readiness are untouched, so a successful
    -- re-authorization needs no re-planning.
    update public.couranr_payment_obligations
       set payment_state        = 'failed',
           failed_at            = now(),
           capture_requested_at = null,
           version              = version + 1,
           updated_at           = now()
     where id = v_ob.id and payment_state = 'capture_pending'
    returning * into v_ob;

    if not found then
      raise exception 'version_or_state_conflict' using errcode = 'CR409';
    end if;

  else
    -- The intent is dead. Everything pointing at this obligation has to stop.
    update public.couranr_payment_obligations
       set payment_state        = 'cancelled',
           cancelled_at         = now(),
           capture_requested_at = null,
           version              = version + 1,
           updated_at           = now()
     where id = v_ob.id and payment_state = 'capture_pending'
    returning * into v_ob;

    if not found then
      raise exception 'version_or_state_conflict' using errcode = 'CR409';
    end if;

    -- Every live link authorizes THIS obligation, which is no longer payable.
    v_tokens := public.couranr_revoke_payment_access_tokens(
                  v_ob.request_id, 'payment_cancelled_by_provider');

    -- The plan committed a pickup window against THIS obligation, and
    -- couranr_begin_payment_capture checks payment_obligation_id matches.
    v_plans := public.couranr_cancel_service_plan(
                 v_ob.request_id, 'payment_obligation_cancelled_by_provider');
  end if;

  v_out := row('applied', v_ob.id, v_ob.request_id, v_ob.payment_state, null, null)
            ::public.couranr_payment_apply_result;
  return v_out;
end
$fn$;

comment on function public.couranr_resolve_terminal_capture_failure is
  'Settles a capture_pending obligation from a VERIFIED terminal PaymentIntent status. Maps only requires_payment_method -> failed and canceled -> cancelled; every other status is refused. Verifies intent, amount and currency against the stored obligation and fails closed on any mismatch. Idempotent on provider_event_id. For cancelled it also revokes live payment links and cancels the service plan that referenced the dead obligation. SECURITY INVOKER, service_role only.';

revoke all on function public.couranr_resolve_terminal_capture_failure(uuid, text, text, text, integer, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_resolve_terminal_capture_failure(uuid, text, text, text, integer, text, text)
  to service_role;

commit;

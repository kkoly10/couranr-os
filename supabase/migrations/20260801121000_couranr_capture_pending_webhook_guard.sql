-- =====================================================================
-- Capture reconciliation is the AUTHORITY once an obligation is
-- capture_pending. The generic authorization path must not touch it.
--
-- `couranr_apply_payment_intent_state` is the webhook's state machine for the
-- AUTHORIZATION lifecycle. It had no precondition on the obligation's current
-- state at all — its final UPDATE was `where id = v_ob.id`, nothing more — so
-- an event arriving while a capture was in flight applied straight over it.
--
-- Three ways that goes wrong, all reachable from a correctly signed webhook:
--
--   payment_intent.amount_capturable_updated
--     capture_pending -> authorized. The dangerous one: it silently re-arms
--     the Capture button on an obligation whose capture is still in flight,
--     which is precisely the double-capture that capture_pending exists to
--     prevent.
--
--   payment_intent.payment_failed
--     capture_pending -> failed, WITHOUT clearing capture_requested_at and
--     without any terminal-resolution side effects.
--
--   payment_intent.canceled
--     capture_pending -> cancelled, leaving live payment links pointing at a
--     dead obligation and a confirmed service plan that can never be captured.
--
-- The last two produce a state that LOOKS settled while the invariants around
-- it are not — harder to notice than an outright failure.
--
-- The function now refuses a capture_pending obligation. It still writes the
-- append-only event, because Stripe genuinely sent it and it belongs in the
-- ledger, but as `ignored` with a reason, and it mutates nothing.
-- `couranr_resolve_terminal_capture_failure` and
-- `couranr_complete_payment_capture` are the only writers from capture_pending.
--
-- The compare-and-set also now names the state the function read, so even a
-- capture beginning between the SELECT and the UPDATE matches no row rather
-- than overwriting it.
--
-- APPLIED to the live project as migration 20260801120745. This file is
-- byte-identical to `pg_get_functiondef` for the live function.
-- ADDITIVE. One function replaced by its identical signature.
-- =====================================================================

begin;

set local statement_timeout = '60s';
set local lock_timeout = '10s';

create or replace function public.couranr_apply_payment_intent_state(
  p_provider_event_id text,
  p_event_type        text,
  p_payment_intent_id text,
  p_intent_status     text,
  p_amount            integer,
  p_amount_capturable integer,
  p_currency          text,
  p_metadata          jsonb
)
returns public.couranr_payment_apply_result
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_ob      public.couranr_payment_obligations;
  v_req     public.couranr_delivery_requests;
  v_out     public.couranr_payment_apply_result;
  v_outcome text;
  v_reason  text;
  v_target  text;
  v_before  text;
  v_reqstate text;
  v_ob_id   uuid;
  v_req_id  uuid;
begin
  if p_provider_event_id is null or length(btrim(p_provider_event_id)) = 0 then
    raise exception 'provider_event_id_required' using errcode = 'CR422';
  end if;

  select * into v_ob
    from public.couranr_payment_obligations
   where provider_payment_intent_id = p_payment_intent_id;

  if not found then
    v_outcome := 'rejected';
    v_reason  := 'unknown_payment_intent';
  elsif p_amount is distinct from v_ob.amount_cents then
    v_outcome := 'rejected';
    v_reason  := 'amount_mismatch';
  elsif lower(coalesce(p_currency,'')) is distinct from v_ob.currency then
    v_outcome := 'rejected';
    v_reason  := 'currency_mismatch';
  elsif coalesce(p_metadata ->> 'paymentObligationId', '') <> v_ob.id::text then
    v_outcome := 'rejected';
    v_reason  := 'metadata_obligation_mismatch';
  elsif coalesce(p_metadata ->> 'couranrRequestId', '') <> v_ob.request_id::text then
    v_outcome := 'rejected';
    v_reason  := 'metadata_request_mismatch';
  elsif coalesce(p_metadata ->> 'businessAccountId', '') <> v_ob.business_account_id::text then
    v_outcome := 'rejected';
    v_reason  := 'metadata_business_mismatch';
  -- THE GUARD. After identity, before any event mapping, so the ledger still
  -- records that Stripe said something about a real obligation while nothing
  -- is applied to it.
  elsif v_ob.payment_state = 'capture_pending' then
    v_outcome := 'ignored';
    v_reason  := 'capture_reconciliation_is_authoritative';
  else
    case p_event_type
      when 'payment_intent.amount_capturable_updated' then
        if p_intent_status = 'requires_capture'
           and p_amount_capturable is not distinct from v_ob.amount_cents then
          v_target := 'authorized'; v_outcome := 'applied';
        else
          v_outcome := 'rejected'; v_reason := 'not_fully_capturable';
        end if;
      when 'payment_intent.requires_action' then
        v_target := 'requires_action'; v_outcome := 'applied';
      when 'payment_intent.payment_failed' then
        v_target := 'failed'; v_outcome := 'applied';
      when 'payment_intent.canceled' then
        v_target := 'cancelled'; v_outcome := 'applied';
      else
        v_outcome := 'ignored'; v_reason := 'unhandled_event_type';
    end case;
  end if;

  if v_outcome = 'applied' and v_ob.payment_state = v_target then
    v_outcome := 'ignored';
    v_reason  := 'already_in_state';
  end if;

  v_before := v_ob.payment_state;

  begin
    insert into public.couranr_payment_events (
      obligation_id, request_id, provider, provider_event_id, event_type,
      payment_state_before, payment_state_after, outcome, detail
    ) values (
      v_ob.id, v_ob.request_id, 'stripe', p_provider_event_id, p_event_type,
      v_before,
      case when v_outcome = 'applied' then v_target else v_before end,
      v_outcome,
      jsonb_build_object(
        'paymentIntentId', p_payment_intent_id,
        'intentStatus',    p_intent_status,
        'amount',          p_amount,
        'amountCapturable', p_amount_capturable,
        'currency',        p_currency,
        'reason',          v_reason
      )
    );
  exception when unique_violation then
    v_out := row('duplicate', v_ob.id, v_ob.request_id, v_ob.payment_state, null, null)
              ::public.couranr_payment_apply_result;
    return v_out;
  end;

  if v_outcome <> 'applied' then
    v_out := row(v_outcome, v_ob.id, v_ob.request_id, v_ob.payment_state, null, v_reason)
              ::public.couranr_payment_apply_result;
    return v_out;
  end if;

  -- Ids captured first: `returning into` sets the record to NULL when nothing
  -- matched, and the refusal still has to say which obligation it was about.
  v_ob_id  := v_ob.id;
  v_req_id := v_ob.request_id;

  update public.couranr_payment_obligations
     set payment_state  = v_target,
         authorized_at  = case when v_target = 'authorized' then now() else authorized_at end,
         failed_at      = case when v_target = 'failed'     then now() else failed_at end,
         cancelled_at   = case when v_target = 'cancelled'  then now() else cancelled_at end,
         version        = version + 1,
         updated_at     = now()
   where id = v_ob_id
     and payment_state = v_before
     and payment_state <> 'capture_pending'
  returning * into v_ob;

  if not found then
    v_out := row('ignored', v_ob_id, v_req_id, v_before, null,
                 'state_changed_during_apply')::public.couranr_payment_apply_result;
    return v_out;
  end if;

  if v_target = 'authorized' then
    select * into v_req
      from public.couranr_delivery_requests where id = v_ob.request_id for update;

    if v_req.request_state in ('awaiting_quote_acceptance','quote_revision_required') then
      v_reqstate := v_req.request_state;
      update public.couranr_delivery_requests
         set request_state = 'confirmed',
             version       = version + 1,
             updated_at    = now()
       where id = v_req.id
      returning * into v_req;

      insert into public.couranr_delivery_request_events (
        request_id, actor_user_id, actor_type, command, from_state, to_state, metadata
      ) values (
        v_req.id, null, 'system', 'record_payer_quote_approval',
        v_reqstate, 'confirmed',
        jsonb_build_object(
          'payerType',              v_ob.payer_type,
          'paymentObligationId',    v_ob.id,
          'authorizedAmountCents',  v_ob.amount_cents,
          'pricingPolicyVersion',   v_ob.pricing_policy_version,
          'paymentState',           'authorized',
          'captured',               false
        )
      );
    end if;

    update public.couranr_payment_access_tokens
       set revoked_at = now(), revoked_reason = 'payment_authorized'
     where request_id = v_ob.request_id and revoked_at is null;
  end if;

  select request_state into v_reqstate
    from public.couranr_delivery_requests where id = v_ob.request_id;

  v_out := row('applied', v_ob.id, v_ob.request_id, v_ob.payment_state, v_reqstate, null)
            ::public.couranr_payment_apply_result;
  return v_out;
end
$fn$;

comment on function public.couranr_apply_payment_intent_state is
  'Authorization-lifecycle state machine for verified Stripe PaymentIntent events. REFUSES any obligation in capture_pending - capture reconciliation is authoritative there, and applying an authorization event over an in-flight capture would re-arm Capture on money that may already have moved. SECURITY INVOKER, service_role only.';

commit;

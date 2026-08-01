-- =====================================================================
-- Two faults in `couranr_create_payment_obligation`'s reuse guard. Both were
-- found by driving the recovery path in a browser, not by reading it.
--
-- 1. IT COMPARED THE WRONG VERSION.
--
--    The guard that decides "this obligation is still for the current quote"
--    included
--
--        v_ob.request_version is not distinct from v_req.version
--
--    but `couranr_delivery_requests.version` is the OPTIMISTIC CONCURRENCY
--    counter: every command bumps it, including `mark_delivery_ready`. The
--    obligation is created BEFORE readiness, so by the time anything calls
--    create again the versions always differ and the guard always says
--    "superseded".
--
--    This is the SAME defect, in a second function, that migration
--    20260801100000 already fixed in `couranr_apply_readiness`. Its reasoning
--    applies verbatim: the fields that encode a quote generation are
--    `delivery_subtotal_cents` and `pricing_policy_version` — a requote changes
--    both and nothing else does — while `version` changes for reasons that have
--    nothing to do with price. `request_version` stays on the obligation as
--    PROVENANCE; it just no longer decides equivalence.
--
--    What it cost: a merchant recovering from a settled `failed` capture got a
--    NEW obligation instead of re-confirming the intent Stripe documents as
--    re-confirmable. The confirmed service plan still pointed at the old
--    obligation, and `couranr_begin_payment_capture` requires
--    `v_plan.payment_obligation_id = v_ob.id` — so the delivery could never be
--    captured. The `failed` and `cancelled` branches also became
--    indistinguishable, which is the entire point of separating them.
--
-- 2. IT COULD CANCEL MONEY THAT WAS IN FLIGHT.
--
--    On a mismatch the function marks the live obligation `cancelled`. Nothing
--    excluded `capture_pending` or `captured`, so a create call landing while a
--    capture was in flight silently cancelled the obligation that owned it —
--    erasing, from the row, that money may already have moved. Reached in the
--    suite by issuing a payment link on a `capture_pending` request.
--
--    A quote change can never be a reason to abandon money already committed.
--    It is now refused with CR409 and the operator has to resolve the capture
--    first. An UNCHANGED quote still returns the same obligation, so issuing a
--    link mid-capture keeps working.
--
-- ADDITIVE. One function replaced by its identical signature. No table, column
-- or row is touched.
-- =====================================================================

begin;

set local statement_timeout = '60s';
set local lock_timeout = '10s';

create or replace function public.couranr_create_payment_obligation(
  p_request_id          uuid,
  p_business_account_id uuid,
  p_idempotency_key     text
)
returns public.couranr_payment_obligations
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_ob  public.couranr_payment_obligations;
  v_gen integer;
begin
  select * into v_req
    from public.couranr_delivery_requests
   where id = p_request_id and business_account_id = p_business_account_id;
  if not found then
    raise exception 'request_not_found' using errcode = 'CR404';
  end if;

  if v_req.request_state not in
     ('confirmed','awaiting_quote_acceptance','quote_revision_required') then
    raise exception 'request_not_payable' using errcode = 'CR409';
  end if;

  if v_req.delivery_subtotal_cents is null or v_req.delivery_subtotal_cents <= 0 then
    raise exception 'request_has_no_quote' using errcode = 'CR409';
  end if;

  select * into v_ob
    from public.couranr_payment_obligations
   where request_id = p_request_id and payment_state <> 'cancelled'
   limit 1;

  if found then
    if v_ob.payment_state = 'authorized' then
      return v_ob;
    end if;

    -- Still the same quote. `request_version` is deliberately NOT compared:
    -- it is the concurrency counter, and readiness alone bumps it.
    if v_ob.amount_cents is not distinct from v_req.delivery_subtotal_cents
       and v_ob.pricing_policy_version is not distinct from v_req.pricing_policy_version
       and v_ob.payer_type is not distinct from v_req.payer_type then
      return v_ob;
    end if;

    -- The quote CHANGED, and money is in flight or already taken. Superseding
    -- here would cancel the row that owns it. Refuse; the capture has to be
    -- resolved first.
    if v_ob.payment_state in ('capture_pending','captured') then
      raise exception 'payment_in_progress' using errcode = 'CR409';
    end if;

    update public.couranr_payment_obligations
       set payment_state = 'cancelled',
           cancelled_at  = now(),
           version       = version + 1,
           updated_at    = now()
     where id = v_ob.id;

    update public.couranr_payment_access_tokens
       set revoked_at = now(), revoked_reason = 'quote_superseded'
     where request_id = p_request_id and revoked_at is null;
  end if;

  -- The generation this request is on. Counts every obligation ever created
  -- for it, including cancelled ones, so a replacement never reuses a key a
  -- surviving row still holds.
  select count(*) + 1 into v_gen
    from public.couranr_payment_obligations
   where request_id = p_request_id;

  insert into public.couranr_payment_obligations (
    request_id, business_account_id, payer_type, request_version,
    pricing_policy_version, amount_cents, currency, payment_state,
    provider, idempotency_key
  ) values (
    v_req.id, v_req.business_account_id, v_req.payer_type, v_req.version,
    v_req.pricing_policy_version,
    v_req.delivery_subtotal_cents,
    'usd', 'not_started', 'stripe', p_idempotency_key || ':g' || v_gen::text
  )
  returning * into v_ob;

  return v_ob;
end
$fn$;

comment on function public.couranr_create_payment_obligation is
  'Creates or returns the live payment obligation for a request. Idempotent: an unchanged quote returns the existing obligation, where "unchanged" means amount, pricing policy and payer — never the request version, which is the concurrency counter and bumps for readiness. A superseded obligation is replaced by a new generation whose stored idempotency key carries the generation number. A quote change is REFUSED (CR409 payment_in_progress) while a capture is pending or captured: money in flight is never abandoned by a create call. SECURITY INVOKER, service_role only.';

commit;

-- =====================================================================
-- Re-authorizing after a cancelled obligation collided on
-- `couranr_po_idempotency_uniq (request_id, idempotency_key)`.
--
-- The only production caller passes a CONSTANT key — `authorize:<requestId>`
-- (app/api/couranr/delivery-requests/[id]/authorize-payment/route.ts) — so a
-- second click reaches the same idempotent create. Correct while one
-- obligation exists. But a cancelled obligation is not deleted: it keeps its
-- row and therefore its key, so the INSERT creating its replacement violates
-- the unique constraint. `classifyDatabaseError` has no 23505 case, so it
-- surfaces as `internal` with a correlation id and no recovery.
--
-- That is exactly the dead end the terminal-capture `cancel` branch exists to
-- escape — cancel the obligation, then re-authorize. Without this, shipping
-- `cancel` would have created an unrecoverable state rather than resolved one.
--
-- The stored key now carries the obligation GENERATION. Double-click
-- protection is unaffected: that is served by the SELECT above the insert,
-- which returns the live obligation and never reaches this line.
--
-- APPLIED to the live project as migration 20260801121201.
-- ADDITIVE. One function replaced by its identical signature.
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

    if v_ob.amount_cents is not distinct from v_req.delivery_subtotal_cents
       and v_ob.pricing_policy_version is not distinct from v_req.pricing_policy_version
       and v_ob.request_version is not distinct from v_req.version
       and v_ob.payer_type is not distinct from v_req.payer_type then
      return v_ob;
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
  'Creates or returns the live payment obligation for a request. Idempotent: an unchanged quote returns the existing obligation. A superseded or cancelled obligation is replaced by a new generation, whose stored idempotency key is suffixed with the generation number so it cannot collide with the key the superseded row still holds. SECURITY INVOKER, service_role only.';

commit;

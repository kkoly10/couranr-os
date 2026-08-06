-- Rollback for 20260801130000_couranr_obligation_supersede_guard.
--
-- Restores the PREVIOUS definition of each function this migration replaced.
-- Dropping them would remove behaviour an earlier migration created and that
-- live code still calls; the bodies below are copied verbatim from the
-- migration named against each one.

begin;

-- couranr_create_payment_obligation: restored from 20260801122000_couranr_obligation_generation_key.sql
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

commit;

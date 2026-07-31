-- =====================================================================
-- Fix: couranr_redeem_payment_access_token raised 42702 on every call.
--
-- `returns table (… request_id uuid, obligation_id uuid, request_state text,
-- payment_state text, payer_type text, amount_cents integer)` declares those
-- names as OUT parameters, which are ordinary PL/pgSQL variables inside the
-- body. The obligation lookup then read
--
--     where request_id = v_req.id and payment_state <> 'cancelled'
--
-- where BOTH names are simultaneously an OUT parameter and a column of
-- `couranr_payment_obligations`. PostgreSQL refuses rather than guessing:
--
--     42702: column reference "request_id" is ambiguous
--     DETAIL: It could refer to either a PL/pgSQL variable or a table column.
--
-- So redemption failed 100% of the time — every customer payment link would
-- have been dead. It typechecked, it applied cleanly, and it was only caught
-- by calling it. (PostgreSQL 17 §43.11.1, "Variable Substitution".)
--
-- The fix is to alias the table and qualify every column, which is the
-- documented resolution and leaves the returned shape untouched — renaming the
-- OUT parameters would have changed the JSON keys PostgREST emits.
--
-- ADDITIVE. One function replaced by its identical signature. No table, no
-- column, no row, no other function.
-- =====================================================================

begin;

set local statement_timeout = '60s';
set local lock_timeout = '10s';

drop function if exists public.couranr_redeem_payment_access_token(text);

create function public.couranr_redeem_payment_access_token(p_token_hash text)
returns table (
  valid           boolean,
  reason          text,
  request_id      uuid,
  obligation_id   uuid,
  request_state   text,
  payment_state   text,
  payer_type      text,
  amount_cents    integer
)
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_tok public.couranr_payment_access_tokens;
  v_req public.couranr_delivery_requests;
  v_ob  public.couranr_payment_obligations;
begin
  select t.* into v_tok
    from public.couranr_payment_access_tokens t
   where t.token_hash = p_token_hash;

  if not found then
    return query select false, 'not_found'::text, null::uuid, null::uuid,
                        null::text, null::text, null::text, null::integer;
    return;
  end if;

  if v_tok.revoked_at is not null then
    return query select false, 'revoked'::text, v_tok.request_id, v_tok.obligation_id,
                        null::text, null::text, null::text, null::integer;
    return;
  end if;

  if v_tok.expires_at <= now() then
    return query select false, 'expired'::text, v_tok.request_id, v_tok.obligation_id,
                        null::text, null::text, null::text, null::integer;
    return;
  end if;

  select r.* into v_req
    from public.couranr_delivery_requests r
   where r.id = v_tok.request_id;

  if not found then
    return query select false, 'not_found'::text, null::uuid, null::uuid,
                        null::text, null::text, null::text, null::integer;
    return;
  end if;

  if v_req.request_state not in
     ('confirmed','awaiting_quote_acceptance','quote_revision_required') then
    return query select false, 'request_not_payable'::text, v_req.id, v_tok.obligation_id,
                        v_req.request_state, null::text, null::text, null::integer;
    return;
  end if;

  -- Aliased. This is the line that raised 42702.
  select o.* into v_ob
    from public.couranr_payment_obligations o
   where o.request_id = v_req.id
     and o.payment_state <> 'cancelled'
   limit 1;

  if not found then
    return query select false, 'no_obligation'::text, v_req.id, null::uuid,
                        v_req.request_state, null::text, null::text, null::integer;
    return;
  end if;

  if v_ob.payment_state = 'authorized' then
    return query select false, 'already_authorized'::text, v_req.id, v_ob.id,
                        v_req.request_state, v_ob.payment_state, v_ob.payer_type,
                        v_ob.amount_cents;
    return;
  end if;

  -- The link must point at the CURRENT quote. Checked here as well as at
  -- revocation time, so a missed revocation cannot let an old amount be paid.
  if v_ob.amount_cents is distinct from v_req.delivery_subtotal_cents
     or v_ob.pricing_policy_version is distinct from v_req.pricing_policy_version then
    return query select false, 'quote_changed'::text, v_req.id, v_ob.id,
                        v_req.request_state, v_ob.payment_state, v_ob.payer_type,
                        v_ob.amount_cents;
    return;
  end if;

  update public.couranr_payment_access_tokens t
     set last_used_at = now()
   where t.id = v_tok.id;

  return query select true, null::text, v_req.id, v_ob.id,
                      v_req.request_state, v_ob.payment_state, v_ob.payer_type,
                      v_ob.amount_cents;
end
$fn$;

comment on function public.couranr_redeem_payment_access_token is
  'Resolves a payment link by its SHA-256 hash. Refuses a revoked, expired, superseded or already-authorized link, and re-checks that the obligation still matches the request quote so a missed revocation cannot let an old amount be paid. SECURITY INVOKER, service_role only.';

revoke all on function public.couranr_redeem_payment_access_token(text)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_redeem_payment_access_token(text)
  to service_role;

commit;

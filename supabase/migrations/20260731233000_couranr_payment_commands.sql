-- =====================================================================
-- Couranr payment authorization — named server commands.
--
-- Every mutation below is ONE call that does its state change AND its audit
-- row in a single transaction. Nothing here captures, refunds, creates an
-- order, creates a delivery, or dispatches. There is deliberately no capture
-- command: the absence is the guarantee.
--
-- WHAT MAY SET `authorized`.
-- Exactly one function, `couranr_apply_payment_intent_state`, and only when it
-- is told the PaymentIntent's status is `requires_capture` with an
-- `amount_capturable` equal to the stored amount. A browser redirect, a
-- Payment Element callback and an optimistic client update can none of them
-- reach it — they do not carry a verified PaymentIntent, and the caller that
-- does is either the signed webhook or a server-side retrieve.
--
-- IDEMPOTENCY IS A CONSTRAINT, NOT A CHECK.
-- The event row is inserted FIRST, inside its own sub-block. A replay collides
-- on `couranr_pe_provider_event_uniq` and returns `duplicate` having applied
-- nothing. Two simultaneous deliveries of the same event cannot both read
-- "not seen" and both apply, which is exactly what a read-then-write check
-- allows.
--
-- All SECURITY INVOKER with `set search_path = ''`, service_role only.
-- =====================================================================

begin;

set local statement_timeout = '120s';
set local lock_timeout = '10s';

-- ---------------------------------------------------------------------
-- The composite these commands report through. A plain row type, so the
-- caller gets the outcome and the resulting states in one round trip.
-- ---------------------------------------------------------------------
create type public.couranr_payment_apply_result as (
  outcome            text,
  obligation_id      uuid,
  request_id         uuid,
  payment_state      text,
  request_state      text,
  rejected_reason    text
);

-- ---------------------------------------------------------------------
-- 1. couranr_create_payment_obligation
--
-- Idempotent. Returns the existing live obligation when it still matches the
-- request's current quote; supersedes it when the quote has moved on.
--
-- Takes NO amount. The amount is read from the request.
-- ---------------------------------------------------------------------
create function public.couranr_create_payment_obligation(
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
begin
  select * into v_req
    from public.couranr_delivery_requests
   where id = p_request_id and business_account_id = p_business_account_id;
  if not found then
    raise exception 'request_not_found' using errcode = 'CR404';
  end if;

  -- Only a request the payer can actually be asked to pay for.
  if v_req.request_state not in
     ('confirmed','awaiting_quote_acceptance','quote_revision_required') then
    raise exception 'request_not_payable' using errcode = 'CR409';
  end if;

  -- And only against a real server-computed quote.
  if v_req.quote_status is distinct from 'estimated'
     or v_req.delivery_subtotal_cents is null
     or v_req.delivery_subtotal_cents <= 0
     or v_req.pricing_policy_version is null then
    raise exception 'no_server_quote_to_authorize' using errcode = 'CR422';
  end if;

  select * into v_ob
    from public.couranr_payment_obligations
   where request_id = p_request_id and payment_state <> 'cancelled'
   limit 1;

  if found then
    -- Still the same quote? Then this is a repeat of the same intent and the
    -- caller gets the same obligation back — no second PaymentIntent.
    if v_ob.amount_cents = v_req.delivery_subtotal_cents
       and v_ob.pricing_policy_version is not distinct from v_req.pricing_policy_version
       and v_ob.request_version = v_req.version
       and v_ob.payer_type = v_req.payer_type then
      return v_ob;
    end if;

    -- The quote moved. An obligation is never re-priced in place: the old one
    -- is cancelled and a new one is created, which is what PAY-002 specifies.
    if v_ob.payment_state = 'authorized' then
      raise exception 'authorized_obligation_cannot_be_superseded' using errcode = 'CR409';
    end if;

    update public.couranr_payment_obligations
       set payment_state = 'cancelled',
           cancelled_at  = now(),
           version       = version + 1,
           updated_at    = now()
     where id = v_ob.id;

    insert into public.couranr_payment_events (
      obligation_id, request_id, provider, provider_event_id, event_type,
      payment_state_before, payment_state_after, outcome, detail
    ) values (
      v_ob.id, p_request_id, 'stripe',
      'couranr:supersede:' || v_ob.id::text, 'couranr.obligation.superseded',
      v_ob.payment_state, 'cancelled', 'applied',
      jsonb_build_object(
        'reason', 'quote_changed',
        'previousAmountCents', v_ob.amount_cents,
        'newAmountCents', v_req.delivery_subtotal_cents
      )
    );

    -- A link that would pay the old amount must stop working immediately.
    update public.couranr_payment_access_tokens
       set revoked_at = now(), revoked_reason = 'quote_changed'
     where request_id = p_request_id and revoked_at is null;
  end if;

  insert into public.couranr_payment_obligations (
    request_id, business_account_id, payer_type, request_version,
    pricing_policy_version, amount_cents, currency, payment_state,
    provider, idempotency_key
  ) values (
    v_req.id, v_req.business_account_id, v_req.payer_type, v_req.version,
    v_req.pricing_policy_version,
    v_req.delivery_subtotal_cents,          -- server-stored. No parameter.
    'usd', 'not_started', 'stripe', p_idempotency_key
  )
  returning * into v_ob;

  insert into public.couranr_payment_events (
    obligation_id, request_id, provider, provider_event_id, event_type,
    payment_state_before, payment_state_after, outcome, detail
  ) values (
    v_ob.id, v_req.id, 'stripe',
    'couranr:create:' || v_ob.id::text, 'couranr.obligation.created',
    null, 'not_started', 'applied',
    jsonb_build_object(
      'amountCents', v_ob.amount_cents,
      'payerType', v_ob.payer_type,
      'requestVersion', v_ob.request_version,
      'pricingPolicyVersion', v_ob.pricing_policy_version
    )
  );

  return v_ob;
end
$fn$;

comment on function public.couranr_create_payment_obligation is
  'Idempotent. Returns the live obligation when it still matches the request quote, supersedes it when the quote moved, and creates one otherwise. The amount is read from the request; there is no amount parameter. SECURITY INVOKER, service_role only.';

-- ---------------------------------------------------------------------
-- 2. couranr_attach_payment_intent
--
-- Records which PaymentIntent belongs to an obligation. Moves the obligation
-- to `requires_action`, which means "a PaymentIntent exists and is waiting for
-- the payer" — NOT that anything has been authorized.
-- ---------------------------------------------------------------------
create function public.couranr_attach_payment_intent(
  p_obligation_id     uuid,
  p_expected_version  integer,
  p_payment_intent_id text
)
returns public.couranr_payment_obligations
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_ob public.couranr_payment_obligations;
begin
  if p_payment_intent_id is null or length(btrim(p_payment_intent_id)) = 0 then
    raise exception 'payment_intent_id_required' using errcode = 'CR422';
  end if;

  select * into v_ob from public.couranr_payment_obligations where id = p_obligation_id;
  if not found then
    raise exception 'obligation_not_found' using errcode = 'CR404';
  end if;

  -- Already attached to this intent: idempotent no-op.
  if v_ob.provider_payment_intent_id = p_payment_intent_id then
    return v_ob;
  end if;
  -- Attached to a DIFFERENT intent: refuse rather than repoint. Repointing
  -- would orphan a PaymentIntent that may already be holding funds.
  if v_ob.provider_payment_intent_id is not null then
    raise exception 'obligation_already_has_a_payment_intent' using errcode = 'CR409';
  end if;

  update public.couranr_payment_obligations
     set provider_payment_intent_id = p_payment_intent_id,
         payment_state = case when payment_state = 'not_started'
                              then 'requires_action' else payment_state end,
         version    = p_expected_version + 1,
         updated_at = now()
   where id = p_obligation_id
     and version = p_expected_version
     and payment_state in ('not_started','requires_action','failed')
  returning * into v_ob;

  if not found then
    raise exception 'version_or_state_conflict' using errcode = 'CR409';
  end if;

  insert into public.couranr_payment_events (
    obligation_id, request_id, provider, provider_event_id, event_type,
    payment_state_before, payment_state_after, outcome, detail
  ) values (
    v_ob.id, v_ob.request_id, 'stripe',
    'couranr:attach:' || v_ob.id::text || ':' || p_payment_intent_id,
    'couranr.payment_intent.attached',
    'not_started', v_ob.payment_state, 'applied',
    jsonb_build_object('paymentIntentId', p_payment_intent_id)
  );

  return v_ob;
end
$fn$;

comment on function public.couranr_attach_payment_intent is
  'Binds one PaymentIntent to one obligation and moves it to requires_action. Attaching authorizes nothing. Refuses to repoint an obligation that already names a different intent. SECURITY INVOKER, service_role only.';

-- ---------------------------------------------------------------------
-- 3. couranr_apply_payment_intent_state
--
-- THE ONLY PATH TO `authorized`.
--
-- Used by both the signed webhook and a server-side PaymentIntent retrieve;
-- the caller supplies a stable `p_provider_event_id` (Stripe's `evt_…` for a
-- webhook, a deterministic synthetic id for a retrieve) so both are idempotent
-- and neither can apply the same fact twice.
--
-- Every field is checked against the STORED obligation before anything moves.
-- A mismatch is recorded and rejected; it never mutates the request.
-- ---------------------------------------------------------------------
create function public.couranr_apply_payment_intent_state(
  p_provider_event_id  text,
  p_event_type         text,
  p_payment_intent_id  text,
  p_intent_status      text,
  p_amount             integer,
  p_amount_capturable  integer,
  p_currency           text,
  p_metadata           jsonb
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
  v_target  text;          -- the payment_state this event implies
  v_before  text;
  v_reqstate text;
begin
  if p_provider_event_id is null or length(btrim(p_provider_event_id)) = 0 then
    raise exception 'provider_event_id_required' using errcode = 'CR422';
  end if;

  select * into v_ob
    from public.couranr_payment_obligations
   where provider_payment_intent_id = p_payment_intent_id;

  -- ---- classify before writing anything -----------------------------
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
  else
    case p_event_type
      when 'payment_intent.amount_capturable_updated' then
        -- The manual-capture success signal. Funds are HELD, not taken.
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
        -- Includes payment_intent.succeeded, which under manual capture can
        -- only mean something captured outside Couranr. Recorded, never acted
        -- on: this slice has no capture semantics to apply.
        v_outcome := 'ignored'; v_reason := 'unhandled_event_type';
    end case;
  end if;

  -- An obligation already in the target state: record and report, change
  -- nothing. Keeps a re-delivered-but-differently-identified event harmless.
  if v_outcome = 'applied' and v_ob.payment_state = v_target then
    v_outcome := 'ignored';
    v_reason  := 'already_in_state';
  end if;

  v_before := v_ob.payment_state;

  -- ---- idempotency: first write wins, replays collide here -----------
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
    -- Seen before. Nothing is applied a second time.
    v_out := row('duplicate', v_ob.id, v_ob.request_id, v_ob.payment_state, null, null)
              ::public.couranr_payment_apply_result;
    return v_out;
  end;

  if v_outcome <> 'applied' then
    v_out := row(v_outcome, v_ob.id, v_ob.request_id, v_ob.payment_state, null, v_reason)
              ::public.couranr_payment_apply_result;
    return v_out;
  end if;

  -- ---- apply ---------------------------------------------------------
  update public.couranr_payment_obligations
     set payment_state  = v_target,
         authorized_at  = case when v_target = 'authorized' then now() else authorized_at end,
         failed_at      = case when v_target = 'failed'     then now() else failed_at end,
         cancelled_at   = case when v_target = 'cancelled'  then now() else cancelled_at end,
         version        = version + 1,
         updated_at     = now()
   where id = v_ob.id
  returning * into v_ob;

  if v_target = 'authorized' then
    -- The payer has approved the price by authorizing it. That closes
    -- awaiting_quote_acceptance and quote_revision_required — and ONLY those.
    -- A request already `confirmed` (merchant-paid, unchanged quote) is left
    -- exactly as it is.
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

    -- Authorized: the payment link has done its job and must stop working.
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
  'The only path to payment_state = authorized, and only for a requires_capture PaymentIntent whose amount, currency and metadata all match the stored obligation. Idempotent on provider_event_id. Authorizing closes awaiting_quote_acceptance and quote_revision_required and nothing else; it captures nothing and creates no order or delivery. SECURITY INVOKER, service_role only.';

-- ---------------------------------------------------------------------
-- 4. Payment access tokens.
-- ---------------------------------------------------------------------
create function public.couranr_issue_payment_access_token(
  p_request_id    uuid,
  p_obligation_id uuid,
  p_token_hash    text,
  p_ttl_days      integer
)
returns public.couranr_payment_access_tokens
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_tok public.couranr_payment_access_tokens;
  v_ttl integer;
begin
  -- Seven days is the ceiling, not a suggestion.
  v_ttl := least(greatest(coalesce(p_ttl_days, 7), 1), 7);

  if p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'token_hash_must_be_sha256_hex' using errcode = 'CR422';
  end if;

  select * into v_req from public.couranr_delivery_requests where id = p_request_id;
  if not found then
    raise exception 'request_not_found' using errcode = 'CR404';
  end if;
  if v_req.request_state not in
     ('confirmed','awaiting_quote_acceptance','quote_revision_required') then
    raise exception 'request_not_payable' using errcode = 'CR409';
  end if;

  -- One live link per request: issuing a new one retires the old.
  update public.couranr_payment_access_tokens
     set revoked_at = now(), revoked_reason = 'replaced_by_new_link'
   where request_id = p_request_id and revoked_at is null;

  insert into public.couranr_payment_access_tokens (
    request_id, business_account_id, obligation_id, token_hash, action, expires_at
  ) values (
    v_req.id, v_req.business_account_id, p_obligation_id, p_token_hash,
    'authorize_payment', now() + make_interval(days => v_ttl)
  )
  returning * into v_tok;

  return v_tok;
end
$fn$;

comment on function public.couranr_issue_payment_access_token is
  'Issues one payment link for one request, retiring any previous link. Stores only the SHA-256 hash — the raw token never reaches this function. TTL is capped at 7 days. SECURITY INVOKER, service_role only.';

/**
 * Redemption. Returns the request and obligation a valid token points at, and
 * a `reason` when it does not.
 *
 * Freshness is checked HERE as well as at revocation time: a link whose
 * obligation no longer matches the request's current quote is refused even if
 * nothing got round to revoking it. Revocation is the fast path; this is the
 * one that cannot be forgotten.
 */
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
  select * into v_tok
    from public.couranr_payment_access_tokens where token_hash = p_token_hash;

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

  select * into v_req from public.couranr_delivery_requests where id = v_tok.request_id;
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

  select * into v_ob
    from public.couranr_payment_obligations
   where request_id = v_req.id and payment_state <> 'cancelled'
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

  -- The link must point at the CURRENT quote.
  if v_ob.amount_cents is distinct from v_req.delivery_subtotal_cents
     or v_ob.pricing_policy_version is distinct from v_req.pricing_policy_version then
    return query select false, 'quote_changed'::text, v_req.id, v_ob.id,
                        v_req.request_state, v_ob.payment_state, v_ob.payer_type,
                        v_ob.amount_cents;
    return;
  end if;

  update public.couranr_payment_access_tokens
     set last_used_at = now() where id = v_tok.id;

  return query select true, null::text, v_req.id, v_ob.id,
                      v_req.request_state, v_ob.payment_state, v_ob.payer_type,
                      v_ob.amount_cents;
end
$fn$;

comment on function public.couranr_redeem_payment_access_token is
  'Resolves a payment link by its SHA-256 hash. Refuses a revoked, expired, superseded or already-authorized link, and re-checks that the obligation still matches the request quote so a missed revocation cannot let an old amount be paid. SECURITY INVOKER, service_role only.';

create function public.couranr_revoke_payment_access_tokens(
  p_request_id uuid,
  p_reason     text
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_n integer;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'revoke_reason_required' using errcode = 'CR422';
  end if;

  update public.couranr_payment_access_tokens
     set revoked_at = now(), revoked_reason = p_reason
   where request_id = p_request_id and revoked_at is null;

  get diagnostics v_n = row_count;
  return v_n;
end
$fn$;

comment on function public.couranr_revoke_payment_access_tokens is
  'Revokes every live payment link for a request. SECURITY INVOKER, service_role only.';

-- ---------------------------------------------------------------------
-- 5. Execution privileges.
--
-- PostgreSQL grants EXECUTE to PUBLIC on every new function, and this
-- project's pg_default_acl additionally grants it to anon, authenticated and
-- service_role. Both must go, or these are callable from a browser holding
-- only the publishable key.
-- ---------------------------------------------------------------------
revoke all on function public.couranr_create_payment_obligation(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.couranr_attach_payment_intent(uuid, integer, text)
  from public, anon, authenticated, service_role;
revoke all on function public.couranr_apply_payment_intent_state(
  text, text, text, text, integer, integer, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.couranr_issue_payment_access_token(uuid, uuid, text, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.couranr_redeem_payment_access_token(text)
  from public, anon, authenticated, service_role;
revoke all on function public.couranr_revoke_payment_access_tokens(uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.couranr_create_payment_obligation(uuid, uuid, text)
  to service_role;
grant execute on function public.couranr_attach_payment_intent(uuid, integer, text)
  to service_role;
grant execute on function public.couranr_apply_payment_intent_state(
  text, text, text, text, integer, integer, text, jsonb
) to service_role;
grant execute on function public.couranr_issue_payment_access_token(uuid, uuid, text, integer)
  to service_role;
grant execute on function public.couranr_redeem_payment_access_token(text)
  to service_role;
grant execute on function public.couranr_revoke_payment_access_tokens(uuid, text)
  to service_role;

commit;

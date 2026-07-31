-- Couranr review outcomes — REV-001, owner-approved 2026-07-31.
--
-- Adds the three named commands that end a Couranr review, and extends
-- submit_delivery_request to record the merchant's quote acknowledgment.
--
-- ADDITIVE. No table is dropped, no column is dropped, no row is deleted. The
-- submit function is re-created with one extra parameter because a signature
-- change cannot be done with CREATE OR REPLACE; dropping and recreating a
-- FUNCTION touches no data.
--
-- Transitions (REV-001). Confirm-as-quoted is PAYER-DEPENDENT:
--
--   confirm as quoted, payer = merchant   review=accepted_as_quoted  request=confirmed
--   confirm as quoted, payer = customer   review=accepted_as_quoted  request=awaiting_quote_acceptance
--   send revised quote (either payer)     review=requoted            request=quote_revision_required
--   could not confirm service (either)    review=declined            request=declined
--
-- `confirmed` means Couranr confirmed the request and the unchanged quote. It
-- does NOT mean payment authorized, captured, merchant ready, scheduled,
-- assigned or dispatched. Nothing here creates an order, a delivery or a
-- payment; payment, readiness and fulfillment remain separate state groups.
--
-- Every function is SECURITY INVOKER with `set search_path = ''` and every
-- `public` object fully qualified, so no search_path games can redirect them.

begin;

-- ---------------------------------------------------------------------
-- 0. Guard: these tables and the prior commands must already exist.
-- ---------------------------------------------------------------------
do $guard$
begin
  if to_regclass('public.couranr_delivery_requests') is null
     or to_regclass('public.couranr_delivery_request_events') is null then
    raise exception 'couranr request tables are missing; apply the earlier migrations first';
  end if;
end
$guard$;

-- ---------------------------------------------------------------------
-- 0b. Widen the event command allow-list.
--
-- couranr_dre_command_chk currently permits only the four commands that
-- existed when the events table was created. The three review outcomes would
-- violate it, so the allow-list is WIDENED — every existing value is kept and
-- three are added. Nothing is removed, so no existing row can become invalid.
--
-- Drop-then-add inside this transaction is the only way to change a CHECK; the
-- table is never unconstrained to any other session.
-- ---------------------------------------------------------------------
alter table public.couranr_delivery_request_events
  drop constraint if exists couranr_dre_command_chk;

alter table public.couranr_delivery_request_events
  add constraint couranr_dre_command_chk check (
    command = any (array[
      'create_delivery_request_draft',
      'calculate_delivery_request_estimate',
      'submit_delivery_request',
      'begin_delivery_request_review',
      'accept_delivery_request_as_quoted',
      'requote_delivery_request',
      'decline_delivery_request'
    ])
  );

-- ---------------------------------------------------------------------
-- 1. submit_delivery_request — now records the merchant acknowledgment.
--
-- The acknowledgment is what makes the merchant-paid shortcut to `confirmed`
-- safe: it is proof the merchant approved this exact quote at submission.
-- MER-006 states "I approve this delivery estimate if Couranr confirms it
-- without changes."
--
-- The metadata is written from the ROW AFTER UPDATE (v_row), never from the
-- caller's parameters, so what is recorded is the server-stored quote. A
-- browser-supplied subtotal cannot reach this event.
-- ---------------------------------------------------------------------
drop function if exists public.couranr_submit_delivery_request(
  uuid, uuid, integer, uuid, text, text, integer, integer, numeric, jsonb, jsonb
);

create function public.couranr_submit_delivery_request(
  p_request_id              uuid,
  p_business_account_id     uuid,
  p_expected_version        integer,
  p_actor_user_id           uuid,
  p_quote_status            text,
  p_pricing_policy_version  text,
  p_delivery_subtotal_cents integer,
  p_included_loaded_miles   integer,
  p_billable_loaded_miles   numeric,
  p_quote_line_items        jsonb,
  p_review_reasons          jsonb,
  -- Defaulted so this migration can land before the code that passes it. The
  -- default is FALSE, i.e. fail-closed: a caller that omits the acknowledgment
  -- produces a request that accept-as-quoted will REFUSE to confirm (CR409)
  -- rather than one it silently confirms.
  p_merchant_acknowledged   boolean default false
)
returns public.couranr_delivery_requests
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_row public.couranr_delivery_requests;
  v_sum bigint;
begin
  if jsonb_typeof(p_quote_line_items) <> 'array' then
    raise exception 'quote_line_items_not_array' using errcode = 'CR422';
  end if;

  if p_quote_status = 'estimated' then
    if p_delivery_subtotal_cents is null or p_pricing_policy_version is null then
      raise exception 'quote_incomplete' using errcode = 'CR422';
    end if;
    select coalesce(sum((li ->> 'amountCents')::bigint), 0)
      into v_sum
      from jsonb_array_elements(p_quote_line_items) as li;
    if v_sum is distinct from p_delivery_subtotal_cents::bigint then
      raise exception 'quote_subtotal_mismatch' using errcode = 'CR422';
    end if;
  elsif p_delivery_subtotal_cents is not null then
    raise exception 'quote_amount_on_unpriced_request' using errcode = 'CR422';
  end if;

  perform 1 from public.couranr_delivery_requests
   where id = p_request_id and business_account_id = p_business_account_id;
  if not found then
    raise exception 'request_not_found' using errcode = 'CR404';
  end if;

  update public.couranr_delivery_requests set
    request_state             = 'pending_couranr_review',
    review_state              = 'pending',
    submitted_at              = now(),
    quote_status              = p_quote_status,
    pricing_policy_version    = p_pricing_policy_version,
    delivery_subtotal_cents   = p_delivery_subtotal_cents,
    included_loaded_miles     = p_included_loaded_miles,
    billable_loaded_miles     = p_billable_loaded_miles,
    quote_line_items          = p_quote_line_items,
    review_reasons            = p_review_reasons,
    rounding_applied          = false,
    tax_included              = false,
    payment_due_cents         = null,
    version                   = p_expected_version + 1,
    updated_at                = now()
  where id                  = p_request_id
    and business_account_id = p_business_account_id
    and version             = p_expected_version
    and request_state       = 'draft'
  returning * into v_row;

  if not found then
    raise exception 'version_or_state_conflict' using errcode = 'CR409';
  end if;

  -- Written from v_row, i.e. the stored quote. Never from p_* inputs.
  insert into public.couranr_delivery_request_events (
    request_id, actor_user_id, actor_type, command, from_state, to_state, metadata
  ) values (
    v_row.id, p_actor_user_id, 'merchant', 'submit_delivery_request',
    'draft', 'pending_couranr_review',
    jsonb_build_object(
      'payerType',             v_row.payer_type,
      'pricingPolicyVersion',  v_row.pricing_policy_version,
      'deliverySubtotalCents', v_row.delivery_subtotal_cents,
      'quoteStatus',           v_row.quote_status,
      'acknowledgment',        coalesce(p_merchant_acknowledged, false),
      'reviewReasons',         v_row.review_reasons
    )
  );

  return v_row;
end
$fn$;

comment on function public.couranr_submit_delivery_request is
  'Atomic: moves a draft to pending_couranr_review and appends its submission event, recording the merchant quote acknowledgment from the STORED quote. SECURITY INVOKER, service_role only.';

-- ---------------------------------------------------------------------
-- 2. Confirm as quoted — PAYER-DEPENDENT (REV-001).
-- ---------------------------------------------------------------------
create function public.couranr_accept_delivery_request_as_quoted(
  p_request_id          uuid,
  p_business_account_id uuid,
  p_expected_version    integer,
  p_actor_user_id       uuid
)
returns public.couranr_delivery_requests
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_current  public.couranr_delivery_requests;
  v_row      public.couranr_delivery_requests;
  v_target   text;
  v_ack      jsonb;
begin
  select * into v_current
    from public.couranr_delivery_requests
   where id = p_request_id and business_account_id = p_business_account_id;
  if not found then
    raise exception 'request_not_found' using errcode = 'CR404';
  end if;

  -- A confirm must rest on a real, server-computed quote.
  if v_current.quote_status is distinct from 'estimated'
     or v_current.delivery_subtotal_cents is null then
    raise exception 'no_server_quote_to_confirm' using errcode = 'CR422';
  end if;

  if v_current.payer_type = 'merchant' then
    -- The shortcut past payer approval is only sound with proof that the
    -- merchant approved THIS quote at submission.
    select e.metadata into v_ack
      from public.couranr_delivery_request_events e
     where e.request_id = p_request_id
       and e.command    = 'submit_delivery_request'
     order by e.created_at desc
     limit 1;

    if v_ack is null or coalesce((v_ack ->> 'acknowledgment')::boolean, false) is not true then
      -- Never silently confirm. A stable conflict the caller can act on.
      raise exception 'merchant_acknowledgment_missing' using errcode = 'CR409';
    end if;

    -- The quote must be the SUBMITTED quote, unrevised.
    if (v_ack ->> 'deliverySubtotalCents') is null
       or (v_ack ->> 'deliverySubtotalCents')::bigint
            is distinct from v_current.delivery_subtotal_cents::bigint
       or (v_ack ->> 'pricingPolicyVersion')
            is distinct from v_current.pricing_policy_version then
      raise exception 'quote_revised_since_acknowledgment' using errcode = 'CR409';
    end if;

    v_target := 'confirmed';
  else
    -- Customer-paid: the merchant cannot approve on the customer's behalf.
    v_target := 'awaiting_quote_acceptance';
  end if;

  update public.couranr_delivery_requests set
    request_state = v_target,
    review_state  = 'accepted_as_quoted',
    version       = p_expected_version + 1,
    updated_at    = now()
  where id                  = p_request_id
    and business_account_id = p_business_account_id
    and version             = p_expected_version
    and request_state       = 'pending_couranr_review'
    and review_state        = 'pending'
  returning * into v_row;

  if not found then
    raise exception 'version_or_state_conflict' using errcode = 'CR409';
  end if;

  insert into public.couranr_delivery_request_events (
    request_id, actor_user_id, actor_type, command, from_state, to_state, metadata
  ) values (
    v_row.id, p_actor_user_id, 'operations', 'accept_delivery_request_as_quoted',
    'pending_couranr_review', v_target,
    jsonb_build_object(
      'payerType',             v_row.payer_type,
      'reviewState',           'accepted_as_quoted',
      'deliverySubtotalCents', v_row.delivery_subtotal_cents,
      'pricingPolicyVersion',  v_row.pricing_policy_version,
      'quoteChanged',          false
    )
  );

  return v_row;
end
$fn$;

comment on function public.couranr_accept_delivery_request_as_quoted is
  'Atomic: confirms the request at its stored quote. Merchant-paid goes to confirmed (requires the submission acknowledgment and an unrevised quote); customer-paid goes to awaiting_quote_acceptance. Creates no order, no delivery, no payment. SECURITY INVOKER, service_role only.';

-- ---------------------------------------------------------------------
-- 3. Send revised quote — same for both payer types.
-- ---------------------------------------------------------------------
create function public.couranr_requote_delivery_request(
  p_request_id              uuid,
  p_business_account_id     uuid,
  p_expected_version        integer,
  p_actor_user_id           uuid,
  p_pricing_policy_version  text,
  p_delivery_subtotal_cents integer,
  p_included_loaded_miles   integer,
  p_billable_loaded_miles   numeric,
  p_quote_line_items        jsonb,
  p_requote_reason          text
)
returns public.couranr_delivery_requests
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_current public.couranr_delivery_requests;
  v_row     public.couranr_delivery_requests;
  v_sum     bigint;
begin
  if p_requote_reason is null or length(btrim(p_requote_reason)) = 0 then
    raise exception 'requote_reason_required' using errcode = 'CR422';
  end if;
  if jsonb_typeof(p_quote_line_items) <> 'array' then
    raise exception 'quote_line_items_not_array' using errcode = 'CR422';
  end if;
  if p_delivery_subtotal_cents is null or p_pricing_policy_version is null then
    raise exception 'quote_incomplete' using errcode = 'CR422';
  end if;

  -- The revised line items must sum to the revised subtotal, exactly as at
  -- submission. A quote whose parts do not add up is never persisted.
  select coalesce(sum((li ->> 'amountCents')::bigint), 0) into v_sum
    from jsonb_array_elements(p_quote_line_items) as li;
  if v_sum is distinct from p_delivery_subtotal_cents::bigint then
    raise exception 'quote_subtotal_mismatch' using errcode = 'CR422';
  end if;

  select * into v_current
    from public.couranr_delivery_requests
   where id = p_request_id and business_account_id = p_business_account_id;
  if not found then
    raise exception 'request_not_found' using errcode = 'CR404';
  end if;

  update public.couranr_delivery_requests set
    request_state           = 'quote_revision_required',
    review_state            = 'requoted',
    quote_status            = 'estimated',
    pricing_policy_version  = p_pricing_policy_version,
    delivery_subtotal_cents = p_delivery_subtotal_cents,
    included_loaded_miles   = p_included_loaded_miles,
    billable_loaded_miles   = p_billable_loaded_miles,
    quote_line_items        = p_quote_line_items,
    payment_due_cents       = null,
    version                 = p_expected_version + 1,
    updated_at              = now()
  where id                  = p_request_id
    and business_account_id = p_business_account_id
    and version             = p_expected_version
    and request_state       = 'pending_couranr_review'
    and review_state        = 'pending'
  returning * into v_row;

  if not found then
    raise exception 'version_or_state_conflict' using errcode = 'CR409';
  end if;

  insert into public.couranr_delivery_request_events (
    request_id, actor_user_id, actor_type, command, from_state, to_state, metadata
  ) values (
    v_row.id, p_actor_user_id, 'operations', 'requote_delivery_request',
    'pending_couranr_review', 'quote_revision_required',
    jsonb_build_object(
      'payerType',                v_row.payer_type,
      'reviewState',              'requoted',
      'previousSubtotalCents',    v_current.delivery_subtotal_cents,
      'revisedSubtotalCents',     v_row.delivery_subtotal_cents,
      'pricingPolicyVersion',     v_row.pricing_policy_version,
      'reason',                   p_requote_reason,
      'quoteChanged',             true
    )
  );

  return v_row;
end
$fn$;

comment on function public.couranr_requote_delivery_request is
  'Atomic: replaces the quote with a server-recomputed one and moves the request to quote_revision_required for fresh payer approval. Line items must sum to the subtotal. SECURITY INVOKER, service_role only.';

-- ---------------------------------------------------------------------
-- 4. Could not confirm service — same for both payer types.
-- ---------------------------------------------------------------------
create function public.couranr_decline_delivery_request(
  p_request_id          uuid,
  p_business_account_id uuid,
  p_expected_version    integer,
  p_actor_user_id       uuid,
  p_decline_reason      text,
  p_internal_note       text
)
returns public.couranr_delivery_requests
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_row public.couranr_delivery_requests;
begin
  -- A structured reason is required. A decline with no reason is unreviewable
  -- later and unexplainable to the merchant.
  if p_decline_reason is null or length(btrim(p_decline_reason)) = 0 then
    raise exception 'decline_reason_required' using errcode = 'CR422';
  end if;

  perform 1 from public.couranr_delivery_requests
   where id = p_request_id and business_account_id = p_business_account_id;
  if not found then
    raise exception 'request_not_found' using errcode = 'CR404';
  end if;

  update public.couranr_delivery_requests set
    request_state = 'declined',
    review_state  = 'declined',
    version       = p_expected_version + 1,
    updated_at    = now()
  where id                  = p_request_id
    and business_account_id = p_business_account_id
    and version             = p_expected_version
    and request_state       = 'pending_couranr_review'
    and review_state        = 'pending'
  returning * into v_row;

  if not found then
    raise exception 'version_or_state_conflict' using errcode = 'CR409';
  end if;

  insert into public.couranr_delivery_request_events (
    request_id, actor_user_id, actor_type, command, from_state, to_state, metadata
  ) values (
    v_row.id, p_actor_user_id, 'operations', 'decline_delivery_request',
    'pending_couranr_review', 'declined',
    jsonb_build_object(
      'payerType',    v_row.payer_type,
      'reviewState',  'declined',
      'reason',       p_decline_reason,
      'internalNote', nullif(btrim(coalesce(p_internal_note, '')), '')
    )
  );

  return v_row;
end
$fn$;

comment on function public.couranr_decline_delivery_request is
  'Atomic: records Couranr could not confirm service, with a required structured reason. SECURITY INVOKER, service_role only.';

-- ---------------------------------------------------------------------
-- 5. Execution privileges.
--
-- PostgreSQL grants EXECUTE to PUBLIC on every new function, and this
-- project's pg_default_acl additionally grants EXECUTE to anon, authenticated
-- and service_role on every new function in `public`. Both must be revoked or
-- these are callable from a browser holding only the publishable key.
-- ---------------------------------------------------------------------
revoke all on function public.couranr_submit_delivery_request(
  uuid, uuid, integer, uuid, text, text, integer, integer, numeric, jsonb, jsonb, boolean
) from public, anon, authenticated, service_role;

revoke all on function public.couranr_accept_delivery_request_as_quoted(uuid, uuid, integer, uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.couranr_requote_delivery_request(
  uuid, uuid, integer, uuid, text, integer, integer, numeric, jsonb, text
) from public, anon, authenticated, service_role;

revoke all on function public.couranr_decline_delivery_request(uuid, uuid, integer, uuid, text, text)
  from public, anon, authenticated, service_role;

grant execute on function public.couranr_submit_delivery_request(
  uuid, uuid, integer, uuid, text, text, integer, integer, numeric, jsonb, jsonb, boolean
) to service_role;

grant execute on function public.couranr_accept_delivery_request_as_quoted(uuid, uuid, integer, uuid)
  to service_role;

grant execute on function public.couranr_requote_delivery_request(
  uuid, uuid, integer, uuid, text, integer, integer, numeric, jsonb, text
) to service_role;

grant execute on function public.couranr_decline_delivery_request(uuid, uuid, integer, uuid, text, text)
  to service_role;

commit;

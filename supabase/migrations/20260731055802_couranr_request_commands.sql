-- =====================================================================
-- Couranr atomic delivery-request commands — ADDITIVE MIGRATION
--
-- Creates exactly four functions:
--   public.couranr_create_delivery_request_draft
--   public.couranr_calculate_delivery_request_estimate
--   public.couranr_submit_delivery_request
--   public.couranr_begin_delivery_request_review
--
-- WHY. The TypeScript commands mutated the request and appended the audit
-- event through two separate PostgREST calls, which are two transactions. A
-- failed event insert left the request mutation committed while the API
-- reported an error — a state change with no audit trail. Each function below
-- performs the mutation and the event insert in ONE transaction, so both land
-- or neither does.
--
-- ADDITIVE ONLY: no DROP, no ALTER of any existing object, no DELETE, no
-- TRUNCATE, no change to any existing policy, grant or row.
--
-- SECURITY POSTURE
--   * SECURITY INVOKER (the default, stated explicitly). These functions add
--     no privilege of their own — the caller must already hold the table
--     grants, which only `service_role` does. A SECURITY DEFINER function here
--     would become a privilege-escalation surface reachable from PostgREST.
--   * `set search_path = ''` and every `public` object fully qualified, so a
--     caller cannot shadow a name. (pg_catalog is always implicitly searched,
--     so built-ins still resolve.)
--   * EXECUTE revoked from PUBLIC, anon and authenticated, then granted to
--     service_role alone. This is NOT optional bookkeeping: PostgreSQL grants
--     EXECUTE to PUBLIC on every new function by default, AND this project's
--     pg_default_acl grants EXECUTE to anon, authenticated and service_role on
--     every new function in `public`. Without the revokes these would be
--     callable from a browser with the anon key.
--   * No generic patch function, no arbitrary target-state parameter, and no
--     payment-amount parameter anywhere. Every state value is hard-coded.
--
-- ERROR CODES. Custom SQLSTATEs in the unused 'CR' class, so the TypeScript
-- layer can map them to stable sanitized errors without parsing messages:
--   CR404  request not found in this business account
--   CR409  version or state conflict — nothing was written
--   CR422  the quote the server passed is not internally consistent
-- =====================================================================

begin;

set local statement_timeout = '120s';
set local lock_timeout = '10s';

-- ---------------------------------------------------------------------
-- HARD GUARD. Refuse to run if any of the four names is already taken by
-- something whose shape has not been verified.
-- ---------------------------------------------------------------------
do $guard$
declare
  n integer;
begin
  select count(*) into n
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.proname in (
      'couranr_create_delivery_request_draft',
      'couranr_calculate_delivery_request_estimate',
      'couranr_submit_delivery_request',
      'couranr_begin_delivery_request_review');
  if n > 0 then
    raise exception
      'Refusing to run: % couranr_* command function(s) already exist. Inspect and roll back before re-applying.', n;
  end if;
end
$guard$;

-- ---------------------------------------------------------------------
-- 1. create draft + creation event, atomically
-- ---------------------------------------------------------------------
create function public.couranr_create_delivery_request_draft(
  p_business_account_id     uuid,
  p_created_by              uuid,
  p_idempotency_key         text,
  p_source                  text,
  p_readiness_state         text,
  p_payer_type              text,
  p_recipient_name          text,
  p_recipient_phone         text,
  p_recipient_email         text,
  p_loaded_miles            numeric,
  p_weight_lb               numeric,
  p_additional_stops        integer,
  p_service_level           text,
  p_signature_required      boolean,
  p_proof_method            text,
  p_pickup_address          jsonb,
  p_dropoff_address         jsonb,
  p_overnight_requested     boolean,
  p_quote_status            text,
  p_pricing_policy_version  text,
  p_delivery_subtotal_cents integer,
  p_included_loaded_miles   integer,
  p_billable_loaded_miles   numeric,
  p_quote_line_items        jsonb,
  p_review_reasons          jsonb
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
  -- Quote integrity. The subtotal must be exactly the sum of the line items
  -- the caller also passed, and an unpriced quote must carry no money at all.
  -- The server computes both, so a mismatch is a bug, not user input.
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

  begin
    insert into public.couranr_delivery_requests (
      business_account_id, created_by, idempotency_key,
      -- Hard-coded lifecycle. No caller names a state.
      request_state, review_state, service_area_review_state,
      source, readiness_state, payer_type,
      recipient_name, recipient_phone, recipient_email,
      loaded_miles, weight_lb, additional_stops,
      service_level, signature_required, proof_method,
      pickup_address, dropoff_address, normalized_request_payload,
      quote_status, pricing_policy_version, delivery_subtotal_cents,
      included_loaded_miles, billable_loaded_miles,
      quote_line_items, review_reasons,
      -- Hard-coded, never parameters: PRC-004 and TAX-001 are unresolved and
      -- this release makes no payment decision.
      rounding_applied, tax_included, payment_due_cents
    ) values (
      p_business_account_id, p_created_by, p_idempotency_key,
      'draft', 'not_required', 'pending',
      p_source, p_readiness_state, p_payer_type,
      p_recipient_name, p_recipient_phone, p_recipient_email,
      p_loaded_miles, p_weight_lb, p_additional_stops,
      p_service_level, p_signature_required, p_proof_method,
      p_pickup_address, p_dropoff_address,
      jsonb_build_object('overnightRequested', coalesce(p_overnight_requested, false)),
      p_quote_status, p_pricing_policy_version, p_delivery_subtotal_cents,
      p_included_loaded_miles, p_billable_loaded_miles,
      p_quote_line_items, p_review_reasons,
      false, false, null
    )
    returning * into v_row;
  exception when unique_violation then
    -- The same submission arriving twice. By the time a unique violation is
    -- raised the competing transaction has committed, so its row is visible to
    -- the next statement under READ COMMITTED. Return it and append NO second
    -- creation event.
    select * into v_row
    from public.couranr_delivery_requests
    where business_account_id = p_business_account_id
      and idempotency_key = p_idempotency_key;
    if not found then
      raise;
    end if;
    return v_row;
  end;

  -- Same transaction as the insert above: a request cannot exist without its
  -- creation event, and a failure here rolls the request back.
  insert into public.couranr_delivery_request_events (
    request_id, actor_user_id, actor_type, command, from_state, to_state, metadata
  ) values (
    v_row.id, p_created_by, 'merchant', 'create_delivery_request_draft',
    null, 'draft',
    jsonb_build_object('quoteStatus', p_quote_status, 'reviewReasons', p_review_reasons)
  );

  return v_row;
end
$fn$;

comment on function public.couranr_create_delivery_request_draft is
  'Atomic: creates a delivery-request draft and its creation event in one transaction. SECURITY INVOKER, service_role only. Idempotent on (business_account_id, idempotency_key).';

-- ---------------------------------------------------------------------
-- 2. re-estimate + estimate event, atomically
-- ---------------------------------------------------------------------
create function public.couranr_calculate_delivery_request_estimate(
  p_request_id              uuid,
  p_business_account_id     uuid,
  p_expected_version        integer,
  p_actor_user_id           uuid,
  -- When false every shipment parameter below is ignored and only the quote is
  -- rewritten. Two fixed column lists, never a dynamic patch.
  p_update_shipment         boolean,
  p_source                  text,
  p_readiness_state         text,
  p_payer_type              text,
  p_recipient_name          text,
  p_recipient_phone         text,
  p_recipient_email         text,
  p_loaded_miles            numeric,
  p_weight_lb               numeric,
  p_additional_stops        integer,
  p_service_level           text,
  p_signature_required      boolean,
  p_proof_method            text,
  p_pickup_address          jsonb,
  p_dropoff_address         jsonb,
  p_overnight_requested     boolean,
  p_quote_status            text,
  p_pricing_policy_version  text,
  p_delivery_subtotal_cents integer,
  p_included_loaded_miles   integer,
  p_billable_loaded_miles   numeric,
  p_quote_line_items        jsonb,
  p_review_reasons          jsonb
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

  -- Separates "not yours / does not exist" from "changed under you".
  perform 1 from public.couranr_delivery_requests
   where id = p_request_id and business_account_id = p_business_account_id;
  if not found then
    raise exception 'request_not_found' using errcode = 'CR404';
  end if;

  if p_update_shipment then
    update public.couranr_delivery_requests set
      source                    = p_source,
      readiness_state           = p_readiness_state,
      payer_type                = p_payer_type,
      recipient_name            = p_recipient_name,
      recipient_phone           = p_recipient_phone,
      recipient_email           = p_recipient_email,
      loaded_miles              = p_loaded_miles,
      weight_lb                 = p_weight_lb,
      additional_stops          = p_additional_stops,
      service_level             = p_service_level,
      signature_required        = p_signature_required,
      proof_method              = p_proof_method,
      pickup_address            = p_pickup_address,
      dropoff_address           = p_dropoff_address,
      normalized_request_payload =
        jsonb_build_object('overnightRequested', coalesce(p_overnight_requested, false)),
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
      -- Fixed permitted current state. Re-pricing a submitted request would
      -- change the numbers Couranr is already reviewing.
      and request_state       = 'draft'
    returning * into v_row;
  else
    update public.couranr_delivery_requests set
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
  end if;

  if not found then
    raise exception 'version_or_state_conflict' using errcode = 'CR409';
  end if;

  insert into public.couranr_delivery_request_events (
    request_id, actor_user_id, actor_type, command, from_state, to_state, metadata
  ) values (
    v_row.id, p_actor_user_id, 'merchant', 'calculate_delivery_request_estimate',
    'draft', 'draft',
    jsonb_build_object('quoteStatus', p_quote_status, 'reviewReasons', p_review_reasons)
  );

  return v_row;
end
$fn$;

comment on function public.couranr_calculate_delivery_request_estimate is
  'Atomic: re-prices a draft (optionally persisting an edited shipment) and appends its estimate event in one transaction. SECURITY INVOKER, service_role only.';

-- ---------------------------------------------------------------------
-- 3. submit + submission event, atomically
-- ---------------------------------------------------------------------
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
  p_review_reasons          jsonb
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
    -- Hard-coded destination. No caller supplies a target state.
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

  insert into public.couranr_delivery_request_events (
    request_id, actor_user_id, actor_type, command, from_state, to_state, metadata
  ) values (
    v_row.id, p_actor_user_id, 'merchant', 'submit_delivery_request',
    'draft', 'pending_couranr_review',
    jsonb_build_object('quoteStatus', p_quote_status, 'reviewReasons', p_review_reasons)
  );

  return v_row;
end
$fn$;

comment on function public.couranr_submit_delivery_request is
  'Atomic: moves a draft to pending_couranr_review and appends its submission event in one transaction. Creates no order, no delivery and no payment. SECURITY INVOKER, service_role only.';

-- ---------------------------------------------------------------------
-- 4. open for review + review event, atomically
-- ---------------------------------------------------------------------
create function public.couranr_begin_delivery_request_review(
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
  v_row public.couranr_delivery_requests;
begin
  perform 1 from public.couranr_delivery_requests
   where id = p_request_id and business_account_id = p_business_account_id;
  if not found then
    raise exception 'request_not_found' using errcode = 'CR404';
  end if;

  -- Records that Couranr Operations opened the request. It does NOT decide the
  -- outcome: accept_as_quoted, requoted and declined are canonical states that
  -- no function here can reach.
  update public.couranr_delivery_requests set
    version    = p_expected_version + 1,
    updated_at = now()
  where id                  = p_request_id
    and business_account_id = p_business_account_id
    and version             = p_expected_version
    and request_state       = 'pending_couranr_review'
  returning * into v_row;

  if not found then
    raise exception 'version_or_state_conflict' using errcode = 'CR409';
  end if;

  insert into public.couranr_delivery_request_events (
    request_id, actor_user_id, actor_type, command, from_state, to_state, metadata
  ) values (
    v_row.id, p_actor_user_id, 'operations', 'begin_delivery_request_review',
    'pending_couranr_review', 'pending_couranr_review',
    jsonb_build_object('openedBy', 'operations')
  );

  return v_row;
end
$fn$;

comment on function public.couranr_begin_delivery_request_review is
  'Atomic: records that Couranr Operations opened a request for review, bumping its version, in one transaction. Decides no outcome. SECURITY INVOKER, service_role only.';

-- ---------------------------------------------------------------------
-- 5. Execution privileges.
--
-- PostgreSQL grants EXECUTE to PUBLIC on every new function, and this
-- project's pg_default_acl additionally grants EXECUTE to anon, authenticated
-- and service_role on every new function in `public`. Both must be revoked or
-- these are callable from a browser holding only the anon key.
-- ---------------------------------------------------------------------
revoke all on function public.couranr_create_delivery_request_draft(
  uuid, uuid, text, text, text, text, text, text, text, numeric, numeric,
  integer, text, boolean, text, jsonb, jsonb, boolean, text, text, integer,
  integer, numeric, jsonb, jsonb
) from public, anon, authenticated, service_role;

revoke all on function public.couranr_calculate_delivery_request_estimate(
  uuid, uuid, integer, uuid, boolean, text, text, text, text, text, text,
  numeric, numeric, integer, text, boolean, text, jsonb, jsonb, boolean, text,
  text, integer, integer, numeric, jsonb, jsonb
) from public, anon, authenticated, service_role;

revoke all on function public.couranr_submit_delivery_request(
  uuid, uuid, integer, uuid, text, text, integer, integer, numeric, jsonb, jsonb
) from public, anon, authenticated, service_role;

revoke all on function public.couranr_begin_delivery_request_review(
  uuid, uuid, integer, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.couranr_create_delivery_request_draft(
  uuid, uuid, text, text, text, text, text, text, text, numeric, numeric,
  integer, text, boolean, text, jsonb, jsonb, boolean, text, text, integer,
  integer, numeric, jsonb, jsonb
) to service_role;

grant execute on function public.couranr_calculate_delivery_request_estimate(
  uuid, uuid, integer, uuid, boolean, text, text, text, text, text, text,
  numeric, numeric, integer, text, boolean, text, jsonb, jsonb, boolean, text,
  text, integer, integer, numeric, jsonb, jsonb
) to service_role;

grant execute on function public.couranr_submit_delivery_request(
  uuid, uuid, integer, uuid, text, text, integer, integer, numeric, jsonb, jsonb
) to service_role;

grant execute on function public.couranr_begin_delivery_request_review(
  uuid, uuid, integer, uuid
) to service_role;

commit;

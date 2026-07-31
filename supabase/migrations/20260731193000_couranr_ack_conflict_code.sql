-- =====================================================================
-- Give the acknowledgment refusal its own SQLSTATE.  (REV-001 follow-up)
--
-- WHY. `couranr_accept_delivery_request_as_quoted` raised CR409 for three
-- different conditions: a stale `version`, a missing merchant acknowledgment,
-- and a quote revised since the acknowledgment. CR409 classifies to the public
-- code `version_conflict`, whose copy is "This changed while you were working
-- on it. Reload and try again."
--
-- For a stale version that is right. For a missing acknowledgment it is wrong
-- and it is a TRAP: reloading changes nothing, so an operator follows that
-- instruction forever and never learns that the request needs the payer's
-- approval instead. Browser verification (e2e group L, assertion L11) caught
-- exactly that.
--
-- The owner's instruction was "return a stable conflict requiring payer
-- approval". A conflict it is — but a DIFFERENT one from a concurrency race,
-- and the two must be distinguishable by the caller. SQLSTATE is the only
-- honest discriminator: parsing the driver's message text is the
-- `resilientUpdateById` antipattern this codebase is moving away from.
--
-- CR412 is a legal user-defined SQLSTATE — five characters, digits and
-- upper-case ASCII only, not `00000`, and not ending in three zeroes (which
-- would make it a category code trappable only as a whole category).
-- (PostgreSQL 17 §43.9)
--
-- ADDITIVE. One function is replaced by its identical signature. No table, no
-- column, no row, no constraint and no other function is touched.
-- =====================================================================

begin;

set local statement_timeout = '60s';
set local lock_timeout = '10s';

do $guard$
begin
  if to_regprocedure('public.couranr_accept_delivery_request_as_quoted(uuid,uuid,integer,uuid)')
     is null then
    raise exception
      'couranr_accept_delivery_request_as_quoted is missing; apply 20260731180000 first';
  end if;
end
$guard$;

drop function public.couranr_accept_delivery_request_as_quoted(uuid, uuid, integer, uuid);

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

    -- CR412, not CR409: reloading will never fix this. The request needs the
    -- payer's approval, which means a revised quote — a different action, so
    -- it must reach the operator as a different message.
    if v_ack is null or coalesce((v_ack ->> 'acknowledgment')::boolean, false) is not true then
      raise exception 'merchant_acknowledgment_missing' using errcode = 'CR412';
    end if;

    -- The quote must be the SUBMITTED quote, unrevised.
    if (v_ack ->> 'deliverySubtotalCents') is null
       or (v_ack ->> 'deliverySubtotalCents')::bigint
            is distinct from v_current.delivery_subtotal_cents::bigint
       or (v_ack ->> 'pricingPolicyVersion')
            is distinct from v_current.pricing_policy_version then
      raise exception 'quote_revised_since_acknowledgment' using errcode = 'CR412';
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

  -- Still CR409: this one IS a concurrency conflict, and reloading is the
  -- correct instruction.
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
  'Atomic: confirms the request at its stored quote. Merchant-paid goes to confirmed (requires the submission acknowledgment and an unrevised quote, else CR412); customer-paid goes to awaiting_quote_acceptance. A stale version is CR409. Creates no order, no delivery, no payment. SECURITY INVOKER, service_role only.';

-- Re-establish the ACL: a dropped function takes its grants with it, and this
-- project's pg_default_acl hands EXECUTE to anon, authenticated, service_role
-- AND PUBLIC on every newly created function in `public`.
revoke all on function public.couranr_accept_delivery_request_as_quoted(uuid, uuid, integer, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.couranr_accept_delivery_request_as_quoted(uuid, uuid, integer, uuid)
  to service_role;

commit;

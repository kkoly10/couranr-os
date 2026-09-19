-- ============================================================================
-- Promotional-credit readiness parity
--
-- A fully applied Couranr promotional credit is already a canonical commercial
-- authority for planning and delivery conversion. Readiness must recognize the
-- same authority. Before this migration, a credited request that was not already
-- "ready" could never be marked ready because couranr_apply_readiness required
-- a Stripe authorization even though downstream service planning explicitly
-- accepts the matching promotional credit.
--
-- This is a narrow parity correction:
--   * no new browser/database privilege
--   * no relaxation for unpaid requests
--   * "ready" still requires exact commercial authority for the CURRENT quote
--   * either an authorized Stripe obligation OR an applied full Couranr credit
--   * all other readiness transitions are unchanged
-- ============================================================================
begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

create or replace function public.couranr_apply_readiness(
  p_request_id uuid,
  p_business_account_id uuid,
  p_expected_version integer,
  p_actor_user_id uuid,
  p_command text,
  p_to text,
  p_from text[]
)
returns public.couranr_delivery_requests
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_ob public.couranr_payment_obligations;
  v_credit public.couranr_promotional_credits;
  v_quote public.couranr_quote_versions;
  v_before text;
  v_commercial_authority text;
begin
  select * into v_req
    from public.couranr_delivery_requests
   where id = p_request_id
     and business_account_id is not distinct from p_business_account_id;

  if not found then
    raise exception 'request_not_found' using errcode='CR404';
  end if;

  perform public.couranr_assert_readiness_mutable(p_request_id);

  if v_req.request_state <> 'confirmed' then
    raise exception 'request_not_confirmed' using errcode='CR409';
  end if;

  if p_to = 'ready' then
    -- Couranr credit is an alternative commercial authority, not a synthetic
    -- Stripe authorization. Match the exact current immutable quote.
    select * into v_credit
      from public.couranr_promotional_credits
     where request_id = v_req.id
       and quote_version_id = v_req.current_quote_version_id
       and status = 'applied'
     order by created_at desc
     limit 1;

    if found then
      select * into v_quote
        from public.couranr_quote_versions
       where id = v_req.current_quote_version_id
         and request_id = v_req.id;

      if not found
         or v_quote.subtotal_cents is null
         or v_credit.standard_quote_cents is distinct from v_quote.subtotal_cents
         or v_credit.amount_paid_cents + v_credit.promotional_credit_cents
            is distinct from v_quote.subtotal_cents then
        raise exception 'promotional_credit_does_not_match_current_quote'
          using errcode='CR409';
      end if;

      v_commercial_authority := 'promotional_credit';
    else
      select * into v_ob
        from public.couranr_payment_obligations
       where request_id = v_req.id
         and payment_state <> 'cancelled'
       order by created_at desc
       limit 1;

      if not found or v_ob.payment_state <> 'authorized' then
        raise exception 'payment_not_authorized' using errcode='CR409';
      end if;

      if v_ob.quote_version_id is distinct from v_req.current_quote_version_id then
        raise exception 'authorization_does_not_match_current_quote'
          using errcode='CR409';
      end if;

      v_commercial_authority := 'payment_authorization';
    end if;
  end if;

  v_before := v_req.readiness_state;

  update public.couranr_delivery_requests
     set readiness_state = p_to,
         version = p_expected_version + 1,
         updated_at = now()
   where id = v_req.id
     and version = p_expected_version
     and readiness_state = any(p_from)
  returning * into v_req;

  if not found then
    raise exception 'version_or_state_conflict' using errcode='CR409';
  end if;

  insert into public.couranr_delivery_request_events(
    request_id,
    actor_user_id,
    actor_type,
    command,
    from_state,
    to_state,
    metadata
  ) values (
    v_req.id,
    p_actor_user_id,
    case when v_req.requester_kind='business' then 'merchant' else 'customer' end,
    p_command,
    v_before,
    p_to,
    jsonb_build_object(
      'readinessFrom', v_before,
      'readinessTo', p_to,
      'readinessMeaning', 'pickup',
      'requestState', v_req.request_state,
      'quoteVersionId', v_req.current_quote_version_id,
      'commercialAuthority', v_commercial_authority
    )
  );

  return v_req;
end
$fn$;

revoke all on function public.couranr_apply_readiness(
  uuid, uuid, integer, uuid, text, text, text[]
) from public, anon, authenticated, service_role;

grant execute on function public.couranr_apply_readiness(
  uuid, uuid, integer, uuid, text, text, text[]
) to service_role;

commit;

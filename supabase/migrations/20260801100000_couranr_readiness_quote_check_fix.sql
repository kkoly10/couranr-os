-- =====================================================================
-- Fix: marking ready invalidated the merchant's own authorization.
--
-- `couranr_apply_readiness` required, for `ready`:
--
--     v_ob.request_version is distinct from v_req.version  -> refuse
--
-- but `version` on couranr_delivery_requests is the OPTIMISTIC CONCURRENCY
-- counter, bumped by every command — including `begin_delivery_preparation`.
-- So the ordinary path
--
--     authorize -> begin preparation (version+1) -> mark ready
--
-- always failed with `authorization_does_not_match_current_quote`. The merchant
-- could never reach `ready` at all. Caught by the first behavioural probe.
--
-- What the check was FOR is "the authorization is still for the current quote".
-- The two fields that actually encode a quote generation are
-- `delivery_subtotal_cents` and `pricing_policy_version`: a requote changes
-- both, and nothing else does. `version` changes for reasons that have nothing
-- to do with the quote, so it is the wrong thing to compare.
--
-- `request_version` stays on the obligation as PROVENANCE — which generation of
-- the request it was priced against — it just no longer gates readiness.
--
-- The equivalent check in `couranr_begin_payment_capture` is left alone: it
-- compares the SERVICE PLAN's request_version, and the plan is confirmed after
-- readiness, so nothing bumps `version` between planning and capture. A
-- readiness change after planning correctly invalidates the plan.
-- =====================================================================

begin;

set local statement_timeout = '60s';
set local lock_timeout = '10s';

create or replace function public.couranr_apply_readiness(
  p_request_id          uuid,
  p_business_account_id uuid,
  p_expected_version    integer,
  p_actor_user_id       uuid,
  p_command             text,
  p_to                  text,
  p_from                text[]
)
returns public.couranr_delivery_requests
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_ob  public.couranr_payment_obligations;
  v_before text;
begin
  select * into v_req
    from public.couranr_delivery_requests
   where id = p_request_id and business_account_id = p_business_account_id;
  if not found then
    raise exception 'request_not_found' using errcode = 'CR404';
  end if;

  perform public.couranr_assert_readiness_mutable(p_request_id);

  if v_req.request_state <> 'confirmed' then
    raise exception 'request_not_confirmed' using errcode = 'CR409';
  end if;

  if p_to = 'ready' then
    select * into v_ob
      from public.couranr_payment_obligations
     where request_id = p_request_id and payment_state <> 'cancelled'
     limit 1;

    if not found or v_ob.payment_state <> 'authorized' then
      raise exception 'payment_not_authorized' using errcode = 'CR409';
    end if;

    /*
     * The authorization must still be for the CURRENT QUOTE. Amount and
     * pricing policy version are what a requote changes; the request's
     * `version` counter is not, and comparing it here made readiness
     * self-invalidating.
     */
    if v_ob.amount_cents is distinct from v_req.delivery_subtotal_cents
       or v_ob.pricing_policy_version is distinct from v_req.pricing_policy_version then
      raise exception 'authorization_does_not_match_current_quote' using errcode = 'CR409';
    end if;
  end if;

  v_before := v_req.readiness_state;

  update public.couranr_delivery_requests set
    readiness_state = p_to,
    version         = p_expected_version + 1,
    updated_at      = now()
  where id                  = p_request_id
    and business_account_id = p_business_account_id
    and version             = p_expected_version
    and readiness_state     = any (p_from)
  returning * into v_req;

  if not found then
    raise exception 'version_or_state_conflict' using errcode = 'CR409';
  end if;

  insert into public.couranr_delivery_request_events (
    request_id, actor_user_id, actor_type, command, from_state, to_state, metadata
  ) values (
    v_req.id, p_actor_user_id, 'merchant', p_command, v_before, p_to,
    jsonb_build_object(
      'readinessFrom', v_before,
      'readinessTo',   p_to,
      'requestState',  v_req.request_state
    )
  );

  return v_req;
end
$fn$;

revoke all on function public.couranr_apply_readiness(uuid, uuid, integer, uuid, text, text, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_apply_readiness(uuid, uuid, integer, uuid, text, text, text[])
  to service_role;

commit;

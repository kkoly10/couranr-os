-- =====================================================================
-- Merchant readiness — named server commands.
--
-- Four commands, one per destination. No command takes a target state, so a
-- caller names an INTENTION and the command owns where the request lands.
--
-- Owner-approved transition graph (2026-08-01):
--
--   not_confirmed -> preparing | ready | not_ready | unavailable
--   preparing     -> ready | not_ready | unavailable
--   not_ready     -> preparing | ready | unavailable
--   unavailable   -> preparing | ready
--   ready         -> preparing | not_ready | unavailable
--
-- `ready` is deliberately NOT in mark_ready's from-set: re-marking a ready
-- request is a conflict, not a no-op, so a stale tab cannot silently re-assert
-- readiness against a newer state.
--
-- READINESS FREEZES ONCE CAPTURE STARTS. Every one of these four commands
-- refuses when the obligation has reached capture_pending or captured, or when
-- a canonical delivery exists. Money has moved and a driver is being planned
-- around the answer; changing it then belongs to cancellation or incident
-- handling, which are not in this slice.
--
-- ADDITIVE. One CHECK is widened; no table, column or row is destroyed.
-- =====================================================================

begin;

set local statement_timeout = '120s';
set local lock_timeout = '10s';

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
      'decline_delivery_request',
      'record_payer_quote_approval',
      'begin_delivery_preparation',
      'mark_delivery_ready',
      'mark_delivery_not_ready',
      'mark_delivery_unavailable'
    ])
  );

/*
 * The shared guard.
 *
 * Kept as one function so all four commands enforce identical freeze rules —
 * four copies of "and payment_state not in (…)" is four chances to forget one.
 * Raises; never returns false.
 */
create function public.couranr_assert_readiness_mutable(p_request_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_state text;
begin
  select o.payment_state into v_state
    from public.couranr_payment_obligations o
   where o.request_id = p_request_id
     and o.payment_state <> 'cancelled'
   limit 1;

  if v_state in ('capture_pending', 'captured') then
    raise exception 'readiness_frozen_by_capture' using errcode = 'CR409';
  end if;

  if exists (select 1 from public.couranr_deliveries d where d.request_id = p_request_id) then
    raise exception 'readiness_frozen_by_delivery' using errcode = 'CR409';
  end if;
end
$fn$;

/*
 * One implementation, four thin wrappers.
 *
 * `p_to` and `p_from` are supplied by the WRAPPERS, never by a caller — the
 * wrappers are what carry the grant, and this helper is service_role-only and
 * never exposed to PostgREST under a name a client would call.
 */
create function public.couranr_apply_readiness(
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

  -- Readiness only means something for a request Couranr has confirmed.
  if v_req.request_state <> 'confirmed' then
    raise exception 'request_not_confirmed' using errcode = 'CR409';
  end if;

  /*
   * `ready` carries extra weight: it is the signal Operations plans a driver
   * around, so it may only be given when the money is actually held AND the
   * held amount still matches what is being asked for.
   */
  if p_to = 'ready' then
    select * into v_ob
      from public.couranr_payment_obligations
     where request_id = p_request_id and payment_state <> 'cancelled'
     limit 1;

    if not found or v_ob.payment_state <> 'authorized' then
      raise exception 'payment_not_authorized' using errcode = 'CR409';
    end if;

    -- The authorization must be for THIS quote and THIS generation of the
    -- request; a requote after authorization invalidates both.
    if v_ob.amount_cents is distinct from v_req.delivery_subtotal_cents
       or v_ob.pricing_policy_version is distinct from v_req.pricing_policy_version
       or v_ob.request_version is distinct from v_req.version then
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

create function public.couranr_begin_delivery_preparation(
  p_request_id uuid, p_business_account_id uuid,
  p_expected_version integer, p_actor_user_id uuid
) returns public.couranr_delivery_requests
language sql security invoker set search_path = '' as $fn$
  select public.couranr_apply_readiness(
    p_request_id, p_business_account_id, p_expected_version, p_actor_user_id,
    'begin_delivery_preparation', 'preparing',
    array['not_confirmed','not_ready','unavailable','ready']);
$fn$;

create function public.couranr_mark_delivery_ready(
  p_request_id uuid, p_business_account_id uuid,
  p_expected_version integer, p_actor_user_id uuid
) returns public.couranr_delivery_requests
language sql security invoker set search_path = '' as $fn$
  select public.couranr_apply_readiness(
    p_request_id, p_business_account_id, p_expected_version, p_actor_user_id,
    'mark_delivery_ready', 'ready',
    array['not_confirmed','preparing','not_ready','unavailable']);
$fn$;

create function public.couranr_mark_delivery_not_ready(
  p_request_id uuid, p_business_account_id uuid,
  p_expected_version integer, p_actor_user_id uuid
) returns public.couranr_delivery_requests
language sql security invoker set search_path = '' as $fn$
  select public.couranr_apply_readiness(
    p_request_id, p_business_account_id, p_expected_version, p_actor_user_id,
    'mark_delivery_not_ready', 'not_ready',
    array['not_confirmed','preparing','ready']);
$fn$;

create function public.couranr_mark_delivery_unavailable(
  p_request_id uuid, p_business_account_id uuid,
  p_expected_version integer, p_actor_user_id uuid
) returns public.couranr_delivery_requests
language sql security invoker set search_path = '' as $fn$
  select public.couranr_apply_readiness(
    p_request_id, p_business_account_id, p_expected_version, p_actor_user_id,
    'mark_delivery_unavailable', 'unavailable',
    array['not_confirmed','preparing','not_ready','ready']);
$fn$;

revoke all on function public.couranr_assert_readiness_mutable(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.couranr_apply_readiness(uuid, uuid, integer, uuid, text, text, text[])
  from public, anon, authenticated, service_role;
revoke all on function public.couranr_begin_delivery_preparation(uuid, uuid, integer, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.couranr_mark_delivery_ready(uuid, uuid, integer, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.couranr_mark_delivery_not_ready(uuid, uuid, integer, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.couranr_mark_delivery_unavailable(uuid, uuid, integer, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.couranr_assert_readiness_mutable(uuid) to service_role;
grant execute on function public.couranr_apply_readiness(uuid, uuid, integer, uuid, text, text, text[]) to service_role;
grant execute on function public.couranr_begin_delivery_preparation(uuid, uuid, integer, uuid) to service_role;
grant execute on function public.couranr_mark_delivery_ready(uuid, uuid, integer, uuid) to service_role;
grant execute on function public.couranr_mark_delivery_not_ready(uuid, uuid, integer, uuid) to service_role;
grant execute on function public.couranr_mark_delivery_unavailable(uuid, uuid, integer, uuid) to service_role;

commit;

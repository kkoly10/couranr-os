-- =====================================================================
-- Service plan, payment capture, canonical delivery conversion.
--
-- THE RECOVERABLE-CAPTURE SHAPE, and why it is this shape.
--
--   1. compare-and-set authorized -> capture_pending, and record the request,
--      in ONE transaction, BEFORE Stripe is called
--   2. call Stripe with an idempotency key derived from the obligation
--   3. apply the verified result: capture_pending -> captured
--
-- Writing `capture_pending` first is what makes a crash survivable. A process
-- that dies between (1) and (3) leaves a row saying "a capture was started and
-- the outcome is unknown" — not one saying "authorized", which would invite a
-- second capture of money already taken. The webhook and the reconcile command
-- both converge on the same terminal state, and Stripe's idempotency key means
-- a retried call returns the FIRST capture rather than performing a second.
--
-- A delivery is created only from `captured`, never from `capture_pending`.
-- =====================================================================

begin;

set local statement_timeout = '120s';
set local lock_timeout = '10s';

-- ---------------------------------------------------------------------
-- 1. couranr_confirm_service_plan
--
-- Compatibility is checked against the STORED shipment, not against anything
-- the caller asserts: the requirement must carry a payload capacity at least
-- as large as the weight on the request.
-- ---------------------------------------------------------------------
create function public.couranr_confirm_service_plan(
  p_request_id           uuid,
  p_expected_version     integer,
  p_actor_user_id        uuid,
  p_pickup_start         timestamptz,
  p_pickup_end           timestamptz,
  p_timezone             text,
  p_vehicle_id           uuid,
  p_vehicle_requirement  jsonb
)
returns public.couranr_service_plans
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_req  public.couranr_delivery_requests;
  v_ob   public.couranr_payment_obligations;
  v_plan public.couranr_service_plans;
  v_cap  numeric;
begin
  select * into v_req from public.couranr_delivery_requests where id = p_request_id;
  if not found then
    raise exception 'request_not_found' using errcode = 'CR404';
  end if;
  if v_req.version is distinct from p_expected_version then
    raise exception 'version_or_state_conflict' using errcode = 'CR409';
  end if;
  if v_req.request_state <> 'confirmed' then
    raise exception 'request_not_confirmed' using errcode = 'CR409';
  end if;

  select * into v_ob
    from public.couranr_payment_obligations
   where request_id = p_request_id and payment_state <> 'cancelled'
   limit 1;
  if not found or v_ob.payment_state <> 'authorized' then
    raise exception 'payment_not_authorized' using errcode = 'CR409';
  end if;

  if p_pickup_start is null or p_pickup_end is null or p_pickup_end <= p_pickup_start then
    raise exception 'invalid_pickup_window' using errcode = 'CR422';
  end if;
  if p_timezone is null or length(btrim(p_timezone)) = 0 then
    raise exception 'timezone_required' using errcode = 'CR422';
  end if;
  -- A real IANA zone, not free text: `now() at time zone <bad>` would raise
  -- at read time, long after anyone could fix it.
  begin
    perform now() at time zone p_timezone;
  exception when others then
    raise exception 'unknown_timezone' using errcode = 'CR422';
  end;

  if jsonb_typeof(p_vehicle_requirement) is distinct from 'object' then
    raise exception 'vehicle_requirement_required' using errcode = 'CR422';
  end if;
  if coalesce(p_vehicle_requirement ->> 'vehicleClass', '') not in
     ('car','van','box_truck','cargo_bike') then
    raise exception 'unknown_vehicle_class' using errcode = 'CR422';
  end if;

  v_cap := nullif(p_vehicle_requirement ->> 'maxPayloadLb', '')::numeric;
  if v_cap is null or v_cap <= 0 then
    raise exception 'vehicle_capacity_required' using errcode = 'CR422';
  end if;
  -- The compatibility check the brief asks for, against the stored shipment.
  if v_cap < coalesce(v_req.weight_lb, 0) then
    raise exception 'vehicle_incompatible_with_shipment' using errcode = 'CR422';
  end if;

  -- One live plan per request: re-planning cancels and re-creates, so a plan
  -- is never edited out from under a capture that read it.
  update public.couranr_service_plans
     set plan_state = 'cancelled', version = version + 1, updated_at = now()
   where request_id = p_request_id and plan_state <> 'cancelled';

  insert into public.couranr_service_plans (
    request_id, business_account_id, payment_obligation_id, request_version,
    scheduled_pickup_start, scheduled_pickup_end, timezone,
    vehicle_id, vehicle_requirement, plan_state, confirmed_by, confirmed_at
  ) values (
    v_req.id, v_req.business_account_id, v_ob.id, v_req.version,
    p_pickup_start, p_pickup_end, p_timezone,
    p_vehicle_id, p_vehicle_requirement, 'confirmed', p_actor_user_id, now()
  )
  returning * into v_plan;

  return v_plan;
end
$fn$;

create function public.couranr_cancel_service_plan(p_request_id uuid, p_reason text)
returns integer
language plpgsql security invoker set search_path = ''
as $fn$
declare v_n integer;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'cancel_reason_required' using errcode = 'CR422';
  end if;
  update public.couranr_service_plans
     set plan_state = 'cancelled', version = version + 1, updated_at = now()
   where request_id = p_request_id and plan_state <> 'cancelled';
  get diagnostics v_n = row_count;
  return v_n;
end
$fn$;

-- ---------------------------------------------------------------------
-- 2. couranr_begin_payment_capture  — step 1 of the recoverable workflow
-- ---------------------------------------------------------------------
create function public.couranr_begin_payment_capture(
  p_request_id    uuid,
  p_actor_user_id uuid
)
returns public.couranr_payment_obligations
language plpgsql security invoker set search_path = ''
as $fn$
declare
  v_req  public.couranr_delivery_requests;
  v_ob   public.couranr_payment_obligations;
  v_plan public.couranr_service_plans;
begin
  select * into v_req from public.couranr_delivery_requests where id = p_request_id;
  if not found then
    raise exception 'request_not_found' using errcode = 'CR404';
  end if;
  if v_req.request_state <> 'confirmed' then
    raise exception 'request_not_confirmed' using errcode = 'CR409';
  end if;
  if v_req.readiness_state <> 'ready' then
    raise exception 'merchant_not_ready' using errcode = 'CR409';
  end if;
  if exists (select 1 from public.couranr_deliveries d where d.request_id = p_request_id) then
    raise exception 'delivery_already_exists' using errcode = 'CR409';
  end if;

  select * into v_ob
    from public.couranr_payment_obligations
   where request_id = p_request_id and payment_state <> 'cancelled'
   limit 1;
  if not found then
    raise exception 'no_obligation' using errcode = 'CR409';
  end if;
  -- Already in flight or done: return it rather than starting a second.
  if v_ob.payment_state in ('capture_pending','captured') then
    return v_ob;
  end if;
  if v_ob.payment_state <> 'authorized' then
    raise exception 'payment_not_authorized' using errcode = 'CR409';
  end if;

  select * into v_plan
    from public.couranr_service_plans
   where request_id = p_request_id and plan_state = 'confirmed'
   limit 1;
  if not found then
    raise exception 'service_plan_not_confirmed' using errcode = 'CR409';
  end if;
  -- The plan must be for THIS generation of the request and THIS obligation.
  if v_plan.request_version is distinct from v_req.version
     or v_plan.payment_obligation_id is distinct from v_ob.id then
    raise exception 'service_plan_is_stale' using errcode = 'CR409';
  end if;
  if v_ob.amount_cents is distinct from v_req.delivery_subtotal_cents
     or v_ob.pricing_policy_version is distinct from v_req.pricing_policy_version then
    raise exception 'authorization_does_not_match_current_quote' using errcode = 'CR409';
  end if;

  update public.couranr_payment_obligations
     set payment_state        = 'capture_pending',
         capture_requested_at = now(),
         version              = version + 1,
         updated_at           = now()
   where id = v_ob.id and payment_state = 'authorized'
  returning * into v_ob;

  if not found then
    raise exception 'version_or_state_conflict' using errcode = 'CR409';
  end if;

  insert into public.couranr_payment_events (
    obligation_id, request_id, provider, provider_event_id, event_type,
    payment_state_before, payment_state_after, outcome, detail
  ) values (
    v_ob.id, p_request_id, 'stripe',
    'couranr:capture_requested:' || v_ob.id::text || ':v' || v_ob.version::text,
    'couranr.capture.requested',
    'authorized', 'capture_pending', 'applied',
    jsonb_build_object('amountCents', v_ob.amount_cents, 'servicePlanId', v_plan.id)
  );

  return v_ob;
end
$fn$;

-- ---------------------------------------------------------------------
-- 3. couranr_complete_payment_capture  — step 3, verified result only
-- ---------------------------------------------------------------------
create function public.couranr_complete_payment_capture(
  p_obligation_id     uuid,
  p_provider_event_id text,
  p_payment_intent_id text,
  p_intent_status     text,
  p_amount_received   integer,
  p_currency          text
)
returns public.couranr_payment_apply_result
language plpgsql security invoker set search_path = ''
as $fn$
declare
  v_ob  public.couranr_payment_obligations;
  v_out public.couranr_payment_apply_result;
  v_outcome text;
  v_reason  text;
begin
  select * into v_ob from public.couranr_payment_obligations where id = p_obligation_id;
  if not found then
    raise exception 'obligation_not_found' using errcode = 'CR404';
  end if;

  if v_ob.provider_payment_intent_id is distinct from p_payment_intent_id then
    v_outcome := 'rejected'; v_reason := 'payment_intent_mismatch';
  elsif p_amount_received is distinct from v_ob.amount_cents then
    v_outcome := 'rejected'; v_reason := 'amount_mismatch';
  elsif lower(coalesce(p_currency,'')) is distinct from v_ob.currency then
    v_outcome := 'rejected'; v_reason := 'currency_mismatch';
  elsif p_intent_status <> 'succeeded' then
    -- Under manual capture `succeeded` means CAPTURED. Anything else is not.
    v_outcome := 'rejected'; v_reason := 'intent_not_succeeded';
  elsif v_ob.payment_state = 'captured' then
    v_outcome := 'ignored'; v_reason := 'already_captured';
  elsif v_ob.payment_state <> 'capture_pending' then
    v_outcome := 'rejected'; v_reason := 'capture_was_never_started';
  else
    v_outcome := 'applied';
  end if;

  begin
    insert into public.couranr_payment_events (
      obligation_id, request_id, provider, provider_event_id, event_type,
      payment_state_before, payment_state_after, outcome, detail
    ) values (
      v_ob.id, v_ob.request_id, 'stripe', p_provider_event_id, 'couranr.capture.result',
      v_ob.payment_state,
      case when v_outcome = 'applied' then 'captured' else v_ob.payment_state end,
      v_outcome,
      jsonb_build_object(
        'paymentIntentId', p_payment_intent_id, 'intentStatus', p_intent_status,
        'amountReceived', p_amount_received, 'currency', p_currency, 'reason', v_reason)
    );
  exception when unique_violation then
    v_out := row('duplicate', v_ob.id, v_ob.request_id, v_ob.payment_state, null, null)
              ::public.couranr_payment_apply_result;
    return v_out;
  end;

  if v_outcome <> 'applied' then
    v_out := row(v_outcome, v_ob.id, v_ob.request_id, v_ob.payment_state, null, v_reason)
              ::public.couranr_payment_apply_result;
    return v_out;
  end if;

  update public.couranr_payment_obligations
     set payment_state         = 'captured',
         captured_at           = now(),
         captured_amount_cents = v_ob.amount_cents,
         version               = version + 1,
         updated_at            = now()
   where id = v_ob.id and payment_state = 'capture_pending'
  returning * into v_ob;

  if not found then
    raise exception 'version_or_state_conflict' using errcode = 'CR409';
  end if;

  v_out := row('applied', v_ob.id, v_ob.request_id, v_ob.payment_state, null, null)
            ::public.couranr_payment_apply_result;
  return v_out;
end
$fn$;

/*
 * Releases a capture that Stripe REFUSED, back to authorized so it can be
 * retried. Only ever called with a verified provider failure — a network
 * timeout is NOT a refusal, and leaves the obligation in capture_pending for
 * the webhook or a reconcile to settle.
 */
create function public.couranr_fail_payment_capture(
  p_obligation_id     uuid,
  p_provider_event_id text,
  p_reason            text
)
returns public.couranr_payment_obligations
language plpgsql security invoker set search_path = ''
as $fn$
declare v_ob public.couranr_payment_obligations;
begin
  select * into v_ob from public.couranr_payment_obligations where id = p_obligation_id;
  if not found then
    raise exception 'obligation_not_found' using errcode = 'CR404';
  end if;
  if v_ob.payment_state <> 'capture_pending' then
    return v_ob;
  end if;

  begin
    insert into public.couranr_payment_events (
      obligation_id, request_id, provider, provider_event_id, event_type,
      payment_state_before, payment_state_after, outcome, detail
    ) values (
      v_ob.id, v_ob.request_id, 'stripe', p_provider_event_id, 'couranr.capture.failed',
      'capture_pending', 'authorized', 'applied',
      jsonb_build_object('reason', p_reason));
  exception when unique_violation then
    return v_ob;
  end;

  update public.couranr_payment_obligations
     set payment_state = 'authorized', capture_requested_at = null,
         version = version + 1, updated_at = now()
   where id = v_ob.id and payment_state = 'capture_pending'
  returning * into v_ob;

  return v_ob;
end
$fn$;

-- ---------------------------------------------------------------------
-- 4. couranr_create_delivery_from_capture  — idempotent conversion
--
-- Only from `captured`. The delivery row and its first audit event are one
-- transaction; `couranr_dlv_request_uniq` makes a second attempt return the
-- existing delivery rather than create another.
-- ---------------------------------------------------------------------
create function public.couranr_create_delivery_from_capture(p_request_id uuid)
returns public.couranr_deliveries
language plpgsql security invoker set search_path = ''
as $fn$
declare
  v_req  public.couranr_delivery_requests;
  v_ob   public.couranr_payment_obligations;
  v_plan public.couranr_service_plans;
  v_d    public.couranr_deliveries;
begin
  -- Idempotent: already converted, hand back the same delivery.
  select * into v_d from public.couranr_deliveries where request_id = p_request_id;
  if found then
    return v_d;
  end if;

  select * into v_req from public.couranr_delivery_requests where id = p_request_id;
  if not found then
    raise exception 'request_not_found' using errcode = 'CR404';
  end if;

  select * into v_ob
    from public.couranr_payment_obligations
   where request_id = p_request_id and payment_state <> 'cancelled'
   limit 1;
  if not found or v_ob.payment_state <> 'captured' then
    raise exception 'payment_not_captured' using errcode = 'CR409';
  end if;

  select * into v_plan
    from public.couranr_service_plans
   where request_id = p_request_id and plan_state = 'confirmed'
   limit 1;
  if not found then
    raise exception 'service_plan_not_confirmed' using errcode = 'CR409';
  end if;

  insert into public.couranr_deliveries (
    request_id, business_account_id, payment_obligation_id, service_plan_id,
    request_version, pricing_policy_version, captured_amount_cents, currency,
    pickup_address, dropoff_address, recipient, shipment,
    service_level, signature_required, proof_method,
    scheduled_pickup_start, scheduled_pickup_end, timezone,
    vehicle_id, vehicle_requirement, fulfillment_state
  ) values (
    v_req.id, v_req.business_account_id, v_ob.id, v_plan.id,
    v_ob.request_version, v_ob.pricing_policy_version,
    coalesce(v_ob.captured_amount_cents, v_ob.amount_cents), v_ob.currency,
    coalesce(v_req.pickup_address, '{}'::jsonb),
    coalesce(v_req.dropoff_address, '{}'::jsonb),
    jsonb_build_object('name', v_req.recipient_name, 'phone', v_req.recipient_phone,
                       'email', v_req.recipient_email),
    jsonb_build_object('loadedMiles', v_req.loaded_miles, 'weightLb', v_req.weight_lb,
                       'additionalStops', v_req.additional_stops),
    v_req.service_level, v_req.signature_required, v_req.proof_method,
    v_plan.scheduled_pickup_start, v_plan.scheduled_pickup_end, v_plan.timezone,
    v_plan.vehicle_id, v_plan.vehicle_requirement, 'scheduled'
  )
  returning * into v_d;

  insert into public.couranr_delivery_events (
    delivery_id, actor_user_id, actor_type, command, from_state, to_state, metadata
  ) values (
    v_d.id, null, 'system', 'create_delivery_from_capture', null, 'scheduled',
    jsonb_build_object(
      'requestId', v_req.id, 'paymentObligationId', v_ob.id,
      'servicePlanId', v_plan.id,
      'capturedAmountCents', v_d.captured_amount_cents,
      'driverAssigned', false)
  );

  return v_d;
end
$fn$;

revoke all on function public.couranr_confirm_service_plan(uuid, integer, uuid, timestamptz, timestamptz, text, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.couranr_cancel_service_plan(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.couranr_begin_payment_capture(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.couranr_complete_payment_capture(uuid, text, text, text, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.couranr_fail_payment_capture(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.couranr_create_delivery_from_capture(uuid) from public, anon, authenticated, service_role;

grant execute on function public.couranr_confirm_service_plan(uuid, integer, uuid, timestamptz, timestamptz, text, uuid, jsonb) to service_role;
grant execute on function public.couranr_cancel_service_plan(uuid, text) to service_role;
grant execute on function public.couranr_begin_payment_capture(uuid, uuid) to service_role;
grant execute on function public.couranr_complete_payment_capture(uuid, text, text, text, integer, text) to service_role;
grant execute on function public.couranr_fail_payment_capture(uuid, text, text) to service_role;
grant execute on function public.couranr_create_delivery_from_capture(uuid) to service_role;

commit;

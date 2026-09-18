-- P10-015 backstop: a historical request may not MATERIALIZE a new delivery
-- under a proof method Couranr has withdrawn.
--
-- Withdrawing leave_at_door from new INTAKE did not close the whole gap. A
-- request stored before that withdrawal keeps its frozen proof method, and both
-- settlement paths copy it onto a brand new delivery. Production carries exactly
-- such a row: request 4672dbfe is confirmed and ready, carries leave_at_door and
-- has no delivery, so a later applied credit or captured obligation could still
-- mint a delivery PRF-001 says needs an authorization nothing records.
--
-- THE APPLICATION ALREADY REFUSES THIS. refuseUnavailableProofMethodConversion
-- guards all three entry points — capture, operations credit, and the automatic
-- worker. This is the database backstop, because the application layer is code
-- and code can be bypassed.
--
-- WHAT IT MUST NOT DO, and the ordering is how it avoids doing it: the
-- existing-delivery return at the top of each function runs FIRST and
-- unconditionally, so the delivery already at pickup under leave_at_door is
-- grandfathered and every retry stays idempotent. Only a request with NO
-- delivery is refused. No request, quote or delivery row is rewritten, and
-- couranr_complete_leave_at_door_delivery is deliberately untouched so the
-- in-flight delivery still completes.
--
-- FORWARD-ONLY. 20260901051609 and 20260904154559 are applied in production and
-- are not edited; both functions are replaced by name, bodies reproduced
-- verbatim with one added refusal each.

begin;

create or replace function public.couranr_create_delivery_from_capture(p_request_id uuid)
returns public.couranr_deliveries
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_ob public.couranr_payment_obligations;
  v_plan public.couranr_service_plans;
  v_quote public.couranr_quote_versions;
  v_d public.couranr_deliveries;
begin
  select * into v_d from public.couranr_deliveries where request_id=p_request_id;
  if found then return v_d; end if;
  select * into v_req from public.couranr_delivery_requests where id=p_request_id;
  if not found then raise exception 'request_not_found' using errcode='CR404'; end if;

  /* P10-015 BACKSTOP. A request stored before leave_at_door was withdrawn keeps
     its frozen proof method, and this function copies that method straight onto
     a brand new delivery — so a historical row could still materialize a
     delivery whose proof method PRF-001 says needs a customer authorization
     that nothing records.

     PLACED EXACTLY HERE. The existing-delivery return at the top runs FIRST and
     unconditionally, so a delivery already created under leave_at_door is
     grandfathered and every retry stays idempotent; only a request with NO
     delivery reaches this line. It also sits AFTER the request_not_found check
     rather than before it, because an intervening IF between a SELECT INTO and
     the `if not found` that reads its result is the kind of PL/pgSQL subtlety
     that only shows up at execution time.

     Nothing is rewritten: not the request, not its quote, not the existing
     delivery, and couranr_complete_leave_at_door_delivery is untouched so the
     delivery already at pickup still completes. */
  if v_req.proof_method is not null
     and v_req.proof_method not in ('photo_or_pin','signature') then
    raise exception 'proof_method_currently_unavailable' using errcode='CR409';
  end if;
  select * into v_ob from public.couranr_payment_obligations
   where request_id=v_req.id and payment_state<>'cancelled' limit 1;
  if not found or v_ob.payment_state<>'captured' then
    raise exception 'payment_not_captured' using errcode='CR409';
  end if;
  select * into v_plan from public.couranr_service_plans
   where request_id=v_req.id and plan_state='confirmed' limit 1;
  if not found then raise exception 'service_plan_not_confirmed' using errcode='CR409'; end if;
  if v_req.current_quote_version_id is null
     or v_ob.quote_version_id is distinct from v_req.current_quote_version_id
     or v_plan.quote_version_id is distinct from v_req.current_quote_version_id
     or v_plan.payment_obligation_id is distinct from v_ob.id then
    raise exception 'commercial_quote_identity_mismatch' using errcode='CR409';
  end if;
  select * into v_quote from public.couranr_quote_versions
   where id=v_ob.quote_version_id and request_id=v_req.id;
  if not found then raise exception 'quote_not_found' using errcode='CR409'; end if;
  if jsonb_typeof(v_quote.pickup_address_snapshot) is distinct from 'object'
     or jsonb_typeof(v_quote.dropoff_address_snapshot) is distinct from 'object'
     or jsonb_typeof(v_quote.recipient_snapshot) is distinct from 'object'
     or jsonb_typeof(v_quote.shipment_snapshot) is distinct from 'object'
     or jsonb_typeof(v_quote.service_configuration_snapshot) is distinct from 'object' then
    raise exception 'commercial_quote_snapshot_incomplete' using errcode='CR409';
  end if;

  insert into public.couranr_deliveries(
    request_id,business_account_id,payment_obligation_id,service_plan_id,
    request_version,quote_version_id,pricing_policy_version,
    captured_amount_cents,currency,pickup_address,dropoff_address,recipient,shipment,
    service_level,signature_required,proof_method,
    scheduled_pickup_start,scheduled_pickup_end,timezone,vehicle_id,
    vehicle_requirement,fulfillment_state
  ) values (
    v_req.id,v_req.business_account_id,v_ob.id,v_plan.id,
    v_ob.request_version,v_quote.id,v_quote.pricing_policy_version,
    coalesce(v_ob.captured_amount_cents,v_ob.amount_cents),v_ob.currency,
    v_quote.pickup_address_snapshot,v_quote.dropoff_address_snapshot,
    v_quote.recipient_snapshot,v_quote.shipment_snapshot,
    v_quote.service_configuration_snapshot->>'serviceLevel',
    coalesce((v_quote.service_configuration_snapshot->>'signatureRequired')::boolean,false),
    v_quote.service_configuration_snapshot->>'proofMethod',
    v_plan.scheduled_pickup_start,v_plan.scheduled_pickup_end,v_plan.timezone,
    v_plan.vehicle_id,v_plan.vehicle_requirement,'scheduled'
  ) returning * into v_d;
  insert into public.couranr_delivery_events(
    delivery_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_d.id,null,'system','create_delivery_from_capture',null,'scheduled',
    jsonb_build_object('requestId',v_req.id,'paymentObligationId',v_ob.id,
      'servicePlanId',v_plan.id,'quoteVersionId',v_quote.id,
      'capturedAmountCents',v_d.captured_amount_cents,'driverAssigned',false)
  );
  return v_d;
exception when unique_violation then
  select * into v_d from public.couranr_deliveries where request_id=p_request_id;
  if found then return v_d; end if;
  raise;
end
$fn$;
create or replace function public.couranr_create_delivery_from_promotional_credit(
  p_request_id uuid
)
returns public.couranr_deliveries
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_plan public.couranr_service_plans;
  v_quote public.couranr_quote_versions;
  v_credit public.couranr_promotional_credits;
  v_d public.couranr_deliveries;
begin
  select * into v_d from public.couranr_deliveries where request_id=p_request_id;
  if found then return v_d; end if;

  select * into v_req from public.couranr_delivery_requests where id=p_request_id for update;
  if not found then raise exception 'request_not_found' using errcode='CR404'; end if;

  /* P10-015 BACKSTOP. A request stored before leave_at_door was withdrawn keeps
     its frozen proof method, and this function copies that method straight onto
     a brand new delivery — so a historical row could still materialize a
     delivery whose proof method PRF-001 says needs a customer authorization
     that nothing records.

     PLACED EXACTLY HERE. The existing-delivery return at the top runs FIRST and
     unconditionally, so a delivery already created under leave_at_door is
     grandfathered and every retry stays idempotent; only a request with NO
     delivery reaches this line. It also sits AFTER the request_not_found check
     rather than before it, because an intervening IF between a SELECT INTO and
     the `if not found` that reads its result is the kind of PL/pgSQL subtlety
     that only shows up at execution time.

     Nothing is rewritten: not the request, not its quote, not the existing
     delivery, and couranr_complete_leave_at_door_delivery is untouched so the
     delivery already at pickup still completes. */
  if v_req.proof_method is not null
     and v_req.proof_method not in ('photo_or_pin','signature') then
    raise exception 'proof_method_currently_unavailable' using errcode='CR409';
  end if;
  if v_req.request_state<>'confirmed' then
    raise exception 'request_not_confirmed' using errcode='CR409';
  end if;
  if v_req.readiness_state<>'ready' then
    raise exception 'merchant_not_ready' using errcode='CR409';
  end if;

  select * into v_plan from public.couranr_service_plans
   where request_id=v_req.id and plan_state='confirmed'
   order by created_at desc limit 1;
  if not found or v_plan.promotional_credit_id is null then
    raise exception 'promotional_credit_plan_not_confirmed' using errcode='CR409';
  end if;

  select * into v_credit from public.couranr_promotional_credits
   where id=v_plan.promotional_credit_id and request_id=v_req.id and status='applied';
  if not found then raise exception 'promotional_credit_not_applied' using errcode='CR409'; end if;

  select * into v_quote from public.couranr_quote_versions
   where id=v_credit.quote_version_id and request_id=v_req.id;
  if not found then raise exception 'quote_not_found' using errcode='CR409'; end if;
  if v_req.current_quote_version_id is distinct from v_quote.id
     or v_plan.quote_version_id is distinct from v_quote.id
     or v_credit.standard_quote_cents is distinct from v_quote.subtotal_cents then
    raise exception 'commercial_quote_identity_mismatch' using errcode='CR409';
  end if;

  insert into public.couranr_deliveries(
    request_id,business_account_id,payment_obligation_id,promotional_credit_id,
    service_plan_id,request_version,quote_version_id,pricing_policy_version,
    captured_amount_cents,standard_quote_cents,amount_paid_cents,promotional_credit_cents,
    currency,pickup_address,dropoff_address,recipient,shipment,
    service_level,signature_required,proof_method,
    scheduled_pickup_start,scheduled_pickup_end,timezone,vehicle_id,
    vehicle_requirement,fulfillment_state
  ) values (
    v_req.id,v_req.business_account_id,null,v_credit.id,v_plan.id,
    v_req.version,v_quote.id,v_quote.pricing_policy_version,
    0,v_credit.standard_quote_cents,v_credit.amount_paid_cents,
    v_credit.promotional_credit_cents,v_credit.currency,
    v_quote.pickup_address_snapshot,v_quote.dropoff_address_snapshot,
    v_quote.recipient_snapshot,v_quote.shipment_snapshot,
    v_quote.service_configuration_snapshot->>'serviceLevel',
    coalesce((v_quote.service_configuration_snapshot->>'signatureRequired')::boolean,false),
    v_quote.service_configuration_snapshot->>'proofMethod',
    v_plan.scheduled_pickup_start,v_plan.scheduled_pickup_end,v_plan.timezone,
    v_plan.vehicle_id,v_plan.vehicle_requirement,'scheduled'
  ) returning * into v_d;

  insert into public.couranr_delivery_events(
    delivery_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_d.id,null,'system','create_delivery_from_promotional_credit',null,'scheduled',
    jsonb_build_object(
      'requestId',v_req.id,
      'paymentObligationId',null,
      'promotionalCreditId',v_credit.id,
      'servicePlanId',v_plan.id,
      'quoteVersionId',v_quote.id,
      'standardQuoteCents',v_credit.standard_quote_cents,
      'amountPaidCents',v_credit.amount_paid_cents,
      'promotionalCreditCents',v_credit.promotional_credit_cents,
      'driverAssigned',false
    )
  );
  return v_d;
exception when unique_violation then
  select * into v_d from public.couranr_deliveries where request_id=p_request_id;
  if found then return v_d; end if;
  raise;
end
$fn$;
commit;

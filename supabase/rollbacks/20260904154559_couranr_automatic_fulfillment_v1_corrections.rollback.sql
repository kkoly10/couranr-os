-- Roll back 20260904154559_couranr_automatic_fulfillment_v1_corrections.
-- The correction changes promotional-credit settlement identity. Once a credit
-- exists, restoring the known-bad dual-history requirement would corrupt the
-- commercial model, so fail loudly and roll forward.
begin;
do $$
begin
  if exists(select 1 from public.couranr_promotional_credits)
     or exists(select 1 from public.couranr_service_plans where plan_source='automatic')
     or exists(select 1 from public.couranr_automation_exceptions) then
    raise exception 'refusing to restore pre-correction automatic settlement semantics';
  end if;
end $$;

drop trigger if exists couranr_resolve_manual_plan_exception on public.couranr_service_plans;
drop function if exists private.couranr_resolve_manual_plan_exception() restrict;
drop trigger if exists couranr_resolve_manual_dispatch_exception on public.couranr_delivery_assignments;
drop function if exists private.couranr_resolve_manual_dispatch_exception() restrict;
drop function if exists public.couranr_operations_queue_candidates(integer) restrict;

alter table public.couranr_service_plans
  drop constraint if exists couranr_sp_settlement_identity_chk;
alter table public.couranr_deliveries
  drop constraint if exists couranr_dlv_settlement_identity_chk;
alter table public.couranr_service_plans
  alter column payment_obligation_id set not null;
alter table public.couranr_deliveries
  alter column payment_obligation_id set not null;

create or replace function public.couranr_create_delivery_from_promotional_credit(
  p_request_id uuid
)
returns public.couranr_deliveries
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_ob public.couranr_payment_obligations;
  v_plan public.couranr_service_plans;
  v_quote public.couranr_quote_versions;
  v_credit public.couranr_promotional_credits;
  v_d public.couranr_deliveries;
begin
  select * into v_d from public.couranr_deliveries where request_id=p_request_id;
  if found then return v_d; end if;

  select * into v_req from public.couranr_delivery_requests where id=p_request_id for update;
  if not found then raise exception 'request_not_found' using errcode='CR404'; end if;
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

  select * into v_ob from public.couranr_payment_obligations
   where request_id=v_req.id and payment_state<>'cancelled'
   order by created_at desc limit 1;
  if not found then
    raise exception 'payment_obligation_history_missing' using errcode='CR409';
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
    v_req.id,v_req.business_account_id,v_ob.id,v_credit.id,v_plan.id,
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
      'paymentObligationId',v_ob.id,
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
revoke all on function public.couranr_create_delivery_from_promotional_credit(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_create_delivery_from_promotional_credit(uuid)
  to service_role;

create or replace function public.couranr_try_auto_plan(
  p_request_id uuid,
  p_planner_version text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_quote public.couranr_quote_versions;
  v_ob public.couranr_payment_obligations;
  v_credit public.couranr_promotional_credits;
  v_existing public.couranr_service_plans;
  v_plan public.couranr_service_plans;
  v_capacity public.couranr_capacity_policies;
  v_lane_reason text;
  v_market text := 'dc_va_launch_corridor';
  v_zone text := 'America/New_York';
  v_local_now timestamp;
  v_date date;
  v_candidate timestamptz;
  v_candidate_local timestamp;
  v_pickup_end timestamptz;
  v_dispatch_start timestamptz;
  v_dispatch_deadline timestamptz;
  v_expected_end timestamptz;
  v_conflicts integer;
  v_attempt integer := 0;
  v_scheduled boolean;
  v_weight numeric;
begin
  if nullif(btrim(p_planner_version),'') is null then
    raise exception 'planner_version_required' using errcode='CR422';
  end if;

  select * into v_req from public.couranr_delivery_requests
   where id=p_request_id for update;
  if not found then raise exception 'request_not_found' using errcode='CR404'; end if;

  select * into v_existing from public.couranr_service_plans
   where request_id=v_req.id and plan_state<>'cancelled'
   order by created_at desc limit 1;
  if found then
    return jsonb_build_object(
      'outcome','already_planned',
      'planId',v_existing.id,
      'planSource',v_existing.plan_source,
      'dispatchNotBefore',v_existing.dispatch_not_before,
      'dispatchDeadline',v_existing.dispatch_deadline
    );
  end if;

  if v_req.request_state<>'confirmed' then
    return jsonb_build_object('outcome','waiting','reason','request_not_confirmed');
  end if;
  if v_req.readiness_state<>'ready' then
    return jsonb_build_object('outcome','waiting','reason','pickup_not_ready');
  end if;

  v_lane_reason:=private.couranr_automatic_lane_reason(v_req.id);
  if v_lane_reason is not null then
    perform public.couranr_open_automation_exception(
      v_req.id,'planning','manual_planning_required',
      jsonb_build_object('laneReason',v_lane_reason,'plannerVersion',p_planner_version)
    );
    return jsonb_build_object('outcome','exception','reason','manual_planning_required','laneReason',v_lane_reason);
  end if;

  select * into v_quote from public.couranr_quote_versions
   where id=v_req.current_quote_version_id and request_id=v_req.id;
  if not found then
    return jsonb_build_object('outcome','waiting','reason','current_quote_missing');
  end if;

  select * into v_credit from public.couranr_promotional_credits
   where request_id=v_req.id
     and quote_version_id=v_quote.id
     and status='applied'
   limit 1;

  select * into v_ob from public.couranr_payment_obligations
   where request_id=v_req.id and payment_state<>'cancelled'
   order by created_at desc limit 1;

  if not found then
    return jsonb_build_object('outcome','waiting','reason','commercial_settlement_missing');
  end if;

  if v_credit.id is null then
    if v_ob.payment_state<>'authorized' then
      return jsonb_build_object('outcome','waiting','reason','payment_not_authorized');
    end if;
    if v_ob.quote_version_id is distinct from v_quote.id then
      return jsonb_build_object('outcome','waiting','reason','authorization_quote_mismatch');
    end if;
  end if;

  -- Until deferred/card-on-file authorization is implemented, keep a safety
  -- margin below a typical manual-capture authorization horizon.
  if v_credit.id is null
     and v_req.timing_intent='scheduled'
     and v_req.requested_departure_at is not null
     and v_req.requested_departure_at > p_now + interval '5 days' then
    perform public.couranr_open_automation_exception(
      v_req.id,'commercial','authorization_horizon_too_long',
      jsonb_build_object(
        'requestedDepartureAt',v_req.requested_departure_at,
        'maxAutomaticAuthorizationHorizonHours',120,
        'plannerVersion',p_planner_version
      )
    );
    return jsonb_build_object('outcome','exception','reason','authorization_horizon_too_long');
  end if;

  select * into v_capacity from public.couranr_capacity_policies
   where market_key=v_market and active=true for update;
  if not found then
    perform public.couranr_open_automation_exception(
      v_req.id,'planning','capacity_policy_missing',
      jsonb_build_object('marketKey',v_market,'plannerVersion',p_planner_version)
    );
    return jsonb_build_object('outcome','exception','reason','capacity_policy_missing');
  end if;

  perform pg_advisory_xact_lock(hashtext('couranr-capacity:'||v_market));

  v_scheduled := v_req.timing_intent='scheduled';
  if v_scheduled then
    if v_req.requested_departure_at is null then
      perform public.couranr_open_automation_exception(
        v_req.id,'planning','scheduled_time_unresolved',
        jsonb_build_object('plannerVersion',p_planner_version)
      );
      return jsonb_build_object('outcome','exception','reason','scheduled_time_unresolved');
    end if;
    v_candidate := v_req.requested_departure_at;
    if v_candidate < p_now + interval '15 minutes' then
      perform public.couranr_open_automation_exception(
        v_req.id,'planning','scheduled_time_too_close',
        jsonb_build_object('requestedDepartureAt',v_candidate,'plannerVersion',p_planner_version)
      );
      return jsonb_build_object('outcome','exception','reason','scheduled_time_too_close');
    end if;
  else
    v_local_now := p_now at time zone v_zone;
    v_date := v_local_now::date;

    if extract(isodow from v_date) between 1 and 5
       and v_local_now::time < time '16:00'
       and not exists(
         select 1 from public.couranr_operating_closures
          where market_key=v_market and local_date=v_date and active=true
       ) then
      v_candidate_local := greatest(
        v_local_now + interval '30 minutes',
        v_date + time '06:00'
      );
    else
      loop
        v_date := v_date + 1;
        exit when extract(isodow from v_date) between 1 and 5
          and not exists(
            select 1 from public.couranr_operating_closures
             where market_key=v_market and local_date=v_date and active=true
          );
      end loop;
      v_candidate_local := v_date + time '06:00';
    end if;

    v_candidate := to_timestamp(
      ceil(extract(epoch from (v_candidate_local at time zone v_zone))/900.0)*900
    );
  end if;

  -- Search later slots only for ASAP. A scheduled request is a promise to a
  -- requested time; capacity pressure must not silently move it.
  loop
    v_attempt := v_attempt + 1;
    if v_attempt > 96 then
      perform public.couranr_open_automation_exception(
        v_req.id,'planning','capacity_unavailable',
        jsonb_build_object('marketKey',v_market,'plannerVersion',p_planner_version,'attempts',v_attempt-1)
      );
      return jsonb_build_object('outcome','exception','reason','capacity_unavailable');
    end if;

    v_candidate_local := v_candidate at time zone v_zone;
    v_date := v_candidate_local::date;

    if extract(isodow from v_date) not between 1 and 5
       or exists(
         select 1 from public.couranr_operating_closures
          where market_key=v_market and local_date=v_date and active=true
       )
       or v_candidate_local::time < time '06:00'
       or v_candidate_local::time > time '17:30' then
      if v_scheduled then
        perform public.couranr_open_automation_exception(
          v_req.id,'planning','requested_window_outside_operating_hours',
          jsonb_build_object('requestedDepartureAt',v_candidate,'plannerVersion',p_planner_version)
        );
        return jsonb_build_object('outcome','exception','reason','requested_window_outside_operating_hours');
      end if;

      loop
        v_date := v_date + 1;
        exit when extract(isodow from v_date) between 1 and 5
          and not exists(
            select 1 from public.couranr_operating_closures
             where market_key=v_market and local_date=v_date and active=true
          );
      end loop;
      v_candidate := (v_date + time '06:00') at time zone v_zone;
      continue;
    end if;

    v_pickup_end := v_candidate + interval '30 minutes';
    v_dispatch_start := greatest(p_now,v_candidate - interval '45 minutes');
    v_dispatch_deadline := v_candidate;
    v_expected_end := v_candidate
      + interval '10 minutes'
      + make_interval(secs=>v_quote.route_duration_seconds)
      + interval '10 minutes';

    select count(*) into v_conflicts
      from public.couranr_capacity_reservations c
     where c.market_key=v_market
       and c.reservation_state='reserved'
       and tstzrange(c.starts_at,c.ends_at,'[)') &&
           tstzrange(v_dispatch_start,v_expected_end,'[)');

    if v_conflicts < v_capacity.max_concurrent_deliveries then
      exit;
    end if;

    if v_scheduled then
      perform public.couranr_open_automation_exception(
        v_req.id,'planning','capacity_unavailable',
        jsonb_build_object(
          'marketKey',v_market,
          'requestedDepartureAt',v_candidate,
          'capacity',v_capacity.max_concurrent_deliveries,
          'overlapCount',v_conflicts,
          'plannerVersion',p_planner_version
        )
      );
      return jsonb_build_object('outcome','exception','reason','capacity_unavailable');
    end if;

    v_candidate := v_candidate + interval '15 minutes';
  end loop;

  v_weight := case
    when v_req.weight_lb is not null then v_req.weight_lb
    when v_req.weight_band='over_25_to_50_lb' then 50
    else 25
  end;

  insert into public.couranr_service_plans(
    request_id,business_account_id,payment_obligation_id,promotional_credit_id,
    request_version,quote_version_id,
    scheduled_pickup_start,scheduled_pickup_end,timezone,
    vehicle_id,vehicle_requirement,plan_state,confirmed_by,confirmed_at,
    plan_source,planner_version,market_key,
    dispatch_not_before,dispatch_deadline,expected_service_end
  ) values (
    v_req.id,v_req.business_account_id,v_ob.id,v_credit.id,
    v_req.version,v_quote.id,
    v_candidate,v_pickup_end,v_zone,
    null,jsonb_build_object(
      'vehicleClass','car',
      'maxPayloadLb',50,
      'shipmentWeightBasisLb',v_weight,
      'plannerVersion',p_planner_version
    ),
    'confirmed',null,now(),
    'automatic',p_planner_version,v_market,
    v_dispatch_start,v_dispatch_deadline,v_expected_end
  )
  returning * into v_plan;

  insert into public.couranr_capacity_reservations(
    request_id,service_plan_id,market_key,starts_at,ends_at
  ) values (
    v_req.id,v_plan.id,v_market,v_dispatch_start,v_expected_end
  );

  insert into public.couranr_delivery_request_events(
    request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_req.id,null,'system','auto_plan_delivery_request',
    v_req.request_state,v_req.request_state,
    jsonb_build_object(
      'servicePlanId',v_plan.id,
      'quoteVersionId',v_quote.id,
      'plannerVersion',p_planner_version,
      'planSource','automatic',
      'timingIntent',v_req.timing_intent,
      'scheduledPickupStart',v_candidate,
      'scheduledPickupEnd',v_pickup_end,
      'dispatchNotBefore',v_dispatch_start,
      'dispatchDeadline',v_dispatch_deadline,
      'expectedServiceEnd',v_expected_end,
      'marketKey',v_market,
      'capacityLimit',v_capacity.max_concurrent_deliveries
    )
  );

  perform public.couranr_resolve_automation_exception(v_req.id,'planning');
  perform public.couranr_resolve_automation_exception(v_req.id,'commercial');

  return jsonb_build_object(
    'outcome','planned',
    'planId',v_plan.id,
    'planSource','automatic',
    'scheduledPickupStart',v_candidate,
    'scheduledPickupEnd',v_pickup_end,
    'dispatchNotBefore',v_dispatch_start,
    'dispatchDeadline',v_dispatch_deadline,
    'expectedServiceEnd',v_expected_end
  );
exception when unique_violation then
  select * into v_existing from public.couranr_service_plans
   where request_id=p_request_id and plan_state<>'cancelled'
   order by created_at desc limit 1;
  if found then
    return jsonb_build_object('outcome','already_planned','planId',v_existing.id,'planSource',v_existing.plan_source);
  end if;
  raise;
end
$fn$;
revoke all on function public.couranr_try_auto_plan(uuid,text,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_try_auto_plan(uuid,text,timestamptz)
  to service_role;
commit;

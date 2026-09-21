-- Repair two production blockers exposed by the Same Day canary:
-- 1) Operations reservations were rejected by the older automatic-only guard.
-- 2) pickupManifest is a server-frozen custody fact added after quote validation,
--    so exact shipment-vs-quote comparison made every later delivery UPDATE fail.
--
-- Keep the quote-priced shipment fields immutable while treating pickupManifest
-- as a separately verified custody field owned by the request.

begin;
set local statement_timeout = '60s';
set local lock_timeout = '10s';

alter table public.couranr_delivery_assignments
  drop constraint if exists couranr_asg_source_actor_chk;
alter table public.couranr_delivery_assignments
  add constraint couranr_asg_source_actor_chk check (
    (assignment_source='operations' and assigned_by is not null)
    or
    (assignment_source='automatic' and assigned_by is null and dispatch_reservation_id is not null)
  );

create or replace function private.couranr_assignment_reservation_guard()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  v_request_id uuid;
  v_service_plan_id uuid;
  v_res public.couranr_dispatch_reservations;
begin
  select request_id,service_plan_id
    into v_request_id,v_service_plan_id
    from public.couranr_deliveries
   where id=new.delivery_id;

  if v_request_id is null then
    raise exception 'delivery_not_found' using errcode='CR404';
  end if;

  if new.assignment_source='operations' then
    if new.dispatch_reservation_id is null then
      -- Legacy/manual recovery assignment remains valid, but it must not steal
      -- work while ANY worker reservation is active for this request.
      if exists(
        select 1
          from public.couranr_dispatch_reservations
         where request_id=v_request_id
           and reservation_state='active'
           and expires_at>now()
      ) then
        raise exception 'delivery_reserved_for_automatic_dispatch' using errcode='CR409';
      end if;
    else
      -- The governed Operations path is allowed to commit ITS OWN reservation.
      select * into v_res
        from public.couranr_dispatch_reservations
       where id=new.dispatch_reservation_id
         and request_id=v_request_id
         and service_plan_id=v_service_plan_id
         and driver_id=new.driver_id
         and vehicle_id=new.vehicle_id
         and reservation_state='active'
         and expires_at>now();
      if not found then
        raise exception 'operations_dispatch_reservation_invalid' using errcode='CR409';
      end if;
    end if;

  elsif new.assignment_source='automatic' then
    select * into v_res
      from public.couranr_dispatch_reservations
     where id=new.dispatch_reservation_id
       and request_id=v_request_id
       and service_plan_id=v_service_plan_id
       and driver_id=new.driver_id
       and vehicle_id=new.vehicle_id
       and reservation_state='active'
       and expires_at>now();
    if not found then
      raise exception 'automatic_dispatch_reservation_invalid' using errcode='CR409';
    end if;

  else
    raise exception 'assignment_source_invalid' using errcode='CR422';
  end if;

  return new;
end
$fn$;

create or replace function private.couranr_enforce_delivery_quote()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  v_o public.couranr_payment_obligations;
  v_c public.couranr_promotional_credits;
  v_p public.couranr_service_plans;
  v_q public.couranr_quote_versions;
  v_r public.couranr_delivery_requests;
begin
  if tg_op='UPDATE' and
     (new.request_id,new.business_account_id,new.payment_obligation_id,new.promotional_credit_id,
      new.service_plan_id,new.quote_version_id,new.pricing_policy_version,
      new.captured_amount_cents,new.standard_quote_cents,new.amount_paid_cents,
      new.promotional_credit_cents,new.currency,new.pickup_address,new.dropoff_address,
      new.recipient,new.shipment,new.service_level,new.signature_required,
      new.proof_method,new.scheduled_pickup_start,new.scheduled_pickup_end,
      new.timezone,new.vehicle_id,new.vehicle_requirement)
     is distinct from
     (old.request_id,old.business_account_id,old.payment_obligation_id,old.promotional_credit_id,
      old.service_plan_id,old.quote_version_id,old.pricing_policy_version,
      old.captured_amount_cents,old.standard_quote_cents,old.amount_paid_cents,
      old.promotional_credit_cents,old.currency,old.pickup_address,old.dropoff_address,
      old.recipient,old.shipment,old.service_level,old.signature_required,
      old.proof_method,old.scheduled_pickup_start,old.scheduled_pickup_end,
      old.timezone,old.vehicle_id,old.vehicle_requirement) then
    raise exception 'delivery_commercial_snapshot_is_immutable' using errcode='CR409';
  end if;

  select * into v_p from public.couranr_service_plans where id=new.service_plan_id;
  select * into v_q from public.couranr_quote_versions where id=new.quote_version_id;
  select * into v_r from public.couranr_delivery_requests where id=new.request_id;

  if v_p.id is null or v_q.id is null or v_r.id is null
     or v_p.request_id is distinct from new.request_id
     or v_q.request_id is distinct from new.request_id
     or new.business_account_id is distinct from v_r.business_account_id
     or new.quote_version_id is distinct from v_p.quote_version_id
     or new.quote_version_id is distinct from v_r.current_quote_version_id
     or new.pricing_policy_version is distinct from v_q.pricing_policy_version
     or new.pickup_address is distinct from v_q.pickup_address_snapshot
     or new.dropoff_address is distinct from v_q.dropoff_address_snapshot
     or new.recipient is distinct from v_q.recipient_snapshot
     or (new.shipment - 'pickupManifest') is distinct from (v_q.shipment_snapshot - 'pickupManifest')
     or (
       tg_op='UPDATE'
       and (new.shipment->'pickupManifest') is distinct from v_r.pickup_manifest
     )
     or (
       tg_op='INSERT'
       and new.shipment ? 'pickupManifest'
       and (new.shipment->'pickupManifest') is distinct from v_r.pickup_manifest
     )
     or new.service_level is distinct from v_q.service_configuration_snapshot->>'serviceLevel'
     or new.signature_required is distinct from
        coalesce((v_q.service_configuration_snapshot->>'signatureRequired')::boolean,false)
     or new.proof_method is distinct from v_q.service_configuration_snapshot->>'proofMethod'
     or new.scheduled_pickup_start is distinct from v_p.scheduled_pickup_start
     or new.scheduled_pickup_end is distinct from v_p.scheduled_pickup_end
     or new.timezone is distinct from v_p.timezone
     or new.vehicle_id is distinct from v_p.vehicle_id
     or new.vehicle_requirement is distinct from v_p.vehicle_requirement then
    raise exception 'delivery_quote_mismatch' using errcode='CR409';
  end if;

  if new.payment_obligation_id is not null and new.promotional_credit_id is null then
    select * into v_o
      from public.couranr_payment_obligations
     where id=new.payment_obligation_id
       and request_id=new.request_id;

    if v_o.id is null
       or v_p.payment_obligation_id is distinct from v_o.id
       or v_p.promotional_credit_id is not null
       or new.quote_version_id is distinct from v_o.quote_version_id
       or new.captured_amount_cents is distinct from coalesce(v_o.captured_amount_cents,v_o.amount_cents)
       or new.currency is distinct from v_o.currency
       or new.standard_quote_cents is not null
       or new.amount_paid_cents is not null
       or new.promotional_credit_cents is not null then
      raise exception 'delivery_quote_mismatch' using errcode='CR409';
    end if;

  elsif new.promotional_credit_id is not null and new.payment_obligation_id is null then
    select * into v_c
      from public.couranr_promotional_credits
     where id=new.promotional_credit_id
       and request_id=new.request_id
       and status='applied';

    if v_c.id is null
       or v_p.promotional_credit_id is distinct from v_c.id
       or v_p.payment_obligation_id is not null
       or new.business_account_id is distinct from v_c.business_account_id
       or new.quote_version_id is distinct from v_c.quote_version_id
       or v_c.standard_quote_cents is distinct from v_q.subtotal_cents
       or new.captured_amount_cents is distinct from 0
       or new.standard_quote_cents is distinct from v_c.standard_quote_cents
       or new.amount_paid_cents is distinct from v_c.amount_paid_cents
       or new.promotional_credit_cents is distinct from v_c.promotional_credit_cents
       or new.currency is distinct from v_c.currency then
      raise exception 'delivery_quote_mismatch' using errcode='CR409';
    end if;

  else
    raise exception 'delivery_quote_mismatch' using errcode='CR409';
  end if;

  return new;
end
$fn$;

commit;

-- ============================================================================
-- Automatic Fulfillment V1: promotional-credit invariant guard parity
--
-- FND-A's original commercial invariant triggers assumed every plan/delivery
-- was backed by a Stripe payment obligation. Automatic Fulfillment later made
-- an applied Couranr promotional credit a mutually-exclusive settlement
-- authority, but the old triggers were not widened with that schema change.
-- Result: a valid credit-backed automatic plan failed with CR409
-- service_plan_quote_mismatch before any service plan could persist.
--
-- This migration keeps the same immutable quote/snapshot guarantees while
-- validating either exactly one Stripe obligation OR exactly one applied
-- promotional credit. It also makes credit-specific delivery economics
-- immutable, not merely the shared snapshot.
-- ============================================================================

begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

create or replace function private.couranr_enforce_plan_quote()
returns trigger
language plpgsql
set search_path=''
as $fn$
declare
  v_o public.couranr_payment_obligations;
  v_c public.couranr_promotional_credits;
  v_r public.couranr_delivery_requests;
begin
  if tg_op='UPDATE' and
     (new.request_id,new.business_account_id,new.payment_obligation_id,new.promotional_credit_id,
      new.quote_version_id,new.scheduled_pickup_start,new.scheduled_pickup_end,
      new.timezone,new.vehicle_id,new.vehicle_requirement)
     is distinct from
     (old.request_id,old.business_account_id,old.payment_obligation_id,old.promotional_credit_id,
      old.quote_version_id,old.scheduled_pickup_start,old.scheduled_pickup_end,
      old.timezone,old.vehicle_id,old.vehicle_requirement) then
    raise exception 'service_plan_commitment_is_immutable' using errcode='CR409';
  end if;

  select * into v_r
    from public.couranr_delivery_requests
   where id=new.request_id;

  if v_r.id is null
     or new.business_account_id is distinct from v_r.business_account_id
     or (tg_op='INSERT' and new.quote_version_id is distinct from v_r.current_quote_version_id) then
    raise exception 'service_plan_quote_mismatch' using errcode='CR409';
  end if;

  if new.payment_obligation_id is not null and new.promotional_credit_id is null then
    select * into v_o
      from public.couranr_payment_obligations
     where id=new.payment_obligation_id
       and request_id=new.request_id;
    if v_o.id is null
       or new.business_account_id is distinct from v_o.business_account_id
       or new.quote_version_id is distinct from v_o.quote_version_id then
      raise exception 'service_plan_quote_mismatch' using errcode='CR409';
    end if;
  elsif new.promotional_credit_id is not null and new.payment_obligation_id is null then
    select * into v_c
      from public.couranr_promotional_credits
     where id=new.promotional_credit_id
       and request_id=new.request_id
       and status='applied';
    if v_c.id is null
       or new.business_account_id is distinct from v_c.business_account_id
       or new.quote_version_id is distinct from v_c.quote_version_id then
      raise exception 'service_plan_quote_mismatch' using errcode='CR409';
    end if;
  else
    raise exception 'service_plan_quote_mismatch' using errcode='CR409';
  end if;

  return new;
end
$fn$;

create or replace function private.couranr_enforce_delivery_quote()
returns trigger
language plpgsql
set search_path=''
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
     or new.shipment is distinct from v_q.shipment_snapshot
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

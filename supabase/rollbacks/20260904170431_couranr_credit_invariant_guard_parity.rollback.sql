-- Roll back 20260904170431_couranr_credit_invariant_guard_parity.
-- Restores the pre-credit invariant functions only when doing so cannot strand
-- or invalidate any credit-backed commercial evidence.
begin;

do $$
begin
  if exists(select 1 from public.couranr_service_plans where promotional_credit_id is not null)
     or exists(select 1 from public.couranr_deliveries where promotional_credit_id is not null) then
    raise exception 'refusing to restore payment-only invariant guards: promotional-credit plan/delivery evidence exists';
  end if;
end $$;

create or replace function private.couranr_enforce_plan_quote()
returns trigger
language plpgsql
set search_path=''
as $fn$
declare
  v_o public.couranr_payment_obligations;
  v_r public.couranr_delivery_requests;
begin
  if tg_op='UPDATE' and
     (new.request_id,new.business_account_id,new.payment_obligation_id,
      new.quote_version_id,new.scheduled_pickup_start,new.scheduled_pickup_end,
      new.timezone,new.vehicle_id,new.vehicle_requirement)
     is distinct from
     (old.request_id,old.business_account_id,old.payment_obligation_id,
      old.quote_version_id,old.scheduled_pickup_start,old.scheduled_pickup_end,
      old.timezone,old.vehicle_id,old.vehicle_requirement) then
    raise exception 'service_plan_commitment_is_immutable' using errcode='CR409';
  end if;
  select * into v_o from public.couranr_payment_obligations
   where id=new.payment_obligation_id and request_id=new.request_id;
  select * into v_r from public.couranr_delivery_requests where id=new.request_id;
  if v_o.id is null or v_r.id is null
     or new.business_account_id is distinct from v_r.business_account_id
     or new.quote_version_id is distinct from v_o.quote_version_id
     or (tg_op='INSERT' and new.quote_version_id is distinct from v_r.current_quote_version_id) then
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
  v_p public.couranr_service_plans;
  v_q public.couranr_quote_versions;
  v_r public.couranr_delivery_requests;
begin
  if tg_op='UPDATE' and
     (new.request_id,new.business_account_id,new.payment_obligation_id,
      new.service_plan_id,new.quote_version_id,new.pricing_policy_version,
      new.captured_amount_cents,new.currency,new.pickup_address,new.dropoff_address,
      new.recipient,new.shipment,new.service_level,new.signature_required,
      new.proof_method,new.scheduled_pickup_start,new.scheduled_pickup_end,
      new.timezone,new.vehicle_id,new.vehicle_requirement)
     is distinct from
     (old.request_id,old.business_account_id,old.payment_obligation_id,
      old.service_plan_id,old.quote_version_id,old.pricing_policy_version,
      old.captured_amount_cents,old.currency,old.pickup_address,old.dropoff_address,
      old.recipient,old.shipment,old.service_level,old.signature_required,
      old.proof_method,old.scheduled_pickup_start,old.scheduled_pickup_end,
      old.timezone,old.vehicle_id,old.vehicle_requirement) then
    raise exception 'delivery_commercial_snapshot_is_immutable' using errcode='CR409';
  end if;
  select * into v_o from public.couranr_payment_obligations where id=new.payment_obligation_id;
  select * into v_p from public.couranr_service_plans where id=new.service_plan_id;
  select * into v_q from public.couranr_quote_versions where id=new.quote_version_id;
  select * into v_r from public.couranr_delivery_requests where id=new.request_id;
  if v_o.id is null or v_p.id is null or v_q.id is null or v_r.id is null
     or v_o.request_id is distinct from new.request_id
     or v_p.request_id is distinct from new.request_id
     or v_q.request_id is distinct from new.request_id
     or new.business_account_id is distinct from v_r.business_account_id
     or new.quote_version_id is distinct from v_o.quote_version_id
     or new.quote_version_id is distinct from v_p.quote_version_id
     or new.quote_version_id is distinct from v_r.current_quote_version_id
     or new.pricing_policy_version is distinct from v_q.pricing_policy_version
     or new.captured_amount_cents is distinct from coalesce(v_o.captured_amount_cents,v_o.amount_cents)
     or new.currency is distinct from v_o.currency
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
  return new;
end
$fn$;

commit;

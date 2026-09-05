-- ============================================================================
-- Credit settlement fix: couranr_confirm_service_plan XOR violation
--
-- couranr_confirm_service_plan's plan insert wrote the payment obligation id in
-- BOTH arms of its CASE:
--   case when v_credit.id is null then v_ob.id else v_ob.id end
-- so a credit-backed plan (v_credit non-null) that also had a coexisting
-- non-cancelled obligation (couranr_apply_promotional_credit does not cancel a
-- 'requires_action' obligation) was inserted with BOTH payment_obligation_id
-- and promotional_credit_id set. That violates the settlement XOR enforced live
-- by CHECK constraint couranr_sp_settlement_identity_chk (23514) and by trigger
-- couranr_sp_quote_invariant_trg (CR409 service_plan_quote_mismatch), so the
-- Ops manual credit-confirm path failed every time an obligation coexisted.
--
-- The sibling writers were already corrected by 20260904154559
-- (couranr_create_delivery_from_promotional_credit, couranr_try_auto_plan);
-- couranr_confirm_service_plan is the only remaining live writer that could set
-- both settlement ids. This migration is the same body as 20260904055602 with
-- the ELSE arm changed from v_ob.id to null, so the credit path writes
-- payment_obligation_id = null and the paid path is unchanged (the top guard
-- proves v_ob is present and 'authorized' before the paid arm runs).
--
-- Bare CREATE OR REPLACE at the exact 8-arg signature — ACL is preserved, no
-- grants added (matches 20260904055602's convention for this function).
-- ============================================================================

begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

create or replace function public.couranr_confirm_service_plan(
  p_request_id uuid,
  p_expected_version integer,
  p_actor_user_id uuid,
  p_pickup_start timestamptz,
  p_pickup_end timestamptz,
  p_timezone text,
  p_vehicle_id uuid,
  p_vehicle_requirement jsonb
)
returns public.couranr_service_plans
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_ob public.couranr_payment_obligations;
  v_quote public.couranr_quote_versions;
  v_credit public.couranr_promotional_credits;
  v_plan public.couranr_service_plans;
  v_cap numeric;
  v_weight numeric;
begin
  select * into v_req from public.couranr_delivery_requests where id=p_request_id for update;
  if not found then raise exception 'request_not_found' using errcode='CR404'; end if;
  if v_req.version is distinct from p_expected_version then
    raise exception 'version_or_state_conflict' using errcode='CR409';
  end if;
  if v_req.request_state <> 'confirmed' then
    raise exception 'request_not_confirmed' using errcode='CR409';
  end if;
  if v_req.current_quote_version_id is null then
    raise exception 'commercial_quote_identity_mismatch' using errcode='CR409';
  end if;

  select * into v_quote from public.couranr_quote_versions
   where id=v_req.current_quote_version_id and request_id=v_req.id;
  if not found then raise exception 'quote_not_found' using errcode='CR409'; end if;

  select * into v_credit
    from public.couranr_promotional_credits
   where request_id=v_req.id
     and quote_version_id=v_quote.id
     and status='applied'
   limit 1;

  select * into v_ob from public.couranr_payment_obligations
   where request_id=v_req.id and payment_state<>'cancelled'
   order by created_at desc
   limit 1;

  if not found and v_credit.id is null then
    raise exception 'payment_not_authorized' using errcode='CR409';
  end if;
  if v_credit.id is null then
    if v_ob.payment_state <> 'authorized' then
      raise exception 'payment_not_authorized' using errcode='CR409';
    end if;
    if v_ob.quote_version_id is distinct from v_quote.id then
      raise exception 'authorization_does_not_match_current_quote' using errcode='CR409';
    end if;
  else
    if v_credit.standard_quote_cents is distinct from v_quote.subtotal_cents
       or v_credit.amount_paid_cents + v_credit.promotional_credit_cents
          is distinct from v_quote.subtotal_cents then
      raise exception 'promotional_credit_does_not_match_current_quote' using errcode='CR409';
    end if;
  end if;

  if p_pickup_start is null or p_pickup_end is null or p_pickup_end<=p_pickup_start then
    raise exception 'invalid_pickup_window' using errcode='CR422';
  end if;
  if nullif(btrim(p_timezone),'') is null then
    raise exception 'timezone_required' using errcode='CR422';
  end if;
  begin perform now() at time zone p_timezone;
  exception when others then raise exception 'unknown_timezone' using errcode='CR422'; end;
  if jsonb_typeof(p_vehicle_requirement) is distinct from 'object'
     or coalesce(p_vehicle_requirement->>'vehicleClass','') not in
        ('car','van','box_truck','cargo_bike') then
    raise exception 'vehicle_requirement_required' using errcode='CR422';
  end if;
  v_cap:=nullif(p_vehicle_requirement->>'maxPayloadLb','')::numeric;
  if v_cap is null or v_cap<=0 then
    raise exception 'vehicle_capacity_required' using errcode='CR422';
  end if;
  v_weight:=coalesce(nullif(v_quote.shipment_snapshot->>'weightLb','')::numeric,0);
  if v_cap<v_weight then
    raise exception 'vehicle_incompatible_with_shipment' using errcode='CR422';
  end if;

  update public.couranr_service_plans set
    plan_state='cancelled',version=version+1,updated_at=now()
  where request_id=v_req.id and plan_state<>'cancelled';

  insert into public.couranr_service_plans(
    request_id,business_account_id,payment_obligation_id,promotional_credit_id,
    request_version,quote_version_id,scheduled_pickup_start,scheduled_pickup_end,
    timezone,vehicle_id,vehicle_requirement,plan_state,confirmed_by,confirmed_at
  ) values (
    v_req.id,v_req.business_account_id,
    case when v_credit.id is null then v_ob.id else null end,
    v_credit.id,
    v_req.version,v_quote.id,p_pickup_start,p_pickup_end,p_timezone,p_vehicle_id,
    p_vehicle_requirement,'confirmed',p_actor_user_id,now()
  ) returning * into v_plan;
  return v_plan;
end
$fn$;

commit;

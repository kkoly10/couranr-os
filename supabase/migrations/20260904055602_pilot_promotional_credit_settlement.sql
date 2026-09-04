-- ============================================================================
-- Controlled Business Pilot: promotional-credit settlement
--
-- A pilot delivery may be commercially covered by Couranr without fabricating
-- Stripe authorization/capture. The standard quote stays immutable and visible.
-- We record amount paid, Couranr credit, reason/campaign, and approver separately.
--
-- This path is intentionally narrow:
--   * Business requests only
--   * source=operations
--   * merchant payer
--   * full credit only for the CURRENT immutable quote
--   * Operations/service_role only; no browser amount control
--   * no payment obligation is marked authorized or captured
-- ============================================================================

begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

create table if not exists public.couranr_promotional_credits (
  id                         uuid primary key default gen_random_uuid(),
  request_id                 uuid not null,
  business_account_id        uuid not null,
  quote_version_id           uuid not null,
  standard_quote_cents       integer not null,
  amount_paid_cents          integer not null default 0,
  promotional_credit_cents   integer not null,
  currency                   text not null default 'usd',
  reason                     text not null,
  campaign                   text not null,
  market                     text not null,
  category                   text not null,
  approved_by                uuid not null,
  approved_at                timestamptz not null default now(),
  status                     text not null default 'applied',
  voided_at                  timestamptz,
  created_at                 timestamptz not null default now(),

  constraint couranr_pc_request_fk
    foreign key (request_id) references public.couranr_delivery_requests(id)
    on update cascade on delete restrict,
  constraint couranr_pc_business_fk
    foreign key (business_account_id) references public.business_accounts(id)
    on update cascade on delete restrict,
  constraint couranr_pc_quote_request_fk
    foreign key (quote_version_id, request_id)
    references public.couranr_quote_versions(id, request_id)
    on update restrict on delete restrict,
  constraint couranr_pc_amounts_chk check (
    standard_quote_cents > 0
    and amount_paid_cents >= 0
    and promotional_credit_cents > 0
    and amount_paid_cents + promotional_credit_cents = standard_quote_cents
  ),
  constraint couranr_pc_currency_chk check (currency = 'usd'),
  constraint couranr_pc_text_chk check (
    length(btrim(reason)) > 0
    and length(btrim(campaign)) > 0
    and length(btrim(market)) > 0
    and length(btrim(category)) > 0
  ),
  constraint couranr_pc_status_chk check (status in ('applied','voided')),
  constraint couranr_pc_void_stamp_chk check (
    (status = 'voided') = (voided_at is not null)
  ),
  constraint couranr_pc_request_quote_uniq unique (request_id, quote_version_id)
);

create unique index if not exists couranr_pc_one_applied_per_request
  on public.couranr_promotional_credits(request_id)
  where status = 'applied';

alter table public.couranr_promotional_credits enable row level security;
revoke all on public.couranr_promotional_credits from public, anon, authenticated, service_role;
grant select, insert, update on public.couranr_promotional_credits to service_role;

alter table public.couranr_service_plans
  add column if not exists promotional_credit_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.couranr_service_plans'::regclass
      and conname='couranr_sp_promotional_credit_fk'
  ) then
    alter table public.couranr_service_plans
      add constraint couranr_sp_promotional_credit_fk
      foreign key (promotional_credit_id)
      references public.couranr_promotional_credits(id)
      on update cascade on delete restrict;
  end if;
end $$;

alter table public.couranr_deliveries
  add column if not exists promotional_credit_id uuid,
  add column if not exists standard_quote_cents integer,
  add column if not exists amount_paid_cents integer,
  add column if not exists promotional_credit_cents integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.couranr_deliveries'::regclass
      and conname='couranr_dlv_promotional_credit_fk'
  ) then
    alter table public.couranr_deliveries
      add constraint couranr_dlv_promotional_credit_fk
      foreign key (promotional_credit_id)
      references public.couranr_promotional_credits(id)
      on update cascade on delete restrict;
  end if;
end $$;

alter table public.couranr_deliveries
  drop constraint if exists couranr_dlv_amount_chk;
alter table public.couranr_deliveries
  add constraint couranr_dlv_amount_chk check (
    (promotional_credit_id is null and captured_amount_cents > 0)
    or
    (promotional_credit_id is not null and captured_amount_cents = 0)
  );

alter table public.couranr_deliveries
  drop constraint if exists couranr_dlv_promotional_amounts_chk;
alter table public.couranr_deliveries
  add constraint couranr_dlv_promotional_amounts_chk check (
    promotional_credit_id is null
    or (
      standard_quote_cents is not null
      and amount_paid_cents is not null
      and promotional_credit_cents is not null
      and standard_quote_cents > 0
      and amount_paid_cents >= 0
      and promotional_credit_cents > 0
      and amount_paid_cents + promotional_credit_cents = standard_quote_cents
    )
  );

-- Extend the immutable event vocabularies for this named settlement path.
alter table public.couranr_delivery_request_events
  drop constraint if exists couranr_dre_command_chk;
alter table public.couranr_delivery_request_events
  add constraint couranr_dre_command_chk check (command in (
    'create_delivery_request_draft','calculate_delivery_request_estimate','create_quote_version',
    'submit_delivery_request','begin_delivery_request_review','accept_delivery_request_as_quoted',
    'requote_delivery_request','decline_delivery_request','record_payer_quote_approval',
    'begin_delivery_preparation','mark_delivery_ready','mark_delivery_not_ready',
    'mark_delivery_unavailable','cancel_delivery_request','apply_promotional_credit'
  ));

alter table public.couranr_delivery_events
  drop constraint if exists couranr_dlve_command_chk;
alter table public.couranr_delivery_events
  add constraint couranr_dlve_command_chk check (command in (
    'create_delivery_from_capture','create_delivery_from_promotional_credit',
    'assign_delivery','unassign_delivery_before_pickup','start_route_to_pickup',
    'arrive_at_pickup','report_pickup_discrepancy',
    'resolve_pickup_discrepancy_safe_to_continue','complete_pickup',
    'start_route_to_dropoff','arrive_at_dropoff','complete_direct_handoff_delivery',
    'complete_signature_delivery','complete_leave_at_door_delivery',
    'report_dropoff_exception','close_delivery_undeliverable','cancel_delivery'
  ));

create or replace function public.couranr_apply_promotional_credit(
  p_request_id uuid,
  p_expected_version integer,
  p_actor_user_id uuid,
  p_reason text,
  p_campaign text,
  p_market text,
  p_category text
)
returns public.couranr_promotional_credits
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_quote public.couranr_quote_versions;
  v_ob public.couranr_payment_obligations;
  v_credit public.couranr_promotional_credits;
  v_from text;
begin
  select * into v_req
    from public.couranr_delivery_requests
   where id=p_request_id
   for update;
  if not found then raise exception 'request_not_found' using errcode='CR404'; end if;
  if v_req.version is distinct from p_expected_version then
    raise exception 'version_or_state_conflict' using errcode='CR409';
  end if;
  if v_req.requester_kind <> 'business'
     or v_req.business_account_id is null
     or v_req.source <> 'operations'
     or v_req.payer_type <> 'merchant' then
    raise exception 'promotional_credit_not_permitted' using errcode='CR403';
  end if;
  if v_req.request_state not in ('quote_revision_required','awaiting_quote_acceptance','confirmed') then
    raise exception 'request_not_creditable' using errcode='CR409';
  end if;
  if v_req.current_quote_version_id is null then
    raise exception 'no_server_quote_to_credit' using errcode='CR422';
  end if;

  select * into v_quote
    from public.couranr_quote_versions
   where id=v_req.current_quote_version_id and request_id=v_req.id;
  if not found or v_quote.quote_status <> 'estimated' or v_quote.subtotal_cents is null then
    raise exception 'no_server_quote_to_credit' using errcode='CR422';
  end if;
  if private.couranr_quote_version_is_expired(v_quote) then
    raise exception 'quote_expired' using errcode='CR410';
  end if;

  select * into v_ob
    from public.couranr_payment_obligations
   where request_id=v_req.id and payment_state <> 'cancelled'
   order by created_at desc
   limit 1;
  if found and v_ob.payment_state in ('authorized','capture_pending','captured','refunded','partially_refunded') then
    raise exception 'payment_already_committed' using errcode='CR409';
  end if;

  select * into v_credit
    from public.couranr_promotional_credits
   where request_id=v_req.id and quote_version_id=v_quote.id;
  if found then
    return v_credit;
  end if;

  update public.couranr_promotional_credits
     set status='voided', voided_at=now()
   where request_id=v_req.id and status='applied';

  insert into public.couranr_promotional_credits(
    request_id,business_account_id,quote_version_id,
    standard_quote_cents,amount_paid_cents,promotional_credit_cents,currency,
    reason,campaign,market,category,approved_by
  ) values (
    v_req.id,v_req.business_account_id,v_quote.id,
    v_quote.subtotal_cents,0,v_quote.subtotal_cents,'usd',
    btrim(p_reason),btrim(p_campaign),btrim(p_market),btrim(p_category),p_actor_user_id
  )
  returning * into v_credit;

  v_from := v_req.request_state;
  update public.couranr_delivery_requests
     set request_state='confirmed',
         version=version+1,
         updated_at=now()
   where id=v_req.id and version=p_expected_version
  returning * into v_req;
  if not found then raise exception 'version_or_state_conflict' using errcode='CR409'; end if;

  insert into public.couranr_delivery_request_events(
    request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_req.id,p_actor_user_id,'operations','apply_promotional_credit',
    v_from,'confirmed',
    jsonb_build_object(
      'promotionalCreditId',v_credit.id,
      'quoteVersionId',v_quote.id,
      'quoteNumber',v_quote.quote_number,
      'standardQuoteCents',v_credit.standard_quote_cents,
      'amountPaidCents',v_credit.amount_paid_cents,
      'promotionalCreditCents',v_credit.promotional_credit_cents,
      'reason',v_credit.reason,
      'campaign',v_credit.campaign,
      'market',v_credit.market,
      'category',v_credit.category
    )
  );
  return v_credit;
end
$fn$;

revoke all on function public.couranr_apply_promotional_credit(
  uuid,integer,uuid,text,text,text,text
) from public,anon,authenticated,service_role;
grant execute on function public.couranr_apply_promotional_credit(
  uuid,integer,uuid,text,text,text,text
) to service_role;

-- Service planning accepts either a real authorized hold OR the exact current
-- quote being fully covered by an applied Couranr promotional credit.
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
    case when v_credit.id is null then v_ob.id else v_ob.id end,
    v_credit.id,
    v_req.version,v_quote.id,p_pickup_start,p_pickup_end,p_timezone,p_vehicle_id,
    p_vehicle_requirement,'confirmed',p_actor_user_id,now()
  ) returning * into v_plan;
  return v_plan;
end
$fn$;

-- A credited delivery is created without touching Stripe state. The existing
-- obligation remains truthful (for this pilot it may still be requires_action).
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

-- Dispatch must accept either captured money OR a fully applied promotional
-- credit pinned into the canonical delivery.
create or replace function public.couranr_assign_delivery(
  p_delivery_id uuid,
  p_expected_version integer,
  p_actor_user_id uuid,
  p_driver_id uuid,
  p_vehicle_id uuid,
  p_idempotency_key text
)
returns public.couranr_delivery_assignments
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_dlv public.couranr_deliveries;
  v_drv public.couranr_drivers;
  v_asg public.couranr_delivery_assignments;
  v_ob_state text;
  v_credit_state text;
  v_plan_state text;
  v_reason text;
begin
  if p_idempotency_key is not null then
    select * into v_asg from public.couranr_delivery_assignments
     where idempotency_key=p_idempotency_key;
    if found then return v_asg; end if;
  end if;

  select * into v_dlv from public.couranr_deliveries where id=p_delivery_id for update;
  if not found then raise exception 'delivery_not_found' using errcode='CR404'; end if;
  if v_dlv.fulfillment_state<>'scheduled' then
    raise exception 'delivery_not_scheduled' using errcode='CR409';
  end if;

  if v_dlv.promotional_credit_id is not null then
    select status into v_credit_state
      from public.couranr_promotional_credits
     where id=v_dlv.promotional_credit_id
       and request_id=v_dlv.request_id
       and quote_version_id=v_dlv.quote_version_id;
    if v_credit_state is distinct from 'applied' then
      raise exception 'commercial_settlement_not_confirmed' using errcode='CR409';
    end if;
  else
    select o.payment_state into v_ob_state
      from public.couranr_payment_obligations o
     where o.id=v_dlv.payment_obligation_id;
    if v_ob_state is distinct from 'captured' then
      raise exception 'payment_not_captured' using errcode='CR409';
    end if;
  end if;

  select p.plan_state into v_plan_state
    from public.couranr_service_plans p
   where p.id=v_dlv.service_plan_id;
  if v_plan_state is distinct from 'confirmed' then
    raise exception 'service_plan_not_confirmed' using errcode='CR409';
  end if;

  if exists (
    select 1 from public.couranr_delivery_assignments
     where delivery_id=p_delivery_id and assignment_state='active'
  ) then
    raise exception 'delivery_already_assigned' using errcode='CR409';
  end if;

  select * into v_drv from public.couranr_drivers where id=p_driver_id for update;
  if not found then raise exception 'driver_not_found' using errcode='CR404'; end if;
  if v_drv.driver_state<>'active' or not v_drv.active then
    raise exception 'driver_not_active' using errcode='CR409';
  end if;
  if v_drv.availability_state<>'available' then
    raise exception 'driver_not_available' using errcode='CR409';
  end if;

  v_reason:=public.couranr_vehicle_incompatibility(
    p_vehicle_id,p_driver_id,v_dlv.vehicle_requirement
  );
  if v_reason is not null then
    raise exception using errcode='CR409',message=v_reason;
  end if;

  insert into public.couranr_delivery_assignments(
    delivery_id,driver_id,vehicle_id,assigned_by,idempotency_key
  ) values (
    p_delivery_id,p_driver_id,p_vehicle_id,p_actor_user_id,p_idempotency_key
  ) returning * into v_asg;

  insert into public.couranr_assignment_events(
    assignment_id,delivery_id,actor_user_id,actor_type,command,
    from_state,to_state,metadata
  ) values (
    v_asg.id,p_delivery_id,p_actor_user_id,'operations','assign_delivery',
    null,'active',
    jsonb_build_object('driverId',p_driver_id,'vehicleId',p_vehicle_id)
  );

  update public.couranr_deliveries
     set fulfillment_state='assigned',
         version=version+1,
         updated_at=now()
   where id=p_delivery_id
     and version=p_expected_version
     and fulfillment_state='scheduled'
  returning * into v_dlv;
  if not found then raise exception 'version_conflict' using errcode='CR409'; end if;

  insert into public.couranr_delivery_events(
    delivery_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    p_delivery_id,p_actor_user_id,'operations','assign_delivery',
    'scheduled','assigned',
    jsonb_build_object('assignmentId',v_asg.id,'driverId',p_driver_id,'vehicleId',p_vehicle_id)
  );

  update public.couranr_drivers
     set availability_state='on_delivery',version=version+1,updated_at=now()
   where id=p_driver_id;
  update public.couranr_dispatch_vehicles
     set availability_state='on_delivery',version=version+1,updated_at=now()
   where id=p_vehicle_id;
  return v_asg;
exception when unique_violation then
  if p_idempotency_key is not null then
    select * into v_asg from public.couranr_delivery_assignments
     where idempotency_key=p_idempotency_key;
    if found then return v_asg; end if;
  end if;
  raise exception 'delivery_already_assigned' using errcode='CR409';
end
$fn$;

commit;

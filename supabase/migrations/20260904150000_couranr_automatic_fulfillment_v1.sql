-- ============================================================================
-- Couranr Automatic Fulfillment V1
--
-- Normal-lane deliveries are machine-scheduled and late-bound to a driver.
-- Humans operate exceptions. This migration preserves the existing manual
-- service-plan and dispatch commands as the governed exception lane.
--
-- Commercial invariants remain unchanged:
--   * immutable quote identity
--   * no browser-owned schedule, money, routing or target state
--   * captured payment OR an applied Couranr credit before dispatch
--   * system automation is audited as system, never as Operations
-- ============================================================================

begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. Automatic-plan metadata. Historical plans remain Operations-owned.
-- ---------------------------------------------------------------------------

alter table public.couranr_service_plans
  add column if not exists plan_source text not null default 'operations',
  add column if not exists planner_version text,
  add column if not exists market_key text,
  add column if not exists dispatch_not_before timestamptz,
  add column if not exists dispatch_deadline timestamptz,
  add column if not exists expected_service_end timestamptz,
  add column if not exists last_revalidated_at timestamptz,
  add column if not exists revalidated_loaded_miles numeric(10,3),
  add column if not exists revalidated_route_duration_seconds integer,
  add column if not exists revalidated_traffic_delay_seconds integer;

alter table public.couranr_service_plans
  drop constraint if exists couranr_sp_plan_source_chk;
alter table public.couranr_service_plans
  add constraint couranr_sp_plan_source_chk
  check (plan_source in ('operations','automatic'));

alter table public.couranr_service_plans
  drop constraint if exists couranr_sp_confirmed_stamp_chk;
alter table public.couranr_service_plans
  add constraint couranr_sp_confirmed_stamp_chk
  check (
    plan_state <> 'confirmed'
    or (
      confirmed_at is not null
      and (
        (plan_source='operations' and confirmed_by is not null)
        or
        (plan_source='automatic' and confirmed_by is null)
      )
    )
  );

alter table public.couranr_service_plans
  drop constraint if exists couranr_sp_auto_schedule_chk;
alter table public.couranr_service_plans
  add constraint couranr_sp_auto_schedule_chk
  check (
    plan_source <> 'automatic'
    or (
      planner_version is not null
      and market_key is not null
      and dispatch_not_before is not null
      and dispatch_deadline is not null
      and expected_service_end is not null
      and dispatch_deadline >= dispatch_not_before
      and expected_service_end > scheduled_pickup_start
    )
  );

alter table public.couranr_deliveries
  add column if not exists plan_source text not null default 'operations',
  add column if not exists planner_version text,
  add column if not exists market_key text,
  add column if not exists dispatch_not_before timestamptz,
  add column if not exists dispatch_deadline timestamptz,
  add column if not exists expected_service_end timestamptz,
  add column if not exists last_revalidated_at timestamptz,
  add column if not exists revalidated_loaded_miles numeric(10,3),
  add column if not exists revalidated_route_duration_seconds integer,
  add column if not exists revalidated_traffic_delay_seconds integer;

alter table public.couranr_deliveries
  drop constraint if exists couranr_dlv_plan_source_chk;
alter table public.couranr_deliveries
  add constraint couranr_dlv_plan_source_chk
  check (plan_source in ('operations','automatic'));

-- Every canonical delivery copies the schedule authority from its plan,
-- regardless of whether it is created by Stripe capture or promotional credit.
create or replace function private.couranr_copy_plan_automation_metadata()
returns trigger
language plpgsql
set search_path=''
as $fn$
declare
  v_plan public.couranr_service_plans;
begin
  select * into v_plan
    from public.couranr_service_plans
   where id = new.service_plan_id;
  if not found then
    raise exception 'service_plan_not_found' using errcode='CR409';
  end if;

  new.plan_source := v_plan.plan_source;
  new.planner_version := v_plan.planner_version;
  new.market_key := v_plan.market_key;
  new.dispatch_not_before := v_plan.dispatch_not_before;
  new.dispatch_deadline := v_plan.dispatch_deadline;
  new.expected_service_end := v_plan.expected_service_end;
  new.last_revalidated_at := v_plan.last_revalidated_at;
  new.revalidated_loaded_miles := v_plan.revalidated_loaded_miles;
  new.revalidated_route_duration_seconds := v_plan.revalidated_route_duration_seconds;
  new.revalidated_traffic_delay_seconds := v_plan.revalidated_traffic_delay_seconds;
  return new;
end
$fn$;

drop trigger if exists couranr_copy_plan_automation_metadata on public.couranr_deliveries;
create trigger couranr_copy_plan_automation_metadata
before insert on public.couranr_deliveries
for each row execute function private.couranr_copy_plan_automation_metadata();

-- ---------------------------------------------------------------------------
-- 2. Capacity control. V1 has one launch dispatch pool; the schema is keyed so
--    future markets do not require a rewrite.
-- ---------------------------------------------------------------------------

create table if not exists public.couranr_capacity_policies (
  market_key text primary key,
  max_concurrent_deliveries integer not null,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint couranr_cp_market_chk check (length(btrim(market_key)) > 0),
  constraint couranr_cp_limit_chk check (max_concurrent_deliveries > 0)
);

insert into public.couranr_capacity_policies(market_key,max_concurrent_deliveries,active)
values ('dc_va_launch_corridor',1,true)
on conflict (market_key) do nothing;

create table if not exists public.couranr_operating_closures (
  id uuid primary key default gen_random_uuid(),
  market_key text not null references public.couranr_capacity_policies(market_key)
    on update cascade on delete restrict,
  local_date date not null,
  reason text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint couranr_oc_reason_chk check (length(btrim(reason)) > 0),
  constraint couranr_oc_unique unique (market_key,local_date)
);

create table if not exists public.couranr_capacity_reservations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.couranr_delivery_requests(id)
    on update cascade on delete restrict,
  service_plan_id uuid not null references public.couranr_service_plans(id)
    on update cascade on delete restrict,
  market_key text not null references public.couranr_capacity_policies(market_key)
    on update cascade on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reservation_state text not null default 'reserved',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint couranr_cr_window_chk check (ends_at > starts_at),
  constraint couranr_cr_state_chk check (reservation_state in ('reserved','cancelled')),
  constraint couranr_cr_plan_unique unique(service_plan_id)
);
create index if not exists couranr_cr_market_window_idx
  on public.couranr_capacity_reservations(market_key,starts_at,ends_at)
  where reservation_state='reserved';

alter table public.couranr_capacity_policies enable row level security;
alter table public.couranr_operating_closures enable row level security;
alter table public.couranr_capacity_reservations enable row level security;
revoke all on public.couranr_capacity_policies from public,anon,authenticated;
revoke all on public.couranr_operating_closures from public,anon,authenticated;
revoke all on public.couranr_capacity_reservations from public,anon,authenticated;
grant select,insert,update,delete on public.couranr_capacity_policies to service_role;
grant select,insert,update,delete on public.couranr_operating_closures to service_role;
grant select,insert,update,delete on public.couranr_capacity_reservations to service_role;

create or replace function private.couranr_cancel_capacity_with_plan()
returns trigger
language plpgsql
set search_path=''
as $fn$
begin
  if new.plan_state='cancelled' and old.plan_state is distinct from 'cancelled' then
    update public.couranr_capacity_reservations
       set reservation_state='cancelled',updated_at=now()
     where service_plan_id=new.id and reservation_state='reserved';
  end if;
  return new;
end
$fn$;

drop trigger if exists couranr_cancel_capacity_with_plan on public.couranr_service_plans;
create trigger couranr_cancel_capacity_with_plan
after update of plan_state on public.couranr_service_plans
for each row execute function private.couranr_cancel_capacity_with_plan();

-- ---------------------------------------------------------------------------
-- 3. Exception ledger: this is what Operations works. Normal automatic rows
--    do not become queue chores.
-- ---------------------------------------------------------------------------

create table if not exists public.couranr_automation_exceptions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.couranr_delivery_requests(id)
    on update cascade on delete restrict,
  service_plan_id uuid references public.couranr_service_plans(id)
    on update cascade on delete restrict,
  delivery_id uuid references public.couranr_deliveries(id)
    on update cascade on delete restrict,
  exception_stage text not null,
  reason text not null,
  detail jsonb not null default '{}'::jsonb,
  exception_state text not null default 'open',
  attempts integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint couranr_ax_stage_chk check (exception_stage in ('review','planning','dispatch','commercial')),
  constraint couranr_ax_state_chk check (exception_state in ('open','resolved')),
  constraint couranr_ax_reason_chk check (length(btrim(reason)) > 0),
  constraint couranr_ax_detail_chk check (jsonb_typeof(detail)='object'),
  constraint couranr_ax_attempts_chk check (attempts > 0),
  constraint couranr_ax_resolved_chk check ((exception_state='resolved')=(resolved_at is not null))
);
create unique index if not exists couranr_ax_one_open_stage_per_request
  on public.couranr_automation_exceptions(request_id,exception_stage)
  where exception_state='open';
create index if not exists couranr_ax_open_idx
  on public.couranr_automation_exceptions(exception_state,last_seen_at desc);

alter table public.couranr_automation_exceptions enable row level security;
revoke all on public.couranr_automation_exceptions from public,anon,authenticated;
grant select,insert,update on public.couranr_automation_exceptions to service_role;

create or replace function public.couranr_open_automation_exception(
  p_request_id uuid,
  p_stage text,
  p_reason text,
  p_detail jsonb,
  p_service_plan_id uuid default null,
  p_delivery_id uuid default null
)
returns public.couranr_automation_exceptions
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_row public.couranr_automation_exceptions;
begin
  if p_stage not in ('review','planning','dispatch','commercial') then
    raise exception 'automation_exception_stage_invalid' using errcode='CR422';
  end if;
  if nullif(btrim(p_reason),'') is null then
    raise exception 'automation_exception_reason_required' using errcode='CR422';
  end if;
  if p_detail is null or jsonb_typeof(p_detail)<>'object' then
    raise exception 'automation_exception_detail_invalid' using errcode='CR422';
  end if;

  select * into v_row
    from public.couranr_automation_exceptions
   where request_id=p_request_id
     and exception_stage=p_stage
     and exception_state='open'
   for update;

  if found then
    update public.couranr_automation_exceptions
       set reason=p_reason,
           detail=p_detail,
           service_plan_id=coalesce(p_service_plan_id,service_plan_id),
           delivery_id=coalesce(p_delivery_id,delivery_id),
           attempts=attempts+1,
           last_seen_at=now()
     where id=v_row.id
     returning * into v_row;
    return v_row;
  end if;

  insert into public.couranr_automation_exceptions(
    request_id,service_plan_id,delivery_id,exception_stage,reason,detail
  ) values (
    p_request_id,p_service_plan_id,p_delivery_id,p_stage,p_reason,p_detail
  )
  returning * into v_row;
  return v_row;
end
$fn$;

create or replace function public.couranr_resolve_automation_exception(
  p_request_id uuid,
  p_stage text
)
returns integer
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_count integer;
begin
  update public.couranr_automation_exceptions
     set exception_state='resolved',resolved_at=now(),last_seen_at=now()
   where request_id=p_request_id
     and exception_stage=p_stage
     and exception_state='open';
  get diagnostics v_count = row_count;
  return v_count;
end
$fn$;

revoke all on function public.couranr_open_automation_exception(uuid,text,text,jsonb,uuid,uuid)
  from public,anon,authenticated;
revoke all on function public.couranr_resolve_automation_exception(uuid,text)
  from public,anon,authenticated;
grant execute on function public.couranr_open_automation_exception(uuid,text,text,jsonb,uuid,uuid)
  to service_role;
grant execute on function public.couranr_resolve_automation_exception(uuid,text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. Closed automatic-lane eligibility. This intentionally re-checks the
--    persisted request + immutable quote instead of trusting a caller saying
--    "normal".
-- ---------------------------------------------------------------------------

create or replace function private.couranr_automatic_lane_reason(p_request_id uuid)
returns text
language plpgsql security invoker stable set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_quote public.couranr_quote_versions;
begin
  select * into v_req from public.couranr_delivery_requests where id=p_request_id;
  if not found then return 'request_not_found'; end if;
  if v_req.current_quote_version_id is null then return 'current_quote_missing'; end if;
  select * into v_quote from public.couranr_quote_versions
   where id=v_req.current_quote_version_id and request_id=v_req.id;
  if not found then return 'current_quote_missing'; end if;

  if v_quote.quote_status<>'estimated' or v_quote.subtotal_cents is null then
    return 'quote_not_automatic';
  end if;
  if jsonb_array_length(coalesce(v_quote.review_reasons,'[]'::jsonb))>0
     or jsonb_array_length(coalesce(v_req.review_reasons,'[]'::jsonb))>0 then
    return 'quote_requires_review';
  end if;
  if jsonb_array_length(coalesce(v_req.timing_review_reasons,'[]'::jsonb))>0 then
    return 'timing_requires_review';
  end if;
  if v_req.restricted_class is distinct from 'none' then
    return 'shipment_safety_not_confirmed';
  end if;
  if coalesce(v_req.additional_stops,0)<>0 then
    return 'multiple_stops_not_automatic';
  end if;
  if v_quote.serviceability_outcome is distinct from 'available_for_request'
     or v_quote.loaded_distance_miles is null
     or v_quote.loaded_distance_miles>25 then
    return 'route_not_automatic';
  end if;
  if v_quote.route_traffic_delay_seconds is null
     or v_quote.route_traffic_delay_seconds>1500 then
    return 'traffic_not_automatic';
  end if;
  if coalesce((v_req.normalized_request_payload->>'overnightRequested')::boolean,false) then
    return 'overnight_not_automatic';
  end if;
  if v_req.weight_lb is not null then
    if v_req.weight_lb<=0 or v_req.weight_lb>50 then return 'weight_not_automatic'; end if;
  elsif v_req.weight_band not in ('0_25_lb','over_25_to_50_lb') then
    return 'weight_not_automatic';
  end if;
  if v_quote.route_duration_seconds is null or v_quote.route_duration_seconds<=0 then
    return 'route_duration_missing';
  end if;
  return null;
end
$fn$;

-- Automatic review uses the exact same commercial authority rules:
-- service can be auto-accepted; payer approval is never fabricated.
alter table public.couranr_delivery_request_events
  drop constraint if exists couranr_dre_command_chk;
alter table public.couranr_delivery_request_events
  add constraint couranr_dre_command_chk check (command in (
    'create_delivery_request_draft','calculate_delivery_request_estimate','create_quote_version',
    'submit_delivery_request','begin_delivery_request_review','accept_delivery_request_as_quoted',
    'auto_accept_delivery_request','auto_plan_delivery_request',
    'requote_delivery_request','decline_delivery_request','record_payer_quote_approval',
    'begin_delivery_preparation','mark_delivery_ready','mark_delivery_not_ready',
    'mark_delivery_unavailable','cancel_delivery_request','apply_promotional_credit'
  ));

create or replace function public.couranr_try_auto_accept_standard_request(
  p_request_id uuid
)
returns public.couranr_delivery_requests
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_quote public.couranr_quote_versions;
  v_submit jsonb;
  v_target text;
  v_lane_reason text;
begin
  select * into v_req from public.couranr_delivery_requests
   where id=p_request_id for update;
  if not found then raise exception 'request_not_found' using errcode='CR404'; end if;

  if v_req.request_state<>'pending_couranr_review' or v_req.review_state<>'pending' then
    return v_req;
  end if;

  v_lane_reason:=private.couranr_automatic_lane_reason(v_req.id);
  if v_lane_reason is not null then return v_req; end if;

  select * into v_quote from public.couranr_quote_versions
   where id=v_req.current_quote_version_id and request_id=v_req.id;
  if not found then return v_req; end if;

  if v_req.requester_kind='consumer' then
    -- CAP-001: the consumer authorizes first, then the standard lane can be
    -- accepted automatically. No authorization means no automatic review.
    if not private.couranr_quote_payer_approved(v_quote) then return v_req; end if;
    v_target:='confirmed';
  elsif v_quote.payer_type='customer' then
    -- Couranr accepts service; the real customer still approves the amount.
    if private.couranr_quote_version_is_expired(v_quote) then return v_req; end if;
    v_target:='awaiting_quote_acceptance';
  else
    select metadata into v_submit
      from public.couranr_delivery_request_events
     where request_id=v_req.id and command='submit_delivery_request'
     order by created_at desc limit 1;

    if v_submit is not null
       and coalesce((v_submit->>'acknowledgment')::boolean,false)
       and (v_submit->>'quoteVersionId') is not distinct from v_quote.id::text then
      if private.couranr_quote_version_is_expired(v_quote) then return v_req; end if;
      v_target:='confirmed';
    else
      -- Service can be accepted, but the business still owns price approval.
      if private.couranr_quote_version_is_expired(v_quote) then return v_req; end if;
      v_target:='awaiting_quote_acceptance';
    end if;
  end if;

  update public.couranr_delivery_requests
     set request_state=v_target,
         review_state='accepted_as_quoted',
         version=version+1,
         updated_at=now()
   where id=v_req.id
     and version=v_req.version
     and request_state='pending_couranr_review'
     and review_state='pending'
  returning * into v_req;

  if not found then
    select * into v_req from public.couranr_delivery_requests where id=p_request_id;
    return v_req;
  end if;

  insert into public.couranr_delivery_request_events(
    request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_req.id,null,'system','auto_accept_delivery_request',
    'pending_couranr_review',v_target,
    jsonb_build_object(
      'quoteVersionId',v_quote.id,
      'quoteNumber',v_quote.quote_number,
      'payerType',v_quote.payer_type,
      'reviewState','accepted_as_quoted',
      'quoteChanged',false,
      'automaticLane',true,
      'payerApprovalPending',v_target='awaiting_quote_acceptance'
    )
  );

  perform public.couranr_resolve_automation_exception(v_req.id,'review');
  return v_req;
end
$fn$;

revoke all on function public.couranr_try_auto_accept_standard_request(uuid)
  from public,anon,authenticated;
grant execute on function public.couranr_try_auto_accept_standard_request(uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. Deterministic automatic planning.
-- ---------------------------------------------------------------------------

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
  from public,anon,authenticated;
grant execute on function public.couranr_try_auto_plan(uuid,text,timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6. Route revalidation evidence. It can block dispatch; it never reprices.
-- ---------------------------------------------------------------------------

create or replace function public.couranr_record_auto_revalidation(
  p_service_plan_id uuid,
  p_loaded_miles numeric,
  p_route_duration_seconds integer,
  p_traffic_delay_seconds integer
)
returns public.couranr_service_plans
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_plan public.couranr_service_plans;
begin
  if p_loaded_miles is null or p_loaded_miles<0
     or p_route_duration_seconds is null or p_route_duration_seconds<=0
     or p_traffic_delay_seconds is null or p_traffic_delay_seconds<0 then
    raise exception 'revalidation_evidence_invalid' using errcode='CR422';
  end if;

  update public.couranr_service_plans
     set last_revalidated_at=now(),
         revalidated_loaded_miles=round(p_loaded_miles,3),
         revalidated_route_duration_seconds=p_route_duration_seconds,
         revalidated_traffic_delay_seconds=p_traffic_delay_seconds,
         updated_at=now()
   where id=p_service_plan_id
     and plan_state='confirmed'
     and plan_source='automatic'
  returning * into v_plan;
  if not found then raise exception 'automatic_plan_not_found' using errcode='CR404'; end if;

  update public.couranr_deliveries
     set last_revalidated_at=v_plan.last_revalidated_at,
         revalidated_loaded_miles=v_plan.revalidated_loaded_miles,
         revalidated_route_duration_seconds=v_plan.revalidated_route_duration_seconds,
         revalidated_traffic_delay_seconds=v_plan.revalidated_traffic_delay_seconds,
         updated_at=now()
   where service_plan_id=v_plan.id;

  return v_plan;
end
$fn$;

revoke all on function public.couranr_record_auto_revalidation(uuid,numeric,integer,integer)
  from public,anon,authenticated;
grant execute on function public.couranr_record_auto_revalidation(uuid,numeric,integer,integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 7. Short-lived dispatch reservations. They protect the interval between
--    choosing a candidate and settling/committing the assignment.
-- ---------------------------------------------------------------------------

create table if not exists public.couranr_dispatch_reservations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.couranr_delivery_requests(id)
    on update cascade on delete restrict,
  service_plan_id uuid not null references public.couranr_service_plans(id)
    on update cascade on delete restrict,
  delivery_id uuid references public.couranr_deliveries(id)
    on update cascade on delete restrict,
  driver_id uuid not null references public.couranr_drivers(id)
    on update cascade on delete restrict,
  vehicle_id uuid not null references public.couranr_dispatch_vehicles(id)
    on update cascade on delete restrict,
  reservation_state text not null default 'active',
  expires_at timestamptz not null,
  release_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint couranr_drsv_state_chk check (reservation_state in ('active','committed','released','expired')),
  constraint couranr_drsv_expiry_chk check (expires_at>created_at)
);
create unique index if not exists couranr_drsv_one_active_request
  on public.couranr_dispatch_reservations(request_id) where reservation_state='active';
create unique index if not exists couranr_drsv_one_active_driver
  on public.couranr_dispatch_reservations(driver_id) where reservation_state='active';
create unique index if not exists couranr_drsv_one_active_vehicle
  on public.couranr_dispatch_reservations(vehicle_id) where reservation_state='active';

alter table public.couranr_dispatch_reservations enable row level security;
revoke all on public.couranr_dispatch_reservations from public,anon,authenticated;
grant select,insert,update on public.couranr_dispatch_reservations to service_role;

alter table public.couranr_delivery_assignments
  add column if not exists assignment_source text not null default 'operations',
  add column if not exists dispatch_reservation_id uuid;

alter table public.couranr_delivery_assignments
  alter column assigned_by drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid='public.couranr_delivery_assignments'::regclass
       and conname='couranr_asg_dispatch_reservation_fk'
  ) then
    alter table public.couranr_delivery_assignments
      add constraint couranr_asg_dispatch_reservation_fk
      foreign key(dispatch_reservation_id)
      references public.couranr_dispatch_reservations(id)
      on update cascade on delete restrict;
  end if;
end $$;

alter table public.couranr_delivery_assignments
  drop constraint if exists couranr_asg_source_actor_chk;
alter table public.couranr_delivery_assignments
  add constraint couranr_asg_source_actor_chk check (
    (assignment_source='operations' and assigned_by is not null and dispatch_reservation_id is null)
    or
    (assignment_source='automatic' and assigned_by is null and dispatch_reservation_id is not null)
  );

create or replace function private.couranr_assignment_reservation_guard()
returns trigger
language plpgsql set search_path=''
as $fn$
declare
  v_request_id uuid;
  v_res public.couranr_dispatch_reservations;
begin
  select request_id into v_request_id from public.couranr_deliveries where id=new.delivery_id;
  if v_request_id is null then
    raise exception 'delivery_not_found' using errcode='CR404';
  end if;

  if new.assignment_source='operations' then
    if exists(
      select 1 from public.couranr_dispatch_reservations
       where request_id=v_request_id
         and reservation_state='active'
         and expires_at>now()
    ) then
      raise exception 'delivery_reserved_for_automatic_dispatch' using errcode='CR409';
    end if;
  elsif new.assignment_source='automatic' then
    select * into v_res from public.couranr_dispatch_reservations
     where id=new.dispatch_reservation_id
       and request_id=v_request_id
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

drop trigger if exists couranr_assignment_reservation_guard on public.couranr_delivery_assignments;
create trigger couranr_assignment_reservation_guard
before insert on public.couranr_delivery_assignments
for each row execute function private.couranr_assignment_reservation_guard();

create or replace function public.couranr_reserve_automatic_dispatch_candidate(
  p_request_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_plan public.couranr_service_plans;
  v_existing public.couranr_dispatch_reservations;
  v_driver_id uuid;
  v_vehicle_id uuid;
  v_row public.couranr_dispatch_reservations;
  v_delivery_id uuid;
begin
  select * into v_plan from public.couranr_service_plans
   where request_id=p_request_id
     and plan_state='confirmed'
     and plan_source='automatic'
   order by created_at desc limit 1
   for update;
  if not found then
    return jsonb_build_object('outcome','waiting','reason','automatic_plan_missing');
  end if;
  if v_plan.dispatch_not_before is null or p_now<v_plan.dispatch_not_before then
    return jsonb_build_object('outcome','waiting','reason','dispatch_not_due');
  end if;

  if exists(
    select 1 from public.couranr_automation_exceptions
     where request_id=p_request_id and exception_stage='dispatch' and exception_state='open'
  ) then
    return jsonb_build_object('outcome','exception','reason','dispatch_exception_open');
  end if;

  perform pg_advisory_xact_lock(hashtext('couranr-dispatch:'||coalesce(v_plan.market_key,'default')));

  update public.couranr_dispatch_reservations
     set reservation_state='expired',release_reason='ttl_expired',updated_at=now()
   where reservation_state='active' and expires_at<=p_now;

  select * into v_existing from public.couranr_dispatch_reservations
   where request_id=p_request_id and reservation_state='active' and expires_at>p_now
   limit 1;
  if found then
    return jsonb_build_object(
      'outcome','reserved',
      'reservationId',v_existing.id,
      'driverId',v_existing.driver_id,
      'vehicleId',v_existing.vehicle_id,
      'expiresAt',v_existing.expires_at
    );
  end if;

  select id into v_delivery_id from public.couranr_deliveries where request_id=p_request_id;

  select d.id,v.id into v_driver_id,v_vehicle_id
    from public.couranr_drivers d
    cross join public.couranr_dispatch_vehicles v
   where d.driver_state='active'
     and d.active=true
     and d.availability_state='available'
     and v.active=true
     and v.availability_state='available'
     and (v.assigned_driver_id is null or v.assigned_driver_id=d.id)
     and public.couranr_vehicle_incompatibility(v.id,d.id,v_plan.vehicle_requirement) is null
     and not exists(
       select 1 from public.couranr_dispatch_reservations x
        where x.driver_id=d.id and x.reservation_state='active' and x.expires_at>p_now
     )
     and not exists(
       select 1 from public.couranr_dispatch_reservations x
        where x.vehicle_id=v.id and x.reservation_state='active' and x.expires_at>p_now
     )
   order by
     case when v.assigned_driver_id=d.id then 0 else 1 end,
     d.created_at,
     v.created_at
   limit 1;

  if v_driver_id is null or v_vehicle_id is null then
    if v_plan.dispatch_deadline is not null and p_now>=v_plan.dispatch_deadline then
      perform public.couranr_open_automation_exception(
        p_request_id,'dispatch','no_driver_before_deadline',
        jsonb_build_object(
          'servicePlanId',v_plan.id,
          'dispatchDeadline',v_plan.dispatch_deadline,
          'plannerVersion',v_plan.planner_version
        ),
        v_plan.id,v_delivery_id
      );
      return jsonb_build_object('outcome','exception','reason','no_driver_before_deadline');
    end if;
    return jsonb_build_object('outcome','waiting','reason','no_candidate_yet');
  end if;

  insert into public.couranr_dispatch_reservations(
    request_id,service_plan_id,delivery_id,driver_id,vehicle_id,expires_at
  ) values (
    p_request_id,v_plan.id,v_delivery_id,v_driver_id,v_vehicle_id,p_now+interval '5 minutes'
  ) returning * into v_row;

  return jsonb_build_object(
    'outcome','reserved',
    'reservationId',v_row.id,
    'driverId',v_row.driver_id,
    'vehicleId',v_row.vehicle_id,
    'expiresAt',v_row.expires_at
  );
exception when unique_violation then
  select * into v_existing from public.couranr_dispatch_reservations
   where request_id=p_request_id and reservation_state='active' and expires_at>p_now
   limit 1;
  if found then
    return jsonb_build_object(
      'outcome','reserved',
      'reservationId',v_existing.id,
      'driverId',v_existing.driver_id,
      'vehicleId',v_existing.vehicle_id,
      'expiresAt',v_existing.expires_at
    );
  end if;
  return jsonb_build_object('outcome','waiting','reason','candidate_raced');
end
$fn$;

create or replace function public.couranr_release_automatic_dispatch_reservation(
  p_reservation_id uuid,
  p_reason text
)
returns public.couranr_dispatch_reservations
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_row public.couranr_dispatch_reservations;
begin
  update public.couranr_dispatch_reservations
     set reservation_state='released',
         release_reason=left(coalesce(nullif(btrim(p_reason),''),'released'),200),
         updated_at=now()
   where id=p_reservation_id and reservation_state='active'
  returning * into v_row;
  if not found then
    select * into v_row from public.couranr_dispatch_reservations where id=p_reservation_id;
  end if;
  if not found then raise exception 'dispatch_reservation_not_found' using errcode='CR404'; end if;
  return v_row;
end
$fn$;

create or replace function public.couranr_commit_automatic_assignment(
  p_reservation_id uuid,
  p_delivery_id uuid,
  p_expected_delivery_version integer,
  p_idempotency_key text
)
returns public.couranr_delivery_assignments
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_res public.couranr_dispatch_reservations;
  v_dlv public.couranr_deliveries;
  v_plan public.couranr_service_plans;
  v_drv public.couranr_drivers;
  v_veh public.couranr_dispatch_vehicles;
  v_asg public.couranr_delivery_assignments;
  v_reason text;
begin
  if nullif(btrim(p_idempotency_key),'') is null then
    raise exception 'idempotency_key_required' using errcode='CR422';
  end if;

  select * into v_asg from public.couranr_delivery_assignments
   where idempotency_key=p_idempotency_key;
  if found then return v_asg; end if;

  select * into v_res from public.couranr_dispatch_reservations
   where id=p_reservation_id for update;
  if not found then raise exception 'dispatch_reservation_not_found' using errcode='CR404'; end if;
  if v_res.reservation_state<>'active' or v_res.expires_at<=now() then
    raise exception 'dispatch_reservation_expired' using errcode='CR409';
  end if;

  select * into v_dlv from public.couranr_deliveries
   where id=p_delivery_id for update;
  if not found then raise exception 'delivery_not_found' using errcode='CR404'; end if;
  if v_dlv.request_id is distinct from v_res.request_id
     or v_dlv.service_plan_id is distinct from v_res.service_plan_id then
    raise exception 'dispatch_reservation_delivery_mismatch' using errcode='CR409';
  end if;
  if v_dlv.fulfillment_state<>'scheduled' or v_dlv.version<>p_expected_delivery_version then
    raise exception 'version_or_state_conflict' using errcode='CR409';
  end if;

  select * into v_plan from public.couranr_service_plans
   where id=v_dlv.service_plan_id;
  if not found or v_plan.plan_state<>'confirmed' or v_plan.plan_source<>'automatic' then
    raise exception 'automatic_service_plan_not_confirmed' using errcode='CR409';
  end if;

  select * into v_drv from public.couranr_drivers where id=v_res.driver_id for update;
  select * into v_veh from public.couranr_dispatch_vehicles where id=v_res.vehicle_id for update;
  if v_drv.id is null or v_drv.driver_state<>'active' or not v_drv.active
     or v_drv.availability_state<>'available' then
    raise exception 'driver_not_available' using errcode='CR409';
  end if;
  if v_veh.id is null or not v_veh.active or v_veh.availability_state<>'available' then
    raise exception 'vehicle_unavailable' using errcode='CR409';
  end if;
  v_reason:=public.couranr_vehicle_incompatibility(v_veh.id,v_drv.id,v_plan.vehicle_requirement);
  if v_reason is not null then
    raise exception using errcode='CR409',message=v_reason;
  end if;

  insert into public.couranr_delivery_assignments(
    delivery_id,driver_id,vehicle_id,assigned_by,idempotency_key,
    assignment_source,dispatch_reservation_id
  ) values (
    v_dlv.id,v_drv.id,v_veh.id,null,p_idempotency_key,
    'automatic',v_res.id
  ) returning * into v_asg;

  update public.couranr_deliveries
     set fulfillment_state='assigned',version=version+1,updated_at=now()
   where id=v_dlv.id and version=p_expected_delivery_version and fulfillment_state='scheduled'
  returning * into v_dlv;
  if not found then raise exception 'version_or_state_conflict' using errcode='CR409'; end if;

  update public.couranr_drivers
     set availability_state='on_delivery',version=version+1,updated_at=now()
   where id=v_drv.id;
  update public.couranr_dispatch_vehicles
     set availability_state='on_delivery',version=version+1,updated_at=now()
   where id=v_veh.id;

  update public.couranr_dispatch_reservations
     set delivery_id=v_dlv.id,reservation_state='committed',updated_at=now()
   where id=v_res.id;

  insert into public.couranr_assignment_events(
    assignment_id,delivery_id,actor_user_id,actor_type,command,
    from_state,to_state,metadata
  ) values (
    v_asg.id,v_dlv.id,null,'system','assign_delivery',
    null,'active',
    jsonb_build_object(
      'driverId',v_drv.id,'vehicleId',v_veh.id,
      'assignmentSource','automatic','dispatchReservationId',v_res.id
    )
  );

  insert into public.couranr_delivery_events(
    delivery_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_dlv.id,null,'system','assign_delivery',
    'scheduled','assigned',
    jsonb_build_object(
      'assignmentId',v_asg.id,'driverId',v_drv.id,'vehicleId',v_veh.id,
      'assignmentSource','automatic','dispatchReservationId',v_res.id
    )
  );

  perform public.couranr_resolve_automation_exception(v_dlv.request_id,'dispatch');
  return v_asg;
exception when unique_violation then
  select * into v_asg from public.couranr_delivery_assignments
   where idempotency_key=p_idempotency_key;
  if found then return v_asg; end if;
  raise;
end
$fn$;

revoke all on function public.couranr_reserve_automatic_dispatch_candidate(uuid,timestamptz)
  from public,anon,authenticated;
revoke all on function public.couranr_release_automatic_dispatch_reservation(uuid,text)
  from public,anon,authenticated;
revoke all on function public.couranr_commit_automatic_assignment(uuid,uuid,integer,text)
  from public,anon,authenticated;
grant execute on function public.couranr_reserve_automatic_dispatch_candidate(uuid,timestamptz)
  to service_role;
grant execute on function public.couranr_release_automatic_dispatch_reservation(uuid,text)
  to service_role;
grant execute on function public.couranr_commit_automatic_assignment(uuid,uuid,integer,text)
  to service_role;

commit;

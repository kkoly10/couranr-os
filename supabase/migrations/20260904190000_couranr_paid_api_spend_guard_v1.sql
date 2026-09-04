-- ============================================================================
-- Paid external API spend guard v1
--
-- Prelaunch safety rule: Couranr may NEVER rely on an unbounded paid provider
-- loop. Every real Google call must pass a server-side daily budget claim;
-- automatic route retries also carry a backoff timestamp so a 5-minute cron
-- does not mean a 5-minute Google bill.
-- ============================================================================

begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

create table if not exists public.couranr_external_api_budgets (
  api_key text primary key,
  daily_limit integer not null,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint couranr_eab_key_chk check (length(btrim(api_key)) > 0),
  constraint couranr_eab_limit_chk check (daily_limit > 0)
);

create table if not exists public.couranr_external_api_usage_daily (
  api_key text not null references public.couranr_external_api_budgets(api_key)
    on update cascade on delete restrict,
  usage_date date not null,
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key(api_key,usage_date),
  constraint couranr_eau_count_chk check (request_count >= 0)
);

-- Conservative PRELAUNCH caps. These are intentionally small and must be
-- raised by an explicit migration/owner decision, never by application code.
insert into public.couranr_external_api_budgets(api_key,daily_limit,active)
values
  ('google_routes_compute_routes',50,true),
  ('google_places_autocomplete',200,true),
  ('google_places_details',100,true)
on conflict(api_key) do nothing;

alter table public.couranr_external_api_budgets enable row level security;
alter table public.couranr_external_api_usage_daily enable row level security;
revoke all on public.couranr_external_api_budgets from public,anon,authenticated;
revoke all on public.couranr_external_api_usage_daily from public,anon,authenticated;
grant select,insert,update on public.couranr_external_api_budgets to service_role;
grant select,insert,update on public.couranr_external_api_usage_daily to service_role;

create or replace function public.couranr_claim_external_api_call(
  p_api_key text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_policy public.couranr_external_api_budgets;
  v_date date := (p_now at time zone 'America/New_York')::date;
  v_count integer;
begin
  if nullif(btrim(p_api_key),'') is null then
    raise exception 'external_api_key_required' using errcode='CR422';
  end if;

  select * into v_policy
    from public.couranr_external_api_budgets
   where api_key=p_api_key
   for update;

  if not found or not v_policy.active then
    return jsonb_build_object(
      'allowed',false,'reason','budget_disabled','apiKey',p_api_key
    );
  end if;

  perform pg_advisory_xact_lock(hashtext('couranr-paid-api:'||p_api_key||':'||v_date::text));

  insert into public.couranr_external_api_usage_daily(api_key,usage_date,request_count)
  values (p_api_key,v_date,0)
  on conflict(api_key,usage_date) do nothing;

  update public.couranr_external_api_usage_daily
     set request_count=request_count+1,
         updated_at=now()
   where api_key=p_api_key
     and usage_date=v_date
     and request_count < v_policy.daily_limit
  returning request_count into v_count;

  if v_count is null then
    select request_count into v_count
      from public.couranr_external_api_usage_daily
     where api_key=p_api_key and usage_date=v_date;
    return jsonb_build_object(
      'allowed',false,
      'reason','daily_budget_exhausted',
      'apiKey',p_api_key,
      'usageDate',v_date,
      'requestCount',coalesce(v_count,0),
      'dailyLimit',v_policy.daily_limit
    );
  end if;

  return jsonb_build_object(
    'allowed',true,
    'apiKey',p_api_key,
    'usageDate',v_date,
    'requestCount',v_count,
    'dailyLimit',v_policy.daily_limit
  );
end
$fn$;

revoke all on function public.couranr_claim_external_api_call(text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.couranr_claim_external_api_call(text,timestamptz)
  to service_role;

alter table public.couranr_service_plans
  add column if not exists next_route_recheck_at timestamptz,
  add column if not exists route_recheck_count integer not null default 0;

alter table public.couranr_service_plans
  drop constraint if exists couranr_sp_route_recheck_count_chk;
alter table public.couranr_service_plans
  add constraint couranr_sp_route_recheck_count_chk
  check (route_recheck_count >= 0);

alter table public.couranr_deliveries
  add column if not exists next_route_recheck_at timestamptz,
  add column if not exists route_recheck_count integer not null default 0;

alter table public.couranr_deliveries
  drop constraint if exists couranr_dlv_route_recheck_count_chk;
alter table public.couranr_deliveries
  add constraint couranr_dlv_route_recheck_count_chk
  check (route_recheck_count >= 0);

create or replace function public.couranr_schedule_route_recheck(
  p_service_plan_id uuid,
  p_reason text,
  p_delay_minutes integer,
  p_now timestamptz default now()
)
returns public.couranr_service_plans
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_plan public.couranr_service_plans;
begin
  if nullif(btrim(p_reason),'') is null
     or p_delay_minutes is null
     or p_delay_minutes < 5
     or p_delay_minutes > 1440 then
    raise exception 'route_recheck_schedule_invalid' using errcode='CR422';
  end if;

  update public.couranr_service_plans
     set next_route_recheck_at=p_now+make_interval(mins=>p_delay_minutes),
         route_recheck_count=route_recheck_count+1,
         updated_at=now()
   where id=p_service_plan_id
     and plan_state='confirmed'
     and plan_source='automatic'
  returning * into v_plan;

  if not found then
    raise exception 'automatic_plan_not_found' using errcode='CR404';
  end if;

  update public.couranr_deliveries
     set next_route_recheck_at=v_plan.next_route_recheck_at,
         route_recheck_count=v_plan.route_recheck_count,
         updated_at=now()
   where service_plan_id=v_plan.id;

  return v_plan;
end
$fn$;

create or replace function public.couranr_clear_route_recheck(
  p_service_plan_id uuid
)
returns public.couranr_service_plans
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_plan public.couranr_service_plans;
begin
  update public.couranr_service_plans
     set next_route_recheck_at=null,updated_at=now()
   where id=p_service_plan_id
     and plan_state='confirmed'
     and plan_source='automatic'
  returning * into v_plan;

  if not found then
    raise exception 'automatic_plan_not_found' using errcode='CR404';
  end if;

  update public.couranr_deliveries
     set next_route_recheck_at=null,updated_at=now()
   where service_plan_id=v_plan.id;

  return v_plan;
end
$fn$;

revoke all on function public.couranr_schedule_route_recheck(uuid,text,integer,timestamptz)
  from public,anon,authenticated;
revoke all on function public.couranr_clear_route_recheck(uuid)
  from public,anon,authenticated;
grant execute on function public.couranr_schedule_route_recheck(uuid,text,integer,timestamptz)
  to service_role;
grant execute on function public.couranr_clear_route_recheck(uuid)
  to service_role;

commit;

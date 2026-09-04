-- Roll back 20260904172708_couranr_paid_api_spend_guard_v1.
-- Cost-safety evidence is operational evidence. Refuse if any daily budget has
-- been consumed or a route recheck backoff has been recorded; roll forward
-- instead of erasing the spend-control history.
begin;

do $$
begin
  if exists(select 1 from public.couranr_external_api_usage_daily where request_count>0)
     or exists(select 1 from public.couranr_service_plans where route_recheck_count>0)
     or exists(select 1 from public.couranr_deliveries where route_recheck_count>0) then
    raise exception 'refusing to remove paid API spend guard evidence';
  end if;
end $$;

drop function if exists public.couranr_clear_route_recheck(uuid) restrict;
drop function if exists public.couranr_schedule_route_recheck(uuid,text,integer,timestamptz) restrict;
drop function if exists public.couranr_claim_external_api_call(text,timestamptz) restrict;

alter table public.couranr_deliveries
  drop constraint if exists couranr_dlv_route_recheck_count_chk;
alter table public.couranr_deliveries
  drop column if exists next_route_recheck_at,
  drop column if exists route_recheck_count;

alter table public.couranr_service_plans
  drop constraint if exists couranr_sp_route_recheck_count_chk;
alter table public.couranr_service_plans
  drop column if exists next_route_recheck_at,
  drop column if exists route_recheck_count;

drop table if exists public.couranr_external_api_usage_daily restrict;
drop table if exists public.couranr_external_api_budgets restrict;

commit;

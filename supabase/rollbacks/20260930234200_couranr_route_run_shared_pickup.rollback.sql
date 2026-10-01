-- Empty-schema reversal only. Once even a ready execution exists, removing
-- the transition guard would permit physical stage/order bypass.
begin;
set local lock_timeout='5s';
set local statement_timeout='90s';
lock table public.couranr_route_run_executions,
  public.couranr_deliveries in access exclusive mode;
do $$ begin
  if exists(select 1 from public.couranr_route_run_executions)
    or exists(select 1 from public.couranr_route_run_execution_events) then
    raise exception 'route_shared_pickup_rollback_refuses_semantic_use';
  end if;
end $$;
drop function public.couranr_depart_route_run_pickup(uuid,uuid);
drop function public.couranr_arrive_route_run_at_pickup(
  uuid,uuid,numeric,numeric,numeric);
drop function public.couranr_start_route_run_to_pickup(uuid,uuid);
drop function private.couranr_route_driver_execution(uuid,uuid);
drop trigger couranr_guard_route_delivery_transition
  on public.couranr_deliveries;
drop function private.couranr_guard_route_delivery_transition();
commit;

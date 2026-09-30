-- RR-003c rollback is only an empty-schema reversal. Once a Route resource
-- was reserved OR an unavailable-resource recovery was recorded, the history
-- must be retained and application compatibility/forward repair is required.
begin;
set local lock_timeout='5s';
set local statement_timeout='90s';

lock table public.couranr_route_run_resource_reservations,
  public.couranr_route_run_resource_events,
  public.couranr_route_run_settlement_events in access exclusive mode;

do $$ begin
  if exists(select 1 from public.couranr_route_run_resource_reservations)
     or exists(select 1 from public.couranr_route_run_resource_events)
     or exists(
       select 1 from public.couranr_route_run_settlement_events
       where event_type in ('resource_reserved','recovery_required')
         and (event_type='resource_reserved'
           or detail->>'reason' in ('route_resource_unavailable',
             'route_pickup_readiness_timeout','route_card_authentication_timeout',
             'route_resource_reservation_expired'))
     ) then
    raise exception 'route_resource_rollback_refuses_semantic_use';
  end if;
end $$;

drop trigger couranr_ordinary_reservation_route_resource_guard
  on public.couranr_dispatch_reservations;
drop trigger couranr_ordinary_assignment_route_resource_guard
  on public.couranr_delivery_assignments;
drop function private.couranr_guard_ordinary_resource_against_route();
drop function public.couranr_expire_route_run_checkout(uuid);
drop function public.couranr_reserve_route_run_resource(uuid,uuid,uuid,timestamptz);
drop table public.couranr_route_run_resource_events restrict;
drop table public.couranr_route_run_resource_reservations restrict;

commit;

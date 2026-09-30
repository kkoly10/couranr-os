-- Never remove Route capture authority after money/resource semantics begin.
-- An application compatibility rollback/forward repair must preserve history.
begin;
set local lock_timeout='5s';
set local statement_timeout='90s';
lock table public.couranr_route_run_settlements,
  public.couranr_route_run_resource_reservations,
  public.couranr_route_run_settlement_items,
  public.couranr_payment_obligations in access exclusive mode;
do $$ begin
  -- Removing the guards after checkout would reopen ordinary child capture or
  -- assignment even if capture has not begun yet. Refuse any Route money state.
  if exists(select 1 from public.couranr_route_run_settlements)
     or exists(select 1 from public.couranr_route_run_resource_reservations
    where resource_state='committed')
     or exists(select 1 from public.couranr_route_run_settlements
       where settlement_state in ('capture_pending','captured','ready_for_execution'))
     or exists(select 1 from public.couranr_route_run_settlement_items i
       join public.couranr_payment_obligations o on o.id=i.obligation_id
       where o.payment_state in ('capture_pending','captured')) then
    raise exception 'route_capture_gate_rollback_refuses_semantic_use';
  end if;
end $$;
drop function public.couranr_complete_route_run_funding(uuid,uuid,uuid);
drop function public.couranr_begin_route_child_capture(uuid,uuid,uuid,uuid);
drop function public.couranr_begin_route_run_capture(uuid,uuid,uuid,integer);
drop trigger couranr_route_child_capture_guard on public.couranr_payment_obligations;
drop trigger couranr_route_child_assignment_gate on public.couranr_delivery_assignments;
drop function private.couranr_guard_route_child_capture();
drop function private.couranr_block_route_child_standalone_assignment();
commit;

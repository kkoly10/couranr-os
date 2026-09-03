-- =====================================================================
-- ROLLBACK — driver exceptions, undeliverable closure and governed
-- cancellation (20260903040000)
--
-- Removes the three commands, restores the three CHECK allow-lists to
-- their prior definitions VERBATIM (couranr_pd_reason_chk from
-- 20260802030000, couranr_dlve_command_chk from 20260802040000,
-- couranr_ae_command_chk from 20260802020000) and drops the stage column.
--
-- EVIDENCE GUARDS. A drop-off exception, an undeliverable closure and a
-- cancellation are operational history about real goods and real drivers:
-- once any row carries the new vocabulary, rolling back would either
-- destroy that record (the stage column) or leave rows the restored CHECKs
-- forbid. Every guard HARD-REFUSES and requires forward repair.
-- =====================================================================

begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

do $evidence$
declare v_count bigint;
begin
  begin
    select count(*) into v_count from public.couranr_pickup_discrepancies
     where stage is distinct from 'pickup'
        or reason in ('recipient_unavailable', 'address_or_access_problem');
    if v_count > 0 then
      raise exception
        'driver_exceptions_rollback_would_destroy_exception_history: % discrepancy row(s) carry the drop-off vocabulary; forward repair required',
        v_count;
    end if;
  exception when undefined_table or undefined_column then
    null;
  end;

  begin
    select count(*) into v_count from public.couranr_delivery_events
     where command in ('report_dropoff_exception', 'close_delivery_undeliverable', 'cancel_delivery');
    if v_count > 0 then
      raise exception
        'driver_exceptions_rollback_would_orphan_delivery_events: % event(s) use the new commands and would violate the restored allow-list; forward repair required',
        v_count;
    end if;
  exception when undefined_table then
    null;
  end;

  begin
    select count(*) into v_count from public.couranr_assignment_events
     where command in ('close_delivery_undeliverable', 'cancel_delivery');
    if v_count > 0 then
      raise exception
        'driver_exceptions_rollback_would_orphan_assignment_events: % event(s) use the new commands and would violate the restored allow-list; forward repair required',
        v_count;
    end if;
  exception when undefined_table then
    null;
  end;

  begin
    -- These two states had NO writer before this migration, so any delivery
    -- sitting in one reached it through the commands being removed. The row
    -- itself survives a rollback, but the commands that explain it would not.
    select count(*) into v_count from public.couranr_deliveries
     where fulfillment_state in ('could_not_deliver', 'cancelled');
    if v_count > 0 then
      raise exception
        'driver_exceptions_rollback_would_strand_closed_deliveries: % delivery(ies) are could_not_deliver/cancelled; forward repair required',
        v_count;
    end if;
  exception when undefined_table then
    null;
  end;
end
$evidence$;

drop function if exists public.couranr_cancel_delivery(uuid, integer, uuid, text);
drop function if exists public.couranr_close_delivery_undeliverable(uuid, integer, uuid, text, text);
drop function if exists public.couranr_report_dropoff_exception(uuid, uuid, text, text);

/* Restore the reason allow-list exactly as 20260802030000 defined it. */
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.couranr_pickup_discrepancies'::regclass
       and conname  = 'couranr_pd_reason_chk'
  ) then
    alter table public.couranr_pickup_discrepancies drop constraint couranr_pd_reason_chk;
  end if;
end
$$;

alter table public.couranr_pickup_discrepancies
  add constraint couranr_pd_reason_chk
  check (reason in (
    'package_count_mismatch',
    'weight_or_size_mismatch',
    'visible_damage',
    'unsafe_packaging',
    'wrong_item',
    'vehicle_mismatch',
    'prohibited_item_concern',
    'loading_not_available',
    'other'));

alter table public.couranr_pickup_discrepancies
  drop constraint if exists couranr_pd_stage_chk;
alter table public.couranr_pickup_discrepancies
  drop column if exists stage;

/* Restore the delivery-event allow-list exactly as 20260802040000 left it. */
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.couranr_delivery_events'::regclass
       and conname  = 'couranr_dlve_command_chk'
  ) then
    alter table public.couranr_delivery_events drop constraint couranr_dlve_command_chk;
  end if;
end
$$;

alter table public.couranr_delivery_events
  add constraint couranr_dlve_command_chk
  check (command in (
    'create_delivery_from_capture',
    'assign_delivery',
    'unassign_delivery_before_pickup',
    'start_route_to_pickup',
    'arrive_at_pickup',
    'report_pickup_discrepancy',
    'resolve_pickup_discrepancy_safe_to_continue',
    'complete_pickup',
    'start_route_to_dropoff',
    'arrive_at_dropoff',
    'complete_direct_handoff_delivery',
    'complete_signature_delivery',
    'complete_leave_at_door_delivery'));

/* Restore the assignment-event allow-list exactly as 20260802020000 left it. */
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.couranr_assignment_events'::regclass
       and conname  = 'couranr_ae_command_chk'
  ) then
    alter table public.couranr_assignment_events drop constraint couranr_ae_command_chk;
  end if;
end
$$;

alter table public.couranr_assignment_events
  add constraint couranr_ae_command_chk
  check (command in (
    'assign_delivery',
    'replace_delivery_assignment',
    'unassign_delivery_before_pickup',
    'complete_assignment'));

commit;

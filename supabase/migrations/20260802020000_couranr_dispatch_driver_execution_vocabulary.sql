/*
 * Driver execution: the vocabulary the transitions need, before any of them.
 *
 * Split from the command migration deliberately. Widening a CHECK is the one
 * step that cannot be deferred: a command that writes a state or an audit
 * command its allow-list has never heard of raises 23514 and rolls back the
 * ENTIRE transaction — the state change, the audit row, the release, all of
 * it — while the SQL reads correctly and every unit test stays green. This
 * repo has shipped that exact defect twice: once on `assign_delivery`
 * (20260801210000) and once on the delivery-event allow-list before it.
 *
 * Four allow-lists move here, and all four are load-bearing:
 *
 *   1. couranr_dlv_fulfillment_chk  + at_pickup, at_dropoff
 *      The eight-value list already carried en_route_to_pickup, picked_up,
 *      in_transit and delivered; the two arrival states were never added.
 *      Exactly two values, not the six the Master Package's fourteen-state
 *      vocabulary would add — attempt_failed, return_required, returning,
 *      returned and not_scheduled belong to the exceptions and returns slices,
 *      and a state nothing can write is surface without a guarantee.
 *
 *   2. couranr_asg_state_chk        + completed
 *      A delivered assignment is NOT cancelled. Without this value the only
 *      terminal states are 'replaced' and 'cancelled', so a successful
 *      delivery would either misreport itself as cancelled or leave the
 *      assignment 'active' forever — and an active assignment pins its driver
 *      at availability_state='on_delivery', which couranr_assert_driver_mutable
 *      then refuses to move (CR409 driver_is_on_delivery). One missing enum
 *      value is the difference between a fleet that recycles and one that
 *      silently runs out of drivers.
 *
 *   3. couranr_dlve_command_chk     + every state-changing driver command
 *   4. couranr_ae_command_chk       + the two assignment-lifecycle commands
 *
 * `couranr_asg_ended_stamp_chk` is deliberately NOT touched. It reads
 * `assignment_state = 'active' or ended_at is not null`, so adding 'completed'
 * automatically requires a stamp on completion — the constraint already does
 * the right thing for the new value. It is one-directional on purpose; the
 * biconditional form makes a legal transition impossible and this repo has
 * shipped that too.
 *
 * Every change is a widening. No existing row can be invalidated by it: the
 * live values are a strict subset of every new list, verified before writing.
 * No table, column, index or row is dropped. Re-runnable.
 *
 * Naming note: the filename contains "dispatch" so that
 * tests/couranr-dispatch.test.ts picks it up — that suite builds its SQL
 * corpus from migrations whose filename includes "dispatch", so a file named
 * only "driver_execution" would silently escape the SECURITY INVOKER, empty
 * search_path and no-DELETE-grant assertions.
 */

/* ---------------------------------------------------------------- states -- */

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.couranr_deliveries'::regclass
       and conname  = 'couranr_dlv_fulfillment_chk'
  ) then
    alter table public.couranr_deliveries drop constraint couranr_dlv_fulfillment_chk;
  end if;
end
$$;

alter table public.couranr_deliveries
  add constraint couranr_dlv_fulfillment_chk
  check (fulfillment_state in (
    'scheduled',
    'assigned',
    'en_route_to_pickup',
    'at_pickup',
    'picked_up',
    'in_transit',
    'at_dropoff',
    'delivered',
    'could_not_deliver',
    'cancelled'));

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.couranr_delivery_assignments'::regclass
       and conname  = 'couranr_asg_state_chk'
  ) then
    alter table public.couranr_delivery_assignments drop constraint couranr_asg_state_chk;
  end if;
end
$$;

alter table public.couranr_delivery_assignments
  add constraint couranr_asg_state_chk
  check (assignment_state in ('active', 'completed', 'replaced', 'cancelled'));

/* -------------------------------------------------------------- commands -- */

/*
 * The delivery-event allow-list. One entry per command that MOVES a delivery,
 * plus the two that deliberately do not:
 *
 *   report_pickup_discrepancy and resolve_pickup_discrepancy_safe_to_continue
 *   leave the delivery at at_pickup (from_state = to_state). They are recorded
 *   anyway because "the driver stopped and said the shipment was wrong, and
 *   Operations cleared it" is exactly the kind of thing the timeline must show,
 *   and these tables have no UPDATE and no DELETE grant — an event not written
 *   at the time can never be added later.
 *
 * The three completion commands stay distinct rather than collapsing into one
 * `complete_delivery`: which proof path was taken is the single most important
 * fact about a completed delivery, and an audit row that does not record it
 * cannot be corrected afterwards.
 */
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
    'complete_photo_or_pin_delivery',
    'complete_signature_delivery',
    'complete_leave_at_door_delivery'));

/*
 * The assignment-event allow-list. An assignment has exactly four lifecycle
 * events: it is created, it is replaced, it is cancelled before pickup, or it
 * completes. The driver's own transitions are delivery events, not assignment
 * events — the assignment does not change while the driver drives.
 */
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

/*
 * Corrective: the fulfillment event vocabulary never learned the dispatch
 * commands.
 *
 * `couranr_dlve_command_chk` allowed exactly one value —
 * `create_delivery_from_capture` — because that was the only command that
 * wrote a delivery event when the table was created.
 * `couranr_assign_delivery` writes `assign_delivery` there, so EVERY
 * assignment failed with 23514 and rolled back the whole command: no
 * assignment row, no state change, a 500 to Operations. The unit tests were
 * green and the SQL read correctly; only running the command found it.
 *
 * Two changes, both additive in effect:
 *
 *   1. Widen the delivery-event allow-list by exactly one value. All 16
 *      existing rows are `create_delivery_from_capture` and still satisfy the
 *      new predicate, so no row is invalidated. `replace_delivery_assignment`
 *      is deliberately NOT added: replacement writes an ASSIGNMENT event and
 *      leaves the delivery in `assigned`, so it has no delivery-state
 *      transition to record and a value nothing can emit would only be a
 *      wider surface.
 *
 *   2. Give `couranr_assignment_events` the command allow-list it was missing.
 *      Its sibling has had one since it was created; without it a typo in a
 *      future command writes a silently-unrecognised audit row. The table is
 *      empty, so the constraint validates trivially.
 *
 * No table, column, index or row is dropped. Re-runnable.
 */

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.couranr_delivery_events'::regclass
       and conname  = 'couranr_dlve_command_chk'
  ) then
    alter table public.couranr_delivery_events
      drop constraint couranr_dlve_command_chk;
  end if;
end
$$;

alter table public.couranr_delivery_events
  add constraint couranr_dlve_command_chk
  check (command in ('create_delivery_from_capture', 'assign_delivery'));

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.couranr_assignment_events'::regclass
       and conname  = 'couranr_ae_command_chk'
  ) then
    alter table public.couranr_assignment_events
      add constraint couranr_ae_command_chk
      check (command in ('assign_delivery', 'replace_delivery_assignment'));
  end if;
end
$$;

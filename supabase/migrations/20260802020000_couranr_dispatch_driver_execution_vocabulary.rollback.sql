-- Rollback for 20260802020000_couranr_dispatch_driver_execution_vocabulary.
--
-- The forward migration did two different things, and this reverts them
-- differently:
--
--   * it INTRODUCED couranr_dlv_fulfillment_chk and couranr_asg_state_chk, so
--     those are dropped;
--   * it WIDENED couranr_dlve_command_chk and couranr_ae_command_chk with the
--     driver-execution commands, so those are restored verbatim to the
--     definitions 20260801210000 gave them.
--
-- ⚠ THE TWO RESTORES CAN LEGITIMATELY FAIL. If any event row was written with
-- a driver-execution command — and couranr_delivery_events holds real rows —
-- the narrower CHECK rejects it, the ALTER raises, and nothing changes. That
-- is the correct outcome: it means live history uses vocabulary the older rule
-- forbids. Do not delete rows to make this pass.
--
-- Check before running:
--   select command, count(*) from public.couranr_delivery_events group by 1;

begin;

set local statement_timeout = '60s';
set local lock_timeout = '10s';

-- Introduced by the forward migration; no prior version.
alter table public.couranr_deliveries
  drop constraint if exists couranr_dlv_fulfillment_chk;
alter table public.couranr_delivery_assignments
  drop constraint if exists couranr_asg_state_chk;

-- Restored verbatim from 20260801210000_couranr_dispatch_event_commands.
alter table public.couranr_delivery_events
  drop constraint if exists couranr_dlve_command_chk;
alter table public.couranr_delivery_events
  add constraint couranr_dlve_command_chk
  check (command in ('create_delivery_from_capture', 'assign_delivery'));

alter table public.couranr_assignment_events
  drop constraint if exists couranr_ae_command_chk;
alter table public.couranr_assignment_events
  add constraint couranr_ae_command_chk
      check (command in ('assign_delivery', 'replace_delivery_assignment'));

commit;

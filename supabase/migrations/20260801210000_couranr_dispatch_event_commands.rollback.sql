-- Rollback for 20260801210000_couranr_dispatch_event_commands.
--
-- The forward migration INTRODUCED the command vocabularies on the two event
-- tables: couranr_dlve_command_chk on couranr_delivery_events and
-- couranr_ae_command_chk on couranr_assignment_events. Neither existed before
-- it, so reverting drops them.
--
-- Dropping a CHECK cannot fail on existing data and destroys nothing. What it
-- does remove is the guarantee that an event's `command` is one of a known set
-- — after this runs, any string can be written into those columns.
--
-- couranr_delivery_events holds real production rows. Their data is untouched
-- here; only the constraint over it is removed.

begin;

set local statement_timeout = '60s';
set local lock_timeout = '10s';

alter table public.couranr_delivery_events
  drop constraint if exists couranr_dlve_command_chk;

alter table public.couranr_assignment_events
  drop constraint if exists couranr_ae_command_chk;

commit;

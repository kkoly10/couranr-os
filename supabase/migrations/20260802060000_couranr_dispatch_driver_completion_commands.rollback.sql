-- Rollback for 20260802060000_couranr_dispatch_driver_completion_commands.
--
-- Drops the functions this migration created. They did not exist before it,
-- so dropping is the true inverse. Any route or command that calls one will
-- fail after this runs — that is what reverting the migration means.

begin;

-- Dropped by catalog lookup rather than by a hardcoded signature: this handles
-- overloads and cannot drift from what was actually created.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname = any (array['couranr_complete_pickup', 'couranr_finish_delivered', 'couranr_assert_dropoff_ready', 'couranr_complete_direct_handoff_delivery', 'couranr_complete_signature_delivery', 'couranr_complete_leave_at_door_delivery', 'couranr_unassign_delivery_before_pickup', 'couranr_driver_completion_receipt'])
  loop
    execute 'drop function if exists ' || r.sig || ' cascade';
  end loop;
end $$;

commit;

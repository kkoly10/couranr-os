-- Rollback for 20260801193000_couranr_dispatch_commands.
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
       and p.proname = any (array['couranr_create_driver_profile', 'couranr_set_driver_state', 'couranr_update_driver_availability', 'couranr_create_dispatch_vehicle', 'couranr_update_dispatch_vehicle', 'couranr_assign_delivery', 'couranr_replace_delivery_assignment'])
  loop
    execute 'drop function if exists ' || r.sig || ' cascade';
  end loop;
end $$;

commit;

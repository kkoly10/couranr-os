-- Rollback for 20260802050000_couranr_dispatch_driver_execution_commands.
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
       and p.proname = any (array['couranr_driver_assignment_for', 'couranr_release_assignment_resources', 'couranr_start_route_to_pickup', 'couranr_arrive_at_pickup', 'couranr_start_route_to_dropoff', 'couranr_arrive_at_dropoff', 'couranr_issue_handoff_code', 'couranr_verify_handoff_code', 'couranr_create_proof_upload', 'couranr_finalize_proof_upload', 'couranr_report_pickup_discrepancy', 'couranr_resolve_pickup_discrepancy_safe_to_continue'])
  loop
    execute 'drop function if exists ' || r.sig || ' cascade';
  end loop;
end $$;

commit;

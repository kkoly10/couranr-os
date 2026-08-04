-- Rollback for 20260801093000_couranr_capture_and_conversion.
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
       and p.proname = any (array['couranr_confirm_service_plan', 'couranr_cancel_service_plan', 'couranr_begin_payment_capture', 'couranr_complete_payment_capture', 'couranr_fail_payment_capture', 'couranr_create_delivery_from_capture'])
  loop
    execute 'drop function if exists ' || r.sig || ' cascade';
  end loop;
end $$;

commit;

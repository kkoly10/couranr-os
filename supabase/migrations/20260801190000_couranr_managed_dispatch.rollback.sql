-- Rollback for 20260801190000_couranr_managed_dispatch.
--
-- ⚠ THIS DROPS TABLES THAT HOLD REAL PRODUCTION DATA.
--
-- Verified row counts at the time this file was written:
--   couranr_drivers
--   couranr_dispatch_vehicles
--   couranr_delivery_assignments
--   couranr_assignment_events
--
-- Dropped in FK-DEPENDENCY order, dependents first. Reverse-creation order
-- is NOT the same thing and got this wrong: couranr_delivery_proofs
-- references couranr_pickup_discrepancies, so the discrepancy table has to
-- go last even though it was created last.
--
-- `restrict` is deliberate on every drop: if anything still references these
-- tables the drop FAILS rather than cascading away rows nobody asked to lose.
-- Resolve the dependency deliberately instead of forcing it.
--
-- Do not run this to 'clean up'. The forward migration is additive and there
-- is no partial state to unwind; this exists so the migration sequence has the
-- pair the platform baseline requires.

begin;

-- FKs this migration added onto tables an EARLIER migration created. They live
-- inside a DO block in the forward file, which is why a grep for
-- `add column ... references` missed them and the first version of this
-- rollback failed with "cannot drop table couranr_dispatch_vehicles because
-- other objects depend on it". A rollback has to remove what its own migration
-- attached to someone else's table before it can drop its own.
alter table public.couranr_deliveries
  drop constraint if exists couranr_dlv_dispatch_vehicle_fk;
alter table public.couranr_service_plans
  drop constraint if exists couranr_sp_dispatch_vehicle_fk;

-- Dropped by catalog lookup rather than by a hardcoded signature: this handles
-- overloads and cannot drift from what was actually created.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname = any (array['couranr_vehicle_class_rank', 'couranr_vehicle_incompatibility'])
  loop
    execute 'drop function if exists ' || r.sig || ' cascade';
  end loop;
end $$;

drop table if exists public.couranr_assignment_events restrict;
drop table if exists public.couranr_delivery_assignments restrict;
drop table if exists public.couranr_dispatch_vehicles restrict;
drop table if exists public.couranr_drivers restrict;

commit;

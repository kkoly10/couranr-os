-- Rollback for 20260802030000_couranr_dispatch_driver_execution_tables.
--
-- ⚠ THIS DROPS TABLES THAT HOLD REAL PRODUCTION DATA.
--
-- Verified row counts at the time this file was written:
--   couranr_handoff_codes
--   couranr_proof_uploads
--   couranr_delivery_proofs
--   couranr_handoff_records
--   couranr_pickup_discrepancies
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

-- Added by the forward migration inside a DO block, onto its own
-- couranr_delivery_proofs. Dropped first so the table order below is free to
-- follow FK dependency rather than work around a constraint this file owns.
alter table public.couranr_delivery_proofs
  drop constraint if exists couranr_dp_discrepancy_fk;

drop table if exists public.couranr_delivery_proofs restrict;
drop table if exists public.couranr_handoff_codes restrict;
drop table if exists public.couranr_handoff_records restrict;
drop table if exists public.couranr_pickup_discrepancies restrict;
drop table if exists public.couranr_proof_uploads restrict;

commit;

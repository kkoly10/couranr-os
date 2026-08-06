-- Rollback for 20260801083000_couranr_service_plan_and_deliveries.
--
-- ⚠ THIS DROPS TABLES THAT HOLD REAL PRODUCTION DATA.
--
-- Verified row counts at the time this file was written:
--   couranr_service_plans
--   couranr_deliveries
--   couranr_delivery_events
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

drop table if exists public.couranr_delivery_events restrict;
drop table if exists public.couranr_deliveries restrict;
drop table if exists public.couranr_service_plans restrict;

commit;

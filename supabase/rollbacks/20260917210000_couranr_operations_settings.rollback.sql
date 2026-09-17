-- Reverts 20260917190000 — the OPS-015/OPS-016 settings state.
--
-- WHAT THIS DESTROYS. Three tables created by that migration and nothing else:
--
--   couranr_market_availability        — the per-market operational mode
--   couranr_operations_setting_events  — the APPEND-ONLY settings audit
--
-- The third one matters most. OPS-015's constraint is that sensitive changes
-- require audit, and OPS-020's is that the record is append-only. Dropping the
-- table destroys that record permanently, and no other table carries a copy of
-- it. Export it before running this if any settings change has been made:
--
--   copy (select * from public.couranr_operations_setting_events
--          order by created_at) to stdout with (format csv, header);
--
-- WHAT THIS DOES NOT TOUCH, deliberately:
--
--   couranr_capacity_policies   — pre-existed (20260904152329) and is read by
--   couranr_operating_closures    couranr_plan_service. The forward migration
--                                 created neither; a rollback that dropped
--                                 them would take automatic fulfilment with it.
--
-- RESTRICT on every drop, never CASCADE. If something now depends on one of
-- these tables, the rollback must fail with that dependency named rather than
-- silently removing it.

begin;

drop table if exists public.couranr_operations_setting_events restrict;
drop table if exists public.couranr_market_availability restrict;

commit;

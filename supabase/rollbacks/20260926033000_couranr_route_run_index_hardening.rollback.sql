-- Paired rollback for RR-001 foreign-key index hardening.
-- Indexes are performance-only; dropping them does not remove semantic Route
-- Run history. The Route Run foundation rollback still owns table removal.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

drop index if exists public.couranr_rre_actor_idx;
drop index if exists public.couranr_rre_route_idx;
drop index if exists public.couranr_rrs_quote_idx;
drop index if exists public.couranr_rrs_request_idx;
drop index if exists public.couranr_rrv_created_by_idx;
drop index if exists public.couranr_rr_current_version_idx;
drop index if exists public.couranr_rr_created_by_idx;

commit;

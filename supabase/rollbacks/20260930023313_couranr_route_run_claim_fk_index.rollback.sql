-- Index-only reversal; no commercial records are removed.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
drop index if exists public.couranr_rrc_route_version_idx;
commit;

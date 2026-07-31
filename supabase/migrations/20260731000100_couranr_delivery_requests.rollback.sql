-- =====================================================================
-- ROLLBACK for 20260731000100_couranr_delivery_requests.sql
--
-- Drops ONLY the two tables that migration created, child first because of
-- the RESTRICT foreign key. Every index, constraint, comment and grant on
-- those tables goes with them.
--
-- Touches nothing else: no existing table, column, policy, grant or row is
-- referenced here. Running this on a database where the migration was never
-- applied is a no-op.
--
-- DATA LOSS WARNING: this destroys every delivery request and every request
-- event. That is acceptable only while the tables are empty or hold nothing
-- but rehearsal fixtures. Once real merchant requests exist, prefer a forward
-- fix — there is no snapshot to restore from.
-- =====================================================================

begin;

set local statement_timeout = '60s';
set local lock_timeout = '10s';

do $$
declare n bigint;
begin
  if to_regclass('public.couranr_delivery_requests') is not null then
    execute 'select count(*) from public.couranr_delivery_requests' into n;
    raise notice 'couranr_delivery_requests rows being dropped: %', n;
  end if;
end $$;

drop table if exists public.couranr_delivery_request_events;
drop table if exists public.couranr_delivery_requests;

commit;

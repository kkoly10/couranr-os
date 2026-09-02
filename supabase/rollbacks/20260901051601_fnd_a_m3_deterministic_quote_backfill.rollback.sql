-- ROLLBACK for Gate A M3.
--
-- This is safe only before runtime quote creation. It removes only rows marked
-- legacy_backfill and clears only pointers created by this migration. Once a
-- runtime quote exists, immutable history is retained and rollback refuses.

begin;
set local statement_timeout = '300s';
set local lock_timeout = '10s';

do $guard$
begin
  if exists (select 1 from public.couranr_quote_versions where record_origin = 'runtime') then
    raise exception 'unsafe rollback: runtime quote history exists; use a forward repair';
  end if;
end
$guard$;

update public.couranr_deliveries set quote_version_id = null
 where quote_version_id in (select id from public.couranr_quote_versions where record_origin='legacy_backfill');
update public.couranr_service_plans set quote_version_id = null
 where quote_version_id in (select id from public.couranr_quote_versions where record_origin='legacy_backfill');
update public.couranr_payment_obligations set quote_version_id = null
 where quote_version_id in (select id from public.couranr_quote_versions where record_origin='legacy_backfill');
update public.couranr_delivery_requests set current_quote_version_id = null
 where current_quote_version_id in (select id from public.couranr_quote_versions where record_origin='legacy_backfill');

delete from public.couranr_quote_versions where record_origin = 'legacy_backfill';
drop function if exists private.couranr_foundation_backfill_quote_versions();

commit;

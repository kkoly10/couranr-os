-- =====================================================================
-- ROLLBACK for the merchant workspace migration.
--
-- Drops the function and the new table, function first. Touches no existing
-- table, column, policy or grant.
--
-- DATA LOSS WARNING: this destroys every merchant workspace profile. It does
-- NOT delete the `business_accounts` and `business_members` rows those
-- workspaces created — deleting a merchant's account and their membership is
-- never something a schema rollback should do silently. After running this,
-- those rows remain and must be reviewed by hand.
--
-- Rolling back also requires deleting the tracked history row:
--   delete from supabase_migrations.schema_migrations where version = '20260731061356';
-- =====================================================================

begin;

set local statement_timeout = '60s';
set local lock_timeout = '10s';

do $$
declare n bigint;
begin
  if to_regclass('public.couranr_merchant_workspaces') is not null then
    execute 'select count(*) from public.couranr_merchant_workspaces' into n;
    raise notice 'couranr_merchant_workspaces rows being dropped: %', n;
    raise notice 'their business_accounts and business_members rows are NOT removed';
  end if;
end $$;

drop function if exists public.couranr_create_merchant_workspace(
  uuid, text, text, text, text, jsonb, text, text, text
);

drop table if exists public.couranr_merchant_workspaces;

commit;

-- =====================================================================
-- ROLLBACK for the customer tracking access tokens.
--
-- Drops the three commands and the one table this migration created.
--
-- !! DATA LOSS !!
-- Dropping the table destroys every issued tracking link. That is recoverable
-- in the sense that no money and no delivery record depends on it — a link can
-- be reissued — but every URL already sent to a customer stops working, with
-- no way to tell which ones those were. The guard below refuses while any link
-- is still live so the loss is a decision rather than a discovery.
--
--   delete from supabase_migrations.schema_migrations where version = '20260804090000';
-- =====================================================================

begin;

set local statement_timeout = '120s';
set local lock_timeout = '10s';

do $guard$
declare v_n bigint;
begin
  if to_regclass('public.couranr_delivery_access_tokens') is null then
    return;
  end if;
  select count(*) into v_n
    from public.couranr_delivery_access_tokens t
   where t.revoked_at is null and t.expires_at > now();
  if v_n > 0 then
    raise exception
      'refusing to drop couranr_delivery_access_tokens: % link(s) are still live and in customers'' hands. Revoke them first with couranr_revoke_delivery_access_tokens, or export the table.', v_n;
  end if;
end
$guard$;

drop function if exists public.couranr_revoke_delivery_access_tokens(uuid, text);
drop function if exists public.couranr_redeem_delivery_access_token(text);
drop function if exists public.couranr_issue_delivery_access_token(uuid, text, integer);

drop table if exists public.couranr_delivery_access_tokens;

commit;

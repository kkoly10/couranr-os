-- =====================================================================
-- ROLLBACK for the redeem-ambiguity fix.
--
-- DO NOT RUN THIS. It restores a function that raises 42702 on EVERY call —
-- the OUT parameters shadow the column names, so redemption fails 100% of the
-- time and no customer payment link works.
--
-- It exists only so the migration has a documented inverse. If you genuinely
-- need to remove the fix, drop the function instead and revert the whole
-- payment command migration.
-- =====================================================================

begin;
do $$
begin
  raise exception
    'refusing to restore the broken couranr_redeem_payment_access_token: it raises 42702 on every call. See 20260731234500 for why.';
end
$$;
commit;

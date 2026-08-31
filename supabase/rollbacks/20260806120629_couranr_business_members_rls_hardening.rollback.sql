-- Rollback for 20260806130000_couranr_business_members_rls_hardening.
--
-- READ THIS BEFORE RUNNING IT. This rollback RESTORES A KNOWN PRIVILEGE
-- ESCALATION: it hands INSERT/UPDATE/DELETE on `business_members` back to
-- `anon` and `authenticated` and reinstates the actor-only ALL policy, which
-- together let any active manager rewrite membership rows — including
-- promoting themselves to owner and removing the real owners.
--
-- It exists because a rollback must restore the prior state exactly, not
-- because running it is ever a good idea. If the forward migration broke
-- something, the far better move is to fix that thing forward: no application
-- code path in this repository writes `business_members` or `business_accounts`
-- with anything but the service-role client, so a breakage is much more likely
-- to be a NEW caller that should be moved onto a named command.
--
-- The correlation bug in `business_accounts_update_owner_manager`
-- (bm.business_account_id = bm.id) is faithfully restored too, so the policy
-- goes back to being inert. That is what "the prior state" was.

begin;

drop policy if exists business_accounts_update_owner_manager on public.business_accounts;

create policy business_accounts_update_owner_manager
  on public.business_accounts
  for update
  using (
    exists (
      select 1
        from public.business_members bm
       where bm.business_account_id = bm.id
         and bm.user_id = auth.uid()
         and bm.status = 'active'
         and bm.role in ('owner', 'manager')
    )
    or app_is_admin()
  );

drop policy if exists business_members_manage_admin_only on public.business_members;

create policy business_members_manage_owner_manager
  on public.business_members
  for all
  using (
    exists (
      select 1
        from public.business_members bm
       where bm.business_account_id = business_members.business_account_id
         and bm.user_id = auth.uid()
         and bm.status = 'active'
         and bm.role in ('owner', 'manager')
    )
    or app_is_admin()
  )
  with check (
    exists (
      select 1
        from public.business_members bm
       where bm.business_account_id = business_members.business_account_id
         and bm.user_id = auth.uid()
         and bm.status = 'active'
         and bm.role in ('owner', 'manager')
    )
    or app_is_admin()
  );

grant insert, update, delete on public.business_members to anon, authenticated;
grant insert, update, delete on public.business_accounts to anon, authenticated;

commit;

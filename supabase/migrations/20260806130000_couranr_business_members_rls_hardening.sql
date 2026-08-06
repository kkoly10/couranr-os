-- =====================================================================
-- SECURITY HARDENING — business_members and business_accounts
--
-- *** NOT APPLIED TO PRODUCTION. Applying it is an owner-gated operation. ***
--
-- Fixes two defects MEASURED on the connected project (zrdxlrlqxdslqpnoqmus)
-- on 2026-08-06 with catalog reads only. No exploit was run against real data;
-- both findings are read from `pg_policy` and `has_table_privilege`, and both
-- are reproduced as refusal tests on the disposable stack.
--
-- ---------------------------------------------------------------------
-- FINDING 1 (P1, within-tenant privilege escalation) — business_members
-- ---------------------------------------------------------------------
--
-- Measured state:
--   has_table_privilege('authenticated','public.business_members', 'INSERT'
--                       /'UPDATE'/'DELETE')  ->  true  (also true for anon)
--   policy business_members_manage_owner_manager, cmd = ALL, roles = PUBLIC
--     using / with check:
--       exists (select 1 from business_members bm
--                where bm.business_account_id = business_members.business_account_id
--                  and bm.user_id = auth.uid()
--                  and bm.status = 'active'
--                  and bm.role in ('owner','manager'))
--       or app_is_admin()
--
-- The predicate validates only the ACTOR. It never constrains the ROW being
-- written. Combined with the table-level DML grant, any active MANAGER can,
-- straight from a browser holding the publishable anon key and their own JWT:
--
--   * insert a membership row with role 'owner' for themselves or anyone,
--   * update or delete the real owners' rows,
--
-- bypassing every named command and making the last-owner protection that
-- MER-015 requires unenforceable — the SQL guard in
-- 20260806120000_couranr_team_management.sql cannot help, because this path
-- never calls it.
--
-- `auth.uid()` is null for `anon`, so the policy does refuse anonymous
-- callers despite the grant; the reachable actor is an authenticated manager
-- of that business. That is why this is filed P1 and not P0.
--
-- ---------------------------------------------------------------------
-- FINDING 2 (latent, fails closed) — business_accounts
-- ---------------------------------------------------------------------
--
-- policy business_accounts_update_owner_manager, cmd = UPDATE:
--       exists (select 1 from business_members bm
--                where bm.business_account_id = bm.id   <-- correlation bug
--                  ...)
--
-- `bm.business_account_id` is the membership row's FK and `bm.id` is its own
-- primary key. They are different uuids, so the EXISTS is never true and the
-- policy silently reduces to `app_is_admin()`. It fails CLOSED, so nothing is
-- exposed — but the policy does not do what it says, and a future reader
-- would reasonably believe owners can update their business through it.
--
-- ---------------------------------------------------------------------
-- THE FIX, AND WHY IT BREAKS NOTHING
-- ---------------------------------------------------------------------
--
-- Every reader and writer of `business_members` in this repository uses the
-- SERVICE-ROLE client, verified by grep over app/ lib/ components/:
--   app/api/business/my-accounts/route.ts        (service-role createClient)
--   app/api/couranr/me/landing/route.ts          (supabaseAdmin)
--   app/api/couranr/me/business-accounts/route.ts(supabaseAdmin)
--   lib/couranr/requests/actor.ts                (supabaseAdmin)
--   lib/businessAccount.ts                       (client passed in; all five
--                                                 callers pass a service-role
--                                                 client)
-- `business_accounts` has no writer at all in the repository — only reads.
-- `service_role` additionally has rolbypassrls = true, so none of this
-- constrains the server commands.
--
-- Removing write access from anon and authenticated therefore removes the
-- escalation path and changes no application behaviour. SELECT is left in
-- place: it is already policy-gated to members of the business, and narrowing
-- it is a separate question from closing the escalation.
--
-- `public` is named in every revoke. A privilege held through PUBLIC is
-- inherited by every role, so a revoke that lists only anon and authenticated
-- is a silent no-op — the trap this repository has already hit once.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Remove the write grants that make the broken policy exploitable
-- ---------------------------------------------------------------------
revoke insert, update, delete on public.business_members from public, anon, authenticated;
revoke insert, update, delete on public.business_accounts from public, anon, authenticated;

-- Membership and business rows are written by named commands running as
-- service_role. Stated explicitly so a future pg_default_acl change cannot
-- leave the server without the rights it actually needs.
grant select, insert, update, delete on public.business_members to service_role;
grant select, insert, update, delete on public.business_accounts to service_role;

-- ---------------------------------------------------------------------
-- 2. Replace the actor-only ALL policy with a row-constrained one
-- ---------------------------------------------------------------------
-- Defence in depth. Even with the grants gone, the policy is left saying
-- something true rather than something misleading: reads stay member-scoped,
-- and the write path is Couranr Operations only, because every legitimate
-- merchant write now goes through a named command as service_role.
drop policy if exists business_members_manage_owner_manager on public.business_members;

create policy business_members_manage_admin_only
  on public.business_members
  for all
  using (app_is_admin())
  with check (app_is_admin());

-- ---------------------------------------------------------------------
-- 3. Correct the self-comparison in the business_accounts UPDATE policy
-- ---------------------------------------------------------------------
-- The correlation now points at the row being updated, which is what the
-- policy always meant to say. It remains inert for anon and authenticated
-- because step 1 removed their UPDATE grant; it becomes correct rather than
-- accidentally-closed.
drop policy if exists business_accounts_update_owner_manager on public.business_accounts;

create policy business_accounts_update_owner_manager
  on public.business_accounts
  for update
  using (
    exists (
      select 1
        from public.business_members bm
       where bm.business_account_id = business_accounts.id
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
       where bm.business_account_id = business_accounts.id
         and bm.user_id = auth.uid()
         and bm.status = 'active'
         and bm.role in ('owner', 'manager')
    )
    or app_is_admin()
  );

commit;

-- SEC-001 — a signed-in user can grant themselves admin by updating their own
-- `profiles.role`.
--
-- Three facts combine into a complete privilege escalation, all verified by
-- catalog query against the live project before this migration was written.
-- No exploit was run; every statement below is a read of pg_policy, pg_proc or
-- has_*_privilege.
--
--   1. `profiles_update_own` is an UPDATE policy whose `polwithcheck` IS NULL.
--      PostgreSQL substitutes the USING expression for an omitted WITH CHECK,
--      so the only thing constrained is WHICH ROW is written — `auth.uid() = id`
--      — and never WHICH COLUMNS. The row a user is allowed to edit is their
--      own, and `role` is a column of that row.
--
--   2. `authenticated` holds table-level UPDATE and column-level UPDATE on
--      `profiles.role`. Verified with has_column_privilege rather than an
--      information_schema grantee read, because grantee rows miss privileges
--      inherited through PUBLIC.
--
--   3. `public.is_admin()` is SECURITY DEFINER and its whole body is
--      `select exists (select 1 from public.profiles where id = auth.uid()
--      and role = 'admin')`. So the value a user can write in (1) is the value
--      that answers "are you an admin?".
--
-- The escalation is total rather than partial: `admin_all_profiles` is a
-- permissive policy for ALL commands with `USING public.is_admin()`, so the
-- moment a user sets their own role they also gain read and write over all 30
-- rows in the table. Every server-side admin gate in the repo resolves through
-- the same column — `lib/auth.ts` requireAdmin reads `profiles.role`, and it is
-- the only role-resolution path the codebase treats as trustworthy.
--
-- THE FIX IS THE REVOKE, NOT THE POLICY.
--
-- `service_role` has rolbypassrls = true in this project, so RLS constrains
-- none of the server commands and the GRANT is the real boundary. Removing the
-- UPDATE privilege from the browser-reachable roles is what actually closes
-- this; the explicit WITH CHECK is defence in depth for the case where some
-- future migration re-grants UPDATE without re-reading this comment.
--
-- Safe to apply against live data:
--   * No repository code writes to `profiles`. All 27 `from("profiles")` call
--     sites across lib/ and app/ are reads.
--   * There are no Edge Functions in this project (list_edge_functions -> []).
--   * The only trigger that touches `profiles` is `on_auth_user_created` ->
--     `public.handle_new_user`, which is SECURITY DEFINER owned by `postgres`.
--     It therefore does not execute with the caller's privileges and is
--     unaffected by a revoke from anon/authenticated. It also only INSERTs, and
--     INSERT is not touched here.
--   * `service_role` retains full DML, so any legitimate administrative role
--     change continues to work through a service-role path.
--
-- Deliberately NOT widened. `anon` and `authenticated` also hold INSERT and
-- DELETE on `profiles` through the same pg_default_acl pattern. Those are
-- currently denied by RLS — `anon` has no policy at all, and no permissive
-- DELETE policy exists for non-admin `authenticated` — so they are latent
-- rather than live. They are recorded as a separate finding instead of being
-- folded into a hotfix whose scope is one live escalation.

begin;

-- (1) The privilege boundary. `public` is named explicitly because a privilege
-- held through PUBLIC is invisible in information_schema grantee rows and would
-- survive a revoke that lists only the two Supabase roles.
revoke update on public.profiles from public, anon, authenticated;

-- (2) Defence in depth. Stating the WITH CHECK removes the reliance on
-- PostgreSQL's USING-substitution rule, so a reader of this policy sees the
-- write constraint spelled out rather than inferred.
alter policy profiles_update_own on public.profiles
  using (auth.uid() = id)
  with check (auth.uid() = id);

commit;

-- Rollback for SEC-001.
--
-- READ THIS BEFORE RUNNING IT. Applying this file restores a live privilege
-- escalation: it hands `anon` and `authenticated` back the UPDATE privilege on
-- `public.profiles`, and restores `profiles_update_own` to a policy with no
-- WITH CHECK. PostgreSQL then substitutes the USING expression for the missing
-- one, so the write constraint becomes `auth.uid() = id` — which pins the ROW
-- and not the COLUMNS. Any signed-in user regains the ability to set their own
-- `role` to 'admin', satisfy `public.is_admin()`, and through the ALL-command
-- `admin_all_profiles` policy reach every row in the table.
--
-- It exists because the migration sequence requires every forward migration to
-- have a paired rollback, not because reverting is a reasonable operation. If
-- something downstream broke after SEC-001, the correct response is almost
-- certainly to grant the specific missing privilege to `service_role` — which
-- already holds full DML and is untouched by the forward migration — rather
-- than to re-open the browser-reachable roles.
--
-- Why DROP and CREATE rather than ALTER: `ALTER POLICY` leaves omitted clauses
-- unchanged, so `alter policy ... using (...)` would NOT clear the WITH CHECK
-- that the forward migration added. Recreating the policy is the only way to
-- restore its original shape, in which `polwithcheck` IS NULL. The recreated
-- definition below is the one read out of pg_policy before SEC-001 was applied:
-- command UPDATE, role `authenticated`, USING (auth.uid() = id), no WITH CHECK.

begin;

grant update on public.profiles to anon, authenticated;

drop policy profiles_update_own on public.profiles;

create policy profiles_update_own on public.profiles
  for update
  to authenticated
  using (auth.uid() = id);

commit;

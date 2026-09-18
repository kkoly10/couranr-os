-- Give service_role EXECUTE on private.couranr_derive_protection_level.
--
-- THE DEFECT. 20260915090000 created the function and then wrote
--
--   revoke all on function private.couranr_derive_protection_level(integer)
--     from public, anon, authenticated, service_role;
--
-- The first three are right and stay. `service_role` was not: it is the role
-- every server command actually runs as, and TWO separate paths need this
-- function under it.
--
--   1. couranr_dr_protection_derived_chk, a CHECK constraint on
--      couranr_delivery_requests, calls it. PostgreSQL verifies EXECUTE on a
--      function named in a CHECK at DML time, and it does so REGARDLESS of
--      whether the expression would short-circuit past the call: the constraint
--      reads `protection_level is null or protection_level = ...(...)`, and a
--      row with a null level — which never reaches the function logically — is
--      refused just the same. Measured, not assumed, on a scratch table with a
--      copy of the constraint.
--
--   2. couranr_record_consumer_trust calls it directly and is SECURITY INVOKER,
--      so it carries the caller's privileges, not the owner's.
--
-- Every one of the 25 public functions that writes couranr_delivery_requests is
-- SECURITY INVOKER. So the revoke did not harden a surface, it closed the table:
-- create draft, submit, accept, decline, cancel, requote, readiness and record
-- trust all fail for the server with
-- `permission denied for function couranr_derive_protection_level`.
--
-- WHY NOTHING CAUGHT IT. The suite that owns this policy asserts exactly the
-- right thing in P2 — "the server still can, or the whole flow is bricked" —
-- over a list of `public.` command names. The function that was locked is in
-- `private`, so it was not on the list. Everything else in that suite drives the
-- database as `postgres`, a superuser, for whom no privilege is ever checked.
-- A companion assertion that DERIVES this set instead of listing it lands with
-- this migration, so the next one cannot hide the same way.
--
-- WHAT THIS DOES NOT DO. It does not reopen the function to a browser role.
-- public, anon and authenticated stay revoked, and this file restates those
-- revokes so the whole intended ACL is readable in one place rather than
-- inferred from two migrations. Re-runnable: grant and revoke are both
-- idempotent.

begin;

revoke all on function private.couranr_derive_protection_level(integer)
  from public, anon, authenticated;

grant execute on function private.couranr_derive_protection_level(integer)
  to service_role;

commit;

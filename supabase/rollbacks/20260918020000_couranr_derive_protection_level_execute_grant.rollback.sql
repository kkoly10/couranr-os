-- Roll back the service_role EXECUTE grant.
--
-- READ THIS BEFORE RUNNING IT. The state this restores is the one the forward
-- migration exists to repair: with service_role unable to execute
-- private.couranr_derive_protection_level, every write to
-- couranr_delivery_requests fails for the server, because
-- couranr_dr_protection_derived_chk names the function and PostgreSQL checks
-- EXECUTE on it at DML time. That is a total outage of the delivery-request
-- lifecycle, not a tightening.
--
-- It is written anyway because every forward migration in this repository has a
-- paired rollback, and a missing one is worse than a loud one. The browser roles
-- are left revoked either way — rolling this back removes the server's access,
-- never grants anyone else's.

begin;

revoke execute on function private.couranr_derive_protection_level(integer)
  from service_role;

commit;

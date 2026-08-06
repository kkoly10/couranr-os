-- Rollback for 20260806100000_couranr_private_and_analytics_schemas.
--
-- RESTRICT, deliberately: if either schema has acquired objects since the
-- forward migration, this rollback FAILS rather than cascading through data.
-- A populated schema being rolled back is a decision for a person, not a
-- script.

begin;

alter default privileges in schema private
  revoke select, insert, update, delete on tables from service_role;
alter default privileges in schema private
  revoke usage, select on sequences from service_role;
alter default privileges in schema private
  revoke execute on functions from service_role;

alter default privileges in schema analytics
  revoke select, insert, update, delete on tables from service_role;
alter default privileges in schema analytics
  revoke usage, select on sequences from service_role;
alter default privileges in schema analytics
  revoke execute on functions from service_role;

revoke usage on schema private from service_role;
revoke usage on schema analytics from service_role;

drop schema private restrict;
drop schema analytics restrict;

commit;

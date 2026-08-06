-- ACP-008 — the `private` and `analytics` schema boundaries.
--
-- ADDITIVE ONLY. Creates two schemas and their privilege posture; touches no
-- existing object and no data.
--
-- WHY THESE EXIST (P2-001 / platform baseline): everything in `public` is one
-- `db-schemas` entry away from PostgREST exposure, and `pg_default_acl` there
-- grants ALL on every new object to anon, authenticated AND service_role — so
-- `public` can never hold something that must be invisible to the API surface.
-- `private` is for server-only substrate (idempotency records, policy
-- registry internals, AI audit envelopes); `analytics` is for the privacy-safe
-- event store (P10-001), which must be structurally unable to hold or serve
-- client-readable rows.
--
-- MEASURED FACT this design rests on (production catalog, 2026-08-06): every
-- row in pg_default_acl is SCHEMA-SCOPED (public, storage, auth, realtime,
-- graphql*, extensions) — none global. A new schema therefore inherits no
-- default grants at all, and the explicit revokes below are stated intent and
-- defense against future default-ACL changes, not the only line of defense.
--
-- NOT EXPOSED: PostgREST serves only `db-schemas` (public). Neither schema is
-- added there, and neither ever should be.

begin;

create schema if not exists private;
create schema if not exists analytics;

comment on schema private is
  'Server-only substrate: idempotency, policy internals, AI audit. '
  'service_role only; never exposed through PostgREST. ACP-008.';
comment on schema analytics is
  'Privacy-safe event store (P10-001): no message bodies, full addresses, '
  'gate codes, phone numbers, proof URLs, raw tokens, or card data. '
  'service_role only; never exposed through PostgREST. ACP-008.';

-- The world holds nothing on these schemas. PUBLIC is named explicitly —
-- the lesson of the password-oracle defect: a revoke that skips PUBLIC can
-- leave a grant inherited through it.
revoke all on schema private from public, anon, authenticated;
revoke all on schema analytics from public, anon, authenticated;

grant usage on schema private to service_role;
grant usage on schema analytics to service_role;

-- Default privileges for objects postgres creates here: service_role gets its
-- working set; anon and authenticated get NOTHING, and no pre-existing default
-- ACL adds anything back (measured, above). Table-level append-only rules
-- belong to the tables that need them, not to the schema.
alter default privileges in schema private
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema private
  grant usage, select on sequences to service_role;
alter default privileges in schema private
  grant execute on functions to service_role;

alter default privileges in schema analytics
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema analytics
  grant usage, select on sequences to service_role;
alter default privileges in schema analytics
  grant execute on functions to service_role;

commit;

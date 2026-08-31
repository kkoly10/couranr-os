# Production schema evidence — Couranr OS

Read-only factual capture of the live Supabase database, saved here so another
engineer can independently compare production against `supabase/migrations/`.

- **Project:** `Couranr -OS`, ref `zrdxlrlqxdslqpnoqmus`, PostgreSQL 17.6.1.063, us-east-1
- **Captured:** 2026-08-31
- **Method:** Supabase MCP `execute_sql`, `SELECT` statements against the system
  catalogs only

## PRODUCTION WRITES PERFORMED: NONE

No DDL, no DML, no migration application, no grant or RLS change, no rename.
Every statement was a `SELECT` over `pg_catalog` / `information_schema` /
`supabase_migrations.schema_migrations`, plus `count(*)` for row totals.

## This pack decides nothing

It records what is in production. It does **not** say which schema is correct,
which migrations should be applied, what should be renamed, or how the two
histories should be reconciled. Where two objects have similar names they are
reported as separate objects with their own structures; no equivalence is
asserted anywhere.

## Files

| file | contents |
|---|---|
| `01_PRODUCTION_MIGRATIONS.txt` | all 50 applied migrations, ascending. `version` and `name` only — the table has no `applied_at` column, so no timestamp is recorded and none is inferred |
| `02_REPO_MIGRATIONS.txt` | all 56 `supabase/migrations/*.sql` files with version and git path |
| `03_MIGRATION_SET_DIFF.md` | A present-in-both / B production-only / C repository-only, computed on version |
| `04_PUBLIC_TABLES.sql.txt` | 34 tables: columns in ordinal order, types, nullability, defaults, identity/generated, and every constraint via `pg_get_constraintdef` (PK, UNIQUE, CHECK, FK incl. `ON UPDATE`/`ON DELETE`). Includes the 2 non-`couranr_` tables that `couranr_` foreign keys point at |
| `05_INDEXES.sql.txt` | 95 indexes, full `pg_get_indexdef`, uniqueness and partial predicates |
| `06_FUNCTIONS.sql.txt` | 116 functions, **complete** `pg_get_functiondef` output plus return type, language, volatility, security, parallel safety and `search_path` config |
| `07_TRIGGERS.sql.txt` | 4 triggers, timing, events, function and full `pg_get_triggerdef` |
| `08_RLS_POLICIES.sql.txt` | per table: `relrowsecurity`, `relforcerowsecurity`, policy count and every policy expression |
| `09_GRANTS.sql.txt` | effective privileges for `public`/`anon`/`authenticated`/`service_role`/`postgres`, raw `relacl`, function `EXECUTE`, `pg_default_acl`, schema `USAGE` |
| `10_VIEWS.sql.txt` | views referencing or named `couranr_` — none found |
| `11_TYPES.sql.txt` | enums/domains/ranges in `public`/`private` — none found |
| `12_EXTENSIONS.txt` | 6 installed extensions and versions |
| `13_COURANR_OBJECT_INVENTORY.csv` | 247 rows: tables, functions, indexes, triggers, policies, types |
| `14_DIVERGENCE_OBJECTS.md` | the 9 named objects, EXISTS / DOES NOT EXIST, searched across **every** schema |
| `15_DELIVERY_SPINE.md` | the 8 spine tables: structure, row counts, inter-spine FKs, triggers, referencing functions |
| `16_PRODUCTION_SCHEMA_DUMP_UNAVAILABLE.txt` | why no `pg_dump --schema-only` exists, and how to produce one |
| `17_FUNCTION_HASHES.csv` | sha256 of each complete function definition, for comparing bodies against repo migrations without relying on names |

## Two things a reader should know before using it

**Grants were read with `has_*_privilege`, not grantee rows.**
`information_schema.role_table_grants` does not show a privilege a role holds by
inheritance through `PUBLIC`, so it can report "no grant" for a role that in
fact has one. `09_GRANTS.sql.txt` prints the effective answer and the raw ACL
side by side. It also records `pg_default_acl`, which grants `arwdDxtm` to
`anon`, `authenticated` and `service_role` on every **new** table created in
`public` — meaning a table can hold privileges before any `GRANT` statement runs.

**`service_role` has `rolbypassrls = true`.**
RLS therefore constrains none of the server-side commands. For that role the
GRANTs, not the policies, are the access boundary. Read `08` and `09` together.

## How to verify this pack is internally consistent

Every sha256 in `17_FUNCTION_HASHES.csv` is taken over the exact
`pg_get_functiondef` output reproduced in `06_FUNCTIONS.sql.txt` — including its
trailing newline. To confirm, extract each block from `CREATE OR REPLACE
FUNCTION` up to the next 96-dash separator and hash it unmodified; all 116 match.

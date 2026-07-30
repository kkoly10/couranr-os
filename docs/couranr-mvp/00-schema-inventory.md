# 00 — Schema, RLS and function inventory

Read-only capture from Supabase project `zrdxlrlqxdslqpnoqmus` (PostgreSQL 17.6.1.063).

## Migration history

`list_migrations` → **`[]`**. **Zero migrations.** The entire live schema was applied by hand. There is no reproducible `db:reset`.

## Schemas
`public` holds all application objects. **No `private` schema, no `analytics` schema** — both required by the Master Package (`:530-532`).

## Tables — 36 in `public`; RLS status

**RLS DISABLED (4):** `addresses` (94 rows) · `delivery_admin_events` · `stripe_webhook_events` · `rental_verifications`
**RLS enabled (32)**, policy counts 1–6. **No table sets `FORCE ROW LEVEL SECURITY`.**

## Policies — 86 total across `public` and `storage`

34 reference one of the four admin/membership predicate functions. 30+ reference another RLS-protected table. **The existing policy graph contains no cycles.**

Selected defects:
- `orders."customers can update own orders"` — UPDATE, `USING (customer_id = auth.uid())`, no explicit `WITH CHECK`. Constrains only `customer_id`; every other column (incl. `payment_status`, `total_cents`, `paid_at`, `business_account_id`) is writable by the owning customer.
- `deliveries.drivers_update_own_deliveries` — same shape on `driver_id`; leaves `status` and all five fee columns writable.
- `business_accounts.business_accounts_update_owner_manager` — **uncorrelated subquery** (`bm.business_account_id = bm.id`); denies legitimate owners today.
- 9 policies target role **PUBLIC**, which includes `anon`.

## Views — 6, all SECURITY DEFINER
`docs_requests` · `docs_request_files` · `docs_request_events` · `docs_request_line_items` · `docs_request_notes` · `business_account_30d_kpis`
A SECURITY DEFINER view bypasses the caller's RLS on the underlying `doc_*` tables.

## Functions — 7, all owned by `postgres`

| Function | DEFINER | `search_path` | PUBLIC EXECUTE | Trigger uses |
|---|---|---|---|---|
| `app_is_admin()` | yes | `public` | **yes** | 0 |
| `app_is_business_member(uuid)` | yes | `public` | **yes** | 0 |
| `is_admin()` | yes | **none** | **yes** | 0 |
| `is_admin(uuid)` | yes | `public` | **yes** | 0 |
| `handle_new_user()` | yes | **none** | **yes** | 1 |
| `set_doc_request_code()` | no | none | **yes** | 1 |
| `set_updated_at()` | no | none | **yes** | 10 |

Every ACL begins `{=X/postgres,…}` — an explicit **PUBLIC** grant. `anon` and `authenticated` therefore hold EXECUTE by inheritance as well as directly.

## Triggers — 11
9 `updated_at` triggers (`doc_requests` carries **two**), `trg_set_doc_request_code`, and the `auth.users` → `handle_new_user()` trigger.

## RPC — none
`grep -rn "\.rpc("` across `app/`, `lib/`, `components/` returns zero matches.

## Enums — none. Every status field is free-text `text`.

## Realtime — `pg_publication_tables` returns no rows. No table is published.

## Grants
All 42 `public` relations grant `SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` to **both `anon` and `authenticated`**. Verified with `has_table_privilege`, not grantee rows alone. RLS is the only control; for the 4 RLS-disabled tables there is none.

`pg_default_acl` carries entries for **both `postgres` and `supabase_admin`** in `public` and `storage`, each granting `arwdDxtm` to `anon`/`authenticated` on future objects.

## Generated types — none
No `database.types.ts` or `types/` directory. Every Supabase query is untyped.

## Code/database drift
- `business_pricing_profiles` is referenced by `lib/businessPricing.ts:28-46` and defined in `docs/business-portal-schema.sql:61-73` but **does not exist in the database**. The error is swallowed at `:44-46`, so business pricing is silently inert.
- `docs/business-portal-schema.sql` documents 9 tables; the database has 36 tables + 6 views. **Documentation covers ~21%.**

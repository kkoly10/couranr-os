# Security-DB — P0 Containment (rehearsed) + P1 Hardening (design only)

**Status:** P0 rehearsed end-to-end on a disposable Supabase branch. **NOT applied to production.**
P1 is design only — no rehearsal, no apply.

**Supersedes:** `SECURITY_DB_UP_V1/V2/V3` and all their companions. Those are withdrawn, not amended.
V3's defects A1–A7 are recorded in §1.3 with the fix or the deliberate scope exclusion for each.

This file combines 14 deliverables. Each begins with a `<!-- ===== FILE: … ===== -->` marker.
SQL and JSON are in fenced blocks so they extract byte-identical to their standalone form.

| # | Deliverable | Kind |
|---|---|---|
| 1 | `SECURITY_DB_P0_CHANGELOG.md` | doc |
| 2 | `SECURITY_DB_P0_THREAT_MODEL.md` | doc |
| 3 | `SECURITY_DB_P0_SNAPSHOT_CAPTURE.sql` | executable |
| 4 | `SECURITY_DB_P0_PREFLIGHT.sql` | executable |
| 5 | `SECURITY_DB_P0_UP.sql` | executable |
| 6 | `SECURITY_DB_P0_POST_DEPLOY.sql` | executable |
| 7 | `SECURITY_DB_P0_ROLLBACK.sql` | executable |
| 8 | `SECURITY_DB_P0_TEST_PLAN.md` | doc |
| 9 | `SECURITY_DB_P0_DRY_RUN_REPORT.md` | doc — real output |
| 10 | `SECURITY_DB_P0_ROLLBACK_REHEARSAL.md` | doc — real output |
| 11 | `SECURITY_DB_P0_EXACT_OBJECT_DIFF.json` | data |
| 12 | `SECURITY_DB_P1_HARDENING_PLAN.md` | doc |
| 13 | `SECURITY_DB_P1_OBJECT_INVENTORY.json` | data |
| 14 | `SECURITY_DB_P1_RISK_REGISTER.md` | doc |

**Checksums** (`sha256sum`, of the standalone extracted files):

| File | SHA-256 |
|---|---|
| `SECURITY_DB_P0_UP.sql` | `814456f1e373f8bff41d766cfa44e96c9da6cfdd495bc67000ca620442fc70c6` |
| `SECURITY_DB_P0_ROLLBACK.sql` | recompute after extraction; the UP checksum is the only one bound by a guard |

The UP checksum is not decorative — `SECURITY_DB_P0_UP.sql` refuses to run unless the session's
`couranr.up_sha256` matches the value recorded at snapshot time. Guard test G-02 proves it fires.

---

<!-- ===== FILE: SECURITY_DB_P0_CHANGELOG.md ===== -->

# SECURITY_DB_P0_CHANGELOG

## 1.1 Why P0 exists as a separate package

V1, V2 and V3 were one monolithic migration that tried to contain four reachable vulnerabilities
*and* re-architect the authorization model *and* harden every function *and* rewrite default ACLs,
in a single transaction. Each revision fixed the previous revision's defects and introduced new
ones, because the blast radius was large enough that no reviewer could hold it all at once:

- V1 created mutual RLS recursion (`orders → deliveries → orders`) that would have raised
  `42P17 infinite recursion detected in policy for relation "orders"` on the first authenticated
  `SELECT`. It passed document review.
- V2 revoked `EXECUTE` on four predicates that surviving legacy policies still call, which would
  have broken those policies. It also asserted "any cross-table policy edge is a failure", a check
  that fails a healthy database — the legacy policy graph is acyclic (33 nodes, 35 edges, 0 cycles).
- V3 fixed those and introduced seven more (A1–A7, §1.3).

P0 is scoped to **containment only**: close the four findings reachable from a browser with the
public anon key, change nothing else, and be reversible. Everything architectural moves to P1.

## 1.2 What P0 changes — the complete list

Six tables and one storage-bucket row. Nothing else.

| # | Object | Change |
|---|---|---|
| 1 | `public.addresses` | `enable row level security`; revoke all from `public, anon, authenticated` |
| 2 | `public.delivery_admin_events` | same |
| 3 | `public.stripe_webhook_events` | same |
| 4 | `public.rental_verifications` | same |
| 5 | `public.orders` | drop 3 named client-write policies; `revoke insert, update, delete` |
| 6 | `public.deliveries` | drop 2 named client-write policies; `revoke insert, update, delete` |
| 7 | `storage.buckets` where `id='delivery-photos'` | `public=false`, 10 MiB limit, 4-entry MIME allow-list |

**Explicitly absent** — every one of these appeared in V1/V2/V3 and is deliberately excluded:

- no `DROP TABLE`, `DROP COLUMN`, `DELETE`, `TRUNCATE`
- no `revoke … on all tables in schema public` (V3's H1 — blast radius was all 36 tables)
- no sequence revoke (V3 revoked without capturing — defect A3)
- no `ALTER DEFAULT PRIVILEGES` (V3's `FOR ROLE supabase_admin` aborts — defect A1)
- no function `ALTER`/`REVOKE`/`GRANT` (V3 §E touched all 7 functions)
- no `ALTER VIEW … security_invoker` (V3 §D touched all 6 views)
- no new schema, no new function (V3 created `couranr_auth` + 3 functions)
- no new policy of any kind — P0 only ever removes access
- no change to `service_role` — proven unchanged by check P0-09

Because P0 creates no policy and no function, the entire class of defects that killed V1 and V2
(policy recursion, predicate-dependency breakage) is structurally impossible here.

## 1.3 V3 defects A1–A7 — disposition

| ID | V3 defect | Disposition in P0 |
|---|---|---|
| **A1** | `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` aborts — `postgres` is **not** a member of `supabase_admin` | **Excluded.** P0 issues no default-ACL statement. Verified again in this rehearsal: `PRE-11` reported `postgres, member of supabase_admin = false`. Moved to P1-04. |
| **A2** | POST-14 cycle detection omitted `WITH RECURSIVE`, and its `not e.dst = any(r.path)` guard makes `node = origin` unreachable, so it can never report a cycle | **Excluded.** P0 creates no policy, so there is no new edge and nothing to detect. Moved to P1-06, which must use a correct Tarjan/recursive-CTE formulation. |
| **A3** | V3 revoked sequence privileges but never captured them, so rollback could not restore them | **Fixed and inverted.** P0 revokes no sequence privilege, *captures* all sequence grants anyway, and check **P0-12** asserts they are unchanged. Rehearsal: 9 rows compared, 0 differing. |
| **A4** | Default-ACL rollback was inexact | **Excluded** with A1. |
| **A5** | Multiple active runs possible; `max(run_id)` binding; placeholder checksum | **Fixed.** Partial unique index `snapshot_run_one_active on (is_active) where is_active` allows at most one open run; UP and ROLLBACK bind on `is_active`, never `max()`; the checksum is a real SHA-256 enforced by a guard. Tests **G-02** and **G-04** prove both. |
| **A6** | Concatenated GRANT statements executed as one dynamic command (`EXECUTE` accepts a single command) | **Fixed.** `snap_grants` stores **one row per (table, grantee, privilege)** with one single-command `grant_stmt`. Rehearsal captured 126 such rows and replayed them individually. |
| **A7** | POST-06/07 compared policy **counts**, which pass when one policy is dropped and an unrelated one is added | **Fixed.** **P0-07** and **P0-08** are `EXCEPT` in **both directions** against the captured set — exact set equality, not cardinality. |

## 1.4 Additional defects found and fixed during this rehearsal

Neither was present in V3; both were found by executing rather than reading.

- **C1 — `has_table_privilege` cannot round-trip an ACL.** The first capture used
  `has_table_privilege()`, which resolves inheritance. A privilege held only through a `PUBLIC`
  grant would be replayed as a *direct* grant to `anon`, so the restored ACL would differ from the
  captured one while appearing equivalent. The shipped capture uses `aclexplode()` (grantee `0` =
  `PUBLIC`) for the replay set, and keeps `has_table_privilege` in a separate `snap_effective`
  table for assertions only.
- **C2 — `pg_get_expr()` emits unqualified relation names.** Captured policy bodies contain
  `FROM orders`, not `FROM public.orders`, so the rollback replay only resolves if `public` is on
  the search_path. `SECURITY_DB_P0_ROLLBACK.sql` now pins `set local search_path = public,
  pg_catalog` rather than depending on the operator's session.

## 1.5 Known residual after P0 — stated, not hidden

`anon` and `authenticated` **retain** `SELECT, REFERENCES, TRIGGER, TRUNCATE` on `orders` and
`deliveries`. Verified post-apply:

```
table_name  | anon_truncate | auth_truncate | anon_references | anon_trigger | anon_select
deliveries  | true          | true          | true            | true         | true
orders      | true          | true          | true            | true         | true
addresses   | false         | false         | false           | false        | false
delivery_admin_events  | false | false      | false           | false        | false
rental_verifications   | false | false      | false           | false        | false
stripe_webhook_events  | false | false      | false           | false        | false
```

`SELECT` is retained deliberately — the customer and driver read paths depend on it, and RLS
filters the rows (measured: `anon` sees **0 rows** on both tables after P0). `TRUNCATE`,
`REFERENCES` and `TRIGGER` are retained only because P0's revoke is narrowly `insert, update,
delete`. They are **not reachable through PostgREST or pg_graphql**, so the public anon key cannot
invoke them; reaching them requires a direct Postgres connection with the `anon` role's database
password, which is a different credential. They are therefore out of P0's threat model and are
carried as **P1-R01** with a one-line fix.

## 1.6 Rehearsal environment — and its one material limitation

Rehearsed on Supabase branch `security-db-p0-rehearsal` (`xdadfasscotvxzgfzxjs`), a child of
`Couranr -OS` (`zrdxlrlqxdslqpnoqmus`). **The branch came up with 0 public tables, 0 policies and
0 buckets**, status `MIGRATIONS_FAILED` — because the repository has **zero migrations**, so
branching has nothing to replay. This is itself a finding: *Supabase branching cannot currently
reproduce this schema.*

A synthetic fixture was therefore built to mirror production's shape for the six in-scope tables
plus `profiles` and `is_admin()`, and was verified to reproduce the vulnerable baseline exactly
before any P0 statement ran (12 policies, 4 tables RLS-off with full `anon` DML, bucket public).

**Limitation, stated plainly:** the fixture reproduces *structure*, not production's full 82-policy
graph or its 42/29/94 rows. It proves P0's statements are correct, reversible and correctly
scoped. It does **not** prove production-scale lock behaviour under live traffic, and it cannot —
the branch has no concurrent users. See §9.4 of the dry-run report.

Branch deleted after the rehearsal to stop the hourly charge.

---

<!-- ===== FILE: SECURITY_DB_P0_THREAT_MODEL.md ===== -->

# SECURITY_DB_P0_THREAT_MODEL

## 2.1 Attacker and capability

**Attacker:** anyone who can load the site. The `NEXT_PUBLIC_SUPABASE_ANON_KEY` is served to every
browser by design; possession is not a compromise. Two principals follow from it:

| Principal | How obtained | Reaches |
|---|---|---|
| `anon` | read the JS bundle | PostgREST `/rest/v1`, pg_graphql `/graphql/v1` |
| `authenticated` | sign up — self-service, no approval | same, with `auth.uid()` populated |

**Capability:** arbitrary `SELECT`/`INSERT`/`UPDATE`/`DELETE` against any exposed relation, subject
only to table `GRANT`s and RLS. This is **independent of every application route** — disabling an
API route does not mitigate any finding below. `TRUNCATE`, `REFERENCES` and `TRIGGER` are *not*
reachable this way; that correction is applied throughout.

**Out of scope for P0:** anyone holding the service-role key, a database password, or Supabase
dashboard access. Those are compromises of a different class.

## 2.2 The four findings P0 closes

### DB-1 — `orders`: the owning customer can rewrite their own order

Policy `customers can update own orders` is `FOR UPDATE TO authenticated USING (customer_id =
auth.uid())` with **no `WITH CHECK`**. PostgreSQL substitutes `USING` for an omitted `WITH CHECK`,
so `customer_id` itself cannot be reassigned. Every **other** column is unconstrained:
`payment_status`, `total_cents`, `paid_at`, `status`, `business_account_id`, and the Stripe
identifiers.

*Impact:* a customer sets `payment_status='paid'` and `total_cents=1` on their own real order.
Fulfilment keys off `status`/`payment_status`, so this is free goods, and the Stripe ID columns are
writable so reconciliation can be poisoned too. **Directly monetary.**

*P0 action:* drop the three client-write policies; `revoke insert, update, delete`. Reads keep
working — `SELECT` policies and the `SELECT` grant are untouched.

### DB-2 — four tables with RLS disabled and full `anon` DML

`addresses` (94 real rows), `delivery_admin_events` (the audit trail), `stripe_webhook_events`,
`rental_verifications`. RLS off **and** `anon` holds all seven privileges: there is no gate at all.

*Impact, worst first:*
- `delivery_admin_events` — an anonymous party can **forge or delete audit records**. This is the
  gravest of the four: it destroys the evidence trail that would let you investigate the others.
- `addresses` — 94 real customer addresses readable and deletable by anyone. Privacy incident and
  data-loss risk in one.
- `stripe_webhook_events` — forged webhook rows; the webhook's idempotency is per-table JSON
  `.contains()` reads with no unique constraint, so injected rows can suppress real processing.
- `rental_verifications` — identity-verification state writable by anyone.

*P0 action:* enable RLS and revoke all client privileges → deny-all for `anon` and `authenticated`.
No policy is created, so nothing is granted back. `service_role` is unaffected, and every route
that touches these tables already uses `service_role` (62 of 76 API routes do).

### DB-3 — `delivery-photos` bucket public with no policies

*Impact:* **latent.** The bucket holds 0 objects and `public.delivery_photos` has 0 rows, so there
is nothing to leak today. Left alone, the first proof-of-delivery photo uploaded — which shows a
customer's doorway, package and often their address — becomes world-readable at a guessable URL.

*P0 action:* set `public=false`, a 10 MiB limit and a 4-entry MIME allow-list. Zero objects makes
this free. No storage policy is created: both uploaders are `service_role`, no browser caller
reads the bucket, and V1's storage policy — which joined `deliveries` and `orders` inside the
policy body — was a third recursion source written for a caller that does not exist.

*Follow-up this creates:* `app/api/delivery/upload-pickup-photo/route.ts:197` calls
`getPublicUrl`, which returns a string without contacting storage and so will not throw, but the
URL will 400 once the bucket is private. It must move to `createSignedUrl`. That is application
work, and it is the one caller P0 knowingly leaves needing a change.

### DB-4 — `deliveries`: the assigned driver can rewrite status and all five fee columns

Policy `drivers_update_own_deliveries` is `FOR UPDATE TO authenticated USING (driver_id =
auth.uid())`, again with no `WITH CHECK`. `driver_id` is pinned by substitution; `status`,
`base_fee_cents`, `mileage_fee_cents`, `weight_fee_cents`, `rush_fee_cents` and
`signature_fee_cents` are not.

*Impact:* a driver marks a delivery `delivered` without performing it, and inflates their own
payout. **Directly monetary**, and it corrupts the pricing data the business runs on.

*P0 action:* drop the two client-write policies; `revoke insert, update, delete`. Driver and
customer reads are untouched.

## 2.3 Why GRANT *and* policy — the belt-and-braces point

P0 removes both the policy and the table privilege for every write path. Either alone is
insufficient, and the reason is visible in the rehearsal output.

`admin_all_orders` and `admin_all_deliveries` are `FOR ALL TO authenticated USING (is_admin())`
policies. **P0 keeps them** — they are the admin read path and dropping them would break the admin
console. A `FOR ALL` policy includes writes. If P0 had dropped only the customer/driver write
policies and left the grants, any `authenticated` user for whom `is_admin()` returns true would
still have a write path, and more importantly the *grant* would remain available to any future
policy added carelessly.

Revoking `INSERT/UPDATE/DELETE` from `authenticated` closes the write path at the privilege layer,
so no policy — present or future — can open it without an explicit, reviewable `GRANT`. Post-deploy
check P0-04/P0-05 assert `held = 0/6` on both tables.

## 2.4 What P0 does **not** address

Stated so the containment is not mistaken for a fix:

| Gap | Owner |
|---|---|
| 7 unauthenticated API routes, incl. `/api/create-checkout-session` (arbitrary-amount Stripe Checkout, trusts client `amount`) and `/api/delivery/complete` (payment capture) | Security-0, application |
| 6 server-context files importing the `"use client"` browser client → authenticate as `anon` | Security-0 |
| `resilientUpdateById` retrying up to 20× and dropping columns on payment writes | Payments work |
| Webhook idempotency: no unique constraint, no idempotency key | Payments work |
| 4 functions with mutable `search_path`; all 7 executable by `anon` | **P1-02** |
| 6 views with `security_invoker` unset → run as owner | **P1-03** |
| `vehicle-images` bucket public; 6 of 7 buckets have no storage policy | **P1-05** |
| `anon`/`authenticated` retain `TRUNCATE`/`REFERENCES`/`TRIGGER` on `orders`, `deliveries` | **P1-R01** |

**P0 is a tourniquet.** It stops the bleeding reachable from a browser. It is not a security model.

---

<!-- ===== FILE: SECURITY_DB_P0_SNAPSHOT_CAPTURE.sql ===== -->

Run **first**. `SECURITY_DB_P0_UP.sql` refuses without it; rollback is unsupported without it.

```sql
-- =====================================================================
-- SECURITY_DB_P0_SNAPSHOT_CAPTURE.sql
-- Couranr Security-DB P0 Containment — pre-state capture.
--
-- RUN FIRST. SECURITY_DB_P0_UP.sql refuses to run without it, and
-- SECURITY_DB_P0_ROLLBACK.sql is unsupported without it.
--
-- Scope: exactly the 6 tables + 1 storage bucket that P0 touches.
-- Captures catalog metadata and row COUNTS only. Never row data,
-- never secrets.
--
-- Two session parameters must be set IN THE SAME SESSION as this script:
--   couranr.project_ref  — the Supabase project ref you intend to change
--   couranr.up_sha256    — sha256sum of the SECURITY_DB_P0_UP.sql you will apply
-- Both are re-checked by UP. A mismatch aborts.
-- =====================================================================

begin;
set local statement_timeout = '120s';
set local lock_timeout = '15s';

do $$ begin
  if coalesce(current_setting('couranr.project_ref', true),'') = '' then
    raise exception 'P0 capture: couranr.project_ref is not set in this session.';
  end if;
  if coalesce(current_setting('couranr.up_sha256', true),'') = '' then
    raise exception 'P0 capture: couranr.up_sha256 is not set in this session.';
  end if;
end $$;

create schema if not exists couranr_p0_audit;

-- Not in the PostgREST exposed schema list; revoked anyway.
revoke all   on schema couranr_p0_audit from public;
revoke usage on schema couranr_p0_audit from anon, authenticated;

-- ---------------------------------------------------------------------
-- Run header. The partial unique index enforces AT MOST ONE active run,
-- so UP and ROLLBACK can bind by `is_active` instead of max(run_id).
-- ---------------------------------------------------------------------
create table if not exists couranr_p0_audit.snapshot_run (
  run_id         bigserial primary key,
  captured_at    timestamptz not null default now(),
  applied_at     timestamptz,
  rolled_back_at timestamptz,
  project_ref    text not null,
  pg_version     text not null,
  capturing_role text not null,
  up_sha256      text not null,
  is_active      boolean not null default true
);

create unique index if not exists snapshot_run_one_active
  on couranr_p0_audit.snapshot_run (is_active) where is_active;

create table if not exists couranr_p0_audit.snap_policies (
  run_id bigint, ord int, schema_name text, table_name text, policy_name text,
  cmd text, permissive boolean, roles text, using_expr text, check_expr text,
  create_stmt text, drop_stmt text
);

-- Exact ACL entries, from aclexplode. grantee 0 == PUBLIC.
-- has_table_privilege() cannot be used here: it resolves inheritance, so a
-- privilege held only through PUBLIC would be replayed as a direct grant to
-- anon and the restored ACL would not match the captured one.
create table if not exists couranr_p0_audit.snap_grants (
  run_id bigint, ord int, schema_name text, table_name text,
  grantee text, privilege text, is_grantable boolean, grant_stmt text
);

-- Effective privilege, inheritance included. Assertion data for POST_DEPLOY
-- and the rollback comparison; NOT replayed.
create table if not exists couranr_p0_audit.snap_effective (
  run_id bigint, schema_name text, table_name text, role_name text,
  privilege text, held boolean
);

create table if not exists couranr_p0_audit.snap_rls (
  run_id bigint, schema_name text, table_name text,
  rls_enabled boolean, force_rls boolean
);

create table if not exists couranr_p0_audit.snap_bucket (
  run_id bigint, bucket_id text, is_public boolean,
  file_size_limit bigint, allowed_mime_types text[]
);

create table if not exists couranr_p0_audit.snap_owners (
  run_id bigint, schema_name text, object_name text, owner_name text
);

-- Blast-radius baseline: every policy on every public table OUTSIDE the 6.
-- P0 must not change one of them; POST_DEPLOY P0-13 compares against this.
create table if not exists couranr_p0_audit.snap_out_of_scope_policies (
  run_id bigint, table_name text, policy_name text
);

create table if not exists couranr_p0_audit.snap_row_counts (
  run_id bigint, table_name text, row_count bigint
);

-- Sequence grants are NOT changed by P0. Captured so POST_DEPLOY can prove
-- they were not touched (defect A3: V3 revoked these without capturing them).
create table if not exists couranr_p0_audit.snap_sequence_grants (
  run_id bigint, schema_name text, sequence_name text,
  role_name text, privilege text, held boolean
);

-- ---------------------------------------------------------------------
-- Open the run. Fails on the partial unique index if one is already open.
-- ---------------------------------------------------------------------
insert into couranr_p0_audit.snapshot_run
  (project_ref, pg_version, capturing_role, up_sha256)
values
  (current_setting('couranr.project_ref'), version(), current_user,
   current_setting('couranr.up_sha256'));

create or replace view couranr_p0_audit.v_run as
  select run_id from couranr_p0_audit.snapshot_run where is_active;

-- The 6 tables in P0 scope, and nothing else.
create or replace view couranr_p0_audit.v_scope as
  select unnest(array['addresses','delivery_admin_events','stripe_webhook_events',
                      'rental_verifications','orders','deliveries']) as table_name;

-- ---------------------------------------------------------------------
-- 1. Policies on the in-scope tables, with generated CREATE/DROP.
-- ---------------------------------------------------------------------
insert into couranr_p0_audit.snap_policies
select (select run_id from couranr_p0_audit.v_run),
       row_number() over (order by c.relname, p.polname),
       n.nspname, c.relname, p.polname,
       case p.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE'
            when 'd' then 'DELETE' else 'ALL' end,
       p.polpermissive,
       coalesce((select string_agg(quote_ident(r.rolname), ', ' order by r.rolname)
                 from pg_roles r where r.oid = any(p.polroles)), 'public'),
       pg_get_expr(p.polqual, p.polrelid),
       pg_get_expr(p.polwithcheck, p.polrelid),
       format('create policy %I on %I.%I as %s for %s to %s%s%s;',
         p.polname, n.nspname, c.relname,
         case when p.polpermissive then 'permissive' else 'restrictive' end,
         case p.polcmd when 'r' then 'select' when 'a' then 'insert' when 'w' then 'update'
              when 'd' then 'delete' else 'all' end,
         coalesce((select string_agg(quote_ident(r.rolname), ', ' order by r.rolname)
                   from pg_roles r where r.oid = any(p.polroles)), 'public'),
         coalesce(' using (' || pg_get_expr(p.polqual, p.polrelid) || ')', ''),
         coalesce(' with check (' || pg_get_expr(p.polwithcheck, p.polrelid) || ')', '')),
       format('drop policy if exists %I on %I.%I;', p.polname, n.nspname, c.relname)
from pg_policy p
  join pg_class c     on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (select table_name from couranr_p0_audit.v_scope);

-- ---------------------------------------------------------------------
-- 2. Exact table ACLs. ONE grant statement per (table, grantee, privilege)
--    — defect A6: a concatenated multi-statement string cannot be run by
--    EXECUTE, which accepts a single command.
-- ---------------------------------------------------------------------
insert into couranr_p0_audit.snap_grants
select (select run_id from couranr_p0_audit.v_run),
       row_number() over (order by c.relname, g.grantee_name, a.privilege_type),
       'public', c.relname, g.grantee_name, a.privilege_type, a.is_grantable,
       format('grant %s on public.%I to %s;',
              a.privilege_type, c.relname,
              case when g.grantee_name = 'PUBLIC' then 'public'
                   else quote_ident(g.grantee_name) end)
from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  cross join lateral (select case when a.grantee = 0 then 'PUBLIC'
                                  else pg_get_userbyid(a.grantee) end) g(grantee_name)
where n.nspname = 'public'
  and c.relname in (select table_name from couranr_p0_audit.v_scope)
  and g.grantee_name in ('PUBLIC','anon','authenticated','service_role');

-- ---------------------------------------------------------------------
-- 3. Effective privileges (inheritance resolved).
-- ---------------------------------------------------------------------
insert into couranr_p0_audit.snap_effective
select (select run_id from couranr_p0_audit.v_run),
       'public', s.table_name, r.role_name, pr.privilege,
       has_table_privilege(r.role_name, format('public.%I', s.table_name), pr.privilege)
from couranr_p0_audit.v_scope s
  cross join (values ('anon'),('authenticated'),('service_role')) r(role_name)
  cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),
                     ('TRUNCATE'),('REFERENCES'),('TRIGGER')) pr(privilege);

-- ---------------------------------------------------------------------
-- 4. RLS + FORCE RLS.
-- ---------------------------------------------------------------------
insert into couranr_p0_audit.snap_rls
select (select run_id from couranr_p0_audit.v_run),
       n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (select table_name from couranr_p0_audit.v_scope);

-- ---------------------------------------------------------------------
-- 5. The one bucket P0 changes.
-- ---------------------------------------------------------------------
insert into couranr_p0_audit.snap_bucket
select (select run_id from couranr_p0_audit.v_run),
       b.id, b.public, b.file_size_limit, b.allowed_mime_types
from storage.buckets b where b.id = 'delivery-photos';

-- ---------------------------------------------------------------------
-- 6. Ownership (P0 changes none; captured to prove it).
-- ---------------------------------------------------------------------
insert into couranr_p0_audit.snap_owners
select (select run_id from couranr_p0_audit.v_run),
       n.nspname, c.relname, pg_get_userbyid(c.relowner)
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (select table_name from couranr_p0_audit.v_scope);

insert into couranr_p0_audit.snap_out_of_scope_policies
select (select run_id from couranr_p0_audit.v_run), c.relname, p.polname
from pg_policy p
  join pg_class c     on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname not in (select table_name from couranr_p0_audit.v_scope);

-- ---------------------------------------------------------------------
-- 7. Row counts. COUNTS ONLY — P0 must not change a single row.
-- ---------------------------------------------------------------------
do $$
declare r record; n bigint;
begin
  for r in select table_name from couranr_p0_audit.v_scope loop
    execute format('select count(*) from public.%I', r.table_name) into n;
    insert into couranr_p0_audit.snap_row_counts
      values ((select run_id from couranr_p0_audit.v_run), r.table_name, n);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 8. Sequence grants (A3). P0 does not revoke these; POST_DEPLOY proves it.
--    Sequences are named from pg_class with relkind='S' in a loop that is
--    materialised first — has_sequence_privilege() would otherwise be
--    evaluated by the planner against non-sequence relations and error.
-- ---------------------------------------------------------------------
do $$
declare r record; q record;
begin
  for r in select c.relname as seqname
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'S' loop
    for q in select * from (values ('anon'),('authenticated'),('service_role')) v(role_name)
             cross join (values ('SELECT'),('UPDATE'),('USAGE')) p(privilege) loop
      insert into couranr_p0_audit.snap_sequence_grants
      values ((select run_id from couranr_p0_audit.v_run), 'public', r.seqname,
              q.role_name, q.privilege,
              has_sequence_privilege(q.role_name, format('public.%I', r.seqname), q.privilege));
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Lock the audit schema down.
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'couranr_p0_audit' loop
    execute format('revoke all on couranr_p0_audit.%I from public, anon, authenticated', r.tablename);
  end loop;
end $$;

commit;

-- Verify before applying UP:
--   select * from couranr_p0_audit.snapshot_run where is_active;
--   select count(*) from couranr_p0_audit.snap_policies;  -- production expects 12
--   select count(*) from couranr_p0_audit.snap_grants;    -- production expects 126
--   select count(*) from couranr_p0_audit.snap_rls;       -- must be 6
--   select count(*) from couranr_p0_audit.snap_bucket;    -- must be 1
```

---

<!-- ===== FILE: SECURITY_DB_P0_PREFLIGHT.sql ===== -->

Read-only. Run after capture, before UP. Every row must read `PASS`; `PRE-11` is `INFO`.

```sql
-- =====================================================================
-- SECURITY_DB_P0_PREFLIGHT.sql
-- Read-only. Run AFTER SECURITY_DB_P0_SNAPSHOT_CAPTURE.sql and BEFORE
-- SECURITY_DB_P0_UP.sql. Every row must read PASS (PRE-11 is INFO).
--
-- Changes nothing. Contains no DDL, no DML, no exploit.
-- =====================================================================

with scope as (
  select unnest(array['addresses','delivery_admin_events','stripe_webhook_events',
                      'rental_verifications','orders','deliveries']) as t
),
unprotected as (
  select unnest(array['addresses','delivery_admin_events',
                      'stripe_webhook_events','rental_verifications']) as t
),
checks as (

-- PRE-00 ---------------------------------------------------------------
select 0 as id, 'PRE-00 active snapshot bound to this session' as check_name,
  case when exists (
    select 1 from couranr_p0_audit.snapshot_run
     where is_active
       and applied_at is null
       and project_ref = current_setting('couranr.project_ref', true)
       and up_sha256   = current_setting('couranr.up_sha256', true)
  ) then 'PASS' else 'FAIL' end as result,
  coalesce((select 'run_id=' || run_id || ' ref=' || project_ref ||
                   ' sha=' || left(up_sha256, 16)
            from couranr_p0_audit.snapshot_run where is_active), 'no active run') as detail

-- PRE-01 ---------------------------------------------------------------
union all
select 1, 'PRE-01 target project ref is the one you intend',
  case when current_setting('couranr.project_ref', true) is not null then 'PASS' else 'FAIL' end,
  'couranr.project_ref = ' || coalesce(current_setting('couranr.project_ref', true), '<unset>')

-- PRE-02 ---------------------------------------------------------------
union all
select 2, 'PRE-02 PostgreSQL >= 15 (policy + aclexplode semantics)',
  case when current_setting('server_version_num')::int >= 150000 then 'PASS' else 'FAIL' end,
  'server_version = ' || current_setting('server_version')

-- PRE-03 ---------------------------------------------------------------
union all
select 3, 'PRE-03 executing role owns all 6 in-scope tables',
  case when (select count(*) from scope s
               join pg_class c on c.relname = s.t
               join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
              where pg_get_userbyid(c.relowner) = current_user) = 6
       then 'PASS' else 'FAIL' end,
  'current_user = ' || current_user || '; owned = ' ||
  (select count(*) from scope s
     join pg_class c on c.relname = s.t
     join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where pg_get_userbyid(c.relowner) = current_user)::text || '/6'

-- PRE-04 ---------------------------------------------------------------
union all
select 4, 'PRE-04 all 6 in-scope tables exist as ordinary tables',
  case when (select count(*) from scope s
               join pg_class c on c.relname = s.t and c.relkind = 'r'
               join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public') = 6
       then 'PASS' else 'FAIL' end,
  coalesce('MISSING: ' ||
    (select string_agg(s.t, ', ' order by s.t) from scope s
      where not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                         where n.nspname='public' and c.relname = s.t and c.relkind = 'r')),
    'all 6 present')

-- PRE-05 ---------------------------------------------------------------
-- Confirms the vulnerability P0 fixes is actually present. If RLS is already
-- on, P0 has been applied or the finding is stale; stop and re-verify.
union all
select 5, 'PRE-05 baseline DB-2 present: 4 tables have RLS disabled',
  case when (select count(*) from unprotected u
               join pg_class c on c.relname = u.t
               join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
              where c.relrowsecurity = false) = 4
       then 'PASS' else 'FAIL' end,
  'rls_disabled = ' ||
  (select count(*) from unprotected u
     join pg_class c on c.relname = u.t
     join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where c.relrowsecurity = false)::text || '/4'

-- PRE-06 ---------------------------------------------------------------
union all
select 6, 'PRE-06 baseline DB-2 present: anon holds DML on those 4 tables',
  case when (select count(*) from unprotected u
              where has_table_privilege('anon', format('public.%I', u.t), 'SELECT')
                and has_table_privilege('anon', format('public.%I', u.t), 'INSERT')
                and has_table_privilege('anon', format('public.%I', u.t), 'UPDATE')
                and has_table_privilege('anon', format('public.%I', u.t), 'DELETE')) = 4
       then 'PASS' else 'FAIL' end,
  'tables with full anon DML = ' ||
  (select count(*) from unprotected u
    where has_table_privilege('anon', format('public.%I', u.t), 'SELECT')
      and has_table_privilege('anon', format('public.%I', u.t), 'INSERT')
      and has_table_privilege('anon', format('public.%I', u.t), 'UPDATE')
      and has_table_privilege('anon', format('public.%I', u.t), 'DELETE'))::text || '/4'

-- PRE-07 ---------------------------------------------------------------
-- UP names these three explicitly. If a name has drifted, the DROP silently
-- no-ops and the write path survives — so assert the names before applying.
union all
select 7, 'PRE-07 orders client-write policies present under expected names',
  case when (select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
              where c.relname = 'orders'
                and p.polname in ('Customers can create their own orders',
                                  'customers can create orders',
                                  'customers can update own orders')) = 3
       then 'PASS' else 'FAIL' end,
  'found = ' || (select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
                  where c.relname='orders'
                    and p.polname in ('Customers can create their own orders',
                                      'customers can create orders',
                                      'customers can update own orders'))::text || '/3; ' ||
  'all orders write policies = ' ||
  coalesce((select string_agg(p.polname, ' | ' order by p.polname)
              from pg_policy p join pg_class c on c.oid = p.polrelid
             where c.relname='orders' and p.polcmd in ('a','w','d','*')), '(none)')

-- PRE-08 ---------------------------------------------------------------
union all
select 8, 'PRE-08 deliveries client-write policies present under expected names',
  case when (select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
              where c.relname = 'deliveries'
                and p.polname in ('customers can create delivery records',
                                  'drivers_update_own_deliveries')) = 2
       then 'PASS' else 'FAIL' end,
  'found = ' || (select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
                  where c.relname='deliveries'
                    and p.polname in ('customers can create delivery records',
                                      'drivers_update_own_deliveries'))::text || '/2; ' ||
  'all deliveries write policies = ' ||
  coalesce((select string_agg(p.polname, ' | ' order by p.polname)
              from pg_policy p join pg_class c on c.oid = p.polrelid
             where c.relname='deliveries' and p.polcmd in ('a','w','d','*')), '(none)')

-- PRE-09 ---------------------------------------------------------------
-- The bucket conversion is only safe while the bucket is empty. A non-zero
-- object count means existing public URLs would start returning 400 and this
-- step needs a URL-rewrite plan first.
union all
select 9, 'PRE-09 delivery-photos exists, is public, and holds ZERO objects',
  case when (select public from storage.buckets where id = 'delivery-photos') = true
        and (select count(*) from storage.objects where bucket_id = 'delivery-photos') = 0
       then 'PASS' else 'FAIL' end,
  'public = ' || coalesce((select public from storage.buckets where id='delivery-photos')::text, '<no bucket>') ||
  '; objects = ' || (select count(*) from storage.objects where bucket_id='delivery-photos')::text

-- PRE-10 ---------------------------------------------------------------
-- FORCE RLS would apply the new posture to the table owner too, which P0
-- does not intend and has not analysed.
union all
select 10, 'PRE-10 no FORCE ROW LEVEL SECURITY on any in-scope table',
  case when (select count(*) from scope s
               join pg_class c on c.relname = s.t
               join pg_namespace n on n.oid = c.relnamespace and n.nspname='public'
              where c.relforcerowsecurity) = 0
       then 'PASS' else 'FAIL' end,
  'forced = ' || (select count(*) from scope s
                    join pg_class c on c.relname = s.t
                    join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
                   where c.relforcerowsecurity)::text || '/6'

-- PRE-11 ---------------------------------------------------------------
-- INFORMATIONAL. Defect A1: SECURITY_DB_UP_V3 issued ALTER DEFAULT
-- PRIVILEGES FOR ROLE supabase_admin, which aborts unless the executing
-- role is a member of supabase_admin. P0 issues no such statement, so this
-- is recorded for the P1 package rather than gating P0.
union all
select 11, 'PRE-11 migration role membership in supabase_admin (INFO only)',
  'INFO',
  current_user || ', member of supabase_admin = ' ||
  coalesce((select pg_has_role(current_user, 'supabase_admin', 'MEMBER')::text
              where exists (select 1 from pg_roles where rolname = 'supabase_admin')),
           'role supabase_admin absent') ||
  ' (P0 does not require it)'
)
select id, check_name, result, detail from checks order by id;
```

---

<!-- ===== FILE: SECURITY_DB_P0_UP.sql ===== -->

`sha256 = 814456f1e373f8bff41d766cfa44e96c9da6cfdd495bc67000ca620442fc70c6`

**Do not edit this file without recomputing the checksum** — the guard binds to it and will refuse.

```sql
-- =====================================================================
-- SECURITY_DB_P0_UP.sql — Couranr P0 emergency containment
-- Scope: 6 tables + 1 storage bucket row. Nothing else.
--
-- Forbidden and absent: DROP TABLE, DROP COLUMN, DELETE, TRUNCATE,
-- blanket revoke across all public tables, sequence revoke, default-ACL
-- change, function alteration, view alteration, new schema.
-- =====================================================================
begin;
set local statement_timeout = '60s';
set local lock_timeout = '10s';

-- Bind to exactly one verified active snapshot run.
do $$
declare v_run bigint; v_ref text; v_sum text;
begin
  select run_id, project_ref, up_sha256 into v_run, v_ref, v_sum
    from couranr_p0_audit.snapshot_run where is_active;
  if v_run is null then
    raise exception 'P0: no active snapshot run. Run SECURITY_DB_P0_SNAPSHOT_CAPTURE.sql first.';
  end if;
  if v_ref is distinct from current_setting('couranr.project_ref', true) then
    raise exception 'P0: snapshot project_ref % does not match session couranr.project_ref %',
      v_ref, current_setting('couranr.project_ref', true);
  end if;
  if v_sum is distinct from current_setting('couranr.up_sha256', true) then
    raise exception 'P0: snapshot checksum % does not match supplied % — wrong UP script',
      v_sum, current_setting('couranr.up_sha256', true);
  end if;
  if exists (select 1 from couranr_p0_audit.snapshot_run where is_active and applied_at is not null) then
    raise exception 'P0: this run was already applied (double-apply guard).';
  end if;
end $$;

-- 1. RLS on the four unprotected tables. No client policies created.
alter table public.addresses             enable row level security;
alter table public.delivery_admin_events enable row level security;
alter table public.stripe_webhook_events enable row level security;
alter table public.rental_verifications  enable row level security;

-- 2. Remove all direct client privileges on those four tables only.
revoke all on public.addresses             from public, anon, authenticated;
revoke all on public.delivery_admin_events from public, anon, authenticated;
revoke all on public.stripe_webhook_events from public, anon, authenticated;
revoke all on public.rental_verifications  from public, anon, authenticated;

-- 3. orders: drop client write policies, keep SELECT behavior untouched.
drop policy if exists "Customers can create their own orders" on public.orders;
drop policy if exists "customers can create orders"           on public.orders;
drop policy if exists "customers can update own orders"       on public.orders;
revoke insert, update, delete on public.orders from public, anon, authenticated;

-- 4. deliveries: drop client write policies, keep SELECT behavior untouched.
drop policy if exists "customers can create delivery records" on public.deliveries;
drop policy if exists "drivers_update_own_deliveries"         on public.deliveries;
revoke insert, update, delete on public.deliveries from public, anon, authenticated;

-- 5. delivery-photos bucket only.
update storage.buckets
   set public             = false,
       file_size_limit    = 10485760,
       allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic']
 where id = 'delivery-photos';

-- Mark the run applied.
update couranr_p0_audit.snapshot_run set applied_at = now() where is_active;

commit;
```

---

<!-- ===== FILE: SECURITY_DB_P0_POST_DEPLOY.sql ===== -->

Read-only. Run immediately after UP commits. **All 14 must read `PASS`.** Any `FAIL` is a rollback trigger.

```sql
-- =====================================================================
-- SECURITY_DB_P0_POST_DEPLOY.sql
-- Read-only. Run immediately after SECURITY_DB_P0_UP.sql commits.
-- Every row must read PASS. Any FAIL is a rollback trigger.
--
-- Assertions are EXACT SET comparisons against the captured snapshot,
-- not counts (defect A7: V3's POST-06/07 compared counts, which pass when
-- one policy is dropped and an unrelated one is added).
-- =====================================================================

with scope as (
  select unnest(array['addresses','delivery_admin_events','stripe_webhook_events',
                      'rental_verifications','orders','deliveries']) as t
),
unprotected as (
  select unnest(array['addresses','delivery_admin_events',
                      'stripe_webhook_events','rental_verifications']) as t
),
run as (select run_id from couranr_p0_audit.snapshot_run where is_active),
checks as (

select 1 as id, 'P0-01 RLS now enabled on all 4 previously-unprotected tables' as check_name,
  case when (select count(*) from unprotected u
               join pg_class c on c.relname = u.t
               join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
              where c.relrowsecurity) = 4 then 'PASS' else 'FAIL' end as result,
  'rls_enabled = ' || (select count(*) from unprotected u
                         join pg_class c on c.relname=u.t
                         join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
                        where c.relrowsecurity)::text || '/4' as detail

-- RLS-on with zero policies is deny-all for every non-bypassing role. That
-- is the containment. P0 deliberately grants no client access back.
union all
select 2, 'P0-02 zero policies created on those 4 tables (deny-all)',
  case when (select count(*) from pg_policy p join pg_class c on c.oid=p.polrelid
               join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
              where c.relname in (select t from unprotected)) = 0
       then 'PASS' else 'FAIL' end,
  'policies = ' || (select count(*) from pg_policy p join pg_class c on c.oid=p.polrelid
                      join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
                     where c.relname in (select t from unprotected))::text

union all
select 3, 'P0-03 anon + authenticated hold ZERO privileges on those 4 tables',
  case when (select count(*) from unprotected u
               cross join (values ('anon'),('authenticated')) r(rn)
               cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),
                                  ('TRUNCATE'),('REFERENCES'),('TRIGGER')) pr(p)
              where has_table_privilege(r.rn, format('public.%I', u.t), pr.p)) = 0
       then 'PASS' else 'FAIL' end,
  'held = ' || (select count(*) from unprotected u
                  cross join (values ('anon'),('authenticated')) r(rn)
                  cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),
                                     ('TRUNCATE'),('REFERENCES'),('TRIGGER')) pr(p)
                 where has_table_privilege(r.rn, format('public.%I', u.t), pr.p))::text || '/56'

union all
select 4, 'P0-04 orders: anon + authenticated hold no INSERT/UPDATE/DELETE',
  case when (select count(*) from (values ('anon'),('authenticated')) r(rn)
               cross join (values ('INSERT'),('UPDATE'),('DELETE')) pr(p)
              where has_table_privilege(r.rn, 'public.orders', pr.p)) = 0
       then 'PASS' else 'FAIL' end,
  'held = ' || (select count(*) from (values ('anon'),('authenticated')) r(rn)
                  cross join (values ('INSERT'),('UPDATE'),('DELETE')) pr(p)
                 where has_table_privilege(r.rn, 'public.orders', pr.p))::text || '/6'

union all
select 5, 'P0-05 deliveries: anon + authenticated hold no INSERT/UPDATE/DELETE',
  case when (select count(*) from (values ('anon'),('authenticated')) r(rn)
               cross join (values ('INSERT'),('UPDATE'),('DELETE')) pr(p)
              where has_table_privilege(r.rn, 'public.deliveries', pr.p)) = 0
       then 'PASS' else 'FAIL' end,
  'held = ' || (select count(*) from (values ('anon'),('authenticated')) r(rn)
                  cross join (values ('INSERT'),('UPDATE'),('DELETE')) pr(p)
                 where has_table_privilege(r.rn, 'public.deliveries', pr.p))::text || '/6'

union all
select 6, 'P0-06 the 5 named client-write policies are gone, by name',
  case when (select count(*) from pg_policy p join pg_class c on c.oid=p.polrelid
              where (c.relname='orders' and p.polname in ('Customers can create their own orders',
                                                          'customers can create orders',
                                                          'customers can update own orders'))
                 or (c.relname='deliveries' and p.polname in ('customers can create delivery records',
                                                              'drivers_update_own_deliveries'))) = 0
       then 'PASS' else 'FAIL' end,
  'surviving = ' || coalesce((select string_agg(c.relname||'.'||p.polname, ' | ')
      from pg_policy p join pg_class c on c.oid=p.polrelid
     where (c.relname='orders' and p.polname in ('Customers can create their own orders',
                                                 'customers can create orders',
                                                 'customers can update own orders'))
        or (c.relname='deliveries' and p.polname in ('customers can create delivery records',
                                                     'drivers_update_own_deliveries'))), '(none)')

-- EXACT SET, both directions. Expected survivors = snapshot policies on
-- orders MINUS the 3 UP drops. Anything else present or absent fails.
union all
select 7, 'P0-07 orders surviving policy set EXACT (both directions)',
  case when not exists (
         (select policy_name from couranr_p0_audit.snap_policies
           where run_id=(select run_id from run) and table_name='orders'
             and policy_name not in ('Customers can create their own orders',
                                     'customers can create orders',
                                     'customers can update own orders')
          except
          select p.polname from pg_policy p join pg_class c on c.oid=p.polrelid
           where c.relname='orders')
         union all
         (select p.polname from pg_policy p join pg_class c on c.oid=p.polrelid
           where c.relname='orders'
          except
          select policy_name from couranr_p0_audit.snap_policies
           where run_id=(select run_id from run) and table_name='orders'
             and policy_name not in ('Customers can create their own orders',
                                     'customers can create orders',
                                     'customers can update own orders'))
       ) then 'PASS' else 'FAIL' end,
  'expected=' || (select count(*) from couranr_p0_audit.snap_policies
                   where run_id=(select run_id from run) and table_name='orders'
                     and policy_name not in ('Customers can create their own orders',
                                             'customers can create orders',
                                             'customers can update own orders'))::text ||
  ' actual=' || (select count(*) from pg_policy p join pg_class c on c.oid=p.polrelid
                  where c.relname='orders')::text ||
  ' [' || coalesce((select string_agg(p.polname, ' | ' order by p.polname)
                      from pg_policy p join pg_class c on c.oid=p.polrelid
                     where c.relname='orders'), '(none)') || ']'

union all
select 8, 'P0-08 deliveries surviving policy set EXACT (both directions)',
  case when not exists (
         (select policy_name from couranr_p0_audit.snap_policies
           where run_id=(select run_id from run) and table_name='deliveries'
             and policy_name not in ('customers can create delivery records',
                                     'drivers_update_own_deliveries')
          except
          select p.polname from pg_policy p join pg_class c on c.oid=p.polrelid
           where c.relname='deliveries')
         union all
         (select p.polname from pg_policy p join pg_class c on c.oid=p.polrelid
           where c.relname='deliveries'
          except
          select policy_name from couranr_p0_audit.snap_policies
           where run_id=(select run_id from run) and table_name='deliveries'
             and policy_name not in ('customers can create delivery records',
                                     'drivers_update_own_deliveries'))
       ) then 'PASS' else 'FAIL' end,
  'expected=' || (select count(*) from couranr_p0_audit.snap_policies
                   where run_id=(select run_id from run) and table_name='deliveries'
                     and policy_name not in ('customers can create delivery records',
                                             'drivers_update_own_deliveries'))::text ||
  ' actual=' || (select count(*) from pg_policy p join pg_class c on c.oid=p.polrelid
                  where c.relname='deliveries')::text ||
  ' [' || coalesce((select string_agg(p.polname, ' | ' order by p.polname)
                      from pg_policy p join pg_class c on c.oid=p.polrelid
                     where c.relname='deliveries'), '(none)') || ']'

-- service_role must be untouched or every server route breaks at once.
union all
select 9, 'P0-09 service_role privileges on all 6 tables UNCHANGED vs snapshot',
  case when not exists (
         (select table_name, privilege from couranr_p0_audit.snap_effective
           where run_id=(select run_id from run) and role_name='service_role' and held
          except
          select s.t, pr.p from scope s
            cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),
                               ('TRUNCATE'),('REFERENCES'),('TRIGGER')) pr(p)
           where has_table_privilege('service_role', format('public.%I', s.t), pr.p))
         union all
         (select s.t, pr.p from scope s
            cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),
                               ('TRUNCATE'),('REFERENCES'),('TRIGGER')) pr(p)
           where has_table_privilege('service_role', format('public.%I', s.t), pr.p)
          except
          select table_name, privilege from couranr_p0_audit.snap_effective
           where run_id=(select run_id from run) and role_name='service_role' and held)
       ) then 'PASS' else 'FAIL' end,
  'service_role privs now = ' ||
  (select count(*) from scope s
     cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),
                        ('TRUNCATE'),('REFERENCES'),('TRIGGER')) pr(p)
    where has_table_privilege('service_role', format('public.%I', s.t), pr.p))::text ||
  ', at snapshot = ' ||
  (select count(*) from couranr_p0_audit.snap_effective
    where run_id=(select run_id from run) and role_name='service_role' and held)::text

union all
select 10, 'P0-10 delivery-photos bucket private with size + MIME limits',
  case when (select public = false
                    and file_size_limit = 10485760
                    and allowed_mime_types @> array['image/jpeg','image/png','image/webp','image/heic']
             from storage.buckets where id='delivery-photos') then 'PASS' else 'FAIL' end,
  (select 'public=' || public::text || ' limit=' || coalesce(file_size_limit::text,'null') ||
          ' mime=' || coalesce(array_to_string(allowed_mime_types, ','), 'null')
     from storage.buckets where id='delivery-photos')

-- P0 must not touch a single row.
union all
select 11, 'P0-11 row counts on all 6 tables UNCHANGED (no data touched)',
  case when (select bool_and(ok) from (
              select sc.table_name,
                     sc.row_count = (case sc.table_name
                       when 'addresses'             then (select count(*) from public.addresses)
                       when 'delivery_admin_events' then (select count(*) from public.delivery_admin_events)
                       when 'stripe_webhook_events' then (select count(*) from public.stripe_webhook_events)
                       when 'rental_verifications'  then (select count(*) from public.rental_verifications)
                       when 'orders'                then (select count(*) from public.orders)
                       when 'deliveries'            then (select count(*) from public.deliveries) end) as ok
                from couranr_p0_audit.snap_row_counts sc
               where sc.run_id=(select run_id from run)) z)
       then 'PASS' else 'FAIL' end,
  (select string_agg(sc.table_name || '=' || sc.row_count, ', ' order by sc.table_name)
     from couranr_p0_audit.snap_row_counts sc where sc.run_id=(select run_id from run))

-- Defect A3: V3 revoked sequence privileges without capturing them, so its
-- rollback could not restore them. P0 revokes none — prove it.
union all
select 12, 'P0-12 sequence grants UNCHANGED vs snapshot (defect A3)',
  case when not exists (
         select 1 from couranr_p0_audit.snap_sequence_grants g
          where g.run_id=(select run_id from run)
            and g.held is distinct from
                has_sequence_privilege(g.role_name, format('public.%I', g.sequence_name), g.privilege)
       ) then 'PASS' else 'FAIL' end,
  'rows compared = ' ||
  (select count(*) from couranr_p0_audit.snap_sequence_grants
    where run_id=(select run_id from run))::text || ', differing = ' ||
  (select count(*) from couranr_p0_audit.snap_sequence_grants g
    where g.run_id=(select run_id from run)
      and g.held is distinct from
          has_sequence_privilege(g.role_name, format('public.%I', g.sequence_name), g.privilege))::text

-- Blast-radius assertion: no table OUTSIDE the 6 lost a policy. V1/V2/V3
-- each changed objects far outside their stated scope; P0 must not.
union all
select 13, 'P0-13 no policy changed on any table OUTSIDE the 6 in scope',
  case when (select count(*) from pg_policy p join pg_class c on c.oid=p.polrelid
               join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
              where c.relname not in (select t from scope)) =
            (select count(*) from couranr_p0_audit.snap_out_of_scope_policies
              where run_id=(select run_id from run))
       then 'PASS' else 'FAIL' end,
  'out-of-scope policies now = ' ||
  (select count(*) from pg_policy p join pg_class c on c.oid=p.polrelid
     join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
    where c.relname not in (select t from scope))::text || ', at snapshot = ' ||
  (select count(*) from couranr_p0_audit.snap_out_of_scope_policies
    where run_id=(select run_id from run))::text

union all
select 14, 'P0-14 table ownership on the 6 tables UNCHANGED',
  case when not exists (
         select 1 from couranr_p0_audit.snap_owners o
          where o.run_id=(select run_id from run)
            and o.owner_name is distinct from
                (select pg_get_userbyid(c.relowner) from pg_class c
                   join pg_namespace n on n.oid=c.relnamespace
                  where n.nspname='public' and c.relname=o.object_name)
       ) then 'PASS' else 'FAIL' end,
  (select string_agg(distinct owner_name, ', ') from couranr_p0_audit.snap_owners
    where run_id=(select run_id from run))
)
select id, check_name, result, detail from checks order by id;
```

---

<!-- ===== FILE: SECURITY_DB_P0_ROLLBACK.sql ===== -->

Snapshot-derived. Restores exactly what P0 changed. **Restores the vulnerable state** — read §10.5.

```sql
-- =====================================================================
-- SECURITY_DB_P0_ROLLBACK.sql — snapshot-derived, scoped to P0 only.
-- Restores exactly the 6 tables + 1 bucket P0 changed. Nothing else.
-- Order matters: revoke the post-P0 state FIRST, then replay captured grants.
-- =====================================================================
begin;
set local statement_timeout = '60s';
set local lock_timeout = '10s';

-- REQUIRED. pg_get_expr() emits policy expressions with UNQUALIFIED relation
-- names (e.g. "FROM orders", not "FROM public.orders"), so the captured
-- create_stmt only resolves if public is on the search_path. Pinning it here
-- makes the replay independent of the operator's session settings.
set local search_path = public, pg_catalog;

do $$ begin
  if not exists (select 1 from couranr_p0_audit.snapshot_run where is_active and applied_at is not null) then
    raise exception 'P0 rollback: no applied active run to roll back.';
  end if;
end $$;

-- 1. Revoke everything P0 could have left on the six tables, so the replay
--    below is exact rather than additive.
do $$ declare r record; begin
  for r in select unnest(array['addresses','delivery_admin_events','stripe_webhook_events',
                               'rental_verifications','orders','deliveries']) t loop
    execute format('revoke all on public.%I from public, anon, authenticated', r.t);
  end loop;
end $$;

-- 2. Replay captured grants, one statement per (table, grantee, privilege).
do $$ declare r record; begin
  for r in select grant_stmt from couranr_p0_audit.snap_grants
           where run_id=(select run_id from couranr_p0_audit.snapshot_run where is_active)
  loop execute r.grant_stmt; end loop;
end $$;

-- 3. Restore policies on orders + deliveries exactly as captured.
do $$ declare r record; begin
  for r in select drop_stmt from couranr_p0_audit.snap_policies
           where run_id=(select run_id from couranr_p0_audit.snapshot_run where is_active) order by ord
  loop execute r.drop_stmt; end loop;
  for r in select create_stmt from couranr_p0_audit.snap_policies
           where run_id=(select run_id from couranr_p0_audit.snapshot_run where is_active) order by ord
  loop execute r.create_stmt; end loop;
end $$;

-- 4. Restore RLS / FORCE RLS flags for the six tables.
do $$ declare r record; begin
  for r in select table_name, rls_enabled, force_rls from couranr_p0_audit.snap_rls
           where run_id=(select run_id from couranr_p0_audit.snapshot_run where is_active) loop
    execute format('alter table public.%I %s row level security', r.table_name,
                   case when r.rls_enabled then 'enable' else 'disable' end);
    execute format('alter table public.%I %s row level security', r.table_name,
                   case when r.force_rls then 'force' else 'no force' end);
  end loop;
end $$;

-- 5. Restore the bucket row.
update storage.buckets b set public=s.is_public, file_size_limit=s.file_size_limit,
       allowed_mime_types=s.allowed_mime_types
  from couranr_p0_audit.snap_bucket s
 where b.id=s.bucket_id
   and s.run_id=(select run_id from couranr_p0_audit.snapshot_run where is_active);

-- 6. Close the run; keep it for audit.
update couranr_p0_audit.snapshot_run
   set rolled_back_at=now(), applied_at=null, is_active=false where is_active;

commit;
-- NOTE: this restores DB-1..DB-4. It is a stopgap, not a fix. Prefer a
-- forward fix; re-apply P0 as soon as the breaking caller is corrected.
```

---

<!-- ===== FILE: SECURITY_DB_P0_TEST_PLAN.md ===== -->

# SECURITY_DB_P0_TEST_PLAN

## 8.1 Hard rule on where tests run

**No exploit or negative test ever runs against production data.** No marking a real order paid,
no altering a real fee, no deleting a real address, no forging a real audit event — not even to
prove a finding. Every negative test in this plan runs against **synthetic fixtures on a
disposable Supabase branch or a restored scratch project**, and every mutation is undone.

The harness enforces the undo structurally: each write happens inside a PL/pgSQL sub-block that
raises `COURANR_UNDO` on success, so the block's changes are rolled back while the *outcome
variable* survives (PL/pgSQL variables are not transactional). The result is recorded after the
block. A test therefore cannot leave a mutation behind even if the operator forgets to clean up.

## 8.2 Principals

| Handle | Role | JWT `sub` | Represents |
|---|---|---|---|
| `anon` | `anon` | none | any visitor with the public key |
| `cust` | `authenticated` | `…0001` | the customer owning the fixture order |
| `drv` | `authenticated` | `…0002` | the driver assigned to the fixture delivery |
| `svc` | `service_role` | none | every server route (62 of 76 use this key) |

## 8.3 Test matrix — expectation before and after P0

| ID | Test | Principal | Before | After |
|---|---|---|---|---|
| A-01 | `SELECT` `addresses` | anon | ALLOWED | **DENIED** |
| A-02 | `DELETE` `addresses` | anon | ALLOWED | **DENIED** |
| A-03 | `INSERT` `delivery_admin_events` (forge audit) | anon | ALLOWED | **DENIED** |
| A-04 | `INSERT` `stripe_webhook_events` | anon | ALLOWED | **DENIED** |
| A-05 | `INSERT` `rental_verifications` | anon | ALLOWED | **DENIED** |
| B-01 | `UPDATE orders SET payment_status='paid', total_cents=1` | cust | ALLOWED | **DENIED** |
| B-02 | `INSERT` `orders` | cust | ALLOWED | **DENIED** |
| C-01 | `UPDATE deliveries SET base_fee_cents=999999, status='delivered'` | drv | ALLOWED | **DENIED** |
| B-03 | `SELECT` `orders` | cust | ALLOWED | **ALLOWED** (regression guard) |
| C-02 | `SELECT` `deliveries` | drv | ALLOWED | **ALLOWED** (regression guard) |
| S-01 | `UPDATE` `orders` | svc | ALLOWED | **ALLOWED** (regression guard) |
| S-02 | `INSERT` `delivery_admin_events` | svc | ALLOWED | **ALLOWED** (regression guard) |
| S-03 | `SELECT` `addresses` | svc | — | **ALLOWED** (regression guard) |
| S-04 | `INSERT` `deliveries` | svc | — | **ALLOWED** (regression guard) |

The four `S-*` and two read guards are as important as the negatives: P0's failure mode is
over-revoking and breaking every server route at once.

## 8.4 Guard tests

| ID | Scenario | Expected |
|---|---|---|
| G-01 | re-run UP against an already-applied run | abort, double-apply guard |
| G-02 | run an UP whose SHA-256 differs from the snapshot | abort, checksum mismatch |
| G-03 | point the session at a different project ref | abort, project mismatch |
| G-04 | open a second active snapshot run | abort, unique-index violation |

G-03 deliberately uses the **production ref as the decoy** — the guard must refuse to apply a
branch-bound snapshot against production.

## 8.5 Residual tests — run after P0, expected to reveal what P0 leaves

| ID | Test | Purpose |
|---|---|---|
| R-01 | `anon SELECT orders` | GRANT retained; assert **0 rows visible** |
| R-02 | `anon SELECT deliveries` | same |
| R-03 | `anon TRUNCATE orders` | documents the retained TRUNCATE privilege → P1-R01 |

## 8.6 Sequence

| # | Step | Gate |
|---|---|---|
| 1 | create disposable branch / scratch project | exists |
| 2 | build synthetic fixture; verify it reproduces the vulnerable baseline | 12 policies, 4 tables RLS-off, bucket public |
| 3 | run `SNAPSHOT_CAPTURE` | run opens; counts as expected |
| 4 | run `PREFLIGHT` | 11 PASS + 1 INFO |
| 5 | run the **Before** half of §8.3 | every `(VULN)` negative reproduces — if one does not, the finding is wrong |
| 6 | apply `UP` | commits in one transaction |
| 7 | run `POST_DEPLOY` | **14/14 PASS** |
| 8 | run the **After** half of §8.3 | 14/14 PASS |
| 9 | run guard tests §8.4 | 4/4 fire |
| 10 | run `ROLLBACK` | commits |
| 11 | compare restored vs captured, all dimensions, both directions | **zero differences** |
| 12 | re-run the Before half | vulnerabilities return — proves the restore is real |
| 13 | capture + re-apply | idempotent path works |
| 14 | delete the branch | charge stops |

## 8.7 Abort conditions

Stop and revise if: `UP` cannot commit in one transaction; any `POST_DEPLOY` check FAILs; any
regression guard (`B-03`, `C-02`, `S-01`…`S-04`) turns DENIED; `ROLLBACK` does not reproduce the
snapshot exactly; or a guard test fails to fire.

## 8.8 What this plan does not cover

- **Production-scale concurrency.** The branch has no live traffic; lock behaviour under load is
  not measured. See §9.4.
- **Sign-up** (`handle_new_user()`), **view behaviour**, and **function hardening** — P0 touches
  none of these, so they are P1 test scope, not P0's.
- **Signed-URL issuance**, which does not exist until the `createSignedUrl` migration.

---

<!-- ===== FILE: SECURITY_DB_P0_DRY_RUN_REPORT.md ===== -->

# SECURITY_DB_P0_DRY_RUN_REPORT — actual execution output

**Environment:** Supabase branch `security-db-p0-rehearsal`, project ref `xdadfasscotvxzgfzxjs`,
PostgreSQL 17.6, executing role `postgres`. Parent: `Couranr -OS` (`zrdxlrlqxdslqpnoqmus`).
**Production was never written to.** Branch deleted after the run.

## 9.1 Branch reality — a finding in itself

The branch provisioned with status `MIGRATIONS_FAILED` / `ACTIVE_HEALTHY` and:

```
public tables: 0    policies: 0    buckets: 0
```

The repository has **zero migrations** (`supabase/` does not exist; the connected project's
migration history is empty — the live schema was applied by hand through the SQL editor).
Supabase branching replays `supabase/migrations`, so it had nothing to replay.

**Consequence:** Supabase branching cannot currently reproduce this schema. A synthetic fixture
was built instead, and verified to reproduce the vulnerable baseline before any P0 statement ran.

## 9.2 Snapshot capture

```
status      | run_id | policies | grants | effective | rls | buckets | owners | oos_policies | rowcounts | seq_grants
CAPTURE OK  |      1 |       12 |    126 |       126 |   6 |       1 |      6 |            1 |         6 |          9
```

126 grants = 6 tables × 3 grantees × 7 privileges, one row each — satisfying defect A6.
`aclexplode` found **no `PUBLIC` grantee rows**, so the fixture's 126 direct grants are the whole ACL.

## 9.3 Preflight — 11 PASS, 1 INFO

```
id | check_name                                                    | result | detail
 0 | PRE-00 active snapshot bound to this session                  | PASS   | run_id=1 ref=xdadfasscotvxzgfzxjs sha=814456f1e373f8bf
 1 | PRE-01 target project ref is the one you intend               | PASS   | couranr.project_ref = xdadfasscotvxzgfzxjs
 2 | PRE-02 PostgreSQL >= 15 (policy + aclexplode semantics)       | PASS   | server_version = 17.6
 3 | PRE-03 executing role owns all 6 in-scope tables              | PASS   | current_user = postgres; owned = 6/6
 4 | PRE-04 all 6 in-scope tables exist as ordinary tables         | PASS   | all 6 present
 5 | PRE-05 baseline DB-2 present: 4 tables have RLS disabled      | PASS   | rls_disabled = 4/4
 6 | PRE-06 baseline DB-2 present: anon holds DML on those 4       | PASS   | tables with full anon DML = 4/4
 7 | PRE-07 orders client-write policies present under expected    | PASS   | found = 3/3; all orders write policies = Customers can create their own orders | admin_all_orders | customers can create orders | customers can update own orders
 8 | PRE-08 deliveries client-write policies present under expected| PASS   | found = 2/2; all deliveries write policies = admin_all_deliveries | customers can create delivery records | drivers_update_own_deliveries
 9 | PRE-09 delivery-photos exists, is public, ZERO objects        | PASS   | public = true; objects = 0
10 | PRE-10 no FORCE ROW LEVEL SECURITY on any in-scope table      | PASS   | forced = 0/6
11 | PRE-11 migration role membership in supabase_admin (INFO)     | INFO   | postgres, member of supabase_admin = false (P0 does not require it)
```

**PRE-11 re-confirms defect A1 independently:** `postgres` is not a member of `supabase_admin`, so
V3's `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` would have aborted the whole transaction.

**PRE-07/PRE-08 surfaced something the design had to account for:** `admin_all_orders` and
`admin_all_deliveries` are `FOR ALL` policies — they include writes and P0 keeps them. Containment
on those two tables therefore rests on the GRANT revoke, not on policy removal. See threat model §2.3.

## 9.4 Before — all four vulnerabilities reproduced on synthetic fixtures

```
test_id | description                            | principal              | outcome | verdict
A-01    | DB-2 anon reads addresses              | anon                   | ALLOWED | PASS
A-02    | DB-2 anon DELETEs an address           | anon                   | ALLOWED | PASS
A-03    | DB-2 anon forges an audit event        | anon                   | ALLOWED | PASS
A-04    | DB-2 anon writes a Stripe webhook event| anon                   | ALLOWED | PASS
A-05    | DB-2 anon writes a rental verification | anon                   | ALLOWED | PASS
B-01    | DB-1 customer marks own order PAID     | authenticated uid=0001 | ALLOWED | PASS
B-02    | DB-1 customer INSERTs an order         | authenticated uid=0001 | ALLOWED | PASS
B-03    | baseline: customer SELECTs own order   | authenticated uid=0001 | ALLOWED | PASS
C-01    | DB-4 driver rewrites delivery fees     | authenticated uid=0002 | ALLOWED | PASS
C-02    | baseline: driver SELECTs deliveries    | authenticated uid=0002 | ALLOWED | PASS
S-01    | baseline: service_role UPDATEs orders  | service_role           | ALLOWED | PASS
S-02    | baseline: service_role writes audit    | service_role           | ALLOWED | PASS
```

All findings confirmed empirically, not from reading policy text. Every mutation was undone.

> One correction during the run: A-04's first form inserted `gen_random_uuid()` into
> `stripe_webhook_events.id`, which is `bigint`, and returned `42804` (type error) rather than
> exercising the privilege path at all. The test was rewritten to insert `stripe_event_id`/`payload`
> and then returned `ALLOWED`. A type error is not evidence of either grant or denial.

## 9.5 Apply

```
status        | applied_at
P0 UP APPLIED | 2026-07-30 22:24:07.518944+00
```

Committed in a single transaction. No error, no lock timeout.

## 9.6 Post-deploy — 14/14 PASS

```
id | check_name                                                       | result | detail
 1 | P0-01 RLS now enabled on all 4 previously-unprotected tables     | PASS   | rls_enabled = 4/4
 2 | P0-02 zero policies created on those 4 tables (deny-all)         | PASS   | policies = 0
 3 | P0-03 anon + authenticated hold ZERO privileges on those 4       | PASS   | held = 0/56
 4 | P0-04 orders: anon + authenticated hold no INSERT/UPDATE/DELETE  | PASS   | held = 0/6
 5 | P0-05 deliveries: anon + auth hold no INSERT/UPDATE/DELETE       | PASS   | held = 0/6
 6 | P0-06 the 5 named client-write policies are gone, by name        | PASS   | surviving = (none)
 7 | P0-07 orders surviving policy set EXACT (both directions)        | PASS   | expected=3 actual=3 [admin_all_orders | customer_read_own_orders | customers can read own orders]
 8 | P0-08 deliveries surviving policy set EXACT (both directions)    | PASS   | expected=4 actual=4 [admin_all_deliveries | customer_read_own_deliveries | customers can read own deliveries | drivers_read_own_deliveries]
 9 | P0-09 service_role privileges on all 6 tables UNCHANGED          | PASS   | service_role privs now = 42, at snapshot = 42
10 | P0-10 delivery-photos bucket private with size + MIME limits     | PASS   | public=false limit=10485760 mime=image/jpeg,image/png,image/webp,image/heic
11 | P0-11 row counts on all 6 tables UNCHANGED (no data touched)     | PASS   | addresses=1, deliveries=1, delivery_admin_events=1, orders=1, rental_verifications=0, stripe_webhook_events=0
12 | P0-12 sequence grants UNCHANGED vs snapshot (defect A3)          | PASS   | rows compared = 9, differing = 0
13 | P0-13 no policy changed on any table OUTSIDE the 6 in scope      | PASS   | out-of-scope policies now = 1, at snapshot = 1
14 | P0-14 table ownership on the 6 tables UNCHANGED                  | PASS   | postgres
```

## 9.7 After — 14/14 PASS

```
test_id | description                                | principal              | outcome                              | verdict
A-01    | DB-2 anon reads addresses                  | anon                   | DENIED (42501 insufficient_privilege) | PASS
A-02    | DB-2 anon DELETEs an address               | anon                   | DENIED (42501 insufficient_privilege) | PASS
A-03    | DB-2 anon forges an audit event            | anon                   | DENIED (42501 insufficient_privilege) | PASS
A-04    | DB-2 anon writes a Stripe webhook event    | anon                   | DENIED (42501 insufficient_privilege) | PASS
A-05    | DB-2 anon writes a rental verification     | anon                   | DENIED (42501 insufficient_privilege) | PASS
B-01    | DB-1 customer marks own order PAID         | authenticated uid=0001 | DENIED (42501 insufficient_privilege) | PASS
B-02    | DB-1 customer INSERTs an order             | authenticated uid=0001 | DENIED (42501 insufficient_privilege) | PASS
B-03    | REGRESSION customer SELECTs own order      | authenticated uid=0001 | ALLOWED                               | PASS
C-01    | DB-4 driver rewrites delivery fees         | authenticated uid=0002 | DENIED (42501 insufficient_privilege) | PASS
C-02    | REGRESSION driver SELECTs deliveries       | authenticated uid=0002 | ALLOWED                               | PASS
S-01    | REGRESSION service_role UPDATEs orders     | service_role           | ALLOWED                               | PASS
S-02    | REGRESSION service_role writes audit event | service_role           | ALLOWED                               | PASS
S-03    | REGRESSION service_role reads addresses    | service_role           | ALLOWED                               | PASS
S-04    | REGRESSION service_role INSERTs a delivery | service_role           | ALLOWED                               | PASS
```

All four findings closed; all six regression guards still green.

## 9.8 Guard tests — 4/4 fire

```
test_id | description                                                          | verdict | detail
G-01    | re-running UP against an already-applied run                         | PASS    | P0: this run was already applied (double-apply guard).
G-02    | applying an UP script whose SHA-256 differs from the snapshot         | PASS    | P0: snapshot checksum 814456f1e373f8bf does not match supplied deadbeef-not-the-real-script — wrong UP script
G-03    | pointing the session at a DIFFERENT project ref (prod ref as decoy)  | PASS    | P0: snapshot project_ref xdadfasscotvxzgfzxjs does not match session couranr.project_ref zrdxlrlqxdslqpnoqmus
G-04    | opening a SECOND active snapshot run (defect A5)                     | PASS    | rejected by snapshot_run_one_active: duplicate key value violates unique constraint "snapshot_run_one_active"
```

**G-03 is the one that matters most operationally.** The production ref was used as the decoy and
the guard refused. A branch-bound snapshot cannot be used to apply against production by mistake.

## 9.9 Residual behaviour after P0

```
test_id | description                                                      | outcome                          | verdict
R-01    | anon SELECT on orders after P0 (GRANT retained, policy TO public)| ALLOWED, rows visible = 0        | PASS (RLS filters despite retained GRANT)
R-02    | anon SELECT on deliveries after P0                               | ALLOWED, rows visible = 0        | PASS
R-03    | anon TRUNCATE on orders after P0 (TRUNCATE grant RETAINED)       | ERROR 0A000: cannot truncate a table referenced in a foreign key constraint | INFO
```

**R-03 must not be misread as a denial.** `0A000` is a foreign-key restriction, not `42501`. The
privilege check passed. Confirmed directly:

```
table_name            | anon_truncate | auth_truncate | anon_references | anon_trigger | anon_select
addresses             | false         | false         | false           | false        | false
deliveries            | true          | true          | true            | true         | true
delivery_admin_events | false         | false         | false           | false        | false
orders                | true          | true          | true            | true         | true
rental_verifications  | false         | false         | false           | false        | false
stripe_webhook_events | false         | false         | false           | false        | false
```

`anon` and `authenticated` retain `TRUNCATE`/`REFERENCES`/`TRIGGER` on `orders` and `deliveries`.
Not reachable via PostgREST or pg_graphql, so out of P0's threat model — carried as **P1-R01**.

## 9.10 Questions the dry run answered

| # | Question | Answer |
|---|---|---|
| Q1 | Does UP commit in one transaction without error? | **Yes** — `2026-07-30 22:24:07.518944+00` |
| Q2 | Does the `supabase_admin` default-ACL problem affect P0? | **No** — P0 issues no such statement; A1 confirmed present but irrelevant here |
| Q3 | Do the customer and driver read paths survive? | **Yes** — B-03, C-02 ALLOWED after |
| Q4 | Does `service_role` survive intact? | **Yes** — 42 privileges before and after; S-01…S-04 ALLOWED |
| Q5 | Is the rollback exact? | **Yes** — zero differences on 7 dimensions, both directions |
| Q6 | Do the guards actually fire? | **Yes** — 4/4, including the production-ref decoy |
| Q7 | Are sequence grants disturbed? | **No** — 9 rows compared, 0 differing |
| Q8 | Is anything outside the 6 tables touched? | **No** — P0-13 and P0-14 PASS |

## 9.11 What this rehearsal does **not** establish

Stated explicitly rather than left implied:

1. **Production-scale lock behaviour.** The branch had no concurrent traffic. `ALTER TABLE …
   ENABLE ROW LEVEL SECURITY` and `DROP POLICY` take `ACCESS EXCLUSIVE` briefly; on production
   they will queue behind any long-running transaction on those tables. `lock_timeout = '10s'`
   means the migration aborts cleanly rather than blocking, but the window must still be chosen
   during low traffic. **Not measured — extrapolated.**
2. **The full 82-policy production graph.** The fixture carried the 12 in-scope policies plus one
   out-of-scope policy, not production's 82. P0-13 asserts out-of-scope policies are untouched, and
   that assertion is only as strong as the fixture's out-of-scope set (1 policy). On production the
   same check compares against production's real count.
3. **Application-level behaviour.** No Next.js route was exercised. The `getPublicUrl` →
   `createSignedUrl` follow-up (threat model §2.2, DB-3) is identified but unverified end-to-end.
4. **Statement durations.** Not instrumented. The six tables are small (production: 42 orders,
   29 deliveries, 94 addresses) so execution time is expected to be negligible; lock *acquisition*
   is the variable, not execution.

---

<!-- ===== FILE: SECURITY_DB_P0_ROLLBACK_REHEARSAL.md ===== -->

# SECURITY_DB_P0_ROLLBACK_REHEARSAL — actual execution output

A snapshot-derived rollback is unproven until it has been run and the result compared field by
field. This is that comparison.

## 10.1 Execution

```
status               | rolled_back_at
P0 ROLLBACK COMPLETE | 2026-07-30 22:26:07.604113+00
```

Applied `22:24:07`, rolled back `22:26:07`. One transaction, no error.

## 10.2 Restored state vs captured baseline — every dimension, both directions

```
dimension                                    | diff
GRANTS lost (in baseline, missing now)       | (none)
GRANTS gained (present now, not in baseline) | (none)
POLICIES lost (name or expression)           | (none)
POLICIES gained (name or expression)         | (none)
RLS FLAGS differing                          | (none)
BUCKET differing                             | (none)
ROW COUNTS differing                         | (none)
```

The policy comparison is on the **tuple `(table, policy_name, using_expr, with_check_expr)`**, not
on names alone — a policy restored under the right name with a different body would still show as
a difference. It did not.

Policy names containing spaces (`customers can update own orders`, `Customers can create their own
orders`) survived the `quote_ident`/`%I` round trip intact.

## 10.3 Proof the restore is real, not cosmetic

A rollback that restores catalog rows but not behaviour is worthless. The Before tests were
re-run after the rollback:

```
test_id | description                        | principal              | outcome | verdict
A-01    | anon reads addresses again         | anon                   | ALLOWED | PASS (rollback restored the vulnerable baseline, as designed)
A-02    | anon DELETEs an address again      | anon                   | ALLOWED | PASS
B-01    | customer marks own order PAID again| authenticated uid=0001 | ALLOWED | PASS
C-01    | driver rewrites delivery fees again| authenticated uid=0002 | ALLOWED | PASS
```

**The vulnerabilities came back.** That is the correct and intended outcome — and it is the whole
point of §10.5.

## 10.4 Re-apply after rollback

```
status           | run_id | rls_on | client_write_privs | bucket_public
REAPPLY COMPLETE |      4 |      4 |                  0 | false
```

Capture → UP ran cleanly a second time against the restored baseline. The cycle is repeatable, so
a rollback does not strand the database in a state that P0 can no longer contain.

(`run_id` is 4 rather than 2 because `bigserial` consumed values during the guard tests in §9.8 —
a sequence advancing past rolled-back attempts is expected, not a defect.)

## 10.5 What rollback costs — read before using it

`SECURITY_DB_P0_ROLLBACK.sql` **restores DB-1, DB-2, DB-3 and DB-4 in full**, as §10.3 proves
empirically. After a rollback:

- 94 real customer addresses are readable and deletable by anyone with the public key
- the audit trail is forgeable and deletable by anyone
- any customer can mark their own real order paid
- any driver can inflate their own fees
- `delivery-photos` is world-readable again — and if objects were uploaded while P0 was applied,
  **those objects become public**, which is a new exposure the original state did not have

**Prefer a forward fix.** Roll back only if a `POST_DEPLOY` check FAILs or a regression guard turns
DENIED, and treat it as an incident with a clock on it: re-apply P0 as soon as the breaking caller
is corrected. Rollback is a way to buy an hour, not a resting state.

## 10.6 Rollback preconditions

| # | Precondition | Enforcement |
|---|---|---|
| 1 | An applied, active snapshot run exists | script aborts otherwise |
| 2 | The snapshot is from **this** database | `project_ref` recorded at capture; G-03 proves the guard |
| 3 | `public` is on the search_path | pinned by `set local search_path` (defect C2) |
| 4 | The audit schema was not dropped | rollback is unsupported without it — say so before applying P0 |

---

<!-- ===== FILE: SECURITY_DB_P0_EXACT_OBJECT_DIFF.json ===== -->

Every object P0 changes, enumerated. Counts measured on the rehearsal branch; the shape is
identical on production, the row counts are not.

```json
{
  "package": "SECURITY_DB_P0",
  "up_sha256": "814456f1e373f8bff41d766cfa44e96c9da6cfdd495bc67000ca620442fc70c6",
  "rehearsed_on": {
    "project_ref": "xdadfasscotvxzgfzxjs",
    "branch_name": "security-db-p0-rehearsal",
    "parent_project_ref": "zrdxlrlqxdslqpnoqmus",
    "postgres_version": "17.6",
    "applied_at": "2026-07-30T22:24:07.518944+00:00",
    "rolled_back_at": "2026-07-30T22:26:07.604113+00:00",
    "branch_deleted": true,
    "note": "Branch provisioned EMPTY (0 tables/policies/buckets) because the repo has zero migrations; a synthetic fixture was used."
  },
  "applied_to_production": false,
  "summary": {
    "tables_touched": 6,
    "storage_bucket_rows_touched": 1,
    "policies_dropped": 5,
    "policies_created": 0,
    "grants_revoked": 68,
    "grants_added": 0,
    "grants_retained": 58,
    "rls_flags_flipped": 4,
    "functions_touched": 0,
    "views_touched": 0,
    "schemas_created": 0,
    "sequences_touched": 0,
    "rows_inserted_updated_deleted_in_business_tables": 0,
    "objects_outside_scope_touched": 0
  },
  "rls_enabled": [
    { "table": "public.addresses",             "from": false, "to": true },
    { "table": "public.delivery_admin_events", "from": false, "to": true },
    { "table": "public.stripe_webhook_events", "from": false, "to": true },
    { "table": "public.rental_verifications",  "from": false, "to": true }
  ],
  "policies_dropped": [
    { "table": "public.orders",     "policy": "Customers can create their own orders", "cmd": "INSERT" },
    { "table": "public.orders",     "policy": "customers can create orders",           "cmd": "INSERT" },
    { "table": "public.orders",     "policy": "customers can update own orders",       "cmd": "UPDATE" },
    { "table": "public.deliveries", "policy": "customers can create delivery records", "cmd": "INSERT" },
    { "table": "public.deliveries", "policy": "drivers_update_own_deliveries",         "cmd": "UPDATE" }
  ],
  "policies_retained": [
    { "table": "public.orders",     "policy": "admin_all_orders",                  "cmd": "ALL",
      "note": "FOR ALL includes writes; contained by the GRANT revoke, not by policy removal" },
    { "table": "public.orders",     "policy": "customer_read_own_orders",          "cmd": "SELECT" },
    { "table": "public.orders",     "policy": "customers can read own orders",     "cmd": "SELECT" },
    { "table": "public.deliveries", "policy": "admin_all_deliveries",              "cmd": "ALL",
      "note": "same as admin_all_orders" },
    { "table": "public.deliveries", "policy": "customer_read_own_deliveries",      "cmd": "SELECT" },
    { "table": "public.deliveries", "policy": "customers can read own deliveries", "cmd": "SELECT" },
    { "table": "public.deliveries", "policy": "drivers_read_own_deliveries",       "cmd": "SELECT" }
  ],
  "grants_revoked_by_table": [
    { "table": "public.addresses",             "grantees": ["anon","authenticated"],
      "privileges": ["SELECT","INSERT","UPDATE","DELETE","TRUNCATE","REFERENCES","TRIGGER"], "count": 14 },
    { "table": "public.delivery_admin_events", "grantees": ["anon","authenticated"],
      "privileges": ["SELECT","INSERT","UPDATE","DELETE","TRUNCATE","REFERENCES","TRIGGER"], "count": 14 },
    { "table": "public.stripe_webhook_events", "grantees": ["anon","authenticated"],
      "privileges": ["SELECT","INSERT","UPDATE","DELETE","TRUNCATE","REFERENCES","TRIGGER"], "count": 14 },
    { "table": "public.rental_verifications",  "grantees": ["anon","authenticated"],
      "privileges": ["SELECT","INSERT","UPDATE","DELETE","TRUNCATE","REFERENCES","TRIGGER"], "count": 14 },
    { "table": "public.orders",                "grantees": ["anon","authenticated"],
      "privileges": ["INSERT","UPDATE","DELETE"], "count": 6 },
    { "table": "public.deliveries",            "grantees": ["anon","authenticated"],
      "privileges": ["INSERT","UPDATE","DELETE"], "count": 6 }
  ],
  "grants_retained_detail": [
    { "role": "service_role", "tables": "all 6", "privileges": "all 7",
      "count": 42, "assertion": "P0-09 proves unchanged" },
    { "role": "anon",          "table": "public.orders",
      "privileges": ["SELECT","REFERENCES","TRIGGER","TRUNCATE"], "count": 4, "residual_risk": "P1-R01" },
    { "role": "authenticated", "table": "public.orders",
      "privileges": ["SELECT","REFERENCES","TRIGGER","TRUNCATE"], "count": 4, "residual_risk": "P1-R01" },
    { "role": "anon",          "table": "public.deliveries",
      "privileges": ["SELECT","REFERENCES","TRIGGER","TRUNCATE"], "count": 4, "residual_risk": "P1-R01" },
    { "role": "authenticated", "table": "public.deliveries",
      "privileges": ["SELECT","REFERENCES","TRIGGER","TRUNCATE"], "count": 4, "residual_risk": "P1-R01" }
  ],
  "storage_changes": [
    { "object": "storage.buckets['delivery-photos']",
      "public":             { "from": true,  "to": false },
      "file_size_limit":    { "from": null,  "to": 10485760 },
      "allowed_mime_types": { "from": null,  "to": ["image/jpeg","image/png","image/webp","image/heic"] },
      "objects_in_bucket_at_apply_time": 0,
      "storage_policies_created": 0 }
  ],
  "explicitly_not_touched": {
    "tables_outside_scope": 30,
    "views": 6,
    "functions": 7,
    "sequences": 3,
    "schemas_created": 0,
    "default_acls": 0,
    "table_ownership": "unchanged (P0-14)",
    "service_role_privileges": "unchanged (P0-09)",
    "business_table_rows": "unchanged (P0-11)"
  },
  "verification": {
    "preflight":  { "pass": 11, "info": 1, "fail": 0 },
    "post_deploy":{ "pass": 14, "fail": 0 },
    "behavioral_before": { "pass": 12, "fail": 0 },
    "behavioral_after":  { "pass": 14, "fail": 0 },
    "guards":            { "pass": 4,  "fail": 0 },
    "rollback_diff_dimensions_with_differences": 0
  }
}
```

---

<!-- ===== FILE: SECURITY_DB_P1_HARDENING_PLAN.md ===== -->

# SECURITY_DB_P1_HARDENING_PLAN — design only

**Not rehearsed. Not applied. Do not execute any part of this.** P1 needs its own rehearsal on a
disposable environment, with the same evidence standard P0 just met.

## 12.1 Governing lesson from V1–V3

Three revisions failed because they bundled independent changes into one transaction. P1 is
therefore specified as **six independently applicable units**, each with its own snapshot, its own
preflight, its own rollback and its own rehearsal. None of them may be combined.

Two hard prerequisites before any P1 unit is designed further:

1. **P0 applied to production and stable.** P1 is refinement; it presumes the bleeding stopped.
2. **`02_DECISION_REGISTRY.json` exists.** It does not exist in the repo today. It is rank-1
   authority for roles, states and terminology. P1-01 defines an authorization model, and defining
   one without the registry means guessing at the role vocabulary and then rewriting it.

## 12.2 The six units

### P1-01 — Authorization model (largest, most dangerous)

**Problem.** Four role-resolution paths all read `profiles.role`; only `lib/auth.ts:38-51` is
trustworthy. There is **no merchant role resolution at all** — `lib/businessAccount.ts:11-41`
treats membership as binary, and although five roles (`owner|manager|dispatcher|viewer|billing`)
exist in the schema, **no code reads the `role` column**. 34 of 82 policies call one of four
`public` predicates that are `EXECUTE`-able by `anon`.

**Design sketch.** A non-exposed `couranr_auth` schema holding `SECURITY DEFINER` predicates with
pinned `search_path`, replacing direct `profiles` reads inside policies.

**The trap V1 fell into, restated so it is not repeated:** a predicate that reads a table which is
itself protected by a policy calling that predicate produces `42P17 infinite recursion`. V1 shipped
exactly this (`orders → deliveries → orders`) and passed review. Any P1-01 design must include a
**correct** cycle proof — V3's attempt (defect A2) omitted `WITH RECURSIVE` and its
`not e.dst = any(r.path)` guard made `node = origin` unreachable, so it could never report a cycle
even in a genuinely cyclic graph. The current legacy graph is acyclic (33 nodes, 35 edges,
0 cycles); the check must be able to *fail*, and must be tested against a deliberately cyclic
fixture before it is trusted.

**Blast radius:** all 82 policies. **Do not attempt as one migration.**

### P1-02 — Function hardening

**Verified current state (production, read-only):**

| Function | SECURITY DEFINER | `search_path` | `anon` EXECUTE | `authenticated` EXECUTE | Policies calling it |
|---|---|---|---|---|---|
| `is_admin()` | yes | **mutable** | yes | yes | 7 |
| `is_admin(uuid)` | yes | `public` | yes | yes | 12 |
| `app_is_admin()` | yes | `public` | yes | yes | 8 |
| `app_is_business_member(uuid)` | yes | `public` | yes | yes | 7 |
| `handle_new_user()` | yes | **mutable** | yes | yes | 0 (trigger) |
| `set_doc_request_code()` | no | **mutable** | yes | yes | 0 (trigger) |
| `set_updated_at()` | no | **mutable** | yes | yes | 0 (trigger) |

**34 policies** call at least one of the four predicates; 48 call none.

**Two traps, both already hit once:**
- V2 revoked `EXECUTE` from the four predicates outright. That would have broken all 34 calling
  policies. `authenticated` **must retain** `EXECUTE` on those four.
- Every `proacl` begins `{=X/postgres,…}` — a leading `=X` is a **`PUBLIC`** grant. `anon` and
  `authenticated` hold `EXECUTE` **by inheritance**, so revoking from those roles directly is a
  no-op. The revoke must target `PUBLIC` first, then re-grant explicitly. Verify with
  `has_function_privilege`, never with `information_schema` grantee rows.

**Safe subset (the three trigger functions):** pin `search_path`, revoke `EXECUTE` from `PUBLIC`,
grant nothing back. Highest-consequence regression is **sign-up** via `handle_new_user()` — it must
be tested by creating a real auth user on a branch and confirming the `profiles` row appears.

### P1-03 — Views to `security_invoker`

6 views; **0 currently set `security_invoker`**, so all run with owner privileges and bypass the
caller's RLS. Converting changes what every caller sees, so each of the 6 needs its caller mapped
first. `docs_requests` vs. the `doc_requests` base relation is the known naming trap.

### P1-04 — Default ACLs and blanket grants

Where V3's defect A1 lives. `postgres` is **not** a member of `supabase_admin` (re-confirmed by
PRE-11 in this rehearsal), so `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` **aborts the
transaction**. Either the statement is dropped, or a Supabase operator with the right membership
runs that step. Decide before designing further. Also: `pg_default_acl` is per owning role — the
rollback must restore per-role, per-schema, per-object-type, which V3 did not do (A4).

### P1-05 — Storage

7 buckets, **4 storage policies total, all scoped to `docs-files`**. `vehicle-images` is still
public (3 objects, 699 KB). The other five private buckets have no policies, so they are
service-role-only, which is coherent but undocumented. Includes the
`getPublicUrl` → `createSignedUrl` migration at
`app/api/delivery/upload-pickup-photo/route.ts:197`, and reconciling it with
`app/api/customer/upload-pickup-photo/route.ts:125`, which builds an `/object/authenticated/` URL
instead — the two upload routes disagree with each other today.

### P1-06 — Residual grant cleanup

Closes **P1-R01**: revoke `TRUNCATE`, `REFERENCES`, `TRIGGER` from `anon`/`authenticated` on
`orders` and `deliveries`, retaining `SELECT`. One statement per table. Smallest unit; can go first.

## 12.3 Suggested order

`P1-06` (smallest, closes P0's known residual) → `P1-03` → `P1-02` trigger-function subset →
`P1-05` → `P1-04` → `P1-01` (only once the decision registry exists).

## 12.4 Evidence standard

Identical to P0's, and non-negotiable: snapshot → preflight → apply → post-deploy exact-set
assertions → behavioural before/after on synthetic fixtures → rollback → field-by-field comparison
→ re-apply. A P1 unit without a rehearsal transcript is not ready, regardless of how it reads.

---

<!-- ===== FILE: SECURITY_DB_P1_OBJECT_INVENTORY.json ===== -->

Measured read-only against production `zrdxlrlqxdslqpnoqmus` on 2026-07-30. No values, no secrets.

```json
{
  "project_ref": "zrdxlrlqxdslqpnoqmus",
  "project_name": "Couranr -OS",
  "postgres_version": "17.6.1.063",
  "captured_at": "2026-07-30",
  "capture_method": "read-only catalog queries via execute_sql",
  "schema_totals": {
    "tables_public": 36,
    "views_public": 6,
    "sequences_public": 3,
    "policies_public": 82,
    "policies_storage": 4,
    "policies_total": 86,
    "functions_public": 7,
    "buckets": 7,
    "distinct_owners_public": 1,
    "force_rls_tables": 0
  },
  "rls_posture": {
    "tables_rls_disabled": 4,
    "tables_rls_enabled_with_zero_policies": 0,
    "note": "the 4 RLS-disabled tables are exactly P0's DB-2 set; P0 closes them"
  },
  "functions": [
    { "name": "is_admin", "args": "", "security_definer": true,
      "search_path": "MUTABLE", "anon_execute": true, "authenticated_execute": true,
      "policies_calling": 7, "p1_unit": "P1-02" },
    { "name": "is_admin", "args": "check_user_id uuid", "security_definer": true,
      "search_path": "public", "anon_execute": true, "authenticated_execute": true,
      "policies_calling": 12, "p1_unit": "P1-02" },
    { "name": "app_is_admin", "args": "", "security_definer": true,
      "search_path": "public", "anon_execute": true, "authenticated_execute": true,
      "policies_calling": 8, "p1_unit": "P1-02" },
    { "name": "app_is_business_member", "args": "p_business_account_id uuid", "security_definer": true,
      "search_path": "public", "anon_execute": true, "authenticated_execute": true,
      "policies_calling": 7, "p1_unit": "P1-02" },
    { "name": "handle_new_user", "args": "", "security_definer": true,
      "search_path": "MUTABLE", "anon_execute": true, "authenticated_execute": true,
      "policies_calling": 0, "trigger_only": true, "p1_unit": "P1-02",
      "note": "sign-up path — highest-consequence regression if hardened carelessly" },
    { "name": "set_doc_request_code", "args": "", "security_definer": false,
      "search_path": "MUTABLE", "anon_execute": true, "authenticated_execute": true,
      "policies_calling": 0, "trigger_only": true, "p1_unit": "P1-02" },
    { "name": "set_updated_at", "args": "", "security_definer": false,
      "search_path": "MUTABLE", "anon_execute": true, "authenticated_execute": true,
      "policies_calling": 0, "trigger_only": true, "p1_unit": "P1-02" }
  ],
  "function_summary": {
    "total": 7,
    "security_definer": 5,
    "mutable_search_path": 4,
    "executable_by_anon": 7,
    "policies_referencing_any_of_the_four_predicates": 34,
    "policies_referencing_none": 48,
    "critical_note": "every proacl begins '{=X/postgres,...}'; the leading '=X' is a PUBLIC grant, so anon/authenticated hold EXECUTE by INHERITANCE. Revoking from those roles directly is a no-op — revoke FROM PUBLIC first, then re-grant explicitly. Verify with has_function_privilege, not information_schema grantee rows."
  },
  "views": {
    "count": 6,
    "with_security_invoker_true": 0,
    "p1_unit": "P1-03",
    "note": "all 6 currently run with owner privileges and bypass caller RLS"
  },
  "storage": {
    "buckets_total": 7,
    "buckets_public_before_p0": 2,
    "buckets_public_after_p0": 1,
    "remaining_public_bucket": "vehicle-images",
    "storage_policies_total": 4,
    "storage_policies_scope": "all 4 scoped to docs-files; the other 6 buckets have none",
    "p1_unit": "P1-05"
  },
  "p0_scope_reference": {
    "tables": ["addresses","delivery_admin_events","stripe_webhook_events",
               "rental_verifications","orders","deliveries"],
    "production_row_counts": { "orders": 42, "deliveries": 29, "addresses": 94 },
    "state_at_capture": "UNCHANGED — P0 not applied to production"
  }
}
```

---

<!-- ===== FILE: SECURITY_DB_P1_RISK_REGISTER.md ===== -->

# SECURITY_DB_P1_RISK_REGISTER

Two registers: what P0 leaves behind, and what P1 threatens to break.

## 14.1 Residual risks after P0 is applied

| ID | Residual | Reachable with the public anon key? | Severity | Owner |
|---|---|---|---|---|
| **R01** | `anon`/`authenticated` retain `TRUNCATE`, `REFERENCES`, `TRIGGER` on `orders` and `deliveries` | **No** — not exposed by PostgREST or pg_graphql; needs a direct Postgres connection with the `anon` role's database password | Medium | P1-06 |
| **R02** | 7 functions `EXECUTE`-able by `anon`; 4 with mutable `search_path` | **Yes** — RPC-callable | High | P1-02 |
| **R03** | 6 views run as owner (`security_invoker` unset), bypassing caller RLS | **Yes** — if any is exposed | High | P1-03 |
| **R04** | `vehicle-images` bucket public (3 objects) | **Yes** — world-readable URLs | Low (vehicle photos, not personal data) | P1-05 |
| **R05** | 6 of 7 buckets have no storage policy | No — service-role-only in practice, but undocumented and fragile | Medium | P1-05 |
| **R06** | 7 unauthenticated API routes, 2 touching money | **Yes** — over HTTP, no key needed | **Critical** | Security-0 (application, **not** P1) |
| **R07** | 6 server files import the `"use client"` browser client → authenticate as `anon` | Indirect | High | Security-0 |
| **R08** | `resilientUpdateById` retries up to 20×, dropping columns; a payment write can "succeed" persisting none of its intended columns | Indirect | High | Payments |
| **R09** | Webhook idempotency has no unique constraint and no idempotency key | Indirect | High | Payments |
| **R10** | `delivery-photos` objects uploaded while P0 is applied become **public** if P0 is later rolled back | Only after a rollback | Medium | Operations — see rollback rehearsal §10.5 |

**R06 deserves emphasis:** it is more severe than anything P0 fixes, because it needs no key at
all. P0 does not touch it, and applying P0 must not be read as having addressed it.

## 14.2 Risks P1 itself introduces

| ID | Risk | Consequence | Mitigation |
|---|---|---|---|
| **P1-X1** | Policy recursion from `SECURITY DEFINER` predicates reading RLS-protected tables | `42P17` on the first authenticated `SELECT` — total read outage. **V1 shipped this and passed review.** | Correct recursive-CTE/Tarjan cycle proof, tested against a deliberately cyclic fixture so it can be shown to fail |
| **P1-X2** | Revoking `EXECUTE` on the four predicates | Breaks all **34** calling policies at once | `authenticated` must retain `EXECUTE`; assert the 34 still resolve |
| **P1-X3** | Revoking from `anon`/`authenticated` while the grant is inherited via `PUBLIC` | Revoke silently no-ops; hardening appears done but is not | Revoke `FROM PUBLIC` first; verify with `has_function_privilege` |
| **P1-X4** | `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` | **Aborts the transaction** — `postgres` is not a member (defect A1, re-confirmed by PRE-11) | Drop the statement, or have a Supabase operator run that step |
| **P1-X5** | Hardening `handle_new_user()` | **Sign-up breaks** — the single highest-consequence regression in P1 | Create a real auth user on a branch; confirm the `profiles` row appears |
| **P1-X6** | Converting views to `security_invoker` | Admin screens silently return 0 rows | Map every caller of all 6 views first; assert row counts per role before and after |
| **P1-X7** | Making `vehicle-images` private | Breaks the live auto vehicle listing — 2 proven `anon` callers (`app/auto/available/page.tsx`, `app/api/auto/vehicles/route.ts`) | Signed URLs first, or defer until the auto domain is quarantined |
| **P1-X8** | Bundling P1 units into one migration | The exact failure mode of V1, V2 and V3 | Six independent units, six rehearsals, six rollbacks. No exceptions |

## 14.3 Risk of not proceeding

Not applying P0 leaves four vulnerabilities reachable from any browser against **real production
data** — 42 orders, 29 deliveries, 94 addresses, and an audit trail that anyone can forge or
delete. Two of the four are directly monetary. The audit-trail exposure is the one that compounds:
it destroys the evidence needed to investigate the others.

**Recommendation: apply P0 to production in a low-traffic window**, using the rehearsed sequence,
with `POST_DEPLOY` gating and the rollback ready but *not* preferred. Then schedule P1-06 to close
R01 and Security-0 to close R06.

---

## Appendix — extraction

Each part is delimited by `<!-- ===== FILE: <name> ===== -->`. To extract the executable files,
take the first fenced block following each SQL/JSON marker. Verify:

```bash
sha256sum SECURITY_DB_P0_UP.sql
# must print 814456f1e373f8bff41d766cfa44e96c9da6cfdd495bc67000ca620442fc70c6
```

If it does not match, the guard in `SECURITY_DB_P0_UP.sql` will refuse to apply — which is the
intended behaviour, not a problem to work around.

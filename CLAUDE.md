# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Self-verification protocol — MANDATORY after every deliverable

A deliverable is **not done** until it has been verified against its requirement **empirically**, not from memory or optimism. This protocol exists because work on this repo has already shipped review-passing designs with real defects — a set of RLS policies that would have raised `42P17 infinite recursion` on the first authenticated `SELECT`; a function-hardening step that would have broken 28 surviving policies; a caller inventory reported as "six files, six call sites" that was actually 46 importers and 9 call sites. Every one of those passed a careful read. Only running a query caught them. Run every step, every time.

1. **Re-read the actual changed code against the requirement.** Open `git diff` and read each hunk with its surrounding context. Confirm the code does what the requirement literally says — not what you intended to write.
2. **Enumerate ALL enforcement points when you change a default, a gate, a grant, or any shared behavior.** Grep for every call site and reader of the thing you changed and confirm they ALL agree. In this codebase the sibling you forget is usually: the browser Supabase client vs. the service-role client, the policy vs. the table `GRANT`, the direct role grant vs. the `PUBLIC` grant it inherits through, `doc_requests` vs. the `docs_requests` view, or one of the 18 module-scope client constructions. List the sites you checked.
3. **Verify BOTH sides of every dual path.** Two clients, two schemas, two admin predicates, two upload routes that build different URL shapes — never assume the second mirrors the first.
4. **Prove claims; don't assert them.** Every factual statement about the codebase or the database must be backed by a command you ran (`grep`, a catalog query, a test) whose output you saw. If you didn't check it, say "unverified." For database claims prefer `has_table_privilege` / `has_function_privilege` over reading `information_schema` grantee rows — grantee rows miss privileges inherited through `PUBLIC`.
5. **Green tests are necessary, not sufficient.** There are 10 unit tests total and they cover pricing arithmetic, a UUID regex, and one status resolver. They will stay green through almost any defect. Reason explicitly about the invariant your change must preserve and add a test that would have caught the specific bug.
6. **Do a dedicated adversarial review pass scoped to the ACTUAL diff of THIS deliverable.** Ask "what did I change, and what class of bug could this exact change introduce?" and go looking for it.
7. **Report what you verified and how** — the commands and their results — not "all good." State any part you could NOT verify and why.

If any step surfaces a flaw, fix it and re-run the protocol before declaring done.

## Project status — read this before doing anything

**NOT launch-ready. NO-GO for public launch, production customer onboarding, or real customer data** (as of 2026-07). This is *not* a greenfield pre-launch repo — the connected Supabase project holds real rows: 42 `orders`, 29 `deliveries`, 94 `addresses`, 28 `rentals`, 46 renter-license files. Treat the database as production data with production consequences.

Four **P0 database issues are open and reachable from a browser using the public anon key**, independent of any application route:

1. `orders` — the owning customer can rewrite `payment_status`, `total_cents`, `paid_at`, `status`, `business_account_id` and the Stripe identifiers. (They cannot change `customer_id`; Postgres substitutes `USING` for an omitted `WITH CHECK`.)
2. Four tables have RLS disabled with full `anon` DML: `addresses` (94 real addresses), `delivery_admin_events` (the audit trail), `stripe_webhook_events`, `rental_verifications`.
3. The `delivery-photos` storage bucket is public with no policies (currently latent — 0 objects).
4. `deliveries` — the assigned driver can rewrite `status` and all five fee columns.

Plus seven unauthenticated API routes, two of which touch money: `/api/create-checkout-session` (arbitrary-amount Stripe Checkout) and `/api/delivery/complete` (payment capture). Remediation is designed in the Security-DB package but **not applied**. Do not start framework, auth, Stripe, or UI work ahead of it.

### Authority chain — the specification wins over the code, always

1. `02_DECISION_REGISTRY.json` — **does not exist in the repo.** Rank-1 authority for pricing, hours, payer behavior, states, terminology, launch gates. Phase 1 product work cannot start without it.
2. `Couranr_Claude_Code_Master_Package.md` (repo root) — inlines the master implementation spec, cutover matrix, phased plan, AI/communication spec, and release matrix.
3. `UI_SCREEN_REGISTRY.md` (repo root) — 66 canonical MVP screens, their routes, tiers, phases, and required states.
4. `docs/couranr-mvp/platform-baseline-v1.1/` — platform, dependency, migration-order and rollback authority.

**Legacy repository behavior never overrides these.** Where the code and the spec disagree, the spec is right and the code is the defect. Known live conflicts: pricing is `$15` base / 4 included miles / `$1.75` per mile (`lib/delivery/policy.ts:13-15`) against a specified `$22.99` / 3 miles / tiered `$2.25–$4.75`; the service area is a 60-mile radius from Stafford (`lib/serviceArea.ts:1-4`) rather than the four named markets; overnight is unimplemented. These are Phase 3 work — do not "fix" them opportunistically, and do not treat the code as evidence of intent.

Product is being transformed from a mixed auto-rental / document-services / generic-courier app into one focused product: **Couranr, local delivery infrastructure for local businesses**. The auto and docs domains are legacy and slated for quarantine, not extension.

## Commands

```bash
npm run dev          # next dev
npm run build        # next build — FAILS without env vars, see below
npm run lint         # next lint (ESLint 8 + next/core-web-vitals). Next 16 removes `next lint`.
npm run typecheck    # tsc --noEmit — passes, but tsconfig has "strict": false
npm run test         # vitest (watch)
npm run test:run     # vitest run — 3 files, 10 tests
npm run check        # lint && typecheck && test:run && build
```

There are **8 scripts**. The platform baseline specifies 32, and the release matrix names 13 gate commands of which 11 do not exist (`check:routes`, `check:rls`, `check:legacy-imports`, `test:security`, `test:payments`, `db:reset`, …). Do not invent a script that pretends to pass — a check that cannot fail is worse than no check.

**`npm run build` fails in a clean container.** `app/api/auto/create-checkout-session/route.ts:9` constructs a Supabase client at module scope; `next build`'s page-data collection imports it and the constructor throws `supabaseUrl is required` when env vars are absent. **18 module-scope client constructions across 15 files** share this shape, including `app/api/stripe/webhook/route.ts:15`, `app/api/delivery/start-checkout/route.ts:17` and `lib/auth.ts:4`. `lib/supabaseAdmin.ts:4-7` already documents the lazy-initialization fix, so the correct pattern exists in-tree. With production env vars present the build succeeds — but it is not reproducible from a clean clone, which conflicts with the baseline's CI requirement.

Tests use **Vitest**, not Jest and not `node:test`. Files live in `tests/*.test.ts`, `environment: "node"`, alias `@` → repo root (`vitest.config.ts`). There is no jsdom, no Testing Library, no Playwright config, and no Vitest `projects`, so the four `test:*` project suites the baseline expects cannot run yet.

**Runtime versions drift three ways:** local Node 22, CI Node 20 (`.github/workflows/ci.yml:23`), target Node 24. There is no `.nvmrc`, `.node-version`, `engines`, or `packageManager`. `package-lock.json` is lockfileVersion 2; the target is 3.

**CI is not a gate you can rely on.** `.github/workflows/ci.yml` triggers only on `main` and `codex/**` — **`claude/**` branches are not covered**, so work on this branch is unvalidated until that's fixed. CI also runs `npm install`, not `npm ci`, which is why a desynced lockfile went unnoticed for so long. `npm ci` works as of the Commit 0 lockfile repair; keep it working.

## Migrations and the database

**There are zero migrations.** `supabase/` does not exist and the connected project's migration history is empty — the entire live schema was applied by hand through the SQL editor. Consequences: there is no reproducible `db:reset`, no generated types (`types/database.generated.ts` does not exist, so every Supabase query is untyped), and `docs/business-portal-schema.sql` documents 9 tables while the database has 36 tables and 6 views — roughly **21% documentation coverage**.

Do not write a migration without it being reviewed first. When migrations do land they must be additive (`add column if not exists`, `create table if not exists`) and must never drop a table, drop a column, or delete data.

Known code/database drift: `business_pricing_profiles` is queried by `lib/businessPricing.ts:28-46` and defined in `docs/business-portal-schema.sql:61-73` but **does not exist in the database**. The error is swallowed at `:44-46`, so business-account pricing has been silently inert in production. That swallow-and-continue pattern recurs — see `resilientUpdateById` below.

## Architecture

### Supabase clients — five patterns, and the one that is a bug

| Pattern | Where | Note |
|---|---|---|
| Browser cookie client | `lib/supabaseClient.ts:6` (`createClientComponentClient`) | `"use client"`, **46 importers** |
| Auth-helper server/route clients | 4 sites | `app/driver/layout.tsx:11`, `app/portal/page.tsx:9`, `app/api/admin/deliveries/route.ts:8`, `app/api/driver/my-deliveries/route.ts:8` |
| Service-role proxy | `lib/supabaseAdmin.ts:22-38` | lazy, correct |
| **Ad-hoc inline service-role `createClient`** | **~45 duplicated call sites** | the real consolidation work |
| Anon client + forwarded Bearer token | 6 admin routes | e.g. `app/api/admin/drivers/route.ts:14` |

**62 of 76 API routes use the service-role key**, which bypasses RLS entirely — every one must re-scope its own queries. **10 of 76 have no authentication check at all.**

**The bug to know about:** six server-context files import the `"use client"` browser client. A browser client in a server route carries no JWT, so it authenticates as **`anon`**, not `authenticated`. Affected: `lib/delivery/authorizeDeliveryPayment.ts:2`, `lib/stripe/capturePayment.ts:2`, `lib/delivery/completeDelivery.ts:1`, `lib/delivery/getDeliveryByOrderId.ts:1`, `lib/getUserRole.ts:1`, `app/api/delivery/complete/route.ts:3`. This is why `/api/delivery/complete` returns 403 and has almost certainly never captured a payment.

### Auth and roles

There is **no middleware** — no `middleware.ts`, no `proxy.ts`, and therefore **no session-refresh path anywhere**. Adding one is net-new work, not a migration.

Two incompatible session models coexist: cookie sessions for pages, Bearer headers for most APIs, bridged by admin pages that read `session.access_token` by hand. Server authorization uses `getSession()` (decodes the cookie without revalidating the JWT) at `app/driver/layout.tsx:13-15` and `app/portal/page.tsx:11-13` — prefer `getUser()` for anything that gates access.

Four role-resolution paths all read `profiles.role`; only `lib/auth.ts:38-51` (`requireAdmin`, Bearer → `getUser` → role check) is trustworthy. `lib/getUserRole.ts` is advisory only. `app/admin/layout.tsx` is a `"use client"` layout with **no gate at all** — admin pages are protected only by whatever each API route enforces.

There is **no merchant role resolution**. Tenant membership is checked ad hoc by `lib/businessAccount.ts:11-41`, which treats membership as binary — the five declared roles (`owner|manager|dispatcher|viewer|billing`) exist in the schema but **no code reads the `role` column**.

### Stripe — two things to never conflate

`stripe@15.12.0` is **frozen** until characterization tests exist. Do not upgrade it, and do not "fix" payment code opportunistically.

Eleven of twelve call sites pin `apiVersion: "2024-04-10"`. **`app/api/stripe/webhook/route.ts:15` pins none** and floats with the SDK default — that is a live hazard for any SDK upgrade.

The webhook is one multi-product endpoint (auto + docs + delivery) handling only `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Idempotency is per-table JSON `.contains()` reads with no unique constraint and no idempotency key — `grep -rni idempotenc` finds exactly one hit repo-wide, and it is a comment. **`resilientUpdateById` (`:39-70`) parses "column does not exist" errors and retries up to 20 times, dropping the offending field each pass**, on `orders` and `deliveries` payment updates. A payment write can "succeed" having persisted none of its intended columns. Do not extend this pattern.

`@stripe/stripe-js` and `@stripe/react-stripe-js` are declared dependencies with **zero imports**.

### Storage

Seven buckets. `delivery-photos` and `vehicle-images` are **public**; only `renter-licenses` sets a size limit or MIME allow-list. There are **4 storage policies total, all scoped to `docs-files`** — the other six buckets have none, which means service-role-only for the private ones and world-readable for the public ones. The two pickup-photo upload routes disagree: `app/api/delivery/upload-pickup-photo/route.ts:197` builds a **public** URL, `app/api/customer/upload-pickup-photo/route.ts:125` builds an `/object/authenticated/` one.

### Routes

58 page routes, 76 API routes. Domains: auto rental (21 pages / 31 APIs), document services (11 / 17), courier-delivery (14 / 6), plus auth, dashboard and marketing. Auto and docs are **legacy — quarantine targets, not extension points**.

Of the 43 canonical target routes in the Master Package, **2 exist** (`/`, `/driver`) and 41 do not. Target names differ from actual: `/sign-in` and `/sign-up` vs. the existing `/login` and `/signup`.

### CSS and components

One stylesheet: `app/globals.css`, 818 lines of plain CSS with 7 custom properties. No Tailwind, no PostCSS, no `components.json`. **776 inline `style={{…}}` props** against 707 `className=` attributes. Eleven components, **zero UI primitives** — none of the 27 the baseline requires. `lib/cn.ts` exists but is a naive `filter(Boolean).join(" ")` with no importers.

When the canonical design system arrives it must be **additive** — new route group, namespaced `--couranr-*` tokens (the existing `:root` already defines `--border`, `--muted`, `--card`, `--shadow` with different values, so unprefixed tokens would silently restyle every legacy page). Do not bulk-restyle legacy auto/docs pages.

The 66 canonical screens reference `canonical-mvp-images/**` paths; **0 of 62 exist on disk**. The 91 UUID-named PNGs at the repo root are the raw source set. `docs/platform-dependency-baseline-v1-1` carries a `canonical-source-map.tsv` — **do not run or merge that workflow**: it references 9 source images that do not exist, conflicts with the registry on 6 screen IDs (it invents `OPS-008 driver-management` and drops `OPS-021 Ask Couranr lead inbox`), and it **deletes all 91 root PNGs** as a final step. Never delete a root PNG.

## Working practices

### Deliverables — combine many files into one

When a deliverable would be several files, **combine them into a single file**. Delimit each part with `<!-- ===== FILE: <name> ===== -->` and put executable content (SQL, JSON) in fenced blocks so it stays copy-pasteable, then verify the embedded blocks are byte-identical to their standalone form and that an extraction command round-trips them. One file, not eleven.

### Git

Work happens on the designated `claude/*` branch. `main` is `9c0a63bd5284e065978860b8893c170478fab1f5`; preservation refs `archive/auto-docs-multiservice` (branch, at that SHA) exist.

**Tag pushes fail with HTTP 403 in this environment.** Annotated tags, lightweight tags and `git push --tags` are all rejected by the git proxy while branch pushes to the same remote succeed in the same command, and no GitHub MCP tool creates tags or refs. The two required preservation tags exist locally only. Don't burn time re-litigating this — use a branch as the durable pointer, or ask the operator to create the tag in the GitHub UI.

### Supabase MCP

The connected project is **`Couranr -OS` (`zrdxlrlqxdslqpnoqmus`)**, PostgreSQL 17.6.1.063, `us-east-1`. Three other projects in the same org (`website builder`, `rental-software`, `dropshipping`) are **not** Couranr — check the ref before running anything.

Read-only catalog queries via `execute_sql` are the right way to establish database facts; `list_tables`, `list_migrations` and `get_advisors` are all useful. `get_advisors` output exceeds the tool's token cap — it is written to a file, so parse it with `python3`/`jq` rather than reading it whole.

**Never run an exploit or negative test against production data.** No marking a real order paid, altering a fee, deleting an address, or forging an audit event to prove a vulnerability. Use a Supabase branch, a restored scratch project, or synthetic fixtures.

### Verifying against a browser

Chromium is pre-installed at `/opt/pw-browsers` with `PLAYWRIGHT_BROWSERS_PATH` already set — do **not** run `playwright install`. Outbound HTTPS goes through a TLS-intercepting proxy (CA bundle at `/root/.ccr/ca-bundle.crt`); `curl` and Node trust it, a bundled Chromium generally will not. Use `curl` for external checks and a browser only against `localhost`. Never disable TLS verification or unset `HTTPS_PROXY` to force it — that's a safety boundary.

### Conventions worth matching

- **Amounts are integer cents, computed server-side.** `app/api/delivery/start-checkout/route.ts:180-186` is the model: it recomputes the price server-side and discards the client's `totalCents` entirely. Never trust a client-supplied amount — `/api/create-checkout-session:10` does, and that is the P0.
- **Distance is validated server-side** via Google Maps (`getDrivingMiles`, `start-checkout:54-92`). `/api/delivery/quote:21-47` does **not** validate its `miles` input — don't copy that route.
- **Every state transition should be a named server command** with the actor verified, the current state checked, and the transition allow-listed. No route should accept an arbitrary target status; `/api/delivery/mark-in-transit` currently does, with no auth at all.
- **Test-mode endpoints must be gated server-side.** `app/api/docs/test-mark-paid/route.ts:17-23,47-49` is the correct pattern: `if (IS_PROD || !TEST_MODE) return 403`. `/api/test-email` is the counter-example — unauthenticated, and it sends live mail to a hardcoded fallback address.
- **Never expose secrets to the browser or put them in analytics, logs, or notification copy.** `NEXT_PUBLIC_SUPABASE_URL` is (correctly but confusingly) used as the URL for service-role clients throughout — the key is what must never cross the boundary.
- **Say "Couranr", never founder or personal-operator language.** Use Couranr review, Couranr confirmation, Couranr Operations Queue, Couranr-managed dispatch, Couranr Support.

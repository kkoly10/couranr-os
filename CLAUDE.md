# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Self-verification protocol — MANDATORY after every deliverable

A deliverable is **not done** until it has been verified against its requirement **empirically**, not from memory or optimism. This protocol exists because work on this repo has already shipped review-passing designs with real defects — a set of RLS policies that would have raised `42P17 infinite recursion` on the first authenticated `SELECT`; a function-hardening step that would have broken 28 surviving policies; a caller inventory reported as "six files, six call sites" that was actually 46 importers and 9 call sites. Every one of those passed a careful read. Only running a query caught them. Run every step, every time.

1. **Re-read the actual changed code against the requirement.** Open `git diff` and read each hunk with its surrounding context. Confirm the code does what the requirement literally says — not what you intended to write.
2. **Enumerate ALL enforcement points when you change a default, a gate, a grant, or any shared behavior.** Grep for every call site and reader of the thing you changed and confirm they ALL agree. In this codebase the sibling you forget is usually: the browser Supabase client vs. the service-role client, the policy vs. the table `GRANT`, the direct role grant vs. the `PUBLIC` grant it inherits through, `doc_requests` vs. the `docs_requests` view, or one of the 18 module-scope client constructions. List the sites you checked.
3. **Verify BOTH sides of every dual path.** Two clients, two schemas, two admin predicates, two upload routes that build different URL shapes — never assume the second mirrors the first.
4. **Prove claims; don't assert them.** Every factual statement about the codebase or the database must be backed by a command you ran (`grep`, a catalog query, a test) whose output you saw. If you didn't check it, say "unverified." For database claims prefer `has_table_privilege` / `has_function_privilege` over reading `information_schema` grantee rows — grantee rows miss privileges inherited through `PUBLIC`.
5. **Green tests are necessary, not sufficient.** The suite is large — run `npm run test:run` for the current count — and it still stays green through almost any defect that lives outside their reach: proof upload was dead for its entire life behind a green typecheck and a green suite, because the only assertions about it were that a mocked function had NOT been called. Reason explicitly about the invariant your change must preserve and add a test that would have caught the specific bug.
6. **Do a dedicated adversarial review pass scoped to the ACTUAL diff of THIS deliverable.** Ask "what did I change, and what class of bug could this exact change introduce?" and go looking for it.
7. **Report what you verified and how** — the commands and their results — not "all good." State any part you could NOT verify and why.

If any step surfaces a flaw, fix it and re-run the protocol before declaring done.

## Project status — read this before doing anything

**NOT launch-ready. NO-GO for public launch, production customer onboarding, or real customer data** (as of 2026-07). This is *not* a greenfield pre-launch repo — the connected Supabase project holds real rows: 42 `orders`, 29 `deliveries`, 94 `addresses`, 28 `rentals`, 46 renter-license files. Treat the database as production data with production consequences.

The four P0 database issues earlier revisions of this file listed as open are
**all CLOSED**, verified at `401b3ee` by catalog query:

| # | the old claim | measured now |
|---|---|---|
| 1 | the owning customer can rewrite `orders` money columns | `authenticated` holds **no** UPDATE/INSERT/DELETE on `orders`; policies are SELECT-only plus an `is_admin()`-gated ALL |
| 2 | `addresses`, `delivery_admin_events`, `stripe_webhook_events`, `rental_verifications` have RLS disabled with full `anon` DML | all four have `relrowsecurity = true`, zero policies, and `anon` holds no SELECT/INSERT/UPDATE/DELETE. **0 of 54 public tables have RLS disabled** |
| 3 | the `delivery-photos` bucket is public with no policies | `public = false`, 10 MB `file_size_limit`, MIME allow-list of jpeg/png/webp/heic |
| 4 | the assigned driver can rewrite `deliveries` status and fee columns | `authenticated` holds **no** UPDATE/INSERT/DELETE on `deliveries` |

Prefer `has_table_privilege` over grantee rows when you re-check these — the
table GRANT, not the policy, is what actually closed them.

**What is still open on the security surface:**

- `vehicle-images` is the **one remaining public bucket** (7 buckets total).
- Two legacy API routes have no gate: `app/api/auto/vehicles` (read-only GET)
  and `app/api/special-request` (POST that only `console.log`s, which puts
  caller-supplied contact details into server logs).
- **56 legacy page routes and 26 legacy `auto`/`docs` API routes are still
  live.** The legacy runtime has not been cut over.
- Two pricing engines are simultaneously reachable — the canonical one and
  `lib/delivery/policy.ts` behind the legacy courier routes.

The two unauthenticated money routes this file used to name —
`/api/create-checkout-session` and `/api/delivery/complete` — **no longer
exist**. So does `/api/delivery/assign-driver` and `/api/test-email`.

### Current status source of truth

**Do not infer current state from this file, a commit message, or the existence
of a route.** Three files carry it, regenerated against a named SHA:

- [`docs/couranr-mvp/IMPLEMENTATION_LEDGER.csv`](docs/couranr-mvp/IMPLEMENTATION_LEDGER.csv) — AUTHORITY, one row per authoritative work item
- [`docs/couranr-mvp/SCREEN_IMPLEMENTATION_LEDGER.csv`](docs/couranr-mvp/SCREEN_IMPLEMENTATION_LEDGER.csv) — AUTHORITY, one row per canonical screen
- [`docs/couranr-mvp/IMPLEMENTATION_STATUS.md`](docs/couranr-mvp/IMPLEMENTATION_STATUS.md) — GENERATED from those two plus a repository scan. Do not edit it; `npm run governance:generate` rewrites it and `check:governance` fails on a byte of difference

`tests/couranr-implementation-ledger.test.ts` enforces their structure: closed
status vocabularies, every work item and screen exactly once, evidence required
for every `complete_verified` row, and **no screen backed by a `ScreenPlaceholder`
page may be classified functional.**

**Whenever a work item materially changes status, update its ledger row and run
`npm run governance:generate` in the SAME commit.** The counts in
`IMPLEMENTATION_STATUS.md` are derived, so the second half is mechanical now —
but the ledger row is still yours to write, and the test enforces the shape, not
that you remembered.

Run `npm run governance:facts` for the current work-item and screen counts. Do
not quote a number from this file: every count it used to pin had gone stale by
the time someone read it.

### Authority chain — the specification wins over the code, always

1. `02_DECISION_REGISTRY.json` **at the repo root** — rank-1 authority for pricing, hours, payer behavior, states, terminology, launch gates. Run `npm run governance:facts` for its record count, byte count and sha256. This line used to pin all three and was corrected twice — the 96,889/`855469d9` fingerprint and the 92,872/`b4b158a0` before it both stopped matching the file, and an earlier note said 40 records, and before that said the file did not exist. Measure it; never quote a fingerprint from prose.

   **There is a second file with the same name.** `couranr_claude_code_package/02_DECISION_REGISTRY.json` is the original v1.0 topic-keyed source (9 KB, no `decisions[]`), unpacked for provenance only. The root file (72 KB) is the expanded generation derived from it and is a verified superset — every pricing value and every state vocabulary in the package copy is present at root, enforced by `tests/decision-registry-provenance.test.ts`. **Cite the root file.** A grep that lands on the package copy will find fewer decisions and no transition rules.
2. `docs/couranr-mvp/PRODUCT_SPEC.md` — **the writable authority** for narrative product doctrine: workflows, actor responsibilities, permissions, lifecycle behaviour, the AI/communication spec and the release acceptance matrix. Every decision record that used to cite the Master Package cites this file now.

   `Couranr_Claude_Code_Master_Package.md` (repo root) is **HISTORICAL**. It is byte-identical to the delivered v1.0 package and is preserved for that reason, but it is not authority: `PRODUCT_SPEC.md` carries its §1–§18 Master Implementation Specification and its AI/Communication and Release Acceptance sections **verbatim**, proven byte-for-byte in both directions by `tests/couranr-product-spec.test.ts`. What was deliberately left behind is execution history — the package README, the repository cutover matrix, the phased execution plan and the Claude Code start prompt. `08_WORK_BREAKDOWN.csv` is not inlined anywhere and exists only in `couranr_claude_code_package/`, which is why that file is preserved.
3. `ui_screen_registry.json` (repo root) — **the writable authority** for canonical MVP screens, their routes, tiers, phases and required states. `UI_SCREEN_REGISTRY.md` and `ui_screen_registry.csv` are GENERATED from it by `npm run governance:generate`; both carry a `GENERATED FILE — DO NOT EDIT` marker and `npm run check:governance` reverts a hand-edit by failing on byte parity. `npm run governance:facts` reports the count.

   **`docs/couranr-mvp/authority/AUTHORITY_MANIFEST.json` says where every other fact lives** — six domains with one writable source each, plus the HISTORICAL and EVIDENCE paths that can never be read as authority. Read it before deciding which file owns something. A file it lists as HISTORICAL carries a de-authorization banner in its own text, enforced.
4. `docs/couranr-mvp/platform-baseline-v1.1/` — platform, dependency, migration-order and rollback authority.

**How to use the chain, before writing governed behavior:**

- **Search the root registry for the applicable decision ID first**, by topic, and read the decision in full. Do not implement pricing, hours, states, proof, terminology or a launch gate from the brief alone — the brief is a work order, the registry is the authority, and where they differ the difference is a decision to surface rather than a detail to resolve in code. The driver-execution slice found `PHO-001` (proof storage, viewers, signed-URL TTLs) and `PRF-001` (what pickup and each drop-off method require) only by looking; both govern behavior the brief also described, and one of them named the bucket to reuse.
- **The package copy must stay consistent with the root registry** wherever both carry the same decision. `tests/decision-registry-provenance.test.ts` enforces that the root file is a superset. If a change would make them disagree, that is a registry change, not a code change.
- **Current code is shipped-state evidence, not authority.** It tells you what is running today. The moment it conflicts with the registry, the Master Package or the screen registry, the code is the defect — record what it does, then implement what the authority says.

**Legacy repository behavior never overrides these.** Where the code and the spec disagree, the spec is right and the code is the defect.

**Pricing is now Couranr Pricing Authority V2** (PRC-005, MIL-003, MIL-004, SUR-003, SUR-004, REF-003, TRF-001, ECO-001): `$7.99` base covering the first `2.000` loaded miles, `$1.25`/mi over 2 through 10, `$1.50`/mi over 10 through 25, review above 25; weight included through 25 lb, `+$3.00` through 50 lb, Large Item review above; priority `+$5`, rush `+$10`, overnight `+$30` request-only, signature `+$3`; predicted traffic delay free for 5 minutes then `$0.45`/min, review above 25 minutes. Policy version `couranr-pricing-v2-2026-09-01`.

The old `$22.99` / 3 miles / `$2.25–$4.75` model is **historical**: quotes minted under `couranr-pricing-2026-07-31` keep it forever and are read from their stored line items, and both the engine and the database refuse to mint that version again. The `$15` / 4 miles / `$1.75` legacy calculator and the `/courier` funnel that used it are **deleted**, not quarantined.

**Service-area truth (corrected 2026-09-03).** The canonical Couranr Business route authority is the exact launch-market classifier from PR #38, `lib/couranr/routing/market.ts`: Washington DC, Stafford VA, Woodbridge VA and Fredericksburg VA, and BOTH endpoints must sit inside one of those exact markets for an automatic quote — anything outside or surrounding is `needs_review`. `lib/serviceArea.ts` (a 60-mile radius from Stafford) is stale legacy debt whose only remaining importer is the legacy `components/SiteFooter.tsx`; it is not authority for any canonical route and must not be made authoritative again. Do not redesign the PR #38 classifier.

Product is being transformed from a mixed auto-rental / document-services / generic-courier app into one focused product: **Couranr, local delivery infrastructure for local businesses**. The auto and docs domains are legacy and slated for quarantine, not extension.

## Commands

```bash
npm run dev          # next dev
npm run build        # next build — FAILS without env vars, see below
npm run lint         # next lint (ESLint 8 + next/core-web-vitals). Next 16 removes `next lint`.
npm run typecheck    # tsc --noEmit — passes, but tsconfig has "strict": false
npm run test         # vitest (watch)
npm run test:run     # vitest run
npm run check        # lint && typecheck && test:run && build
npm run ci:local     # THE GATE — see "GitHub Actions is NOT the gate" below
```

There are **36 scripts**. The platform baseline specifies 32. Of the 13 gate commands the release matrix names, most now EXIST and pass: `check:routes`, `check:rls`, `check:legacy-imports`, `check:migrations`, `check:gates:controls`, `db:reset`, `db:test`, `test:deploy-safety`. Still absent: `test:security` and `test:payments`. Do not invent a script that pretends to pass — a check that cannot fail is worse than no check.

**`npm run build` succeeds with no `.env.local` present** — verified twice at `401b3ee` in a container that had none, compiling 91 static pages. The old failure (a module-scope Supabase client whose constructor threw `supabaseUrl is required` during page-data collection) is fixed for the build path. `lib/supabaseAdmin.ts` is the lazy pattern to copy. ~61 module-scope `createClient(` call sites still exist across `app/` and `lib/`; they no longer break the build, but they remain the reason a route can hold a client it never re-scopes.

Tests use **Vitest**, not Jest and not `node:test`. Files live in `tests/*.test.ts(x)`, alias `@` → repo root. **jsdom IS configured** — `environmentMatchGlobs` applies it to `tests/**/*.dom.test.tsx` while everything else stays in `node` — and **@testing-library/react and @testing-library/user-event ARE installed**. Browser tests run through **Playwright** from `e2e/run.mjs` (groups A–Q), not through a Vitest project. `testTimeout` is 15s because a jsdom render can miss the 5s default under parallel load. There is still no Vitest `projects` config, so the four `test:*` project suites the baseline names do not exist.

**`db:test` NOW EXISTS** (`node e2e/disposable/dbTest.mjs`, 35/35 passing, plus `check:rls` for the privilege subset) and stands up its own disposable PostgreSQL, so calling a `couranr_*` command is a one-liner rather than a manual cluster build. It is still not wired into `npm run check`, so `npm run check` alone still executes no `couranr_*` command. There is still no pgTAP — which is mandatory before a SQL command is done, and "Execution verification" below explains what it cost to learn that. `e2e/` drives the browser; nothing yet drives the SQL.

**Runtime versions drift two ways now:** local Node 22, **CI Node 24** (`.github/workflows/ci.yml:35`) which matches the target. The old CI-Node-20 mismatch is fixed. There is still no `.nvmrc`, `.node-version`, `engines`, or `packageManager`, and `package-lock.json` is lockfileVersion 2 against a target of 3 — so a dependency whose engines require ≥24 installs in CI and fails locally.

### GitHub Actions is NOT the gate — `npm run ci:local` is

**The account's Actions allowance is exhausted most months.** This is a recurring
billing condition, not an incident, and it makes GitHub CI unusable as a gate:

- When the allowance is gone, workflow runs **fail for billing reasons that look
  exactly like code failures** in the checks UI, or they **do not start at all**.
- A check that never ran and a check that passed look the same at a glance on a
  PR. Neither says anything about the code.
- The reset date is not something this repo controls or tracks.

So: **run the gate locally, before every push, and report the local run.**
Owner decision 2026-09-03: until the MVP is built the per-push gate is
`npm run ci:local -- --db` (tiers 1–3). `--all` adds the browser tier and runs
once at MVP completion, not per push.

```bash
npm run ci:local                 # tiers 1–2, ~45s, needs no external process
npm run ci:local -- --db         # + the disposable-PostgreSQL suites
npm run ci:local -- --browser    # + the Playwright gates (needs a build first)
npm run ci:local -- --all        # everything
npm run ci:local -- --list       # what each tier contains
```

`scripts/ciLocal.mjs` runs a **superset** of `.github/workflows/ci.yml`. Tier 1
is that workflow exactly — lockfile, lint, typecheck, unit tests, build. Tiers
2–4 are work the runner could not do even with budget: the repo's own `check:*`
gates, the disposable-PostgreSQL suites, and the browser gates, which need
Supabase and Stripe credentials Actions does not have.

Two things it enforces on itself, both from defects already shipped here:

- **It never silently skips.** Every stage runs or is printed as skipped **with
  its reason**, and the summary lists the skips above the verdict. A stage that
  quietly does nothing reads as a pass.
- **It reads the counts, not just the exit code.** A stale `node_modules` once
  dropped 84 test files while vitest printed "passed" and exited 0. The test
  stage parses `Test Files X passed (Y)` and fails unless X = Y.

`ci:local --self-test` proves the runner can go red and is registered in
`check:gates:controls` with every other gate.

**Prerequisite that does not survive a container reset:** tier 3 spawns
PostgREST. Without the binary every tier-3 suite dies on an identical unhandled
`ENOENT` — ten stack traces that look like ten code failures and are one missing
tool. `npm run provision:postgrest` installs it (pulls the official image layer
from Docker Hub over plain HTTPS, digest-verified, no daemon). `ci:local`
detects its absence and reports it as a prerequisite instead of running into it.

**Rules for reading GitHub's checks, when you look at all:**

1. **Never report "CI is green" as evidence that anything works.** Report what
   `ci:local` ran and what it did not.
2. **Never read a red GitHub check as a code defect without opening the job
   log.** Distinguish a billing/quota failure from a real one before acting, and
   never "fix" code to chase a red check you have not diagnosed.
3. A merged PR with no checks is normal here. It is not evidence of anything
   either way.

For the record, because this file has carried the opposite claim: the workflow
itself is correctly configured — it triggers on `main`, `codex/**` and
`claude/**` and on PRs into `main`, and it runs `npm ci` rather than
`npm install`, so a desynced lockfile fails rather than being resolved away.
Those were real limitations once and are fixed. The problem is not the
workflow's contents; it is that it cannot be relied on to run.

**What no CI configuration could cover**, and what therefore only ever happens
locally: the browser gates (`test:pub001`, `test:pub-family`,
`test:shell-chrome`, `test:fonts`) and the SQL execution suites. This is not
theoretical — running tiers 3 and 4 locally immediately caught a stale sticky-
chrome assertion in `e2e/shellChrome.mjs` that had already reached `main`,
because Actions has never once executed that file.

## Migrations and the database

**Migrations exist and are fully applied.** `supabase/migrations/` holds **48 forward migrations**, with paired rollbacks in a separate `supabase/rollbacks/` directory (48 files), and the live project reports **48 applied**. Every forward migration has an applied row. Still missing: generated types (`types/database.generated.ts` does not exist, so every Supabase query is untyped) and a reproducible `db:reset`. The live database now has **54 public tables and 6 views**, of which **18 are `couranr_*`** with **62 `couranr_*` functions**.

Do not write a migration without it being reviewed first. When migrations do land they must be additive (`add column if not exists`, `create table if not exists`) and must never drop a table, drop a column, or delete data.

Known code/database drift: `business_pricing_profiles` is queried by `lib/businessPricing.ts:28-46` and defined in `docs/business-portal-schema.sql:61-73` but **does not exist in the database**. The error is swallowed at `:44-46`, so business-account pricing has been silently inert in production. That swallow-and-continue pattern recurs — see `resilientUpdateById` below.

## Architecture

### Supabase clients — five patterns, and the one that is a bug

| Pattern | Where | Note |
|---|---|---|
| Browser cookie client | `lib/supabaseClient.ts:6` | `"use client"`, **47 importers** |
| Auth-helper server/route clients | 4 sites | `app/driver/layout.tsx:11`, `app/portal/page.tsx:9`, `app/api/admin/deliveries/route.ts:8`, `app/api/driver/my-deliveries/route.ts:8` |
| Service-role proxy | `lib/supabaseAdmin.ts:22-38` | lazy, correct |
| **Ad-hoc inline service-role `createClient`** | **47 route files** | the real consolidation work |
| Anon client + forwarded Bearer token | 6 admin routes | e.g. `app/api/admin/drivers/route.ts:14` |

**47 of 141 API routes use the service-role key**, which bypasses RLS entirely — every one must re-scope its own queries. **Only 2 of 141 have no auth, gate, signature or token marker**, both legacy (`app/api/auto/vehicles`, a read-only GET, and `app/api/special-request`, a POST that only `console.log`s its caller's contact details). **Zero canonical routes under `app/api/couranr` are ungated** — `npm run check:routes` measures this over all 70 canonical routes and is part of the gate.

**The bug this section used to name is GONE, by deletion rather than by repair.** Six server-context files imported the `"use client"` browser client — a browser client in a server route carries no JWT, so it authenticates as **`anon`**, not `authenticated`, which is why `/api/delivery/complete` returned 403 and almost certainly never captured a payment. All six (`lib/delivery/authorizeDeliveryPayment.ts`, `lib/stripe/capturePayment.ts`, `lib/delivery/completeDelivery.ts`, `lib/delivery/getDeliveryByOrderId.ts`, `lib/getUserRole.ts`, `app/api/delivery/complete/route.ts`) no longer exist — measured at `304db8d`, along with **zero** current importers of the browser client anywhere under `lib/` or `app/api/`. Do not go looking for these files. The FAILURE MODE is still worth knowing, because nothing structurally prevents it from being reintroduced: there is no lint rule barring a `"use client"` import from a server module.

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

Seven buckets. **`vehicle-images` is the only public one now** — `delivery-photos` was hardened to `public = false` with a 10 MB limit and an image-only MIME allow-list, so it and `renter-licenses` are the two buckets that constrain uploads. There are **4 storage policies total, all scoped to `docs-files`** — the other six buckets have none, which means service-role-only for the private ones and world-readable for the public ones. The two pickup-photo upload routes disagree: `app/api/delivery/upload-pickup-photo/route.ts:197` builds a **public** URL, `app/api/customer/upload-pickup-photo/route.ts:125` builds an `/object/authenticated/` one.

### Routes

Route counts move with every slice, so they are GENERATED: `docs/couranr-mvp/IMPLEMENTATION_STATUS.md` carries page and API routes split canonical/legacy, counted at render time. A canonical route existing still proves nothing about the capability behind it — some canonical pages render `ScreenPlaceholder`, and the screen ledger is what says which. Auto and docs are **legacy — quarantine targets, not extension points**.

Since LEG-004 the public route ownership is `/` PUB-012, `/business` PUB-001, `/businesses` PUB-009, `/sameday` PUB-013, `/send` and `/estimate` PUB-004, and the merchant application lives under `/app/business/*`. Public chrome is chosen by SERVER route-group layouts — `(master-public)`, `(business-public)`, `(consumer-public)`, `(token-public)` — never by `usePathname()`.

Of the 43 canonical target routes in the Master Package, **2 exist** (`/`, `/driver`) and 41 do not. Target names differ from actual: `/sign-in` and `/sign-up` vs. the existing `/login` and `/signup`.

### CSS and components

One stylesheet: `app/globals.css`, 818 lines of plain CSS with 7 custom properties. No Tailwind, no PostCSS, no `components.json`. **776 inline `style={{…}}` props** against 707 `className=` attributes. Eleven components, **zero UI primitives** — none of the 27 the baseline requires. `lib/cn.ts` exists but is a naive `filter(Boolean).join(" ")` with no importers.

When the canonical design system arrives it must be **additive** — new route group, namespaced `--couranr-*` tokens (the existing `:root` already defines `--border`, `--muted`, `--card`, `--shadow` with different values, so unprefixed tokens would silently restyle every legacy page). Do not bulk-restyle legacy auto/docs pages.

The canonical screens reference `canonical-mvp-images/**` paths; **13 of the 62 referenced files exist on disk** (an earlier note here said 0, which stopped being true once the delivered mockups landed). The 91 UUID-named PNGs at the repo root are the raw source set, and **`docs/couranr-mvp/ui-reference/CANONICAL_SCREEN_SOURCE_MAP.tsv` is the map to use** — 107 rows, every source present, every canonical screen ID, with alternates recorded and non-MVP assets classified `BRAND:`/`EXTRA:`.

`docs/platform-dependency-baseline-v1-1` carries a rival `canonical-source-map.tsv`. **Do not merge it** (PR #16, closed 2026-08-01) — not because it is dangerous to `main`, but because it is strictly worse and it re-arms a workflow:

- 62 rows against 107; **9 of its sources do not exist**; it conflicts with the registry on 6 screen IDs, **invents** `driver-management` and `customer-hosted-delivery-request`, and **drops** `ask-couranr-lead-inbox` and `delivery-estimate-and-hosted-request`.
- The 6 conflicts are **not** an off-by-one shift — displacements are `+5, +1, +1, +6` with two runs snapping back to `+0`. It is a fabricated ordering. All six screens now exist on disk under their **registry** names, so the registry is confirmed by the delivered art.
- Its workflow adds an unconditional `find … -delete` matching **91 of 91** root PNGs. Scope it correctly: `checkout ref:` and `git push origin HEAD:` are both hardcoded to `docs/platform-dependency-baseline-v1-1`, so the blast radius is that branch, not `main`. It is currently unreachable only because `test -f "$source"` aborts on the first missing source — verified by a real run (`30569664998`, step 4 failed in 1s, step 5 skipped). Repairing the map arms it.

**`main` carries its own copy of `materialize-canonical-ui-images.yml`.** It has no delete step, but it holds `contents: write`, `rm -f`s itself and pushes to the docs branch. It is inert *only* because its trigger path `docs/couranr-mvp/ui-reference/canonical-image-payload/READY` exists on no ref — that file lives solely in the unreachable commit `31e1728`. Restoring that payload to the docs branch fires it. Accidental safety, not a guard.

Never delete a root PNG.

## Working practices

### Finish the mission — use every method available

When you are given a mission, **carry it out**. An obstacle is a problem to solve, not a result to report. Reaching for a second or third approach after the first one fails is the expected behaviour, not an escalation.

If a mechanism will get the job done, use it: a relay, a shim, a harness, a fixture, a different client, a local server standing in for a remote one, driving a thing from Node that the browser cannot do itself. **You do not need permission to be resourceful.** Build the thing that makes the verification possible and then do the verification.

The worked example is `e2e/supabaseRelay.mjs`. Chromium in this container cannot open an outbound connection to any external host, so the browser could not sign in and the entire auth suite looked untestable. "The browser cannot reach Supabase, so this cannot be verified" would have been a true sentence and a failed mission. Intercepting the page's requests and satisfying them from Node — which can reach Supabase over ordinary verified TLS — made every auth assertion runnable. That is the standard: find the path, build it, finish the job.

Two things this does **not** license, because they are the outer edge and they do not move:

- The named safety boundaries stay closed — never disable TLS verification, never unset `HTTPS_PROXY`, never run an exploit or a destructive negative test against production data, never widen a deliberately narrow grant to make a test easier. A workaround that crosses one of those is not resourcefulness; it is the wrong answer.
- Never fake the result. A relay that makes a real request is a method; a stub that returns the answer you wanted is a lie. If a workaround changes what the test actually proves — as the relay does, since it bypasses the production network path — **say so in the report** and name the gap.

When you genuinely cannot finish, the report says what you tried and why each attempt failed. "It could not be done" is only credible with the attempts attached.

### Deliverables — combine many files into one

When a deliverable would be several files, **combine them into a single file**. Delimit each part with `<!-- ===== FILE: <name> ===== -->` and put executable content (SQL, JSON) in fenced blocks so it stays copy-pasteable, then verify the embedded blocks are byte-identical to their standalone form and that an extraction command round-trips them. One file, not eleven.

### Git

Work happens on the designated `claude/*` branch. `main` is `9c0a63bd5284e065978860b8893c170478fab1f5`; preservation refs `archive/auto-docs-multiservice` (branch, at that SHA) exist.

**Tag pushes fail with HTTP 403 in this environment.** Annotated tags, lightweight tags and `git push --tags` are all rejected by the git proxy while branch pushes to the same remote succeed in the same command, and no GitHub MCP tool creates tags or refs. The two required preservation tags exist locally only. Don't burn time re-litigating this — use a branch as the durable pointer, or ask the operator to create the tag in the GitHub UI.

**PUSH IMMEDIATELY AFTER EVERY COMMIT. No exceptions.**

This container is recycled without warning, and a recycle restores the repo
from the REMOTE. A commit that exists only locally is not saved — it is
pending deletion. This has already destroyed a completed database-layer
commit mid-session: the work was committed, the container reset, and
`git cat-file -t <sha>` came back `Not a valid object name`.

`git commit` and `git push` are one step, not two. Do not batch pushes to the
end of a slice, and do not leave a commit unpushed while running a long
verification.

**WRITE THE MIGRATION FILE AND COMMIT IT BEFORE CALLING `apply_migration`.**

A migration applied through the Supabase MCP lives on the server and survives
a container reset. Its `.sql` file does not. Applying first and writing the
file afterwards means any reset in between leaves the database ahead of the
repository with no record of what changed — which is exactly the
"zero migrations, schema applied by hand through the SQL editor" condition
this project is trying to climb out of.

If it has already happened, recover by regenerating the file from the live
schema — `pg_get_functiondef`, `pg_get_constraintdef`, `list_migrations` —
rather than from memory, so the file provably matches what is running.

### Supabase MCP

The connected project is **`Couranr -OS` (`zrdxlrlqxdslqpnoqmus`)**, PostgreSQL 17.6.1.063, `us-east-1`. Three other projects in the same org (`website builder`, `rental-software`, `dropshipping`) are **not** Couranr — check the ref before running anything.

Read-only catalog queries via `execute_sql` are the right way to establish database facts; `list_tables`, `list_migrations` and `get_advisors` are all useful. `get_advisors` output exceeds the tool's token cap — it is written to a file, so parse it with `python3`/`jq` rather than reading it whole.

**Never run an exploit or negative test against production data.** No marking a real order paid, altering a fee, deleting an address, or forging an audit event to prove a vulnerability. Use a Supabase branch, a restored scratch project, or synthetic fixtures.

### Cost discipline — verify hard, report short

The owner stopped this session in 2026-08 because a batch burned ~4M subagent
tokens and hours of wall clock. The verification was not the problem; the
machinery around it was. Keep the things that have actually caught defects and
drop the things that only produced narrative.

**Keep, because each of these caught a real bug that reading did not:**

- `npm run check` (lint, both typechecks, tests, build) before every push. Read
  `Test Files X passed (Y)` and require X = Y — a stale `node_modules` once
  dropped 84 tests while printing "1548 passed", which reads as success.
- Executing SQL against the disposable database. A migration that applies is
  not a migration that works: `test:release` caught a hold that could never be
  released again, and only a concurrency probe caught the mutex.
- Driving the UI or the route in a real browser. This found a nested-key read
  and a broken replay path that 1632 green tests and a clean typecheck missed.
  **DEFERRED to MVP completion by owner decision 2026-09-03** — not per slice.
  Until then a jsdom functional test that drives the real component against a
  recorded fetch is the stand-in.
- Verifying a production claim with a catalog query rather than an apply's
  success flag.

**Drop, unless the owner asks:**

- Multi-agent workflows and subagent fleets. One adversarial review cost 2.2M
  tokens. It did find two real defects — so if a slice touches money and you
  cannot get independent eyes any other way, ask first and say what it will
  cost. Never as routine.
- PR activity subscriptions. Every bot deployment notification wakes the
  session with a full context load; a day of them is dozens of wakes carrying
  no information.
- Scheduled check-ins that re-read state and re-report.
- Long reports. A few lines: what changed, what proves it, what is still open.

The rule of thumb: **spend on execution, not on narration.** Running the thing
is cheap and finds defects; describing it at length is expensive and finds
none.

### Research before deciding — validate reasoning against sources

**Browse the internet BEFORE planning, and before starting a PR.** Not after,
and not only when stuck. Open the current primary documentation for whatever
the change touches — the pinned library version, the provider's API, the
platform behaviour — and let the facts you find shape the plan while it is
still cheap to change.

**Improvise when what you find is better than the plan.** A plan written from
memory is a hypothesis. If the current documentation shows a better mechanism,
a newer supported shape, a constraint that makes the intended approach wrong,
or simply a shorter correct path, take it and say in the report what changed
and which source changed it. Following a plan you now know to be worse is not
discipline, it is a slower way to be wrong.

The boundary is unchanged: this governs TECHNICAL reasoning. It never
overrides the authority chain, and it is never a route to settling an
unresolved product decision. Pricing, hours, states, payer behaviour and
terminology come from the registry and the Master Package; where those are
silent the answer is still "unresolved", no matter what a web source says.

Two situations require looking something up rather than reasoning from memory:

1. **Any deviation** from what was asked — a different approach, a narrower or wider scope, a refused step.
2. **Any decision left to your judgment** — "use your best judgement", "do it the better way", or a gap the instructions simply do not cover.

In both, form the answer from **sources, not instinct**, and say in the report what you found and where. Reasoning that cannot be traced to either a command you ran or a document you read is a guess, and this repo has already shipped several confident guesses.

**Split the question before researching. The two halves have different authorities.**

| Question | Answer comes from | Never from |
|---|---|---|
| How does *this* codebase or database behave? | A command whose output you saw — `execute_sql`, `grep`, a test | The web. It does not know this project |
| How does *the tool* behave? | Primary docs for the pinned version | Memory, or a blog post about a different major version |
| What should the product do? | The authority chain below — registry, Master Package, screen registry | Any web source. A blog post is not authority for pricing, hours or states |

The first row is not a formality. Every published guide about Supabase RLS says a policy protects a table; only a catalog query revealed that this project's `pg_default_acl` grants `arwdDxtm` to `anon`, `authenticated` **and** `service_role` on every new table and function in `public`, which makes a narrow `GRANT` a silent no-op. No amount of reading would have found that. Equally, `service_role` has `rolbypassrls = true` here, so RLS constrains none of the server commands — the `GRANT`s and per-query scoping are the real boundary.

The second row is where memory has actually failed. Both cost time and were one lookup each — and looking them up afterwards produced a better answer than the one reasoned out:

- **A composite `IS NOT NULL` is true only when the row is non-null *and every field* is non-null.** `select fn(...) is not null` reported `false` for a request that had been created correctly, because a draft has a null `submitted_at`. Worse, `IS NULL` and `IS NOT NULL` are **not inverses** for row values — a row with mixed null and non-null fields returns `false` to both. To test whether a composite result exists, use `row is distinct from null`, which the documentation recommends for exactly this. ([PostgreSQL 17, §9.2](https://www.postgresql.org/docs/17/functions-comparison.html))
- **A user-defined `SQLSTATE` may be any five digits and/or upper-case ASCII letters except `00000`**, which makes the `CR403` / `CR404` / `CR409` / `CR422` codes used by the Couranr command functions legal. The documentation adds a rule that was not reasoned out: **avoid codes ending in three zeroes**, because those are category codes and can only be trapped as a whole category. ([PostgreSQL 17, §43.9](https://www.postgresql.org/docs/17/plpgsql-errors-and-messages.html))

**Pin the version when you search.** As of B01 (2026-08-06) this repo is Next.js 16.3.0 (Turbopack), React 19.2.8, TypeScript 5.9 — `"strict": false` globally but **strict for the canonical trees** via `tsconfig.canonical.json` (`npm run typecheck:canonical`) — Vitest 1.6, @supabase/ssr 0.12.4 + supabase-js 2.112.1 (auth-helpers is GONE; sessions are `base64-` cookies and `proxy.ts` refreshes them), ESLint 9 flat config (`next lint` no longer exists), PostgreSQL 17.6, and **Stripe 15.12.0 frozen**. An answer written for Next 15, React 19 or a later Stripe SDK is wrong here even when it is correct in general. Prefer primary sources — PostgreSQL, Next.js and Supabase documentation — over aggregators.

Research informs **technical** reasoning only. It never overrides the authority chain, and it is never a route to settling an unresolved product decision: where the registry is silent, the answer is still "unresolved".

### Execution verification — MANDATORY for anything that touches the database

**A SQL command is not done until it has been CALLED against a real database with a real row.** Applying cleanly proves the migration parses. Passing the suite proves the text matches what a test expects to read. Neither proves the thing runs.

This rule exists because a foreign key on `couranr_conversation_participants` pointed at `couranr_delivery_access_tokens` when the function writing it inserted a `couranr_help_access_tokens` id. **Every Delivery Help redemption failed with a foreign-key violation, and P8-004 could never have worked for a single customer.** It survived 1230 passing tests, a full 35-migration forward-and-back round trip, and a browser run — because every test of that slice was static: SQL text assertions, TypeScript source scans, and a browser run whose API layer was stubbed with `page.route`. A constraint that only fires on `INSERT` is invisible to all of them.

The defect class is specific and recurring: **anything that is only checked at execution time.** Foreign keys, `NOT NULL`s, `CHECK`s, defaults, trigger bodies, `%TYPE` mismatches, an `OUT` parameter colliding with a column name (42702), a composite `IS NOT NULL` on a row with a null field. Every one of these is invisible to a text assertion and fatal at runtime.

So: **call the function, with a fixture that satisfies its constraints, and read what came back.** Every named command, every path through it, once.

- A local PostgreSQL is enough and is free — `initdb` as the `postgres` user, apply the migration sequence, stub the two tables no migration creates (`business_accounts`, `auth.users`). Reproduce `pg_default_acl` and `service_role`'s `BYPASSRLS` or the grant tests prove nothing.
- **Building the fixture IS the work.** A `NOT NULL` you have to satisfy to make the call is the schema telling you what the command actually requires. Three fixture failures in a row is not a reason to fall back to reading the code — it is the reason the bug is still there.
- **A test that reads SQL text is a guard on the file, not a guarantee about the database.** Both are worth having. Only one of them catches this.
- Report which functions you executed and which you could not, and why.

### Browser verification — DEFERRED until the MVP is built (owner decision 2026-09-03)

**Owner decision, 2026-09-03: do NOT run browser/Playwright verification per
slice or per push until the MVP is fully built.** It was costing hours per pass
and the owner has chosen to run all of it once, at MVP completion. Until then:

- The per-push gate is `npm run ci:local -- --db` (tiers 1–3). The browser
  tier (`--browser` / `--all`) is NOT part of the per-push gate. If a brief
  asks for a browser drive, skip it and say so in the report.
- The verification budget goes to **code quality: bugs, duplication, races and
  concurrency**, and those MUST be fully tested — executed unit tests with
  mocked providers, disposable-PostgreSQL suites that CALL every SQL command,
  concurrency probes (two callers on the same row), and independent adversarial
  review of money-moving diffs. A jsdom functional test (`tests/**/*.dom.test.tsx`)
  is the accepted stand-in for a UI regression.
- Everything below this paragraph describes how the browser gates work and
  what they have caught. It stays here for the MVP-completion pass; it is not
  a per-slice requirement any more.

**A UI deliverable is not done until it has been driven in a real browser.**
*(Deferred to MVP completion — see the owner decision above.)* Green unit tests, a passing typecheck and a 200 from `curl` are all necessary and none of them are sufficient — every one of those passed while `/sign-in` was a placeholder, while "Sign out" was a `<Link>` that left the session live, and while a failed workspace lookup rendered as "you have no business". A jsdom test asserts what a component returns; only a browser proves what a person can actually do.

So: **seed data, start the dev server, drive the UI, assert on what rendered.** Every time.

**How.** Chromium is pre-installed at `/opt/pw-browsers` with `PLAYWRIGHT_BROWSERS_PATH` already set — do **not** run `playwright install`. Playwright is installed globally (`/opt/node22/lib/node_modules/playwright`), not as a repo dependency, so import it by absolute path from a scratchpad script. Prefer the browser MCP tool when the session has one authorized; fall back to driving Playwright from Node when it does not. Run against a `npm run dev` server on `localhost`, which is what lets you test unreleased code and inject faults.

**Seeding.** Use the service-role key to create the accounts, memberships and rows a scenario needs, because `service_role` is the only identity that can. Rules:

- Every seeded row must carry an obvious synthetic marker (an `e2e` email tag, a prefixed business name) and must be recorded so it can be removed.
- **Never mutate a real row to set up a test.** The connected project holds real data — 42 `orders`, 29 `deliveries`, 94 `addresses`, 28 `rentals`. Create new synthetic rows next to them; never repurpose theirs.
- Clean up what you created, and report anything you deliberately left behind.

**Fault injection belongs in the browser, not the database.** To test a fail-closed path, intercept the request at the page (`page.route(…)` returning a 500) rather than breaking a table. That exercises the exact branch with zero blast radius. Dropping a privilege or corrupting a row to "see what happens" is never the move against a live project.

**Evidence.** Screenshot each meaningful state and say which assertion each one backs. A screenshot with no assertion is decoration; an assertion with no screenshot is a claim. Report the states you could not reach and why.

**Unchanged safety boundary:** never disable TLS verification and never unset `HTTPS_PROXY` to force something through. If a browser cannot reach an external host, that is a result to report, not an obstacle to bypass.

**Four harness facts that each cost real time to learn.** All measured, not reasoned:

- **Geolocation needs BOTH halves.** `newContext({ geolocation })` alone is `PERMISSION_DENIED`; `grantPermissions(["geolocation"])` alone is `TIMEOUT`. You need both, and `freshContext({ geo })` in `e2e/run.mjs` takes them as an opt-in so no existing group's branch changes. Every arrival command and `couranr_complete_pickup` hard-refuse without coordinates, so a group that skips this scores a correctly-gated button as a defect.
- **`useLocationCapture` asks on demand, never on mount** — by design, because a prompt that fires on load is dismissed reflexively and the dismissal is sticky. A harness must press **"Share location"** first. That is the product working, not a workaround.
- **Wait for the control, don't count it.** `goto(…, "domcontentloaded")` returns before React hydrates, so a bare `locator.count() === 0` means "not yet", not "absent". This silently skipped a click and produced two false product-defect reports in one session.
- **Proof upload works in this container.** The relay matches `**://<host>/**` — the whole Supabase host, storage included — and forwards `postDataBuffer()` verbatim, and `createSignedUploadUrl` returns an absolute URL on that host. `setInputFiles({buffer})` keeps the bytes in the page. Assert on `couranr_delivery_proofs.byte_size` and the stored object, **never on `put.ok`** — that is the value that lied for the entire life of the flat-ticket bug.

**The stranded-driver trap.** From `at_pickup` onward **nothing ends an assignment except completing the delivery**: `couranr_unassign_delivery_before_pickup` closes at `at_pickup`, and `couranr_replace_delivery_assignment` refuses unless the delivery is still `assigned`. A run that dies mid-pickup therefore strands its driver `on_delivery` forever and every later run fails in setup. If you drive a delivery past `at_pickup`, **drive it to `delivered`** before you finish. Do not unstick it by writing a column or widening a grant.

### Conventions worth matching

- **Amounts are integer cents, computed server-side.** `app/api/delivery/start-checkout/route.ts:180-186` is the model: it recomputes the price server-side and discards the client's `totalCents` entirely. Never trust a client-supplied amount — `/api/create-checkout-session:10` does, and that is the P0.
- **Distance is validated server-side** via Google Maps (`getDrivingMiles`, `start-checkout:54-92`). `/api/delivery/quote:21-47` does **not** validate its `miles` input — don't copy that route.
- **Every state transition should be a named server command** with the actor verified, the current state checked, and the transition allow-listed. No route should accept an arbitrary target status. `/api/delivery/mark-in-transit` was the counter-example and has since been hardened: it resolves the actor with `getUserFromRequest`, requires the assigned driver or an Operations admin, checks `canTransition`, guards the write on the current state and records the event — and its target status is fixed by the route, never read from the body. It has **no automated test**, so it is recorded `complete_unverified` in the ledger.
- **To test whether a composite/row result exists, use `row is distinct from null`.** `row is not null` is true only when every field is non-null, so it reports `false` for any valid draft — a draft has a null `submitted_at`. The four `couranr_*` command functions all return a composite.
- **A server-side Supabase client must opt out of Next's Data Cache.** Next patches global `fetch` in the App Router; with the default `fetchCache: 'auto'` and `revalidate: false` a GET can be cached indefinitely, and `dynamic = "force-dynamic"` does **not** change that — the Next 14.2 docs describe it as forcing dynamic *rendering* and say nothing about the Data Cache, unlike `dynamic = 'error'`, which spells its fetch equivalences out. Every PostgREST read is a GET with its filters in the query string, so the cache key is stable per query. `/api/couranr/driver/assignment` was observed answering `assigned: null` from a response cached before the assignment existed — a dev-server restart did not clear it and deleting `.next/cache/fetch-cache` did. `lib/supabaseAdmin.ts` now passes `global: { fetch }` forcing `cache: "no-store"`, which supabase-js threads into PostgREST, auth, storage and functions alike. The ~45 ad-hoc inline service-role clients in legacy routes do **not** have this and carry the same hazard.
- **`getByLabel` matches label TEXT, `getByText` matches case-insensitive SUBSTRINGS.** Neither uses the accessible name, so `aria-hidden` is ignored: a required `Field` renders `"Driver*"` and `/^Driver$/` matches nothing (use `fieldLabel()` in `e2e/run.mjs`). And `getByText("Your delivery")` matches `LoadingState`'s visually-hidden `"Loading your delivery"`, so a wait resolves against the skeleton and the following `ctx.close()` cancels the fetch in flight. Wait on content that exists only in the loaded state.
- **Every canonical route nests its payload under a named key, and the client must read that key.** `{ delivery: … }`, `{ proof: … }`, `{ upload: … }`, `{ handoffCode: … }`, `{ outcome: … }`. Typing one flat is invisible to `tsc` — the routes return untyped JSON — and the failure is silent rather than loud: `ticket.value.signedUrl` was `undefined`, `fetch(undefined)` resolved against the *page* URL, Next answered an HTML page with **200**, so `put.ok` was true and the client "succeeded" having uploaded nothing. Proof upload was dead from the day it shipped. When you add or change a route, check the client's `call<…>` generic against the route's actual `NextResponse.json({ key: … })`, and prefer a test that asserts on the request leaving the browser over one that mocks the call away.
- **Test-mode endpoints must be gated server-side.** `app/api/docs/test-mark-paid/route.ts:17-23,47-49` is the correct pattern: `if (IS_PROD || !TEST_MODE) return 403`. `/api/test-email` is the counter-example — unauthenticated, and it sends live mail to a hardcoded fallback address.
- **Never expose secrets to the browser or put them in analytics, logs, or notification copy.** `NEXT_PUBLIC_SUPABASE_URL` is (correctly but confusingly) used as the URL for service-role clients throughout — the key is what must never cross the boundary.
- **Say "Couranr", never founder or personal-operator language.** Use Couranr review, Couranr confirmation, Couranr Operations Queue, Couranr-managed dispatch, Couranr Support.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

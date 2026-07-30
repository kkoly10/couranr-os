# 00 — Gap report

Phase 0 baseline. Findings are stated as observed; inferences are labelled.

## 1. `npm run build` FAILS — exit 1

```
Error: supabaseUrl is required.
  at 44219 (.next/server/app/api/auto/create-checkout-session/route.js)
> Build error occurred
Error: Failed to collect page data for /api/auto/create-checkout-session
```

**Cause.** `app/api/auto/create-checkout-session/route.ts:9` constructs a Supabase client at **module scope**. During `next build`'s "Collecting page data" phase the module is imported, the constructor runs, and it throws because no Supabase environment variable is set in the build container (all four checked variables are `ABSENT`).

**Scope.** 18 module-scope client constructions across 15 files, including `app/api/stripe/webhook/route.ts:15`, `app/api/delivery/start-checkout/route.ts:17`, `lib/auth.ts:4`. Any one of them can fail a build the same way. `lib/supabaseAdmin.ts:4-7` explicitly documents lazy initialisation to avoid exactly this, so the correct pattern already exists in the codebase.

**Interpretation.** This is an environment-dependent failure: with production environment variables present the build very likely succeeds, which is consistent with the app being deployed today. It is nonetheless a real fragility — the build cannot be reproduced in a clean container without secrets, which conflicts with the platform baseline's requirement that CI run `npm ci` and `npm run build` from a clean clone. **Not repaired in Commit 0** — recorded as baseline evidence.

## 2. Lockfile reproducibility — repaired in this commit

Before: `npm ci` failed `EUSAGE`; `eslint`, `eslint-config-next` and `vitest` were declared in `package.json` but absent from the lockfile. CI used `npm install`, so the committed lockfile had never been validated.

After: `npm ci` succeeds. 424 packages added, **all `dev: true`**; 0 removed; `package.json` byte-identical; root production dependencies byte-identical. Three production transitives moved, all patch, all forced by deduplication with the new dev tree and all within their declared ranges: `es-object-atoms` 1.1.1→1.1.2, `hasown` 2.0.2→2.0.4, `nanoid` 3.3.11→3.3.16. Explicitly approved.

## 3. Security — database

Four P0s reachable with the public anon key, independent of any application route:

1. **`orders` sensitive-column write.** The owning customer can rewrite `payment_status`, `total_cents`, `paid_at`, `status`, `business_account_id` and Stripe identifiers. (`customer_id` reassignment is **not** possible — Postgres substitutes `USING` for the omitted `WITH CHECK`.)
2. **4 RLS-disabled tables** with full `anon` DML, including `addresses` (94 real addresses) and the `delivery_admin_events` audit trail. TRUNCATE is granted but **not reachable** via PostgREST/pg_graphql.
3. **`delivery-photos` public with no storage policies.** Latent — 0 objects.
4. **`deliveries` fee/status write** by the assigned driver.

Plus: 6 SECURITY DEFINER views bypassing RLS; `is_admin()` DEFINER with mutable `search_path`; PUBLIC holds EXECUTE on all 7 functions; `business_accounts` UPDATE policy uncorrelated.

Remediation is designed in the Security-DB package and **not applied**.

## 4. Security — application

10 of 76 API routes have no authentication check. Confirmed unauthenticated and reachable: `/api/create-checkout-session` (arbitrary-amount Stripe Checkout), `/api/delivery/complete` (payment capture), `/api/delivery/assign-driver`, `/api/delivery/mark-in-transit` (both service-role mutations), `/api/orders/by-session`, `/api/test-email`, `/api/special-request`. 62 of 76 routes use the service-role key.

`/api/delivery/complete` reads `delivery_photos` with an anon client against `TO authenticated` policies, so it returns 403 and has very likely never captured a payment — **inference**, to be confirmed on a branch.

## 5. Dependency security

7 vulnerabilities in the production tree: **1 critical** (`next@14.2.5`, 33 advisories including two authorization bypasses and an SSRF), **2 high** (`ws`, `postcss`), 4 moderate. `npm audit --omit=dev` exits 1. Resolved by the Next 14→16 upgrade and the Supabase JS pin, not by this commit.

## 6. Platform gaps

Node 22 local / 20 CI / 24 target · lockfileVersion 2 · no `.nvmrc`/`engines`/`packageManager` · `strict: false` · 24 of 32 baseline scripts missing · 11 of 13 release-gate commands missing · no Playwright, Testing Library, jsdom, Supabase CLI, pgTAP · no Tailwind, no UI primitives · 5 auth-helper imports and ~45 ad-hoc service-role clients to consolidate · 27 Next 14→16 breaking-change sites.

## 7. Product-vs-code conflicts (Phase 3 scope)

Live pricing is $15 base / 4 included miles / $1.75 per mile (`lib/delivery/policy.ts:13-15`) against a specification of $22.99 / 3 miles / tiered $2.25–$4.75. Service area is a 60-mile radius from Stafford (`lib/serviceArea.ts:3-4`) rather than the four named markets. Overnight is unimplemented.

## 8. Blocking for Phase 0.5

| # | Blocker | Status |
|---|---|---|
| 1 | `npm ci` unreproducible | **resolved in this commit** |
| 2 | `npm run build` fails in a clean container | **open** — §1 |
| 3 | Four database P0s | **open** — Security-DB designed, not applied |
| 4 | Unauthenticated money/state endpoints | **open** — Security-0 designed, not applied |
| 5 | `02_DECISION_REGISTRY.json` absent | **open** — blocks Phase 1, not Phase 0.5 |
| 6 | Preservation tags unpushable (proxy 403) | **open** — archive branch mitigates |
| 7 | 1 critical + 2 high production vulns | **open** — Commits 3–4 |
| 8 | Zero migrations; no reproducible schema | **open** — Commit 7 |

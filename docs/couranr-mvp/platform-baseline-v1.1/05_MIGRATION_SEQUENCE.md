# 05 — Phase 0.5 Migration Sequence

## Mandatory branch and preservation

Create from the Phase 0 checkpoint:

```bash
git switch -c chore/platform-baseline-v1-1
git tag platform-baseline-before-<YYYYMMDD>
git status --short
git rev-parse HEAD
```

Do not change database schema in this branch.

## Commit 0 — Baseline evidence only

Record:

- current SHA;
- Node/npm versions;
- clean `npm ci` result;
- lint/typecheck/test/build result;
- route count;
- auth-helper import count;
- package tree and audit;
- Stripe flow smoke evidence;
- screenshots of login, merchant dashboard, driver, admin, quote, checkout.

**Gate:** repository can be restored and current behavior is reproducible.

## Commit 1 — Runtime pins and package policy

Add:

- `.nvmrc` and `.node-version`;
- `packageManager` and `engines`;
- CI use of `npm ci`;
- lockfile backup and resolution report.

Try current app on Node 24. If a dependency blocks it, document the blocker and temporarily run the framework codemod on Node 22 LTS; final merged baseline must return to Node 24.

**Gate:** clean install and current build.

## Commit 2 — Next 14 → 15

Use official codemod. Resolve:

- async request APIs introduced in 15;
- React compatibility;
- route-handler typing;
- image/config deprecations;
- server/client boundary warnings.

Do not change product behavior or redesign pages.

**Gate:** lint, typecheck, tests, build, auth smoke, quote smoke, checkout smoke.

## Commit 3 — Next 15 → 16 / React 19.2

Use official upgrade codemod and then manually inspect:

- `next lint` removal;
- async `cookies`, `headers`, `params`, `searchParams`;
- `middleware` → `proxy` where applicable;
- parallel-route `default` files;
- Turbopack incompatibilities;
- `next/image` configuration;
- cache API signatures;
- hydration changes under React 19.2.

Do not enable React Compiler or Cache Components.

**Gate:** three-browser public/auth smoke; build under default bundler; documented fallback if needed.

## Commit 4 — Supabase SSR migration

Create canonical clients:

```text
lib/supabase/client.ts
lib/supabase/server.ts
lib/supabase/admin.ts
lib/supabase/proxy.ts
```

Rules:

- browser client uses publishable key only;
- server client reads/writes cookies through supported Next APIs;
- admin client is server-only and never used for user-scoped reads;
- proxy refreshes sessions without authorizing application roles;
- server commands still enforce tenant and role authorization;
- remove all auth-helper imports before uninstalling the package.

Test matrix:

- email/password sign-in;
- OAuth callback when enabled;
- magic link when enabled;
- logout;
- expired refresh token;
- protected merchant route;
- protected driver route;
- protected Operations route;
- safe redirect;
- cross-role denial;
- route-handler session;
- server component session;
- browser client session.

**Gate:** zero auth-helper imports, all auth tests pass, no service-role leakage.

## Commit 5 — ESLint, strict-new-code, environment schemas

Add flat ESLint configuration, `tsconfig.couranr.json`, server/client Zod env schemas, and import-boundary rules.

Do not turn global strict mode on until the canonical strict project passes.

**Gate:** zero warnings in new Couranr code; build fails on missing required production env.

## Commit 6 — Canonical UI foundation

Add Tailwind v4 PostCSS integration and canonical components. Preserve legacy CSS. Add only a representative shell and components first:

- app shell/sidebar/header;
- button/input/card/badge;
- dialog/select/tabs/tooltip;
- form field/errors;
- table/pagination;
- loading/empty/error states.

Implement one merchant screen and one customer mobile-first screen to validate the system against the registry before scaling.

**Gate:** keyboard navigation, focus visibility, responsive screenshots, no regression on legacy routes.

## Commit 7 — Test and local database infrastructure

Add Vitest projects, Testing Library setup, Playwright, pinned Supabase CLI, pgTAP structure, generated DB types, and test fixtures.

**Gate:** local `supabase db reset`; database tests; component sample; Chromium/WebKit/Firefox E2E smoke.

## Commit 8 — Static release checks

Implement actual scripts for routes, legacy imports, migrations, RLS, and policy registry. Do not add a command to CI before it performs a real check.

**Gate:** deliberate fixture violation makes each check fail.

## Commit 9 — Current Stripe adapter tests

Before upgrading Stripe packages, prove current behavior with test-mode IDs:

- manual authorization;
- capture after Couranr confirmation;
- authorization cancellation;
- requires-action recovery;
- failed capture;
- duplicate webhook;
- partial/full refund;
- supplemental obligation;
- immutable quote and ledger cents.

**Gate:** payment suite passes on current SDK versions.

## Commit 10 — Stripe SDK upgrade

Upgrade Stripe packages only now. No product or schema changes.

**Gate:** same payment suite passes; webhook payload compatibility reviewed; rollback rehearsed.

## Commit 11 — Baseline consolidation

Regenerate lockfile cleanly, run `npm ci`, full baseline gates, audit, dependency tree, route smoke, auth matrix, payment suite, local database, and rollback rehearsal.

Merge only after a phase report lists every commit, changed file, version, command, evidence, defect, and remaining risk.

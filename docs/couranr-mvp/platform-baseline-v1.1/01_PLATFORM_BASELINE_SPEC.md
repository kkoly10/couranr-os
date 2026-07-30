# 01 — Couranr Platform Baseline Specification

## 1. Current-state finding

The current repository manifest is too small for the approved Couranr MVP and release matrix:

- Next.js `14.2.5` and React `18.3.1`;
- `@supabase/auth-helpers-nextjs` remains installed and imported;
- only basic `dev`, `build`, `start`, `lint`, `typecheck`, Vitest, and aggregate `check` scripts exist;
- package lock is lockfile version 2;
- TypeScript has `strict: false`, `allowJs: true`, and `skipLibCheck: true`;
- no Playwright, Testing Library, local Supabase CLI, database tests, environment schema, canonical component foundation, form validation, offline proof queue, signed guest-link library, or release-check scripts exist.

The master release matrix already requires checks not represented by the current package manifest. Phase 0.5 makes those requirements executable.

## 2. Final target baseline

### Runtime

| Item | Target | Policy |
|---|---|---|
| Node.js | `24.18.x` LTS | Pin in `.nvmrc`, `.node-version`, `engines`; no Node 26 Current for production. |
| npm | `11.16.x` | Pin through `packageManager`; commit npm lockfile v3. |
| Next.js | `16.2.x` or newer supported 16.x patch | Upgrade 14 → 15 → 16 in separate commits. Do not use canary in production. |
| React / React DOM | `19.2.x` | Upgrade with Next; run hydration and action tests. |
| TypeScript | current stable compatible with Next 16 | Pin exact after install; strict rollout described below. |
| Browsers | Next 16 supported browser floor | Test Chromium, WebKit, Firefox and mobile emulation. |

### Required architecture decisions

1. **Next.js 14 is not a launch target.** It is outside the supported Next.js major-version list.
2. **Node 24 LTS is the final production runtime.** Node 22 may be used only as a temporary migration runner if a package blocks Node 24.
3. **Turbopack is accepted only after parity evidence.** Keep a documented Webpack fallback during the first Next 16 migration commit if the repository has custom bundler behavior.
4. **Do not enable React Compiler or Cache Components during Phase 0.5.** They are optimization projects after functional parity.
5. **Supabase SSR migration is mandatory.** Remove `@supabase/auth-helpers-nextjs` only after browser, server, route-handler, refresh-cookie, role, and redirect tests pass.
6. **Tailwind v4 is introduced alongside legacy CSS.** New Couranr surfaces use the canonical component system; legacy routes are not bulk-restyled in the baseline.
7. **Stripe packages are frozen until payment tests exist.** Upgrade them in a dedicated payment-adapter commit after authorization/capture/refund/webhook tests pass against current versions.
8. **No dependency is added because a mock depicted a future feature.** Subscription plans, incentives, public API portals, Shopify/Zapier, phone support, marketplace dispatch, and advanced automation remain deferred.

## 3. Dependency groups

### 3.1 Mandatory runtime dependencies

| Package | Purpose | MVP surfaces | Rule |
|---|---|---|---|
| `@supabase/ssr` | Cookie-based browser/server Supabase clients | all authenticated surfaces | Replaces auth helpers. |
| `zod` | Runtime schemas | env, commands, AI, forms, webhooks | All mutation payloads validated server-side. |
| `react-hook-form` + `@hookform/resolvers` | Accessible forms | onboarding, delivery, proof, exceptions, settings | Zod schemas shared with server. |
| `radix-ui` | Accessible interaction primitives | dialogs, menus, tabs, selectors, tooltips | Adopt incrementally; no hand-built inaccessible primitives. |
| `class-variance-authority`, `clsx`, `tailwind-merge` | component variants/classes | canonical design system | One `cn()` utility. |
| `lucide-react` | iconography | all canonical surfaces | One icon set; no emoji UI icons. |
| `@tanstack/react-query` | realtime/interactive remote state | messages, queue, payment status, proof sync | Do not replace server components for simple reads. |
| `@tanstack/react-table` | large accessible tables | Operations, customers, deliveries, audit | Sorting/filtering/pagination must remain server-authoritative. |
| `date-fns` | display and date arithmetic | schedules, status, operating hours | Store timestamps UTC; display market/user timezone. |
| `react-dropzone` | accessible file selection | proof, incidents, logos | Storage policy and MIME validation remain server-side. |
| `idb` | offline evidence queue | driver proof | Never store secrets; encrypt/sanitize sensitive metadata where feasible. |
| `jose` | signed, purpose-bound tokens | pay, track, help, requote | Server-only signing; short expiry and revocation. |
| `server-only` | import boundary | secrets, admin, token signing | Mark privileged modules. |
| `recharts` | approved analytics visuals | merchant/Operations analytics | No fake metrics. |
| `sonner` | accessible transient feedback | canonical UI | Never use toast as the only record of payment/state outcome. |

### 3.2 Styling/build dependencies

- `tailwindcss@4.3`
- `@tailwindcss/postcss@4.3`
- `postcss`

Tailwind v4 uses CSS-first configuration. Do not create a v3-style `tailwind.config.ts` unless a proven requirement appears. Start with `postcss.config.mjs`, `@import "tailwindcss"`, canonical CSS variables, and generated components.

### 3.3 Testing and engineering dependencies

- `vitest`
- `@vitest/coverage-v8`
- `jsdom`
- `@testing-library/react`
- `@testing-library/dom`
- `@testing-library/jest-dom`
- `@testing-library/user-event`
- `@playwright/test`
- `supabase` CLI as a pinned dev dependency
- `tsx`
- `knip`
- ESLint CLI and `eslint-config-next`

### 3.4 Packages to retain initially

Retain during framework/auth migration:

- Stripe server and browser SDKs;
- Resend;
- JSZip where actual MVP use remains;
- existing Supabase JS until the SSR migration commit resolves and pins a compatible current version.

### 3.5 Deferred or rejected dependencies

Do not add during MVP baseline:

- subscription-management libraries;
- Stripe Billing/plan UI abstractions;
- driver incentive/reward engines;
- Twilio voice or public call-center packages;
- Shopify, Zapier, Slack, QuickBooks, Salesforce SDKs;
- public API portal/documentation generators;
- marketplace/broadcast dispatch engines;
- generic workflow automation builders;
- multiple AI provider SDKs before one provider adapter is selected;
- a second state-management library such as Redux/Zustand without a demonstrated gap;
- a second form, table, chart, icon, date, or component library.

## 4. Package and lockfile policy

1. Use npm only for this baseline unless Phase 0 proves another package manager is already authoritative.
2. Run staged install commands, then commit both `package.json` and `package-lock.json`.
3. Financial/auth/framework packages are exact-pinned after resolution.
4. Use `npm ci` in CI and deployment.
5. Reject unresolved peer warnings, duplicate React copies, invalid package trees, and high/critical production vulnerabilities.
6. Record `node --version`, `npm --version`, `npm ls --depth=0`, and `npm audit --omit=dev` in the phase report.
7. No `--force` or `--legacy-peer-deps` without a documented package-specific exception and expiry date.

## 5. TypeScript strictness rollout

### Stage A — new Couranr modules

Create `tsconfig.couranr.json` with:

- `strict: true`
- `allowJs: false`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- `useUnknownInCatchVariables: true`

Apply it to new canonical routes, domain modules, command handlers, AI schemas, scripts, and tests.

### Stage B — security and money boundaries

Migrate to strict types first:

- auth and role resolution;
- tenant membership;
- payment authorization/capture/refund;
- quote and line items;
- idempotency/webhooks;
- guest tokens;
- proof and incident evidence;
- Ghost data broker and verifier.

### Stage C — global strict mode

After legacy quarantine removes auto/docs runtime code:

- set root `strict: true`;
- set `allowJs: false` when no required JS remains;
- evaluate removing `skipLibCheck`;
- make global `typecheck` a zero-error gate.

Do not hide errors with new `any`, broad type assertions, or `@ts-ignore`.

## 6. Canonical design-system baseline

### Required files

- `styles/couranr.css` or equivalent canonical CSS layer;
- `components/ui/*` generated/owned components;
- `components/couranr/*` domain components;
- `lib/cn.ts`;
- `components.json` configured for Radix and Tailwind v4;
- canonical logo files in `public/brand/`.

### Required primitives

Button, input, textarea, label, field/error, card, badge, alert, dialog, alert-dialog, sheet, dropdown menu, select, combobox, tabs, accordion, tooltip, popover, checkbox, radio group, switch, table, pagination, skeleton, progress, toast, empty state, error state, status badge, timeline, file uploader, and confirmation panel.

### Adoption rule

New MVP routes use the canonical system. Legacy routes may retain old CSS until archived. Do not pause Phase 0.5 to restyle legacy auto/docs pages.

## 7. Data and state baseline

### Server is authoritative for

- price and quote versions;
- payment status;
- delivery state;
- readiness;
- Couranr review;
- assignment;
- proof verification;
- returns/refunds/incidents;
- permissions and role scopes.

### React Query is appropriate for

- polling/realtime support inboxes;
- delivery and payment status refresh;
- Operations queue;
- driver assignment offers/status;
- proof upload/sync progress;
- notification inboxes;
- Ghost suggestions and review state.

Client caches never authorize a command and never become the payment or delivery-state source of truth.

## 8. Environment and secret baseline

Create separate server and client environment validators. Client code may receive only:

- public application URL;
- Supabase URL;
- Supabase publishable key;
- explicitly public map key when domain-restricted.

Server-only values include:

- Supabase secret/service key;
- Stripe secret and webhook secret;
- Resend key;
- guest-token signing secret;
- AI provider key;
- admin/cron secrets.

The build must fail on missing required production values. Never expose server schemas through client imports.

## 9. Testing baseline

### Unit and component

Vitest + Testing Library cover:

- Zod schemas;
- pricing/policy registry;
- state transitions;
- form validation;
- permission presentation;
- message templates;
- token claims;
- offline queue behavior;
- AI verifier decisions.

### Database

Pinned Supabase CLI provides:

- reproducible local stack;
- migration reset;
- generated database types;
- pgTAP tests for RLS, grants, constraints, and tenant isolation.

### E2E

Playwright covers the release matrix across Chromium, WebKit, Firefox, and mobile projects. Persistent role fixtures must not share sessions across tenants.

### Visual

Use Playwright screenshots for canonical desktop/mobile route states. Image mocks are references; screenshot baselines are implementation evidence.

## 10. Required scripts

The target manifest defines scripts, but they become required CI gates only when their implementation phase is complete. A script may not return success without performing its stated check.

Baseline gate:

```text
lint
typecheck:canonical
test:run
build
```

Database/security gate after Phase 2:

```text
check:legacy-imports
check:migrations
db:reset
db:test
check:rls
test:security
```

Product gate after relevant phases:

```text
check:routes
check:policy-registry
test:payments
test:delivery-lifecycle
test:ghost-isolation
test:e2e
```

## 11. Observability and dependency security

- Commit a dependency resolution report.
- Run production vulnerability audit.
- Enable Dependabot or Renovate only after the baseline is merged.
- Group routine minor/patch updates; isolate framework/auth/payment majors.
- Add error tracing only through the selected observability provider adapter; do not install multiple providers.
- Redact tokens, payment identifiers beyond allowed suffixes, access instructions, and sensitive messages from logs.

## 12. Completion criteria

Phase 0.5 is complete only when:

1. Node/npm pins are active locally and in CI.
2. Next 16/React 19 build and smoke tests pass.
3. no unsupported Next 14 runtime remains.
4. no `@supabase/auth-helpers-nextjs` import remains.
5. authenticated browser/server/route-handler refresh flows pass.
6. canonical Tailwind/Radix component sample passes accessibility and visual tests.
7. Vitest, Testing Library, Playwright, and local Supabase run.
8. root and canonical typechecks are defined; new code is strict.
9. lockfile v3 is committed and `npm ci` succeeds from clean clone.
10. current Stripe flow still passes before any Stripe SDK upgrade.
11. rollback rehearsal succeeds.
12. phase report includes every required evidence item.

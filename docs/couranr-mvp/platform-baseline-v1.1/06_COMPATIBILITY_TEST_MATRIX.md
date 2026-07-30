# 06 — Compatibility and Acceptance Test Matrix

| ID | Area | Test | Required result | Evidence |
|---|---|---|---|---|
| PB-001 | Runtime | Node 24.18.x and npm 11.16.x from clean shell | exact pins active | command output |
| PB-002 | Install | delete `node_modules`; run `npm ci` | succeeds with lockfile v3 | CI log |
| PB-003 | Framework | Next 16 production build | succeeds | build log |
| PB-004 | Framework | dev and production server smoke | no route/runtime errors | trace/screenshots |
| PB-005 | Bundler | Turbopack build parity | no missing loader/config behavior | comparison report |
| PB-006 | React | hydration across auth, forms, maps, Stripe | zero hydration errors | browser console |
| PB-007 | Browser | Chromium, Firefox, WebKit | core smoke passes | Playwright report |
| PB-008 | Mobile | iPhone/Safari emulation | pay, track, help, proof usable | screenshots |
| PB-009 | Auth | browser/server/route-handler session | consistent user | test IDs/logs |
| PB-010 | Auth | refresh cookie and expiry | safe refresh/logout | cookie evidence |
| PB-011 | Authorization | merchant/driver/Operations role boundary | denied outside role | E2E + DB evidence |
| PB-012 | Supabase | zero auth-helper imports | zero matches | scan output |
| PB-013 | Secrets | client bundle scan | no service/Stripe/AI secrets | build artifact scan |
| PB-014 | TypeScript | canonical strict config | zero errors | typecheck log |
| PB-015 | Env | missing production secret | build/start fails clearly | test log |
| PB-016 | UI | keyboard/focus for primitives | WCAG-conformant interaction | test/video |
| PB-017 | UI | legacy route regression | unchanged within tolerance | before/after shots |
| PB-018 | Forms | shared Zod client/server validation | same rejection/normalization | unit/integration |
| PB-019 | Upload | MIME/size/name validation | unsafe files rejected | test evidence |
| PB-020 | Offline | proof queued and retried | no duplicate proof; status visible | E2E trace |
| PB-021 | Tokens | purpose/expiry/revocation | cross-purpose and expired denied | security tests |
| PB-022 | Database | `supabase db reset` | all migrations reproducible | log |
| PB-023 | Database | pgTAP RLS/grant suite | all pass | TAP output |
| PB-024 | Database | generated types | clean diff or reviewed diff | git diff |
| PB-025 | Stripe | existing SDK payment suite | all pass before upgrade | Stripe IDs/ledger |
| PB-026 | Stripe | upgraded SDK payment suite | identical expected outcomes | comparison report |
| PB-027 | Webhooks | duplicate/out-of-order event | idempotent result | event/DB IDs |
| PB-028 | Realtime | queue/messages reconnect | no cross-tenant event or lost state | E2E trace |
| PB-029 | Tests | deliberate failing fixture | each check detects defect | negative-test log |
| PB-030 | Rollback | revert platform commits | prior build/auth/payment restored | rehearsal report |

## Required clean-clone command sequence

```bash
nvm use
npm ci
npm run lint
npm run typecheck:canonical
npm run test:run
npm run build
npm run db:start
npm run db:reset
npm run db:test
npm run test:e2e
```

## No-go conditions

- Next 14 remains production runtime.
- Any auth-helper import remains after SSR migration.
- Node/npm versions differ between local, CI, and deployment.
- `npm ci` cannot reproduce installation.
- Stripe current-version behavior is not tested before SDK upgrade.
- framework/auth/payment changes exist in one inseparable commit.
- any client bundle contains privileged secrets.
- tests pass only through `--force`, `--legacy-peer-deps`, skipped suites, or broad mocks that bypass real boundaries.
- canonical UI foundation breaks legacy runtime before quarantine is ready.

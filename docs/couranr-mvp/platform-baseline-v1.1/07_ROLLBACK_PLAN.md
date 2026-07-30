# 07 — Rollback Plan

## Principles

1. Platform rollback must not require a database rollback because Phase 0.5 contains no product schema migration.
2. Every major boundary is a separate commit.
3. Keep previous deployment artifact and environment configuration until the baseline survives staging and canary.
4. Feature flags control rollout only; they never replace authorization.

## Required references

Record:

```text
BASELINE_PRE_TAG
BASELINE_PRE_SHA
NEXT15_SHA
NEXT16_SHA
SUPABASE_SSR_SHA
UI_FOUNDATION_SHA
TEST_INFRA_SHA
STRIPE_PRE_UPGRADE_SHA
STRIPE_UPGRADE_SHA
```

## Rollback by failure class

### Node/npm failure

- restore previous deployment runtime temporarily;
- revert runtime-pin commit;
- keep package/lockfile pair together;
- document package blocking Node 24;
- do not merge with an unpinned runtime.

### Next 15/16 failure

- revert only the failed framework commit and its lockfile;
- restore config/proxy/middleware files from prior SHA;
- deploy last successful framework artifact;
- do not undo unrelated product work because none belongs in this branch.

### Supabase SSR failure

- keep old auth-helper commit reachable until SSR matrix passes;
- revert SSR client/proxy imports and package changes together;
- invalidate test sessions;
- verify no mixed cookie formats remain;
- do not leave both auth systems active in production.

### Canonical UI foundation failure

- remove canonical layout import/route flag;
- revert UI foundation commit;
- legacy CSS remains intact;
- no payment/auth/data rollback required.

### Test infrastructure failure

- test tooling can be reverted without reverting production runtime;
- a failed test setup does not justify skipping launch-mandated tests;
- fix or replace the tooling before proceeding.

### Stripe SDK failure

- revert Stripe upgrade commit only;
- restore exact prior package and lockfile;
- redeploy prior server/browser bundle together;
- retain webhook endpoint and API version expected by prior adapter;
- reconcile any test-mode events generated during failed migration;
- never roll back ledger/database state by deleting payment records.

## Rehearsal

In staging:

1. deploy baseline candidate;
2. run auth and payment smoke;
3. revert to pre-baseline artifact;
4. run auth and payment smoke again;
5. redeploy candidate;
6. record duration, commands, artifacts, and data observations.

## Rollback completion evidence

- deployment SHA;
- runtime/package versions;
- login/logout/refresh result;
- merchant and driver protected-route result;
- payment authorization/cancel smoke;
- webhook receipt;
- no database migration divergence;
- incident owner and decision timestamp.

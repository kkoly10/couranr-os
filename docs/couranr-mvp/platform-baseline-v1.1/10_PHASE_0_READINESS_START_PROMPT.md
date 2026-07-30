# Claude Code Start Prompt — Phase 0 Readiness Only

Copy this prompt into Claude Code to begin the Couranr implementation safely.

```text
Work in the repository `kkoly10/couranr-os`.

First, fetch all branches and inspect:

- `main`
- `docs/platform-dependency-baseline-v1-1`

Create a dedicated working branch named:

`claude/couranr-phase-0-readiness`

Base it on the latest safe repository state that includes the platform-baseline documentation. Before making any changes, report whether the documentation branch is behind or conflicts with the latest `main`.

Read these files completely in this order:

1. `Couranr_Claude_Code_Master_Package.md`
2. `UI_SCREEN_REGISTRY.md`
3. `docs/couranr-mvp/platform-baseline-v1.1/README.md`
4. `docs/couranr-mvp/platform-baseline-v1.1/01_PLATFORM_BASELINE_SPEC.md`
5. `docs/couranr-mvp/platform-baseline-v1.1/03_PACKAGE_TARGET.jsonc`
6. `docs/couranr-mvp/platform-baseline-v1.1/04_INSTALL_COMMANDS.sh`
7. `docs/couranr-mvp/platform-baseline-v1.1/05_MIGRATION_SEQUENCE.md`
8. `docs/couranr-mvp/platform-baseline-v1.1/06_COMPATIBILITY_TEST_MATRIX.md`
9. `docs/couranr-mvp/platform-baseline-v1.1/07_ROLLBACK_PLAN.md`
10. `docs/couranr-mvp/platform-baseline-v1.1/08_CLAUDE_CODE_IMPLEMENTATION_PROMPT.md`
11. `docs/couranr-mvp/platform-baseline-v1.1/MASTER_PACKAGE_AMENDMENT.md`

If any required file is absent, incomplete, contradictory, or referenced but unavailable, stop and identify it. Do not invent its contents.

BEGIN WITH PHASE 0 AND THE PHASE 0.5 READINESS REPORT ONLY.

Do not modify application files, package.json, package-lock.json, database migrations, environment variables, Supabase configuration, Stripe code, or dependencies yet.

Return one grounded readiness report containing:

1. Current branch, current commit SHA, latest main SHA, and documentation-branch SHA.
2. Preservation branch/tag recommendation and rollback SHA.
3. Complete route and API inventory, grouped into Couranr delivery, auto, docs, legacy, merchant, driver, Operations, customer, authentication, Stripe, and webhook surfaces.
4. Existing database migration, schema, RLS, storage-bucket, RPC, trigger, and generated-type inventory.
5. Current Node, npm, package-lock, Next.js, React, TypeScript, Supabase, Stripe, Resend, ESLint, and testing versions.
6. Dependency tree and npm audit summary.
7. All Next.js 14 → 15 → 16 breaking-change locations in the repository.
8. Every `@supabase/auth-helpers-nextjs` import, Supabase client factory, cookie/session pattern, middleware use, and role-resolution path.
9. Every Stripe entry point: checkout, PaymentIntent creation, authorization, capture, refund, webhook, reconciliation, metadata, and idempotency handling.
10. Existing tests, scripts, CI workflows, lint configuration, TypeScript configuration, and build evidence.
11. Current CSS and component architecture, including how the canonical Couranr UI system can be introduced without rewriting all legacy CSS at once.
12. Legacy routes and imports that must be preserved, quarantined, redirected, or disabled.
13. Security risks, tenant-isolation risks, payment risks, and migration blockers.
14. Exact proposed Phase 0.5 commits mapped to `05_MIGRATION_SEQUENCE.md`.
15. Commands and evidence that will be required after every proposed commit.
16. Any deviations required from the written baseline and why.
17. A clear GO / CONDITIONAL GO / NO-GO recommendation for Phase 0.5.

Rules:

- Do not make code changes in this first task.
- Do not install or remove packages.
- Do not use `--force` or `--legacy-peer-deps`.
- Do not change pricing, workflows, schemas, state machines, permissions, or canonical MVP scope.
- Do not begin constructing the 66 canonical screens.
- Do not upgrade Stripe until the existing payment flows have characterization tests.
- Do not remove Supabase auth helpers until all imports are mapped and the replacement authentication matrix is defined.
- Do not create placeholder check scripts that always pass.
- Separate framework, authentication, Stripe, database, design-system, and screen implementation boundaries.
- Cite exact file paths and line numbers for every important finding.
- Stop after delivering the readiness report and wait for approval.
```

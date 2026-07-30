# 08 — Claude Code Implementation Prompt

You are implementing **Couranr Phase 0.5 — Platform & Dependency Baseline v1.1** in `kkoly10/couranr-os`.

## Read first

1. Existing Couranr Claude Code implementation package.
2. Canonical MVP UI package and `UI_SCREEN_REGISTRY.md`.
3. This complete Platform & Dependency Baseline package.

## Authority

Product behavior remains controlled by the Decision Registry and Master Implementation Specification. This package controls only platform, dependency, configuration, compatibility evidence, and rollback.

## First response — no code changes

Return a Phase 0.5 readiness report containing:

1. current branch/SHA and preservation reference;
2. current Node/npm/package-lock versions;
3. complete current dependency tree and audit summary;
4. all Next 14 → 15 → 16 breaking-change locations;
5. all `@supabase/auth-helpers-nextjs` imports and auth client patterns;
6. middleware/proxy/cookie usage;
7. all Stripe entry points and webhook handlers;
8. existing tests and config files;
9. current CSS/component architecture;
10. exact planned commits matching `05_MIGRATION_SEQUENCE.md`;
11. blockers, deviations, and rollback SHA.

Do not modify files until that report is accepted.

## Execution rules

- Work on a dedicated branch.
- One migration boundary per commit.
- Do not change product rules, pricing, database schema, state machines, or canonical screen scope.
- Do not rebuild all 66 screens in this phase.
- Do not use `--force` or `--legacy-peer-deps`.
- Do not enable React Compiler or Cache Components.
- Do not upgrade Stripe until current-version payment tests pass.
- Do not uninstall auth helpers until zero imports remain and the SSR auth matrix passes.
- Do not add future-feature dependencies.
- Preserve legacy CSS while establishing the canonical UI layer.
- Every check script must fail on a deliberate defect; no placeholder success scripts.

## Required outputs per commit

- changed files;
- package and resolved versions;
- commands run;
- test evidence;
- before/after behavior;
- security observations;
- rollback command/SHA;
- unresolved issues.

## Completion

Return a final Phase 0.5 report mapped to every item in `06_COMPATIBILITY_TEST_MATRIX.md`. Stop if any no-go condition exists. Do not begin broad MVP screen implementation until the baseline is accepted.

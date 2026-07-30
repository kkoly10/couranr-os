# Couranr Platform & Dependency Baseline v1.1

**Status:** Approved implementation addendum  
**Repository:** `kkoly10/couranr-os`  
**Applies after:** Phase 0 inventory and preservation checkpoint  
**Applies before:** broad canonical MVP UI implementation

## Purpose

This package closes the tooling and platform gap between the Couranr product specification, the canonical MVP UI registry, and the current repository manifest.

It defines a reversible Phase 0.5 that:

1. moves the app off unsupported Next.js 14;
2. pins a supported Node/npm runtime;
3. replaces deprecated Supabase auth helpers with `@supabase/ssr`;
4. introduces the canonical UI foundation without rewriting all legacy CSS at once;
5. adds validation, forms, tables, realtime client state, uploads, signed-link support, analytics charts, local Supabase, unit/component/E2E testing, and release checks;
6. isolates payment SDK upgrades from framework/auth migrations;
7. prevents exploratory mock features from expanding the dependency graph.

## Authority

Authority order remains:

1. `02_DECISION_REGISTRY.json`
2. `01_MASTER_IMPLEMENTATION_SPEC.md`
3. `05_AI_COMMUNICATION_SPEC.md`
4. `Couranr_Canonical_MVP_UI/UI_SCREEN_REGISTRY.md`
5. this Platform & Dependency Baseline
6. legacy repository behavior

This baseline controls platform versions, dependency purpose, configuration, migration order, compatibility evidence, and rollback. It does not override pricing, workflow, permissions, security, payment, AI, or UI scope decisions.

## Package contents

- `01_PLATFORM_BASELINE_SPEC.md` — complete baseline and decisions.
- `02_DEPENDENCY_DECISIONS.json` — machine-readable dependency registry.
- `03_PACKAGE_TARGET.jsonc` — target manifest shape and scripts.
- `04_INSTALL_COMMANDS.sh` — staged installation commands; do not run as one uncontrolled block.
- `05_MIGRATION_SEQUENCE.md` — commit-by-commit sequence and gates.
- `06_COMPATIBILITY_TEST_MATRIX.md` — required evidence.
- `07_ROLLBACK_PLAN.md` — rollback procedures.
- `08_CLAUDE_CODE_IMPLEMENTATION_PROMPT.md` — exact Claude Code assignment.
- `09_WORK_BREAKDOWN.csv` — tracker.
- `MASTER_PACKAGE_AMENDMENT.md` — text to add to the master implementation package.
- `templates/` — proposed configuration and validation templates.

## Non-negotiable rule

> Do not mix framework, authentication, payment SDK, database schema, and canonical screen construction into one commit or pull request.

## Start condition

Do not execute Phase 0.5 until Phase 0 has returned:

- preservation tag/branch;
- route and API inventory;
- environment inventory;
- current build/test evidence;
- auth-helper usage map;
- payment entry-point map;
- Next.js breaking-change map;
- rollback commit SHA.

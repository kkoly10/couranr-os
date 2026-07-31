# Couranr Merchant Delivery MVP — Claude Code Implementation Package

## Purpose

This package is the authoritative implementation brief for transforming `kkoly10/couranr-os` into the Couranr merchant-delivery MVP.

It consolidates the accepted product, pricing, payment, communication, AI, data, security, cutover, and launch-testing decisions. Claude Code should treat these files as the product authority and should not invent substitute pricing, statuses, workflows, permissions, terminology, or business rules.

## Repository

- Repository: `kkoly10/couranr-os`
- Current stack: Next.js 14, React 18, TypeScript, Supabase, Stripe, Resend, Vitest
- Target product: local business delivery infrastructure
- Initial marketed markets: Washington, DC; Stafford; Woodbridge; Fredericksburg; surrounding areas
- Maryland is not an initial marketed market.

## Package files

1. `01_MASTER_IMPLEMENTATION_SPEC.md` — Complete product and engineering specification.
2. `02_DECISION_REGISTRY.json` — Machine-readable locked decisions.
3. `03_REPO_CUTOVER_MATRIX.md` — Retain, replace, archive, disable, redirect, and delete guidance.
4. `04_PHASED_EXECUTION_PLAN.md` — Ordered implementation phases and dependencies.
5. `05_AI_COMMUNICATION_SPEC.md` — Smart Intake, assistants, messaging, and Ghost Operations.
6. `06_RELEASE_ACCEPTANCE_MATRIX.md` — Required launch tests and no-go rules.
7. `07_CLAUDE_CODE_START_PROMPT.md` — Prompt to begin implementation.
8. `08_WORK_BREAKDOWN.csv` — Work-item tracker.

## Authority order

1. `02_DECISION_REGISTRY.json`
2. `01_MASTER_IMPLEMENTATION_SPEC.md`
3. `05_AI_COMMUNICATION_SPEC.md`
4. `03_REPO_CUTOVER_MATRIX.md`
5. `04_PHASED_EXECUTION_PLAN.md`
6. `06_RELEASE_ACCEPTANCE_MATRIX.md`

The repository’s legacy behavior never overrides this package.

## Execution rules

- Do not implement the entire package in one uncontrolled commit.
- Preserve the legacy repository state before removing runtime behavior.
- Do not ask product questions already answered in this package.
- Do not create a second pricing engine, payment model, status model, or tenant model.
- Do not use feature flags as authorization.
- Do not expose service-role, Stripe, AI, webhook, database, or signing secrets.
- Do not let AI execute financial, address, delivery-state, cancellation, refund, return, claim, or safety decisions.
- Use Couranr terminology. Never expose personal/operator language.
- End each phase with a report listing changed files, migrations, tests, evidence, and unresolved issues.

## Required first action

Begin with Phase 0 in `04_PHASED_EXECUTION_PLAN.md`: repository inventory, preservation checkpoint, legacy route map, schema inventory, environment inventory, and gap report. No destructive code or database changes should occur before that report and preservation checkpoint.

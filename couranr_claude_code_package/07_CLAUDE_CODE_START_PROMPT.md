# Claude Code Start Prompt — Couranr Merchant Delivery MVP

You are implementing the Couranr Merchant Delivery MVP in `kkoly10/couranr-os`.

Read every file in this package before making changes.

Authority:
1. `02_DECISION_REGISTRY.json`
2. `01_MASTER_IMPLEMENTATION_SPEC.md`
3. `05_AI_COMMUNICATION_SPEC.md`
4. `03_REPO_CUTOVER_MATRIX.md`
5. `04_PHASED_EXECUTION_PLAN.md`
6. `06_RELEASE_ACCEPTANCE_MATRIX.md`

The legacy application does not override these decisions.

## First assignment

Execute **Phase 0 only**.

Do not delete, migrate, disable, or rewrite production behavior until you have:

1. Created and pushed the legacy tag.
2. Created and pushed the archive branch.
3. Created the implementation branch.
4. Inventoried routes, schema, RLS, storage, Stripe, environment variables, imports, and tests.
5. Produced the required current-state documents.
6. Produced a gap report mapping the repository to every phase.
7. Identified unusual technical risk.

## Required Phase 0 response

Return:
- Preservation references
- Files inspected
- Route inventory
- Database/RLS summary
- Stripe summary
- Storage summary
- Environment summary without values
- Unsafe mutation routes
- Legacy import map
- Reusable foundations
- Existing blockers
- Proposed Phase 1 changes
- Required Phase 1 tests
- Unresolved technical ambiguity

Do not ask product questions already answered.

## Global rules

- Use Couranr terminology.
- Do not implement everything in one commit.
- Do not keep two pricing or payment systems.
- Do not use old `orders` as canonical request.
- Do not allow arbitrary target-state updates.
- Do not expose secrets to browser or AI.
- Do not let AI execute restricted actions.
- Do not use flags as authorization.
- Do not ignore schema drift.
- Do not preserve unsafe unlinked routes.
- Do not claim completion without tests/evidence.
- Do not invent business values.
- Do not dual-write legacy records.

Start Phase 0 now.

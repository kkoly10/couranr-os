# Master Package Amendment — Add Phase 0.5

Insert after Phase 0 and before Phase 1:

## Phase 0.5 — Platform and dependency baseline

Purpose: establish a supported, reproducible, testable platform before broad MVP implementation.

Required outcomes:

- Node 24 LTS and npm 11 pinned;
- package-lock v3 and clean `npm ci`;
- Next 14 → 15 → supported Next 16 migration;
- React 19.2 migration;
- ESLint CLI replacement for `next lint`;
- Supabase auth helpers replaced by `@supabase/ssr`;
- strict TypeScript project for all new Couranr code;
- server/client environment validation;
- Tailwind v4 plus accessible canonical component primitives introduced without bulk legacy restyling;
- Vitest, Testing Library, Playwright, pinned Supabase CLI, pgTAP, and generated database types;
- real route, legacy-import, migration, RLS, and policy checks;
- current-version Stripe adapter tests before any Stripe SDK upgrade;
- rollback rehearsal.

Rules:

- no product schema migration;
- no broad canonical screen implementation;
- no framework/auth/payment upgrade in one commit;
- no future-feature dependencies;
- no React Compiler or Cache Components;
- no Stripe SDK upgrade before current adapter tests pass.

Authority: `Couranr_Platform_Dependency_Baseline_v1.1`.

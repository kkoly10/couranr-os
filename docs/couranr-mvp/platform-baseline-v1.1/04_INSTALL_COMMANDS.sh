#!/usr/bin/env bash
set -euo pipefail

# Couranr Phase 0.5 staged dependency commands.
# DO NOT run this entire file as one uncontrolled script.
# Execute one section per commit, inspect package.json/package-lock.json, and run the stated gate.

# A. Runtime pin and clean baseline
node --version
npm --version
npm ci
npm run check

# Commit A records current evidence before dependency changes.

# B. Next 14 -> 15 (use official codemod; inspect every change)
npx @next/codemod@canary upgrade 15
npm install
npm run lint
npm run typecheck
npm run test:run
npm run build

# C. Next 15 -> supported Next 16.2 line + React 19.2
npx @next/codemod@canary upgrade latest
npm install --save-exact next@16.2 react@19.2 react-dom@19.2
npm install --save-dev --save-exact eslint-config-next@16.2 @types/react@19 @types/react-dom@19
npm run lint
npm run typecheck
npm run test:run
npm run build

# D. Supabase SSR replacement
npm install --save-exact @supabase/ssr@0.12.3 @supabase/supabase-js@latest server-only@latest jose@6
# Remove only after all imports and auth tests are migrated:
# npm uninstall @supabase/auth-helpers-nextjs
npm run test:run
npm run build

# E. Canonical UI + forms + remote state + upload/offline/analytics
npm install --save-exact \
  zod@4 \
  react-hook-form@7 \
  @hookform/resolvers@5 \
  radix-ui@latest \
  class-variance-authority@0.7 \
  clsx@2 \
  tailwind-merge@3 \
  lucide-react@1 \
  @tanstack/react-query@5 \
  @tanstack/react-table@8 \
  date-fns@4 \
  react-dropzone@14 \
  idb@8 \
  recharts@3 \
  sonner@latest

npm install --save-dev --save-exact \
  tailwindcss@4.3 \
  @tailwindcss/postcss@4.3 \
  postcss@latest

npm run lint
npm run typecheck:canonical
npm run test:run
npm run build

# F. Testing, local database, and engineering checks
npm install --save-dev --save-exact \
  vitest@latest \
  @vitest/coverage-v8@latest \
  jsdom@latest \
  @testing-library/react@latest \
  @testing-library/dom@latest \
  @testing-library/jest-dom@latest \
  @testing-library/user-event@latest \
  @playwright/test@latest \
  supabase@latest \
  tsx@latest \
  knip@latest \
  eslint@latest

npx playwright install --with-deps
npm run check:baseline

# G. Payment SDK upgrade — BLOCKED until current-version payment adapter tests pass.
# Run only in a separate commit/PR with Stripe test-mode authorization, capture,
# cancellation, refund, webhook idempotency, and ledger reconciliation evidence.
# npm install --save-exact stripe@latest @stripe/stripe-js@latest @stripe/react-stripe-js@latest
# npm run test:payments
# npm run build

# H. Final dependency evidence
npm ls --depth=0
npm audit --omit=dev
npm ci
npm run check:baseline

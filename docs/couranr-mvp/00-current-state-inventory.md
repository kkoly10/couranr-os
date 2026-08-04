# 00 — Current-state inventory

> **Historical baseline — not current status.**
> Captured at 4137303 2026-07-30. The counts, gaps and warnings below
> describe the repository as it was THEN and are preserved as evidence of that
> baseline. Several are now false — notably the four P0 database issues, which
> are closed. For the current implementation state see
> [`IMPLEMENTATION_STATUS.md`](./IMPLEMENTATION_STATUS.md).

**Repository:** `kkoly10/couranr-os` @ `9c0a63bd5284e065978860b8893c170478fab1f5`
**Captured:** Commit 0, Phase 0 · **Branch:** `claude/couranr-phase-0-readiness`

## Preservation references

| Reference | SHA | Status |
|---|---|---|
| `refs/heads/archive/auto-docs-multiservice` | `9c0a63bd…` | pushed, verified |
| `refs/heads/claude/couranr-phase-0-readiness` | `9c0a63bd…` | pushed, verified |
| `refs/tags/legacy-multiservice-2026-07-27` | `9c0a63bd…` | **local only — remote tag push returns HTTP 403 in this environment** |
| `refs/tags/platform-baseline-before-20260730` | `9c0a63bd…` | **local only — same** |

Annotated tags, lightweight tags and `git push --tags` all return 403 from the git proxy while branch pushes to the same remote succeed. The archive branch provides a durable pointer at the same commit.

## Runtime

| Item | Value |
|---|---|
| Node | v22.22.2 (target 24.18.x) |
| npm | 10.9.7 (target 11.16.x) |
| `package-lock.json` | lockfileVersion 2 (target 3) |
| `.nvmrc` / `.node-version` / `engines` / `packageManager` | absent |
| CI Node | 20 (`.github/workflows/ci.yml:23`) |

## Direct dependencies (`npm ls --depth=0`)

```
+-- @stripe/react-stripe-js@2.9.0     (0 imports)
+-- @stripe/stripe-js@4.10.0          (0 imports)
+-- @supabase/auth-helpers-nextjs@0.10.0
+-- @supabase/supabase-js@2.90.1
+-- @types/node@20.19.28
+-- @types/react@18.3.27
+-- eslint-config-next@14.2.5
+-- eslint@8.57.1
+-- jszip@3.10.1
+-- next@14.2.5
+-- react-dom@18.3.1
+-- react@18.3.1
+-- resend@6.7.0
+-- stripe@15.12.0
+-- typescript@5.9.3
`-- vitest@1.6.1
```

## Baseline command results

| Command | Exit | Note |
|---|---|---|
| `npm ci` | **0** | succeeds only after the Commit 0 lockfile repair |
| `npm run lint` | **0** | warnings only (`@next/next/no-img-element`) |
| `npm run typecheck` | **0** | clean under `strict: false` |
| `npm run test:run` | **0** | 3 files, 10 tests passed |
| `npm run build` | **1** | **FAILS** — see `00-gap-report.md` §1 |
| `npm ls --depth=0` | 0 | tree above |
| `npm audit --omit=dev` | 1 | 7 vulns: 1 critical, 2 high, 4 moderate |

## Code surface

58 page routes · 76 API route handlers · 0 middleware · 3 test files (10 tests) · 1 CSS file (818 lines) · 11 components, 0 UI primitives · 776 inline `style={{}}` props.

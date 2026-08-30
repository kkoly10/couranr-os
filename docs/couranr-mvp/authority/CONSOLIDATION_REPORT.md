# Authority Consolidation — implementation report

Against `COURANR_AUTHORITY_CONSOLIDATION_WORK_ORDER.md` §11.

**This program is complete.** Phases A, B, C and D are done. §11 of the earlier
revision of this report listed eight items as NOT done; every one of them is
closed below, and the two that are deliberately not being done say so and say
why. Nothing is left implied by omission.

Run `npm run governance:facts` for every current count. This document quotes
none, on purpose — pinning a measurable number in prose is the defect the
program exists to remove.

---

## 1. Baseline and head

| | |
|---|---|
| work order's stated baseline | `11a668b` (`main`) |
| actual branch HEAD at start | `1b9eab2` — two commits ahead |
| head at this report | see `git log` |

The two extra commits are the public notice-bar removal and its review pass,
open as PR #35 and **not merged**. They were preserved rather than discarded:
the work order's "reconfirm HEAD and preserve valid newer work" instruction
takes precedence over its own stated baseline SHA.

## 2. Mechanical authority-classification table

`docs/couranr-mvp/authority/AUTHORITY_CLASSIFICATION.md` — 141 files matched by
the five §6 sweeps, every one classified.

| Class | Files |
|---|---|
| DOC/DATA | 37 |
| RUNTIME CONSUMER | 37 |
| TEST/GATE | 19 |
| HISTORICAL | 15 |
| EVIDENCE | 14 |
| GENERATOR/GATE | 9 |
| MIRROR → GENERATED | 6 |
| ACTIVE AUTHORITY | 4 |

That table is EVIDENCE, measured at the SHA it names. It is not updated as the
program moves; the manifest is the live answer.

## 3. Active authority list, before vs after

**Before** — the same facts were writable in several places at once:

- the canonical screens writable in `ui_screen_registry.json`,
  `ui_screen_registry.csv`, `UI_SCREEN_REGISTRY.md` and `lib/couranr/screens.ts`,
  with no generator between any of them, and the Markdown declaring *itself* the
  approved source of truth;
- the public composition contract writable only as Markdown punctuation inside a
  3,000-line design handbook;
- visual-source status split across `MOCK_TO_SCREEN_MAP.md` and
  `CANONICAL_SCREEN_SOURCE_MAP.tsv`, hand-maintained independently;
- the canonical screen count hardcoded in a gate five times and in three tests;
- product doctrine live inside a package file that also carried execution
  history, and cited by 33 decision records;
- the decision registry naming two of its own downstream documents as ranking
  above it;
- the decision-registry fingerprint, screen count and two completion counts
  pinned in `CLAUDE.md`, three of them already wrong.

**After** — seven declared domains, one writable source each, in
`docs/couranr-mvp/authority/AUTHORITY_MANIFEST.json`:

| Domain | Writable authority |
|---|---|
| product-decisions | `02_DECISION_REGISTRY.json` |
| product-doctrine | `docs/couranr-mvp/PRODUCT_SPEC.md` |
| screens-routes | `ui_screen_registry.json` |
| visual-authority | `docs/couranr-mvp/ui-reference/VISUAL_REGISTRY.json` |
| work-implementation-state | `docs/couranr-mvp/IMPLEMENTATION_LEDGER.csv` |
| screen-implementation-state | `docs/couranr-mvp/SCREEN_IMPLEMENTATION_LEDGER.csv` |
| platform-baseline | `docs/couranr-mvp/platform-baseline-v1.1/` |

**No pending domains remain.** The manifest also declares every HISTORICAL and
EVIDENCE path, and `check:governance` enforces that none of them is also an
authority or a generated output.

## 4. Files created, promoted, generated, archived

**Created:** `AUTHORITY_MANIFEST.json`, `AUTHORITY_CLASSIFICATION.md`,
`VISUAL_REGISTRY.json`, `PRODUCT_SPEC.md`,
`scripts/governance/{screenRegistry,screensModule,visualRegistry,visualSources,statusReport,generate,check,facts}.mjs`,
`tests/couranr-governance.test.ts`, `tests/couranr-product-spec.test.ts`, this
report.

**Promoted to authority:** `ui_screen_registry.json` (schema upgraded to
`routes[]` plus per-screen `amendments[]`), `VISUAL_REGISTRY.json`,
`PRODUCT_SPEC.md`.

**Demoted to generated:** `UI_SCREEN_REGISTRY.md`, `ui_screen_registry.csv`,
`lib/couranr/screens.ts`, `MOCK_TO_SCREEN_MAP.md`,
`CANONICAL_SCREEN_SOURCE_MAP.tsv`, `VISUAL_AUTHORITY_REGISTRY.json`,
`IMPLEMENTATION_STATUS.md`.

**Reclassified HISTORICAL:** `Couranr_Claude_Code_Master_Package.md` and the
unpacked package originals, after `PRODUCT_SPEC.md` proved it carries their
doctrine verbatim.

**Archived:** the 721-line hand-written `IMPLEMENTATION_STATUS.md`, preserved
whole at `autonomous-evidence/status-archive/IMPLEMENTATION_STATUS-2026-08-06.md`
with a banner that says it is evidence and was not rewritten to look current.

**Deleted:** nothing.

## 5. Generator graph

```
ui_screen_registry.json ──► UI_SCREEN_REGISTRY.md          (byte-exact)
                       ├──► ui_screen_registry.csv         (byte-exact, CRLF)
                       ├──► lib/couranr/screens.ts         (+ ledger status)
                       ├──► check:mocks canonical count
                       ├──► scripts/visualAuthorityRegistry.mjs
                       └──► governance:facts

VISUAL_REGISTRY.json ──► MOCK_TO_SCREEN_MAP.md             (root-PNG census)
                    ├──► CANONICAL_SCREEN_SOURCE_MAP.tsv   (provenance)
                    ├──► VISUAL_AUTHORITY_REGISTRY.json    (via check:visual-registry --write)
                    ├──► scripts/compositionContract.mjs
                    │      ├─► scripts/checkVisualSystem.mjs
                    │      ├─► tests/couranr-public-composition.test.ts
                    │      └─► e2e/publicFamilyGates.mjs
                    ├──► scripts/checkMockMap.mjs
                    └──► drift-checked against COURANR_VISUAL_SYSTEM_V2_2.md §19/§27

both ledgers ──► IMPLEMENTATION_STATUS.md ──► (documents point at the command)
             └──► governance:facts

02_DECISION_REGISTRY.json ──► reconciled against ui_screen_registry.json by check:governance
PRODUCT_SPEC.md ◄── extracted verbatim from Couranr_Claude_Code_Master_Package.md,
                    byte-identity asserted both directions by tests/couranr-product-spec.test.ts
```

## 6. Gates changed or added

| Gate | Change |
|---|---|
| `check:governance` | **new** — manifest coherence, source→generated parity, do-not-edit markers, HISTORICAL/EVIDENCE classification, no circular precedence, CLS reconciliation, no mutable counts in `CLAUDE.md`, §27 doc drift |
| `governance:generate` | **new** — the only sanctioned way to change a generated artifact; seven artifacts |
| `governance:facts` | **new** — measures what documents used to pin |
| `check:mocks` | reads the structured visual registry instead of a Markdown fence and three prose formats; four positive controls |
| `check:visual-registry` | reads `ui_screen_registry.json` instead of splitting the generated Markdown table on pipes; validates `reference_sources` |
| `check:visual-system` | unchanged behaviour; its three positive controls rewritten to plant into the contract rather than the Markdown |
| `check:drift-ledger` | per-row field-count check with a control |
| `ci:local` | `check:governance` added to tier 2 |
| `check:gates:controls` | `check:governance` registered |
| `tests/couranr-screens.test.ts` | every count derives; `implemented` asserted row by row against the ledger |
| `tests/couranr-implementation-ledger.test.ts` | count derives; new ledger-vs-source route agreement check |
| `tests/couranr-navigation.test.ts` | new self-retiring guard on the LEG-004 route shim |
| `tests/decision-registry.test.ts` | the pinned `authority_order` cycle replaced with a provenance-shape check |
| `tests/couranr-governance.test.ts` | **new** — the assertions the gate's own design depends on |
| `tests/couranr-product-spec.test.ts` | **new** — byte-identity of the doctrine extraction |

**Nothing was retired.** No test was deleted or weakened. Three tests were
rewritten to derive a value they had pinned, and each kept the invariant it
existed to protect as an explicit assertion.

## 7. PUB-004 is resolved, not transitional

`sources.screens` distinguishes `root_sources` (the repo-root census, which is
what `checkMockMap` validates residency for) from `nested_sources` (a delivered
`canonical-mvp-images/**` path, approved photography), each with a `role`.

PUB-004 is therefore `visual_authority: derived`, `root_sources: []`, and one
nested `reference` asset — and the generated `VISUAL_AUTHORITY_REGISTRY.json`
records it as a measured 1440×1160 `reference_sources` entry.

`checkMockMap`'s root-residency rule was **not** relaxed, the nested path was
**not** added to the root map, and the asset was **not** deleted. It refuses a
nested path in `root_sources` positively, with a control.

## 8. Screen count and classification counts are derived, not duplicated

`check:mocks` derives the canonical count from the screen source. Proven by
adding a 67th screen and watching the arithmetic move, then removing it.

`check:governance` reconciles `canonical_screens`, `core`, `mvp_complete` and
`mvp_complete_ids` against the screen source — using the **effective**
classification decision, the one nothing amends, so CLS-002 could amend
CLS-001's counts without overwriting the history CLS-001 preserves.

Four literals were retired from tests in Phase D alone.

## 9. `CLAUDE.md` has no mutable fingerprints

Enforced by `check:governance` with a positive control. Four claims it carried
were already wrong when measured — two test counts, a work-item completion count
and a screen completion count — and the corrected numbers are not written here
either. Run `npm run governance:facts`.

## 10. Gate results at the final head

- `npm run governance:generate` — 7 artifacts, all current
- `npm run check:governance` — ok, 7 domains, 7 generated artifacts match and carry their marker, 21 historical + 4 evidence paths declared
- `npm run check:governance -- --positive-control` — **15 controls, all fire**
- `npm run check:gates:controls` — "every gate proved it can fail"
- `npm run ci:local -- --browser` — **21/21**, tiers 1, 2 and 4
- browser gates specifically: `test:pub001`, `test:pub-family`, `test:shell-chrome`, `test:fonts` — all green against a fresh production build

Tier 3 (disposable PostgreSQL) was **not run**: this program changes no SQL, no
migration and no route handler, and tier 3 needs a PostgREST binary the
container does not carry by default. That is a stated gap, not a pass.

## 11. Every originally pending item, closed

The eight items §11 listed as NOT done, in the order they were listed:

1. **`lib/couranr/screens.ts` still hand-maintained** — **DONE.** Generated from
   the screen source plus the screen ledger. The split the item described was
   the whole point: `status` comes verbatim from the ledger and `implemented` is
   derived from it. The hand-kept boolean disagreed with the ledger on 15 of 66
   screens, eight of them `functional_verified` and flagged false.
2. **Visual-SOURCE status not migrated** — **DONE.** §7 above. Migrating it also
   surfaced that the two source documents disagreed about three root PNGs;
   both claims are preserved and named in `sources.disputes`.
3. **`PRODUCT_SPEC.md` not extracted, Master Package not archived** — **DONE.**
   Extracted verbatim with byte-identity asserted in both directions; the
   Master Package and the package originals are HISTORICAL.
4. **`IMPLEMENTATION_STATUS.md` not generated or shrunk** — **DONE.** The 721-line
   narrative became a generated summary a sixth its length, every number counted
   at render time, with the original preserved whole as evidence.
5. **`02_DECISION_REGISTRY.json`'s circular `generated_from.authority_order`** —
   **DONE.** Replaced with `derived_from` under an explicit HISTORICAL
   PROVENANCE class; the test that pinned the cycle now asserts the provenance
   shape and that no derivation source outranks the registry.
6. **CLS-001 not reconciled** — **DONE.** §8 above.
7. **Phase D not started** — **DONE.** MKT-004, LEG-004 and CLS-002 recorded;
   PUB-012 and PUB-013 added as Core; PUB-001 moved to `/business`; PUB-004
   gained `/send`; sixteen merchant screens re-routed under `/app/business`.
   Canonical sources only — no page is rendered and no route is moved, which is
   what the work order asks for at this stage.
8. **Two §5 rules unimplemented** — **DONE.** Generated files carry
   `GENERATED FILE — DO NOT EDIT` in their own bytes, enforced per artifact; the
   manifest declares HISTORICAL and EVIDENCE and `check:governance` proves no
   path is both, with every historical file carrying a de-authorization banner
   or an explicit exemption reason.

## 12. Deliberately NOT done, and why

Two things, both scoped out on instruction rather than left unfinished.

1. **The frontend V10 implementation.** No page for PUB-012 or PUB-013, no
   `/send` route, no `/app/business` move, no `masterSameDayCopy.ts`, and no
   §27.1 composition rows for the two new screens. The owner's instruction was
   explicit, and the work order gates page rendering behind a separate slice.
   Adding composition rows alone would break the public-family browser gates,
   which drive every governed page — so those rows belong with the pages.
   `MKT-005` (the new copy authority) is likewise not recorded: the
   founder-approved copy it governs is not in the repository yet, and a decision
   record pointing at an absent document is worse than no record.
2. **Resolving the three visual-source disputes.** `5780C3C2` (PUB-001 vs
   PUB-009), `892BDA6D` (OPS-005 vs OPS-006) and `BFAD28C4` (CUS-006 vs
   MER-007) are recorded, not decided. Picking a winner is an owner call about
   which screen a delivered artboard depicts; `check:mocks` goes red if any of
   them stops being recorded, so they cannot quietly disappear.

## 13. Two things this program changed that were not asked for

Both were found while doing the work, and both were real defects rather than
tidying.

- **The ledger and the screen source disagreed about two canonical routes.**
  OPS-002 and OPS-005 each recorded only the first of their two routes. The new
  agreement check found them on its first run; both are fixed and the check is
  permanent.
- **The census document's last three prose claims were wrong.** It asserted
  that none of the 62 `canonical-mvp-images/**` paths existed on disk when
  thirteen do, and twice hand-counted a set that Phase D changed. All three
  render from the source now.

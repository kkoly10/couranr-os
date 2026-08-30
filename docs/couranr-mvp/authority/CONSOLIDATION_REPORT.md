# Authority Consolidation — implementation report

Against `COURANR_AUTHORITY_CONSOLIDATION_WORK_ORDER.md` §11.

**This program is partially executed.** Phase A is complete, parts of B and C
are complete, and Phase D is not started. What is not done is listed in §11
below rather than implied by omission.

---

## 1. Baseline and head

| | |
|---|---|
| work order's stated baseline | `11a668b` (`main`) |
| actual branch HEAD at start | `1b9eab2` — two commits ahead |
| head at this report | see `git log`; the consolidation is five commits |

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

## 3. Active authority list, before vs after

**Before** — the same facts were writable in several places at once:

- 66 screens writable in `ui_screen_registry.json`, `ui_screen_registry.csv` and
  `UI_SCREEN_REGISTRY.md`, with no generator between them, and the Markdown
  declaring *itself* the approved source of truth.
- the public composition contract writable only as Markdown punctuation inside a
  3,000-line design handbook.
- the canonical screen count hardcoded in a gate five times.
- the decision-registry fingerprint, screen count and two completion counts
  pinned in `CLAUDE.md`.

**After** — six declared domains, one writable source each, in
`docs/couranr-mvp/authority/AUTHORITY_MANIFEST.json`:

| Domain | Writable authority |
|---|---|
| product-decisions | `02_DECISION_REGISTRY.json` |
| screens-routes | `ui_screen_registry.json` |
| visual-authority | `docs/couranr-mvp/ui-reference/VISUAL_REGISTRY.json` |
| work-implementation-state | `docs/couranr-mvp/IMPLEMENTATION_LEDGER.csv` |
| screen-implementation-state | `docs/couranr-mvp/SCREEN_IMPLEMENTATION_LEDGER.csv` |
| platform-baseline | `docs/couranr-mvp/platform-baseline-v1.1/` |

Two domains are declared **pending** in the same manifest, with the reason:
`product-doctrine` (no `PRODUCT_SPEC.md` yet, so the Master Package is still
live doctrine) and `visual-source-status` (canonical/derived status still
derived from `MOCK_TO_SCREEN_MAP.md`).

## 4. Files created, promoted, generated

**Created:** `AUTHORITY_MANIFEST.json`, `AUTHORITY_CLASSIFICATION.md`,
`VISUAL_REGISTRY.json`, `scripts/governance/{screenRegistry,visualRegistry,generate,check,facts}.mjs`,
this report.

**Promoted to authority:** `ui_screen_registry.json` (schema upgraded to
`routes[]`), `VISUAL_REGISTRY.json`.

**Demoted to generated:** `UI_SCREEN_REGISTRY.md`, `ui_screen_registry.csv`.

**Demoted to verified human view:** `COURANR_VISUAL_SYSTEM_V2_2.md` §19/§27 —
still hand-written, now checked for drift against the structured contract.

**Deleted:** nothing.

## 5. Generator graph

```
ui_screen_registry.json ──► UI_SCREEN_REGISTRY.md      (byte-exact)
                       └──► ui_screen_registry.csv     (byte-exact, CRLF)
                       └──► check:mocks canonical count
                       └──► governance:facts

VISUAL_REGISTRY.json ──► scripts/compositionContract.mjs
                          ├─► scripts/checkVisualSystem.mjs
                          ├─► tests/couranr-public-composition.test.ts
                          └─► e2e/publicFamilyGates.mjs
                     └──► drift-checked against COURANR_VISUAL_SYSTEM_V2_2.md §19/§27

both ledgers ──► governance:facts ──► (documents point at the command)
```

## 6. Gates changed or added

| Gate | Change |
|---|---|
| `check:governance` | **new** — manifest coherence, source→generated parity, no mutable counts in `CLAUDE.md`, §27 doc drift |
| `governance:generate` | **new** — the only sanctioned way to change a generated artifact |
| `governance:facts` | **new** — measures what documents used to pin |
| `check:visual-system` | unchanged behaviour; its three positive controls **rewritten** to plant into the contract rather than the Markdown |
| `check:mocks` | canonical count derived from the screen source instead of five hardcoded literals |
| `scripts/compositionContract.mjs` | reads structured data; no Markdown token is a machine API |
| `ci:local` | `check:governance` added to tier 2 (16 stages) |
| `check:gates:controls` | `check:governance` registered |

**Nothing was retired.** No test was deleted or weakened.

## 7. PUB-004 is no longer contradictory — but it is not yet *resolved*

The transitional truth §2 mandates is what shipped, and it is recorded in the
manifest rather than left implicit:

- `MOCK_TO_SCREEN_MAP.md` keeps `"PUB-004": []` because `checkMockMap.mjs`
  validates root-PNG residency and the asset is nested;
- `CANONICAL_SCREEN_SOURCE_MAP.tsv` keeps the nested path as provenance;
- generated visual authority keeps `visual_authority: derived`;
- `checkMockMap`'s root rule was **not** relaxed and the nested path was **not**
  added to the root-only map.

The manifest's `visual-source-status` pending entry says this explicitly,
including the instruction not to force it. Full resolution needs the assets half
of `VISUAL_REGISTRY.json`, which is not built.

## 8. Screen count is derived, not duplicated

`check:mocks` derives it. Proven by adding a 67th screen to the source and
watching the gate's arithmetic move, then removing it and watching the original
output return.

`CLS-001`'s `canonical_screens: 66` is **not yet** reconciled mechanically to the
registry — see §11.

## 9. CLAUDE.md has no mutable fingerprints

Enforced by `check:governance` with a positive control. Four claims it carried
were already wrong when measured:

| claimed | measured |
|---|---|
| 1629 tests across 51 files | 2073 across 54 |
| 53 files, 2013 tests | (same suite, stated twice, both wrong) |
| 9 of 42 work items `complete_verified` | 17 of 42 |
| 10 of 66 screens `functional_verified` | 30 of 66 |

## 10. Gate results

- `npm run governance:generate` — "0 rewritten, 2 already current"
- `npm run check:governance` — ok, 6 domains, 2 generated artifacts match
- `npm run check:governance -- --positive-control` — **4 controls, all fire**
- `npm run check:gates:controls` — "every gate proved it can fail"
- `npm run ci:local` — **16/16**, tiers 1–2
- `npm run test:run` — 54 files, 2073 tests

Tiers 3 (database) and 4 (browser) were **not requested and did not run**.

## 11. What could not be consolidated, and why

Not done. Listed so the next pass starts from a true picture.

1. **`lib/couranr/screens.ts` is still hand-maintained.** It carries an
   `implemented` flag, which is implementation *state* and belongs to the
   ledgers, not the screen source. Generating it means splitting that field out
   first — a consumer migration, not a rename.
2. **Visual-SOURCE status is not migrated.** Only the composition half of
   `VISUAL_REGISTRY.json` exists. `VISUAL_AUTHORITY_REGISTRY.json`,
   `MOCK_TO_SCREEN_MAP.md` and `CANONICAL_SCREEN_SOURCE_MAP.tsv` are still
   generated from / written as the old inputs. This is what keeps PUB-004
   transitional rather than resolved.
3. **`PRODUCT_SPEC.md` is not extracted**, so the Master Package and
   `couranr_claude_code_package/*` remain live doctrine and were **not**
   archived. Archiving them before the extraction would have de-authorized
   behaviour with nowhere to live.
4. **`IMPLEMENTATION_STATUS.md` is not generated or shrunk.**
5. **`02_DECISION_REGISTRY.json`'s circular `generated_from.authority_order`**
   still names the Master Package and `UI_SCREEN_REGISTRY.md` above itself, and
   `tests/decision-registry.test.ts` still asserts that order.
6. **`CLS-001` is not reconciled** to the screen registry.
7. **Phase D is not started** — no 66→68, no route materialization. The work
   order gates it behind a green authority model, and items 1–6 are part of that.
8. **Two `check:governance` rules from §5 are not implemented**: generated files
   do not yet carry a do-not-edit marker in their own text, and the manifest does
   not yet assert that historical/evidence files cannot be read as authority.

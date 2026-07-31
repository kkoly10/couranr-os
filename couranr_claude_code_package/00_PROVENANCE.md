# Provenance — read before treating anything here as authority

Unpacked verbatim from `Couranr_Claude_Code_Implementation_Package.zip`, which
has been tracked at the repo root since 2026-07-28 (`f19d9d5`, "Add files via
upload") and was never opened. This directory is the package **as delivered**.
Nothing in it was edited during extraction.

## ⚠ `02_DECISION_REGISTRY.json` in this directory is NOT the authority

There are now two files with that name and they are **different documents**:

| | This directory | Repo root |
|---|---|---|
| Shape | topic-keyed (`pricing`, `states`, `hours`, …) | `decisions[]`, 40 records |
| Size | 9,161 bytes | 71,821 bytes |
| Status | original v1.0 source | **rank-1 authority** |

The root file is the newer, expanded generation derived from this one. It was
verified to be a **superset**: every pricing value in this copy — the $22.99
base for 3 loaded miles, the 225/300/350/400/475 per-mile tiers, overnight 3000,
rush 1200, priority 700, signature 300, additional stop 800, Route Saver 1699,
return 70% — is present in the root registry, which additionally carries launch
gates, legacy-route treatment, feature flags and transition rules that this copy
does not.

`tests/decision-registry-provenance.test.ts` enforces that superset relationship,
so the two cannot silently diverge.

**Cite the root `02_DECISION_REGISTRY.json`.** This copy is kept for provenance
— it shows what was originally delivered — not for citation.

## What is genuinely new here

Only one file. `08_WORK_BREAKDOWN.csv` (37 rows, `P0-001…`) is not inlined
anywhere else in the repo. It is a different document from
`docs/couranr-mvp/platform-baseline-v1.1/09_WORK_BREAKDOWN.csv` (20 rows,
`PB-000…`), which comes from the later platform-baseline package; both are kept.

## What was already in the repo

`Couranr_Claude_Code_Master_Package.md` at the repo root is **byte-identical** to
the copy in this zip, and it inlines the full text of `00_README.md`,
`01_MASTER_IMPLEMENTATION_SPEC.md`, `03_REPO_CUTOVER_MATRIX.md`,
`04_PHASED_EXECUTION_PLAN.md`, `05_AI_COMMUNICATION_SPEC.md`,
`06_RELEASE_ACCEPTANCE_MATRIX.md` and `07_CLAUDE_CODE_START_PROMPT.md` —
verified by sampling non-trivial lines from each, all found in the root file.

So unpacking added no new specification text beyond the work breakdown. It makes
the delivered package inspectable rather than sealed inside a zip, which is the
failure mode that hid the canonical UI images and the logo system for weeks.

## Still unresolved after unpacking

This package does **not** define the review-outcome state transitions. Like the
Master Package §8 and the root registry's `TRN-001`, it lists the `request` and
`review` vocabularies and the actor authority, but never states which
`request_state` an accept / requote / decline moves to. That question remains
open and must not be answered by inference.

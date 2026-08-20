# PUB-001 — native mock references

COURANR_VISUAL_FIDELITY_AMENDMENT.md §10 lists `native-mock-reference(s)` as the
first entry in this bundle. The artboards are **not copied here.** They live at
the repository root, they are large, and a second copy is a second thing that can
drift from the one the drift ledger and `VISUAL_AUTHORITY_REGISTRY.json` name.
This file pins them by path and by checksum instead, so a reviewer can prove the
file they are looking at is the file the ledger was written from.

`CLAUDE.md` also forbids deleting or moving a root PNG, which rules out relocating
them into this directory.

| role | file | sha256 | dimensions |
|---|---|---|---|
| desktop artboard, upper page | `0E4F029F-22C3-4497-A00F-E355DCB3164D.png` | `7910017488b2098fbf422df89a6527665bfcbe5e0ecee67e0b2f911763300bfe` | 1055 × 1491 |
| mobile artboard | `22D9363D-248B-41C0-8C4F-2D38CB3BF3D3.png` | `cc7aa658ed4afa4d8eb9f5499c95bd9288fd37560fdbd5df5ba511a9c9345835` | 941 × 1672 |
| desktop artboard, lower page | `5780C3C2-8EFC-4BDC-87AA-85CE667921D8.png` | `d183b0dad666fe089d9d58560342260c714b59bb6d16e0599837a9bb0393fc03` | 941 × 1672 |

Verify with:

```bash
sha256sum 0E4F029F-22C3-4497-A00F-E355DCB3164D.png \
          22D9363D-248B-41C0-8C4F-2D38CB3BF3D3.png \
          5780C3C2-8EFC-4BDC-87AA-85CE667921D8.png
```

## What these three do and do not cover

Between them the artboards cover twenty of the drift ledger's twenty-four
regions. **Four regions have no artboard at all** — `pickup-problem`,
`category-breadth`, `outcomes` and `workflow`. Amendment §14 governs those: where
the mock is silent, `COURANR_VISUAL_SYSTEM_V2_2.md` controls. They are marked
`(none — no artboard covers this region)` in the ledger's `canonical_mock_file`
column, and `scripts/checkDriftLedger.mjs` refuses to let any of them be
classified `REBUILD`, `RESTYLE` or `REMOVE` — you cannot reconcile toward a
reference that does not exist.

The two 941 × 1672 files are device-frame renders: the page content sits inside a
drawn phone or browser chrome, so their pixel dimensions are not viewport
dimensions. §26 already states the consequence — these are design exports, not
browser screenshots, so no pixel-diff is run against them. Gate B measures real
browser widths separately (`responsive-proof.json`).

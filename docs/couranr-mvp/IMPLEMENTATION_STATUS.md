# Couranr — implementation status

**GENERATED FILE — DO NOT EDIT.** Rendered by `npm run governance:generate`
from `IMPLEMENTATION_LEDGER.csv`, `SCREEN_IMPLEMENTATION_LEDGER.csv`,
`ui_screen_registry.json` and a scan of `app/` and `supabase/`.

Every number here is counted at render time. Nothing is restated from a commit
message, a plan, or an earlier report — and nothing here is authority. The
ledgers own per-item state; this is their sum.

The 721-line hand-written version of this file is preserved whole at
[`autonomous-evidence/status-archive/IMPLEMENTATION_STATUS-2026-08-06.md`](./autonomous-evidence/status-archive/IMPLEMENTATION_STATUS-2026-08-06.md).
It restated per-row evidence the ledgers already carried, and the restatement is
what went stale: it counted 39 migrations while 67 were on disk.

## Where truth lives

| Domain | Source |
|---|---|
| Authority topology | [`authority/AUTHORITY_MANIFEST.json`](./authority/AUTHORITY_MANIFEST.json) |
| Product decisions | [`02_DECISION_REGISTRY.json`](../../02_DECISION_REGISTRY.json) |
| Screens and routes | [`ui_screen_registry.json`](../../ui_screen_registry.json) |
| Visual sources and composition | [`ui-reference/VISUAL_REGISTRY.json`](./ui-reference/VISUAL_REGISTRY.json) |
| Work-item state | [`IMPLEMENTATION_LEDGER.csv`](./IMPLEMENTATION_LEDGER.csv) |
| Screen state | [`SCREEN_IMPLEMENTATION_LEDGER.csv`](./SCREEN_IMPLEMENTATION_LEDGER.csv) |

Run `npm run governance:facts` for the live counts; `npm run check:governance`
proves every generated view matches its source.

## Work items — 42 total

| Status | Count |
|---|---|
| `complete_verified` | 18 |
| `not_started` | 10 |
| `partial` | 10 |
| `complete_pending_external` | 3 |
| `complete_unverified` | 1 |

## Screens — 68 rows against 68 canonical screens

| Status | Count |
|---|---|
| `functional_verified` | 32 |
| `placeholder_only` | 16 |
| `partial` | 10 |
| `functional_unverified` | 6 |
| `missing` | 4 |

Still rendering `ScreenPlaceholder` (16): `DRV-009` · `DRV-010` · `OPS-006` · `OPS-009` · `OPS-010` · `OPS-011` · `OPS-012` · `OPS-013` · `OPS-014` · `OPS-015` · `OPS-016` · `OPS-017` · `OPS-018` · `OPS-019` · `OPS-020` · `OPS-021`.

## Measured repository state

| | count |
|---|---|
| Page routes | 97 |
| …canonical, under `app/(couranr)` | 47 |
| …legacy | 50 |
| API routes | 155 |
| …canonical, under `app/api/couranr` | 93 |
| …legacy | 70 |
| Forward migrations | 74 |
| Paired rollbacks | 74 |
| Canonical screens | 68 |
| …Core | 64 |
| …MVP-complete | 4 |

## Open work items

| Item | Status | Title |
|---|---|---|
| `P1-003` | partial | Disable auto/docs mutation routes |
| `P2-003` | partial | Implement idempotency, audit, and guest tokens |
| `P3-001` | partial | Create policy registry |
| `P4-002` | partial | Implement categories and versioned presets |
| `P5-001` | partial | Implement Smart Intake schema and APIs |
| `P6-004` | partial | Implement balanced ledger and refunds |
| `P7-002` | partial | Implement Operations Queue and review |
| `P7-004` | partial | Implement private proof and offline sync |
| `P7-005` | partial | Implement wait/cancel/return/incident/weather |
| `P8-003` | partial | Implement Driving Mode alert suppression |
| `P9-001` | not_started | Implement AI data broker and audit |
| `P9-002` | not_started | Implement Ghost drafts and operator coach |
| `P9-003` | not_started | Implement verifier and auto-reply gates |
| `P9-004` | not_started | Implement Ask Couranr |
| `P10-001` | not_started | Implement market/conversion/economics/support events |
| `P10-002` | not_started | Implement payment/proof/support/security alerts |
| `P11-001` | not_started | Migrate selected fixtures and disable legacy runtime |
| `P12-001` | not_started | Execute full acceptance matrix |
| `P12-002` | not_started | Complete controlled production canary |
| `P10-007` | not_started | Apply UI-TYP-001 typography to the canonical public surface |

## Recorded blockers and deferments

| Item | Blocker or deferment |
|---|---|
| `P5-001` | NATURAL-LANGUAGE AI IS NOT PILOT-LIVE: the Anthropic adapter exists and is unit-tested against the SDK contract, but the live smoke has not been executed (no ANTHROPIC_API_KEY in the verification environment) and the production environment is not configured. The platform degrades to manual structured intake by design; the fake provider is structurally unavailable in production. |
| `P6-004` | Live Stripe refund round trip not executed in any environment; V0 supports one refund chain per obligation (full or single governed partial) |
| `P7-005` | Waiting-fee assessment requires an owner decision on the charging mechanism (no payer reauthorization path exists); recorded as evidence only |

## Verification SHAs

One row per distinct `last_verified_sha` in either ledger. What was verified at
each is in the ledger row itself — `test_evidence`, `browser_verified` and
`repository_evidence` — and is deliberately not restated here.

| SHA | covers | rows |
|---|---|---|
| `08f59f8d0cc062c36252a7295f86513618187965` | 1 screen | MER-004 |
| `0d57ba736000e8ecb9d28c87a4e78a683599a316` | 1 work item | P3-002 |
| `14fa99fbcf8103d33bb7267a8f4729421bccd400` | 1 work item | P6-001 |
| `1b3a1c90c88a554f1ac1ff1e6a6d06a97d602150` | 3 screens | CUS-006, CUS-008, PUB-006 |
| `2848a8f33bde8362bd3c9fcfb9266781fcecb77a` | 2 screens | PUB-012, PUB-013 |
| `32893e21401a6f056821c4caaa7858460c7356b8` | 1 screen | MER-001 |
| `401b3eea5cd96bb09d224f3b113ba6091bba807d` | 24 work items, 37 screens | P0-001, P0-002, P1-001, P1-002, P1-003, P1-004, P2-002, P4-001, P5-002, P7-001, P7-002, P7-003, P7-004, P8-003, P9-001, P9-002, P9-003, P9-004, P10-001, P10-002, P11-001, P12-001, P12-002, P10-007, CUS-002, CUS-004, CUS-005, CUS-007, DRV-001, DRV-002, DRV-003, DRV-004, DRV-005, DRV-006, DRV-007, DRV-009, DRV-010, MER-002, MER-006, MER-007, OPS-002, OPS-004, OPS-006, OPS-008, OPS-009, OPS-010, OPS-011, OPS-012, OPS-013, OPS-014, OPS-015, OPS-016, OPS-017, OPS-018, OPS-019, OPS-020, OPS-021, PUB-002, PUB-003, PUB-005 |
| `484826a18423eba050aabd6db7daf1287837a793` | 2 work items | P6-004, P7-005 |
| `50f576e991dd249849d93206fc9e7cda330e71b7` | 1 screen | MER-005 |
| `6d97bc132efdb7ed165dae11189077b2ea34d6f9` | 1 work item | P3-001 |
| `795ae0d42131ac76abf7402f0686e139cece4ea5` | 2 work items | P2-003, P6-003 |
| `807c8ed6316cf420dbffa171f5a65b1692dd6830` | 3 screens | MER-003, MER-016, OPS-007 |
| `91515ca5ca26e813bcc14b77b2e72dd475202ea8` | 3 work items, 6 screens | P8-001, P8-002, P8-004, CUS-001, CUS-003, DRV-008, MER-012, OPS-005, PUB-007 |
| `981748b95c0916b15274eb8ef20be1bb1b41f4db` | 1 screen | MER-013 |
| `a8ce376cf303e3b62b889dc7831a3e81dd5522ad` | 1 work item, 1 screen | P5-001, PUB-004 |
| `c2cac8b9ffeaaf7e9a6a528a9eac5d057a2801f9` | 1 work item | P2-001 |
| `c90ec4025fad951cc6a26eea208a687cc18c8cef` | 1 work item, 1 screen | P4-002, OPS-003 |
| `c9e0fe573da29177fa72979911a7e60bf3beb0df` | 2 screens | MER-014, MER-015 |
| `cd697e48889389b5365562d4e7f3c82413c10ea9` | 2 screens | MER-008, MER-009 |
| `d0271ade57785985a4d38bd5328ee0605a24465b` | 1 work item | P6-002 |
| `ec4a2af8f7c1de0bee4e3c021b50c875acdd6633` | 4 work items, 5 screens | P10-003, P10-004, P10-005, P10-006, PUB-001, PUB-008, PUB-009, PUB-010, PUB-011 |
| `f4bff8d0d29fa8be2e9ea1a37bcfa5fd1520005c` | 2 screens | MER-010, MER-011 |\n| `f949f5b05db039649a968390a08ab1ae28213f6d` | 1 screen | OPS-001 |

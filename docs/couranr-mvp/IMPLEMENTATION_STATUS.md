# Couranr — implementation status

**This file is the current-state source of truth.** Every other "current state"
document in this repository is a historical baseline. When they disagree, this
file wins, and the two CSV ledgers beside it carry the per-item detail.

| | |
|---|---|
| Branch | `main` — Phase 8 merged as `f26d857fb797b008fc5772700d65a4e5c181f259` (PR #22, squash; tree-identical to `8f0725f`) |
| Counts re-measured at SHA | `4e0bce874614be57118e869bf9802937ca1c1da4`, re-confirmed at `f26d857` (99 pages / 131 API routes / 43 canonical / 25 placeholders) |
| Per-item status last verified at SHA | `a115f92` for the Phase 8 messaging rows; `4e0bce8`, `ced8af8` and `1b3a1c9` for earlier slices; `401b3ee` for the rest |
| Verified at (UTC) | 2026-08-06 |
| Active slice | [`ACTIVE_EXECUTION_SLICE.md`](./ACTIVE_EXECUTION_SLICE.md) |
| Reconciliation | [`PHASE8_RECONCILIATION.md`](./PHASE8_RECONCILIATION.md) |
| Ledgers | [`IMPLEMENTATION_LEDGER.csv`](./IMPLEMENTATION_LEDGER.csv) · [`SCREEN_IMPLEMENTATION_LEDGER.csv`](./SCREEN_IMPLEMENTATION_LEDGER.csv) |
| Validator | `tests/couranr-implementation-ledger.test.ts` |

**The SHAs mean different things and are deliberately not collapsed.** The
repository-state counts in the table below were re-measured at `4e0bce8` by
re-running each command. Per-row statuses each carry the SHA at which that row
was actually last verified. Raising them all to `4e0bce8` would assert a
re-verification of 42 work items and 66 screens that did not happen.

Every SHA appearing in either ledger, in full, with what it covers:

| SHA | rows | what was verified at it |
|---|---|---|
| `807c8ed6316cf420dbffa171f5a65b1692dd6830` | 2 screens | `MER-016` billing records — 51/51 browser checks after self-review found the total AND the failed-payment alert were both computed from the 100-row page; and `OPS-007` activation slice — the review an operator decides from, built because the decide route was WRITE-ONLY and a decision made blind is not a review. 80/80 on the extended MER-003 run |
| `cea45ae76c3964ae990344eeed0cb99ba50a703e` | 1 screen | `MER-003` live activation checklist — 64/64 unstubbed signed-in browser checks walking `not_started → in_progress → pending_couranr_review → blocked → live`, every step asserted in the page AND on the row. The property proven rather than asserted: the OWNER is refused at the Operations route (403, row unmoved) and `couranr_decide_activation` refuses them again when called directly as a superuser, so no merchant path reaches `live`. Building the run found two real defects — nothing called `record_test_delivery` so the checklist could never be completed, and the route's capability was one role narrower than the SQL's. Carries migration `20260806170000`, **applied to production 2026-08-06** as `20260806160757` |
| `f4bff8d0d29fa8be2e9ea1a37bcfa5fd1520005c` | 2 screens | `MER-010` and `MER-011` — the B04 presets list and builder, recorded `functional_unverified`. The layers beneath ARE executed: schema 24/24 and commands 50/50 in `e2e/disposable/deliveryPresets.mjs`, including a genuine concurrent-save race that proves the `for update` lock rather than only the version check. Neither screen has been driven in a browser yet, and both carry migrations `20260806190000` and `20260806200000`, NEITHER applied to production |
| `cd697e48889389b5365562d4e7f3c82413c10ea9` | 2 screens | `MER-008` and `MER-009` — 34/34 unstubbed signed-in browser checks. PII asserted against RENDERED HTML: a first run caught a REAL LEAK (the internal grouping key put a recipient's phone number inside every Open link) and the browser now receives a tenant-salted digest. Archive proven not to be a delete by an unchanged row count. Carries migration `20260806160000`, **applied to production 2026-08-06** as `20260806160353` |
| `981748b95c0916b15274eb8ef20be1bb1b41f4db` | 1 screen | `MER-013` website tools — 24/24 unstubbed signed-in browser checks, including the rendered QR DECODED back to the merchant's real link (browser-rasterized pixels through jsqr), publish/disable asserted on the row, an invalid embed persisting nothing, and a body naming a status instead of an action refused 400 |
| `e4dd7e2afa29f35ac161985e915db112cbeaedb8` | 2 screens | `MER-014` and `MER-015` — 41/41 unstubbed signed-in browser checks on the disposable stack, including the CONCURRENT double-demote race (two parallel demotes returned 200/409, leaving one active owner where a TypeScript-only guard would have left none), the invite/accept round trip asserted on both rows and both audit events, and the five probes measuring what the un-applied hardening migration actually changes |
| `c9e0fe573da29177fa72979911a7e60bf3beb0df` | 2 screens | `MER-014` and `MER-015` built — settings, team management, and the SQL last-owner protection. Recorded `functional_unverified` until the disposable-stack run (which includes the concurrent double-demote race) is attached. Also carries migration `20260806130000`, the business_members RLS hardening, **applied to production** as `20260806120629` |
| `08f59f8d0cc062c36252a7295f86513618187965` | 1 screen | `MER-004` — 25/25 unstubbed signed-in browser checks on the disposable stack: three separate state-group badges equal to the database facts on the control row, facet independence, inline mark-ready to row + audit event, the stale-tab conflict with no state change, duplicate prefill, viewer/tenant/anonymous refusals, injected-500 error state |
| `32893e21401a6f056821c4caaa7858460c7356b8` | 1 screen | `MER-001` — 27/27 unstubbed signed-in browser checks on the disposable stack: all five registry states screenshot-backed, degraded payments derived through the SAME `lifecycleStage` the Operations queue uses, mark-ready asserted to the row + version + audit event, viewer refusal (403, row untouched) and cross-tenant refusal proven server-side |
| `ec4a2af8f7c1de0bee4e3c021b50c875acdd6633` | 4 work items, 5 screens | the B02 PUBLIC LAUNCH SURFACE — `P10-003/004/005/006`; `PUB-001/008/009/010/011`. 68/68 unstubbed browser checks at both spec viewports, verbatim MKT-002 copy, mutation-tested claims scanner |
| `ca5ac5b0273317b19c1dc728327d9752054f9d8b` | 1 work item | `P2-003` — **ACP-029, the general idempotency substrate**, which the Master Package names at :555 and this repo has never had (`grep -rni idempotenc` historically found one hit, and it was a comment). Built in `private`, whose default ACL grants `service_role` only — `public` grants `arwdDxtm` to anon AND authenticated, so the same table there would be world-writable the instant it existed, and this one records that a money command ALREADY RAN. `npm run test:idempotency` **25/25** against a real PostgreSQL, including **I21, the ON CONFLICT mutex under genuine concurrency** — two real processes, one key, exactly one `proceed`. Stays `partial`: it is NOT WIRED to a caller, so the payment and webhook writes where `resilientUpdateById` still retries by dropping columns are not yet covered, and the retention window remains an owner decision (`expires_at` is caller-supplied and NOT NULL precisely so nothing defaults it). Also retires the last orphaned evidence sha — `P2-003` previously cited `4e0bce87`, which lives only on the unmerged `claude/couranr-phase-8-conversations` |
| `d0271ade57785985a4d38bd5328ee0605a24465b` | 1 work item | `P6-002` gains the ability to RELEASE an authorized hold — ACP-032's first slice. Before it, `paymentIntents.cancel` appeared NOWHERE in the codebase: a hold could be observed and recorded but never given back, and 37 obligations held money with no path to return it. Two SQL commands, a TypeScript wrapper, an Operations route and a Stripe-double endpoint. `test:release` **23/23** against a real PostgreSQL and `test:release:route` **15/15** driving real HTTP through a real Next server. FOUR real defects were found by executing rather than reading — two by the route harness (a nested-key read of `{ obligation }`, and a filter that broke the replay path) and two by a five-lens adversarial review (a version-scoped event id that never advanced, so ONE failed Stripe call made a hold permanently un-releasable with 23505; and a `rejected` outcome reported to the operator as HTTP 200 after Stripe had already cancelled). The status stays `complete_pending_external`: the double proves the request Couranr builds is well formed and proves nothing about Stripe accepting it, and OPS-010 — the screen an operator would actually use — is still a placeholder |
| `91515ca5ca26e813bcc14b77b2e72dd475202ea8` | 3 work items, 6 screens | **B00–B04 merged to `main`, and the Phase 8 slice RE-VERIFIED against the merged tree.** `P8-001`, `P8-002`, `P8-004`; `CUS-001`, `CUS-003`, `MER-012`, `DRV-008`, `OPS-005`, `PUB-007`. Three unstubbed disposable-stack suites re-run at this tree: acceptance matrix 27/27, `customerHelpFragments` 11/11, `authenticatedMessaging` 53/53. These rows previously cited `a115f921` and `ced8af81`, which live only on `claude/couranr-phase-8-conversations` — a branch that was NEVER merged. The work had reached `main` by another route, so the evidence paths, the sha format and this summary all still checked out; only asking git whether the commit is an ancestor caught it. `tests/couranr-implementation-ledger.test.ts` now enforces reachability for every verified row, and `ci.yml` pins `fetch-depth: 0` so that guard is not vacuous. |
| `a115f9212364bab0951053c73877952674ee07d6` | 3 work items, 4 screens | the AUTHENTICATED MESSAGING pass — `P8-001`, `P8-002`, `P8-004`; `MER-012`, `DRV-008`, `OPS-005`, `PUB-007`. 51/51 unstubbed signed-in browser checks, plus the acceptance matrix made re-runnable at 27/27 twice from an empty database |
| `c2cac8b9ffeaaf7e9a6a528a9eac5d057a2801f9` | 1 work item | the B01 platform batch — `P2-001` private/analytics schemas, executed against a disposable database; production apply pending owner approval |
| `ced8af8130ebf8c556360c6d74d09d7338e38e5c` | 2 screens | `CUS-001` and `CUS-003`, unstubbed against a disposable database — 11/11 |
| `4e0bce874614be57118e869bf9802937ca1c1da4` | 1 work item | the Phase 8 HARDENING pass — HRS-002, TRM-002, the disposable database, the deployment-path fix. Its messaging rows have since moved to `a115f92` |
| `401b3eea5cd96bb09d224f3b113ba6091bba807d` | 38 work items, 57 screens | the baseline inventory pass |
| `1b3a1c90c88a554f1ac1ff1e6a6d06a97d602150` | 3 screens | the customer tracking slice — `PUB-006`, `CUS-006`, `CUS-008` |

`40129ee06d96bfdcd85bb653397d2553a1fa5b98` no longer appears in any row: the
`PUB-007` evidence it carried was a project run that could not be repeated, and
it has been superseded by the re-runnable disposable matrix at `a115f92`.

`bf38d156ddcaae70f99c3a0c2d0e82efd0cf26a7` is this branch's base — PR #23, the migration-hygiene fix that took
rollback scripts out of the deployment's reach. Before it, the base was
`c929cc3a8e630bd11ac0a98ff3800a16ee77c140` (the SEC-001 hotfix, PR #21).
Neither appears in a ledger row, because neither changed a work item or a
screen: one is a security correction to `profiles`, the other is deployment
safety. The branch MERGED the new main rather than rebasing, so every
`last_verified_sha` below still points at a reachable object.
`tests/couranr-implementation-ledger.test.ts` requires every distinct ledger SHA
to be named in this file, so this table cannot silently fall out of date.

**This file describes `main` again.** Phase 8 merged on 2026-08-06 as
`f26d857` (PR #22, squash — the tree is byte-identical to the verified branch
head `8f0725f`, so every result transfers). Repository and production agree:
39 forward migrations, 39 production ledger rows, every version equal to its
filename. The autonomous completion run that follows is governed by
[`AUTONOMOUS_COMPLETION_EXECUTION_SPEC.md`](./AUTONOMOUS_COMPLETION_EXECUTION_SPEC.md)
with live state in [`AUTONOMOUS_RUN_STATE.json`](./AUTONOMOUS_RUN_STATE.json).

Every number below was counted at that SHA by a command whose output was read.
None is quoted from an earlier report, a commit message or a plan.

## Visual content — the 2026-08-28 accepted photography batch

Recorded here because it changes what the public pages RENDER and nothing about
what Couranr can DO. No ledger row moves: this is visual content, not a work
item, and treating it as evidence of operational maturity is exactly the mistake
`OWNER_VISUAL_DECISION_2026-08-28.md` was written to prevent.

**Landed.** Eleven owner-accepted photographs installed at
`public/images/marketing/2026-08/`, with responsive WebP derivatives built by
`scripts/buildMarketingImages.mjs` and registered through
`scripts/visualAuthorityRegistry.mjs`. Six render on PUB-001 — four closing the
`category-breadth` placeholder, two making `outcomes` image-led — and three on
PUB-009 as one restrained strip. Two are recorded `approved-reserve` and
deliberately render nowhere. PUB-008 gained two native explanatory diagrams
(loaded miles; authorization → confirmation → capture), both bound to
`lib/couranr/public/governed.ts` at render time.

**Still deferred, and none of it moved:**

- real delivery evidence — none exists that the owner has approved;
- proof-of-delivery photography — the `product-proof` region is frozen and keeps
  its own pending tile;
- product screenshots used as evidence;
- testimonials, customer logos, delivery counts and performance metrics;
- `/estimate`, which remains a `ScreenPlaceholder`. This batch deliberately did
  not decorate it.

**Not claimed.** No photograph asserts that its subject is a Couranr customer or
that its parcel is a Couranr delivery. `tests/couranr-marketing-photos.test.ts`
asserts that boundary against every alt string rather than trusting it.

## Authority sources

1. `02_DECISION_REGISTRY.json` (repo root) — 43 decision records
2. `Couranr_Claude_Code_Master_Package.md` (repo root)
3. `UI_SCREEN_REGISTRY.md` (repo root) — 66 canonical MVP screens
4. `couranr_claude_code_package/08_WORK_BREAKDOWN.csv` — 42 work items
5. `couranr_claude_code_package/04_PHASED_EXECUTION_PLAN.md`
6. `couranr_claude_code_package/03_REPO_CUTOVER_MATRIX.md`
7. `couranr_claude_code_package/06_RELEASE_ACCEPTANCE_MATRIX.md`
8. `docs/couranr-mvp/platform-baseline-v1.1/`

The original package files are preserved as delivered authority. Status lives
here, never in them.

## Status vocabulary

**Work items** — `complete_verified`, `complete_pending_external`,
`complete_unverified`, `partial`, `placeholder_only`, `not_started`, `blocked`,
`deferred_by_decision`, `retired_or_superseded`.

**Screens** — `functional_verified`, `functional_unverified`, `partial`,
`static_only`, `placeholder_only`, `missing`, `deferred`, `retired_or_replaced`.

No other value is permitted, and the validator fails the build on any other.
"Mostly done" and "about 90%" are not statuses.

## Measured repository state

| measure | count |
|---|---|
| Migration files | **40** forward in `supabase/migrations/` + **40** in `supabase/rollbacks/` — paired, rollbacks out of the deployment's reach. The 40th (`20260806100000`, private/analytics schemas) is **pending production approval** |
| Applied migrations (live) | **39 — one row per forward migration, every version matching its filename.** The ledger was repaired and `20260806010000` applied on 2026-08-06 |
| Page routes | 99 total — **44** canonical under `app/(couranr)`, 55 legacy (the legacy homepage was replaced by canonical `PUB-001` under LEG-001) |
| Canonical pages rendering `ScreenPlaceholder` | **21 of 44** — the five B02 public pages left the placeholder set |
| API routes | 131 total, 60 canonical under `app/api/couranr` |
| API routes with no auth/gate/signature/token marker | **18 of 131**, all legacy — see the note below |
| Ungated **canonical** routes | **0** |
| Test files / cases | 41 files, **1285 passing** |
| Live public tables / views | 60 / 6 |
| `couranr_*` tables / functions | 24 / 78 |
| Tables with RLS disabled | **0** |
| Storage buckets / public | 7 / **1** (`vehicle-images`) |
| Local Node / CI Node | v22.22.2 / 24 — `engines >=24`, `.nvmrc` 24, lockfileVersion **3** |
| Framework (B01) | **Next 16.3.0 (Turbopack) / React 19.2.8 / @supabase/ssr 0.12.4 / supabase-js 2.112.1 / ESLint 9 flat config / strict canonical tsconfig** |

**REPOSITORY AND PRODUCTION ARE NOW IN LOCKSTEP.** 39 forward migrations, 39
ledger rows, every version equal to its filename. Before the repair only **3 of
38** matched — migrations had been applied through the MCP path, which stamps
its own timestamp, so `20260804150000_couranr_conversations.sql` was recorded as
`20260804154141`. The repair inserted the 35 repository versions as applied and
removed the 35 orphan stamps; no schema object was touched, verified by counting
tables, functions and rows before and after.

**The rollback pairing gap is closed, and the rollbacks MOVED.** 20 forward
migrations had no rollback; all 39 now do. They live in `supabase/rollbacks/`
because the Supabase CLI treats any `<timestamp>_name.sql` in
`supabase/migrations/` as a migration to APPLY — and `.rollback.sql` sorts
BEFORE `.sql`, so a deployment ran the DROP script first. See PR #23.

**The ungated-route marker set was WIDENED, and it had a false positive.**
Re-deriving at this SHA with the previously recorded marker set —
`requireAdmin`, `resolveRequestActor`, `resolveUserId`, `isActorDenied`,
`getUser(`, `getSession(`, `authorization`, `bearer`, `constructEvent`,
`signature`, `redeem*Token`, `TEST_MODE`, `IS_PROD` — flagged **one canonical
route**, `app/api/couranr/pay/[token]/reconcile/route.ts`. Reading it shows it
is gated: it calls `redeemPaymentLink({ rawToken: params.token })` at line 31
and returns before doing anything if that fails. The `redeem\w*Token` pattern
simply does not match `redeemPaymentLink`. The marker is now
`redeem\w*(Token|Link)`, under which the canonical figure reproduces as **0**
and the legacy figure is **18** — 9 `auto`, 8 `docs`, 1 `special-request`. The
older "18 of 124" is the same 18 routes against a smaller total. The legacy 18
are quarantine targets, not extension points, and are recorded here so the
figure is honest rather than flattering.

## Work items — 42 total

| status | count |
|---|---|
| `complete_verified` | 16 |
| `complete_pending_external` | 3 |
| `complete_unverified` | 1 |
| `partial` | 7 |
| `placeholder_only` | 0 |
| `not_started` | 15 |
| `blocked` | 0 |
| `deferred_by_decision` | 0 |
| `retired_or_superseded` | 0 |

By phase: P0 2 · P1 4 · P2 3 · P3 2 · P4 2 · P5 2 · P6 4 · P7 5 · P8 4 · P9 4 · P10 7 · P11 1 · P12 2

**What Phase 8 moved.** Three items reached `complete_verified` at `a115f92`,
each against its own authoritative acceptance criterion from
`08_WORK_BREAKDOWN.csv` — not against a looser reading of its title.

| item | from | to | the criterion, and what proved it |
|---|---|---|---|
| `P8-001` messaging | `not_started` | `complete_verified` | *"Participant/privacy tests pass."* 51/51 unstubbed signed-in browser checks pairing every browser assertion with a database row or a route refusal, plus 27/27 on the re-runnable acceptance matrix and 93 unit cases. The TRM-002 assertions were **mutation tested** — forcing `memberMayRead` to return `true` stops the run at 12 checks |
| `P8-002` deadlines and Operations Inbox | `not_started` | `complete_verified` | *"Operating/after-hours timers pass."* `HRS-002` resolved (America/New_York) and `20260806010000` applied to production; 36 unit cases with every instant computed independently by Python `zoneinfo`; and in a browser: the badges **and** the header counts, the server recomputing both due states on read, the fallback notice absent, an internal note not stopping the clock, a participant-visible reply stopping it |
| `P8-004` secure Delivery Help | `not_started` | `complete_verified` | *"One-delivery token scope passes."* A2, A10, A11, A11b, A7d and A8c, driven twice from an empty database. The blocker was never the evidence — it was that the matrix could not be re-run. It can now |
| `P2-003` platform primitives | `partial` | `partial` (narrowed) | message idempotency and the conversation audit trail now exist; a general-purpose idempotency table still does not |

**A GAP THAT BELONGS TO NO WORK ITEM, surfaced by this verification.** No code
anywhere creates a `merchant_support` or a `delivery_chat` conversation, and
nothing adds a merchant, driver or operations participant to any thread. The
only `INSERT` into `couranr_conversations` or
`couranr_conversation_participants` across `supabase/migrations`, `lib/` and
`app/` is the Delivery Help redemption path. The layer is proven; in production
a merchant or driver would see the empty state forever. A second, narrower gap
found the same way: `left_at` has no writer, so a **replaced driver keeps
conversation access** — neither `couranr_replace_delivery_assignment` nor
`couranr_unassign_delivery_before_pickup` touches the participant table. Both
need their own slice; neither is inside `P8-001`'s stated criterion, and
neither is being quietly folded into it.

`P8-003` Driving Mode was already `partial` and this slice did not touch it.

### Verified completion

```
verified completion = complete_verified / applicable work items
                    = 16 / 42
                    = 38.1%
```

Nothing is `deferred_by_decision` or `retired_or_superseded`, so the denominator
is all 42 items.

A broader figure, **which is not the same claim**, additionally counts the two
items whose Couranr-side implementation is finished and which await a named
external verification:

```
implemented incl. pending-external = (complete_verified + complete_pending_external) / applicable
                                   = (16 + 3) / 42
                                   = 45.2%
```

Neither number should be quoted without its fraction.

## Screens — 66 total

| status | count |
|---|---|
| `functional_verified` | 27 |
| `functional_unverified` | 5 |
| `partial` | 7 |
| `static_only` | 0 |
| `placeholder_only` | 22 |
| `missing` | 5 |
| `deferred` / `retired_or_replaced` | 0 |

**22 of 66 canonical screens are verified working in a browser.**

Phase 8's messaging screens have all now been driven in a real browser, signed
in, with no `page.route` anywhere — and **that is exactly why two of them are
recorded `partial` rather than promoted.** Driving them is what revealed that
they have no data path in production.

- **`OPS-005`** → `functional_verified`. The Operations inbox is reachable with
  real data today, because Delivery Help *does* have an issuance path: an
  operator issues a help link, a customer redeems it, the thread appears. 20
  checks cover the three kind labels, the overdue and due-soon badges together
  with the header counts, the server recomputing both due states on read, the
  waiting party, urgency, internal-note isolation from the merchant in the same
  thread, the clock-stop semantics, per-participant read state, and the 403 a
  merchant owner and a driver each receive.
- **`MER-012` and `DRV-008`** → `partial`, not `functional_verified`. Every rule
  behind them is proven — TRM-002 read and send for owner, manager and
  dispatcher; viewer and billing refused identically on read *and* post with
  nothing written; the driver tenure window with a control proving the hidden
  message exists; access lost on replacement; no inherited history for the
  replacement driver. But **nothing in the product ever creates the thread they
  would show.** A screen whose every state is correct and whose data can never
  arrive is not functional, and calling it so is the exact rounding-up this
  ledger exists to prevent.
- **`PUB-007`**'s evidence was re-established. It rested on a project run that
  could not be repeated, and its `A12` condition — `/Delivery Help/i` present in
  the body — also matched the marketing navigation, so it would have passed on a
  page rendering a refusal. It now asserts the help form itself and runs
  re-runnably against a disposable database.
- **`CUS-001` and `CUS-003`** were promoted earlier at `ced8af8` on their own
  unstubbed 11/11 run; only their stale "after-hours blocked on HRS-002" note
  changed here.

**Six rows moved across Phase 8 as a whole**, measured by diffing this ledger
against `c929cc3`, and three of them moved twice. Final positions: `PUB-007`,
`CUS-001` and `CUS-003` `missing → functional_verified`; `OPS-005`
`placeholder_only → functional_verified`; `MER-012` and `DRV-008`
`placeholder_only → partial`.

`missing` therefore falls 8 → 5. The five that remain are **not** all
`/help/[token]`, as an earlier revision of this file asserted: they are
`CUS-002`, `CUS-004`, `CUS-007` (help), plus `DRV-007` (offline sync) and
`MER-003` (onboarding activation). **`MER-003` has since shipped** at
`cea45ae` — 64/64 browser checks — leaving four. `CUS-004` is authority-deferred;
`CUS-002` and `CUS-007` describe returns and delivery-charge refunds, which
`P6-004` and `P7-005` do not provide; `DRV-007` needs the unbuilt half of
`P7-004`.

The customer tracking slice moved three: `CUS-006` to `functional_verified`,
and `PUB-006` and `CUS-008` to `partial`. All three were driven in a real
browser — 54 assertions across nine scenarios — and all three are recorded
with their gaps rather than rounded up:

- **PUB-006** renders eight of its nine required states. `return` is
  unreachable because no stored fulfillment state maps to it (STA-002 declares
  the return states; the shipped ten-value vocabulary omits them and P7-005
  has not started). Its "open Delivery Help" action has no destination yet.
- **CUS-008** is READ-ONLY. It confirms address, handoff, leave-at-door
  authorization and the window, and it locks after pickup; it has no edit
  control, no handoff chooser and no save.
- **CUS-006** is complete for the states the registry names. Its image branch
  was driven with a SYNTHETIC proof, because no dropoff proof carrying an image
  exists in the database — every completed delivery so far used the PIN path.

These counts were revised DOWN after an independent adversarial pass disputed
nine of them and was right on five. The corrections, each conservative:

- **DRV-004 and DRV-005** were claimed `functional_verified` citing Group Q.
  Group Q contains **zero** assertions mentioning discrepancy or driving mode —
  they were rendered by a scratchpad smoke, which is not harness evidence.
- **OPS-002** declares **two** routes and one of them,
  `/operations/deliveries`, is a `ScreenPlaceholder` self-identifying as
  `screenId="OPS-002"`. The ledger recorded only the first route, so the
  validator could not see it. This is a known limitation: the ledger carries one
  `current_page_path` per screen.
- **MER-005** is "Create delivery with Smart Intake"; no extraction exists
  (P5-001 is `not_started`), so its required purpose is unmet.
- **OPS-008** is asserted by Group P at the API level, not in a browser.

## What is actually complete

- **Managed dispatch** (P7-001, P7-002 in part) — drivers, vehicles, capability
  matching, assignment, replacement, pre-pickup unassignment. Group P, 28/30.
- **Driver execution and proof** (P7-003, P7-004 in part) — the whole
  `assigned → delivered` lifecycle, both handoff credentials, attempt lockout,
  proof upload verified against the stored object, the sanitized receipt, and
  the media rule (Operations 900s URL, sender metadata-only, driver access
  ending with the assignment). Group Q, 37/37.
- **Request lifecycle** (P5-002) — draft, estimate, submission, review, confirm,
  requote, decline. Group L.
- **Database security** (P2-002) — this closes all four P0s that earlier
  documents list as open. See below.
- **Onboarding** (P4-001), **containment of the two money routes** (P1-001),
  **preservation** (P0-001), **inventories** (P0-002), **the delivery-specific
  webhook boundary** (P1-004).

## Partial

- **P1-003 legacy containment** — 26 `auto`/`docs` API routes remain; none
  returns 410.
- **P2-003 platform primitives** — narrowed by Phase 8, not closed. Guest tokens
  exist (`couranr_payment_access_tokens`, `couranr_help_access_tokens`);
  message-scoped idempotency and a conversation audit trail
  (`couranr_conversation_events`) now exist. What is still missing is the
  **general-purpose** idempotency table the item asks for — the one that would
  cover payment and webhook writes, where `resilientUpdateById` still retries a
  failing update up to 20 times by dropping columns.
- **P8-001 messaging** — `complete_verified` against its criterion, with a gap
  that sits outside it: **no code creates a `merchant_support` or
  `delivery_chat` conversation, or adds a merchant, driver or operations
  participant.** Only Delivery Help redemption does. `MER-012` and `DRV-008` are
  `partial` for that reason, and it needs its own slice.
- **P8-004 secure Delivery Help** — `complete_verified`. The acceptance matrix
  is re-runnable now, and both fragment paths are proven unstubbed.
- **P3-001 / P3-002 pricing** — the canonical engine exists and emits
  `couranr-pricing-2026-07-31`, but `lib/delivery/policy.ts` is still present
  and still reachable through legacy courier routes. **Two pricing engines are
  live at once.**
- **P7-002 Operations** — OPS-003 is verified; OPS-002 is `partial` because one
  of its two declared routes, `/operations/deliveries`, is a placeholder.
  11 of 14 Operations pages are placeholders.
- **P7-004 proof** — private proof is complete and verified; **offline sync,
  the second half of the same work item, does not exist**.
- **P8-003 Driving Mode** — the reduced screen exists and is mounted, but it is
  `functional_unverified`: Group Q contains no driving-mode assertion. Alert
  suppression is not implemented at all.

## Placeholder-only

- **P10-004** `/businesses`, `/how-it-works`
- **P10-005** `/pricing`, `/service-areas`

## Not started — 18 items

`P2-001` private/analytics schemas · `P4-002` presets · `P5-001` Smart Intake ·
`P6-001` immutable quote versions · `P6-004` ledger, refunds, promotional credit ·
`P7-005` exceptions (wait/cancel/return/incident/weather) ·
`P9-001`–`P9-004` all AI work · `P10-001` analytics · `P10-002` observability ·
`P10-003` canonical homepage · `P10-006` MKT-002 claim boundaries ·
`P10-007` UI-TYP-001 typography · `P11-001` legacy cutover ·
`P12-001` acceptance matrix · `P12-002` canary.

The database confirms these are not merely unwired: there is no `private` or
`analytics` schema, and no table matching preset, quote-version, ledger, refund
or incident.

**The conversation and idempotency clause of that sentence no longer holds**, and
that is the whole of what Phase 8 changed here: `couranr_conversations`,
`couranr_conversation_participants`, `couranr_conversation_messages` and
`couranr_conversation_events` now exist, and message idempotency is enforced by
`couranr_cvm_idempotency_uniq` on `(conversation_id, author_participant_id,
idempotency_key)`. That index is author-scoped deliberately: a table-wide
`(conversation_id, idempotency_key)` let a customer's key collide with an
Operations internal note in the same thread, which first returned the note's id
in place of the customer's message and then, once the lookup was fixed, raised
23505 → `internal` → HTTP 500. A replay means "this author sending this key
again", and the lookup and the index now say the same thing.

## External prelaunch obligations

- **P6-002 payment authorization** and **P6-003 webhook reconciliation** —
  `PAYMENT_REAL_STRIPE_VERIFICATION = PENDING_PRELAUNCH`. Groups M/N/O pass
  against a **local Stripe double**. Nothing yet proves Stripe accepts these
  requests. This is the only external obligation in the ledger.

## Launch blockers

`GAT-001` requires all eleven release conditions. On the evidence here the
blocking set is: the customer surface is still incomplete (5 `missing` screens
remain, 3 of them on `/help/[token]`); refunds and the ledger do not exist; the
legacy runtime is still live; and real Stripe is unverified.

**The two decision records that blocked Phase 8 are RESOLVED.** The owner
decided both on 2026-08-06 and both are recorded in the root registry, which
moves `unresolved` from 7 to 5:

- **`HRS-002` — America/New_York**, for every operating hour and support
  deadline, across every market, with the boundary fixed: 06:00 inclusive,
  18:00 exclusive. `P8-002`'s after-hours criterion is implementable and
  implemented; the support clock now runs in OPERATING minutes, so a Friday
  17:58 message is due Monday 06:13 rather than Friday 18:13.
- **`TRM-002` — an explicit permission set per role.** owner, manager and
  dispatcher read and send; viewer and billing have **no conversation access**.
  The prior allow-list was reasoned by analogy to `DRP-001`; the registry
  withdraws that analogy in writing. The substantive change is the read half —
  a viewer could previously read any support thread in their business.

**Three remain unresolved and still constrain work**, and none may be answered
by implementation:

- **`OVN-002`** — the overnight request-and-enable mechanism. `OVN-001` decides
  the overnight *window* and that window is implemented as a clock predicate;
  nothing decides how a merchant requests overnight or how Couranr enables it.
  Naming a timezone did not resolve it, and a provenance test pins it so a
  later edit cannot let overnight enablement be invented in code.
- **Holidays and closures.** `HRS-001` says "normally Monday unless closure or
  observed holiday", and no authority enumerates either. A holiday is treated
  as an ordinary operating day, which marks a thread overdue too *soon* — the
  safe direction — and is recorded rather than guessed.
- **`FLG-001`'s `overnight_enabled` switch** is required to exist and default
  false. It does not exist; no feature-flag mechanism exists at all.

`GAT-002` (incidents and claims) remains `intentionally_deferred`, and it
independently defers overnight from the first slice.

## Known legacy conflicts

- **`app/page.tsx` is still the legacy multi-product homepage.** `PUB-001` is
  therefore `partial`, not functional. Registry `LEG-001` records this.
- **56 legacy page routes and 26 legacy `auto`/`docs` API routes are live.**
- **Two pricing engines** are simultaneously reachable (see P3-002).
- The legacy multi-product Stripe webhook still exists beside the canonical one.
- **18 legacy API routes match no gate marker** — 9 `auto`, 8 `docs`, 1
  `special-request`. An earlier revision of this file named only two of them.
  The worst is still `app/api/special-request`: a POST that only `console.log`s,
  writing caller-supplied contact details to server logs.

## The four P0 database issues are CLOSED

Earlier documents state that four P0s are open and reachable with the public
anon key. Re-verified at `40129ee` with `has_table_privilege` — which counts
privileges inherited through `PUBLIC`, unlike an `information_schema` grantee
read — they are not. `authenticated` and `anon` both hold **no** UPDATE on
`orders`, `deliveries`, `addresses`, `delivery_admin_events` **or** `profiles`,
the last of which is the SEC-001 hotfix holding:

| P0 | claim | measured |
|---|---|---|
| 1 | owning customer can rewrite `orders` money columns | `authenticated` has **no** UPDATE/INSERT/DELETE on `orders`; policies are SELECT-only plus an `is_admin()` ALL |
| 2 | four tables RLS-disabled with full `anon` DML | all four have `relrowsecurity = true`, 0 policies, and `anon` holds no SELECT/INSERT/UPDATE/DELETE |
| 3 | `delivery-photos` public with no policies | `public = false`, 10 MB limit, image-only MIME allow-list |
| 4 | assigned driver can rewrite `deliveries` status and fees | `authenticated` has **no** UPDATE/INSERT/DELETE on `deliveries` |

`vehicle-images` remains the one public bucket and is a separate open item.

## Gates at this SHA

| gate | result | re-run at `a115f92`? |
|---|---|---|
| `npm run lint` | 0 errors (warnings only, `no-img-element` in legacy pages) | yes |
| `npm run typecheck` | 0 | yes |
| `npm run test:run` | **1285 passed, 41 files** | yes |
| `npm run build` | compiled successfully, 91 static pages | yes |
| **Phase 8 acceptance matrix** | **27/27, twice, from an empty database** (`e2e/disposable/acceptanceMatrix.mjs`) | yes — and it is re-runnable now |
| **Authenticated messaging** | **51/51 unstubbed** (`e2e/disposable/authenticatedMessaging.mjs`) | yes |
| **Disposable `/auth/v1` refusals** | **20/20** (`e2e/disposable/authGateway.mjs`) | yes |
| **CUS-001 / CUS-003 fragments** | 11/11 | no — cited from `ced8af8`, twice |
| Browser Group Q | 37/37 | no — cited from an earlier run |
| Browser Group P | 28/30 | no — cited from an earlier run |
| Browser Group N | 33/35 | no — cited from an earlier run |
| Browser Group O | 26/28 | no — cited from an earlier run |

Each browser group's two remaining failures are `CLEAN-behaviour` and
`CLEAN-residue`, the standing non-functional residue condition caused by
`couranr_merchant_workspaces` having no DELETE grant.

## Visual system v2.2 — program state

Not on `main`. This section describes the branch
`claude/couranr-visual-system-v2-2`, and it is here so the visual program's
state is recorded next to the functional one rather than only in the brand
folder.

**The machine-checked source is
[`ui-reference/VISUAL_AUTHORITY_REGISTRY.json`](./ui-reference/VISUAL_AUTHORITY_REGISTRY.json),
regenerated and validated by `npm run check:visual-registry`.** This table is a
summary of it; the registry wins.

| §34 slice | State |
|---|---|
| V0 authority normalization | done — VIS-001 in the root registry, UI registry amended |
| V1 foundation | done — three fonts self-hosted, deterministic, width axis proven in a browser |
| V2 PUB-001 proving surface | done — rebuilt, Gates A/B/C pass |
| V3 remaining public family | done — PUB-008/009/010/011 under §27.1, Gates B/C pass, Gate A n/a (no mocks) |
| V4–V6 product families | typography and grammar propagated via `data-couranr-surface`; **golden-screen Gate A/B/C not run** |
| V7 reconciliation | registry complete for 66/66 screens; ledgers updated here; **no aliases removed** |

**66 visual-authority records exist. 5 have a Gate A record.** A record means the
screen's sources and dimensions are known, not that it was reviewed. The check
prints the split on every run so `66/66` cannot read as `66 reviewed`.

**The PostgREST blocker is CLOSED.** The disposable harnesses defaulted to a
binary path inside one container's ephemeral scratchpad, so all fourteen aborted
on any other machine — after applying 50 migrations, which made a missing
dependency look like a database failure. `npm run provision:postgrest` pulls the
official binary from the Docker Hub registry over plain HTTPS (GitHub Releases
is 403 through the proxy), verifies each layer against the digest the manifest
names, and installs it on PATH. No Docker daemon required; there isn't one.

A second defect sat behind it: `tsconfig.json` includes `.next/types/**/*.ts`,
so a build into `.next-disposable` still type-checked stale route types a
previous `.next` had left behind and never regenerated — TS2307 on files nobody
edited. Twelve harnesses now clear both directories.

**What that unhid.** `MER-001`'s harness had been asserting copy the
application deliberately removed: a static *"Live activation is not yet
available"* banner that `MER-003` replaced with the real activation state, and a
*"Test workspace"* title that is only the fallback for an unmapped state. Both
assertions outlived the code by ten migrations and nobody noticed, because
nobody could run the harness. `D5` now asserts the banner's words against the
row in the database, the way `D3d` does for counts. **30/30, authenticated and
unstubbed.**

**Merchant typography is now measured, not inferred** — `T1`–`T3` in that
harness read the computed font on a real signed-in `/business`: the shell stamps
`merchant`, the page title computes to Martian Grotesk Variable, body copy to
Inter. Operations and Driver still have no equivalent authenticated harness, so
`npm run test:fonts` reports exactly those two as UNVERIFIED and names why.

**Nothing was removed in V7, deliberately.** §34.1's wording is "remove obsolete
visual aliases only where SAFE", and none currently is: `--couranr-font-sans`
is the compatibility body alias §9 keeps during migration and has live
consumers, and `.cr-heading--N` is what the whole product tree still renders.
Removing either today would be a silent restyle, not a cleanup.

**Still open in the document beyond §34:** photography IMG-01…05 (owner-supplied,
blocks Gate A deviations D-1 and D-2 on PUB-001), and the optional
`couranr.tokens.css` extraction, which §34.1 lists as deferrable and which buys
nothing while every token already lives in one file.

---

## Could not be verified in this run

- **The authenticated browser runs do not use GoTrue.** GoTrue could not be
  obtained in this container — three attempts, each with its own reason — so
  `e2e/disposable/gateway.mjs` reimplements the two endpoints the application
  calls, on bcrypt against `auth.users.encrypted_password` and HS256 verified
  with `crypto.timingSafeEqual`. `e2e/disposable/authGateway.mjs` proves 20
  refusals against it, and PostgREST derives `authenticated` from the same
  verified token. What is NOT exercised is GoTrue's own behaviour: sessions as
  rows, refresh-token reuse detection, MFA, email confirmation, rate limiting.
  Neither is the auth-helpers cookie path against a real issuer.
- **The disposable runs exercise the disposable stack, not the connected
  project.** The schema is the same — every forward migration plus
  `bootstrap.sql` reproducing `pg_default_acl` and `service_role BYPASSRLS` —
  but a defect that exists only in the project's out-of-band state would not be
  found there.
- **`MER-012` and `DRV-008` have no production data path**, so what was driven
  is the screen against seeded rows. That is the finding, not a caveat on the
  run: see the work-items section.
- **Groups N, O, P and Q were not re-run at this SHA.** They are cited from
  earlier runs and labelled as such in the table above.
- `P1-002` (`/api/delivery/mark-in-transit`) reads as correctly hardened, but a
  grep of `tests/` and `e2e/` finds **no coverage at all**, so it is recorded
  `complete_unverified` rather than verified.
- **`issueTrackingLink` has no caller.** `lib/couranr/tracking/commands.ts:98`
  is unreachable from `app/`, `lib/`, `components/` or `e2e/`, so no customer
  can be sent a `/track/[token]` link — the same defect `P8-004` carried before
  this slice added an issuance route. It belongs to `PUB-006` and is recorded
  there rather than absorbed into Phase 8.

## Next recommended implementation slice

**Not a feature slice. Make the evidence re-runnable, then merge Phase 8.**

The previous revision of this section recommended Delivery Help. That slice is
built. What it exposed is a gap in how this repository proves things, and
building the next feature on top of it would repeat the failure:

> `P8-004` shipped with **two independent defects that made it impossible to
> use at all** — nothing called `issueHelpToken`, and
> `couranr_conversation_participants.access_token_id` pointed at the *tracking*
> token table, so every redemption failed on a foreign key. Both survived a
> passing typecheck, a passing 1103-case suite, static SQL assertions, source
> scans and a 22/22 browser run. All of that evidence was static or stubbed.
> The first thing that ever invoked `couranr_redeem_help_token` against a real
> delivery found both in one run.

So, in order:

1. **Make the acceptance matrix repeatable.** Today it can be run once and then
   refuses, because it cannot delete its own fixtures. A scratch or branch
   project is the cleanest answer and touches no production row; a scoped
   `SECURITY DEFINER` purge limited to marked rows is the cheapest. **DONE, and
   by neither of those routes.** The matrix now runs against a disposable
   database that starts empty and is destroyed afterwards, so no grant was
   widened: `supabase/migrations/PROPOSED_couranr_e2e_cleanup.sql.review`
   remains **unapplied**.
2. **Close the two verification gaps this slice recorded rather than hid** —
   the `CUS-001`/`CUS-003` fragment paths, and a browser run against `MER-012`,
   `DRV-008` and `OPS-005`. **DONE**: 11/11 and 51/51, both unstubbed, which
   moved `P8-001`, `P8-002` and `P8-004` to `complete_verified`. Driving the
   messaging screens is also what revealed that two of them have no data path in
   production — see the work-items section.
3. **Fix `issueTrackingLink`'s missing caller** under `PUB-006`, not here.
   `/track/[token]` has the identical dead-on-arrival shape `/help/[token]` had.

**What cannot be fixed by implementation, and must be decided:** `OVN-002`
(the overnight request-and-enable mechanism), the holiday and closure calendar
`HRS-001` refers to but never enumerates, and `FLG-001`'s `overnight_enabled`
switch, which is required to exist and does not. `HRS-002` and `TRM-002` were
the two blocking this slice and the owner has now decided both.

`CUS-002` (cancellation and return) and `CUS-007` (return and refund status)
still CANNOT close: both describe returns and delivery-charge refunds, and
`P6-004` (ledger and refunds) and `P7-005` (exceptions) are `not_started`. A
help page that rendered those two as working screens would be the same
overstatement this file exists to prevent.

## Keeping this file honest

Whenever a work item materially changes status, its row in
`IMPLEMENTATION_LEDGER.csv` and the counts in this file must be updated **in the
same commit**. `tests/couranr-implementation-ledger.test.ts` enforces the
structure; it cannot enforce that you remembered.

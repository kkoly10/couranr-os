# Couranr — implementation status

**This file is the current-state source of truth.** Every other "current state"
document in this repository is a historical baseline. When they disagree, this
file wins, and the two CSV ledgers beside it carry the per-item detail.

| | |
|---|---|
| Branch | `claude/couranr-phase-8-conversations` |
| Counts re-measured at SHA | `4e0bce874614be57118e869bf9802937ca1c1da4` |
| Per-item status last verified at SHA | `4e0bce8` for the Phase 8 rows; `401b3ee` for the rest |
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
| `ced8af8130ebf8c556360c6d74d09d7338e38e5c` | 2 screens | `CUS-001` and `CUS-003`, unstubbed against a disposable database — 11/11 |
| `4e0bce874614be57118e869bf9802937ca1c1da4` | 4 work items, 3 screens | the Phase 8 HARDENING pass — HRS-002, TRM-002, the disposable database, the deployment-path fix; `MER-012`, `DRV-008`, `OPS-005` |
| `40129ee06d96bfdcd85bb653397d2553a1fa5b98` | 3 screens | the Phase 8 reconciliation — `PUB-007`, `CUS-001`, `CUS-003` |
| `401b3eea5cd96bb09d224f3b113ba6091bba807d` | 38 work items, 57 screens | the baseline inventory pass |
| `1b3a1c90c88a554f1ac1ff1e6a6d06a97d602150` | 3 screens | the customer tracking slice — `PUB-006`, `CUS-006`, `CUS-008` |

`c929cc3a8e630bd11ac0a98ff3800a16ee77c140` is this branch's base (the SEC-001
hotfix merge, PR #21). It appears in no ledger row, because it changed no work
item and no screen: it is a security correction to `profiles`.
`tests/couranr-implementation-ledger.test.ts` requires every distinct ledger SHA
to be named in this file, so this table cannot silently fall out of date.

**This file now describes a BRANCH, not `main`.** Phase 8 is unmerged. The
database, however, is not: production already carries all seven Phase 8
migrations. `PHASE8_RECONCILIATION.md` records that drift in full and proves
production is schema-identical to a clean replay of this branch.

Every number below was counted at that SHA by a command whose output was read.
None is quoted from an earlier report, a commit message or a plan.

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
| Migration files | 39 forward in `supabase/migrations/` + 39 in `supabase/rollbacks/` — **paired, and rollbacks are out of the deployment's reach** |
| Applied migrations (live) | 38 = the `remote_schema` baseline + 31 pre-Phase-8 forward + **6 Phase 8 rows** |
| Page routes | 99 total — 43 canonical under `app/(couranr)`, 56 legacy |
| Canonical pages rendering `ScreenPlaceholder` | 25 of 43 |
| API routes | 131 total, 60 canonical under `app/api/couranr` |
| API routes with no auth/gate/signature/token marker | **18 of 131**, all legacy — see the note below |
| Ungated **canonical** routes | **0** |
| Test files / cases | 41 files, **1285 passing** |
| Live public tables / views | 60 / 6 |
| `couranr_*` tables / functions | 24 / 78 |
| Tables with RLS disabled | **0** |
| Storage buckets / public | 7 / **1** (`vehicle-images`) |
| Local Node / CI Node | v22.22.2 / 24 |

**"38 files, 38 applied" is a coincidence, not lockstep.** The 38 forward files
are 31 pre-Phase-8 plus this slice's 7. The 38 applied rows are the baseline
plus 31 plus **6**, because `20260804200000` and `20260804210000` were applied
to production as a single row named `couranr_help_hardening_and_token_fk`. A
fresh replay from the repository produces 39 rows where production has 38. The
schemas are identical; only the ledger differs. See `PHASE8_RECONCILIATION.md`
§5, drift D-2.

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
| `complete_verified` | 9 |
| `complete_pending_external` | 2 |
| `complete_unverified` | 4 |
| `partial` | 7 |
| `placeholder_only` | 2 |
| `not_started` | 18 |
| `blocked` | 0 |
| `deferred_by_decision` | 0 |
| `retired_or_superseded` | 0 |

By phase: P0 2 · P1 4 · P2 3 · P3 2 · P4 2 · P5 2 · P6 4 · P7 5 · P8 4 · P9 4 · P10 7 · P11 1 · P12 2

**What Phase 8 moved, and why none of it reached `complete_verified`.**

| item | from | to | why not higher |
|---|---|---|---|
| `P8-001` messaging | `not_started` | `complete_unverified` | the schema, commands, routes and three screens exist and the database surface passes 26/26 executable checks, but no browser has driven MER-012, DRV-008 or OPS-005 |
| `P8-002` deadlines and Operations Inbox | `not_started` | `complete_unverified` | **`HRS-002` is now RESOLVED** — America/New_York, owner decision 2026-08-06. The after-hours branch is implemented, in TypeScript *and* in SQL. Still not `complete_verified`: OPS-005 has never been driven in a browser |
| `P8-004` secure Delivery Help | `not_started` | `complete_unverified` | end-to-end proven unstubbed (A12–A12d) for the bare route; the `#address-change` and `#recipient-unavailable` fragment paths that CUS-001 and CUS-003 depend on were never driven unstubbed |
| `P2-003` platform primitives | `partial` | `partial` (narrowed) | message idempotency and the conversation audit trail now exist; a general-purpose idempotency table still does not |

`P8-003` Driving Mode was already `partial` and this slice did not touch it.

### Verified completion

```
verified completion = complete_verified / applicable work items
                    = 9 / 42
                    = 21.4%
```

Nothing is `deferred_by_decision` or `retired_or_superseded`, so the denominator
is all 42 items.

A broader figure, **which is not the same claim**, additionally counts the two
items whose Couranr-side implementation is finished and which await a named
external verification:

```
implemented incl. pending-external = (complete_verified + complete_pending_external) / applicable
                                   = (9 + 2) / 42
                                   = 26.2%
```

Neither number should be quoted without its fraction.

## Screens — 66 total

| status | count |
|---|---|
| `functional_verified` | 14 |
| `functional_unverified` | 8 |
| `partial` | 5 |
| `static_only` | 1 |
| `placeholder_only` | 33 |
| `missing` | 5 |
| `deferred` / `retired_or_replaced` | 0 |

**14 of 66 canonical screens are verified working in a browser.**

Phase 8 added exactly **one** to that number. `PUB-007` `/help/[token]` is
`functional_verified` on the strength of `e2e/phase8Acceptance.mjs` A12–A12d:
a real Chromium against the real route, the real Supabase project and **no
`page.route` stub** — the page renders for a live token, a message typed into
the form arrives in `couranr_conversation_messages` and reads back through
`couranr_help_thread`, and an unissued token is refused without naming a reason.

**Five screens this slice built were NOT promoted**, under the rule that no row
may be promoted on file existence, static SQL checks, source scans or a stubbed
browser:

- **`CUS-001` and `CUS-003`** share `PUB-007`'s page, so their server path is
  proven. What is *not* proven is the behaviour that distinguishes them: the
  fragment-to-topic preselection at `DeliveryHelpPage.tsx:109`. A12 navigated to
  the bare route and chose the topic with `selectOption`. The only browser
  evidence for `#address-change` and `#recipient-unavailable` is the **stubbed**
  `e2e/deliveryHelp.mjs` run, which the rule excludes.
- **`MER-012`, `DRV-008` and `OPS-005`** have had no browser driven against
  them at all. Their commands were exercised against a real PostgreSQL; that
  proves the database surface, not the page.

**Exactly six rows moved**, measured by diffing this ledger against `c929cc3`:
`PUB-007` `missing → functional_verified`; `CUS-001` and `CUS-003`
`missing → functional_unverified`; `MER-012`, `DRV-008` and `OPS-005`
`placeholder_only → functional_unverified`.

`missing` therefore falls 8 → 5. The five that remain are **not** all
`/help/[token]`, as an earlier revision of this file asserted: they are
`CUS-002`, `CUS-004`, `CUS-007` (help), plus `DRV-007` (offline sync) and
`MER-003` (onboarding activation). `CUS-004` is authority-deferred;
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
- **P8-001 messaging** — `complete_unverified`. Built and passing 26/26
  executable database checks; no browser has driven MER-012, DRV-008 or OPS-005.
- **P8-004 secure Delivery Help** — `complete_unverified`. The bare route is
  proven unstubbed end to end; the two fragment paths are not.
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

| gate | result | re-run at `40129ee`? |
|---|---|---|
| `npm run lint` | 0 errors (warnings only, `no-img-element` in legacy pages) | yes |
| `npm run typecheck` | 0 | yes |
| `npm run test:run` | **1231 passed, 40 files** | yes |
| `npm run build` | compiled successfully, 91 static pages | yes |
| **Phase 8 acceptance matrix** | **26/26** (`e2e/phase8Acceptance.mjs`) | yes — see the caveat below |
| Browser Group Q | 37/37 | no — cited from an earlier run |
| Browser Group P | 28/30 | no — cited from an earlier run |
| Browser Group N | 33/35 | no — cited from an earlier run |
| Browser Group O | 26/28 | no — cited from an earlier run |

Each browser group's two remaining failures are `CLEAN-behaviour` and
`CLEAN-residue`, the standing non-functional residue condition caused by
`couranr_merchant_workspaces` having no DELETE grant.

## Could not be verified in this run

- **The Phase 8 acceptance matrix is not re-runnable against this project.**
  It passed 26/26 once, and that result stands as evidence obtained. It cannot
  be used as a gate: `service_role` holds DELETE on `business_accounts` and on
  **no** `couranr_*` table, so the matrix cannot clean up after itself. Two runs
  left synthetic fixtures beside 42 real orders; both were purged through a
  privileged path and production was verified back to baseline (0 marked rows,
  26 `couranr_deliveries`, 42 orders, 29 legacy deliveries, 94 addresses). The
  preflight now probes the six tables cleanup needs and **refuses to seed**.
  Making it repeatable needs a scratch project, a scoped purge function, or a
  narrow DELETE grant to a harness role — all deferred under the Phase 8 freeze.
- **Groups N, O, P and Q were not re-run at this SHA.** They are cited from
  earlier runs and labelled as such in the table above.
- **The fragment-preselection paths for `CUS-001` and `CUS-003`** were never
  driven against an unstubbed API. See the screens section.
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
   `SECURITY DEFINER` purge limited to marked rows is the cheapest. A proposal
   sits at `supabase/migrations/PROPOSED_couranr_e2e_cleanup.sql.review` and is
   **not applied** — the freeze forbids another Phase 8 migration until the PR
   is open.
2. **Close the two verification gaps this slice recorded rather than hid** —
   the `CUS-001`/`CUS-003` fragment paths, and a browser run against `MER-012`,
   `DRV-008` and `OPS-005`. That is what would move `P8-001` and `P8-004` from
   `complete_unverified` to `complete_verified`.
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

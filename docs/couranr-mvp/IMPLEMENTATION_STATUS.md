# Couranr — implementation status

**This file is the current-state source of truth.** Every other "current state"
document in this repository is a historical baseline. When they disagree, this
file wins, and the two CSV ledgers beside it carry the per-item detail.

| | |
|---|---|
| Branch | `main` |
| Verified at SHA | `401b3eea5cd96bb09d224f3b113ba6091bba807d` |
| Verified at (UTC) | 2026-08-04 |
| Ledgers | [`IMPLEMENTATION_LEDGER.csv`](./IMPLEMENTATION_LEDGER.csv) · [`SCREEN_IMPLEMENTATION_LEDGER.csv`](./SCREEN_IMPLEMENTATION_LEDGER.csv) |
| Validator | `tests/couranr-implementation-ledger.test.ts` |

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
| Migration files | 38 (29 forward + 9 `.rollback.sql`) |
| Applied migrations (live) | 30 = 29 forward + the `remote_schema` baseline — **every forward migration is applied** |
| Page routes | 97 total — 41 canonical under `app/(couranr)`, 56 legacy |
| Canonical pages rendering `ScreenPlaceholder` | 28 of 41 |
| API routes | 122 total, 51 canonical under `app/api/couranr` |
| API routes with no auth/gate/signature/token marker | **2 of 122**, both legacy |
| Ungated **canonical** routes | **0** |
| Test files / cases | 36 files, **1043 passing** |
| Live public tables / views | 54 / 6 |
| `couranr_*` tables / functions | 18 / 62 |
| Tables with RLS disabled | **0** |
| Storage buckets / public | 7 / **1** (`vehicle-images`) |
| Local Node / CI Node | v22.22.2 / 24 |

## Work items — 42 total

| status | count |
|---|---|
| `complete_verified` | 9 |
| `complete_pending_external` | 2 |
| `complete_unverified` | 1 |
| `partial` | 7 |
| `placeholder_only` | 2 |
| `not_started` | 21 |
| `blocked` | 0 |
| `deferred_by_decision` | 0 |
| `retired_or_superseded` | 0 |

By phase: P0 2 · P1 4 · P2 3 · P3 2 · P4 2 · P5 2 · P6 4 · P7 5 · P8 4 · P9 4 · P10 7 · P11 1 · P12 2

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
| `functional_verified` | 11 |
| `functional_unverified` | 5 |
| `partial` | 5 |
| `static_only` | 1 |
| `placeholder_only` | 36 |
| `missing` | 8 |
| `deferred` / `retired_or_replaced` | 0 |

**11 of 66 canonical screens are verified working in a browser.**

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
- **P2-003 platform primitives** — guest tokens exist
  (`couranr_payment_access_tokens`); there is no idempotency or audit table.
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

## Not started — 21 items

`P2-001` private/analytics schemas · `P4-002` presets · `P5-001` Smart Intake ·
`P6-001` immutable quote versions · `P6-004` ledger, refunds, promotional credit ·
`P7-005` exceptions (wait/cancel/return/incident/weather) · `P8-001` messaging ·
`P8-002` support deadlines and Operations Inbox · `P8-004` secure Delivery Help ·
`P9-001`–`P9-004` all AI work · `P10-001` analytics · `P10-002` observability ·
`P10-003` canonical homepage · `P10-006` MKT-002 claim boundaries ·
`P10-007` UI-TYP-001 typography · `P11-001` legacy cutover ·
`P12-001` acceptance matrix · `P12-002` canary.

The database confirms these are not merely unwired: there is no `private` or
`analytics` schema, and no table matching preset, quote-version, ledger, refund,
message/conversation, incident or idempotency.

## External prelaunch obligations

- **P6-002 payment authorization** and **P6-003 webhook reconciliation** —
  `PAYMENT_REAL_STRIPE_VERIFICATION = PENDING_PRELAUNCH`. Groups M/N/O pass
  against a **local Stripe double**. Nothing yet proves Stripe accepts these
  requests. This is the only external obligation in the ledger.

## Launch blockers

`GAT-001` requires all eleven release conditions. On the evidence here the
blocking set is: the customer surface is half-built (`/track/[token]` ships in
this slice; the 8 remaining `missing` screens are all `/help/[token]`); refunds
and the ledger do not exist; the
legacy runtime is still live; and real Stripe is unverified.

## Known legacy conflicts

- **`app/page.tsx` is still the legacy multi-product homepage.** `PUB-001` is
  therefore `partial`, not functional. Registry `LEG-001` records this.
- **56 legacy page routes and 26 legacy `auto`/`docs` API routes are live.**
- **Two pricing engines** are simultaneously reachable (see P3-002).
- The legacy multi-product Stripe webhook still exists beside the canonical one.
- Two legacy API routes have no gate: `app/api/auto/vehicles` (read-only GET)
  and `app/api/special-request` (POST that only `console.log`s — it writes
  caller-supplied contact details to server logs).

## The four P0 database issues are CLOSED

Earlier documents state that four P0s are open and reachable with the public
anon key. Verified at this SHA, they are not:

| P0 | claim | measured |
|---|---|---|
| 1 | owning customer can rewrite `orders` money columns | `authenticated` has **no** UPDATE/INSERT/DELETE on `orders`; policies are SELECT-only plus an `is_admin()` ALL |
| 2 | four tables RLS-disabled with full `anon` DML | all four have `relrowsecurity = true`, 0 policies, and `anon` holds no SELECT/INSERT/UPDATE/DELETE |
| 3 | `delivery-photos` public with no policies | `public = false`, 10 MB limit, image-only MIME allow-list |
| 4 | assigned driver can rewrite `deliveries` status and fees | `authenticated` has **no** UPDATE/INSERT/DELETE on `deliveries` |

`vehicle-images` remains the one public bucket and is a separate open item.

## Gates at this SHA

| gate | result |
|---|---|
| `npm run lint` | 0 |
| `npm run typecheck` | 0 |
| `npm run test:run` | 1043 passed, 36 files |
| `npm run build` | compiled, 91 static pages |
| Browser Group Q | 37/37 |
| Browser Group P | 28/30 |
| Browser Group N | 33/35 |
| Browser Group O | 26/28 |

Each browser group's two remaining failures are `CLEAN-behaviour` and
`CLEAN-residue`, the standing non-functional residue condition caused by
`couranr_merchant_workspaces` having no DELETE grant.

## Could not be verified in this run

- The browser suite could not be re-run during the reconciliation itself:
  `.env.local` is absent after a container recycle. The group results above are
  from runs at this same SHA earlier in the session and are cited as such.
- `P1-002` (`/api/delivery/mark-in-transit`) reads as correctly hardened, but a
  grep of `tests/` and `e2e/` finds **no coverage at all**, so it is recorded
  `complete_unverified` rather than verified.

## Next recommended implementation slice

**Delivery Help — `/help/[token]`.** (The tracking half of this slice,
`/track/[token]`, has shipped; what follows describes what remains.)

Why it is next:

1. It is the largest contiguous hole left. Eight canonical screens have **no
   page at all**, and every one of them is on this route.
2. Everything it needs already exists and is verified. Deliveries reach
   `delivered` with proof (Group Q); `couranr_payment_access_tokens` already
   provides the token-scoped access pattern; `PHO-001` already names the person
   receiving the delivery as an authorized proof-media viewer, and the
   Operations viewer proves the signed-URL mechanism.
3. Nothing else can close without it — a delivery product whose recipient
   cannot see where their delivery is has no customer-visible outcome.
4. It unblocks the exceptions work (P7-005) and support messaging (P8-004),
   both of which are reached *through* Delivery Help.

**Work items it would close:** `P8-004` (secure Delivery Help), and the
customer-facing half of `P7-004` proof viewing.

**Screen IDs it would close:** `PUB-007`, `CUS-001`, `CUS-003`, `CUS-004` —
and it would give `PUB-006` the Delivery Help destination it is currently
`partial` without.

`CUS-002` (cancellation and return) and `CUS-007` (return and refund status)
CANNOT close in that slice: both describe returns and delivery-charge refunds,
and `P6-004` (ledger and refunds) and `P7-005` (exceptions) are `not_started`.
A help page that renders those two as working screens would be the same
overstatement this file exists to prevent.

That is 4 of the 8 remaining `missing` screens, against a foundation that is
already proven.

## Keeping this file honest

Whenever a work item materially changes status, its row in
`IMPLEMENTATION_LEDGER.csv` and the counts in this file must be updated **in the
same commit**. `tests/couranr-implementation-ledger.test.ts` enforces the
structure; it cannot enforce that you remembered.

# Phase 8 reconciliation

> **Historical provenance — not current status.**
> Written against the branch HEAD named below and preserved as the record of
> that reconciliation. It is HISTORICAL in
> `docs/couranr-mvp/authority/AUTHORITY_MANIFEST.json` and outranks nothing.
> Current authority is the manifest's declared domains; current state is the
> two ledgers plus `npm run governance:facts`.

**Produced at branch HEAD `40129ee06d96bfdcd85bb653397d2553a1fa5b98`**, branch
`claude/couranr-phase-8-conversations`, against `origin/main`
`c929cc3a8e630bd11ac0a98ff3800a16ee77c140`.

Every figure here is from a command whose output was read. Nothing is inferred
from a filename or a commit message.

**The base has since moved, and this document is deliberately NOT rewritten.**
It records what was measured at `40129ee` against `c929cc3`, and that
measurement is a historical fact. `main` is now
`bf38d156ddcaae70f99c3a0c2d0e82efd0cf26a7` (PR #23, migration hygiene). The branch
merged that rather than rebasing onto it, so every SHA in the commit table
below is still a reachable object — which is the reason the merge was chosen
over a rebase.

**Why this exists.** Implementation and verification outran the execution-control
documents, and branch migrations were applied to production before the branch
was merged. The authority was never missing — `08_WORK_BREAKDOWN.csv`, the
Master Package and `UI_SCREEN_REGISTRY.md` were correct throughout. The tracking
files simply stopped describing what had been built and applied.

---

## 1. Branch identity and the 16 commits ahead of main

| | |
|---|---|
| Branch | `claude/couranr-phase-8-conversations` |
| HEAD | `40129ee06d96bfdcd85bb653397d2553a1fa5b98` |
| Base | `origin/main` = `c929cc3a8e630bd11ac0a98ff3800a16ee77c140` |
| Ahead | **16** |
| Behind | **0** |

| # | sha | subject |
|---|---|---|
| 1 | `8ac9d83` | docs(execution): add the active execution slice and re-measure status |
| 2 | `b907171` | feat(conversations): P8-001 schema — visibility as a privilege boundary |
| 3 | `65a46e7` | feat(conversations): P8-001 command layer and the participant/privacy tests |
| 4 | `4c6f283` | docs(ledger): record P8-001 as partial and narrow P2-003's remaining work |
| 5 | `31f98ed` | feat(conversations): routes, Operations Inbox and Delivery Help |
| 6 | `3d91cda` | chore: ignore adversarial verification scratch |
| 7 | `ef83da0` | feat(conversations): build MER-012, DRV-008 and OPS-005 messaging screens |
| 8 | `016bb73` | docs(ledger): point the six screen rows at the commit that built them |
| 9 | `0011f8e` | fix(conversations): two defects found reviewing this slice's own work |
| 10 | `6081797` | fix(conversations): harden against the adversarial verification findings |
| 11 | `e90f758` | chore(migrations): write the 20 missing rollbacks, and verify the sequence |
| 12 | `2619172` | fix(migrations): drop CASCADE from rollbacks, add repo-wide sequence tests |
| 13 | `a5b903c` | test(e2e): drive PUB-007 Delivery Help in a real browser |
| 14 | `9c28f24` | fix(conversations): an invisible Operations reply must not stop the clock |
| 15 | `4a519c0` | fix(help): P8-004 could never work — six defects from the unjudged claims |
| 16 | `40129ee` | docs(claude): add the guideline whose absence let P8-004 ship broken |

**A correction to my own earlier reporting.** I first measured this as *93*
commits ahead. That number was computed against a stale local `origin/main` ref
— the container had reverted and I had fetched only the feature branch. After
`git fetch origin main` the count is 16, which matches the figure in the
request. Any earlier statement of 93 is withdrawn.

---

## 2. Phase 8 migration files on the branch

Seven forward migrations, each with a paired rollback:

| file | introduced in |
|---|---|
| `20260804150000_couranr_conversations.sql` | `b907171` |
| `20260804160000_couranr_delivery_help.sql` | `31f98ed` |
| `20260804170000_couranr_conversation_kind_and_tenure.sql` | `31f98ed` |
| `20260804180000_couranr_conversation_hardening.sql` | `6081797` |
| `20260804190000_couranr_conversation_awaiting_reply.sql` | `9c28f24` |
| `20260804200000_couranr_help_hardening.sql` | `4a519c0` |
| `20260804210000_couranr_participant_help_token_fk.sql` | `4a519c0` |

The branch also adds **24 rollback files for migrations that predate Phase 8**
(`e90f758`, `2619172`). Those are not Phase 8 features; they close a pairing gap
that had left 20 of 35 forward migrations with no rollback.

---

## 3. Corresponding migrations applied in production

Production stamps its own version numbers; the repo's filename timestamps are
not carried across. The mapping is by NAME.

| branch file | production version | production name |
|---|---|---|
| `20260804150000_couranr_conversations.sql` | `20260804154141` | `couranr_conversations` |
| `20260804170000_couranr_conversation_kind_and_tenure.sql` | `20260804155147` | `couranr_conversation_kind_and_tenure` |
| `20260804160000_couranr_delivery_help.sql` | `20260804155226` | `couranr_delivery_help` |
| `20260804180000_couranr_conversation_hardening.sql` | `20260804170637` | `couranr_conversation_hardening` |
| `20260804190000_couranr_conversation_awaiting_reply.sql` | `20260805232159` | `couranr_conversation_awaiting_reply` |
| `20260804200000_couranr_help_hardening.sql` | `20260805233401` | `couranr_help_hardening_and_token_fk` |
| `20260804210000_couranr_participant_help_token_fk.sql` | `20260805233401` | *(same row — merged)* |

---

## 4. Branch migrations NOT applied to production

**None.** All seven are applied.

---

## 5. Production migrations not represented by a committed branch file

**None by content.** Every applied row corresponds to a committed file. But the
migration LEDGER has drifted in three ways, all recorded rather than hidden:

**D-1 — Application order is inverted against file order.** Production applied
`couranr_conversation_kind_and_tenure` (`…155147`) *before*
`couranr_delivery_help` (`…155226`), while the repo numbers them `170000` after
`160000`. A fresh `db:reset` would apply them in the opposite order.
*Effect: none.* The two are independent — `170000` amends
`couranr_conversations` and `couranr_conversation_thread` (both from `150000`),
while `160000` creates the help-token table and its functions. Neither reads the
other's objects. Verified by the schema diff in §6.

**D-2 — Two branch files were applied as ONE production row.** `200000` and
`210000` were applied together as `couranr_help_hardening_and_token_fk`. A
replay from the repo produces seven rows where production has six.

**D-3 — Version stamps bear no relation to filenames.** The MCP apply path
assigns its own timestamp. This is pre-existing, not new to Phase 8:
`20260804090000_couranr_delivery_access_tokens.sql` is stamped `20260804034727`,
and `20260804120000_sec001_profiles_role_privilege.sql` is stamped
`20260804142229`. Traceability runs through the NAME only.

---

## 6. Current definitions, and the reconciliation result

**Production is schema-identical to a clean replay of the branch.**

Method: a fresh local PostgreSQL database, all 38 forward migrations applied in
filename order, then every table, foreign key, CHECK, index, trigger and
function in the conversation and help surface extracted from both sides and
diffed.

```
prod objects:  67
local objects: 67
diff: (empty) — IDENTICAL
```

So the drift in §5 is confined to the migration ledger. The schema production is
actually running is exactly what the tracked branch produces. That is the result
that matters for lockstep: **there is nothing to reconcile in the database
itself, and no improvised rollback is needed or appropriate.**

Objects covered by the diff: 5 tables, 14 foreign keys, 21 CHECK constraints,
18 indexes, 4 triggers, 11 functions — including that
`couranr_cvp_help_token_fkey` now references `couranr_help_access_tokens` (the
critical correction) and that `couranr_cvm_idempotency_uniq` is the three-column
author-scoped index.

---

## Issuance command inventory

Requested separately so the tracking-link gap is recorded rather than silently
absorbed into this slice.

| command | defined | real caller |
|---|---|---|
| `issueHelpToken` | `lib/couranr/conversations/help.ts:238` | `app/api/couranr/operations/deliveries/[id]/help-link/route.ts:62` |
| `issuePaymentLink` | `lib/couranr/payments/commands.ts:366` | `app/api/couranr/delivery-requests/[id]/payment-link/route.ts:78` |
| `issueHandoffCode` | `lib/couranr/driver/commands.ts` | `operations/deliveries/[id]/recipient-code` and `…/pickup-code` |
| `issueTrackingLink` | `lib/couranr/tracking/commands.ts:98` | **NONE** |

**The tracking-link issuance gap (recorded, not fixed here).**
`issueTrackingLink` has no caller anywhere in `app/`, `lib/`, `components/` or
`e2e/`. No customer can be sent a `/track/[token]` link, exactly as no customer
could be sent a `/help/[token]` link before this slice added an issuance route.
It belongs to the PUB-006 tracking slice, not to Phase 8, and expanding this
slice to cover it would repeat the mistake this reconciliation exists to
correct. Recorded against PUB-006 in the screen ledger.

---

## Executable acceptance matrix

`e2e/phase8Acceptance.mjs`. **27 of 27 checks pass on two consecutive runs from
an empty database**, including the real `/help/[token]` browser flow with **no
stub on the Couranr API or database**. It first passed 26/26 against the
connected project with synthetic `[P8ACC]` fixtures and then had to be disarmed;
what changed is below.

| id | proof |
|---|---|
| A1 | Operations issues a help token through `couranr_issue_help_token` |
| A2 | the token is scoped to exactly one delivery |
| A3/A3b | first redemption resolves the correct `delivery_help` conversation and participant |
| A4/A4b/A4c | three concurrent first redemptions: no error, ONE conversation, ONE participant |
| A5 | a first customer message persists and returns its own id |
| A6/A6b | a replay returns the CUSTOMER's id — with a colliding Operations internal note planted as the control |
| A7–A7d | no internal note or AI draft in the customer thread; `service_role` gets 42501 on `select *` |
| A8–A8c | revoked and unissued refusals are byte-identical |
| A9/A9b | a new message reopens a closed thread; a replay does not repeat the transition |
| A10 | duplicate customer participant refused (23505) |
| A11/A11b | a second delivery gets its own conversation and cannot read the first's messages |
| A12–A12d | the real unstubbed browser flow: renders, a typed message reaches the database, an unissued token is refused with no reason named |

### The blocking limitation is CLOSED — 27/27, twice, re-runnable

**What was blocking.** `service_role` holds DELETE on `business_accounts` and on
**no** `couranr_*` table — they are append-only by design. The first run passed
all 26 behavioural checks and then failed cleanup, leaving two fixture chains in
a project holding 42 real orders. They were removed through a privileged path;
production was verified back to baseline (0 marked rows, 26
`couranr_deliveries`, 42 orders, 29 legacy deliveries, 94 addresses). The
preflight was then hardened to probe the six tables cleanup needs and refuse to
seed — its first version probed `business_accounts`, which *can* be deleted, so
it passed and the run seeded anyway, which is why the residue happened twice.

**Neither wrong fix was taken.** No production DELETE grant was added, and
`supabase/migrations/PROPOSED_couranr_e2e_cleanup.sql.review` remains unapplied.

**What closed it.** A database that starts empty and is destroyed afterwards, so
cleanup is `rm -rf` rather than a privilege. `e2e/phase8Acceptance.mjs` now runs
in two modes against the **same checks in the same order**:

| | project mode (default) | disposable mode (`E2E_DISPOSABLE=1`) |
|---|---|---|
| target | the connected project | PostgreSQL created empty, all 39 forward migrations, destroyed afterwards |
| fixtures | `[P8ACC]`-marked, never mutating a real row | the whole database is synthetic |
| preflight | refuses to seed what it cannot delete | `Z0` refuses to run unless the host is local |
| cleanup | deletes every seeded chain, reports what it could not | destruction of the cluster |
| after | `Z1`/`Z2`/`Z3` assert the real row counts are identical | n/a |

`e2e/disposable/acceptanceMatrix.mjs` is the driver: database, PostgREST, the
Supabase-shaped gateway, `next build`, `next start`, two seeded profiles, run,
destroy. **27 of 27 on two consecutive runs from an empty database** at
`a115f9212364bab0951053c73877952674ee07d6`.

`Z0` matters and is not ceremony: disposable mode turns the cleanup guarantees
OFF, so pointing it at the connected project would disarm exactly the protection
this file exists to record. It refuses on any non-local host before a single row
is written.

**`A12` was a latent false pass and is fixed.** It asserted `/Delivery Help/i`
in the page body, which the marketing navigation satisfies — the same defect
`customerHelpFragments.mjs` C1 had, found there by looking at the screenshot
rather than at the code. It would have passed on a page rendering a refusal. It
now requires the one topic select and the one message textarea that exist only
in the loaded help form. The 27th check is `Z0`.

### The authenticated messaging pass

`e2e/disposable/authenticatedMessaging.mjs`, **51/51 unstubbed and signed in**,
at the same SHA and on the same disposable stack. Chromium signs in through the
real `/sign-in` form and drives `MER-012`, `DRV-008` and `OPS-005`. Every check
pairs a browser assertion with the database row it implies or with the route's
actual refusal status; the TRM-002 assertions were **mutation tested** by
forcing `memberMayRead` to return `true`, which stops the run at 12 checks.

The sign-in issuer is a reimplementation of two GoTrue endpoints — GoTrue could
not be obtained in this container, three documented attempts — built on bcrypt
against `auth.users.encrypted_password` and HS256 verified with
`crypto.timingSafeEqual`. `e2e/disposable/authGateway.mjs` proves **20/20**
refusals against it: a wrong password issues no token, an unknown address is
refused byte-identically, and a foreign signature, a tampered payload, an
`alg: "none"` header, an expired token and a validly signed token for a
nonexistent user are each rejected. **GoTrue's own behaviour is not exercised**
— sessions as rows, refresh-token reuse detection, MFA, email confirmation and
rate limiting — and neither is the auth-helpers cookie path against a real
issuer. State this wherever the run is cited.

### Two gaps the verification surfaced

Neither is inside any acceptance criterion in `08_WORK_BREAKDOWN.csv`, and
neither is being folded into `P8-001`.

1. **No conversation issuance.** The only `INSERT` into `couranr_conversations`
   or `couranr_conversation_participants` anywhere in `supabase/migrations`,
   `lib/` and `app/` is the Delivery Help redemption path. Nothing creates a
   `merchant_support` or `delivery_chat` thread and nothing adds a merchant, a
   driver — not even on assignment — or an operations participant. `MER-012` and
   `DRV-008` are recorded `partial` for exactly that reason: every rule behind
   them is proven and their data can never arrive.
2. **`left_at` has no writer.** Neither `couranr_replace_delivery_assignment`
   nor `couranr_unassign_delivery_before_pickup` touches the participant table,
   so a replaced driver keeps conversation access in production. The `D7`–`D10`
   checks set `left_at` directly and therefore test the reader, which is the
   half that exists.

Both are the same shape as `issueTrackingLink`, which is the named next slice.

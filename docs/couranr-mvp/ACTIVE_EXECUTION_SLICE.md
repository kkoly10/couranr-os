# Active execution slice

**This is not a product authority.** It duplicates and overrides nothing. It is
an operational pointer to the work currently in progress, and it is deleted or
rewritten as slices complete. Where this file and the package disagree, the
package is right and this file is stale.

The authority chain is unchanged and is listed in §3. Nothing here may be cited
as a reason to build something the package does not require.

## 1. Execution identity

| | |
|---|---|
| Base branch | `main` |
| Base SHA | `bf38d156ddcaae70f99c3a0c2d0e82efd0cf26a7` — PR #23 (migration hygiene) merged into main |
| Previous base | `c929cc3a8e630bd11ac0a98ff3800a16ee77c140` (the SEC-001 hotfix, PR #21) |
| Active branch | `claude/couranr-phase-8-conversations` |
| Reconciled at | `40129ee06d96bfdcd85bb653397d2553a1fa5b98` — **16** commits ahead of the then-base, 0 behind |
| Last verification SHA | `a115f9212364bab0951053c73877952674ee07d6` — the authenticated messaging pass |
| Target PR | [#22](https://github.com/kkoly10/couranr-os/pull/22), draft |
| Status | **`verified`** — every Phase 8 acceptance criterion is now proven by an executed run, and both remaining gaps are recorded rather than absorbed |
| Reconciliation | [`PHASE8_RECONCILIATION.md`](./PHASE8_RECONCILIATION.md) |

The base SHA is the SEC-001 hotfix merge (PR #21). The Phase 8 branch is rebased
onto it, so the conversation work is built on a repository where the admin
predicate is no longer self-grantable.

**The slice is FROZEN, and the reason is specific.** Implementation outran the
execution-control documents, and all seven Phase 8 migrations were applied to
production before the branch was merged. No further Phase 8 migration may be
applied until: the reconciliation is complete (**done**), these tracking files
reflect the branch (**done — this commit**), the executable acceptance matrix
passes (**done — 27/27, twice, and re-runnable now; see §7.3**), and the Phase 8
PR is open with the complete diff.

**No improvised rollback was attempted, and none is needed.** A clean replay of
all 38 forward migrations into a fresh PostgreSQL produces a schema *identical*
to production across all 67 conversation and help objects — 5 tables, 14 foreign
keys, 21 CHECK constraints, 18 indexes, 4 triggers, 11 functions. The drift is
confined to the migration ledger and is documented in the reconciliation §5.

**An earlier report of "93 commits ahead" is withdrawn.** It was measured
against a stale local `origin/main` ref. After `git fetch origin main` the count
is 16.

**PR #23 landed, and this branch MERGED main rather than rebasing onto it.** A
rebase would have rewritten all 38 branch SHAs and invalidated the 16-commit
table in `PHASE8_RECONCILIATION.md` along with every `last_verified_sha` in both
ledgers. Preserving those is the reason #23 was cut from `main` as a separate
branch instead of being carved out of this one's history. Verified after the
merge: all five distinct ledger SHAs are still reachable objects.

The migration-hygiene work — the 20 historical rollbacks, the relocation to
`supabase/rollbacks/`, the location rules and `e2e/disposable/` — is now on
`main` and is no longer this PR's to carry.

## 2. Authoritative work items

Quoted verbatim from `couranr_claude_code_package/08_WORK_BREAKDOWN.csv`, which
is the authority for *what must be built* and *the dependency chain*. Status
comes from `docs/couranr-mvp/IMPLEMENTATION_LEDGER.csv`, which is the authority
for *measured implementation state*. The two are never merged, and status is
never written back into the package.

| work item | phase | domain | task (verbatim) | dependencies (verbatim) | priority | acceptance (verbatim) | measured status |
|---|---|---|---|---|---|---|---|
| `P8-001` | 8 | Messaging | Implement server-controlled conversations | `P2-002` | P1 | **Participant/privacy tests pass** | `complete_verified` |
| `P8-002` | 8 | Support | Implement deadlines and Operations Inbox | `P8-001` | P1 | **Operating/after-hours timers pass** | `complete_verified` |
| `P8-004` | 8 | Customer | Implement secure Delivery Help | `P8-001;P2-003` | P1 | **One-delivery token scope passes** | `complete_verified` |
| `P2-003` | 2 | Platform | Implement idempotency, audit, and guest tokens | `P2-001` | P0 | **Duplicate and token tests pass** | `partial` |

**Why nothing here reads `complete_verified`.** The acceptance criteria are met
at the database layer and proven by execution (§7), but `complete_verified` in
this repository additionally requires browser verification, and three of the
six screens this slice built have never been driven in a browser at all.
`P8-002` cannot reach it on any evidence: its criterion names an after-hours
timer that `HRS-002` makes unwritable.

Dependency readiness, measured:

- `P2-002` — `complete_verified`. `P8-001`'s only declared dependency is met.
- `P2-003` — `partial`. Its remaining work is recorded as *"Add the durable
  idempotency and audit substrate named by the work item."* It gates `P8-004`,
  not `P8-001`, so the message-specific idempotency and audit primitives are
  built during `P8-001` and close out `P2-003` before `P8-004` begins.
- `P2-001` — `not_started`, and `P2-003` declares it as a dependency. The
  private/analytics schema split has not been built. The idempotency work
  therefore lands in `public` alongside the existing pattern rather than in the
  `private` schema the package eventually wants. This is recorded, not resolved.

`P8-003` (Driving Mode alert suppression, `partial`) is in Phase 8 and depends
on `P8-001`, but is **not** in this slice. It also depends on `P7-003`, and its
acceptance ("No routine driving distraction") is a behavioural property of the
driver surface rather than of the conversation substrate.

## 3. Authority paths

In rank order. Every one of these outranks this file.

1. `02_DECISION_REGISTRY.json` — 43 decision records. Rank-1 for pricing, hours,
   payer behaviour, states, terminology, launch gates.
2. `Couranr_Claude_Code_Master_Package.md` — inlines the master implementation
   spec, cutover matrix, phased plan, AI/communication spec and release matrix.
   The binding sections for this slice are **Communication model** and
   **Conversation permissions**.
3. `couranr_claude_code_package/05_AI_COMMUNICATION_SPEC.md`
4. `UI_SCREEN_REGISTRY.md` — 66 canonical MVP screens, their routes, tiers,
   phases and required states.
5. `couranr_claude_code_package/08_WORK_BREAKDOWN.csv` — 42 work items, their
   dependencies and their acceptance criteria.

Current-state ledgers, which record measured status and never requirements:

- `docs/couranr-mvp/IMPLEMENTATION_LEDGER.csv` — work-item status
- `docs/couranr-mvp/SCREEN_IMPLEMENTATION_LEDGER.csv` — screen status
- `docs/couranr-mvp/IMPLEMENTATION_STATUS.md` — the summary and its counts

## 4. Ordered implementation

1. **Security blocker resolution** — SEC-001. **Done:** merged as `c929cc3`,
   applied to the live project, 12/12 verification checks PASS.
2. **`P8-001` conversation foundation** — the schema, the participant model, the
   four visibility values, the named server command every message write goes
   through, and the message-specific idempotency and audit primitives that close
   out `P2-003`'s remaining work. **Built.** `complete_verified`: the privacy
   boundary is structural (no role holds SELECT on the message table; one
   `SECURITY DEFINER` reader; a direct `select *` raises 42501), proven by
   execution, and now driven signed-in in a real browser — 51/51, with the
   TRM-002 half mutation tested. What is NOT built, and is recorded in §7.5
   rather than folded in: nothing creates a merchant or driver conversation.
3. **`P8-002` deadlines and Operations Inbox** — the five deadline fields the
   spec names, the due-state transitions, and the Operations Inbox. **Built,
   `partial`.** The elapsed-time half works and the invisible-reply clock defect
   is fixed; the after-hours half is **blocked by HRS-002 (§6)** and not written.
4. **`P8-004` secure Delivery Help** — `/help/[token]`, scoped to one signed
   token and one delivery. **Built and proven end to end unstubbed**, after two
   defects that made it unusable were found and fixed (§6).
5. **Reconciliation and freeze.** No further Phase 8 migration is applied until
   the PR is open. See the header and `PHASE8_RECONCILIATION.md`.

## 5. Explicit scope

**In scope.** Conversations; participant boundaries; messages; evidence
attachments; read states; internal visibility; message idempotency; audit;
Operations Inbox; support status; token-scoped Delivery Help.

**Out of scope.** Claims adjudication; compensation; product refunds; return
execution; incident workflow; AI auto-replies; and any unresolved business
decision.

Two boundaries worth stating precisely, because they are one word apart from
something in scope:

- `delivery problem` is a legitimate **message topic** — the Master Package
  names it among the seven the customer may report. `CUS-004`, the delivery
  problem *report* screen with structured evidence and a claims workflow, is
  deferred by `GAT-002` (`intentionally_deferred`: *"These ship before broad
  pilot scaling, not before the first slice."*). The topic ships; the claims
  workflow does not.
- **Evidence attachments** are in scope as message attachments. Adjudicating
  what an attachment proves is not.

AI auto-replies being out of scope does not remove the **AI enqueue** obligation
— the Master Package requires every message write to enqueue, and the enqueue is
built. Nothing consumes the queue in this slice.

## 6. Blocking findings

### SEC-001 — a signed-in user could grant themselves admin — **RESOLVED**

**Evidence.** Three catalog-verified facts combined into a complete escalation.
`profiles_update_own` was an UPDATE policy with `polwithcheck IS NULL`, so
PostgreSQL substituted its USING expression and constrained only *which row* is
written, never *which columns*. `authenticated` held table- and column-level
UPDATE on `profiles.role` (`has_column_privilege` → `true`). `public.is_admin()`
is SECURITY DEFINER and answers "are you an admin?" by reading that column.
`admin_all_profiles` is a permissive ALL-command policy with
`USING public.is_admin()`, so self-assignment also opened read and write over
all 30 profile rows. No exploit was run; every fact is a catalog read.

**Affected work items.** `P8-001` directly — `couranr_internal` visibility and
the Operations-only read are gated on the admin predicate, so the entire
participant/privacy acceptance criterion rested on a self-grantable column.
Also every existing admin gate in the repository.

**Resolution state.** Closed. `revoke update on public.profiles from public,
anon, authenticated`, plus an explicit `WITH CHECK (auth.uid() = id)` on
`profiles_update_own`. Merged as `c929cc3` (PR #21) and applied to the live
project. All 12 checks in
`supabase/verification/sec001_profiles_role_privilege.sql` report PASS.

**Condition for unblocking.** Met.

### HRS-002 — the operating-hours timezone — **RESOLVED 2026-08-06**

**Evidence.** `02_DECISION_REGISTRY.json` records `HRS-002` as `unresolved`
with the acceptance criterion *"A named IANA timezone is recorded before any
cutoff logic ships."* The Master Package fixes operating hours at Monday–Friday
06:00–18:00 and requires conversation deadlines to store the next operating
period — but a wall-clock window is not evaluable without a zone. No hours or
timezone logic exists anywhere in `lib/couranr/`; the grep for
`operating_hours|IANA|timeZone` returns nothing.

All 26 rows in `couranr_deliveries` carry `timezone = 'America/New_York'`, so a
named IANA zone is already recorded **per delivery**. That is not a resolution:
a per-delivery zone does not decide which zone Couranr's own support window is
expressed in, and only the registry can.

**Affected work items.** `P8-002`, whose acceptance is *"Operating/after-hours
timers pass"* — the after-hours half cannot be evaluated. `P8-001` is
unaffected.

**Resolution state.** Open, and not resolvable from the code. Building against a
guessed zone would ship cutoff logic in direct violation of the acceptance
criterion.

**Condition for unblocking.** A named IANA timezone recorded in
`02_DECISION_REGISTRY.json` against `HRS-002`. Until then `P8-002` ships the
timezone-free half — `received_at`, `response_due_at`,
`first_couranr_response_at`, and the due-soon/overdue transitions at 10 and 15
minutes, all of which are pure elapsed-time arithmetic — and the next-operating-
period field is created but never written.

### TRM-002 — merchant role permissions — **RESOLVED 2026-08-06**

**Evidence.** `02_DECISION_REGISTRY.json` records `TRM-002` as `unresolved`:
*"Each of the five roles has an explicit permission set before MER-015 ships."*
The Master Package says merchant support *"includes authorized merchant roles
and Couranr"* — participation is role-gated, not membership-gated. The five
roles (`owner|manager|dispatcher|viewer|billing`) exist in the schema, and no
code reads the `role` column.

**Affected work items.** `P8-001`, directly and specifically: which merchant
roles may participate in a support conversation is a participant-boundary
question, and the acceptance criterion is *"Participant/privacy tests pass"*.

**Resolution state.** Open. This does **not** hold the slice, because the
conservative reading is available and safe: the participant model stores the
role on each participant row and gates on it, with the initial allow-list set to
the roles `DRP-001` already grants request authority. Widening later is additive;
narrowing later is a breaking change, so starting narrow is the reversible
direction.

**Condition for unblocking.** An explicit permission set per role recorded
against `TRM-002`. The participant model must not be read as having decided it.

### P8-004 was unreachable twice over — **RESOLVED**

Recorded here because it is the finding that justifies the whole executable
acceptance matrix, and because it names the evidence class that failed.

**Two independent defects, either of which alone made the feature impossible to
use.** (1) **Nothing ever called `issueHelpToken`** — the page, the route, the
commands and the SQL were all present and correct, and no path minted a token,
so no customer could receive a link. (2)
`couranr_conversation_participants.access_token_id` was declared in
`20260804150000` as `references public.couranr_delivery_access_tokens(id)` —
the **tracking** token table — while `couranr_redeem_help_token` inserts a
**help** token id, so every redemption failed with a foreign-key violation.

**Why nothing caught them.** Every test of this slice was static: SQL text
assertions, TypeScript source scans, and a browser run whose API layer was
stubbed with `page.route`. Nothing invoked `couranr_redeem_help_token` against a
real delivery. A migration that applies cleanly and a function that compiles
prove nothing about a foreign key that only fires on INSERT.

**Resolution.** `20260804210000` retargets the constraint, guarded by a `DO`
block that raises `CR409` rather than dropping a constraint holding real rows;
`app/api/couranr/operations/deliveries/[id]/help-link/route.ts` issues links,
Operations-only, with a clamped TTL and the raw token returned exactly once.
Both proven by A1–A3b and A12–A12d in §7.1.

**The standing consequence.** `CLAUDE.md` now carries an execution-verification
rule, and no Phase 8 item may be promoted on file existence, static SQL checks,
source scans or a stubbed browser.

### The hardening pass, and what it changed

`HRS-002` and `TRM-002` were both `unresolved` and both blocked Phase 8. The
owner decided them on 2026-08-06 and both are now implemented:

- **HRS-002 = America/New_York.** The support clock runs in OPERATING minutes.
  A Friday 17:58 message is due Monday 06:13, not Friday 18:13. Implemented on
  BOTH sides of a dual path — `stampDeadlines` in TypeScript and
  `couranr_help_post_message` in SQL, which set its own flat deadline and would
  otherwise have left every customer-initiated thread on the old clock. The two
  implementations were executed against each other on the same instants and
  agree, including both 2026 DST crossings.
- **TRM-002.** owner, manager and dispatcher read and send; viewer and billing
  have NO access. The read half is the substantive change: the code previously
  said in as many words that "a viewer or billing member may read a thread and
  may not post to it".

**A P0 was found while proving the deployment path.** `supabase db push` treats
every `*.rollback.sql` in `supabase/migrations/` as a migration to APPLY, and
`.rollback.sql` sorts BEFORE `.sql`, so it ran the DROP script first and then
died on a duplicate version. Separately, 35 of 38 repo migration versions are
absent from production's ledger. Both are addressed in PR #23, split out so the
safety fix can merge without waiting for Phase 8 review.

**A disposable database replaces the production dependency.** `e2e/disposable/`
starts empty, applies every migration, verifies nine fidelity properties
against production semantics, and destroys itself — so the acceptance matrix no
longer needs DELETE on a project holding 42 real orders.

**Still unresolved, and still not implementable:** `OVN-002` (the overnight
request-and-enable mechanism), the holiday and closure calendar `HRS-001`
refers to but never enumerates, and `FLG-001`'s `overnight_enabled` switch.

## 7. Verification matrix

Every row is a requirement traced to the exact place it is enforced and the
exact command that proves it. A row with no command is not verified, and says so.

| requirement | enforcement point | test or catalog query | result | verified SHA |
|---|---|---|---|---|
| `authenticated` cannot UPDATE `profiles` | `revoke update … from public, anon, authenticated` | `has_table_privilege('authenticated','public.profiles','update')` | `false` — PASS | `c929cc3` |
| `authenticated` cannot UPDATE `profiles.role` | same revoke | `has_column_privilege('authenticated','public.profiles','role','update')` | `false` — PASS | `c929cc3` |
| `anon` cannot UPDATE `profiles` / `.role` | same revoke | `has_table_privilege` / `has_column_privilege` for `anon` | `false` / `false` — PASS | `c929cc3` |
| No UPDATE inherited through `PUBLIC` | `public` named in the revoke | `has_column_privilege('public','public.profiles','role','update')` | `false` — PASS | `c929cc3` |
| `profiles_update_own` states its WITH CHECK | `alter policy … with check` | `pg_policy.polwithcheck is not null` | `(auth.uid() = id)` — PASS | `c929cc3` |
| `service_role` retains UPDATE | revoke omits `service_role` | `has_table_privilege('service_role',…,'update')` | `true` — PASS | `c929cc3` |
| Reads unaffected | `SELECT` untouched | `has_table_privilege('authenticated',…,'select')` | `true` — PASS | `c929cc3` |
| Signup unaffected | `handle_new_user` is SECURITY DEFINER owned by `postgres` | `pg_proc.prosecdef` + `pg_get_userbyid(proowner)` | `true / postgres` — PASS | `c929cc3` |
| Profile creation unaffected | `INSERT` untouched | `has_table_privilege('authenticated',…,'insert')` | `true` — PASS | `c929cc3` |
| The real admin still resolves | `is_admin()` reads `profiles.role` | `count(*) from profiles where role='admin'` | `1 of 30` — PASS | `c929cc3` |
| Regression guard actually fails | `tests/sec001-profiles-role.test.ts` | five injected regressions, each re-run | all 5 fail as required; restored suite 10/10 green | `c929cc3` |
| No app code writes `profiles` | same test file | AST-free scan of `.from("profiles").update\|upsert\|delete` | 0 offenders | `c929cc3` |
| Full suite green | — | `npm run test:run` | 38 files / 1103 tests pass | `c929cc3` |
| Types clean | — | `npm run typecheck` after `rm -rf .next` | clean | `c929cc3` |

### 7.1 Phase 8 — executed against a real PostgreSQL

**Static SQL assertions and source scans do not appear in this table.** They are
the evidence class that let `P8-004` ship with two defects that made it
impossible to use. Every row below is a function *invoked* against the live
project with synthetic `[P8ACC]` fixtures by `e2e/phase8Acceptance.mjs`, or a
catalog read. This table records the ORIGINAL project run at `40129ee`, 26 of 26.
The same checks now pass 27 of 27 on a disposable database, twice — see §7.3.

| requirement | enforcement point | proof | result | SHA |
|---|---|---|---|---|
| `P8-004` one-delivery token scope | `couranr_issue_help_token`, `couranr_help_access_tokens.delivery_id` | A1–A2: issue a token, assert exactly one delivery | PASS | `40129ee` |
| A token resolves the right thread | `couranr_redeem_help_token` | A3/A3b: correct `delivery_help` conversation **and** participant | PASS | `40129ee` |
| Concurrent first use does not 500 | `insert … on conflict do nothing` + `couranr_cv_one_thread_per_delivery_kind` | A4/A4b/A4c: **three concurrent** first redemptions → no error, ONE conversation, ONE participant | PASS | `40129ee` |
| A customer message persists | `couranr_help_post_message` | A5: returns its own id, row present | PASS | `40129ee` |
| Idempotency is per AUTHOR | `couranr_cvm_idempotency_uniq (conversation_id, author_participant_id, idempotency_key)` | A6/A6b: replay returns the CUSTOMER's id **with a colliding Operations internal note planted as the control** | PASS | `40129ee` |
| `P8-001` participant/privacy | `couranr_help_thread`; no role holds SELECT on the message table | A7–A7d: no internal note and no AI draft in the customer thread; **`service_role` gets 42501 on `select *`** | PASS | `40129ee` |
| Refusals are indistinguishable | one `CR404 help_link_not_available` for unknown/revoked/expired | A8–A8c: revoked and unissued refusals are **byte-identical** | PASS | `40129ee` |
| A closed thread reopens, once | `status = case when … in ('resolved','closed') then 'open'` | A9/A9b: a new message reopens; a **replay does not repeat the transition** | PASS | `40129ee` |
| One live customer participant | `couranr_cvp_live_token_uniq` | A10: duplicate refused with 23505 | PASS | `40129ee` |
| Cross-delivery isolation | token → delivery → conversation chain | A11/A11b: delivery B gets its own thread and **cannot read A's messages** | PASS | `40129ee` |
| `PUB-007` end to end, unstubbed | the real route + the real database | A12–A12d: renders for a live token; a message **typed in Chromium** lands in `couranr_conversation_messages`; an unissued token is refused naming no reason | PASS | `40129ee` |
| The help token FK targets the help table | `couranr_cvp_help_token_fkey` | catalog read of `pg_constraint` (below), and A3 could not pass otherwise | `couranr_help_access_tokens` — PASS | `40129ee` |
| Full suite green | — | `npm run test:run` | **40 files / 1231 tests pass** | `40129ee` |
| Types clean | — | `npm run typecheck` | clean | `40129ee` |
| Lint clean | — | `npm run lint` | 0 errors | `40129ee` |
| Build | — | `npm run build` | compiled, 91 static pages | `40129ee` |
| Every forward migration has a rollback | `tests/couranr-migrations.test.ts` | 13 repo-wide rules | 38/38 paired | `40129ee` |
| Production == a clean branch replay | — | all 38 forward migrations into a fresh PostgreSQL, both schemas extracted and diffed | **67 objects each, empty diff** | `40129ee` |

The FK catalog read, run at this SHA:

```
conname                    | references_table            | def
couranr_cvp_help_token_fkey| couranr_help_access_tokens  | FOREIGN KEY (access_token_id)
                           |                             |   REFERENCES couranr_help_access_tokens(id)
```

This is the constraint whose original form pointed at
`couranr_delivery_access_tokens` — the **tracking** token table — which made
every single help-link redemption fail with a foreign-key violation. `P8-004`
was unreachable twice over: nothing minted a token, and no minted token could
have been redeemed.

**The clock defect is deliberately NOT in the table above.** An Operations reply
the waiting party cannot see was permanently removing a thread from the overdue
queue; the fix adds `awaiting_reply_kind` and gates the stop on `canSee`. It was
proven live during the session with an A/B sharing one control — both arms
overdue, Arm A (visible reply) stops the clock, Arm B (internal-only) stays
overdue. That run was real evidence but was not re-runnable, and the only
standing coverage was a static source assertion in
`tests/couranr-conversations.test.ts:1103`. **That gap is now closed by
execution**: `O11` asserts an internal note does NOT stop the clock and `O15`
asserts a participant-visible reply does and returns the thread to the waiting
party, both in a browser and both read back from
`couranr_conversations.first_couranr_response_at`, `due_state` and `waiting_on`.

### 7.1a The authenticated messaging pass — `a115f92`

`e2e/disposable/authenticatedMessaging.mjs`, **51/51, unstubbed and signed in**,
from a database created empty with all 39 forward migrations and destroyed
afterwards. No `page.route`. Every row pairs the browser with the database or
with the route's actual status.

| requirement | proof | result |
|---|---|---|
| TRM-002 read and send — owner, manager, dispatcher | `M-*-2` renders exactly the threads that role participates in, derived from the participant rows; `M-*-4` asserts the sent message reached `couranr_conversation_messages` authored by that role's own participant row | PASS |
| TRM-002 no access — viewer, billing | `M-*-1` empty list; `M-*-2` the **control** proving they ARE live participants; `M-*-3` a direct read refused `404 not_found`, never `not_permitted`; `M-*-4` a direct post refused **and zero rows written** | PASS |
| That the TRM-002 checks bind at all | **mutation test**: `memberMayRead` forced to `return true`, rebuilt, re-run — the run stops at 12 checks | PASS |
| Driver tenure window | `D3`/`D4` see the after-join message and not the before-join one; `D5` the **control** proving both rows exist | PASS |
| Access lost on replacement | `D7` empty list, `D8` read refused, `D9` post refused with zero rows written | PASS |
| No inherited history | `D10` the replacement driver sees neither earlier message; `D11` the control proving their participant row is live | PASS |
| OPS-005 unifies all three kinds | `O2` asserts the merchant-support, merchant–driver and customer-help labels all render | PASS |
| Operating-clock marks | `O3`/`O4` badges **and** header counts; `O5` the server recomputed both due states on read from seeded `on_time` | PASS |
| HRS-002 applied, not assumed | `O8` the elapsed-time-only notice does not render; `O20` the route reports `operatingHoursApplied: true`, `America/New_York` | PASS |
| Internal notes reach only Operations | `O10` stored `couranr_internal`; `O12` Operations reads it; `O13` the merchant in the same thread does not; `O14` the control | PASS |
| The clock stops only on something the waiting party receives | `O11` an internal note does NOT stop it; `O15` a participant-visible reply does and returns the thread to the merchant | PASS |
| Read state is per participant | `O16`/`O17` the manager's mark is byte-identical before and after the owner reads, and distinct from the owner's | PASS |
| Operations-only | `O18` a merchant owner 403; `O19` a driver 403 | PASS |

The `/auth/v1` behind those sign-ins is proved separately:
`e2e/disposable/authGateway.mjs`, **20/20** — a wrong password issues no token,
an unknown address is refused byte-identically (no enumeration), and a foreign
signature, a tampered payload, an `alg: "none"` header, an expired token and a
validly signed token for a nonexistent user are each refused.

### 7.2 What is NOT verified, stated as such

| requirement | why not |
|---|---|
| GoTrue itself | **not obtainable in this container** — three documented attempts. `gateway.mjs` reimplements the two endpoints the application calls, on real bcrypt and real HS256, and `authGateway.mjs` proves 20 refusals against it. Sessions-as-rows, refresh-token reuse detection, MFA, email confirmation and rate limiting are NOT exercised, and neither is the auth-helpers cookie path against a real issuer. |
| `MER-012` / `DRV-008` with production data | **there is none.** No code creates a `merchant_support` or `delivery_chat` conversation, or adds a merchant, driver or operations participant. Both screens are `partial` for that reason — see §7.5. |
| Unassignment closing conversation access | `left_at` **has no writer**. The reader is proven; the write half does not exist — see §7.5. |
| Groups N, O, P, Q at this SHA | not re-run; cited from earlier runs. |
| The connected project's out-of-band state | the disposable runs exercise the same schema, not the same instance. |

### 7.3 The acceptance matrix is re-runnable now — 27/27, twice

The blocker was real and is closed. `service_role` holds DELETE on
`business_accounts` and on **no** `couranr_*` table — they are append-only by
design — so the first run passed all 26 behavioural checks and then failed
cleanup, leaving two fixture chains in a project holding 42 real orders. Both
were purged through a privileged path and production was verified back to
baseline: 0 marked rows, 26 `couranr_deliveries`, 42 orders, 29 legacy
deliveries, 94 addresses.

**Neither wrong fix was taken.** No production DELETE grant, and
`supabase/migrations/PROPOSED_couranr_e2e_cleanup.sql.review` stays unapplied.

`e2e/phase8Acceptance.mjs` now runs in two modes against the **same checks in
the same order**. Project mode is unchanged and keeps every protection: the
`[P8ACC]` marker, the delete-capability preflight, the cleanup, and Z1/Z2/Z3
asserting the real row counts are identical afterwards. Disposable mode
(`E2E_DISPOSABLE=1`, driven by `e2e/disposable/acceptanceMatrix.mjs`) targets a
PostgreSQL created empty with all 39 forward migrations and destroyed
afterwards; the preflight and cleanup are replaced by `Z0`, which **refuses to
run unless the target host is local** — because that mode turns the cleanup
guarantees off, and pointing it at the project would disarm exactly what the
file exists to provide.

`A12` was also a latent false pass and is fixed: it asserted `/Delivery Help/i`
in the body, which the marketing navigation satisfies, so it would have passed
on a page rendering a refusal. It now requires the topic select and the message
textarea that exist only in the loaded help form.

### 7.5 Two gaps this verification surfaced, belonging to no work item

Both were found by driving the screens, and neither is inside any acceptance
criterion in `08_WORK_BREAKDOWN.csv`. They are recorded here and in the screen
ledger rather than absorbed into `P8-001`.

1. **No conversation issuance.** The only `INSERT` into
   `couranr_conversations` or `couranr_conversation_participants` anywhere in
   `supabase/migrations`, `lib/` and `app/` is the Delivery Help redemption path
   (`20260804160000:129,143` and `20260804200000:108,122`). Nothing creates a
   `merchant_support` or `delivery_chat` thread; nothing adds a merchant, a
   driver — not even on assignment — or an operations participant. `MER-012` and
   `DRV-008` therefore render the empty state forever in production. This is the
   same shape as `issueTrackingLink` in §7.4.
2. **`left_at` has no writer.** Neither
   `couranr_replace_delivery_assignment` nor
   `couranr_unassign_delivery_before_pickup` touches
   `couranr_conversation_participants` — 0 hits across all three dispatch
   command migrations — so a replaced driver keeps conversation access. `D7`–`D10`
   set `left_at` directly and therefore test the **reader**, which is the half
   that exists.

### 7.4 Issuance commands and their real callers

| command | defined | real caller |
|---|---|---|
| `issueHelpToken` | `lib/couranr/conversations/help.ts:238` | `app/api/couranr/operations/deliveries/[id]/help-link/route.ts:62` |
| `issuePaymentLink` | `lib/couranr/payments/commands.ts:366` | `app/api/couranr/delivery-requests/[id]/payment-link/route.ts:78` |
| `issueHandoffCode` | `lib/couranr/driver/commands.ts` | `…/recipient-code` and `…/pickup-code` |
| `issueTrackingLink` | `lib/couranr/tracking/commands.ts:98` | **NONE** |

`issueTrackingLink` has no caller anywhere in `app/`, `lib/`, `components/` or
`e2e/`, so no customer can be sent a `/track/[token]` link — the identical
defect `P8-004` carried before this slice added an issuance route. It belongs to
the `PUB-006` tracking slice and is **recorded there, not fixed here**;
absorbing it would repeat the scope creep this freeze exists to stop. It is the
**named next slice**, to start once PR #22 closes.

§7.5 records two more of the same shape, found by driving the messaging screens:
conversation issuance, and the missing `left_at` write.

**Migration version drift, recorded rather than hidden.** The repository file is
`supabase/migrations/20260804120000_sec001_profiles_role_privilege.sql`; the
applied row is `version = 20260804142229`, `name = sec001_profiles_role_privilege`.
The names align and the versions do not, because the MCP apply path stamps its
own timestamp. This matches the existing precedent — repo
`20260804090000_couranr_delivery_access_tokens.sql` is applied as version
`20260804034727` under the same name. Traceability runs through the name.

## 8. Ledger update rules

1. Any material change updates `IMPLEMENTATION_LEDGER.csv` in the **same commit**
   as the change it describes.
2. Where a screen's state moves, `SCREEN_IMPLEMENTATION_LEDGER.csv` updates in
   that same commit.
3. `IMPLEMENTATION_STATUS.md`'s counts **and** its verified SHA update in that
   same commit — and the counts are re-derived by re-running the commands, never
   by editing the SHA string and leaving the numbers.
4. **The package work breakdown is never edited to record status.**
   `couranr_claude_code_package/08_WORK_BREAKDOWN.csv` is delivered authority. It
   says what must be built; it never says what is built.
5. A status may only be raised on evidence that is written down in §7 with the
   command that produced it. `complete_verified` requires the browser
   verification the repository's own working practices demand.

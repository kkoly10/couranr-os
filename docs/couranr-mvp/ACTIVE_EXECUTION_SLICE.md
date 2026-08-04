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
| Base SHA | `c929cc3a8e630bd11ac0a98ff3800a16ee77c140` |
| Active branch | `claude/couranr-phase-8-conversations` |
| Target PR | not yet opened |
| Status | `active` |

The base SHA is the SEC-001 hotfix merge (PR #21). The Phase 8 branch is rebased
onto it, so the conversation work is built on a repository where the admin
predicate is no longer self-grantable.

## 2. Authoritative work items

Quoted verbatim from `couranr_claude_code_package/08_WORK_BREAKDOWN.csv`, which
is the authority for *what must be built* and *the dependency chain*. Status
comes from `docs/couranr-mvp/IMPLEMENTATION_LEDGER.csv`, which is the authority
for *measured implementation state*. The two are never merged, and status is
never written back into the package.

| work item | phase | domain | task (verbatim) | dependencies (verbatim) | priority | acceptance (verbatim) | measured status |
|---|---|---|---|---|---|---|---|
| `P8-001` | 8 | Messaging | Implement server-controlled conversations | `P2-002` | P1 | **Participant/privacy tests pass** | `not_started` |
| `P8-002` | 8 | Support | Implement deadlines and Operations Inbox | `P8-001` | P1 | **Operating/after-hours timers pass** | `not_started` |
| `P8-004` | 8 | Customer | Implement secure Delivery Help | `P8-001;P2-003` | P1 | **One-delivery token scope passes** | `not_started` |
| `P2-003` | 2 | Platform | Implement idempotency, audit, and guest tokens | `P2-001` | P0 | **Duplicate and token tests pass** | `partial` |

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

1. **Security blocker resolution** — SEC-001. *Done: merged as `c929cc3`,
   applied to the live project, 12/12 verification checks PASS.*
2. **`P8-001` conversation foundation** — the schema, the participant model, the
   four visibility values, the named server command every message write goes
   through, and the message-specific idempotency and audit primitives that close
   out `P2-003`'s remaining work.
3. **`P8-002` deadlines and Operations Inbox** — the five deadline fields the
   spec names, the due-state transitions, and the Operations Inbox.
   **Partially blocked — see HRS-002 in §6.**
4. **`P8-004` secure Delivery Help** — `/help/[token]`, scoped to one signed
   token and one delivery.

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

### HRS-002 — the operating-hours timezone is unresolved — **OPEN**

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

### TRM-002 — the five merchant roles have no permission sets — **OPEN**

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
| `P8-001` participant/privacy | not yet built | — | **not verified** | — |
| `P8-002` operating/after-hours timers | not yet built | — | **not verified; after-hours half blocked by HRS-002** | — |
| `P8-004` one-delivery token scope | not yet built | — | **not verified** | — |

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

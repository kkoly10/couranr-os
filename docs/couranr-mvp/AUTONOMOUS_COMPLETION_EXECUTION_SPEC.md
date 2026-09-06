# Couranr Autonomous Completion Executive Specification

**Document type:** execution compiler — not new product authority  
**Target executor:** Fable 5 or another long-horizon repository coding agent  
**Repository:** `kkoly10/couranr-os`  
**Recon date:** 2026-08-06  
**Recon anchor:** Phase 8 branch `8f0725f0f154946c0fbd2056a0021de0ab794601`; production migration ledger through `20260806010000`  
**Intended repository path after review:** `docs/couranr-mvp/AUTONOMOUS_COMPLETION_EXECUTION_SPEC.md`

> **Execution anchor — B00 complete, 2026-08-06.** PR #22 was integrated into
> `main` by squash (the repository's linear-history method, matching #21 and
> #23) as **`f26d857fb797b008fc5772700d65a4e5c181f259`**, whose tree is
> byte-identical to the recon head `8f0725f` (`git diff --stat` empty), so all
> Phase 8 evidence transfers. Verified on the resulting `main`: 39 forward
> migrations + 39 paired rollbacks; production migration ledger 39/39 with
> every version equal to its filename (read via `list_migrations` immediately
> before the merge); every `last_verified_sha` in both ledgers still a
> reachable object (the Phase 8 branch ref is retained, not deleted). Counts
> re-derived at `f26d857`: 99 page routes, 131 API routes, 43 canonical pages
> of which 25 render `ScreenPlaceholder`, 60 canonical API routes — identical
> to §6's recon snapshot. Run state lives in
> [`AUTONOMOUS_RUN_STATE.json`](./AUTONOMOUS_RUN_STATE.json); evidence in
> [`autonomous-evidence/`](./autonomous-evidence/).

---

## 1. Mission

Finish the approved Couranr merchant-delivery MVP **end to end**, not merely its pages.

“Complete” means:

1. every applicable product capability is implemented from database through UI;
2. all 42 authoritative work items are reconciled against executable evidence;
3. all 66 canonical screens are functional, responsive, accessible, and visually faithful to their canonical mock references;
4. all required integrations, security boundaries, idempotency, audit, recovery, legacy cutover, analytics, and launch gates are finished;
5. production is changed only through an owner-approved witnessed protocol;
6. no status is promoted because a file exists, a function compiles, a migration applies, a source scan passes, or a stubbed browser renders.

This document compiles the existing authorities into one autonomous execution contract. It may decompose work, name derived capability IDs, establish test/evidence rules, and sequence delivery. It may **not** replace a product decision, weaken an acceptance criterion, or invent behavior where authority is unresolved.

---

## 2. Activation gate — do not begin implementation until this is true

At recon time:

- `main` is `bf38d156ddcaae70f99c3a0c2d0e82efd0cf26a7`.
- PR #22 remains open and draft.
- PR #22 head is `8f0725f0f154946c0fbd2056a0021de0ab794601`, 51 commits ahead of `main`, 0 behind.
- Production already records all 39 repository migration versions through `20260806010000_couranr_operating_hours`.
- Production contains the Phase 8 schema and operating-hours behavior, while `main` does not yet contain the Phase 8 files.

Therefore the first autonomous action is **not feature work**.

The executor must:

1. confirm PR #22’s final state and head;
2. integrate it into `main` using the repository’s accepted linear-history method;
3. verify the resulting `main` contains 39 forward migrations and 39 paired rollbacks;
4. compare the repository migration versions with production;
5. re-run the status/ledger counts on the resulting `main`;
6. update this document’s anchor and create `docs/couranr-mvp/AUTONOMOUS_RUN_STATE.json`;
7. stop if repository and production do not agree.

No autonomous batch may start from `bf38d15` while treating Phase 8 production state as absent.

---

## 3. Authority order

When sources conflict, use this order:

1. `02_DECISION_REGISTRY.json` at repository root.
2. `Couranr_Claude_Code_Master_Package.md`.
3. `couranr_claude_code_package/01_MASTER_IMPLEMENTATION_SPEC.md`.
4. `couranr_claude_code_package/05_AI_COMMUNICATION_SPEC.md`.
5. `UI_SCREEN_REGISTRY.md`.
6. `docs/couranr-mvp/MARKETING_POSITIONING_AND_HOMEPAGE_BLUEPRINT.md` for MKT-002 surfaces.
7. `docs/couranr-mvp/platform-baseline-v1.1/`.
8. `couranr_claude_code_package/03_REPO_CUTOVER_MATRIX.md`.
9. `couranr_claude_code_package/04_PHASED_EXECUTION_PLAN.md`.
10. `couranr_claude_code_package/06_RELEASE_ACCEPTANCE_MATRIX.md`.
11. `couranr_claude_code_package/08_WORK_BREAKDOWN.csv`.
12. Current-state ledgers:
    - `docs/couranr-mvp/IMPLEMENTATION_STATUS.md`
    - `docs/couranr-mvp/IMPLEMENTATION_LEDGER.csv`
    - `docs/couranr-mvp/SCREEN_IMPLEMENTATION_LEDGER.csv`
13. Current code and production catalogs as shipped-state evidence only.
14. Legacy behavior last.

**Conflict rule:** written specifications control behavior, security, permissions, pricing, copy, states, and claims. Canonical images control layout, hierarchy, visual language, and responsive intent. Current code is never product authority when it conflicts with a higher source.

---

## 4. Non-negotiable execution rules

### 4.1 No invention

The executor must not invent:

- pricing, taxes, rounding conditions, fees, service boundaries, guarantees, hours, holidays, roles, state transitions, refund rules, proof rules, overnight enablement, AI permissions, feature-flag semantics, or public claims;
- a second pricing engine, tenant model, status model, payment model, token library, component library, state library, form library, table library, chart library, or AI provider layer;
- arbitrary target-state APIs;
- client-side authorization;
- fake metrics, sample production claims, or visual placeholders presented as live data.

An unresolved decision blocks only its dependent path. The executor records it in the decision queue, implements unaffected work, and continues.

### 4.2 No false completion

A capability is not complete because:

- a route exists;
- a page no longer renders `ScreenPlaceholder`;
- TypeScript compiles;
- SQL parses;
- a migration applies;
- a static source assertion finds expected text;
- a mocked function was called;
- a browser API response was stubbed;
- one happy-path screenshot looks correct.

A capability is complete only when its enforcement points execute against real disposable infrastructure, its browser path is unstubbed where applicable, and the expected database/API/external evidence is observed.

### 4.3 Production safety

The executor may autonomously:

- inspect production read-only;
- create local/disposable databases;
- write migrations and paired rollbacks;
- run clean/upgrade replays;
- open draft PRs;
- prepare production runbooks and dry-run commands.

The executor may not autonomously:

- apply a production migration;
- repair a production ledger;
- make a real Stripe charge/refund;
- rotate secrets;
- delete or rewrite production data;
- make a storage bucket public;
- merge a branch that changes production behavior;
- run the production canary.

Each requires explicit owner approval for that exact operation.

### 4.4 Security and privacy

- No secret may be printed, committed, copied into logs, screenshots, fixtures, or prompt context.
- `service_role` stays server-only and centralized.
- Feature flags never substitute for authorization.
- RLS and table/function grants are both verified, including privileges inherited through `PUBLIC`.
- Internal notes and AI drafts remain excluded from initial reads, realtime, exports, notifications, analytics, and customer/merchant/driver projections.
- Anonymous and token surfaces receive strict allowlist projections and indistinguishable safe refusals where required.
- Analytics excludes message bodies, full addresses, gate codes, phone numbers, proof URLs, raw tokens, and card data.

### 4.5 Status tracking

Any material status change must update in the same commit:

- `IMPLEMENTATION_LEDGER.csv`;
- `SCREEN_IMPLEMENTATION_LEDGER.csv`;
- `IMPLEMENTATION_STATUS.md`;
- the batch run state and evidence index.

Any newly discovered untracked product gap must receive an `ACP-GAP-###` row before work continues.

---

## 5. Mandatory self-verification loop

For every coherent deliverable:

1. Read the actual authority again.
2. Inspect current code, database objects, callers, and sibling paths before editing.
3. Enumerate every enforcement point and dual path.
4. Implement the smallest coherent vertical capability.
5. Add a regression that fails with the change removed or broken.
6. Run unit/component tests.
7. Replay migrations from empty and against the previous schema.
8. Exercise SQL functions/commands with real fixture rows.
9. Exercise API routes without stubbing the Couranr happy path.
10. Exercise browser behavior and assert the corresponding row, refusal, object, Stripe event, or audit event.
11. Run visual and accessibility checks for affected screens.
12. Conduct a separate adversarial review of the actual diff.
13. Re-run the full batch gate.
14. Update ledgers and evidence at the final SHA.
15. Open/update one substantial draft PR with exact evidence and unresolved items.

If a verification tool cannot run, the row remains unverified. The executor must not replace a missing real check with a source scan and promote the result.

---

## 6. Measured starting state

These values are a recon snapshot, not a permanent truth. B00 must regenerate them.

### Repository / branch

| Measure | Recon result |
|---|---:|
| `main` | `bf38d156ddcaae70f99c3a0c2d0e82efd0cf26a7` |
| Phase 8 head | `8f0725f0f154946c0fbd2056a0021de0ab794601` |
| Phase 8 vs main | 51 ahead / 0 behind |
| PR #22 | open, draft, mergeable |
| Work items complete_verified on Phase 8 branch | 12 / 42 |
| Canonical screens functional_verified | 15 / 66 |
| Canonical page routes rendering `ScreenPlaceholder` | 25 / 43 |
| Screen rows placeholder_only | 33 |
| Screen rows missing | 5 |
| Unit suite reported by Phase 8 branch | 1,285 tests / 41 files |
| Current runtime | Next 14.2.5 / React 18.3.1 |
| Platform target | Next 16.x / React 19.2 / Node 24 LTS / npm 11 |

### Connected production database

| Measure | Recon result |
|---|---:|
| Migration ledger rows | 39 |
| Last repository migration | `20260806010000_couranr_operating_hours` |
| Public tables / views | 60 / 6 |
| `couranr_*` tables / functions | 24 / 83 |
| Public tables with RLS disabled | 0 |
| Storage buckets / public buckets | 7 / 1 |
| Remaining public bucket | `vehicle-images` |
| Legacy `orders` / `deliveries` / `addresses` | 42 / 29 / 94 |
| Canonical `couranr_deliveries` | 26 |
| Operating-hours functions | 5 |

### Highest-risk known gaps

- Phase 8 exists in production but is not on `main` at recon time.
- 56 legacy page routes and 26 legacy auto/docs API routes remain live.
- Canonical and legacy pricing engines remain simultaneously reachable.
- No private or analytics schema exists in the measured implementation ledger.
- No general-purpose idempotency substrate exists.
- Presets/categories, Smart Intake, immutable quote versions, balanced ledger/refunds, exceptions/returns/incidents, AI, analytics, cutover, release acceptance, and canary remain incomplete.
- Merchant-support and delivery-chat readers exist, but no real issuer creates those threads.
- Driver assignment replacement/unassignment does not write conversation participant tenure.
- `issueTrackingLink` has no real caller.
- Offline proof sync does not exist.
- `vehicle-images` remains public.
- Real Stripe prelaunch verification remains external.

---

## 7. Owner-decision queue and safe behavior

The executor must never quietly resolve these by analogy.

| Decision | Topic | Unresolved authority | Safe autonomous behavior |
|---|---|---|---|
| `SVC-002` | Service-area boundary | Precise geographic boundaries for named markets and “surrounding areas” are undefined. | Do not invent a radius, polygon, or ZIP list. Publicly name the approved markets; capture outlying requests for review. Block automatic eligibility decisions that require a boundary. |
| `PRC-004` | Rounding condition | The rule says nearest $0.25 only when the accepted policy requires it, but the triggering condition is undefined. | Keep exact cents and line items. Do not newly apply rounding. Require an owner decision before changing live totals. |
| `TAX-001` | Tax treatment | No authority defines whether/how delivery charges are taxed. | Do not add a tax line or claim tax exemption. Keep a tax-policy hook and mark real-money launch dependent on owner/legal/accounting decision. |
| `OVN-002` | Overnight enablement mechanism | The overnight window and surcharge are decided, but request/enable/confirm mechanics are not. | Keep overnight disabled by default. Allow interest/request capture for Operations review only; do not auto-confirm or charge the surcharge until decided. |
| `FLG-002` | Feature-flag storage/scope/audit | Required switches are named, but persistence, scope, precedence, and audit semantics are undefined. | Do not create an ad hoc client flag or use flags as authorization. Prepare alternatives and wait for an owner decision before the shared flag registry. |
| `HOL-001` | Holiday and closure calendar | The spec references observed holidays/closures but provides no calendar or source. | Implement manual closure records only after their authority is decided; otherwise next-operating-period logic uses Mon–Fri hours and explicitly excludes automatic holiday assumptions. |
| `MED-001` | Proof download/share | CUS-006 permits download/share only “when policy permits”; no policy does. | Keep view-only signed access. Do not add download/share affordances until decided. |
| `AI-PROVIDER` | AI provider binding | The specification defines surfaces and safety but not a final provider/adapter binding. | Build a provider-neutral, server-only adapter and disabled/manual fallback. Do not add multiple SDKs or enable production auto-send without explicit selection and keys. |
| `OBS-PROVIDER` | External observability provider | No provider is selected. | Build internal structured events/alerts first. Do not install multiple tracing vendors or export sensitive data without an owner decision. |

A decision is closed only when the root `02_DECISION_REGISTRY.json` records it with acceptance criteria and provenance, and all duplicated authority remains consistent.

---

## 8. Autonomous batch sequence

The sequence prioritizes visible launch value immediately after the platform floor, while preserving money/security/custody dependencies. Do not start AI or analytics to avoid completing a merchant, Operations, driver, payment, proof, exception, or public-launch dependency.


| Batch | Name | Scope | Exit gate |
|---|---|---|---|
| `B00` | **Activation and truth reconciliation** | Merge/reconcile the completed Phase 8 branch, regenerate current-state evidence on the resulting main SHA, and establish the autonomous run state. | PR #22 is merged or otherwise integrated; main, ledgers, production migration ledger, and the execution spec agree; no untracked working tree. |
| `B01` | **Platform and verification foundation** | Move the canonical product onto the approved launch platform baseline: Node/npm pins, Next/React migration, Supabase SSR, generated database types, strict canonical TypeScript, canonical component system, local database tests, and non-vacuous CI commands. | Clean-clone install/build passes; auth refresh/redirect tests pass; disposable database reset and security tests run; visual harness is operational. |
| `B02` | **Public launch surface** | Build and visually match the canonical homepage, pricing, businesses, service areas, how-it-works, estimate, and hosted-request experiences with approved copy and real conversion paths. | PUB-001, PUB-004, PUB-008–PUB-011 are functional and visually verified on desktop/mobile; prohibited claims scan passes; SEO and conversion events are real. |
| `B03` | **Merchant pilot workspace** | Complete the merchant dashboard, activation, delivery list, customers, settings, team, website tools, billing records, and visually reconcile existing merchant screens. | A merchant can enter the workspace, activate, manage people/customers/settings, find deliveries, and reach every permitted action without placeholders. |
| `B04` | **Categories, presets, Smart Intake, and immutable quotes** | Build versioned category/preset data, Smart Intake with manual fallback, immutable quote versions, requote comparison, and the complete create/review flow. | P4-002, P5-001, and P6-001 pass executable acceptance; MER-005/006/010/011 and CUS-005 are complete. |
| `B05` | **Payments, ledger, refunds, and real Stripe closure** | Close general idempotency, payer flows, real Stripe verification, balanced ledger, adjustments, promotional credits, delivery-service refunds, and billing/Operations payment surfaces. | Real test-mode Stripe authorization/capture/webhook/refund scenarios pass; every captured/refund transaction balances and reconciles. |
| `B06` | **Operations command center** | Complete the Operations dashboard, queue/list, review/requote, merchant and vehicle management, settings, availability, policy registry, audit log, and payment/refund workspaces. | All Core Operations screens required before canary are functional, role-verified, visually matched, and use real data only. |
| `B07` | **Driver completion and offline recovery** | Complete driver discrepancy, Driving Mode suppression, availability, vehicle profile/compliance, offline proof queue/sync, and visual parity across the field workflow. | A driver can go online, use a verified vehicle, complete an assigned delivery online/offline, recover proof safely, and lose access when assignment tenure ends. |
| `B08` | **Exceptions, returns, incidents, and customer resolution** | Implement wait, not-ready, recipient-unavailable, address-change review, cancellation stages, failed attempt, return custody, weather/closure behavior, incidents/evidence, and customer status surfaces. | P7-005 passes executable E2E; CUS-002/004/007, OPS-012, return states, charges, and evidence rules are complete. |
| `B09` | **Messaging reachability and notifications** | Create real merchant-support and delivery-chat issuance paths, participant tenure writers, tracking-link issuance, attachments, receipts/fallback email, templates, and missing Delivery Help states. | MER-012 and DRV-008 receive real production-reachable data; replacement/unassignment closes access; every link has an issuer; privacy/realtime/export tests pass. |
| `B10` | **AI broker, Assistant, Ghost, and Ask Couranr** | Build the audited AI data broker, allowlisted tools, Smart Intake adapter, merchant/recipient assistants, Ghost drafts/coaching, verifier, kill switches, public Ask Couranr, consented leads, and safe rollout controls. | No direct SQL or action tools; tenant/surface isolation passes; manual operation survives provider outage; auto-send remains disabled until its explicit gate passes. |
| `B11` | **Analytics, observability, and operational alerts** | Build privacy-safe event collection, attribution, economics, support/proof/driver metrics, unmet demand, alert rules, dashboards, and accessible exports. | P10-001/002 pass reconciliation and no-PII tests; OPS-013/014 show only measured data; alerts are actionable and deduplicated. |
| `B12` | **Legacy cutover, recovery, and release acceptance** | Quarantine legacy auto/docs/mixed-courier runtime, remove dual pricing/write paths, verify backups/restores, execute the complete release matrix, and prepare the controlled production canary. | No active legacy mutation or dual write; zero P0 and zero core P1; recovery rehearsal passes; canary runbook is approved. |
| `B13` | **Controlled production canary and completion** | Execute one owner-approved real low-value delivery across merchant, payer, Operations, driver, proof, tracking, messaging, support, ledger, AI-disabled/manual fallback, and analytics. | Stripe, ledger, proof, messages, analytics, storage, and database reconcile; all 42 work items and all applicable 66 screens meet their final status. |

### Batch PR policy

- One substantial PR per batch by default.
- A batch may use several ordered commits, each internally coherent.
- Split only when a P0 hotfix or independently mergeable infrastructure change would make review safer.
- Do not create dozens of tiny PRs.
- Do not put the entire remaining product into one uncontrolled PR.
- Every batch PR remains draft until its final-head gates pass and ledgers are current.
- A batch may continue autonomously after a green local/CI gate, but merge and production changes remain owner-gated unless the owner supplies an explicit pre-authorized merge policy.

---

## 9. Remaining capability graph

Derived `ACP-*` IDs are execution handles. They do not replace `P*` work-item authority.


| ID | Batch | Capability | Parent authority | Dependencies | Screens/surface | Required implementation | Completion gate |
|---|---|---|---|---|---|---|---|
| `ACP-001` | `B00` | **Execution truth anchor** | P0-002/P12-001 | none | all | Re-measure main, PR state, production migrations, ledgers, screen registry, package versions and open findings; write AUTONOMOUS_RUN_STATE.json. | main and production agree; status counts are command-derived |
| `ACP-002` | `B00` | **Gap intake protocol** | all | ACP-001 | all | Any discovered requirement with no work-item row becomes ACP-GAP-### before implementation continues. | no discovered gap can remain only in prose |
| `ACP-003` | `B01` | **Runtime and package baseline** | platform baseline | ACP-001 | all | Pin Node 24/npm, migrate Next 14→15→16 and React 18→19 in reviewable commits, lock npm v3, reject force/legacy-peer-deps. | clean npm ci, lint, typecheck, tests, build, hydration smoke |
| `ACP-004` | `B01` | **Supabase SSR and typed clients** | P2-002/platform | ACP-003 | PUB-002,PUB-003; authenticated screens | Replace auth helpers with @supabase/ssr, consolidate privileged client boundaries, generate database types, verify cookies/refresh/redirects. | browser/server/route auth and role tests |
| `ACP-005` | `B01` | **Canonical strict TypeScript** | platform | ACP-003,ACP-004 | all canonical | Create strict canonical config and migrate security/money boundaries first; no new any/ts-ignore. | strict typecheck can fail and passes |
| `ACP-006` | `B01` | **Canonical design system** | UI registry | ACP-003 | all | Install/adopt one accessible primitive system, canonical tokens, logo, shells, form/table/chart/upload/status primitives. | a11y smoke and visual primitive baselines |
| `ACP-007` | `B01` | **Disposable DB, pgTAP, and executable gates** | P2-001/P12-001 | ACP-003,ACP-004 | all | Create db:reset/db:test/check:rls/check:migrations/check:routes/check:legacy-imports and ensure each has a failing positive control. | clean replay, upgrade replay, RLS/grant tests |
| `ACP-008` | `B01` | **Private and analytics schemas** | P2-001 | ACP-007 | OPS-013,OPS-020 | Create explicit private and analytics boundaries with grants, RLS, retention, and no client access. | schema/grant/tenant tests |
| `ACP-009` | `B02` | **Canonical public shell and SEO** | P10-003/P10-007 | ACP-006 | PUB-001,PUB-008–PUB-011 | Shared header/footer, responsive typography, metadata, sitemap, structured data where truthful, accessible navigation. | desktop/mobile visual and keyboard tests |
| `ACP-010` | `B02` | **Marketing homepage** | P10-003 | ACP-009 | PUB-001 | Replace legacy mixed-product homepage with MKT-002's twelve sections and verbatim approved hero/CTA copy. | section order, copy, link, claim, visual tests |
| `ACP-011` | `B02` | **Pricing page** | P10-005 | ACP-009 | PUB-008 | Render locked delivery pricing, manual-quote rules, pilot economics, disclaimers; never product price or subscription. | decision-registry parity and visual tests |
| `ACP-012` | `B02` | **Businesses and use cases** | P10-004 | ACP-009 | PUB-009 | Supported categories, merchant-controlled channels, general-business fallback; no medical/prohibited expansion. | category/copy/visual tests |
| `ACP-013` | `B02` | **Service areas** | P10-005 | ACP-009 | PUB-010 | Named markets and review-based surrounding/extended requests; no rigid ZIP rejection and no Maryland launch claim. | copy/route/visual tests; SVC-002 remains gated |
| `ACP-014` | `B02` | **How it works** | P10-004 | ACP-009 | PUB-011 | Merchant-paid and customer-paid sequences, confirmation-before-capture, tracking/proof/support. | workflow/copy/visual tests |
| `ACP-015` | `B02` | **Estimate and hosted request** | P5-001/P5-002/P6-001 | ACP-009,ACP-036 | PUB-004 | Anonymous estimate and merchant-branded request; merchant validates merchandise before payment. | token/tenant/rate-limit/E2E tests |
| `ACP-016` | `B02` | **Public claim boundary and conversion telemetry** | P10-006/P10-001 | ACP-010–ACP-015 | public | Static prohibited-claim scan plus consented attribution events; no fake proof or PII. | mutation-tested copy scanner and event assertions |
| `ACP-017` | `B03` | **Merchant dashboard** | P4-001/P7-002 | ACP-006 | MER-001 | Real today/attention/readiness/payment/message data, activation state, quick actions, no fabricated metrics. | new/empty/active/degraded/denied browser states |
| `ACP-018` | `B03` | **Live activation checklist** | P4-001 | ACP-017 | MER-003 | Terms/policy/responsibility/contact/test-delivery/review workflow; no Stripe or website requirement. | state transition and Operations-review tests |
| `ACP-019` | `B03` | **Merchant delivery list** | P5-002/P7-002 | ACP-017 | MER-004 | Independent request/payment/readiness/review/fulfillment facets, filters, search, mark-ready and allowed cancel. | tenant, pagination, state-combination tests |
| `ACP-020` | `B03` | **Customer/address book** | P4-002 | ACP-004 | MER-008,MER-009 | Merchant-scoped recipients, destinations, instructions, history, archive, duplicate detection, repeat delivery. | PII projection, tenant and browser tests |
| `ACP-021` | `B03` | **Merchant settings and team** | P4-001/P2-002 | ACP-004,ACP-017 | MER-014,MER-015 | Business/defaults/notifications/security plus invite, role, disable/remove, last-owner protection. | owner/manager/dispatcher/billing/viewer boundaries |
| `ACP-022` | `B03` | **Website tools and branding** | P10-001 | ACP-015,ACP-017 | MER-013 | Hosted link, QR, embed/button, branding, preview and defaults without merchandise checkout. | signed config, sanitization, preview and visual tests |
| `ACP-023` | `B03` | **Merchant billing records** | P6-002/P6-004 | ACP-017,ACP-041 | MER-016 | Payment methods, delivery receipts, credits/refunds and support; no subscription invoice. | PCI-safe projection and role tests |
| `ACP-024` | `B04` | **Category registry** | P4-002 | ACP-008 | MER-002,MER-010 | One primary/up to three secondary, general fallback, versioning and recommendation-only semantics. | constraint, migration and browser tests |
| `ACP-025` | `B04` | **Versioned presets** | P4-002 | ACP-024 | MER-010,MER-011 | Global/custom/merchant presets, immutable snapshots, conflict handling, no invented exact facts. | history/tenant/concurrency/E2E tests |
| `ACP-026` | `B04` | **Smart Intake core** | P5-001 | ACP-025,ACP-005 | MER-005 | Text/paste/preset/manual inputs, structured draft, source/evidence/confidence, one clarification, manual fallback. | schema, prompt-injection, outage and browser tests |
| `ACP-027` | `B04` | **Immutable quote versions** | P6-001 | ACP-026,ACP-035 | MER-006,CUS-005,OPS-004 | Versioned lines/inputs/policy/acceptance/replacement; accepted quote never mutates. | DB immutability, compare/requote, concurrency E2E |
| `ACP-028` | `B04` | **Create/review flow completion** | P5-002/P6-001 | ACP-026,ACP-027 | MER-005,MER-006 | Connect intake→request version→quote→payer→review without dual write. | full browser+row path and visual states |
| `ACP-029` | `B05` | **General idempotency substrate** | P2-003 | ACP-008 | money/state commands | Purpose/actor/key/request hash/result reference, in-progress/completed/expired semantics and audit. | concurrent duplicate, mismatch and replay tests |
| `ACP-030` | `B05` | **Policy registry store** | P3-001 | ACP-008 | OPS-017 | Versioned market/hours/pricing/cancellation/return/safety rules, effective dates, validation and approvals. | single-source parity and version tests |
| `ACP-031` | `B05` | **Canonical pricing closure** | P3-002 | ACP-030 | PUB-004,PUB-008,MER-006,OPS-003 | Retire/disable legacy pricing engine, enforce canonical cents/tier/manual-review logic. | all price vectors and no second reachable engine |
| `ACP-032` | `B05` | **Real Stripe payer flows** | P6-002/P6-003 | ACP-027,ACP-029 | PUB-005,MER-006,OPS-010 | Test-mode merchant/customer authorization, 3DS, manual capture, release, replacement and webhook reconciliation. | real Stripe IDs, signatures, duplicate/out-of-order tests |
| `ACP-033` | `B05` | **Balanced ledger and reconciliation** | P6-004 | ACP-032 | OPS-009,MER-016 | Append-only double-entry accounts/transactions, clearing, revenue, tips, expenses, credits, disputes and reconciliation. | every transaction balances; Stripe daily reconcile |
| `ACP-034` | `B05` | **Refunds and promotional credit** | P6-004/P7-005 | ACP-033 | OPS-004,OPS-011,CUS-007 | Delivery-service refund only, evidence/policy/approval, partial/full, immutable standard quote and separate credit. | Stripe+ledger+UI E2E and role tests |
| `ACP-035` | `B05` | **Resolve pricing/tax decision gates** | PRC-004/TAX-001 | owner decision | pricing/payment | Do not invent rounding condition or tax treatment; prepare alternatives and block only affected live calculations. | owner decision recorded in root registry |
| `ACP-036` | `B06` | **Operations dashboard and queue completion** | P7-002/P10-002 | ACP-017,ACP-027 | OPS-001,OPS-002 | Live health, pending review, support/payment/proof risk and complete queue/list with real actions. | browser+DB command assertions and visual parity |
| `ACP-037` | `B06` | **Delivery review/requote polish** | P7-002/P6-001 | ACP-027,ACP-036 | OPS-003,OPS-004 | Complete every allowed action, missing info, compatibility, schedule, decline, requote and credit state. | named-command E2E; no arbitrary target state |
| `ACP-038` | `B06` | **Merchant and vehicle management** | P7-001/P7-002 | ACP-036 | OPS-007,OPS-008 | Tenant health/activation/support and vehicle capabilities/compliance/availability management. | Operations-only mutations and browser verification |
| `ACP-039` | `B06` | **Operations settings, availability, policy, audit** | P3-001/P8-002/P9-003 | ACP-030,ACP-036 | OPS-015–OPS-017,OPS-020 | Audited high-privilege settings, closures/modes, policy history and append-only audit. | version conflict, role, redaction and visual tests |
| `ACP-040` | `B07` | **Driver availability and vehicle profile** | P7-001/P7-003 | ACP-038 | DRV-001,DRV-009,DRV-010 | Online/busy/offline/compliance, active vehicle, capability/evidence/expiry with no marketplace. | assignment eligibility and mobile visual tests |
| `ACP-041` | `B07` | **Driving Mode safety suppression** | P8-003 | ACP-040 | DRV-005,DRV-008 | Silent routine alerts during travel, blocking/safety visibility, typing discouragement, safe-stop digest. | notification/suppression/browser tests |
| `ACP-042` | `B07` | **Package discrepancy completion** | P7-005 | ACP-037,ACP-040 | DRV-004 | Evidence, reason, pause, Operations decision, requote/continue/cancel; driver cannot decide money/safety. | state/role/proof E2E |
| `ACP-043` | `B07` | **Offline proof queue and sync** | P7-004 | ACP-007,ACP-040 | DRV-003,DRV-006,DRV-007 | IDB queue without secrets, immutable evidence envelope, retries, dedupe, verification, terminal Operations alert. | offline/reload/duplicate/corrupt/recovery E2E |
| `ACP-044` | `B08` | **Exception state and command model** | P7-005 | ACP-034,ACP-043 | MER-007,DRV-002,DRV-006 | Wait/not-ready/failed attempt/cancel/address change/recipient unavailable/return/weather named commands and audit. | valid/invalid transition matrix |
| `ACP-045` | `B08` | **Returns and custody** | P7-005/P6-004 | ACP-044 | CUS-002,CUS-003,CUS-007,PUB-006 | Return-required→returning→returned, handoff proof, 70%/$14.99 charge policy, delivery refund status. | custody+charge+proof+tracking E2E |
| `ACP-046` | `B08` | **Incidents and evidence** | P7-005 | ACP-044 | CUS-004,OPS-012,MER-007 | Damage/missing/wrong/unsafe/delivery failure, evidence requests, internal notes, resolution without product-refund promise. | privacy/storage/state/browser E2E |
| `ACP-047` | `B08` | **Customer access instruction editing** | CUS-008 requirement | ACP-044 | CUS-008,PUB-006 | Token-scoped allowed edits and handoff choice before pickup, hard lock after pickup, unsafe option refusal. | cross-delivery/token/concurrency E2E |
| `ACP-048` | `B08` | **Closures, holidays, overnight enablement** | HRS-001/OVN-002/FLG-002 | owner decision,ACP-039 | PUB-004,OPS-016 | Implement closures and audited overnight enablement only after mechanism/scope decisions; default overnight disabled. | DST/closure/permission/audit tests |
| `ACP-049` | `B09` | **Conversation issuance** | P8-001 gap | ACP-044 | MER-012,DRV-008,OPS-005 | Create merchant_support intentionally and delivery_chat after confirmation; add merchant, assigned driver and Operations participants. | real event→thread→participant→browser path |
| `ACP-050` | `B09` | **Participant tenure writers** | P8-001 gap | ACP-049 | DRV-008,MER-012 | Assignment/replacement/unassignment/completion write joined_at/left_at; no prior-history inheritance. | replacement/unassignment concurrent E2E |
| `ACP-051` | `B09` | **Tracking-link issuance** | PUB-006 gap | ACP-032 | PUB-006 | Real Operations/notification caller for issueTrackingLink, revocation/reissue and delivery receipt linkage. | customer receives and redeems one-delivery link |
| `ACP-052` | `B09` | **Attachments, notifications, receipts, templates** | P8-001/P8-002 | ACP-049 | PUB-007,MER-012,DRV-008,OPS-018 | Private attachments, audience/versioned templates, receipts and nonurgent fallback email; internal/draft exclusion. | storage/privacy/template-variable/send E2E |
| `ACP-053` | `B09` | **Delivery Help missing states** | P8-004 | ACP-045,ACP-046,ACP-052 | PUB-007,CUS-001,CUS-003 | Waiting on customer/Couranr, resolved, after-hours indicator, urgent safety escalation and evidence. | browser+row+privacy tests |
| `ACP-054` | `B10` | **AI data broker and audit** | P9-001 | ACP-008,ACP-029,ACP-049 | AI surfaces | Purpose/actor/tenant/delivery/conversation/data-class/record-cap/expiry envelopes; allowlisted read/preparation tools only. | no direct SQL, tenant/surface isolation, audit completeness |
| `ACP-055` | `B10` | **Merchant and Delivery Help assistants** | P9-002/P9-003 | ACP-054,ACP-052 | MER-012,PUB-007 | Verified facts/policy drafts, clarification/human/safety routing, no action claims or prohibited decisions. | golden cases, verifier and private-data tests |
| `ACP-056` | `B10` | **Ghost Operations** | P9-002 | ACP-054 | OPS-006 | Attention queue, facts/blocker/risk/draft/recommended action/policy/evidence/confidence; preparation only. | tool scope, generalized-case and browser tests |
| `ACP-057` | `B10` | **Verifier, rollout, and kill switches** | P9-003 | ACP-054,ACP-055 | OPS-019 | Draft/shadow/safe-test/canary/allowlist, ≥95% plus deterministic gates, provider/category/merchant/thread/global pauses. | mutation-tested fail-closed and outage tests |
| `ACP-058` | `B10` | **Ask Couranr and lead inbox** | P9-004 | ACP-054,ACP-015 | OPS-021; public assistant | Public knowledge, deterministic nonbinding estimate, consent, source/UTM, no private lookup. | prompt injection, privacy, consent and attribution E2E |
| `ACP-059` | `B11` | **Analytics event model** | P10-001 | ACP-008,ACP-033,ACP-044,ACP-049 | OPS-013,OPS-014 | Privacy-safe market/source/funnel/economics/support/proof/driver/unmet-demand events with reconciliation. | no-PII schema and source-of-truth totals |
| `ACP-060` | `B11` | **Operations analytics and accessible exports** | P10-001 | ACP-059 | OPS-013,OPS-014 | Real filters/charts/tables/summaries/exports; partial/empty/live states; no fake data. | chart/table parity and aggregate reconciliation |
| `ACP-061` | `B11` | **Actionable alerting** | P10-002 | ACP-059 | OPS-001,OPS-013 | Payment/webhook/ledger/proof/support/security/stuck-state alerts with dedupe, severity, owner, resolution. | fault injection and alert lifecycle tests |
| `ACP-062` | `B12` | **Legacy runtime quarantine** | P1-003/P3-002/P11-001 | ACP-031,ACP-061 | legacy | Disable/410 auto/docs mutations, remove legacy nav/imports, redirect approved routes, eliminate old pricing/webhook/write paths. | route/import/no-dual-write manifest tests |
| `ACP-063` | `B12` | **Backup, restore, storage and Stripe recovery** | P12-001 | ACP-062 | all | Verified database backup/restore, storage reconciliation, webhook replay, request/AI pauses and rollback rehearsal. | recovery evidence and timed rehearsal |
| `ACP-064` | `B12` | **Full release acceptance** | P12-001 | ACP-001–ACP-063 | all 66 | Execute every P0/P1 group and 15 E2E scenarios with SHA/environment/identity/rows/IDs/screenshots. | zero P0, zero core P1, all evidence indexed |
| `ACP-065` | `B13` | **Controlled production canary** | P12-002 | ACP-064,owner approval | all core | One real low-value production delivery from merchant request through reconciliation; no expansion until results reviewed. | all systems reconcile, no residue or unauthorized exposure |
| `ACP-066` | `B13` | **Completion certification** | all | ACP-065 | all | Reconcile 42 work items, 66 screens, migrations, routes, storage, Stripe, analytics, decisions, and known gaps at final main SHA. | no placeholders/missing applicable screens; status docs exact |

---

## 10. All-screen completion matrix

Every screen appears exactly once. “Current” is the Phase 8 branch’s measured classification at recon time. The target is functional behavior plus required states, accessibility, responsive behavior, and visual parity—not merely removal of a placeholder.


| Screen | Name | Current | Target batch | Completion focus |
|---|---|---|---|---|
| `PUB-001` | Marketing homepage | `static_only` | `B02` | Replace legacy mixed-product page; twelve approved sections; desktop/mobile mock parity. |
| `PUB-002` | Sign in | `functional_verified` | `B01` | Migrate to Supabase SSR and visually reconcile; preserve verified auth/error states. |
| `PUB-003` | Business sign up | `functional_verified` | `B01/B03` | SSR migration, light signup, exact activation separation, visual parity. |
| `PUB-004` | Estimate and hosted request | `placeholder_only` | `B02/B04` | Anonymous estimate + merchant-branded request; merchant validation before payment. |
| `PUB-005` | Secure delivery payment | `functional_verified` | `B05` | Immutable quote, real Stripe, requote/expiry states, visual parity. |
| `PUB-006` | Secure live tracking | `partial` | `B08/B09` | Return stage, editable access, Delivery Help link, real tracking-link issuer. |
| `PUB-007` | Delivery Help | `functional_verified` | `B09` | Add remaining states, attachments, after-hours indicator, safety escalation; keep token isolation. |
| `PUB-008` | Pricing | `placeholder_only` | `B02` | Canonical pricing, manual-quote rules, no monthly fee/commission. |
| `PUB-009` | Businesses | `placeholder_only` | `B02` | Categories, channels, use cases, general-business fallback. |
| `PUB-010` | Service areas | `placeholder_only` | `B02` | Named markets, surrounding review, no Maryland marketing, no rigid ZIP rejection. |
| `PUB-011` | How Couranr works | `placeholder_only` | `B02` | Both payer flows, confirmation before capture, tracking/proof/support. |
| `MER-001` | Merchant dashboard | `placeholder_only` | `B03` | Real work/attention/readiness/payment/messages; no fake metrics. |
| `MER-002` | Merchant onboarding | `functional_verified` | `B03/B04` | Add category/payer/test workspace details and visual parity without heavy signup. |
| `MER-003` | Live activation checklist | `missing` | `B03` | Build post-dashboard activation state machine and Operations review. |
| `MER-004` | Deliveries list | `placeholder_only` | `B03` | Independent state groups, filters/search, permitted actions. |
| `MER-005` | Create delivery with Smart Intake | `partial` | `B04` | Replace manual-only title mismatch with real extraction/confidence/fallback. |
| `MER-006` | Delivery review and quote | `functional_unverified` | `B04/B05` | Immutable quote, payer selection, link/authorization, executable browser proof. |
| `MER-007` | Delivery detail | `functional_verified` | `B06/B08/B09` | Add return/incident/payment failure/conversation states and visual reconciliation. |
| `MER-008` | Customers list | `placeholder_only` | `B03` | Merchant-scoped recipients, destinations, history, repeat action. |
| `MER-009` | Customer detail | `placeholder_only` | `B03` | Addresses/instructions/history/payer preference and repeat delivery. |
| `MER-010` | Presets list | `placeholder_only` | `B04` | Global/custom/merchant presets, version/update/archive states. |
| `MER-011` | Preset builder | `placeholder_only` | `B04` | Versioned assumptions/questions/capabilities; no silent exact facts. |
| `MER-012` | Messages and support | `partial` | `B09/B10` | Real issuance, attachments, AI/human states, after-hours, role/privacy. |
| `MER-013` | Website tools | `placeholder_only` | `B03` | Link/QR/embed/branding/defaults; no product checkout. |
| `MER-014` | Merchant settings | `placeholder_only` | `B03` | Business/defaults/categories/notifications/security; no subscriptions. |
| `MER-015` | Team and permissions | `placeholder_only` | `B03` | Invites/roles/disable/remove/last-owner; least privilege. |
| `MER-016` | Billing settings | `placeholder_only` | `B05` | Methods, delivery receipts/charges/credits/refunds; no subscription invoices. |
| `DRV-001` | Driver dashboard | `functional_verified` | `B07` | Availability/vehicle/messages/compliance integration and mobile visual parity. |
| `DRV-002` | Assigned delivery detail | `functional_verified` | `B07/B08/B09` | Return/issue/chat states; maintain sanitized assignment projection. |
| `DRV-003` | Pickup PIN and proof | `functional_verified` | `B07` | Offline saved state, large-shipment requirements, visual parity. |
| `DRV-004` | Package discrepancy | `functional_unverified` | `B07` | Executable browser path, evidence and Operations outcome states. |
| `DRV-005` | Driving Mode | `functional_unverified` | `B07` | Real alert suppression, offline/rerouting/safety/arrived states. |
| `DRV-006` | Drop-off proof | `functional_verified` | `B07/B08` | Failed attempt/return/offline pending and visual parity. |
| `DRV-007` | Offline proof sync | `functional_unverified` | `B07` | Built and production-cut-over: encrypted IDB queue, retry/reconcile/terminal alert and no finalization before server verification. Remaining: real-browser offline/reload/duplicate/corrupt recovery evidence. |
| `DRV-008` | Driver messages | `partial` | `B09/B10` | Delivery-chat issuance, tenure writers, driving suppression, AI draft/human states. |
| `DRV-009` | Driver availability | `placeholder_only` | `B07` | Online/busy/offline/compliance and active vehicle. |
| `DRV-010` | Vehicle profile | `placeholder_only` | `B07` | Capabilities/equipment/evidence/compliance/availability. |
| `OPS-001` | Operations dashboard | `placeholder_only` | `B06/B11` | Live delivery/review/SLA/payment/proof/AI health and quick actions. |
| `OPS-002` | Queue and managed dispatch | `partial` | `B06` | Complete both declared routes, full queue fields/actions and visual parity. |
| `OPS-003` | Delivery review workspace | `functional_verified` | `B06/B08` | Complete exception/return/payment/conversation integrations and visual parity. |
| `OPS-004` | Requote and promotional credit | `partial` | `B04/B05/B06` | Immutable quote comparison, credit record, executable browser path. |
| `OPS-005` | Messages and support inbox | `functional_verified` | `B09/B10` | Delivery context, all conversation issuers, attachments and AI drafts. |
| `OPS-006` | Ghost Operations | `placeholder_only` | `B10` | Audited facts/risk/drafts/recommendations; no direct execution. |
| `OPS-007` | Merchant management | `placeholder_only` | `B06` | Activation/risk/support/merchant health with Operations-only commands. |
| `OPS-008` | Vehicle management | `functional_unverified` | `B06` | Browser verification, CRUD/compliance/compatibility/availability states. |
| `OPS-009` | Payments and reconciliation | `placeholder_only` | `B05/B06` | Ledger/Stripe reconciliation, delayed/capture/refund/failure states. |
| `OPS-010` | Payment authorization review | `placeholder_only` | `B05/B06` | Capturable funds, expiry/risk, idempotent capture/release. |
| `OPS-011` | Refund management | `placeholder_only` | `B05/B08` | Delivery-service refund evidence/policy/Stripe/ledger. |
| `OPS-012` | Incidents and claims | `placeholder_only` | `B08` | Evidence workflow and merchandise/delivery responsibility separation. |
| `OPS-013` | Operations analytics | `placeholder_only` | `B11` | Real privacy-safe metrics, accessible chart/table alternatives. |
| `OPS-014` | Unmet demand analytics | `placeholder_only` | `B11` | Actual could-not-confirm reasons and opportunity drilldown. |
| `OPS-015` | Operations settings | `placeholder_only` | `B06/B10` | High-privilege audited settings and policy conflicts. |
| `OPS-016` | Availability controls | `placeholder_only` | `B06/B08` | Hours/cutoff/closures/weather/overnight with decision gates. |
| `OPS-017` | Policy and pricing registry | `placeholder_only` | `B05/B06` | Versioned deterministic policy, effective dates and approvals. |
| `OPS-018` | Notification template manager | `placeholder_only` | `B09` | Audience/channel/version/variables/suppression/test-send. |
| `OPS-019` | Ghost controls and kill switches | `placeholder_only` | `B10` | Draft/shadow/paused/degraded/safety pause controls. |
| `OPS-020` | Activity and audit log | `placeholder_only` | `B06/B10` | Append-only commands/policy/AI/data/payment/override events, redacted. |
| `OPS-021` | Ask Couranr lead inbox | `placeholder_only` | `B10/B11` | Consent/source/UTM/qualification/outcome; no private lookup. |
| `CUS-001` | Address-change request | `functional_verified` | `B08/B09` | Add stage-specific Operations review, quote impact, after-hours/safety states. |
| `CUS-002` | Cancellation and return request | `missing` | `B08` | Stage rules, fee estimate, reviewed request, return-in-progress. |
| `CUS-003` | Recipient unavailable resolution | `functional_verified` | `B08/B09` | Allowed handoff/access/return choices and wait/contact state integration. |
| `CUS-004` | Delivery problem report | `missing` | `B08` | Structured evidence and incident status; no product-refund promise. |
| `CUS-005` | Revised quote approval | `functional_unverified` | `B04/B05` | Immutable original/revised comparison, approve/decline/expiry/3DS. |
| `CUS-006` | Proof viewer | `functional_verified` | `B07/B09` | Visual parity; keep private signed media; download/share remains disabled absent policy. |
| `CUS-007` | Return and refund status | `missing` | `B08` | Custody timeline and delivery-service refund status only. |
| `CUS-008` | Access instructions | `partial` | `B08` | Token-scoped edit/handoff/save before pickup and hard lock after pickup. |

### Screen completion rule

A screen may become `functional_verified` only when:

1. its canonical route resolves in the correct role/token shell;
2. every allowed action reaches a named server command;
3. required states are backed by real typed data or an explicit safe refusal;
4. loading, empty, error, denied, network retry, and concurrent-update states exist where applicable;
5. role/tenant/token boundaries are driven in a browser;
6. browser assertions are paired with database/API/storage/Stripe evidence;
7. desktop/mobile/tablet behavior follows the viewport contract;
8. WCAG 2.2 AA basics pass;
9. visual comparison is recorded against the primary canonical mock;
10. its ledger row and evidence SHA are updated.

---

## 11. Visual parity contract

### 11.1 Source selection

1. Read `UI_SCREEN_REGISTRY.md` for route, purpose, states, constraints, viewport, and named canonical image.
2. Resolve the actual image through `docs/couranr-mvp/ui-reference/CANONICAL_SCREEN_SOURCE_MAP.md`.
3. If a named `canonical-mvp-images/**` file exists, it is primary.
4. Otherwise use the first source mapped to the screen as primary and later variants as state/responsive references.
5. If the map labels a mock ambiguous, do not copy its shell or behavior blindly; use the written screen contract and shared role shell.
6. UUID root PNGs must not be deleted. Do not run the destructive image-materialization workflow noted in the source map.
7. Synthetic records in mocks are visual examples only. Finished screens use typed fixture or real projection data.

### 11.2 Written behavior beats the picture

A mock never overrides:

- pricing;
- business rules;
- state machines;
- permissions;
- privacy;
- claims;
- operating hours;
- markets;
- payment behavior;
- proof rules;
- the absence of subscriptions during the pilot.

Correct the mock’s content during implementation when it conflicts with authority while preserving its visual composition and hierarchy.

### 11.3 Canonical visual system

- Navy `#0D1525`
- Couranr Gold `#F4B740`
- Route Blue `#2563EB`
- Canvas `#F7F8F5`
- Surface `#FFFFFF`
- Border `#E3E7ED`
- Muted `#667085`
- Success `#15803D`
- Geist Sans or Inter
- Cards: 18–22 px radius, 1 px neutral border, restrained shadow, 24–32 px padding
- Desktop buttons: 46–52 px; every touch target at least 44 px
- Sentence case and short labels
- Status always has text/icon/shape, never color alone
- No giant halos, glassmorphism, emoji feature icons, perspective UI, fake metrics, or unreadable miniature dashboards

### 11.4 Responsive reference viewports

Use stable browser projects:

- desktop: 1440 × 1024;
- tablet: 1024 × 1366 and 768 × 1024 where the contract requires tablet usability;
- mobile: 390 × 844;
- narrow mobile: 360 × 800 for overflow detection.

Public/customer flows are mobile-first. Driver is mobile-primary. Merchant and Operations are desktop-primary, with required tablet usability. Merchant mobile launch coverage includes dashboard, create/review delivery, detail, messages, readiness, and payer-link controls.

### 11.5 Visual evidence

For each primary route/state:

1. render deterministic fixtures;
2. wait for fonts and data to settle;
3. disable animation or use reduced motion;
4. mask only timestamps, generated IDs, map tiles, and other genuinely nondeterministic regions;
5. capture implementation and reference side by side;
6. produce a diff image;
7. require no semantic difference in navigation, hierarchy, controls, status, copy, or critical spacing;
8. use a starting automated pixel-diff ceiling of 1% after masks, but never use the percentage to waive a critical-region defect;
9. record any intentional divergence with the written authority that required it.

Never render a mock screenshot as a page background or ship screenshot slices in place of real components.

### 11.6 Accessibility gate

- semantic landmarks and one main region;
- visible focus and keyboard order;
- accessible names and errors;
- reduced motion;
- WCAG 2.2 AA contrast;
- table/card/list alternatives;
- text alternative for maps;
- data table/summary for charts;
- no sensitive lock-screen notification copy;
- automated axe checks plus keyboard smoke for every new surface.

---

## 12. Executable acceptance and evidence registry

The executor must create and maintain:

```text
docs/couranr-mvp/autonomous-evidence/
  INDEX.csv
  <batch>/
    <capability>/
      commands.txt
      results.json
      db-before.json
      db-after.json
      api/
      browser/
      visual/
      accessibility/
      external/
```

### 12.1 Test ID convention

For capability `ACP-043`:

- `ACP-043-UT-*` unit/component;
- `ACP-043-DB-*` constraints/functions/grants/RLS;
- `ACP-043-API-*` route/command;
- `ACP-043-SEC-*` abuse/tenant/token/role;
- `ACP-043-E2E-*` browser + row/object;
- `ACP-043-VIS-*` screenshot/diff;
- `ACP-043-REC-*` retry/recovery;
- `ACP-043-EXT-*` external-provider evidence.

### 12.2 Required fields per evidence row

```text
test_id
capability_id
work_item_ids
screen_ids
severity
environment
commit_sha
identity
preconditions
fixture_ids
steps
expected_browser
actual_browser
expected_api
actual_api
expected_database
actual_database
expected_storage_or_external
actual_storage_or_external
cleanup
result
evidence_paths
known_limit
retest_of
```

### 12.3 Database execution rule

Every new or replaced SQL command must be called against a real disposable PostgreSQL with valid fixture rows. A migration applying and a function compiling are not evidence of runtime correctness.

Every migration batch must prove:

- clean replay;
- upgrade replay from current production-equivalent schema;
- forward/rollback pairing;
- no rollback file in `supabase/migrations/`;
- grants including `PUBLIC`;
- RLS and tenant isolation;
- idempotency/concurrency;
- audit rows;
- no unexpected row-count or catalog drift.

### 12.4 Browser execution rule

- No `page.route` or mocked Couranr API on the feature happy path.
- Authentication may use the repository’s disposable gateway only while its caveat is stated; before final release, real Supabase Auth session/refresh/cookie flows must pass.
- Rendering text is insufficient. Assert the resulting database row, storage object, provider event, or safe refusal.
- Include wrong-role, wrong-tenant, stale-version, duplicate-submit, network-failure, and direct-URL probes.

### 12.5 External integration rule

Real-provider gates are mandatory for:

- Stripe authorization, capture, 3DS, cancellation/release, refund, webhook signature and replay;
- Resend or the selected email provider for template variables and suppression;
- map/address provider for validation and route behavior;
- selected AI provider for provider failure, rate limit, redaction, audit and kill switches;
- deployment hosting/environment validation.

Use test/sandbox modes until the owner authorizes a production canary.

---

## 13. Production change protocol

For every production change:

1. **Prepare**
   - final reviewed migration and paired rollback;
   - data/collision preflight;
   - clean and upgrade replay;
   - schema diff;
   - behavior probes;
   - explicit expected catalog/data delta;
   - rollback and forward-fix criteria.

2. **Snapshot**
   - migration ledger;
   - relevant row counts;
   - grants/RLS/functions/indexes/triggers;
   - storage and provider objects where applicable;
   - application deployment SHA.

3. **Dry run**
   - exact deployment command;
   - prove only expected migrations/actions are pending;
   - stop on orphan, replay, duplicate, destructive, or unexpected action.

4. **Owner approval**
   - name the exact migration/action;
   - name expected effects and rollback;
   - obtain explicit approval.

5. **Apply**
   - one controlled operation;
   - no opportunistic unrelated repair.

6. **Verify**
   - migration version/name;
   - catalog objects;
   - privileges;
   - behavior probes;
   - data counts;
   - application compatibility;
   - second dry run/no-op.

7. **Record**
   - witnessed output in runbook;
   - status/ledger update in the same final code commit;
   - deployment SHA and production verification time.

A tool returning a permission/classifier error is not proof that the statement did not execute. Always read state before retrying. Retried operations must be idempotent.

---

## 14. Autonomous run-state contract

Create `docs/couranr-mvp/AUTONOMOUS_RUN_STATE.json` after B00:

```json
{
  "schema_version": "1.0",
  "repository": "kkoly10/couranr-os",
  "authority_sha": "<final main sha>",
  "production_migration_head": "20260806010000",
  "active_batch": "B01",
  "active_capability": "ACP-003",
  "open_pr": null,
  "completed_capabilities": [],
  "blocked_capabilities": [],
  "decision_queue": ["SVC-002", "PRC-004", "TAX-001", "OVN-002", "FLG-002"],
  "p0_findings": [],
  "production_changes_pending_approval": [],
  "last_full_gate": {
    "sha": null,
    "result": "not_run",
    "evidence": null
  }
}
```

Update it after every committed capability. It is execution state, not product authority.

---

## 15. Stop and escalation conditions

Stop the affected work immediately when:

- authority conflicts or a required decision is unresolved;
- a P0 security, money, custody, proof, safety, or unrecoverable-data defect is found;
- production differs from the repository in an unexplained way;
- a migration would drop/delete/rewrite data;
- a test requires wider production privileges;
- a cross-tenant/token/role leak appears;
- Stripe/ledger totals do not reconcile;
- required proof can be bypassed;
- an AI tool can execute or read outside its scope;
- a visual mock contradicts written authority and the correct adaptation is not clear;
- a cleanup cannot be proven safe;
- a tool reports uncertainty about whether a write executed.

For a P0:

1. freeze the active batch;
2. create `SEC-###` or `P0-###`;
3. establish catalog/code evidence without exploiting real users;
4. isolate a focused hotfix;
5. verify it independently;
6. update the run state and ledgers;
7. resume only after the fix is merged and production is reconciled when applicable.

---

## 16. Batch-level quality gates

Every batch runs, at minimum:

```bash
npm ci
npm run lint
npm run typecheck
npm run test:run
npm run build
```

As the baseline lands, these become mandatory and non-vacuous:

```bash
npm run typecheck:canonical
npm run check:routes
npm run check:legacy-imports
npm run check:migrations
npm run check:policy-registry
npm run db:reset
npm run db:test
npm run check:rls
npm run test:security
npm run test:payments
npm run test:delivery-lifecycle
npm run test:ghost-isolation
npm run test:e2e
npm run test:visual
npm run test:a11y
```

A script may not return success without performing the named check. Each new check requires a positive control showing it fails when its invariant is broken.

---

## 17. Definition of complete

### 17.1 Code/product completion

- all applicable `P*` rows are `complete_verified` or explicitly `complete_pending_external` only for an owner-approved external gate;
- all Core and MVP-complete screen rows are `functional_verified`;
- no canonical page renders `ScreenPlaceholder`;
- no canonical screen is missing;
- no known capability exists only in prose;
- every route/action uses a named server command and typed schema;
- no second pricing/payment/state/tenant implementation remains reachable.

### 17.2 Security/data completion

- zero public tables without RLS;
- grants and policies pass tenant/role/token tests;
- no client secret exposure;
- private storage for proof/evidence/messages;
- `vehicle-images` public exposure is resolved or explicitly justified by an approved policy;
- idempotency/audit cover money, state, webhooks, messages and external callbacks;
- backup/restore and recovery rehearsal pass.

### 17.3 Visual/UX completion

- every screen has primary desktop/mobile evidence appropriate to its viewport;
- every required state has functional evidence;
- no fake metrics or prohibited claims;
- accessibility gate passes;
- mock deviations are authority-driven and documented;
- public, merchant, driver, Operations and customer surfaces feel like one system.

### 17.4 Launch completion

- real Stripe test-mode verification passes;
- release matrix and all 15 E2E scenarios pass;
- zero P0 and zero core P1;
- one owner-approved production canary reconciles across Stripe, ledger, database, proof, storage, messages, analytics and deployment;
- Operations can pause new requests and AI;
- final main SHA, production migration head, deployments and ledgers agree.

---

## 18. First command to the autonomous executor

Use this exact intent after the activation gate is satisfied:

> Read this file first, then read every authority in §3. Do not write code yet. Reconcile the final `main` SHA, production migration ledger, implementation ledgers, screen ledger, decision registry, package manifest and canonical mock map. Create `AUTONOMOUS_RUN_STATE.json`, populate B00 evidence, and report only contradictions or blockers. Once B00 is green, execute B01 through B13 in order. Work in substantial batch PRs, verify empirically, update ledgers in the same commit, continue past nonblocking decision gaps, and stop only under §15 or before any owner-gated merge/production/external-money operation.

---

## Appendix A — Existing files this document compiles

- `02_DECISION_REGISTRY.json`
- `Couranr_Claude_Code_Master_Package.md`
- `couranr_claude_code_package/01_MASTER_IMPLEMENTATION_SPEC.md`
- `couranr_claude_code_package/03_REPO_CUTOVER_MATRIX.md`
- `couranr_claude_code_package/04_PHASED_EXECUTION_PLAN.md`
- `couranr_claude_code_package/05_AI_COMMUNICATION_SPEC.md`
- `couranr_claude_code_package/06_RELEASE_ACCEPTANCE_MATRIX.md`
- `couranr_claude_code_package/08_WORK_BREAKDOWN.csv`
- `UI_SCREEN_REGISTRY.md`
- `docs/couranr-mvp/ui-reference/CANONICAL_SCREEN_SOURCE_MAP.md`
- `docs/couranr-mvp/MARKETING_POSITIONING_AND_HOMEPAGE_BLUEPRINT.md`
- `docs/couranr-mvp/platform-baseline-v1.1/`
- `docs/couranr-mvp/IMPLEMENTATION_STATUS.md`
- `docs/couranr-mvp/IMPLEMENTATION_LEDGER.csv`
- `docs/couranr-mvp/SCREEN_IMPLEMENTATION_LEDGER.csv`
- `CLAUDE.md`

## Appendix B — Known untracked gaps promoted into this execution graph

- conversation issuance → `ACP-049`;
- conversation participant tenure writers → `ACP-050`;
- tracking-link issuance → `ACP-051`;
- customer access-instruction mutation/lock → `ACP-047`;
- platform/runtime completion → `ACP-003`–`ACP-008`;
- visual parity harness → `ACP-006`–`ACP-007`;
- real Stripe closure → `ACP-032`;
- decision-gated closure/overnight/flags/tax/rounding → `ACP-035`, `ACP-048`.

## Appendix C — Completion arithmetic

The denominator is never reduced merely because work is difficult.

- authoritative work items: 42;
- canonical screens: 66;
- public: 11;
- merchant: 16;
- driver: 10;
- Operations: 21;
- customer: 8.

A percentage must always be reported with its numerator and denominator. “Mostly complete,” “about 90%,” and route-count-based completion are prohibited.

# Couranr Phased Claude Code Execution Plan

## Protocol for every phase

1. Inspect before editing.
2. Produce a phase gap report.
3. Implement the smallest coherent set.
4. Add tests.
5. Run relevant checks.
6. Return a completion report.
7. Do not advance with an open P0/P1 from the phase.

## Phase 0 — Inventory and preservation

Create/push the legacy tag, archive branch, and implementation branch. Inventory routes, schema/RLS, Stripe, storage, environment variables, legacy imports, tests, and privileged mutations.

Create:
- `docs/couranr-mvp/00-current-state-inventory.md`
- `00-route-inventory.json`
- `00-schema-inventory.md`
- `00-env-inventory.md`
- `00-stripe-inventory.md`
- `00-storage-inventory.md`
- `00-gap-report.md`

Acceptance: preservation verified, backup documented, every unsafe path identified, no destructive change.

## Phase 1 — Runtime containment

Disable direct assign/in-transit and auto/docs mutations. Remove legacy navigation. Add redirects, feature registry, `check:routes`, `check:legacy-imports`, and delivery-specific Stripe webhook boundary.

Acceptance: old routes cannot mutate or pay; delivery webhook imports no auto/docs logic.

## Phase 2 — Database, RLS, authorization, idempotency

Create private/analytics schemas, merchant identity/location/preferences, operator roles, authorization functions, idempotency, audit, guest tokens, grants, policies, indexes, and security tests.

Acceptance: clean and upgrade migrations pass; merchant isolation, roles, driver scope, and guest-token scope pass.

## Phase 3 — Policy registry and pricing

Create versioned market, hours, availability, pricing, cancellation, return, wait, category, safety, and vehicle rules. Replace legacy pricing and tests.

Acceptance: one server source of truth; every accepted amount and review rule matches the registry.

## Phase 4 — Onboarding, customers, presets

Implement two-speed onboarding, categories, locations, payer preference, acknowledgements, test workspace, activation, customer/address book, global presets, merchant customization, versions, and simulated test delivery.

Acceptance: no card required to finish onboarding; test delivery creates no live charge; historical preset snapshots remain.

## Phase 5 — Smart Intake and requests

Implement intake sessions, structured extraction, evidence, clarification, corrections, manual fallback, conversion command, request versions, packages, address validation, and review triggers.

Acceptance: AI never prices or invents critical facts; prompt injection fails; AI outage falls back; no duplicate or legacy order.

## Phase 6 — Quotes, payer flows, Stripe, ledger

Implement immutable quote versions/line items/acceptance, merchant/customer payer paths, payment obligations/attempts, payment tokens, manual capture, delivery webhook, reconciliation, ledger, refunds, adjustments, and promotional credit.

Acceptance: both payer E2E flows; failures recover; duplicates harmless; delivery created only after capture; Stripe and ledger reconcile.

## Phase 7 — Operations, vehicles, driver, proof, exceptions

Implement vehicle capabilities, Operations Queue, review actions, assignment, driver projection, state commands, pickup/delivery proof, offline sync, tracking, returns, incidents, weather, wait, cancellation, and attempt fees.

Acceptance: driver isolation and valid state machine; required proof; correct returns/charges; offline recovery.

## Phase 8 — Messaging and support

Implement support and delivery conversations, participants, messages, attachments, read states, internal notes, 15-minute deadlines, Operations Inbox, Driving Mode, Customer Delivery Help, and email receipts/fallback.

Acceptance: participant/privacy controls, accurate operating/after-hours deadlines, no direct customer-driver overload, idempotent send.

## Phase 9 — AI surfaces

Implement AI audit, data broker, allowlisted tools, drafts, coaching, generalized similar-case retrieval, policy retrieval, verifier, auto-reply gates, kill switches, global Ghost, Ask Couranr, merchant Assistant, Delivery Help assistant, and knowledge drafts.

Rollout: draft-only → shadow → safe test → production canary → limited allowlist.

Acceptance: no direct SQL, no cross-tenant access, no restricted execution, verified replies, immediate kill switch, manual operation during AI outage.

## Phase 10 — Marketing, analytics, observability

Implement public pages, Ask Couranr, lead consent/qualification, estimates, website link/QR, attribution, conversion, unit economics, vehicle demand, support metrics, unmet demand, and operational alerts.

Acceptance: correct markets/hours/pricing; Maryland not initially marketed; no PII in analytics; actionable alerts.

## Phase 11 — Migration and cutover

Migrate selected fixtures, keep legacy read-only, remove active legacy imports/navigation, enable merchant delivery, disable old product flags, verify storage/webhooks/secrets, and run no-dual-write tests.

Acceptance: new schema is sole authority and active route map matches target.

## Phase 12 — Launch acceptance and canary

Execute the release matrix and one controlled real production delivery covering request, quote, payment, review, assignment, messaging, proof, tracking, receipt, support, Ghost, Stripe, ledger, and analytics.

Acceptance: zero P0, zero core P1, backup verified, canary and reconciliation pass.

## Required phase report

- Phase
- Files created/changed/disabled
- Migrations
- Tests and results
- Security/data implications
- Known gaps
- Exact next phase
- Any accepted decision not implemented and why

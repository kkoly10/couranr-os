# Business Route Runs — RR-001 / RR-002 implementation boundary

Base reviewed: `a19cfe11a0d81837720c2356dbdd4ac0bac7ba42` (current main at the 2026-09-26 continuation recon).

## Locked V1 product contract

RR-001 is Business-only: one common pickup, two to five separate canonical one-destination child requests, merchant payer, and explicit stop order. A Route Run groups deliveries; it never turns one Delivery into multiple destinations. `additional_stops = 0`, immutable quote identity, per-child recipient tracking/proof, tenancy and refund/dispute identity remain intact.

The historical `$16.99 per stop` Route Saver price stays retired. V1 route price is the exact sum of accepted child delivery quotes, with no automatic route discount. The launch aggregate declared-value ceiling is `$500` across the whole Route Run in addition to each child's own limit. Unknown cargo/value evidence fails closed.

## Closed RR-001 draft foundation

The draft foundation is additive and deliberately non-executable. Four tables store the route shell, immutable draft revisions, ordered child references/snapshots and append-only route events. The Business API reads/saves/revises only drafts. It refuses browser prices, driver ids/states, foreign/duplicate children, customer payers, submitted children, missing canonical quotes and non-common pickups.

RR-001 responses were `draftOnly: true` and `bookingAvailable: false`, with only `route_state = 'draft'`. RR-002 extends the stop-set lifecycle below; admission inspection still includes `route_execution_not_released`. A saved draft cannot capture payment, create a Delivery, reserve a driver/vehicle, issue custody credentials or activate a stop. Draft membership does not claim a child, so a child submitted independently simply makes the draft stale.

This readiness slice also closes two prerequisites found during the 2026-09-26 adversarial recon:

1. Customer problem reports are now isolated by Help audience (`legacy`, `sender`, `recipient`) rather than merely by delivery. Sender and recipient may hold separate private cases for the same delivery, while a reissued token for the same audience resumes that audience's case.
2. A terminal returned / could-not-deliver Operations workbench now has a first-party action to open an OPS-011 delivery-charge refund review. It creates review state only; it carries no amount and moves no money.

## Database / rollback

Route draft migration: `20260923200000_couranr_route_run_draft_foundation.sql`. It creates no canonical request/payment/plan/delivery/assignment/proof mutation. RLS is enabled, browser roles receive no direct access, service role receives SELECT only, and validated SECURITY DEFINER RPCs own draft writes. The paired rollback refuses once any semantic Route draft history exists.

Problem-report audience migration: `20260926013000_couranr_customer_problem_audience_isolation.sql`. It backfills existing reports from their issuing Help token, scopes open/draft uniqueness by `(delivery_id, customer_audience)`, and replaces each customer-token read/write/evidence function with audience-aware logic. Its rollback refuses once sender/recipient-scoped case history exists rather than collapsing private cases.

## Executed disposable evidence

- `node e2e/disposable/routeRunFoundation.mjs`: 47/47 PASS after the current migration chain. It covers forward/empty rollback/forward, ACLs, tenancy, payer/pickup refusals, CAS/idempotency, two-connection revision race, immutable history, stale references, unchanged canonical children and rollback refusal after use.
- `node e2e/disposable/customerProblemAudience.mjs`: 11/11 PASS. It proves same-delivery sender and recipient cases stay separate, cross-audience read/write attempts fail, same-audience token reissue resumes the same case, both audiences may independently reuse the same client-generated submit idempotency key, and rollback refuses semantic audience history.

These are database evidence only. They are not evidence of live multi-stop payment, dispatch or physical custody.

## Implemented and verified RR-002 — Route Builder + accepted Route contract

Business Routes / New Route / Route detail are implemented as MER-017 / MER-018 / MER-019. Shared pickup and timing are entered once; each of two to five stops uses the existing canonical Business request and immutable quote commands, its own recipient email, package manifest, weight and declared value. V1 refuses restricted items, children above 50 lb and aggregate declared value above $500. Prices remain the sum of canonical child quotes; the server derives protection level.

`20260926043000_couranr_route_run_acceptance.sql` extends Route state to `draft / accepted / abandoned`. Acceptance atomically revalidates and claims every child, freezes the exact accepted version and preserves quote approval. Accepted children are blocked from ordinary standalone mutation. Draft abandonment is idempotent. The paired rollback refuses once semantic acceptance, abandonment or declared-value history exists.

RR-002 was built from `29ba410f8c5b6c777835a5d1f2a192e7f5a9f632`. The review-fix evidence below was rerun locally from merged main `d68e40c54bb3942daadaa4317e83dca7c0a67c2d`; these fixes add no migration:

- `npm run test:route-run-acceptance`: 97/97 real PostgreSQL adversarial checks, including empty forward/rollback/forward, immutable accepted version, atomic claims, approval beyond the original quote-expiry window, historical draft replay versus current-generation acceptance CAS, child mutation refusals, risk gates, overlapping acceptance and standalone-submit races, ACLs and semantic rollback refusal. Acceptance creates no obligations, service plans, deliveries or assignments.
- `npm run test:route-run-merchant`: 17/17 authenticated disposable Chromium checks through the real Next/API/PostgREST/PostgreSQL stack. It proves draft list and child sum, initial two-stop builder with no provider request merely from rendering, owner acceptance and two persisted claims, truthful unbooked copy, viewer read-only controls and mobile detail without overflow. Four screenshots live under `e2e/screenshots/route-run/`. Cleanup closes the owned services, verifies their ports are free, restores `tsconfig.json` and removes its isolated build.
- `tests/couranr-route-run-builder.dom.test.tsx`: 11/11 builder interaction checks, including in-flight editing, historical save replay refusal, idempotent child-payload mismatch refusal, same-tab partial-attempt recovery, cross-business privacy and refusal to create children when retry keys cannot be stored. `tests/couranr-route-run-detail.dom.test.tsx`: 3/3 detail checks covering refreshed child prices, failed child-detail reads and displayed-version acceptance. The focused Route API suite: 22/22. The builder's recovery copy is held only in the current tab's session storage for up to 24 hours; it is not a server draft cleanup or a cross-device resume mechanism.

The browser suite uses the repository's disposable auth gateway rather than live GoTrue and does not type provider-backed addresses or execute archive/reorder. Neither this suite nor acceptance is evidence of live Route payment, booking, dispatch, assignment, pickup, custody or driver execution. **Accepted means the stop set is frozen; the Route is not operational.**

## Next implementation slices

### RR-003 — reusable Business payment + route settlement + resource reservation

Couranr currently stores no reusable Business payment method. Add the Stripe Customer + SetupIntent foundation before live Route payment. Preserve one obligation per child, then orchestrate all child authorizations/captures with stable order, provider idempotency and reconciliation-first handling of unknown outcomes. A partially funded Route cannot move physically. Create one Route-owned driver/vehicle reservation shared with ordinary dispatch; completing one child must not release the Route resource.

### RR-004 — shared pickup + sequential execution + route views

At the common pickup, every child's package must be individually accounted for and evidence requirements remain per child. Departure is blocked until every planned child is loaded or explicitly resolved. Driver execution advances one stop at a time; tracking, recipient credentials, proof, Help, returns and refunds remain child-scoped. Merchant, Driver and Operations get Route-level views over these existing authorities.

Before production activation: disposable multi-actor browser coverage, provider-recovery tests, then an internal two-stop physical pilot, followed by three-stop and at most five-stop pilots. Consumer multi-stop, multiple pickups, mixed payers, automatic route optimization, automatic route discounts, group tipping and Website Tools Route creation remain outside V1.

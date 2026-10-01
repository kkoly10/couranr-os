# Business Route Runs — implementation and activation boundary

RR-002 closure base: `fbac4a1b480fa2df1dde108d4669a2b3b706f93e` (verified main at the 2026-09-29 continuation recon).

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

QVL-001 now explicitly recognizes accepted Route membership as merchant payer approval of each exact displayed child Quote Version, obtained before the quote window expires. The immutable accepted Route version and active claims are the evidence; no second approval flag exists. Time passage does not expire an accepted quote. This approval does **not** authorize/capture Stripe money or book, dispatch or establish custody.

RR-002 closure adds a separate terminal `cancelled` state for an accepted Route that has no downstream payment, plan, delivery or reservation evidence. `couranr_cancel_accepted_route_run` locks the Route and accepted children, fails closed on downstream records, releases claims atomically, and appends an immutable cancellation event. Accepted version/time/actor remain historical. Cancellation removes Route-derived quote approval; released children remain independent drafts and may need a fresh quote or standalone payer approval. This is neither draft archive nor a refund/cancellation engine for live execution. RR-003 subsequently extended the downstream guard and retains Route-before-child lock order for payment entry.

The builder's same-tab recovery now persists the safe pickup-manifest CAS generation returned by the server. On resume it compares the server generation even when the commercial request version did not change. A changed, changed-back, missing or legacy-unknown manifest generation fails closed without overwriting package details or creating a replacement child.

### Production Route migration identity (repository ↔ Supabase history)

Supabase `apply_migration` assigned production versions independent of the repository filename timestamps. These are the same named migrations, not gaps to replay. The production catalog and empty Route table counts were rechecked at closure recon on 2026-09-29. No synthetic production Route data was created.

| Repository migration filename | Production `schema_migrations.version` | Name | Applied UTC | Schema evidence |
| --- | --- | --- | --- | --- |
| `20260923200000_couranr_route_run_draft_foundation.sql` | `20260926071024` | `couranr_route_run_draft_foundation` | 2026-09-26 07:10:24 | Route shell/version/stop/event tables present |
| `20260926033000_couranr_route_run_index_hardening.sql` | `20260926071307` | `couranr_route_run_index_hardening` | 2026-09-26 07:13:07 | Route FK-support indexes present |
| `20260926043000_couranr_route_run_acceptance.sql` | `20260929162804` | `couranr_route_run_acceptance` | 2026-09-29 16:28:04 | Claims table, accepted-child guard and service-role RPCs present |
| `20260930023308_couranr_route_run_preexecution_cancellation.sql` | `20260930034722` | `couranr_route_run_preexecution_cancellation` | 2026-09-30 03:47:22 | Cancelled state and pre-execution release command present |
| `20260930023313_couranr_route_run_claim_fk_index.sql` | `20260930034741` | `couranr_route_run_claim_fk_index` | 2026-09-30 03:47:41 | Composite Route-claim FK index present |
| `20260930124500_couranr_business_payment_method_foundation.sql` | `20261001010808` | `couranr_business_payment_method_foundation` | 2026-10-01 01:08:08 | Saved-card profile/setup tables present; zero production rows |
| `20260930133000_couranr_route_run_settlement_foundation.sql` | `20261001010818` | `couranr_route_run_settlement_foundation` | 2026-10-01 01:08:18 | Route settlement and child-item tables present; zero production rows |
| `20260930150000_couranr_route_run_resource_reservation.sql` | `20261001010827` | `couranr_route_run_resource_reservation` | 2026-10-01 01:08:27 | Shared resource reservation table/guards present; zero production rows |
| `20260930161610_route_run_pickup_readiness.sql` | `20261001010837` | `route_run_pickup_readiness` | 2026-10-01 01:08:37 | Server-owned pickup-readiness command present |
| `20260930163000_route_run_service_plans.sql` | `20261001010845` | `route_run_service_plans` | 2026-10-01 01:08:45 | Exact child service-plan command present |
| `20260930164659_route_run_capture_gate.sql` | `20261001010854` | `route_run_capture_gate` | 2026-10-01 01:08:54 | Capture/funding commands present |
| `20260930233259_couranr_route_run_execution_foundation.sql` | `20261001010903` | `couranr_route_run_execution_foundation` | 2026-10-01 01:09:03 | Shared execution/assignment authority present; zero production rows |
| `20260930234200_couranr_route_run_shared_pickup.sql` | `20261001010911` | `couranr_route_run_shared_pickup` | 2026-10-01 01:09:11 | One pickup with child custody/stop-order guards present |
| `20260930234700_couranr_route_run_stop_advance_release.sql` | `20261001010920` | `couranr_route_run_stop_advance_release` | 2026-10-01 01:09:20 | Sequential stop/terminal resource commands present |
| `20261001011500_couranr_route_run_fk_covering_indexes.sql` | `20261001012533` | `couranr_route_run_fk_covering_indexes` | 2026-10-01 01:25:33 | Ten RR-003 FK indexes present; Route unindexed-FK advisor findings zero |

Do not rename/replay these already-applied repository migrations to force their timestamps to match production history. Reconcile by name and verified schema, then apply only new closure migrations. The RR-003/RR-004 cutover above created no synthetic production Route, payment, resource or provider record; production Route tables still contained zero rows at verification.

RR-002 was originally built from `29ba410f8c5b6c777835a5d1f2a192e7f5a9f632` and the closure started from verified main `fbac4a1b480fa2df1dde108d4669a2b3b706f93e`. Closure adds two paired migrations: `20260930023308_couranr_route_run_preexecution_cancellation.sql` and `20260930023313_couranr_route_run_claim_fk_index.sql`. The latter covers the claims composite FK `(route_run_id,route_version_id)` without removing older indexes.

- `npm run test:route-run-acceptance`: 148/148 real PostgreSQL adversarial checks, including empty forward/rollback/forward, immutable accepted version, atomic claims, before-expiry approval, expired-unaccepted refusal, approval persistence and withdrawal on cancellation, historical draft replay versus current-generation CAS, child mutation refusals, risk gates, overlapping acceptance and standalone-submit races, cancellation replay/conflict/concurrency, cancellation-versus-first-obligation race, ACLs and semantic rollback refusal. Acceptance/cancellation make no provider calls and create no obligation, plan, delivery or assignment.
- `npm run test:route-run-merchant`: 22/22 authenticated disposable Chromium checks through the real Next/API/PostgREST/PostgreSQL stack. It proves draft list and child sum, initial two-stop builder with no provider call merely from rendering, owner acceptance and two persisted claims, truthful unbooked copy, viewer read-only controls and mobile detail without overflow, then owner-confirmed cancellation preserving accepted history and releasing both claims. Five screenshots live under `e2e/screenshots/route-run/`. Cleanup closes the owned services, verifies their ports are free, restores `tsconfig.json` and removes its isolated build.
- `tests/couranr-route-run-builder.dom.test.tsx`: 13/13 builder interaction checks, including in-flight editing, historical save replay refusal, idempotent child-payload mismatch refusal, same-tab partial-attempt recovery, manifest generation mismatch and changed-back refusal, cross-business privacy and refusal to create children when retry keys cannot be stored. `tests/couranr-route-run-detail.dom.test.tsx`: 5/5 detail checks covering refreshed child prices, failed child-detail reads, displayed-version acceptance, cancellation confirmation and viewer exclusion. The focused Route API suite: 23/23. Recovery is limited to the current tab's session storage for up to 24 hours; it is not server-side draft cleanup or cross-device resume.

The browser suite uses the repository's disposable auth gateway rather than live GoTrue and does not type provider-backed addresses or execute archive/reorder. Neither this suite nor acceptance is evidence of live Route payment, booking, dispatch, assignment, pickup, custody or driver execution. **Accepted means the stop set is frozen; the Route is not operational.**

## RR-003 / RR-004 local implementation — production activation is separate

RR-003 now has a saved Business card SetupIntent/consent foundation, exact accepted-version checkout, one canonical obligation and PaymentIntent per child, a durable Route settlement and provider reconciliation, a single Route-owned driver/vehicle reservation that excludes ordinary dispatch, a pickup-readiness gate, canonical child service plans, and recoverable child capture and delivery conversion. No aggregate Route PaymentIntent exists. Saving a card is never checkout; Route acceptance is never authorization or capture. The production Route checkout route remains explicitly gated until production cutover and a governed pilot. Its migrations are `20260930124500_couranr_business_payment_method_foundation.sql`, `20260930133000_couranr_route_run_settlement_foundation.sql`, `20260930150000_couranr_route_run_resource_reservation.sql`, `20260930161610_route_run_pickup_readiness.sql`, `20260930163000_route_run_service_plans.sql`, and `20260930164659_route_run_capture_gate.sql`, each with a paired rollback.

RR-004 now has one funded Route execution record, guarded same-Route child assignments, shared pickup travel/arrival, mandatory child-specific pickup credential and proof before one departure, database-enforced stop order, governed Operations exception decisions, return-cargo preservation, and one terminal Route resource release. It reuses existing child pickup, drop-off, PIN, proof, return and cancellation commands. Driver Route task and Operations Route status appear inside existing screens, not a second delivery engine. Its paired migrations are `20260930233259_couranr_route_run_execution_foundation.sql`, `20260930234200_couranr_route_run_shared_pickup.sql`, and `20260930234700_couranr_route_run_stop_advance_release.sql`.

The index-only production follow-up `20261001011500_couranr_route_run_fk_covering_indexes.sql` has a paired data-preserving rollback. It removes the ten new RR-003 unindexed-FK INFO findings without changing settlement, customer, or custody rows. The remaining unused-index INFO notices are expected while production Route tables contain no rows.

Local evidence at this stage: `test:rr004-route-execution` 68/68 on disposable PostgreSQL, including empty forward/rollback/forward, deny-all browser ACLs, same-Route assignment, ordinary-work exclusion, ordered stop refusal, mixed loaded/missing pickup, failed pickup refund-and-return recovery, failed drop-off with explicit Operations continuation, return cargo blocking terminal release and single release. `test:route-run-merchant` 64/64 in authenticated disposable Chromium covers two child pickup credentials, two private photo uploads, shared departure, out-of-order UI guard, two separate recipient PIN handoffs, child proof/custody, final release and the merchant's terminal Route status. These are provider/evidence doubles against an isolated stack, **not** live Stripe, GoTrue, actual parcels, or production Route records. The browser suite does not prove a three- or five-stop physical journey or every Operations exception button. Do not promote these local results to live-money or physical-pilot evidence.

Production activation still requires exact-head full local gates, additive migration preflight/application and verification, deployment identity, provider recovery observation, then a human-operated internal two-stop physical pilot followed by three-stop and at-most-five-stop pilots. Consumer multi-stop, multiple pickups, mixed payers, automatic route optimization, automatic route discounts, group tipping and Website Tools Route creation remain outside V1.

# RR-003 / RR-004 implementation plan and adversarial gate

Authority: root decision registry RR-003 / RR-004.

## Reused canonical seams

- Child requests and immutable quote versions remain canonical.
- RR-002 acceptance remains merchant approval of exact child quotes.
- Each child keeps one canonical payment obligation and provider identity.
- Existing provider reconciliation/capture, service-plan and delivery-conversion primitives remain authoritative.
- Existing child custody/proof/recipient privacy remains child-scoped.
- The one-active-driver invariant remains unchanged for non-Route work.

## RR-003

1. RR-003a: saved Business card using Stripe Customer + SetupIntent + explicit off-session consent. Owner/manager only. Saving a card never charges or books.
2. RR-003b: one immutable Route checkout confirmation, one canonical obligation per child, stable authorization order, reconciliation-first unknown outcomes, no physical progress on partial money.
3. RR-003c: after all children are authorized, reserve one compatible driver/vehicle for the Route using aggregate server evidence. Reserve before capture. Only a fully captured/reconciled Route becomes execution-ready.

## RR-004

1. Route-aware assignment invariant: multiple active child assignments are allowed only when every assignment shares the same active Route resource owner. The non-Route one-active-driver rule stays intact.
2. Shared pickup: one arrival; validate all planned child manifests/proofs before atomic departure.
3. Sequential current-stop execution over canonical child deliveries.
4. Route-aware resource release and exception/return completion.
5. Merchant / Driver / Operations Route views.

## Adversarial matrix

| Failure/race | Required behavior |
| --- | --- |
| Stripe Customer create response lost | Retry the same durable provider idempotency key; never map a second Customer. |
| SetupIntent succeeds but DB commit fails | Re-read exact provider Customer/SetupIntent/PaymentMethod and converge the same generation. |
| Membership revoked mid-setup | Mutation refuses; current manager may reconcile provider success without rewriting the original consent actor. |
| Route cancellation races checkout | Route-first lock order; exactly one side wins. |
| Child 1 authorizes, child 2 declines | No Route capture or execution; reconcile then release known holds. |
| Authorization outcome unknown | Reconcile provider evidence; never blind-create a second intent. |
| Resource unavailable after all holds | Release verified holds; no capture. |
| Capture 1 succeeds and capture 2 is unknown/fails | Route recovery_required; no dispatch/pickup until provider reconciliation/compensation converges. |
| Process dies after any provider call | Durable settlement + canonical obligation/provider IDs make resume deterministic. |
| Ordinary dispatch races Route reservation | Same market lock and both reservation sets are checked. |
| Stop 1 completes | Driver/vehicle remain on_delivery while another Route child is active. |
| Package missing at common pickup | Validate all planned children before departure; no partial Route departure. |
| Package manifest/protection proof changed | Re-read child evidence and fail closed. |
| Recipient 1 asks for recipient 2 data | Impossible through child-scoped tracking/Help/credentials. |
| One stop cannot deliver | Only that child enters exception; Route continuation/return needs explicit Operations resolution. |
| Return cargo while later drops continue | Resource remains Route-owned and return child remains nonterminal custody. |
| Duplicate/replayed driver command | Route/child version + idempotency/CAS returns same result or stable conflict. |
| Driver/vehicle is disabled mid-Route | No silent reallocation; terminal release honors current active flags. |

No live provider or production customer canary is required before disposable PostgreSQL, local Stripe doubles and authenticated Chromium prove these invariants.

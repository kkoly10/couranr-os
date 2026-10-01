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

## RR-004 pre-implementation adversarial pass (2026-09-30)

| Authority edge | Failure to prevent | Testable boundary |
| --- | --- | --- |
| Route assignment versus ordinary dispatch | A driver or vehicle is committed twice, or Route child 2 is rejected by the ordinary one-driver index | One global resource lock; only same-execution siblings may share; unrelated assignments still fail under concurrency |
| Child identity | A Route assignment points at a delivery outside the accepted version, or a child is assigned to a different driver/vehicle | Exact accepted stop, funded settlement item, delivery, resource and execution IDs checked in SQL |
| Shared pickup | One child advances alone, or the Route departs with a missing/unevidenced package | Route command moves the visit atomically; existing child pickup proof remains required; departure checks every child under lock |
| Stop sequence | Direct single-delivery endpoint advances Stop 4 while Stop 2 is current | Database transition guard, not a hidden button; all driver commands retain generic foreign-delivery refusal |
| Exception and return cargo | One failure silently skips later stops or a return obligation disappears at final normal delivery | Route pauses for Operations decision; unresolved custody blocks Route completion and resource release |
| Resource release | Finishing the first child makes driver/vehicle available, or concurrent terminal attempts release twice | Existing child release helper becomes Route-aware; one Route terminal command checks all child custody and releases once |
| Recovery before physical execution | Partial capture leaves a committed resource forever, or releases it while captured money/custody is unresolved | Operations release is allowed only after canonical financial and delivery resolution; unknown provider or live custody refuses |
| Privacy and rollback | A recipient reads sibling data, or rollback deletes Route custody history | Recipient stays on child tokens; Route reads require merchant, assigned driver or Operations authority; lock-first semantic rollback refusal |

## Local implementation evidence and activation gate

RR-003a/b/c are implemented in the route-execution worktree as saved-card consent, exact child settlement, Route-owned resource reservation, pickup readiness, service plans and recoverable child capture. The application deliberately refuses production Route checkout until an explicit activation decision. Provider failures are tested with doubles; no live Stripe or routing call is part of this evidence.

RR-004a/b/c are implemented as one Route execution over canonical child deliveries and their existing proof/credential/return commands. The disposable PostgreSQL suite has 68/68 checks, including failed shared pickup with mixed loaded/missing cargo, settled refund versus open return, failed Stop 1 with Operations continuation and terminal release only after return cargo closes. The authenticated disposable browser suite has 64/64 checks through two separate pickup-code/photo/custody paths, one shared departure, ordered recipient PIN handoffs, one final resource release and the merchant's terminal progress view. This is software evidence, not a production physical pilot.

Before claiming launch readiness: run exact-head full gates, apply only approved additive migrations after production preflight, verify security and production deployment identity, then conduct a human-operated two-stop physical pilot and longer 3–5 stop pilots. Never synthesize production custody or card charges to replace that pilot.

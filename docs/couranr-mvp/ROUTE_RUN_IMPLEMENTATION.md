# Business Route Runs — RR-001 implementation boundary

Base reviewed: `28e54670f6a90c2604777aa3297c493725fa6a1e` (PR #98).

## Product contract

Business-only, one common pickup, two to five separate single-destination
requests, one merchant payer, explicit ordered stops. The Route Run groups
Deliveries; it does not redefine a Delivery. `additional_stops = 0`, immutable
quote identity, tenancy, PIN, proof and payment contracts remain unchanged.
No historical Route Saver or additional-stop price is revived.

## Implemented in RR-001

Strict draft input: route ID, expected version, idempotency key, title and
ordered child request IDs. Browser prices, driver IDs and states are refused.

Four additive tables store the route shell, immutable draft versions, ordered
child references/snapshots, and append-only events. Service-role callers have
SELECT, not direct DML. Writes use service-role-only SECURITY DEFINER RPCs with
empty search paths and independently checked, locked active Business membership.
Owner/manager/dispatcher may save; other active members may read. An admin
profile alone does not permit merchant impersonation.

GET/POST `/api/couranr/merchant/route-runs` reads/saves/revises drafts. SQL also
refuses foreign or duplicate children, customer payers, submitted requests,
missing canonical quotes, and differing pickup snapshots. CAS revisions and
fingerprinted idempotency preserve history. Replay returns its ORIGINAL
revision plus current staleness information, not a rewritten snapshot.

The displayed total is the sum of immutable independent reference quotes, NOT
a route offer or payable amount. Changed request, manifest or quote identities
mark a child stale. Pure provider-free modules express aggregate admission and
settlement-recovery intent. Unknown weight, funding, capacity or aggregate-value
policy never becomes zero. These modules authorize no financial or custody act.

## Not implemented in this slice

No merchant Route Builder screen, accepted route quote, booking, resource
reservation, payment capture, new child assignment state, common pickup
credential, multi-stop custody, stop activation or route dispatch exists here.

The database permits only `route_state = 'draft'`. Responses contain
`draftOnly: true` and `bookingAvailable: false`. Admission inspection ALWAYS
includes `route_execution_not_released`. This is not an environment-variable
blocker; execution authority has not been built yet.

Draft membership does NOT claim a child. A merchant can still submit it
separately, making the draft stale. Later booking must revalidate and claim ALL
children under locks against both standalone and route dispatch. This slice
references existing Business drafts instead of silently creating N requests.
The future builder must reuse canonical creation/quote commands with explicit
per-child idempotency before grouping them.

## Database / rollback

Migration: `20260923200000_couranr_route_run_draft_foundation.sql`.
No existing table/function/trigger is replaced; no canonical row is updated.
All four tables have RLS and no browser policies. Explicit REVOKE neutralizes
permissive defaults. Internal helpers are not executable by browser or
service-role callers; the public RPCs expose only validated draft actions.
A deferred composite FK binds the shell to its current immutable version.

The rollback refuses ANY saved draft/version/event/stop, then drops only unused
new objects. Do not delete semantic history or weaken this guard. After use,
disable the new surface, retain evidence and repair forward.

## Validation and release evidence

- `tests/couranr-route-run-foundation.test.ts`: strict inputs, aggregate safety,
  unknown funding, partial-capture recovery intent and no accidental dispatch.
- `node e2e/disposable/routeRunFoundation.mjs`: full migration replay; forward /
  empty rollback / forward; role and table ACLs; mixed tenant/payer/pickup
  refusals; CAS and idempotency; a real two-connection revision race; unchanged
  canonical rows; stale references; semantic rollback refusal.
- `.github/workflows/route-run-foundation.yml` tests the exact PR head using
  local PostgreSQL, no production credentials or paid providers.
- Standard CI checks the same exact PR head: lint, typechecks, authority fences,
  full tests and application build. Focused checks alone do not close the batch.

Record executed results at the exact commit in the PR. Authored tests are not
execution evidence. SQL tests are not browser or physical-delivery proof.

Do not merge as a claim of finished multi-stop. Apply the additive migration
before exposing the new API/UI, never to production merely for test execution.

**Observed cost-control discrepancy:** the existing `vercel.json` contains a
branch-disable configuration, yet Vercel created previews for the first three
branch heads. Verify the project/Git integration before further development
pushes. Repository configuration or skip markers are not proof that builds were
suppressed. Production has not been changed by RR-001.

## Next slices and gates

1. Resolve/reverify Help problem-report audience isolation and returned-delivery
   refund-recovery reachability before route execution.
2. Obtain owner approval for aggregate value/cargo and service-day policy. No
   aggregate declared-value ceiling is invented here; the per-child $500 cap
   does not represent route exposure.
3. Add authoritative ordered routing and immutable ACCEPTED route versions:
   shared pickup, leg evidence, service dwell, exact child quotes, budgeted
   provider calls. Reordering accepted work creates a reviewed new version.
4. Create one operational resource owner shared with ordinary dispatch. Route
   children must be structurally excluded from independent automation. Cover
   stable lock order, lease expiry, fencing, retries and manual overrides.
5. Implement durable multi-obligation settlement: all authorizations first;
   unknown outcome means reconcile only; definitive partial failure means
   governed compensation. No physical start before funding and assignment exist.
6. Add the route's long-lived assignment and truthful `route_reserved` child
   assignments. Update constraints and validators together. Child completion
   must not release route-held driver/vehicle resources.
7. Add common pickup credential, per-child evidence and per-package disposition.
   Physical custody is not atomic with SQL: record partial loading truthfully
   and block departure until all cargo is accounted for.
8. Add sequential stop execution, isolated recipient credentials/tracking/help,
   exception ownership and release only when all custody is closed. Money
   recovery remains reachable after physical completion.
9. Build merchant/driver/Operations route views over those authorities; test a
   disposable multi-actor browser journey, then a real two-stop physical pilot.

Website Tools, Consumer multi-stop, multiple pickups, mixed payers, optimization,
automatic route discounts and group tipping remain outside this V1.

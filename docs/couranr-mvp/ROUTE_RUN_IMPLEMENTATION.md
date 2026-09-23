# Business Route Runs — RR-001 implementation boundary

Base reviewed: `28e54670f6a90c2604777aa3297c493725fa6a1e` (PR #98).

## Product contract

Business-only, one common pickup, two to five separate single-destination
requests, one merchant payer, explicit ordered stops. The Route Run is an
aggregate; it must not redefine a Delivery. Existing `additional_stops = 0`,
quote identity, tenancy, PIN, proof and payment contracts remain unchanged.
No historical Route Saver or additional-stop price is revived.

## What RR-001 implements

- Strict draft input with only route ID, expected version, idempotency key,
  title and ordered child request IDs. Browser price/driver/state fields are refused.
- Route shell, immutable draft versions, ordered child references/snapshots,
  and append-only audit data. Service-role callers have SELECT, not direct DML;
  writes pass through service-role-only SECURITY DEFINER RPCs with empty search
  paths and independently checked, locked active Business membership.
- Owner/manager/dispatcher may save; other active members may read. An admin
  profile is not permission to impersonate a merchant without membership.
- Create, read and revise API at `/api/couranr/merchant/route-runs`.
- The DB independently refuses foreign/duplicate children, customer payers,
  non-draft requests, missing canonical quotes, and different pickup snapshots.
- CAS revisions and fingerprinted idempotency. Replay returns the ORIGINAL
  revision with current staleness information; it never rewrites history.
- References use the exact immutable child quote IDs. The displayed total is
  the sum of independent reference quotes, NOT a route offer or payable amount.
- Changed request/manifest/quote identities are marked stale on reads.
- Provider-free aggregate admission checks and settlement-recovery intent.
  Unknown weight, funding, capacity or aggregate-value policy never becomes zero.

## What RR-001 deliberately does NOT implement

There is no merchant Route Builder screen, route quote, route acceptance,
resource reservation, payment capture, new child assignment state, common
pickup credential, multi-stop custody, stop activation or route dispatch.

`route_state` permits only `draft`. Every response includes `draftOnly: true`
and `bookingAvailable: false`. Admission inspection ALWAYS includes
`route_execution_not_released`. This is not an environment-variable activation
switch: executable dispatch authority does not yet exist in this slice.

A child in a draft is NOT claimed. A merchant can still submit it separately.
That makes the saved route stale and prevents it from becoming implicit route
ownership. A later booking transaction must revalidate and claim ALL children
under locks, using one operational owner across standalone and route lanes.

The draft references existing Business drafts. It does not create N requests
behind a user's back. The later builder will reuse existing canonical create/
quote commands with explicit per-child idempotency, then group those drafts.

## Database invariants and rollback

Migration: `20260923200000_couranr_route_run_draft_foundation.sql`.
No existing table/function/trigger is replaced and no canonical row is updated.
The four new tables have RLS enabled with no browser policies. Explicit REVOKE
also neutralizes permissive Supabase default grants. Internal helpers are not
executable by browser or service-role callers. Public RPCs expose only the
narrow validated draft actions. Current version references its immutable
version via a deferred composite FK.

Rollback first refuses ANY saved draft/version/event/stop, then drops only this
new unused substrate. Do not weaken the semantic-use guard to make rollback
convenient. Once used, disable the new UI/API and retain history; repair forward.

## Deployment

Do not merge as a claim that multi-stop delivery is launch-ready. Apply the
reviewed additive migration before exposing its API/UI. Do not apply this
migration to production merely to test it. The disposable test runs the real
migration chain and its own fixtures; it requires no production credentials.
No Vercel preview is needed for this foundation. Current `vercel.json` already
disables branch deployments and permits only main.

## Acceptance

- `tests/couranr-route-run-foundation.test.ts`: strict inputs, aggregate safety,
  unknown funding, partial capture recovery intent, no accidental dispatch.
- `node e2e/disposable/routeRunFoundation.mjs`: full migration replay; forward /
  empty rollback / forward; actor and table ACLs; mixed tenant/payer/pickup
  refusals; CAS and idempotency; two actual database connections racing to
  revise; canonical-row preservation; stale references; semantic rollback guard.
- `.github/workflows/route-run-foundation.yml`: the disposable DB gate runs the
  exact PR head using local PostgreSQL, no cloud DB or provider credentials.
- Existing CI remains responsible for lint/typechecks/authority fences/tests/
  application build. Passing the new focused suite is not passing the whole app.

Record executed results at the exact commit in the PR; authored tests are not
proof of execution. SQL-only validation is not browser or physical proof.

## Next slices (do not bypass prerequisites)

1. Resolve/reverify the existing Help problem-report audience isolation and
   returned-delivery refund-recovery reachability findings before route execution.
2. Owner approves aggregate cargo/value and service-day limits. No route value
   ceiling was invented here. Per-child $500 remains distinct from route exposure.
3. Authoritative ordered routing and immutable ACCEPTED route versions: shared
   pickup plus leg evidence, conservative time including service dwell, exact
   child quote identities, rate-limited/cost-guarded provider calls. Reordering
   after acceptance creates a reviewed revision, never edits accepted evidence.
4. One operational resource owner shared with normal dispatch; route children
   are excluded structurally from independent automation. Stable lock order and
   reservation fencing must cover TTL expiry, retries and manual overrides.
5. Durable multi-obligation settlement saga: all children authorized first;
   unknown provider outcome => reconcile only; definitive partial failure =>
   governed compensation; no physical start before all funding/assignments exist.
6. Route-scoped long-lived assignment plus truthful per-child `route_reserved`
   assignments. Extend existing validators/constraints together, not just enums.
   Completing a child cannot release route-held resources.
7. Route pickup credential plus child-specific evidence and per-package
   disposition. Physical custody is not atomic with SQL: record verified partial
   loading honestly, and block departure until all cargo is accounted for.
8. Sequential stop execution, independent recipient credentials/tracking/help,
   exception ownership, and resource release only after custody is fully closed.
   Money recovery remains visible after physical completion.
9. Merchant builder and route/driver/Operations views over these authorities;
   disposable multi-actor browser tests; then a real two-stop physical pilot.

Website Tools, Consumer multi-stop, multiple pickups, mixed payers, optimization,
automatic route discounts and group tipping remain out of this program's V1.

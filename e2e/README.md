# Browser verification

Drives a real Chromium against a local dev server. This exists because `npm run
test`, `npm run typecheck` and `curl` all stayed green while `/sign-in` was a
placeholder, while "Sign out" was a `<Link>` that left the session live, and
while a failed workspace lookup rendered as "you have no business". A jsdom test
asserts what a component returns; only a browser proves what a person can do.

## Run it

```bash
# 1. .env.local must carry NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
#    and SUPABASE_SERVICE_ROLE_KEY. It is gitignored. chmod 600 it.
npm run dev &                 # wait for "Ready"
node e2e/seed.mjs seed        # synthetic identities; writes e2e/.state.json
node e2e/run.mjs              # the suite
node e2e/seed.mjs report      # what exists right now
node e2e/seed.mjs clean       # remove the auth users (see caveat below)
```

`--only=D,E` runs selected groups; `--headed` shows the browser.
Screenshots and `results.json` land in `e2e/artifacts/` (gitignored).

## Groups

| Group | What it proves |
|---|---|
| A | `/sign-in` and `/sign-up` are real forms; empty / invalid / unconfirmed states |
| B | signed-out visitors are bounced off `/business`, `/operations`, `/driver` |
| C | landing is resolved server-side from `profiles.role` + membership |
| D | sign-out terminates the **session**, and `/business` does not re-admit |
| E | a failed lookup is never read as "no workspace" (Commit K1) |
| F | MER-002 creates account + owner membership + workspace, asserted on **rows** |
| G | a signed-in user cannot sit on another surface |
| H | MER-005 and OPS-002 render for the right roles |
| I | the legacy header is gone from canonical surfaces, kept on legacy ones |
| J | the driver surface reads its own deliveries |
| K | the canonical logo, not a font-rendered wordmark |
| L | the three review outcomes (REV-001), end to end, asserted on rows |
| M | payment authorization on both payer paths, with Stripe mocked at both boundaries |
| N | readiness, service plan, capture, recovery from an unknown capture, and the canonical delivery |

## Rules this harness follows

**Assert on rows, not page text.** An onboarding page that created nothing still
renders and still fails to contain the word "error", so a text grep scores it
green. Every persistence claim is read back through `db.mjs`.

**Inconclusive is not a pass.** When a prerequisite never happened, the
assertion is recorded as INCONCLUSIVE and the process exits non-zero. An
assertion that passes on an empty page is worse than no test.

**Faults are injected at the browser, never in the database.** `page.route(…)`
returns a 500 for the lookup under test. Nothing is broken server-side.

**Real data is never touched.** The suite counts `orders`, `deliveries`,
`addresses` and `rentals` before and after and asserts they are identical.
Synthetic rows carry an `[E2E]` / `couranr-e2e` marker.

## Two environment facts worth knowing

**The browser cannot egress.** Chromium in this container gets
`net::ERR_CONNECTION_RESET` for every external host — `example.com` as surely as
`*.supabase.co` — direct or proxied. This is a network restriction, not a
certificate problem (that would be `ERR_CERT_*`). `supabaseRelay.mjs` therefore
intercepts the page's Supabase requests and satisfies them from Node, which can
reach Supabase over ordinary fully-verified TLS. The real bundle, the real
client, the real Supabase and the real cookie session are all exercised; what is
NOT covered is the production network path, so a CORS or origin rule that would
bite a real browser is invisible here. Never "fix" this by disabling TLS
verification or unsetting `HTTPS_PROXY`.

**The onboarding fixture is run-unique on purpose.** MER-002 is only testable
against a merchant with no workspace, and a successful run creates one.
Resetting by deletion is unavailable: `service_role` deliberately has **no
DELETE** on `couranr_merchant_workspaces` or `couranr_delivery_requests`
(append-only), and `business_accounts` is shielded by a `RESTRICT` foreign key.
Minting a fresh identity each run is cheaper than widening a deliberately narrow
grant — do not widen it.

`seed.mjs clean` therefore removes the auth users but **cannot** remove
workspaces or business accounts. Clear those through the Supabase MCP
(`execute_sql`), scoped to `name like '%[E2E]%'`.

## What group L leaves behind

Group L creates **three delivery requests per run** — one per decision path,
because each outcome is terminal — plus their events, and it cannot remove any
of them. `service_role` has `select, insert, update` on
`couranr_delivery_requests` and `select, insert` on its events: no DELETE, by
design, so that neither a bug nor a compromised command can erase merchant
history. Those rows then pin their `business_accounts` row through an
`ON DELETE RESTRICT` foreign key, which in turn pins the merchant auth user.

So a run ends with synthetic rows still in the connected project. They are all
marked (`couranr-e2e-*` emails, `[E2E]` account names) and none of them is real
merchant data, but they accumulate. Removing them needs the privileged path in
`supabase/migrations/PROPOSED_couranr_e2e_cleanup.sql.review`, which is **not
applied** and must not be applied without review.

`CLEAN-residue` fails for exactly this reason. It is reported as its own
assertion rather than folded into the others so it can never be mistaken for
"everything was cleaned up".

**Do not widen the grant to make this go away.** A DELETE grant on the request
tables would remove the guarantee those tables exist to provide.

Groups M and N add to the same residue: each leaves a payment obligation, and N
additionally leaves a service plan and a canonical delivery. Same reason, same
answer — none of those tables grants DELETE either, and `CLEAN-behaviour` fails
alongside `CLEAN-residue` because the surviving request rows pin
`business_accounts` through `ON DELETE RESTRICT`.

## What group N mocks, and what it therefore does not prove

Group N drives capture against the same local double as group M, extended with
`POST /v1/payment_intents/:id/capture` and a fault injector. The injected fault
is a **500 with `stripe-should-retry: false`** — the shape that makes Couranr
treat the outcome as INDEFINITE, which is the only way to reach the
`capture_pending` recovery path at all. The double honours idempotency keys on
capture the way Stripe does, so "a retry does not charge twice" is asserted
against replay behaviour rather than assumed.

`PAYMENT_REAL_STRIPE_VERIFICATION = PENDING_PRELAUNCH`. Nothing in group N
proves Stripe accepts these requests, only that Couranr builds them correctly
and reacts correctly to each response.

## Database-level verification

`supabase/verification/terminal_capture_resolution.sql` is a re-runnable,
read-only proof of the money guarantees that live in PL/pgSQL and in CHECK
constraints rather than in TypeScript — the ones green unit tests never touch.

It asserts: `service_role`-only EXECUTE on the terminal-resolution command
(via `has_function_privilege`, because `pg_default_acl` makes a bare GRANT a
silent no-op and grantee rows miss privileges inherited through `PUBLIC`); that
both stamp constraints are one-directional rather than biconditional; that
every non-terminal PaymentIntent status is refused with CR422; that a mismatched
intent, amount or currency is rejected; that the authorization webhook refuses a
`capture_pending` obligation; and that the obligation idempotency key carries
its generation.

Every probe is expected to REFUSE, and the last section proves nothing was
written. Each result row carries an `ok` column — all must be true.

It exists because these checks were originally run ad hoc and read out of a
chat transcript, which is not verification anyone can repeat.

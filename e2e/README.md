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

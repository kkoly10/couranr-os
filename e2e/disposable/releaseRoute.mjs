/**
 * ACP-032 release — the ROUTE, unstubbed, end to end.
 *
 * `releaseAuthorization.mjs` calls the two SQL commands directly and proves the
 * database half. This proves the OTHER half: that a real HTTP request, carrying
 * a real bearer token, through a real Next server, reaches those commands and
 * cancels a real (doubled) PaymentIntent — and that the gates hold at the
 * route, which is a different place from where the SQL gate lives.
 *
 * That distinction is not academic here. This codebase has already shipped a
 * case where the route's capability was one role narrower than the SQL's, so
 * one of the two was dead. Testing the SQL alone would not have found it.
 *
 * WHAT THIS DOES NOT PROVE. The Stripe half runs against `e2e/stripeDouble.mjs`
 * through the `STRIPE_API_BASE` seam. It proves the request Couranr builds is
 * well formed and that Couranr handles the documented responses. It proves
 * NOTHING about Stripe accepting it. That closes only with test-mode keys.
 *
 *   E1   an anonymous caller is refused
 *   E2   a merchant owner is refused — the route gate, not the SQL gate
 *   E3   ... and the obligation is untouched after both refusals
 *   E4   a missing reason is refused
 *   E5   an oversized reason is refused
 *   E6   Operations releases the hold — 200
 *   E7   ... the DOUBLE actually received POST /v1/payment_intents/{id}/cancel
 *   E8   ... the intent at the double is now `canceled`
 *   E9   ... the obligation is `cancelled` with cancelled_at set
 *   E10  ... and both release events were appended
 *   E11  a replay returns 200 and does NOT call Stripe a second time
 *   E12  a captured hold cannot be released — the double would refuse it too
 *   E13  no database detail leaks into any response body
 *
 * Run:  node e2e/disposable/releaseRoute.mjs
 */

import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { up, down, psql, dbUrl } from "./up.mjs";
import {
  startPostgrest,
  startGateway,
  waitForPostgrest,
  SERVICE_ROLE_JWT,
  ANON_JWT,
} from "./gateway.mjs";
import { startStripeDouble } from "../stripeDouble.mjs";
import { claimDevDistDir } from "../devDistDir.mjs";
import {
  gateAIntegrityIssues,
  psqlTransport,
  seedCanonicalDeliveryChain,
} from "./gateAFixtures.mjs";
import { postgrestTarget } from "../../scripts/provisionPostgrest.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// Resolved by scripts/provisionPostgrest.mjs, never a session scratchpad.
// The previous default was a path inside ONE container's ephemeral
// scratchpad, so this harness aborted on every other machine — after
// applying 50 migrations, which made a missing dependency look like a
// database failure. `npm run provision:postgrest` puts it on PATH.
const PGRST_BIN = postgrestTarget();

const PORT = 3319;
const STRIPE_PORT = 3320;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "disposable-release-1";
const APP_LOG = "/tmp/claude-0/-home-user-couranr-os/3ba65fdb-c110-5366-92d6-85568b408343/scratchpad/relroute-app.log";
const devDist = claimDevDistDir("release-route");

let passed = 0;
let failed = 0;
const check = (id, d, ok, detail = "") => {
  ok ? passed++ : failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${d}${detail ? `  [${detail}]` : ""}`);
};

const one = (sql) => psql(sql).trim();
const esc = (s) => String(s).replace(/'/g, "''");

async function main() {
  console.log("ACP-032 — release a hold, through the real route, unstubbed\n");

  let pgrst;
  let gateway;
  let appServer;
  let stripe;

  try {
    console.log("  bringing up the disposable database...");
    const info = up({ quiet: true });
    console.log(`  ${info.migrationsApplied} migrations applied`);

    pgrst = await startPostgrest({
      dbUrl: dbUrl(),
      binary: PGRST_BIN,
      workDir: "/var/lib/postgresql/couranr-disposable/pgrst",
    });
    if (!(await waitForPostgrest())) throw new Error("PostgREST did not start");
    gateway = await startGateway();

    stripe = await startStripeDouble(STRIPE_PORT);
    const stripeBase = `http://127.0.0.1:${STRIPE_PORT}`;
    console.log(`  stripe double at ${stripeBase}`);

    const env = {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: gateway.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_JWT,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_JWT,
      STRIPE_SECRET_KEY: "sk_test_disposable",
      STRIPE_API_BASE: stripeBase,
      PORT: String(PORT),
      /*
       * DEVELOPMENT, not production, and that is forced on us by a SAFETY
       * FEATURE rather than by convenience.
       *
       * lib/stripeClient.ts:apiBaseOverride() refuses STRIPE_API_BASE outright
       * when NODE_ENV === "production", so that a misconfigured env var can
       * never redirect live payment traffic. Every other disposable harness
       * runs production because none of them touch Stripe; this one must not,
       * or the SDK talks to api.stripe.com, the container cannot reach it, and
       * the failure looks like a bug in the release code.
       *
       * Running dev also removes the build step: this harness drives API routes
       * over fetch and never loads a client bundle, so nothing here depends on
       * NEXT_PUBLIC_* being inlined at build time.
       */
      NODE_ENV: "development",
    };

    console.log("  starting the application (dev, so the Stripe seam engages)...");
    const appLog = openSync(APP_LOG, "w");
    appServer = spawn("npx", ["next", "dev", "-p", String(PORT)], {
      cwd: ROOT,
      // COURANR_DIST_DIR keeps `next dev`'s generated route types out of the
      // developer's `.next`. This server is killed with SIGKILL below, which
      // lands mid-write on `dev/types/validator.ts`, and tsconfig type-checks
      // `.next/dev/types` — so without this the next `npm run typecheck` fails
      // on a truncated file nobody edited. See e2e/devDistDir.mjs.
      env: { ...env, COURANR_DIST_DIR: devDist.rel },
      stdio: ["ignore", appLog, appLog],
      detached: true,
    });
    const deadline = Date.now() + 120_000;
    let live = false;
    while (Date.now() < deadline && !live) {
      try {
        live = (await fetch(BASE, { redirect: "manual" })).status < 500;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (!live) throw new Error("the application did not start");

    /* ---------------------------------------------------------- fixture */

    function actor(email, role) {
      const id = one(`insert into auth.users (email) values ('${esc(email)}') returning id`);
      psql(
        `insert into public.profiles (id, email, role)
         values ('${id}', '${esc(email)}', '${role}')
         on conflict (id) do update set role = excluded.role`,
      );
      // The disposable stack ships its own helper for this; hand-rolling a
      // bcrypt update here would drift from whatever the gateway expects.
      psql(`select public.couranr_disposable_set_password('${id}', '${esc(PASSWORD)}')`);
      return id;
    }

    const tag = crypto.randomUUID().slice(0, 8);
    const businessId = one(
      `insert into public.business_accounts (name, slug, status)
       values ('Release Route Co', 'rel-route-${tag}', 'active') returning id`,
    );
    const opsEmail = `ops+${tag}@e2e.couranr.test`;
    const merEmail = `mer+${tag}@e2e.couranr.test`;
    const opsId = actor(opsEmail, "admin");
    const merId = actor(merEmail, "merchant");
    psql(
      `insert into public.business_members (business_account_id, user_id, role, status, joined_at)
       values ('${businessId}', '${merId}', 'owner', 'active', now())`,
    );

    /**
     * Create a request + obligation, and a matching intent AT THE DOUBLE.
     *
     * The request and obligation come from the shared Gate A fixture builder
     * (e2e/disposable/gateAFixtures.mjs) rather than from two hand-written
     * INSERTs. The hand-written pair predates the immutable-quote cutover: it
     * wrote quote_status='estimated' with no current_quote_version_id and an
     * obligation with no quote_version_id, which the current invariants refuse
     * — so this whole suite died in setup before reaching E1.
     *
     * The STRIPE half is unchanged. The double still mints the real intent and
     * the fixture still binds the obligation to that exact id, because E7/E8
     * assert on what the double received.
     */
    const CHAIN_STOP_FOR_STATE = { authorized: "obligation", capture_pending: "capture_pending", captured: "delivery" };

    async function seed(state) {
      // Make the double hold a real intent, so cancel has something to act on.
      const created = await fetch(`${stripeBase}/v1/payment_intents`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          amount: "2299",
          currency: "usd",
          capture_method: "manual",
        }).toString(),
      });
      const intent = await created.json();
      if (state === "captured") {
        await fetch(`${stripeBase}/v1/payment_intents/${intent.id}/capture`, { method: "POST" });
      }
      const stopAfter = CHAIN_STOP_FOR_STATE[state];
      if (!stopAfter) throw new Error(`seed: unsupported state ${state}`);
      const chain = await seedCanonicalDeliveryChain(psqlTransport(psql), {
        businessId,
        actorUserId: merId,
        marker: `rel-${crypto.randomUUID().slice(0, 8)}`,
        recipientName: "Route Fixture",
        stopAfter,
        intentId: intent.id,
      });
      return { requestId: chain.requestId, obligationId: chain.obligationId, intentId: intent.id };
    }

    /**
     * B3-I §5 — the LEGITIMATE technical-release scenario: an authorized hold
     * on a request that is NOT confirmed (a stale quote hold — a requote left
     * the old authorization behind). The governed-cancellation escape guard
     * forbids a generic release of a CONFIRMED authorized hold, so the
     * whole-chain fixture (always confirmed) is the WRONG shape for the happy
     * path. Build confirmed+authorized (the only path the obligation command
     * accepts to reach `authorized`) and then move the request to
     * `quote_revision_required` — a non-confirmed payable state where release
     * is genuinely the recovery operation and the hold is now stale.
     */
    async function seedAuthorizedHold() {
      const hold = await seed("authorized"); // chain => confirmed + authorized
      psql(
        `update public.couranr_delivery_requests
            set request_state='quote_revision_required'
          where id='${hold.requestId}'::uuid`,
      );
      return hold;
    }

    async function tokenFor(email) {
      const r = await fetch(`${gateway.url}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { "content-type": "application/json", apikey: ANON_JWT },
        body: JSON.stringify({ email, password: PASSWORD }),
      });
      if (!r.ok) throw new Error(`token for ${email}: ${r.status}`);
      return (await r.json()).access_token;
    }

    async function release(email, requestId, body) {
      const headers = { "content-type": "application/json" };
      if (email) headers.authorization = `Bearer ${await tokenFor(email)}`;
      const r = await fetch(
        `${BASE}/api/couranr/operations/delivery-requests/${requestId}/release`,
        { method: "POST", headers, body: JSON.stringify(body) },
      );
      let json = null;
      try {
        json = await r.json();
      } catch {
        /* no body */
      }
      return { status: r.status, body: json, raw: JSON.stringify(json ?? {}) };
    }

    const bodies = [];
    const stripeCalls = () => stripe.calls.map((c) => `${c.method} ${c.path}`);

    /* ------------------------------------------------------------ gates */

    // The happy-path release fixture is a NON-confirmed authorized hold — the
    // stale/rejected/recovery case §5 keeps release available for.
    const a = await seedAuthorizedHold();

    const anon = await release(null, a.requestId, { reason: "x" });
    bodies.push(anon.raw);
    check("E1", "an anonymous caller is refused", anon.status === 401 || anon.status === 403, `${anon.status}`);

    const asMerchant = await release(merEmail, a.requestId, { reason: "let me out" });
    bodies.push(asMerchant.raw);
    check("E2", "a merchant owner is refused at the ROUTE", asMerchant.status === 403, `${asMerchant.status}`);

    check(
      "E3", "... and the obligation is untouched",
      one(`select payment_state from public.couranr_payment_obligations where id='${a.obligationId}'`) ===
        "authorized",
    );

    const noReason = await release(opsEmail, a.requestId, {});
    bodies.push(noReason.raw);
    check("E4", "a missing reason is refused", noReason.status === 400, `${noReason.status}`);

    const longReason = await release(opsEmail, a.requestId, { reason: "z".repeat(501) });
    bodies.push(longReason.raw);
    check("E5", "an oversized reason is refused", longReason.status === 400, `${longReason.status}`);

    check(
      "E5b", "no Stripe call was made by any refusal",
      !stripeCalls().some((c) => c.includes("/cancel")),
      stripeCalls().filter((c) => c.includes("cancel")).join(",") || "none",
    );

    /* ---------------------------------------------------------- release */

    const ok = await release(opsEmail, a.requestId, { reason: "customer cancelled before pickup" });
    bodies.push(ok.raw);
    check("E6", "Operations releases the hold", ok.status === 200, `${ok.status} ${ok.raw.slice(0, 80)}`);
    check(
      "E7", "the DOUBLE received the cancel call",
      stripeCalls().includes(`POST /v1/payment_intents/${a.intentId}/cancel`),
    );
    {
      const r = await fetch(`${stripeBase}/v1/payment_intents/${a.intentId}`);
      const pi = await r.json();
      check("E8", "the intent at the double is canceled", pi.status === "canceled", pi.status);
      // The field that says whether money is still held. Real Stripe zeroes it
      // on cancel; the double did not, until an adversarial review measured it.
      check("E8b", "... and NOTHING remains capturable", pi.amount_capturable === 0,
        `amount_capturable=${pi.amount_capturable}`);
    }
    check(
      "E9", "the obligation is cancelled with cancelled_at set",
      one(`select (payment_state='cancelled' and cancelled_at is not null)
             from public.couranr_payment_obligations where id='${a.obligationId}'`) === "t",
    );
    check(
      "E10", "both release events were appended",
      one(`select count(*) from public.couranr_payment_events
            where obligation_id='${a.obligationId}'
              and event_type in ('couranr.release.begun','couranr.release.completed')`) === "2",
    );

    const before = stripeCalls().filter((c) => c.includes("/cancel")).length;
    const replay = await release(opsEmail, a.requestId, { reason: "again" });
    bodies.push(replay.raw);
    const after = stripeCalls().filter((c) => c.includes("/cancel")).length;
    check("E11", "a replay is accepted and calls Stripe no second time",
      replay.status === 200 && after === before, `${replay.status}, cancels ${before}->${after}`);

    /* ----------------------------------- §5: confirmed hold is refused */

    // A CONFIRMED + authorized hold is NOT generically releasable — the
    // governed action is Cancel with the $8 receivable. The chain fixture is
    // confirmed, so it is exactly this forbidden shape.
    const confirmedHold = await seed("authorized");
    const beforeConf = stripeCalls().filter((c) => c.includes("/cancel")).length;
    const confRel = await release(opsEmail, confirmedHold.requestId, {
      reason: "trying to release a confirmed active hold",
    });
    bodies.push(confRel.raw);
    check("E6z", "a CONFIRMED + authorized hold is refused at the route (§5 CAN-001 escape)",
      confRel.status === 409, `${confRel.status} ${confRel.raw.slice(0, 80)}`);
    check("E6z2", "... and the obligation is untouched",
      one(`select payment_state from public.couranr_payment_obligations where id='${confirmedHold.obligationId}'`) ===
        "authorized");
    check("E6z3", "... and NO Stripe cancel was made for it",
      stripeCalls().filter((c) => c.includes("/cancel")).length === beforeConf,
      `cancels ${beforeConf}->${stripeCalls().filter((c) => c.includes("/cancel")).length}`);

    /* ------------------------------------------------- captured refuses */

    const cap = await seed("captured");
    const capRes = await release(opsEmail, cap.requestId, { reason: "too late" });
    bodies.push(capRes.raw);
    check("E12", "a captured hold cannot be released", capRes.status >= 400, `${capRes.status}`);

    /* ------------------------------------------------------- no leakage */

    const forbidden = [
      /couranr_[a-z_]+\(/i, /SQLSTATE/i, /CR4\d\d/, /pg_/i, /relation ".*" does not exist/i,
      /sk_test/, /supabase/i, /postgres/i,
    ];
    const leaks = bodies.filter((b) => forbidden.some((f) => f.test(b)));
    check("E13", "no database or provider detail leaks into a response", leaks.length === 0,
      leaks[0]?.slice(0, 120) ?? "clean");

    /* ----------------------------------------------- the fixtures are legal */

    const issues = await gateAIntegrityIssues(psqlTransport(psql));
    check("E14", "couranr_foundation_integrity() reports NO issue for the seeded fixtures",
      issues.length === 0, issues.join(",") || "clean");

    console.log(`\n  ${passed} passed, ${failed} failed\n`);
  } finally {
    try { if (appServer?.pid) process.kill(-appServer.pid, "SIGKILL"); } catch { /* gone */ }
    devDist.cleanup();
    try { stripe?.server?.close(); } catch { /* gone */ }
    try { gateway?.server?.close(); } catch { /* gone */ }
    try { pgrst?.kill?.("SIGKILL"); } catch { /* gone */ }
    down({ quiet: true });
  }
  process.exit(failed === 0 ? 0 : 1);
}

main();

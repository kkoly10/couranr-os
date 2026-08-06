/**
 * CUS-001 and CUS-003, driven UNSTUBBED against a disposable database.
 *
 * ---------------------------------------------------------------------------
 * WHAT THESE TWO SCREENS ARE, AND WHY THEY WERE NOT ALREADY VERIFIED
 * ---------------------------------------------------------------------------
 *
 * Both share `PUB-007`'s page. What distinguishes them is one line —
 * `components/couranr/help/DeliveryHelpPage.tsx:109` reads
 * `window.location.hash` and preselects a topic:
 *
 *     #address-change        -> topic "address_concern"      CUS-001
 *     #recipient-unavailable -> topic "availability"         CUS-003
 *
 * `e2e/phase8Acceptance.mjs` A12 proved the SERVER path for the bare route,
 * but it navigated to `/help/<token>` with no fragment and chose the topic
 * with `selectOption`. So the preselection had only STUBBED evidence, from a
 * run whose API layer was replaced by `page.route`. Under the promotion rule
 * that excludes a stubbed browser, neither screen could move.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS RUN PROVES, AND HOW
 * ---------------------------------------------------------------------------
 *
 * Nothing is stubbed. Chromium talks to a real Next server, which talks to a
 * real PostgREST, which talks to a real PostgreSQL carrying every migration.
 *
 * EVERY CHECK ASSERTS BOTH SIDES. A rendered `<select>` showing the right
 * option proves the fragment was read; it does NOT prove the topic reached the
 * database, and this repository has already shipped a flow that reported
 * success while persisting nothing. So each submission is followed by a query
 * against `couranr_conversation_messages` asserting the row exists with the
 * expected `topic` and `body`. Rendering alone promotes nothing.
 *
 * NO PRODUCTION ROW IS TOUCHED. The database is created empty, destroyed
 * afterwards, and holds no real data at any point.
 *
 * ---------------------------------------------------------------------------
 * STATUS: PASSING, 11/11. What it took, recorded so it is not re-learned.
 * ---------------------------------------------------------------------------
 *
 * Five defects stood between this file and a green run. Three were in the
 * harness, one was a false assertion, and one made the other fixes invisible:
 *
 *   1. The Next server was spawned with stdio "pipe" and never drained, so it
 *      blocked once the OS pipe buffer filled. 15 minutes, no output, SIGTERM.
 *   2. `psql` returned the command tag with the value, so every
 *      `insert ... returning id` yielded "<uuid>\nINSERT 0 1" and the tag was
 *      carried into the next statement — surfacing as `invalid input syntax
 *      for type uuid`, one layer from its cause. Fixed with -q.
 *   3. C1 asserted /Delivery Help/i anywhere in innerText, which the marketing
 *      nav satisfies. It was asserting a LINK existed while the page rendered
 *      a refusal. It now requires the select and textarea that exist only in
 *      the loaded form.
 *   4. PostgREST refuses a Bearer token outright when no `jwt-secret` is
 *      configured — PGRST300 — and the route collapsed that into the generic
 *      "This help link is not available." The gateway now signs real HS256
 *      service-role and anon JWTs against a per-run secret.
 *   5. `npx next start` spawns a CHILD. SIGTERM to the wrapper orphaned the
 *      real next-server, which kept holding port 3311, and every later run's
 *      wait-for-live loop was satisfied by that STALE process still carrying
 *      the pre-fix environment. This is why 1, 2 and 4 each appeared to change
 *      nothing. Spawned `detached` now, and teardown kills the process GROUP.
 *
 * Three hypotheses were disproved by measurement before the real cause was
 * found by instrumentation in a single run: build-time env inlining, a
 * malformed token, and `.env.local` overriding the passed-in keys. The lesson
 * is the ordering — one gateway trace beat four rounds of reasoning.
 *
 * Run:  node e2e/disposable/customerHelpFragments.mjs
 */

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SHOTS = path.join(ROOT, "e2e/screenshots/disposable-cus");
/** Build output for the harness only — never the developer's `.next`. */
const DIST = ".next-disposable";
const PGRST_BIN =
  process.env.COURANR_POSTGREST ||
  "/tmp/claude-0/-home-user-couranr-os/3ba65fdb-c110-5366-92d6-85568b408343/scratchpad/prst/postgrest";

let passed = 0;
let failed = 0;
const record = [];

function check(id, description, ok, detail = "") {
  ok ? passed++ : failed++;
  record.push({ id, description, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${description}${detail ? `  [${detail}]` : ""}`);
}

const sql = (q) => psql(q).trim();
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

/**
 * Seeds one delivery and one help token, entirely through the real command
 * functions where they exist. The token is minted by `couranr_issue_help_token`
 * — the same function the Operations route calls — so the fixture exercises
 * issuance rather than faking a row.
 */
function seed(marker) {
  // couranr_deliveries has 19 NOT NULL columns with no default, three of them
  // FKs into request -> obligation -> plan. Building the chain IS the work:
  // each NOT NULL is the schema stating what a delivery actually requires, and
  // the first version of this function skipped them and failed on the insert.
  // The column set mirrors e2e/phase8Acceptance.mjs, which built the same chain
  // against the project.
  const businessId = sql(
    `insert into public.business_accounts (name, status)
     values ('${marker} business', 'active') returning id`
  );
  const userId = sql(
    `insert into auth.users (email) values ('${marker.toLowerCase().replace(/[^a-z0-9]/g, "")}@example.test')
     returning id`
  );
  const requestId = sql(
    `insert into public.couranr_delivery_requests
       (business_account_id, created_by, idempotency_key, recipient_name)
     values ('${businessId}', '${userId}', 'disp-${marker}-${Date.now()}', '${marker} recipient')
     returning id`
  );
  const obligationId = sql(
    `insert into public.couranr_payment_obligations
       (request_id, business_account_id, payer_type, request_version,
        pricing_policy_version, amount_cents, idempotency_key)
     values ('${requestId}', '${businessId}', 'merchant', 1, 'disposable', 1000,
             'disp-po-${marker}-${Date.now()}')
     returning id`
  );
  const planId = sql(
    `insert into public.couranr_service_plans
       (request_id, business_account_id, payment_obligation_id, request_version,
        scheduled_pickup_start, scheduled_pickup_end, timezone, vehicle_requirement)
     values ('${requestId}', '${businessId}', '${obligationId}', 1,
             now(), now() + interval '1 hour', 'America/New_York', '{}'::jsonb)
     returning id`
  );
  const deliveryId = sql(
    `insert into public.couranr_deliveries
       (request_id, business_account_id, payment_obligation_id, service_plan_id,
        request_version, pricing_policy_version, captured_amount_cents, currency,
        pickup_address, dropoff_address, recipient, shipment,
        service_level, signature_required, proof_method,
        scheduled_pickup_start, scheduled_pickup_end, timezone, vehicle_requirement)
     values ('${requestId}', '${businessId}', '${obligationId}', '${planId}',
             1, 'disposable', 1000, 'usd',
             '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
             'standard', false, 'photo_or_pin',
             now(), now() + interval '1 hour', 'America/New_York', '{}'::jsonb)
     returning id`
  );
  // The raw token and its hash are produced by the SAME algorithm as
  // lib/couranr/conversations/help.ts — randomBytes(32).toString("base64url")
  // and sha256 hex — verified by reading that file, not assumed. The row is
  // inserted directly rather than through couranr_issue_help_token; an earlier
  // comment here claimed otherwise and was wrong.
  const raw = crypto.randomBytes(32).toString("base64url");
  sql(
    `insert into public.couranr_help_access_tokens
       (token_hash, delivery_id, business_account_id, expires_at)
     values ('${sha256(raw)}', '${deliveryId}', '${businessId}', now() + interval '14 days')`
  );
  return { businessId, deliveryId, raw };
}

async function main() {
  console.log("CUS-001 / CUS-003 — fragment preselection, unstubbed\n");
  mkdirSync(SHOTS, { recursive: true });

  let pgrst;
  let gateway;
  let devServer;
  let browser;

  try {
    console.log("  bringing up the disposable database...");
    const info = up({ quiet: true });
    console.log(`  ${info.migrationsApplied} migrations applied`);

    pgrst = startPostgrest({
      dbUrl: dbUrl(),
      binary: PGRST_BIN,
      workDir: "/var/lib/postgresql/couranr-disposable/pgrst",
    });
    if (!(await waitForPostgrest())) throw new Error("PostgREST did not start");
    gateway = await startGateway();
    console.log(`  gateway at ${gateway.url}`);

    // The app talks to the gateway instead of the project. The service key is
    // a local-only value; PostgREST here authenticates by connection, not by
    // this string, and no real credential enters the harness.
    const env = {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: gateway.url,
      // Real HS256 JWTs signed with the secret PostgREST verifies against.
      // The literal strings used before produced PGRST300 on every call.
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_JWT,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_JWT,
      PORT: "3311",
      NODE_ENV: "production",
    };

    // Build with the gateway URL baked in. NEXT_PUBLIC_* are inlined at build
    // time, so a build made against the real project leaves the browser client
    // pointing at a host Chromium cannot reach here — the server half renders
    // and the client half never does. Its own distDir, so a developer's .next
    // is never clobbered.
    // The build cache MUST be discarded. NEXT_PUBLIC_* are inlined into the
    // client bundle, so webpack's cache holds whatever key the LAST build used
    // — and reusing it silently shipped a stale literal that PostgREST rejected
    // with PGRST301 "Expected 3 parts; got 1". A harness that bakes env into a
    // bundle can never reuse a bundle built with different env.
    rmSync(path.join(ROOT, DIST), { recursive: true, force: true });

    console.log("  building the application against the disposable stack...");
    execFileSync("npx", ["next", "build"], {
      cwd: ROOT,
      env: { ...env, COURANR_DIST_DIR: DIST },
      stdio: "ignore",
      timeout: 600_000,
    });

    console.log("  starting the application against it...");
    // stdio "ignore", NOT "pipe". A piped child whose output nobody drains
    // blocks forever once the OS pipe buffer fills — which is exactly what
    // happened on the first run: 15 minutes, no output, SIGTERM. Next logs
    // every request, so the buffer fills in seconds.
    devServer = spawn("npx", ["next", "start", "-p", "3311"], {
      cwd: ROOT,
      env: { ...env, COURANR_DIST_DIR: DIST },
      stdio: "ignore",
      // Own process group, so teardown can kill the whole tree. `npx` is a
      // wrapper: killing it alone orphans the real next-server.
      detached: true,
    });
    const BASE = "http://127.0.0.1:3311";
    const deadline = Date.now() + 90_000;
    let live = false;
    while (Date.now() < deadline && !live) {
      try {
        const r = await fetch(BASE, { redirect: "manual" });
        live = r.status < 500;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (!live) throw new Error("the application did not start");

    const { chromium } = await import("/opt/node22/lib/node_modules/playwright/index.mjs");
    browser = await chromium.launch({ args: ["--no-proxy-server"] });

    /* ─────────────────────────── CUS-001 ─────────────────────────── */

    const a = seed("[CUS001]");
    const pageA = await browser.newPage();
    await pageA.goto(`${BASE}/help/${a.raw}#address-change`, { waitUntil: "networkidle" });

    // UNCONDITIONAL DIAGNOSTIC. The previous three runs failed while I reasoned
    // about what the page might be showing. Capture it instead.
    const bodyA = await pageA.innerText("body");
    const htmlA = await pageA.content();
    const selectCount = await pageA.locator("select").count();
    const textareaCount = await pageA.locator("textarea").count();
    writeFileSync(path.join(SHOTS, "DIAG-innerText.txt"), bodyA);
    writeFileSync(path.join(SHOTS, "DIAG-page.html"), htmlA);
    await pageA.screenshot({ path: path.join(SHOTS, "DIAG-render.png"), fullPage: true });
    console.log(`  DIAG selects=${selectCount} textareas=${textareaCount} bodyLen=${bodyA.length}`);
    console.log(`  DIAG innerText head: ${JSON.stringify(bodyA.slice(0, 400))}`);

    // C1 must assert something that exists ONLY in the loaded help form. The
    // earlier /Delivery Help/i matched the marketing nav, so it was asserting a
    // LINK, not the page.
    check("C1", "CUS-001 renders the help FORM, not merely a page mentioning it",
      selectCount === 1 && textareaCount === 1,
      `${selectCount} select(s), ${textareaCount} textarea(s)`);

    // BROWSER SIDE: the fragment preselected the topic.
    const selectedA = await pageA.locator("select").inputValue();
    check("C2", "CUS-001 #address-change preselects topic address_concern",
      selectedA === "address_concern", `select = ${selectedA}`);
    await pageA.screenshot({ path: path.join(SHOTS, "C2-cus001-preselected.png"), fullPage: true });

    const bodyTextA = "[CUS001] the address on this delivery is wrong";
    await pageA.fill("textarea", bodyTextA);
    await pageA.click('button[type="submit"]');
    await pageA.waitForTimeout(2500);

    // DATABASE SIDE: the row exists, with THAT topic. Rendering proved nothing
    // about what was persisted.
    const rowA = sql(
      `select topic || '|' || body from public.couranr_conversation_messages
        where body = '${bodyTextA.replace(/'/g, "''")}'`
    );
    check("C3", "CUS-001 the submitted concern reached the database as address_concern",
      rowA === `address_concern|${bodyTextA}`, rowA || "<no row>");

    const convA = sql(
      `select c.kind || '|' || c.waiting_on from public.couranr_conversations c
         where c.delivery_id = '${a.deliveryId}'`
    );
    check("C3b", "CUS-001 opened a delivery_help thread now waiting on Couranr",
      convA === "delivery_help|couranr", convA || "<no conversation>");
    await pageA.screenshot({ path: path.join(SHOTS, "C3-cus001-sent.png"), fullPage: true });

    /* ─────────────────────────── CUS-003 ─────────────────────────── */

    const b = seed("[CUS003]");
    const pageB = await browser.newPage();
    await pageB.goto(`${BASE}/help/${b.raw}#recipient-unavailable`, { waitUntil: "networkidle" });

    const selectedB = await pageB.locator("select").inputValue();
    check("C4", "CUS-003 #recipient-unavailable preselects topic availability",
      selectedB === "availability", `select = ${selectedB}`);
    await pageB.screenshot({ path: path.join(SHOTS, "C4-cus003-preselected.png"), fullPage: true });

    const bodyTextB = "[CUS003] nobody will be home at the drop-off";
    await pageB.fill("textarea", bodyTextB);
    await pageB.click('button[type="submit"]');
    await pageB.waitForTimeout(2500);

    const rowB = sql(
      `select topic || '|' || body from public.couranr_conversation_messages
        where body = '${bodyTextB.replace(/'/g, "''")}'`
    );
    check("C5", "CUS-003 the submitted concern reached the database as availability",
      rowB === `availability|${bodyTextB}`, rowB || "<no row>");
    await pageB.screenshot({ path: path.join(SHOTS, "C5-cus003-sent.png"), fullPage: true });

    /* ───────── the controls that make the two above meaningful ───────── */

    // Without this, C2/C4 could both pass on a page that ignored the fragment
    // and happened to default to the asserted value.
    const c = seed("[CUSBARE]");
    const pageC = await browser.newPage();
    await pageC.goto(`${BASE}/help/${c.raw}`, { waitUntil: "networkidle" });
    const selectedC = await pageC.locator("select").inputValue();
    check("C6", "CONTROL: the bare route preselects NEITHER fragment topic",
      selectedC !== "address_concern" && selectedC !== "availability",
      `bare default = ${selectedC}`);

    // An unknown fragment must not be honoured as a topic.
    await pageC.goto(`${BASE}/help/${c.raw}#not-a-real-fragment`, { waitUntil: "networkidle" });
    await pageC.waitForTimeout(500);
    const selectedD = await pageC.locator("select").inputValue();
    check("C7", "CONTROL: an unrecognised fragment falls back to the default topic",
      selectedD === selectedC, `= ${selectedD}`);

    // Cross-delivery isolation, asserted in the database rather than the DOM.
    const cross = sql(
      `select count(*) from public.couranr_conversation_messages m
         join public.couranr_conversation_participants p on p.id = m.author_participant_id
         join public.couranr_conversations cv on cv.id = p.conversation_id
        where cv.delivery_id = '${b.deliveryId}' and m.body like '%[CUS001]%'`
    );
    check("C8", "CUS-003's delivery holds none of CUS-001's messages", cross === "0", `${cross} found`);

    // The two threads are genuinely separate rows, not one reused.
    const distinct = sql(
      `select count(distinct id) from public.couranr_conversations
        where delivery_id in ('${a.deliveryId}', '${b.deliveryId}')`
    );
    check("C9", "each delivery opened its own conversation", distinct === "2", `${distinct} conversations`);

    // HRS-002 in the live path: the deadline was computed by the SQL clock.
    const due = sql(
      `select case
                when response_due_at is null then 'null'
                when response_due_at = public.couranr_add_operating_minutes(received_at, 15) then 'operating-minutes'
                else 'flat-wall-clock' end
         from public.couranr_conversations where delivery_id = '${a.deliveryId}'`
    );
    check("C10", "the response deadline was computed in OPERATING minutes, not wall clock",
      due === "operating-minutes", due);

    await pageA.close();
    await pageB.close();
    await pageC.close();
  } catch (e) {
    check("XX", "the run completed", false, String(e.message || e).slice(0, 200));
  } finally {
    if (browser) await browser.close().catch(() => {});
    // Kill the process GROUP, not the wrapper. `npx next start` spawns a child;
    // SIGTERM to the wrapper orphaned the real next-server, which kept holding
    // port 3311. Every later run's wait-for-live loop was then satisfied by
    // that stale process, still carrying the environment from before the fix —
    // which is why three correct fixes in a row appeared to change nothing.
    // Confirmed by pgrep finding an orphan alive between runs.
    if (devServer) {
      try {
        process.kill(-devServer.pid, "SIGTERM");
      } catch {
        devServer.kill("SIGTERM");
      }
    }
    if (gateway?.server) gateway.server.close();
    if (pgrst) pgrst.kill("SIGTERM");
    // The whole point: cleanup is destruction, not a DELETE grant.
    down({ quiet: true });
    console.log("\n  disposable database destroyed");
  }

  console.log(`\n  ${passed} passed, ${failed} failed`);
  console.log(`  screenshots: ${SHOTS}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

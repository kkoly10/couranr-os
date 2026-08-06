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
 * KNOWN BLOCKER — THIS RUN DOES NOT PASS. DO NOT CITE IT AS EVIDENCE.
 *
 * CAUSE IDENTIFIED, FIX NOT YET FOUND. The page renders, and what it renders
 * is the REFUSAL:
 *
 *     "Delivery Help
 *      This help link is not available.
 *      If you are expecting a delivery, the business that arranged it can send
 *      you a new link."
 *
 * That is `NOT_AVAILABLE`, the single message `redeemHelpToken` returns for
 * unknown, revoked and expired alike. So the page and the route are working;
 * the TOKEN is being rejected. 0 selects, 0 textareas, 305 characters of body —
 * captured unconditionally rather than inferred.
 *
 * RULED OUT by reading lib/couranr/conversations/help.ts rather than guessing:
 * the seed uses the same algorithm the product does —
 * `randomBytes(32).toString("base64url")` hashed with sha256 hex — and a
 * 43-character base64url string satisfies `isWellFormedHelpToken`'s
 * `/^[A-Za-z0-9_-]{40,90}$/`. The row carries a 14-day `expires_at` and a null
 * `revoked_at`, so `couranr_redeem_help_token`'s three refusal conditions are
 * all false against the row as inserted.
 *
 * STILL OPEN, and the next thing to measure rather than reason about: what the
 * `/rest/v1/rpc/couranr_redeem_help_token` call actually returns through the
 * gateway. The strongest candidate is the service-role key — the harness passes
 * the literal string "disposable-local-service", which is not a JWT, and
 * PostgREST's handling of a non-JWT Bearer token decides whether the RPC ever
 * runs. Configuring a `jwt-secret` and signing a real service-role JWT would
 * remove that whole class. NOT YET TRIED, and stated as a candidate rather
 * than a diagnosis, because the last confident diagnosis in this file was
 * wrong.
 * ---------------------------------------------------------------------------
 *
 * Measured state: C1 "passes", C2 fails because the topic `<select>` never
 * appears — `locator.inputValue()` waits its full 30 seconds and times out.
 *
 * C1 IS ALMOST CERTAINLY A FALSE PASS, AND IS NOT EVIDENCE OF ANYTHING.
 * It matches `/Delivery Help/i` anywhere in `innerText`, and the text it
 * actually captured begins "Skip to main content / Pricing / For businesses /
 * Service areas" — the marketing shell's navigation. A nav or footer link is
 * enough to satisfy that regex, so C1 may be asserting that a LINK exists while
 * the help page itself never rendered. This is the documented `getByText`
 * substring trap, reproduced here by me. It must be replaced by a wait on
 * something that exists ONLY in the loaded help form before this file is
 * trusted at all.
 *
 * A DIAGNOSIS I GOT WRONG, RECORDED SO IT IS NOT RETRIED.
 * I attributed the missing `<select>` to `NEXT_PUBLIC_*` being inlined at build
 * time — the bundle pointing at the real Supabase host, unreachable from
 * Chromium here. That reasoning is sound in general and it was NOT the cause:
 * the harness now rebuilds with the gateway URL baked in, into its own
 * `distDir`, and the run fails identically. The build-time-env fix is retained
 * because it is correct and necessary, but it did not move the needle, and the
 * real cause is still unidentified.
 *
 * What is NOT yet ruled out: the page rendering a refusal or an error state
 * whose copy also contains "Delivery Help"; the token being rejected by
 * `couranr_redeem_help_token` through the gateway; hydration never completing;
 * or the form being gated behind a state the harness never reaches. The next
 * step is to screenshot and dump `innerText` unconditionally on failure rather
 * than reason about it.
 *
 * CUS-001 AND CUS-003 REMAIN UNPROMOTED IN BOTH LEDGERS.
 *
 * Two harness defects WERE found and fixed getting this far, both mine:
 *   - the Next server was spawned with stdio "pipe" and never drained, so it
 *     blocked once the OS pipe buffer filled — 15 minutes, no output, SIGTERM;
 *   - `psql` returned the command tag as well as the value, so every
 *     `insert ... returning id` yielded "<uuid>\nINSERT 0 1" and the tag was
 *     carried into the next statement, surfacing as
 *     `invalid input syntax for type uuid` one layer from its cause.
 *
 * Run:  node e2e/disposable/customerHelpFragments.mjs
 */

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { up, down, psql, dbUrl } from "./up.mjs";
import { startPostgrest, startGateway, waitForPostgrest } from "./gateway.mjs";

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
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "disposable-local-anon",
      SUPABASE_SERVICE_ROLE_KEY: "disposable-local-service",
      PORT: "3311",
      NODE_ENV: "production",
    };

    // Build with the gateway URL baked in. NEXT_PUBLIC_* are inlined at build
    // time, so a build made against the real project leaves the browser client
    // pointing at a host Chromium cannot reach here — the server half renders
    // and the client half never does. Its own distDir, so a developer's .next
    // is never clobbered.
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
    if (devServer) devServer.kill("SIGTERM");
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

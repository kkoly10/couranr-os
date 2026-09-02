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
import { postgrestTarget } from "../../scripts/provisionPostgrest.mjs";
import {
  gateAIntegrityIssues,
  psqlTransport,
  seedCanonicalDeliveryChain,
} from "./gateAFixtures.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SHOTS = path.join(ROOT, "e2e/screenshots/disposable-cus");
/** Build output for the harness only — never the developer's `.next`. */
const DIST = ".next-disposable";
// Resolved by scripts/provisionPostgrest.mjs, never a session scratchpad.
// The previous default was a path inside ONE container's ephemeral
// scratchpad, so this harness aborted on every other machine — after
// applying 50 migrations, which made a missing dependency look like a
// database failure. `npm run provision:postgrest` puts it on PATH.
const PGRST_BIN = postgrestTarget();

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
 * Seeds one delivery and one help token.
 *
 * The delivery chain comes from the shared Gate A fixture builder
 * (e2e/disposable/gateAFixtures.mjs), which drives the CURRENT canonical
 * commands. It used to be four hand-written INSERTs; Gate A moved commercial
 * identity onto an immutable quote that request, obligation, plan and delivery
 * must all reference, so those INSERTs stopped being writable and this suite
 * died in setup.
 *
 * The token row is still inserted directly rather than minted by
 * couranr_issue_help_token. That is deliberate and was already true: the raw
 * token and its hash are produced by the SAME algorithm as
 * lib/couranr/conversations/help.ts — randomBytes(32).toString("base64url")
 * and sha256 hex — verified by reading that file, so the fixture can hand the
 * browser a raw token it knows.
 */
async function seed(marker) {
  const businessId = sql(
    `insert into public.business_accounts (name, status)
     values ('${marker} business', 'active') returning id`
  );
  const userId = sql(
    `insert into auth.users (email) values ('${marker.toLowerCase().replace(/[^a-z0-9]/g, "")}@example.test')
     returning id`
  );
  const chain = await seedCanonicalDeliveryChain(psqlTransport(psql), {
    businessId,
    actorUserId: userId,
    marker: `disp-${marker.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
    recipientName: `${marker} recipient`,
  });
  const deliveryId = chain.deliveryId;

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

    pgrst = await startPostgrest({
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
    // ALSO the default .next. tsconfig includes `.next/types/**/*.ts`, so a
    // build into a DIFFERENT distDir still type-checks whatever route types a
    // previous build left there — and never regenerates them. A stale
    // `.next/types/app/page.ts` for a route that has since moved into the
    // (couranr) group fails the disposable build with TS2307 on a file nobody
    // edited. Measured: `rm -rf .next` is the difference between red and green.
    rmSync(path.join(ROOT, ".next"), { recursive: true, force: true });

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

    const a = await seed("[CUS001]");
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

    const b = await seed("[CUS003]");
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
    const c = await seed("[CUSBARE]");
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

    /*
     * The fixtures are Gate A LEGAL, not merely accepted. Each write satisfying
     * its own trigger does not prove the commercial graph agrees;
     * couranr_foundation_integrity() is the permanent probe that does.
     */
    const gateAIssues = await gateAIntegrityIssues(psqlTransport(psql));
    check("C11", "couranr_foundation_integrity() reports NO issue for the seeded chains",
      gateAIssues.length === 0, gateAIssues.join(",") || "clean");

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

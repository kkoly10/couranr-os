/**
 * CUS-004 — delivery problem reporting, driven UNSTUBBED against a disposable
 * database.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 *
 * CUS-004 sat at `functional_unverified` because its only browser evidence was
 * `e2e/deliveryHelp.mjs`, whose own header says it intercepts every
 * `/api/couranr/help/*` request with `page.route` and answers from the file. The
 * route handler, the SQL commands and the privilege boundary were therefore
 * never exercised in a browser. Under the promotion rule that excludes a stubbed
 * browser, the screen could not move — the same position CUS-001 and CUS-003
 * were in before `customerHelpFragments.mjs` was written.
 *
 * A manual drive against the real stack was done on 2026-09-14 and did prove the
 * server path, but it was one-off, covered only submit, and left rows in the
 * production project that `service_role` has no DELETE grant to remove. This
 * replaces it with something repeatable that touches no real project.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PROVES
 * ---------------------------------------------------------------------------
 *
 * Against a disposable PostgreSQL with every forward migration applied, a real
 * PostgREST, and a Next build made against that stack:
 *
 *   S1  the report form renders inside the Delivery Help page
 *   S2  `#delivery-problem` reaches the section
 *   S3  submit is refused until the required fields are filled
 *   S4  a submitted report PERSISTS — asserted in SQL, not from the rendering
 *   S5  the event trail is customer-authored: draft_saved then submit_report
 *   S6  the rendered card states the no-automatic-refund boundary
 *   S7  the one-open-report invariant holds against a second submit
 *   S8  Operations cannot start review while requested evidence is still owed
 *       (the 20260914060000 guard, through the real function)
 *   S9  a newer unrelated customer turn survives resolve_report
 *       (the other half of 20260914060000)
 *
 * S8 and S9 are the two guards shipped this week. They had execution evidence
 * from a hand-built fixture and no browser-tier coverage; here they run against
 * the same schema the application is talking to.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES NOT PROVE
 * ---------------------------------------------------------------------------
 *
 * Photo evidence upload. That path needs Storage, which the disposable stack
 * does not stand up — PostgREST serves PostgREST, not the storage API. The photo
 * CAP is proven in SQL by `tests/couranr-customer-problem-report.test.ts` and by
 * `couranr_cpe_*` constraints; what is missing is a browser drive of a real
 * upload, and it is named here rather than implied away.
 *
 * Run: node e2e/disposable/customerProblemReport.mjs
 * Needs: postgres + postgrest + playwright. On macOS, export COURANR_PGBIN and
 * COURANR_DISPOSABLE_DIR — `up.mjs` explains why.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
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
import { psqlTransport, seedCanonicalDeliveryChain } from "./gateAFixtures.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SHOTS = path.join(ROOT, "e2e/screenshots/disposable-cus004");
const DIST = ".next-disposable-cus004";
const PGRST_BIN = postgrestTarget();
const PORT = 3312;
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * Playwright, resolved rather than hardcoded.
 *
 * The 21 existing harnesses import it from
 * `/opt/node22/lib/node_modules/playwright/index.mjs`, which is one container's
 * global install. That path does not exist on a developer machine, so every one
 * of them dies on a fresh clone at the import — after building the application,
 * which makes a missing dependency look like a build failure. `createRequire`
 * finds whatever install is actually present.
 */
async function loadChromium() {
  const require = createRequire(import.meta.url);
  // CJS `require` first. Playwright's package main is CommonJS, and a dynamic
  // `import()` of that resolved path yields a namespace whose `chromium` is
  // undefined — which is exactly how the first run of this file died, after
  // building the whole application. `require` returns the real object.
  for (const spec of ["playwright", "playwright-core"]) {
    try {
      const mod = require(spec);
      if (mod?.chromium) return mod.chromium;
    } catch {
      /* not installed under that name */
    }
  }
  // The container's global install, kept last so a local dependency wins.
  try {
    const mod = await import("/opt/node22/lib/node_modules/playwright/index.mjs");
    if (mod?.chromium) return mod.chromium;
  } catch {
    /* not this machine */
  }
  throw new Error("playwright is not installed — `npm i -D playwright && npx playwright install chromium`");
}

/**
 * Launch the first browser that actually starts.
 *
 * Playwright's own download is not assumed to be usable. On this machine
 * `chromium-1148` exists but its Chromium Framework does not — a partial
 * download that fails at `dlopen`, surfacing through Playwright as the
 * thoroughly unhelpful "Target page, context or browser has been closed". A
 * managed browser that is present is not the same as one that runs, so each
 * candidate is TRIED and the first that opens a page wins.
 */
async function launchBrowser(chromium) {
  const attempts = [
    ["bundled", {}],
    ["system chrome", { channel: "chrome" }],
    ["system edge", { channel: "msedge" }],
  ];
  const failures = [];
  for (const [label, opts] of attempts) {
    try {
      const browser = await chromium.launch({ ...opts, args: ["--no-proxy-server"] });
      const probe = await browser.newPage();
      await probe.setContent("<h1>up</h1>");
      await probe.close();
      console.log(`  browser: ${label} (${browser.version()})`);
      return browser;
    } catch (e) {
      failures.push(`${label}: ${String(e.message).split("\n")[0].slice(0, 70)}`);
    }
  }
  throw new Error(`no usable browser\n    ${failures.join("\n    ")}`);
}

const sql = (q) => psql(q).trim();
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const esc = (s) => String(s).replace(/'/g, "''");

let passed = 0;
let failed = 0;
function check(id, what, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`    PASS  ${id}  ${what}${detail ? `  [${detail}]` : ""}`);
  } else {
    failed++;
    console.log(`    FAIL  ${id}  ${what}${detail ? `  [${detail}]` : ""}`);
  }
}

/**
 * One delivery, one help token.
 *
 * The chain comes from the shared Gate A builder so it is built by the CURRENT
 * canonical commands rather than by INSERTs that stopped being writable when
 * commercial identity moved onto the immutable quote.
 *
 * The token row is inserted directly, exactly as customerHelpFragments.mjs does
 * and for the same reason: the raw token and its hash use the same algorithm as
 * lib/couranr/conversations/help.ts — randomBytes(32).toString("base64url") and
 * sha256 hex — so the fixture can hand the browser a raw token it knows.
 */
async function seed(marker) {
  const businessId = sql(
    `insert into public.business_accounts (name, status)
     values ('${esc(marker)} business', 'active') returning id`
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
  const raw = crypto.randomBytes(32).toString("base64url");
  sql(
    `insert into public.couranr_help_access_tokens
       (token_hash, delivery_id, business_account_id, expires_at)
     values ('${sha256(raw)}', '${chain.deliveryId}', '${businessId}', now() + interval '14 days')`
  );
  return { businessId, userId, deliveryId: chain.deliveryId, requestId: chain.requestId, raw };
}

/** An Operations actor. The transition command demands profiles.role = 'admin'. */
function seedOperations(marker) {
  const id = sql(
    `insert into auth.users (email) values ('${marker}-ops@example.test') returning id`
  );
  sql(
    `insert into public.profiles (id, role) values ('${id}', 'admin')
     on conflict (id) do update set role = 'admin'`
  );
  return id;
}

async function main() {
  console.log("CUS-004 — delivery problem reporting, unstubbed\n");
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
      // Under the configurable base, NOT the hardcoded /var/lib path the older
      // harnesses use — that directory does not exist off Linux.
      workDir: path.join(
        process.env.COURANR_DISPOSABLE_DIR || "/var/lib/postgresql/couranr-disposable",
        "pgrst-cus004"
      ),
    });
    if (!(await waitForPostgrest())) throw new Error("PostgREST did not start");
    gateway = await startGateway();
    console.log(`  gateway at ${gateway.url}`);

    const env = {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: gateway.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_JWT,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_JWT,
      PORT: String(PORT),
      NODE_ENV: "production",
    };

    // NEXT_PUBLIC_* are inlined at build time, so a cache keyed to a different
    // URL ships a client pointing at a host Chromium cannot reach.
    rmSync(path.join(ROOT, DIST), { recursive: true, force: true });
    for (const stale of ["types", path.join("dev", "types")]) {
      rmSync(path.join(ROOT, ".next", stale), { recursive: true, force: true });
    }

    console.log("  building the application against the disposable stack...");
    execFileSync("npx", ["next", "build"], {
      cwd: ROOT,
      env: { ...env, COURANR_DIST_DIR: DIST },
      stdio: "ignore",
      timeout: 900_000,
    });

    console.log("  starting the application against it...");
    devServer = spawn("npx", ["next", "start", "-p", String(PORT)], {
      cwd: ROOT,
      env: { ...env, COURANR_DIST_DIR: DIST },
      stdio: "ignore",
      detached: true,
    });
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

    const chromium = await loadChromium();
    browser = await launchBrowser(chromium);

    /* ───────────────────────── the customer half ───────────────────────── */

    const f = await seed("[CUS004]");
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`${BASE}/help/${f.raw}#delivery-problem`, { waitUntil: "networkidle" });

    const body = await page.innerText("body");
    writeFileSync(path.join(SHOTS, "DIAG-innerText.txt"), body);

    const section = page.locator("#delivery-problem");
    check("S1", "the report form renders inside Delivery Help",
      (await section.count()) === 1 && (await section.locator("textarea").count()) === 1,
      `sections=${await section.count()}`);

    check("S2", "#delivery-problem reaches the report section",
      /Report a delivery problem/i.test(body));

    const submit = section.getByRole("button", { name: /submit delivery report/i });
    check("S3", "submit is refused until the required fields are filled",
      await submit.isDisabled());
    await page.screenshot({ path: path.join(SHOTS, "S3-empty-form.png"), fullPage: true });

    const details = "[CUS004] outer carton crushed on one edge; seal already open on arrival";
    await section.locator("textarea").fill(details);
    await section.locator("select").selectOption("damaged");
    await submit.click();
    await page.waitForTimeout(3000);

    // DATABASE SIDE. Rendering proved nothing about what was persisted.
    const row = sql(
      `select report_state || '|' || problem_type from public.couranr_customer_problem_reports
        where details = '${esc(details)}'`
    );
    check("S4", "a submitted report PERSISTS with its state and type",
      row === "reported|damaged", row || "no row");

    const trail = sql(
      `select string_agg(actor_kind || ':' || command, ' -> ' order by e.created_at)
         from public.couranr_customer_problem_report_events e
         join public.couranr_customer_problem_reports r on r.id = e.report_id
        where r.details = '${esc(details)}'`
    );
    check("S5", "the event trail is customer-authored",
      trail === "customer:draft_saved -> customer:submit_report", trail || "none");

    const card = await section.innerText();
    check("S6", "the rendered card states the no-automatic-refund boundary",
      /does not automatically/i.test(card) && /refund/i.test(card));
    await page.screenshot({ path: path.join(SHOTS, "S6-reported-card.png"), fullPage: true });

    const openCount = sql(
      `select count(*) from public.couranr_customer_problem_reports r
         join public.couranr_help_access_tokens t on t.delivery_id = r.delivery_id
        where t.token_hash = '${sha256(f.raw)}' and r.report_state <> 'resolved'`
    );
    check("S7", "the one-open-report invariant holds", openCount === "1", `open=${openCount}`);

    /* ───────────── the two guards shipped in 20260914060000 ───────────── */

    const opsId = seedOperations("cus004");
    const reportId = sql(
      `select id from public.couranr_customer_problem_reports where details = '${esc(details)}'`
    );
    const ver = sql(`select version from public.couranr_customer_problem_reports where id = '${reportId}'`);

    // Operations asks for evidence: reported -> awaiting_evidence.
    sql(
      `select public.couranr_transition_customer_problem_report(
         '${reportId}', ${ver}, '${opsId}', 'request_evidence')`
    );
    const afterRequest = sql(
      `select report_state from public.couranr_customer_problem_reports where id = '${reportId}'`
    );

    // S8: start_review must be REFUSED while the evidence is still owed.
    let refused = "";
    try {
      const v2 = sql(`select version from public.couranr_customer_problem_reports where id = '${reportId}'`);
      sql(
        `select public.couranr_transition_customer_problem_report(
           '${reportId}', ${v2}, '${opsId}', 'start_review')`
      );
      refused = "ALLOWED";
    } catch (e) {
      refused = /problem_evidence_not_received/.test(String(e.stderr || e.message))
        ? "problem_evidence_not_received"
        : `other: ${String(e.stderr || e.message).slice(0, 80)}`;
    }
    check("S8", "start_review is refused while requested evidence is still owed",
      afterRequest === "awaiting_evidence" && refused === "problem_evidence_not_received",
      `${afterRequest} / ${refused}`);

    // S9: a customer turn NEWER than this report's activity survives resolve.
    const convId = sql(
      `select c.id from public.couranr_conversations c
         join public.couranr_conversation_participants p on p.conversation_id = c.id
         join public.couranr_customer_problem_reports r on r.participant_id = p.id
        where r.id = '${reportId}'`
    );
    sql(
      `update public.couranr_conversations
          set waiting_on = 'couranr', awaiting_reply_kind = 'customer', received_at = now()
        where id = '${convId}'`
    );
    const v3 = sql(`select version from public.couranr_customer_problem_reports where id = '${reportId}'`);
    sql(
      `select public.couranr_transition_customer_problem_report(
         '${reportId}', ${v3}, '${opsId}', 'resolve_report')`
    );
    const turn = sql(
      `select coalesce(waiting_on,'NULL') || '|' || coalesce(awaiting_reply_kind,'NULL')
         from public.couranr_conversations where id = '${convId}'`
    );
    check("S9", "a newer customer turn survives resolve_report",
      turn === "couranr|customer", turn);

    console.log(`\n  CUS-004: ${passed} passed, ${failed} failed`);
    console.log(`  screenshots in ${path.relative(ROOT, SHOTS)}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    // Kill the process GROUP. `npx next start` spawns a child; signalling the
    // wrapper orphans the real next-server, which keeps holding the port and
    // satisfies the next run's wait-for-live loop with stale environment.
    if (devServer) {
      try { process.kill(-devServer.pid, "SIGTERM"); } catch { devServer.kill("SIGTERM"); }
    }
    if (gateway?.server) gateway.server.close();
    if (pgrst) pgrst.kill("SIGTERM");
    // Cleanup is destruction, not a DELETE grant — the whole reason this suite
    // exists rather than seeding the real project.
    down({ quiet: true });
    rmSync(path.join(ROOT, DIST), { recursive: true, force: true });
    console.log("  disposable database destroyed");
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

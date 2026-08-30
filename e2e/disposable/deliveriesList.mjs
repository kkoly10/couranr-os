/**
 * MER-004 — the deliveries list, driven UNSTUBBED and SIGNED IN.
 *
 * The registry's constraint for this screen is the point of most checks:
 * "Never collapse independent state groups into one misleading status."
 * A row that is `confirmed` + `not_confirmed` readiness + `authorized`
 * payment must render THREE separate badges — the canonical mock's single
 * Status column is overruled by the written spec and must not exist.
 *
 * Coverage, per the build contract's verification obligations:
 *   empty state; separate badges; each facet filters independently; inline
 *   mark-ready asserted to the row AND the audit event; a STALE tab's
 *   mark-ready surfaces a conflict and changes nothing; viewer sees no write
 *   affordance and the server refuses; wrong-business and anonymous refused;
 *   the error state via page.route (the one deliberate interception — fault
 *   injection belongs in the browser, not the database); duplicate prefills
 *   the create flow which re-prices server-side.
 *
 * WHAT THIS DOES NOT PROVE — repeat wherever a run is cited: the `/auth/v1`
 * issuer is gateway.mjs's reimplementation, not GoTrue; fixtures are seeded
 * directly because review/authorization would need Stripe.
 *
 * Run:  node e2e/disposable/deliveriesList.mjs
 */

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SHOTS = path.join(ROOT, "e2e/screenshots/deliveries-list");
const DIST = ".next-disposable";
// Resolved by scripts/provisionPostgrest.mjs, never a session scratchpad.
// The previous default was a path inside ONE container's ephemeral
// scratchpad, so this harness aborted on every other machine — after
// applying 50 migrations, which made a missing dependency look like a
// database failure. `npm run provision:postgrest` puts it on PATH.
const PGRST_BIN = postgrestTarget();

const PORT = 3314;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "disposable-deliveries-1";

let passed = 0;
let failed = 0;

function check(id, description, ok, detail = "") {
  ok ? passed++ : failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${description}${detail ? `  [${detail}]` : ""}`);
}

const sql = (q) => psql(q).trim();
const esc = (s) => String(s).replace(/'/g, "''");

/**
 * `Field` renders a required label as "Name*" and a NON-required one as
 * "Name (optional)" — the matcher must accept both, and `getByLabel` matches
 * label TEXT, not the accessible name. The optional suffix cost this harness
 * its first facet run.
 */
function fieldLabel(scope, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return scope.getByLabel(new RegExp(`^${escaped}( \\(optional\\))?\\s*\\*?$`));
}

/* ------------------------------------------------------------------ seeding */

function makeUser(email, profileRole) {
  const id = sql(`insert into auth.users (email) values ('${esc(email)}') returning id`);
  sql(`select public.couranr_disposable_set_password('${id}', '${esc(PASSWORD)}')`);
  sql(
    `insert into public.profiles (id, email, role)
     values ('${id}', '${esc(email)}', '${profileRole}')`
  );
  return id;
}

function makeRequest(businessId, creatorId, marker, opts) {
  const { state, readiness = "not_confirmed", review = "not_required", addresses = false } = opts;
  const submitted = state === "draft" ? "null" : "now()";
  const quoted =
    state === "draft"
      ? { status: "'not_quoted'", subtotal: "null", policy: "null" }
      : { status: "'estimated'", subtotal: "2299", policy: "'disposable'" };
  const pickup = addresses
    ? `'{"line1":"12 Duplicate Way","city":"Stafford","region":"VA","postalCode":"22554","instructions":"ring twice"}'::jsonb`
    : "'{}'::jsonb";
  const dropoff = addresses
    ? `'{"line1":"9 Dropoff Ct","city":"Woodbridge","region":"VA","postalCode":"22191"}'::jsonb`
    : "'{}'::jsonb";
  return sql(
    `insert into public.couranr_delivery_requests
       (business_account_id, created_by, idempotency_key, recipient_name,
        request_state, readiness_state, review_state, submitted_at,
        quote_status, delivery_subtotal_cents, pricing_policy_version,
        pickup_address, dropoff_address, loaded_miles, weight_lb)
     values ('${businessId}', '${creatorId}', 'list-${marker}-${crypto.randomUUID()}',
             '${esc(marker)} recipient', '${state}', '${readiness}', '${review}', ${submitted},
             ${quoted.status}, ${quoted.subtotal}, ${quoted.policy},
             ${pickup}, ${dropoff}, 5, 20)
     returning id`
  );
}

function makeObligation(requestId, businessId, paymentState) {
  const intent = `pi_list_${crypto.randomUUID().replace(/-/g, "")}`;
  const authorizedAt =
    paymentState === "authorized" || paymentState === "capture_pending" ? "now()" : "null";
  const failedAt = paymentState === "failed" ? "now()" : "null";
  return sql(
    `insert into public.couranr_payment_obligations
       (request_id, business_account_id, payer_type, request_version,
        pricing_policy_version, amount_cents, payment_state, idempotency_key,
        provider_payment_intent_id, authorized_at, failed_at)
     values ('${requestId}', '${businessId}', 'merchant', 1,
             'disposable', 2299, '${paymentState}', 'list-po-${crypto.randomUUID()}',
             '${intent}', ${authorizedAt}, ${failedAt})
     returning id`
  );
}

/* --------------------------------------------------------------- the harness */

async function main() {
  console.log("MER-004 deliveries list — authenticated, unstubbed\n");
  mkdirSync(SHOTS, { recursive: true });

  let pgrst;
  let gateway;
  let appServer;
  let browser;
  const contexts = [];

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

    const env = {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: gateway.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_JWT,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_JWT,
      PORT: String(PORT),
      NODE_ENV: "production",
    };

    const reuse = process.env.COURANR_REUSE_BUILD === "1";
    if (reuse && !process.env.COURANR_DISPOSABLE_JWT_SECRET) {
      throw new Error(
        "COURANR_REUSE_BUILD=1 requires COURANR_DISPOSABLE_JWT_SECRET — the anon key is inlined at build time"
      );
    }
    if (!reuse) {
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
        timeout: 900_000,
      });
    }

    console.log("  starting the application against it...");
    appServer = spawn("npx", ["next", "start", "-p", String(PORT)], {
      cwd: ROOT,
      env: { ...env, COURANR_DIST_DIR: DIST },
      stdio: "ignore",
      detached: true,
    });
    const deadline = Date.now() + 120_000;
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

    /* ───────────────────────────── fixtures ───────────────────────────── */

    console.log("  seeding synthetic identities and requests...");

    const bizA = sql(
      `insert into public.business_accounts (name, status)
       values ('[LIST] active business', 'active') returning id`
    );
    const owner = { id: makeUser("e2e-list-owner@couranr.invalid", "customer"),
                    email: "e2e-list-owner@couranr.invalid" };
    const viewer = { id: makeUser("e2e-list-viewer@couranr.invalid", "customer"),
                     email: "e2e-list-viewer@couranr.invalid" };
    for (const [u, role] of [[owner, "owner"], [viewer, "viewer"]]) {
      sql(
        `insert into public.business_members (business_account_id, user_id, role, status)
         values ('${bizA}', '${u.id}', '${role}', 'active')`
      );
    }
    const bizB = sql(
      `insert into public.business_accounts (name, status)
       values ('[LIST] empty business', 'active') returning id`
    );
    const emptyOwner = { id: makeUser("e2e-list-empty@couranr.invalid", "customer"),
                         email: "e2e-list-empty@couranr.invalid" };
    sql(
      `insert into public.business_members (business_account_id, user_id, role, status)
       values ('${bizB}', '${emptyOwner.id}', 'owner', 'active')`
    );

    const rDraft = makeRequest(bizA, owner.id, "LIST-draft", { state: "draft" });
    // THE separate-badges control: three groups in three different states.
    const rMixed = makeRequest(bizA, owner.id, "LIST-mixed", {
      state: "confirmed",
      readiness: "not_confirmed",
      review: "accepted_as_quoted",
      addresses: true,
    });
    makeObligation(rMixed, bizA, "authorized");
    const rPrep = makeRequest(bizA, owner.id, "LIST-prep", {
      state: "confirmed",
      readiness: "preparing",
      review: "accepted_as_quoted",
    });
    makeObligation(rPrep, bizA, "authorized");
    makeRequest(bizA, owner.id, "LIST-review", {
      state: "pending_couranr_review",
      review: "pending",
    });
    const rFailed = makeRequest(bizA, owner.id, "LIST-failed", {
      state: "confirmed",
      review: "accepted_as_quoted",
    });
    makeObligation(rFailed, bizA, "failed");

    console.log("  fixtures ready\n");

    /* ─────────────────────────── browser helpers ─────────────────────── */

    const { chromium } = await import("/opt/node22/lib/node_modules/playwright/index.mjs");
    browser = await chromium.launch({ args: ["--no-proxy-server"] });

    async function signIn(email) {
      const ctx = await browser.newContext();
      contexts.push(ctx);
      const page = await ctx.newPage();
      await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });
      const emailField = fieldLabel(page, "Email");
      await emailField.waitFor({ state: "visible", timeout: 45_000 });
      await emailField.fill(email);
      await fieldLabel(page, "Password").fill(PASSWORD);
      await page.getByRole("button", { name: /^Sign in$/ }).click();
      const until = Date.now() + 45_000;
      while (Date.now() < until) {
        if (!new URL(page.url()).pathname.startsWith("/sign-in")) return page;
        await page.waitForTimeout(250);
      }
      const text = await page.innerText("body").catch(() => "(no body)");
      throw new Error(`sign-in for ${email} never left /sign-in: ${text.slice(0, 300)}`);
    }

    async function tokenFor(email) {
      const r = await fetch(`${gateway.url}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { "content-type": "application/json", apikey: ANON_JWT },
        body: JSON.stringify({ email, password: PASSWORD }),
      });
      if (!r.ok) throw new Error(`could not mint a token for ${email}: ${r.status}`);
      return (await r.json()).access_token;
    }

    async function api(email, pathname, init = {}) {
      const token = await tokenFor(email);
      const r = await fetch(`${BASE}${pathname}`, {
        ...init,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          ...(init.headers || {}),
        },
      });
      let body = null;
      try {
        body = await r.json();
      } catch {
        /* no body */
      }
      return { status: r.status, body };
    }

    async function openList(email) {
      const page = await signIn(email);
      await page.goto(`${BASE}/app/business/deliveries`, { waitUntil: "domcontentloaded" });
      return page;
    }

    const rowFor = (page, marker) => page.locator("tbody tr", { hasText: `${marker} recipient` });

    /* ══════════════════ owner — badges, facets, payment facts ══════════ */

    console.log("Owner — separate badges and independent facets");
    const ownerPage = await openList(owner.email);
    await rowFor(ownerPage, "LIST-draft").waitFor({ state: "visible", timeout: 30_000 });
    // Payment facts arrive after the fan-out; the scope note is its sentinel.
    await ownerPage.getByText("Payment facts checked").waitFor({ state: "visible", timeout: 30_000 });

    {
      const mixed = rowFor(ownerPage, "LIST-mixed");
      const t = (await mixed.innerText()).replace(/\s+/g, " ");
      check("B1", "the mixed row renders THREE separate group badges, never one merged status",
        t.includes("Confirmed") && t.includes("Not confirmed") && t.includes("authorized"), t.slice(0, 160));
      check("B2", "no merged-status vocabulary anywhere on the page",
        !/(in progress|in transit)/i.test(await ownerPage.innerText("body")));
      const db = sql(
        `select request_state || '|' || readiness_state || '|' ||
                (select payment_state from public.couranr_payment_obligations o
                  where o.request_id = r.id and o.payment_state <> 'cancelled' limit 1)
           from public.couranr_delivery_requests r where id='${rMixed}'`
      );
      check("B3", "the three badges are the three database facts", db === "confirmed|not_confirmed|authorized", db);
    }
    check("B4", "the review group renders its own badge",
      (await rowFor(ownerPage, "LIST-review").innerText()).includes("Pending"));
    await ownerPage.screenshot({ path: path.join(SHOTS, "MER-004-active.png"), fullPage: true });

    async function setFacet(label, value) {
      await fieldLabel(ownerPage, label).selectOption(value);
    }
    const visibleMarkers = async () => {
      const rows = await ownerPage.locator("tbody tr").allInnerTexts();
      return rows.map((r) => (r.match(/LIST-[a-z]+/i) || [""])[0]).filter(Boolean).sort();
    };

    await setFacet("Request state", "draft");
    check("F1", "request-state facet alone isolates the draft",
      (await visibleMarkers()).join(",") === "LIST-draft");
    await setFacet("Request state", "");
    await setFacet("Readiness", "preparing");
    check("F2", "readiness facet alone isolates the preparing row",
      (await visibleMarkers()).join(",") === "LIST-prep");
    await setFacet("Readiness", "");
    await setFacet("Payment", "failed");
    check("F3", "payment facet alone isolates the failed-payment row",
      (await visibleMarkers()).join(",") === "LIST-failed");
    await ownerPage.screenshot({ path: path.join(SHOTS, "MER-004-filtered.png"), fullPage: true });
    await setFacet("Payment", "");
    await setFacet("Couranr review", "pending");
    check("F4", "review facet alone isolates the pending-review row",
      (await visibleMarkers()).join(",") === "LIST-review");
    await setFacet("Couranr review", "");
    await fieldLabel(ownerPage, "Search").fill("LIST-mixed");
    check("F5", "search isolates by recipient",
      (await visibleMarkers()).join(",") === "LIST-mixed");
    await fieldLabel(ownerPage, "Search").fill("");

    /* ═══════════ stale-tab conflict, then a clean inline mark-ready ═════ */

    console.log("Mark ready — stale conflict first, then the clean path");
    {
      // Another session (the API, same owner) marks rPrep ready FIRST, so the
      // open tab's version 1 is stale.
      const r = await api(owner.email, `/api/couranr/delivery-requests/${rPrep}/readiness`, {
        method: "POST",
        body: JSON.stringify({ businessAccountId: bizA, expectedVersion: 1, readiness: "ready" }),
      });
      check("W0", "the fresh mark-ready succeeded elsewhere", r.status === 200, `status=${r.status}`);

      const btn = rowFor(ownerPage, "LIST-prep").getByRole("button", { name: "Ready for Couranr" });
      await btn.waitFor({ state: "visible", timeout: 15_000 });
      await btn.click();
      await ownerPage
        .getByText("changed since this list loaded")
        .waitFor({ state: "visible", timeout: 20_000 });
      check("W1", "the stale tab surfaces a conflict instead of pretending", true);
      const row = sql(
        `select readiness_state || '|' || version from public.couranr_delivery_requests where id='${rPrep}'`
      );
      check("W2", "the stale attempt changed nothing: still ready at version 2", row === "ready|2", row);
      const events = sql(
        `select count(*) from public.couranr_delivery_request_events
          where request_id='${rPrep}' and command='mark_delivery_ready'`
      );
      check("W3", "exactly one mark_delivery_ready audit event exists", events === "1", events);
    }
    {
      // The clean path on the OTHER authorized row, from the refreshed list.
      const btn = rowFor(ownerPage, "LIST-mixed").getByRole("button", { name: "Ready for Couranr" });
      await btn.waitFor({ state: "visible", timeout: 30_000 });
      await btn.click();
      const until = Date.now() + 20_000;
      let row = "";
      while (Date.now() < until) {
        row = sql(
          `select readiness_state || '|' || version from public.couranr_delivery_requests where id='${rMixed}'`
        );
        if (row === "ready|2") break;
        await new Promise((r) => setTimeout(r, 500));
      }
      check("W4", "inline mark-ready flipped the row: ready, version 2", row === "ready|2", row);
      const ev = sql(
        `select command || '|' || from_state || '|' || to_state || '|' || (actor_user_id = '${owner.id}')::text
           from public.couranr_delivery_request_events
          where request_id='${rMixed}' order by created_at desc limit 1`
      );
      check("W5", "the audit event names the command, both states and the signed-in owner",
        ev === "mark_delivery_ready|not_confirmed|ready|true", ev);
    }

    /* ══════════════════════ duplicate → prefilled create ═══════════════ */

    console.log("Duplicate — prefills the create flow, which re-prices server-side");
    {
      await rowFor(ownerPage, "LIST-mixed").getByRole("button", { name: "Duplicate" }).click();
      await ownerPage.waitForURL(/\/app/business\/deliveries\/new/, { timeout: 20_000 });
      const name = fieldLabel(ownerPage, "Name").first();
      await name.waitFor({ state: "visible", timeout: 20_000 });
      const until = Date.now() + 10_000;
      while (Date.now() < until && (await name.inputValue()) === "") {
        await ownerPage.waitForTimeout(200);
      }
      check("DUP1", "recipient name carried over",
        (await name.inputValue()) === "LIST-mixed recipient", await name.inputValue());
      check("DUP2", "pickup street carried over",
        (await fieldLabel(ownerPage, "Street address").first().inputValue()) === "12 Duplicate Way");
      check("DUP3", "no quote carried over — the flow is back at intake with no estimate",
        !new URL(ownerPage.url()).searchParams.get("step"));
      await ownerPage.screenshot({ path: path.join(SHOTS, "MER-004-duplicate-prefill.png"), fullPage: true });
    }

    /* ═══════════════════════════ viewer mirror ═════════════════════════ */

    console.log("Viewer — list readable, writes absent and refused");
    const viewerPage = await openList(viewer.email);
    await rowFor(viewerPage, "LIST-draft").waitFor({ state: "visible", timeout: 30_000 });
    check("V1", "viewer reads the list (all five roles may read)",
      (await viewerPage.locator("tbody tr").count()) === 5);
    check("V2", "viewer sees no Create, no Ready, no Duplicate",
      (await viewerPage.locator('a[href="/app/business/deliveries/new"]').count()) === 0 &&
      (await viewerPage.getByRole("button", { name: "Ready for Couranr" }).count()) === 0 &&
      (await viewerPage.getByRole("button", { name: "Duplicate" }).count()) === 0);
    {
      const r = await api(viewer.email, `/api/couranr/delivery-requests/${rDraft}/readiness`, {
        method: "POST",
        body: JSON.stringify({ businessAccountId: bizA, expectedVersion: 1, readiness: "preparing" }),
      });
      check("V3", "server truth: viewer's write is refused", r.status === 403, `status=${r.status}`);
    }
    await viewerPage.screenshot({ path: path.join(SHOTS, "MER-004-viewer.png"), fullPage: true });

    /* ═══════════════════ tenant and anonymous boundaries ═══════════════ */

    {
      const r = await api(emptyOwner.email, `/api/couranr/delivery-requests?businessAccountId=${bizA}`);
      check("X1", "a member of business B asking for business A is refused",
        r.status === 403, `status=${r.status}`);
      const anon = await fetch(`${BASE}/api/couranr/delivery-requests?businessAccountId=${bizA}`);
      check("X2", "anonymous is refused", anon.status === 401, `status=${anon.status}`);
    }

    /* ═══════════════════════════ empty state ═══════════════════════════ */

    console.log("Empty business — the empty state");
    const emptyPage = await openList(emptyOwner.email);
    await emptyPage.getByText("No deliveries yet").waitFor({ state: "visible", timeout: 30_000 });
    check("E1", "empty state with a real create action, no invented numbers",
      (await emptyPage.locator('a[href="/app/business/deliveries/new"]').count()) > 0 &&
      !/Showing \d+/.test(await emptyPage.innerText("body")));
    await emptyPage.screenshot({ path: path.join(SHOTS, "MER-004-empty.png"), fullPage: true });

    /* ══════════════ error state — the one deliberate interception ══════ */

    console.log("Error state — list call answered 500 at the page boundary");
    {
      const page = await signIn(owner.email);
      await page.route("**/api/couranr/delivery-requests?*", (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Injected for the error-state check.", correlationId: "e2e-err-1" }),
        })
      );
      await page.goto(`${BASE}/app/business/deliveries`, { waitUntil: "domcontentloaded" });
      await page.getByText("Your deliveries did not load").waitFor({ state: "visible", timeout: 30_000 });
      check("ERR1", "the error state renders with the support reference",
        (await page.innerText("body")).includes("e2e-err-1"));
      await page.screenshot({ path: path.join(SHOTS, "MER-004-error.png"), fullPage: true });
    }

    /* ─────────────────────────────── result ──────────────────────────── */

    console.log(`\n  ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    for (const ctx of contexts) await ctx.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (appServer?.pid) {
      try {
        process.kill(-appServer.pid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
    if (gateway?.server) gateway.server.close();
    if (pgrst) pgrst.kill("SIGTERM");
    down({ quiet: true });
    console.log("  disposable stack torn down");
  }
}

main().catch((e) => {
  console.error(e.stack || e.message || e);
  down({ quiet: true });
  process.exitCode = 1;
});

/**
 * RR-002 authenticated merchant browser smoke.
 *
 * Real Chromium -> real Next server -> disposable gateway/PostgREST/PostgreSQL
 * carrying every forward migration. No routing provider is called: the builder
 * is verified before address typing, while list/detail/accept use canonical
 * seeded child quotes and the real Route Run API.
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
  waitForPortFree,
  POSTGREST_PORT,
  GATEWAY_PORT,
  SERVICE_ROLE_JWT,
  ANON_JWT,
} from "./gateway.mjs";
import { postgrestTarget } from "../../scripts/provisionPostgrest.mjs";
import { psqlTransport, seedCanonicalQuotedRequest } from "./gateAFixtures.mjs";
import { claimDevDistDir } from "../devDistDir.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const devDist = claimDevDistDir("route-run-merchant");
const DIST = devDist.rel;
const SHOTS = path.join(ROOT, "e2e/screenshots/route-run");
const PGRST_BIN = postgrestTarget();
const NEXT_BIN = path.join(ROOT, "node_modules/next/dist/bin/next");
const PORT = 3318;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "route-run-browser-1";
const sql = (q) => psql(q).trim();
const esc = (s) => String(s).replace(/'/g, "''");
let passed = 0;
let failed = 0;

function check(id, description, ok, detail = "") {
  ok ? passed++ : failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${description}${detail ? `  [${detail}]` : ""}`);
}
function fieldLabel(scope, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return scope.getByLabel(new RegExp(`^${escaped}(\\s*\\*|\\s*\\(optional\\))?$`));
}
function makeUser(email, role = "customer") {
  const id = sql(`insert into auth.users(email) values ('${esc(email)}') returning id`);
  sql(`select public.couranr_disposable_set_password('${id}','${esc(PASSWORD)}')`);
  sql(`insert into public.profiles(id,email,role) values('${id}','${esc(email)}','${role}')`);
  return id;
}

async function stopChild(child, { group = false } = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  let timeout;
  const closed = new Promise((resolve) => child.once("close", resolve));
  const signal = (name) => {
    try {
      if (group) process.kill(-child.pid, name);
      else child.kill(name);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  try {
    signal("SIGTERM");
    await Promise.race([
      closed,
      new Promise((resolve) => {
        timeout = setTimeout(() => { signal("SIGKILL"); resolve(closed); }, 5000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  let pgrst, gateway, appServer, browser;
  const contexts = [];
  try {
    await waitForPortFree(PORT, "RR-002 Next server");
    mkdirSync(SHOTS, { recursive: true });
    const info = up({ quiet: true });
    console.log(`RR-002 browser: ${info.migrationsApplied} migrations applied`);

    pgrst = await startPostgrest({
      dbUrl: dbUrl(),
      binary: PGRST_BIN,
      workDir: "/var/lib/postgresql/couranr-disposable/rr002-browser-pgrst",
    });
    if (!(await waitForPostgrest())) throw new Error("PostgREST did not start");
    gateway = await startGateway();

    const env = {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: gateway.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_JWT,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_JWT,
      PORT: String(PORT),
      NODE_ENV: "production",
    };

    rmSync(path.join(ROOT, DIST), { recursive: true, force: true });
    for (const stale of ["types", path.join("dev", "types")]) {
      rmSync(path.join(ROOT, ".next", stale), { recursive: true, force: true });
    }
    console.log("  building app against disposable stack...");
    execFileSync(process.execPath, [NEXT_BIN, "build"], {
      cwd: ROOT,
      env: { ...env, COURANR_DIST_DIR: DIST },
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
      timeout: 900_000,
    });
    appServer = spawn(process.execPath, [NEXT_BIN, "start", "-p", String(PORT)], {
      cwd: ROOT,
      env: { ...env, COURANR_DIST_DIR: DIST },
      stdio: "ignore",
      detached: true,
    });

    const deadline = Date.now() + 120_000;
    let live = false;
    while (Date.now() < deadline && !live) {
      try {
        const response = await fetch(BASE, { redirect: "manual" });
        live = response.status < 500;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
    if (!live) throw new Error("application did not start");

    const business = sql("insert into public.business_accounts(name,status) values('RR002 Browser Shop','active') returning id");
    const owner = makeUser("rr002-browser-owner@couranr.invalid");
    const viewer = makeUser("rr002-browser-viewer@couranr.invalid");
    sql(`insert into public.business_members(business_account_id,user_id,role,status) values
      ('${business}','${owner}','owner','active'),
      ('${business}','${viewer}','viewer','active')`);

    const transport = psqlTransport(psql);
    const commonPickup = {
      line1: "10 Route Pickup Way",
      city: "Stafford",
      region: "VA",
      postalCode: "22554",
    };
    async function child(marker, subtotal, dropoffLine) {
      const seeded = await seedCanonicalQuotedRequest(transport, {
        businessId: business,
        actorUserId: owner,
        marker,
        upTo: "draft",
        pickupAddress: commonPickup,
        dropoffAddress: {
          line1: dropoffLine,
          city: "Stafford",
          region: "VA",
          postalCode: "22554",
        },
        recipientName: `${marker} recipient`,
        recipientEmail: `${marker}@couranr.invalid`,
        weightLb: 20,
        subtotalCents: subtotal,
      });
      sql(`select id from public.couranr_set_business_pickup_manifest(
        '${seeded.requestId}','${business}','${owner}',0,
        'Package ${marker}',1,'${marker}',null
      )`);
      const value = JSON.parse(sql(`select public.couranr_record_business_declared_value(
        '${business}','${owner}','${seeded.requestId}',${seeded.version},10000
      )`));
      return { ...seeded, version: value.version };
    }

    const one = await child("browser-stop-one", 1800, "21 Browser Stop Ln");
    const two = await child("browser-stop-two", 2200, "22 Browser Stop Ln");
    const routeId = crypto.randomUUID();
    sql(`select public.couranr_save_route_run_draft(
      '${business}','${owner}','${routeId}',0,'${crypto.randomUUID()}',
      'Browser Route',array['${one.requestId}','${two.requestId}']::uuid[]
    )`);

    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });

    async function signIn(email, viewport = { width: 1440, height: 1000 }) {
      const ctx = await browser.newContext({ viewport });
      contexts.push(ctx);
      const page = await ctx.newPage();
      await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });
      await fieldLabel(page, "Email").fill(email);
      await fieldLabel(page, "Password").fill(PASSWORD);
      await page.getByRole("button", { name: /^Sign in$/ }).click();
      await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 45_000 });
      return page;
    }

    const ownerPage = await signIn("rr002-browser-owner@couranr.invalid");
    const providerRequests = [];
    const stripeRequests = [];
    ownerPage.on("request", (request) => {
      if (request.url().includes("/api/couranr/merchant/places")) providerRequests.push(request.url());
      if (/https:\/\/(api|js)\.stripe\.com\//.test(request.url())) stripeRequests.push(request.url());
    });

    await ownerPage.goto(`${BASE}/app/business/routes`, { waitUntil: "domcontentloaded" });
    await ownerPage.getByText("Browser Route", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
    check("B1", "Route Runs list renders the seeded draft", await ownerPage.getByText("Browser Route", { exact: true }).isVisible());
    check("B2", "Route Runs list says Draft", await ownerPage.getByText("Draft", { exact: true }).isVisible());
    check("B3", "Route Runs list shows the child estimate sum", (await ownerPage.locator("body").innerText()).includes("$40.00"));
    check("B4", "owner sees New Route Run", await ownerPage.getByRole("link", { name: "New Route Run" }).isVisible());
    await ownerPage.screenshot({ path: path.join(SHOTS, "B-list-desktop.png"), fullPage: true });

    await ownerPage.goto(`${BASE}/app/business/routes/new`, { waitUntil: "domcontentloaded" });
    await ownerPage.getByText("Route details", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
    check("B5", "builder starts with Stop 1", await ownerPage.getByText("Stop 1", { exact: true }).isVisible());
    check("B6", "builder starts with Stop 2", await ownerPage.getByText("Stop 2", { exact: true }).isVisible());
    const builderBody = await ownerPage.locator("body").innerText();
    check("B7", "builder advertises no over-50-lb option", !builderBody.includes("Over 50"));
    check("B8", "builder names the $500 Route Run ceiling", builderBody.includes("$500 total"));
    check("B9", "rendering the builder makes no address-provider request", providerRequests.length === 0, String(providerRequests.length));
    await ownerPage.screenshot({ path: path.join(SHOTS, "B-builder-desktop.png"), fullPage: true });

    await ownerPage.goto(`${BASE}/app/business/routes/${routeId}?businessAccountId=${business}`, { waitUntil: "domcontentloaded" });
    await ownerPage.getByText("Browser Route", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
    check("B10", "detail renders both stops", await ownerPage.getByText("Stop 1", { exact: true }).isVisible() && await ownerPage.getByText("Stop 2", { exact: true }).isVisible());
    check("B11", "draft owner sees acceptance action", await ownerPage.getByRole("button", { name: "Approve estimates and accept stops" }).isVisible());
    await ownerPage.getByRole("button", { name: "Approve estimates and accept stops" }).click();
    await ownerPage.getByText("Stop set frozen", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
    check("B12", "browser acceptance freezes Route state in PostgreSQL",
      sql(`select route_state from public.couranr_route_runs where id='${routeId}'`) === "accepted");
    check("B13", "browser acceptance atomically claims both child deliveries",
      sql(`select count(*) from public.couranr_route_run_claims where route_run_id='${routeId}'`) === "2");
    check("B14", "accepted UI does not claim booking/payment started",
      (await ownerPage.locator("body").innerText()).includes("Acceptance alone does not start payment, booking, driver reservation or pickup"));
    await ownerPage.getByText("Save a business card first", { exact: true }).waitFor({ state: "visible" });
    check("B23", "accepted Route requires a saved card before checkout",
      await ownerPage.getByRole("button", { name: "Confirm Route checkout" }).count() === 0);
    sql(`insert into public.couranr_business_payment_profiles(
      business_account_id,stripe_customer_id,stripe_customer_livemode,
      current_generation,default_payment_method_id,default_setup_intent_id,
      card_brand,card_last4)
      values('${business}','cus_rr003browser',false,1,
        'pm_rr003browser','seti_rr003browser','visa','4242')`);
    await ownerPage.reload({ waitUntil: "domcontentloaded" });
    await ownerPage.getByText(/Saved business card: visa ending in 4242/).waitFor({ state: "visible" });
    check("B24", "merchant sees only saved-card brand and last four",
      await ownerPage.getByText(/Saved business card: visa ending in 4242/).isVisible());
    check("B25", "checkout requires explicit separate-charge consent",
      await ownerPage.getByRole("button", { name: "Confirm Route checkout" }).isDisabled());
    check("B26", "rendering Route checkout calls no paid Stripe provider",
      stripeRequests.length === 0, String(stripeRequests.length));
    await ownerPage.screenshot({ path: path.join(SHOTS, "B-detail-accepted.png"), fullPage: true });

    const viewerPage = await signIn("rr002-browser-viewer@couranr.invalid", { width: 390, height: 844 });
    await viewerPage.goto(`${BASE}/app/business/routes/${routeId}?businessAccountId=${business}`, { waitUntil: "domcontentloaded" });
    await viewerPage.getByText("Browser Route", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
    check("B15", "viewer may inspect a Route Run", await viewerPage.getByText("Stop set frozen", { exact: true }).isVisible());
    check("B16", "viewer cannot accept/archive/reorder",
      await viewerPage.getByRole("button", { name: "Approve estimates and accept stops" }).count() === 0 &&
      await viewerPage.getByRole("button", { name: "Archive draft" }).count() === 0 &&
      await viewerPage.getByRole("button", { name: "Up" }).count() === 0);
    check("B17", "mobile Route detail has no horizontal overflow",
      await viewerPage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    await viewerPage.screenshot({ path: path.join(SHOTS, "B-detail-mobile.png"), fullPage: true });
    check("B18", "viewer cannot cancel accepted Route",
      await viewerPage.getByRole("button", { name: "Cancel accepted Route Run" }).count() === 0);
    check("B27", "viewer cannot start Route checkout",
      await viewerPage.getByRole("button", { name: "Confirm Route checkout" }).count() === 0);
    check("B28", "viewer sees unstarted checkout without a saved-card prompt",
      await viewerPage.getByText("Checkout has not started.", { exact: true }).isVisible() &&
      await viewerPage.getByText("Save a business card first", { exact: true }).count() === 0);
    await ownerPage.getByRole("button", { name: "Cancel accepted Route Run" }).click();
    check("B19", "owner sees release and no-payment consequence before cancellation",
      await ownerPage.getByRole("dialog").getByText(/releases the stops back to separate delivery drafts/i).isVisible());
    await ownerPage.getByRole("dialog").getByRole("button", { name: "Cancel accepted Route Run" }).click();
    await ownerPage.getByText("Route cancelled", { exact: true }).waitFor({ state: "visible" });
    check("B20", "browser cancellation preserves accepted Route history",
      sql(`select route_state||','||(accepted_at is not null)::text||','||(cancelled_at is not null)::text from public.couranr_route_runs where id='${routeId}'`) === "cancelled,true,true");
    check("B21", "browser cancellation releases both child claims",
      sql(`select count(*) from public.couranr_route_run_claims where route_run_id='${routeId}'`) === "0");
    await viewerPage.reload({ waitUntil: "domcontentloaded" });
    await viewerPage.getByText("Route cancelled", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
    check("B22", "viewer sees Cancelled distinctly from Archived",
      await viewerPage.getByText("Route cancelled", { exact: true }).isVisible() &&
      await viewerPage.getByText("Cancelled", { exact: true }).isVisible());
    await ownerPage.screenshot({ path: path.join(SHOTS, "B-detail-cancelled.png"), fullPage: true });

    // Exercise the authenticated checkout confirmation against real SQL while
    // intercepting ONLY the subsequent provider step. No Stripe call is made.
    const checkoutA = await child("browser-checkout-one", 1900, "31 Browser Stop Ln");
    const checkoutB = await child("browser-checkout-two", 2100, "32 Browser Stop Ln");
    const checkoutRoute = crypto.randomUUID();
    sql(`select public.couranr_save_route_run_draft(
      '${business}','${owner}','${checkoutRoute}',0,'${crypto.randomUUID()}',
      'Checkout browser route',array['${checkoutA.requestId}','${checkoutB.requestId}']::uuid[])`);
    sql(`select public.couranr_accept_route_run(
      '${business}','${owner}','${checkoutRoute}',1,'${crypto.randomUUID()}')`);
    let blockedProviderSteps = 0;
    await ownerPage.route("**/api/couranr/merchant/route-runs/checkout", async (route) => {
      const request = route.request();
      if (request.method() === "POST" && request.postDataJSON()?.action === "advance") {
        blockedProviderSteps++;
        await route.fulfill({ status: 409, contentType: "application/json",
          body: JSON.stringify({ ok: false, code: "conflict",
            message: "Disposable browser provider step intentionally blocked." }) });
      } else await route.continue();
    });
    await ownerPage.goto(`${BASE}/app/business/routes/${checkoutRoute}?businessAccountId=${business}`,
      { waitUntil: "domcontentloaded" });
    await ownerPage.getByRole("button", { name: "Confirm Route checkout" }).waitFor({ state: "visible" });
    await ownerPage.getByRole("checkbox").check();
    const beginResponse = ownerPage.waitForResponse((response) =>
      response.url().includes("/api/couranr/merchant/route-runs/checkout") &&
      response.request().method() === "POST" &&
      response.request().postDataJSON()?.action === "begin");
    const advanceResponse = ownerPage.waitForResponse((response) =>
      response.url().includes("/api/couranr/merchant/route-runs/checkout") &&
      response.request().method() === "POST" &&
      response.request().postDataJSON()?.action === "advance");
    await ownerPage.getByRole("button", { name: "Confirm Route checkout" }).click();
    const begun = await beginResponse;
    await advanceResponse;
    check("B29", "owner confirmation reaches the server checkout command", begun.ok());
    check("B30", "checkout stores one settlement and two exact child obligations",
      sql(`select count(*) from public.couranr_route_run_settlements
        where route_run_id='${checkoutRoute}'`) === "1" &&
      sql(`select count(*) from public.couranr_route_run_settlement_items i
        join public.couranr_route_run_settlements s on s.id=i.settlement_id
        where s.route_run_id='${checkoutRoute}'`) === "2");
    check("B31", "provider authorization was intercepted after durable checkout",
      blockedProviderSteps === 1, String(blockedProviderSteps));
    check("B32", "confirming checkout without advancing calls no live Stripe endpoint",
      stripeRequests.length === 0, String(stripeRequests.length));

    console.log(`Route Run Merchant Browser: ${passed}/${passed + failed} checks PASS.`);
    if (failed) process.exitCode = 1;
  } finally {
    for (const ctx of contexts) await ctx.close().catch(() => {});
    await browser?.close().catch(() => {});
    let cleanupResults;
    try {
      cleanupResults = await Promise.allSettled([
        stopChild(appServer, { group: true }),
        gateway?.server && new Promise((resolve) => gateway.server.close(resolve)),
        stopChild(pgrst),
      ]);
    } finally {
      down({ quiet: true });
      devDist.cleanup();
    }
    for (const [port, label] of [
      [PORT, "RR-002 Next server"],
      [GATEWAY_PORT, "RR-002 auth gateway"],
      [POSTGREST_PORT, "RR-002 PostgREST"],
      [Number(process.env.COURANR_DISPOSABLE_PORT || 55432), "RR-002 PostgreSQL"],
    ]) await waitForPortFree(port, label);
    const cleanupErrors = cleanupResults.filter((result) => result.status === "rejected");
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors.map((result) => result.reason), "RR-002 process cleanup failed");
    console.log("RR-002 cleanup: Next, gateway, PostgREST and PostgreSQL stopped; disposable build removed.");
  }
}

main().catch((error) => {
  if (error.stdout?.length) process.stderr.write(error.stdout);
  if (error.stderr?.length) process.stderr.write(error.stderr);
  console.error(error?.stack || error);
  try { down({ quiet: true }); } catch {}
  process.exit(1);
});

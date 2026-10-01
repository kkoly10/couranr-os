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
const PROOF_IMAGE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6pZ1cAAAAASUVORK5CYII=",
  "base64");
const signedUploads = new Map();
const storedProofBytes = new Map();
const sql = (q) => psql(q).trim();
const esc = (s) => String(s).replace(/'/g, "''");
let passed = 0;
let failed = 0;

function check(id, description, ok, detail = "") {
  ok ? passed++ : failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${description}${detail ? `  [${detail}]` : ""}`);
}
async function waitUntil(label, probe, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${label} did not converge in ${timeoutMs}ms`);
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

async function storageHandler(req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  const route = decodeURIComponent(url.pathname.slice("/storage/v1/".length));
  const send = (status, body) => {
    res.writeHead(status, { "content-type": "application/json",
      "access-control-allow-origin": "*" });
    res.end(JSON.stringify(body));
  };
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  const upload = route.match(/^object\/upload\/sign\/delivery-photos\/(.+)$/);
  if (upload && req.method === "POST") {
    if (req.headers.authorization !== `Bearer ${SERVICE_ROLE_JWT}`) return send(401, { error: "service role required" });
    const token = crypto.randomBytes(20).toString("base64url");
    signedUploads.set(token, upload[1]);
    return send(200, { url: `/${route}?token=${token}` });
  }
  if (upload && req.method === "PUT") {
    const token = url.searchParams.get("token");
    if (!token || signedUploads.get(token) !== upload[1]) return send(403, { error: "invalid signed upload" });
    if (!bytes.length || bytes.length > 10 * 1024 * 1024 ||
        req.headers["content-type"] !== "image/png") return send(415, { error: "invalid image" });
    signedUploads.delete(token);
    storedProofBytes.set(upload[1], bytes);
    sql(`insert into storage.objects(bucket_id,name,metadata) values(
      'delivery-photos','${esc(upload[1])}',
      jsonb_build_object('size',${bytes.length},'mimetype','image/png'))`);
    return send(200, { Key: `delivery-photos/${upload[1]}` });
  }
  if (route === "object/list/delivery-photos" && req.method === "POST") {
    if (req.headers.authorization !== `Bearer ${SERVICE_ROLE_JWT}`) return send(401, { error: "service role required" });
    const body = JSON.parse(bytes.toString() || "{}");
    const directory = String(body.prefix ?? "").replace(/\/$/, "");
    const search = String(body.search ?? "");
    const rows = JSON.parse(sql(`select coalesce(jsonb_agg(jsonb_build_object(
      'name',substring(name from length('${esc(directory)}')+2),'metadata',metadata)),
      '[]'::jsonb) from storage.objects where bucket_id='delivery-photos'
      and name like '${esc(`${directory}/%`)}'
      and name like '${esc(`%${search}%`)}'`));
    return send(200, rows);
  }
  const read = route.match(/^object\/sign\/delivery-photos\/(.+)$/);
  if (read && req.method === "POST") {
    if (req.headers.authorization !== `Bearer ${SERVICE_ROLE_JWT}`) return send(401, { error: "service role required" });
    if (!storedProofBytes.has(read[1])) return send(404, { error: "not found" });
    return send(200, { signedURL: `/object/authenticated/delivery-photos/${encodeURIComponent(read[1])}?token=disposable-read` });
  }
  return send(501, { error: "unsupported disposable storage action" });
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
    gateway = await startGateway({ storageHandler });

    const env = {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: gateway.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_JWT,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_JWT,
      PORT: String(PORT),
      NODE_ENV: "production",
      COURANR_HANDOFF_CODE_SECRET: crypto.randomBytes(48).toString("base64url"),
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
    const manager = makeUser("rr003-browser-manager@couranr.invalid");
    const billing = makeUser("rr003-browser-billing@couranr.invalid");
    const dispatcher = makeUser("rr003-browser-dispatcher@couranr.invalid");
    const former = makeUser("rr003-browser-former@couranr.invalid");
    const outsider = makeUser("rr003-browser-outsider@couranr.invalid");
    const demotedOwner = makeUser("rr003-browser-demoted-owner@couranr.invalid");
    const otherBusiness = sql("insert into public.business_accounts(name,status) values('RR003 Other Browser Shop','active') returning id");
    sql(`insert into public.business_members(business_account_id,user_id,role,status) values
      ('${business}','${owner}','owner','active'),
      ('${business}','${viewer}','viewer','active'),
      ('${business}','${manager}','manager','active'),
      ('${business}','${billing}','billing','active'),
      ('${business}','${dispatcher}','dispatcher','active'),
      ('${business}','${former}','viewer','disabled'),
      ('${business}','${demotedOwner}','owner','active'),
      ('${otherBusiness}','${outsider}','owner','active')`);

    const transport = psqlTransport(psql);
    const commonPickup = {
      line1: "10 Route Pickup Way",
      city: "Stafford",
      region: "VA",
      postalCode: "22554",
    };
    async function child(marker, subtotal, dropoffLine, declaredValueCents = 10000) {
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
        '${business}','${owner}','${seeded.requestId}',${seeded.version},${declaredValueCents}
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

    async function authenticatedToken(page) {
      // APIRequestContext shares cookies but canonical APIs require the Bearer
      // token that the browser client normally attaches. Read this disposable
      // user's @supabase/ssr session; never print or persist the token.
      const cookies = (await page.context().cookies()).filter((cookie) =>
        /^sb-.*-auth-token(?:\.\d+)?$/.test(cookie.name));
      cookies.sort((left, right) => {
        const sequence = (cookie) => Number(cookie.name.match(/\.(\d+)$/)?.[1] ?? 0);
        return sequence(left) - sequence(right);
      });
      const encoded = cookies.map((cookie) => cookie.value).join("");
      if (!encoded.startsWith("base64-")) throw new Error("authenticated browser session missing");
      const session = JSON.parse(Buffer.from(encoded.slice(7), "base64url").toString());
      if (!session.access_token) throw new Error("authenticated browser token missing");
      return session.access_token;
    }

    async function authenticatedPost(page, pathname, body) {
      return page.request.post(`${BASE}${pathname}`, {
        headers: { authorization: `Bearer ${await authenticatedToken(page)}` },
        ...(body === undefined ? {} : { data: body }),
      });
    }
    async function authenticatedGet(page, pathname) {
      return page.request.get(`${BASE}${pathname}`, {
        headers: { authorization: `Bearer ${await authenticatedToken(page)}` },
      });
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
      await viewerPage.getByText("Route payment has not started.", { exact: true }).isVisible() &&
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

    // Post-checkout read authority: use real authenticated GET responses, not
    // component stubs. No role below is allowed to advance the provider step.
    const checkoutPath = `/api/couranr/merchant/route-runs/checkout?businessAccountId=${business}&routeRunId=${checkoutRoute}`;
    const checkoutProjection = JSON.parse(sql(`select public.couranr_read_route_run_settlement(
      '${business}','${owner}','${checkoutRoute}')`));
    const ownerRead = await authenticatedGet(ownerPage, checkoutPath);
    const ownerStatus = await ownerRead.json();
    check("B65", "owner after checkout reads exact card and Route total",
      ownerRead.ok() && ownerStatus.progress?.kind === "billing" &&
      ownerStatus.progress.settlement.card.last4 === "4242" &&
      ownerStatus.progress.settlement.referenceTotalCents === 4000 &&
      ownerStatus.access.authorizeRoute === true);
    const managerPage = await signIn("rr003-browser-manager@couranr.invalid");
    const managerRead = await authenticatedGet(managerPage, checkoutPath);
    const managerStatus = await managerRead.json();
    check("B66", "manager after checkout reads billing and retains authorize capability",
      managerRead.ok() && managerStatus.progress?.kind === "billing" &&
      managerStatus.progress.settlement.card.last4 === "4242" &&
      managerStatus.access.authorizeRoute === true);
    const billingPage = await signIn("rr003-browser-billing@couranr.invalid");
    const billingRead = await authenticatedGet(billingPage, checkoutPath);
    const billingStatus = await billingRead.json();
    check("B67", "billing contact reads billing truth without authorization",
      billingRead.ok() && billingStatus.progress?.kind === "billing" &&
      billingStatus.progress.settlement.card.last4 === "4242" &&
      billingStatus.access.authorizeRoute === false);
    const billingPost = await authenticatedPost(billingPage,
      "/api/couranr/merchant/route-runs/checkout",
      { businessAccountId: business, routeRunId: checkoutRoute, action: "advance" });
    check("B68", "billing contact cannot advance Route money", billingPost.status() === 403);
    await billingPage.goto(`${BASE}/app/business/routes/${checkoutRoute}?businessAccountId=${business}`,
      { waitUntil: "domcontentloaded" });
    await billingPage.getByText(/visa ending in 4242/).waitFor({ state: "visible" });
    check("B69", "billing UI is read-only despite full billing read",
      await billingPage.getByRole("button", { name: "Continue Route checkout" }).count() === 0);

    const forbiddenBilling = ["4242", "visa", checkoutProjection.settlementId,
      ...checkoutProjection.items.map((item) => item.obligationId),
      "obligationId", "providerPaymentIntentId", "paymentMethodId", "SetupIntent",
      "customerId", "settlementId", "amountCents"];
    const dispatcherPage = await signIn("rr003-browser-dispatcher@couranr.invalid");
    for (const [label, page, number] of [
      ["dispatcher", dispatcherPage, "B70"], ["viewer", viewerPage, "B71"],
    ]) {
      const status = await authenticatedGet(page, checkoutPath);
      const payload = await status.text();
      check(number, `${label} GET after checkout has only operational status`,
        status.ok() && JSON.parse(payload).progress?.kind === "operational" &&
        JSON.parse(payload).progress?.status === "payment_pending" &&
        forbiddenBilling.every((secret) => !payload.includes(secret)));
      await page.goto(`${BASE}/app/business/routes/${checkoutRoute}?businessAccountId=${business}`,
        { waitUntil: "domcontentloaded" });
      await page.getByText("Route payment is being prepared.", { exact: true })
        .waitFor({ state: "visible", timeout: 30_000 });
      check(label === "dispatcher" ? "B72" : "B73",
        `${label} rendered Route has no card evidence or payment controls`,
        !(await page.locator("body").innerText()).includes("4242") &&
        await page.getByRole("button", { name: "Continue Route checkout" }).count() === 0 &&
        await page.getByText("Save a business card first", { exact: true }).count() === 0);
    }
    const formerPage = await signIn("rr003-browser-former@couranr.invalid");
    const outsiderPage = await signIn("rr003-browser-outsider@couranr.invalid");
    check("B74", "inactive/former member receives no settlement or operational read",
      (await authenticatedGet(formerPage, checkoutPath)).status() === 403);
    check("B75", "cross-business member receives no Route checkout data",
      (await authenticatedGet(outsiderPage, checkoutPath)).status() === 403);
    const demotedPage = await signIn("rr003-browser-demoted-owner@couranr.invalid");
    const beforeDemotion = await authenticatedGet(demotedPage, checkoutPath);
    check("B76", "active owner has billing read before role change",
      (await beforeDemotion.json()).progress?.kind === "billing");
    sql(`update public.business_members set role='viewer' where business_account_id='${business}'
      and user_id='${demotedOwner}'`);
    const afterDemotion = await authenticatedGet(demotedPage, checkoutPath);
    const afterPayload = await afterDemotion.text();
    check("B77", "next GET after owner-to-viewer downgrade loses billing immediately",
      afterDemotion.ok() && JSON.parse(afterPayload).progress?.kind === "operational" &&
      forbiddenBilling.every((secret) => !afterPayload.includes(secret)));
    await demotedPage.goto(`${BASE}/app/business/routes/${checkoutRoute}?businessAccountId=${business}`,
      { waitUntil: "domcontentloaded" });
    await demotedPage.getByText("Route payment is being prepared.", { exact: true })
      .waitFor({ state: "visible", timeout: 30_000 });
    check("B78", "downgraded owner's refreshed page is operational-only",
      !(await demotedPage.locator("body").innerText()).includes("4242"));

    // RR-004 authenticated physical choreography. Payment/proof rows are
    // disposable provider/evidence doubles: the browser exercises Route
    // task authority, not a claim of real Stripe, PIN, or photo verification.
    const execA = await child("browser-execution-one", 2000, "41 Browser Stop Ln", 1000);
    const execB = await child("browser-execution-two", 2000, "42 Browser Stop Ln", 1000);
    const executionRoute = crypto.randomUUID();
    sql(`select public.couranr_save_route_run_draft('${business}','${owner}',
      '${executionRoute}',0,'${crypto.randomUUID()}','Execution browser route',
      array['${execA.requestId}','${execB.requestId}']::uuid[])`);
    sql(`select public.couranr_accept_route_run('${business}','${owner}',
      '${executionRoute}',1,'${crypto.randomUUID()}')`);
    const execCheckout = JSON.parse(sql(`select public.couranr_begin_route_run_checkout(
      '${business}','${owner}','${executionRoute}',1,'${crypto.randomUUID()}')`));
    for (const item of execCheckout.items) {
      sql(`select public.couranr_begin_route_child_authorization(
        '${business}','${owner}','${executionRoute}','${item.obligationId}')`);
      sql(`select id from public.couranr_attach_payment_intent(
        '${item.obligationId}',${item.obligationVersion},'pi_rr004browser${item.sequence}')`);
      const metadata = JSON.stringify({ paymentObligationId: item.obligationId,
        couranrRequestId: item.requestId, businessAccountId: business,
        quoteVersionId: item.quoteVersionId, payerType: "merchant",
        pricingPolicyVersion: "couranr-pricing-v2-2026-09-01" }).replaceAll("'", "''");
      sql(`select outcome from public.couranr_apply_payment_intent_state(
        'rr004browser-auth-${item.sequence}',
        'payment_intent.amount_capturable_updated',
        'pi_rr004browser${item.sequence}','requires_capture',
        ${item.amountCents},${item.amountCents},'usd','${metadata}'::jsonb,now())`);
    }
    sql(`select public.couranr_sync_route_run_settlement('${business}',
      '${owner}','${executionRoute}',false)`);
    sql(`select public.couranr_confirm_route_pickup_ready('${business}',
      '${owner}','${executionRoute}',1,true)`);
    const routeDriverUser = makeUser("rr004-browser-driver@couranr.invalid", "driver");
    const routeOps = makeUser("rr004-browser-ops@couranr.invalid", "admin");
    const routeDriver = sql(`insert into public.couranr_drivers(
      user_id,display_name,driver_state,availability_state,active,market)
      values('${routeDriverUser}','RR004 Browser Driver','active','available',true,
        'dc_va_launch_corridor') returning id`);
    const routeVehicle = sql(`insert into public.couranr_dispatch_vehicles(
      name,vehicle_class,payload_capacity_lb,active,availability_state)
      values('RR004 Browser Van','van',100,true,'available') returning id`);
    sql(`select public.couranr_reserve_route_run_resource('${business}',
      '${owner}','${executionRoute}',now())`);
    sql(`select public.couranr_confirm_route_service_plans('${business}',
      '${owner}','${executionRoute}',1)`);
    sql(`select public.couranr_begin_route_run_capture('${business}',
      '${owner}','${executionRoute}',1)`);
    const execDeliveries = [];
    for (const item of execCheckout.items) {
      sql(`select id from public.couranr_begin_route_child_capture(
        '${business}','${owner}','${executionRoute}','${item.obligationId}')`);
      sql(`select outcome from public.couranr_complete_payment_capture(
        '${item.obligationId}','rr004browser-capture-${item.sequence}',
        'pi_rr004browser${item.sequence}','succeeded',${item.amountCents},'usd')`);
      execDeliveries.push(sql(`select id from public.couranr_create_delivery_from_capture(
        '${item.requestId}')`));
    }
    sql(`select public.couranr_complete_route_run_funding('${business}',
      '${owner}','${executionRoute}')`);
    const executionId = JSON.parse(sql(`select public.couranr_begin_route_execution(
      '${business}','${owner}','${executionRoute}')`)).executionId;
    const routeDriverPage = await signIn("rr004-browser-driver@couranr.invalid",
      { width: 390, height: 844 });
    await routeDriverPage.context().grantPermissions(["geolocation"]);
    await routeDriverPage.context().setGeolocation({ latitude: 38.3, longitude: -77.4 });
    await routeDriverPage.goto(`${BASE}/driver`, { waitUntil: "domcontentloaded" });
    await routeDriverPage.getByText("Execution browser route", { exact: true })
      .waitFor({ state: "visible", timeout: 30_000 });
    check("B33", "driver sees one Route task with both separate packages",
      await routeDriverPage.getByText(/One pickup · 2 separate deliveries/).isVisible() &&
      await routeDriverPage.getByText(/Package browser-execution-one/).isVisible() &&
      await routeDriverPage.getByText(/Package browser-execution-two/).isVisible());
    await routeDriverPage.getByRole("button", { name: "Start route to pickup" }).click();
    await waitUntil("shared pickup leg", () => sql(`select count(*) from
      public.couranr_deliveries where route_run_id='${executionRoute}'
      and fulfillment_state='en_route_to_pickup'`) === "2");
    check("B34", "one browser action starts both child pickup legs",
      sql(`select count(*) from public.couranr_deliveries where route_run_id='${executionRoute}'
        and fulfillment_state='en_route_to_pickup'`) === "2");
    await routeDriverPage.getByRole("button", { name: "Capture pickup location" }).click();
    await routeDriverPage.getByRole("button", { name: "Confirm arrival at pickup" })
      .waitFor({ state: "visible" });
    await routeDriverPage.getByRole("button", { name: "Confirm arrival at pickup" }).click();
    await waitUntil("shared pickup arrival", () => sql(`select count(*) from
      public.couranr_deliveries where route_run_id='${executionRoute}'
      and fulfillment_state='at_pickup'`) === "2");
    await routeDriverPage.getByRole("link", { name: "Record child pickup" }).first()
      .waitFor({ state: "visible" });
    check("B35", "one evidenced browser arrival reaches both children",
      sql(`select count(*) from public.couranr_deliveries where route_run_id='${executionRoute}'
        and fulfillment_state='at_pickup'`) === "2");
    check("B36", "driver sees both child pickup actions",
      await routeDriverPage.getByRole("link", { name: "Record child pickup" }).count() === 2);
    check("B37", "departure stays disabled before per-child custody proof",
      await routeDriverPage.getByRole("button", { name: "Depart with verified packages" }).isDisabled());
    const opsRoutePage = await signIn("rr004-browser-ops@couranr.invalid");
    await opsRoutePage.goto(`${BASE}/operations/deliveries/${execA.requestId}`,
      { waitUntil: "domcontentloaded" });
    await opsRoutePage.getByText("Route Run · Execution browser route", { exact: true })
      .waitFor({ state: "visible", timeout: 30_000 });
    check("B38", "Operations sees one Route with payment and shared resource truth",
      (await opsRoutePage.locator("body").innerText()).includes("Settlement: ready for execution") &&
      (await opsRoutePage.locator("body").innerText()).includes("Resource: committed"));
    check("B39", "Route physical browser has called no live provider",
      stripeRequests.length === 0 && providerRequests.length === 0);
    for (const [index, deliveryId] of execDeliveries.entries()) {
      const issued = await authenticatedPost(ownerPage,
        `/api/couranr/merchant/deliveries/${deliveryId}/pickup-code`);
      check(`B${40 + index * 4}`, `sender can issue Stop ${index + 1} pickup-only credential`,
        issued.ok());
      const code = (await issued.json()).handoffCode?.code;
      if (!/^\d{6}$/.test(String(code))) throw new Error("pickup code was not issued");
      await routeDriverPage.goto(`${BASE}/driver/deliveries/${deliveryId}`,
        { waitUntil: "domcontentloaded" });
      await routeDriverPage.getByRole("button", { name: "Enter six-digit code instead" })
        .waitFor({ state: "visible" });
      await routeDriverPage.getByRole("button", { name: "Share location" }).click();
      await routeDriverPage.getByRole("button", { name: "Enter six-digit code instead" }).click();
      await routeDriverPage.getByLabel("Pickup code").fill(code);
      await routeDriverPage.getByRole("button", { name: "Verify code" }).click();
      await routeDriverPage.getByText("Sender verified").waitFor({ state: "visible" });
      check(`B${41 + index * 4}`, `Stop ${index + 1} accepts only its pickup credential`,
        sql(`select count(*) from public.couranr_handoff_codes
          where delivery_id='${deliveryId}' and code_kind='merchant_pickup'
            and code_state='consumed'`) === "1");
      await routeDriverPage.getByLabel("Photo of the pickup").setInputFiles({
        name: `synthetic-route-pickup-${index + 1}.png`, mimeType: "image/png",
        buffer: PROOF_IMAGE,
      });
      await waitUntil(`Stop ${index + 1} pickup proof`, () => sql(`select count(*) from
        public.couranr_delivery_proofs where delivery_id='${deliveryId}'
          and proof_stage='pickup'`) === "1", 30_000);
      check(`B${42 + index * 4}`, `Stop ${index + 1} photo is child-scoped`, true);
      await routeDriverPage.getByRole("button", { name: "Confirm pickup" }).click();
      await waitUntil(`Stop ${index + 1} custody`, () => sql(`select fulfillment_state from
        public.couranr_deliveries where id='${deliveryId}'`) === "picked_up");
      check(`B${43 + index * 4}`, `Stop ${index + 1} pickup transfers only that child custody`,
        sql(`select count(*) from public.couranr_handoff_records
          where delivery_id='${deliveryId}' and handoff_stage='pickup'`) === "1");
    }
    await routeDriverPage.goto(`${BASE}/driver`, { waitUntil: "domcontentloaded" });
    await routeDriverPage.getByRole("button", { name: "Depart with verified packages" })
      .waitFor({ state: "visible" });
    await routeDriverPage.getByRole("button", { name: "Depart with verified packages" }).click();
    await waitUntil("Route custody departure", () => sql(`select count(*) from
      public.couranr_deliveries where route_run_id='${executionRoute}'
        and fulfillment_state='in_transit'`) === "2");
    check("B48", "one departure places both verified children in transit",
      sql(`select current_sequence from public.couranr_route_run_executions
        where id='${executionId}'`) === "1");
    await routeDriverPage.goto(`${BASE}/driver/deliveries/${execDeliveries[1]}`,
      { waitUntil: "domcontentloaded" });
    await routeDriverPage.getByText(/Stop 2/).first().waitFor({ state: "visible" });
    check("B49", "later child has no out-of-order drop-off action",
      await routeDriverPage.getByRole("button", { name: "I have arrived at drop-off" }).count() === 0);
    for (const [index, deliveryId] of execDeliveries.entries()) {
      const codeResponse = await authenticatedPost(ownerPage,
        `/api/couranr/merchant/deliveries/${deliveryId}/recipient-code`);
      check(`B${50 + index * 6}`, `sender issues Stop ${index + 1} recipient-only credential after custody`,
        codeResponse.ok());
      const recipientCode = (await codeResponse.json()).handoffCode?.code;
      if (!/^\d{6}$/.test(String(recipientCode))) throw new Error("recipient code was not issued");
      await routeDriverPage.goto(`${BASE}/driver/deliveries/${deliveryId}`,
        { waitUntil: "domcontentloaded" });
      const arrive = routeDriverPage.getByRole("button", { name: "I have arrived at drop-off" });
      await arrive.waitFor({ state: "visible" });
      await routeDriverPage.getByRole("button", { name: "Share location" }).click();
      await waitUntil(`Stop ${index + 1} drop-off location`, () => arrive.isEnabled());
      await arrive.click();
      await waitUntil(`Stop ${index + 1} drop-off arrival`, () => sql(`select fulfillment_state
        from public.couranr_deliveries where id='${deliveryId}'`) === "at_dropoff");
      check(`B${51 + index * 6}`, `driver reaches only current Stop ${index + 1}`, true);
      await routeDriverPage.getByLabel("Six-digit recipient code").fill(recipientCode);
      await routeDriverPage.getByRole("button", { name: "Check code" }).click();
      await routeDriverPage.getByText("Code accepted", { exact: true }).waitFor();
      check(`B${52 + index * 6}`, `Stop ${index + 1} recipient credential verifies`, true);
      await routeDriverPage.getByLabel("First name of the person taking the shipment")
        .fill("Disposable");
      await routeDriverPage.getByRole("button", { name: "Complete handoff" }).click();
      await waitUntil(`Stop ${index + 1} delivered`, () => sql(`select fulfillment_state
        from public.couranr_deliveries where id='${deliveryId}'`) === "delivered");
      check(`B${53 + index * 6}`, `Stop ${index + 1} has one recipient handoff and delivery proof`,
        sql(`select count(*) from public.couranr_handoff_codes where delivery_id='${deliveryId}'
          and code_kind='recipient_dropoff' and code_state='consumed'`) === "1" &&
        sql(`select count(*) from public.couranr_delivery_proofs where delivery_id='${deliveryId}'
          and proof_stage='dropoff'`) === "1");
      check(`B${54 + index * 6}`, `Stop ${index + 1} has not prematurely released Route resources`,
        sql(`select resource_state from public.couranr_route_run_resource_reservations
          where route_run_id='${executionRoute}'`) === "committed" &&
        sql(`select availability_state from public.couranr_drivers
          where id='${routeDriver}'`) === "on_delivery");
      await routeDriverPage.goto(`${BASE}/driver`, { waitUntil: "domcontentloaded" });
      const advance = routeDriverPage.getByRole("button", {
        name: "Continue to next stop or finish Route" });
      await advance.waitFor({ state: "visible" });
      await advance.click();
      await waitUntil(index === 0 ? "Route advanced to Stop 2" : "Route completed",
        () => sql(`select ${index === 0 ? "current_sequence" : "execution_state"}
          from public.couranr_route_run_executions where id='${executionId}'`) ===
          (index === 0 ? "2" : "completed"));
      check(`B${55 + index * 6}`, index === 0
        ? "Stop 1 advances to Stop 2 without releasing the shared resource"
        : "last Stop completes the Route", true);
    }
    check("B62", "Route terminal command releases driver and vehicle exactly once",
      sql(`select resource_state from public.couranr_route_run_resource_reservations
        where route_run_id='${executionRoute}'`) === "released" &&
      sql(`select availability_state from public.couranr_drivers where id='${routeDriver}'`) === "available" &&
      sql(`select availability_state from public.couranr_dispatch_vehicles where id='${routeVehicle}'`) === "available" &&
      sql(`select count(*) from public.couranr_route_run_execution_events
        where execution_id='${executionId}' and event_type='resource_released'`) === "1");
    check("B63", "all Route children retain separate exact commercial and custody records",
      sql(`select count(distinct payment_obligation_id) from public.couranr_deliveries
        where route_run_id='${executionRoute}'`) === "2" &&
      sql(`select count(*) from public.couranr_delivery_events e
        join public.couranr_deliveries d on d.id=e.delivery_id
        where d.route_run_id='${executionRoute}' and e.to_state='delivered'`) === "2");
    await ownerPage.goto(`${BASE}/app/business/routes/${executionRoute}?businessAccountId=${business}`,
      { waitUntil: "domcontentloaded" });
    await ownerPage.getByText("Route completed", { exact: true })
      .waitFor({ state: "visible" });
    check("B64", "merchant Route detail shows terminal resource and each child outcome",
      await ownerPage.getByText("Stop 1: delivered", { exact: true }).isVisible() &&
      await ownerPage.getByText("Stop 2: delivered", { exact: true }).isVisible() &&
      (await ownerPage.locator("body").innerText()).includes("Shared resource: released"));
    void routeOps; void routeDriver; void routeVehicle;

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

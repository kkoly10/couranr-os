/**
 * One disposable, cross-actor Same Day journey from /send. No production data,
 * provider spend, real email, or real money. A passing result is simulated
 * software evidence, never a claim that a human physically moved a parcel.
 *
 * Run with COURANR_PGBIN and COURANR_DISPOSABLE_DIR on macOS, as in up.mjs.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { rmSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { up, down, psql, dbUrl } from "./up.mjs";
import { startPostgrest, startGateway, waitForPostgrest, SERVICE_ROLE_JWT, ANON_JWT } from "./gateway.mjs";
import { postgrestTarget } from "../../scripts/provisionPostgrest.mjs";
import { startStripeDouble, calls as stripeCalls } from "../stripeDouble.mjs";
import { claimDevDistDir } from "../devDistDir.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASE_DIR = process.env.COURANR_DISPOSABLE_DIR || "/var/lib/postgresql/couranr-disposable";
const PORT = 3318;
// Next dev's origin guard distinguishes localhost from 127.0.0.1.
const BASE = `http://localhost:${PORT}`;
const MAIL_PORT = 55439;
const STRIPE_PORT = 12118;
const one = (query) => psql(query).trim();
const lit = (value) => `'${String(value).replace(/'/g, "''")}'`;
const require = createRequire(import.meta.url);
const chromium = require("playwright").chromium;
const emailBodies = [];
const sentEmailByKey = new Map();
const signedUploads = new Map();
const storedProofBytes = new Map();
let passed = 0;
let failed = 0;

function check(name, yes, detail = "") {
  yes ? passed++ : failed++;
  console.log(`  ${yes ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function seedActor(role, name, password) {
  const email = `sameday-${name}-${crypto.randomBytes(3).toString("hex")}@example.test`;
  const id = one(`insert into auth.users(email) values(${lit(email)}) returning id`);
  one(`insert into public.profiles(id,email,role) values('${id}',${lit(email)},${lit(role)})
       on conflict(id) do update set role=excluded.role`);
  one(`select public.couranr_disposable_set_password('${id}',${lit(password)})`);
  return { id, email };
}

async function waitUntil(label, probe, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not become true in ${timeoutMs}ms`);
}

async function storageHandler(req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  const prefix = "/storage/v1/";
  const route = decodeURIComponent(url.pathname.slice(prefix.length));
  const send = (status, body) => {
    res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify(body));
  };
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  const signedPath = route.match(/^object\/upload\/sign\/delivery-photos\/(.+)$/);
  if (signedPath && req.method === "POST") {
    if (req.headers.authorization !== `Bearer ${SERVICE_ROLE_JWT}`) return send(401, { error: "service role required" });
    const token = crypto.randomBytes(20).toString("base64url");
    signedUploads.set(token, signedPath[1]);
    console.log("  disposable Storage: signed proof upload issued");
    // storage-js concatenates its /storage/v1 base with this relative path.
    return send(200, { url: `/${route}?token=${token}` });
  }
  if (signedPath && req.method === "PUT") {
    console.log(`  disposable Storage: PUT bytes=${bytes.length} mime=${req.headers["content-type"]}`);
    const token = url.searchParams.get("token");
    if (!token || signedUploads.get(token) !== signedPath[1]) return send(403, { error: "invalid signed upload" });
    if (!bytes.length || bytes.length > 10 * 1024 * 1024) return send(413, { error: "invalid proof bytes" });
    const mime = String(req.headers["content-type"] ?? "");
    if (!["image/jpeg", "image/png", "image/webp", "image/heic"].includes(mime)) return send(415, { error: "invalid proof MIME" });
    signedUploads.delete(token);
    storedProofBytes.set(signedPath[1], bytes);
    one(`insert into storage.objects(bucket_id,name,metadata)
      values('delivery-photos',${lit(signedPath[1])},jsonb_build_object('size',${bytes.length},'mimetype',${lit(mime)}))`);
    return send(200, { Key: `delivery-photos/${signedPath[1]}` });
  }
  if (route === "object/list/delivery-photos" && req.method === "POST") {
    console.log("  disposable Storage: listing proof metadata");
    if (req.headers.authorization !== `Bearer ${SERVICE_ROLE_JWT}`) return send(401, { error: "service role required" });
    const body = JSON.parse(bytes.toString() || "{}");
    const directory = String(body.prefix ?? "").replace(/\/$/, "");
    const search = String(body.search ?? "");
    const rows = JSON.parse(one(`select coalesce(jsonb_agg(jsonb_build_object(
      'name',substring(name from length(${lit(directory)})+2),'metadata',metadata)), '[]'::jsonb)
      from storage.objects where bucket_id='delivery-photos'
      and name like ${lit(`${directory}/%`)} and name like ${lit(`%${search}%`)}`));
    return send(200, rows);
  }
  const readPath = route.match(/^object\/sign\/delivery-photos\/(.+)$/);
  if (readPath && req.method === "POST") {
    if (req.headers.authorization !== `Bearer ${SERVICE_ROLE_JWT}`) return send(401, { error: "service role required" });
    if (!storedProofBytes.has(readPath[1])) return send(404, { error: "not found" });
    return send(200, { signedURL: `/object/authenticated/delivery-photos/${encodeURIComponent(readPath[1])}?token=disposable-read` });
  }
  return send(501, { error: `disposable Storage endpoint not implemented: ${req.method} ${route}` });
}

async function main() {
  let pgrst, gateway, stripe, mail, next, browser;
  const dist = claimDevDistDir("sameday-browser-journey");
  const clockDir = mkdtempSync(path.join(os.tmpdir(), "couranr-clock-"));
  const clockFile = path.join(clockDir, "now.txt");
  const password = `E2E-${crypto.randomBytes(24).toString("base64url")}-Aa1!`;
  try {
    console.log("Same Day disposable browser journey\n");
    const info = up({ quiet: true });
    console.log(`  ${info.migrationsApplied} forward migrations applied`);
    pgrst = await startPostgrest({ dbUrl: dbUrl(), binary: postgrestTarget(), workDir: path.join(BASE_DIR, "pgrst-sameday") });
    if (!(await waitForPostgrest())) throw new Error("PostgREST did not start");
    gateway = await startGateway({ storageHandler });
    stripe = await startStripeDouble(STRIPE_PORT);
    mail = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString()); }
      catch { res.writeHead(400); res.end(); return; }
      const key = String(req.headers["idempotency-key"] ?? "");
      const earlier = key ? sentEmailByKey.get(key) : null;
      if (earlier) {
        if (earlier.payload !== JSON.stringify(body)) {
          res.writeHead(409, { "content-type": "application/json" });
          res.end(JSON.stringify({ name: "invalid_idempotent_request", message: "Idempotency key reused with a different payload" }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: earlier.id }));
        return;
      }
      emailBodies.push(body);
      if (String(body.subject ?? "").includes("Confirmed — your Couranr delivery")) {
        console.log(`  disposable mail: sender confirmation key=${key || "<none>"}`);
      }
      const id = `email_disposable_${emailBodies.length}`;
      if (key) sentEmailByKey.set(key, { payload: JSON.stringify(body), id });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id }));
    });
    await new Promise((resolve) => mail.listen(MAIL_PORT, "127.0.0.1", resolve));

    const ops = seedActor("admin", "ops", password);
    const driver = seedActor("driver", "driver", password);
    const driverId = one(`insert into public.couranr_drivers(user_id,display_name,driver_state,active)
      values('${driver.id}','Disposable driver','active',true) returning id`);
    const vehicleId = one(`insert into public.couranr_dispatch_vehicles(name,vehicle_class,payload_capacity_lb,assigned_driver_id)
      values('Disposable van','van',2000,'${driverId}') returning id`);

    const env = {
      ...process.env,
      // Stripe's local API-base override intentionally refuses NODE_ENV=production.
      NODE_ENV: "development",
      VERCEL_ENV: "development",
      NEXT_PUBLIC_SUPABASE_URL: gateway.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_JWT,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_JWT,
      STRIPE_SECRET_KEY: "sk_test_disposable_only",
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_disposable_only",
      STRIPE_API_BASE: `http://127.0.0.1:${STRIPE_PORT}`,
      COURANR_HANDOFF_CODE_SECRET: crypto.randomBytes(48).toString("base64url"),
      GOOGLE_MAPS_SERVER_API_KEY: "disposable-google-key",
      MAPBOX_ACCESS_TOKEN: "disposable-mapbox-token",
      COURANR_ALLOW_PAID_PROVIDER_CALLS: "true",
      RESEND_API_KEY: "disposable-resend-key",
      COURANR_EMAIL_SEND: "live",
      COURANR_EMAIL_REDIRECT_TO: "disposable-inbox@example.test",
      COURANR_E2E_PROVIDER_DOUBLE: "1",
      COURANR_E2E_CLOCK_FILE: clockFile,
      COURANR_E2E_MAIL_SINK: `http://127.0.0.1:${MAIL_PORT}/emails`,
      CRON_SECRET: "disposable-automation-secret",
      NODE_OPTIONS: `--require ${path.join(ROOT, "e2e/disposable/sameDayProviderDouble.cjs")}`,
    };
    console.log("  starting Next dev against disposable services...");
    next = spawn("npx", ["next", "dev", "-p", String(PORT)], {
      cwd: ROOT,
      env: { ...env, COURANR_DIST_DIR: dist.rel },
      stdio: "inherit",
      detached: true,
    });
    await waitUntil("Next server", async () => {
      try { return (await fetch(BASE, { redirect: "manual" })).status < 500; }
      catch { return false; }
    }, 90_000);
    // Compile the guest address route before the browser begins its debounced
    // search; cold Turbopack compile can otherwise outlive the picker timeout.
    await fetch(`${BASE}/api/couranr/consumer/places?query=warmup`);

    browser = await chromium.launch({ channel: "chrome", args: ["--no-proxy-server"] });
    const sender = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const senderTab = await sender.newPage();
    senderTab.on("pageerror", (error) => console.log(`  browser error: ${String(error.message).slice(0, 180)}`));
    senderTab.on("response", async (response) => {
      if (response.url().includes("/api/couranr/consumer/places")) {
        console.log(`  Places response: ${response.status()} ${String(await response.text().catch(() => "")).slice(0, 260)}`);
      }
    });
    senderTab.on("requestfailed", (request) => {
      if (request.url().includes("stripe")) console.log(`  Stripe browser request failed: ${request.url().split("?")[0]} ${request.failure()?.errorText}`);
    });
    const stripeJsMock = readFileSync(path.join(ROOT, "e2e/stripeJsMock.js"), "utf8");
    await senderTab.route("**://js.stripe.com/**", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: stripeJsMock }));
    await senderTab.addInitScript(([base]) => { window.__couranrDoubleBase = base; }, [`http://127.0.0.1:${STRIPE_PORT}`]);
    await senderTab.goto(`${BASE}/send?intent=send`, { waitUntil: "domcontentloaded" });
    await senderTab.locator('[data-couranr-send="trip"]').waitFor();
    // The SSR input exists before React attaches its controlled-input tracker.
    // Typing during that interval is discarded on hydration (observed twice).
    await senderTab.waitForFunction(() => Boolean(document.querySelector("#send-pickup")?._valueTracker));
    check("/send is live, not a fixture", await senderTab.locator('[data-couranr-send="trip"]').count() === 1);

    for (const [selector, query, expected] of [
      ["#send-pickup", "100 Test", "100 Test Pickup Street"],
      ["#send-destination", "200 Test", "200 Test Dropoff Avenue"],
    ]) {
      let selected = false;
      for (let attempt = 0; attempt < 3 && !selected; attempt++) {
        await senderTab.locator(selector).fill("");
        await senderTab.locator(selector).fill(query);
        try {
          await senderTab.getByRole("option", { name: new RegExp(expected) }).click({ timeout: 20_000 });
          selected = true;
        } catch (error) {
          const state = await senderTab.locator(`[data-couranr-address="${selector.slice(1)}"]`).getAttribute("data-state");
          console.log(`  address retry ${attempt + 1}: ${state}, gateway=${(await fetch(gateway.url).catch(() => ({ status: 0 }))).status}`);
          if (attempt === 2) throw error;
        }
      }
    }
    check("two server-suggested Place IDs selected", await senderTab.locator('[data-couranr-availability="selected"]').count() === 1);
    await senderTab.getByRole("button", { name: "Continue" }).click();
    await senderTab.locator("#send-item").fill("One sealed box of books");
    await senderTab.locator("#send-package-count").fill("1");
    await senderTab.locator("#send-weight-lb").fill("5");
    await senderTab.locator("#send-restricted").selectOption("none");
    await senderTab.locator("#send-declared-value").fill("20");
    await senderTab.getByLabel(/Yes, it’s ready to hand over/).check();
    await senderTab.getByRole("button", { name: "Continue" }).click();
    await senderTab.getByLabel(/As soon as possible/i).check();
    await senderTab.getByRole("button", { name: "Continue" }).click();

    const senderEmail = "disposable.sender@example.test";
    const recipientEmail = "disposable.recipient@example.test";
    await senderTab.getByLabel("Name", { exact: true }).fill("Disposable Sender");
    await senderTab.getByLabel("Email", { exact: true }).fill(senderEmail);
    await senderTab.getByLabel("Recipient name").fill("Disposable Recipient");
    await senderTab.getByLabel("Recipient email", { exact: true }).fill(recipientEmail);
    await senderTab.getByLabel("Confirm recipient email").fill(recipientEmail);
    await senderTab.getByRole("button", { name: "Check the price" }).click();
    await senderTab.locator('[data-couranr-quote="live-available"]').waitFor({ timeout: 30_000 });
    const requestId = one("select id from public.couranr_delivery_requests where requester_kind='consumer' order by created_at desc limit 1");
    const quoteId = one(`select current_quote_version_id from public.couranr_delivery_requests where id='${requestId}'`);
    check("/send created one canonical Consumer request and immutable quote", Boolean(requestId && quoteId));
    check("quote uses server-resolved addresses and route", one(`select (pickup_address_snapshot->>'line1')||'|'||(dropoff_address_snapshot->>'line1')||'|'||distance_source from public.couranr_quote_versions where id='${quoteId}'`) === "100 Test Pickup Street|200 Test Dropoff Avenue|mapbox_directions_v5");

    await senderTab.locator('[data-couranr-send="review"] input[type="checkbox"]').nth(0).check();
    await senderTab.locator('[data-couranr-send="review"] input[type="checkbox"]').nth(1).check();
    await senderTab.getByRole("button", { name: "Continue to payment" }).click();
    await senderTab.getByRole("button", { name: "Request this delivery" }).click();
    await senderTab.locator('[data-couranr-payment="authorization-required"]').waitFor({ timeout: 30_000 });
    const obligationId = one(`select id from public.couranr_payment_obligations where request_id='${requestId}' order by created_at desc limit 1`);
    check("submission and obligation bind the exact quote", Boolean(obligationId) && one(`select quote_version_id from public.couranr_payment_obligations where id='${obligationId}'`) === quoteId);
    const authorize = senderTab.getByRole("button", { name: /^Authorize \$/ });
    await authorize.waitFor({ timeout: 30_000 });
    try {
      await waitUntil("Stripe form enabled", () => authorize.isEnabled(), 10_000);
    } catch {
      const diagnostic = await senderTab.evaluate(() => ({
        stripeLoaded: typeof window.Stripe === "function",
        stripeCalls: (window.__couranrStripeCalls ?? []).map((c) => c.fn),
        mockElementCount: document.querySelectorAll("[data-stripe-element]").length,
        paymentText: document.querySelector("[data-couranr-payment-form]")?.textContent?.slice(0, 300),
      }));
      throw new Error(`Stripe form never became ready: ${JSON.stringify(diagnostic)}`);
    }
    await authorize.click();
    await waitUntil("authorized obligation", () => one(`select payment_state='authorized' from public.couranr_payment_obligations where id='${obligationId}'`) === "t");
    check("Stripe double held funds, never captured at request submission", one(`select payment_state from public.couranr_payment_obligations where id='${obligationId}'`) === "authorized" && !stripeCalls.some((c) => c.path.endsWith("/capture")));
    const afterAuthorization = one(`select request_state from public.couranr_delivery_requests where id='${requestId}'`);
    const autoAccepted = one(`select count(*) from public.couranr_delivery_request_events where request_id='${requestId}' and command='auto_accept_delivery_request'`) === "1";
    check("review is governed: pending or recorded automatic standard-lane acceptance",
      afterAuthorization === "pending_couranr_review" || (afterAuthorization === "confirmed" && autoAccepted),
      `state=${afterAuthorization} auto-accepted=${autoAccepted}`);
    check("no real provider call", stripeCalls.every((c) => !c.unexpected));

    const operations = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const opsTab = await operations.newPage();
    await opsTab.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });
    await opsTab.getByLabel("Email").fill(ops.email);
    await opsTab.getByLabel("Password").fill(password);
    await opsTab.getByRole("button", { name: /^Sign in$/i }).click();
    await opsTab.waitForURL(/\/operations(?:\/|$)/, { timeout: 30_000 });
    await opsTab.goto(`${BASE}/operations/deliveries/${requestId}`, { waitUntil: "domcontentloaded" });
    await opsTab.locator("#operations-workbench").waitFor({ timeout: 30_000 });
    // The workbench polls; networkidle is not a valid readiness signal.
    const opsButtons = await opsTab.getByRole("button").allTextContents();
    console.log(`  Operations current actions: ${JSON.stringify(opsButtons.map((s) => s.trim()).filter(Boolean).slice(0, 24))}`);
    console.log(`  Chain state: request=${one(`select request_state from public.couranr_delivery_requests where id='${requestId}'`)} plans=${one(`select count(*) from public.couranr_service_plans where request_id='${requestId}'`)} deliveries=${one(`select count(*) from public.couranr_deliveries where request_id='${requestId}'`)}`);
    check("Operations sees direct Consumer case without fake business tenancy", await opsTab.locator("#operations-workbench").count() === 1);

    const driverContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      permissions: ["geolocation"],
      geolocation: { latitude: 38.422, longitude: -77.408 },
    });
    const driverTab = await driverContext.newPage();
    driverTab.on("requestfailed", (request) => {
      if (request.url().includes("/storage/v1/")) {
        const url = new URL(request.url());
        console.log(`  Storage browser failure: ${request.method()} ${url.origin}${url.pathname} ${request.failure()?.errorText}`);
      }
    });
    driverTab.on("response", async (response) => {
      if (response.url().endsWith("/proof-upload")) {
        const payload = await response.json().catch(() => null);
        const candidate = payload?.data?.upload?.signedUrl ?? payload?.value?.upload?.signedUrl ?? payload?.upload?.signedUrl;
        if (candidate) {
          const url = new URL(candidate);
          console.log(`  signed proof target: ${url.origin}${url.pathname}`);
        }
      }
      if (response.url().includes("/storage/v1/")) {
        const url = new URL(response.url());
        console.log(`  Storage browser response: ${response.request().method()} ${url.origin}${url.pathname} ${response.status()}`);
      }
    });
    await driverTab.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });
    await driverTab.getByLabel("Email").fill(driver.email);
    await driverTab.getByLabel("Password").fill(password);
    await driverTab.getByRole("button", { name: /^Sign in$/i }).click();
    await driverTab.waitForURL(/\/driver(?:\/|$)/, { timeout: 30_000 });
    await driverTab.goto(`${BASE}/driver/availability`, { waitUntil: "domcontentloaded" });
    await driverTab.getByRole("button", { name: "Go online" }).click();
    await waitUntil("driver online", () => one(`select availability_state from public.couranr_drivers where id='${driverId}'`) === "available");
    check("driver opts in to automatic assignments in own tab", true);

    // The browser order was placed outside operating hours. Advance only the
    // disposable Next worker's clock to the committed dispatch window. The
    // service plan itself is immutable and must never be UPDATEd, even here.
    const planId = one(`select id from public.couranr_service_plans where request_id='${requestId}' and plan_state='confirmed'`);
    if (!planId) throw new Error("No confirmed plan after automatic acceptance");
    const dueAt = one(`select dispatch_not_before+interval '1 minute' from public.couranr_service_plans where id='${planId}'`);
    writeFileSync(clockFile, new Date(dueAt).toISOString(), { mode: 0o600 });
    const tickResponse = await fetch(`${BASE}/api/couranr/internal/automation/tick`, {
      headers: { authorization: "Bearer disposable-automation-secret" },
    });
    const tick = await tickResponse.json();
    rmSync(clockFile, { force: true });
    console.log(`  automatic tick: HTTP ${tickResponse.status} ${JSON.stringify(tick)}`);
    console.log(`  dispatch diagnosis: ${one(`select jsonb_build_object(
      'exceptions',(select coalesce(jsonb_agg(jsonb_build_object('stage',exception_stage,'reason',reason,'state',exception_state)), '[]'::jsonb) from public.couranr_automation_exceptions where request_id='${requestId}'),
      'reservations',(select count(*) from public.couranr_dispatch_reservations where request_id='${requestId}'),
      'driver',(select row_to_json(x) from (select driver_state,active,availability_state from public.couranr_drivers where id='${driverId}') x),
      'vehicle',(select row_to_json(x) from (select active,availability_state,vehicle_class from public.couranr_dispatch_vehicles where id='${vehicleId}') x),
      'plan',(select row_to_json(x) from (select vehicle_requirement,dispatch_not_before,dispatch_deadline,next_route_recheck_at from public.couranr_service_plans where id='${planId}') x))`)}`);
    const deliveryId = one(`select id from public.couranr_deliveries where request_id='${requestId}'`);
    check("due automatic Consumer plan settles and creates canonical delivery", Boolean(deliveryId),
      `payment=${one(`select payment_state from public.couranr_payment_obligations where id='${obligationId}'`)}`);
    if (deliveryId) {
      check("automatic assignment binds synthetic driver", one(`select count(*) from public.couranr_delivery_assignments where delivery_id='${deliveryId}' and driver_id='${driverId}' and assignment_state='active'`) === "1");
      check("commercial identity survives dispatch", one(`select quote_version_id from public.couranr_deliveries where id='${deliveryId}'`) === quoteId);
    }

    console.log(`  lifecycle email subjects: ${JSON.stringify(emailBodies.map((m) => m.subject))}`);
    check("one sender confirmation despite same-state planning and payment events",
      emailBodies.filter((m) => String(m.subject).includes("Confirmed — your Couranr delivery")).length === 1);
    const senderMessage = emailBodies.find((m) => String(m.subject).includes("Confirmed — your Couranr delivery"));
    const senderToken = String(senderMessage?.html ?? "").match(/#sender=([A-Za-z0-9_-]+)/)?.[1];
    if (!senderToken) throw new Error("Sender email omitted its separate recovery capability");
    const recoveredSenderContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const recoveredSenderTab = await recoveredSenderContext.newPage();
    await recoveredSenderTab.goto(`${BASE}/send?intent=send#sender=${senderToken}`, { waitUntil: "domcontentloaded" });
    await recoveredSenderTab.locator('[data-couranr-send="received"]').waitFor({ timeout: 30_000 });
    check("email link recovers sender authority in a fresh browser context without exposing the capability in the URL",
      !recoveredSenderTab.url().includes("#sender=") &&
      await recoveredSenderTab.locator('[data-couranr-sender-pickup-code="true"]').count() === 1);
    const trackUrls = emailBodies.flatMap((mail) => [...String(mail.html ?? "").matchAll(/https?:\/\/[^\s"'<>]+\/track\/[a-zA-Z0-9_-]+/g)].map((m) => m[0]));
    const trackUrl = trackUrls[0] ?? null;
    if (!trackUrl) throw new Error("Recipient tracking URL was not sent to local mail sink");
    const recipientContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const recipientTab = await recipientContext.newPage();
    await recipientTab.goto(`${BASE}${new URL(trackUrl).pathname}`, { waitUntil: "domcontentloaded" });
    await recipientTab.getByLabel(/I confirm that I am 18 or older/).check();
    await recipientTab.getByRole("button", { name: "Record confirmation" }).click();
    await recipientTab.getByText("Your handoff code").waitFor({ timeout: 30_000 });
    check("recipient tab cannot mint drop-off PIN before custody", await recipientTab.getByRole("button", { name: "Get my code" }).count() === 0);

    await recoveredSenderTab.reload({ waitUntil: "domcontentloaded" });
    await recoveredSenderTab.locator('[data-couranr-sender-pickup-code="true"]').waitFor({ timeout: 30_000 });
    await recoveredSenderTab.getByRole("button", { name: "Show pickup QR & code" }).click();
    await recoveredSenderTab.locator('[data-couranr-pickup-credential="true"]').waitFor();
    const pickupLabel = await recoveredSenderTab.locator('[aria-label^="Pickup code"]').getAttribute("aria-label");
    const pickupCode = String(pickupLabel ?? "").replace(/\D/g, "");
    check("sender's separate tab issues pickup-only credential", /^\d{6}$/.test(pickupCode));

    await driverTab.goto(`${BASE}/driver/deliveries/${deliveryId}`, { waitUntil: "domcontentloaded" });
    await driverTab.getByRole("button", { name: "Start route to pickup" }).click();
    await waitUntil("route to pickup", () => one(`select fulfillment_state from public.couranr_deliveries where id='${deliveryId}'`) === "en_route_to_pickup");
    await driverTab.getByRole("button", { name: "Share location" }).click();
    await driverTab.getByRole("button", { name: "I have arrived at pickup" }).waitFor({ state: "visible" });
    await waitUntil("pickup location accepted", () => driverTab.getByRole("button", { name: "I have arrived at pickup" }).isEnabled());
    await driverTab.getByRole("button", { name: "I have arrived at pickup" }).click();
    await waitUntil("arrival at pickup", () => one(`select fulfillment_state from public.couranr_deliveries where id='${deliveryId}'`) === "at_pickup");
    check("driver reaches pickup using canonical transitions", true);
    await recipientTab.reload({ waitUntil: "domcontentloaded" });
    await recipientTab.getByText("Your handoff code").waitFor();
    check("recipient PIN still closed at pickup", await recipientTab.getByRole("button", { name: "Get my code" }).count() === 0);

    await driverTab.getByRole("button", { name: "Enter six-digit code instead" }).click();
    await driverTab.getByLabel("Pickup code").fill(pickupCode);
    await driverTab.getByRole("button", { name: "Verify code" }).click();
    await driverTab.getByText("Sender verified").waitFor({ timeout: 30_000 });
    check("driver's pickup verifier accepts sender credential", true);

    const proofImage = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6pZ1cAAAAASUVORK5CYII=", "base64");
    await driverTab.getByLabel("Photo of the pickup").setInputFiles({ name: "synthetic-pickup.png", mimeType: "image/png", buffer: proofImage });
    try {
      await waitUntil("pickup proof finalized", () => one(`select count(*) from public.couranr_delivery_proofs where delivery_id='${deliveryId}' and proof_stage='pickup'`) === "1", 30_000);
    } catch (error) {
      console.log(`  proof diagnostic: uploads=${one(`select coalesce(jsonb_agg(jsonb_build_object('stage',proof_stage,'status',upload_state,'mime',expected_mime)), '[]'::jsonb) from public.couranr_proof_uploads where delivery_id='${deliveryId}'`)} objects=${one("select count(*) from storage.objects where bucket_id='delivery-photos'")} page=${(await driverTab.locator('body').innerText()).slice(-1400)}`);
      throw error;
    }
    await driverTab.getByRole("button", { name: "Confirm pickup" }).click();
    await waitUntil("custody", () => one(`select fulfillment_state from public.couranr_deliveries where id='${deliveryId}'`) === "picked_up");
    check("pickup proof finalized before custody transfer", true);
    await driverTab.getByRole("button", { name: "Start route to drop-off" }).click();
    await waitUntil("in transit", () => one(`select fulfillment_state from public.couranr_deliveries where id='${deliveryId}'`) === "in_transit");
    check("driver starts in-transit leg under canonical state machine", true);

    check("driver transition records notification-owed in-transit event",
      one(`select count(*) from public.couranr_delivery_events where delivery_id='${deliveryId}' and to_state='in_transit'`) === "1");
    await fetch(`${BASE}/api/couranr/internal/automation/tick`, {
      headers: { authorization: "Bearer disposable-automation-secret" },
    });
    check("lifecycle catch-up sends recipient in-transit notice",
      emailBodies.some((m) => String(m.subject).includes("On the way — your Couranr delivery")));

    await recipientTab.reload({ waitUntil: "domcontentloaded" });
    await recipientTab.getByRole("button", { name: "Get my code" }).click();
    const recipientCodeNode = recipientTab.getByTestId("recipient-dropoff-code");
    await recipientCodeNode.waitFor();
    const firstRecipientCode = (await recipientCodeNode.innerText()).replace(/\D/g, "");
    check("recipient mints distinct drop-off credential only after custody", /^\d{6}$/.test(firstRecipientCode));
    await recipientTab.getByRole("button", { name: "Replace lost or exposed code" }).click();
    await recipientTab.getByRole("button", { name: "Yes, replace code" }).click();
    await recipientTab.getByText("Just a moment").waitFor();
    check("recipient reissue cooldown refuses rapid churn", true);
    await new Promise((resolve) => setTimeout(resolve, 31_000));
    await recipientTab.getByRole("button", { name: "Yes, replace code" }).click();
    await waitUntil("replacement recipient code", async () => (await recipientCodeNode.innerText()).replace(/\D/g, "") !== firstRecipientCode);
    const secondRecipientCode = (await recipientCodeNode.innerText()).replace(/\D/g, "");
    check("recipient replacement supersedes old code", one(`select count(*) from public.couranr_handoff_codes where delivery_id='${deliveryId}' and code_kind='recipient_dropoff' and code_state='superseded'`) === "1");

    await driverContext.setGeolocation({ latitude: 38.651, longitude: -77.249 });
    const arriveDropoff = driverTab.getByRole("button", { name: "I have arrived at drop-off" });
    await arriveDropoff.waitFor();
    check("old pickup GPS fix cannot authorize drop-off arrival", !(await arriveDropoff.isEnabled()));
    await driverTab.getByRole("button", { name: "Share location" }).click();
    await waitUntil("fresh drop-off location", () => arriveDropoff.isEnabled());
    await arriveDropoff.click();
    await waitUntil("at drop-off", () => one(`select fulfillment_state from public.couranr_deliveries where id='${deliveryId}'`) === "at_dropoff");
    await driverTab.getByLabel("Six-digit recipient code").fill(firstRecipientCode);
    await driverTab.getByRole("button", { name: "Check code" }).click();
    await driverTab.getByText(/That code is not correct|That code is no longer valid/).waitFor();
    check("superseded recipient code rejected", one(`select count(*) from public.couranr_handoff_codes where delivery_id='${deliveryId}' and code_kind='recipient_dropoff' and code_state='consumed'`) === "0");
    await driverTab.getByLabel("Six-digit recipient code").fill(secondRecipientCode);
    await driverTab.getByRole("button", { name: "Check code" }).click();
    await driverTab.getByText("Code accepted", { exact: true }).waitFor();
    await driverTab.getByLabel("First name of the person taking the shipment").fill("Disposable");
    await driverTab.getByRole("button", { name: "Complete handoff" }).click();
    await waitUntil("delivered", () => one(`select fulfillment_state from public.couranr_deliveries where id='${deliveryId}'`) === "delivered");
    check("recipient handoff and completion proof delivered exactly once", one(`select count(*) from public.couranr_handoff_codes where delivery_id='${deliveryId}' and code_kind='recipient_dropoff' and code_state='consumed'`) === "1");
    check("driver completion records notification-owed delivered event",
      one(`select count(*) from public.couranr_delivery_events where delivery_id='${deliveryId}' and to_state='delivered'`) === "1");
    await fetch(`${BASE}/api/couranr/internal/automation/tick`, { headers: { authorization: "Bearer disposable-automation-secret" } });
    check("lifecycle catch-up sends delivered notices", emailBodies.some((m) => String(m.subject).includes("Delivered")));
    check("canonical foundation integrity remains clean after delivery",
      one("select count(*) from public.couranr_foundation_integrity()") === "0");

    console.log(`\n  journey checkpoints: ${passed} passed, ${failed} failed`);
    if (failed) process.exitCode = 1;
    void ops; void driverContext; void vehicleId; void emailBodies;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (next) { try { process.kill(-next.pid, "SIGTERM"); } catch { next.kill("SIGTERM"); } }
    if (mail) await new Promise((resolve) => mail.close(resolve));
    if (stripe?.server) await new Promise((resolve) => stripe.server.close(resolve));
    if (gateway?.server) await new Promise((resolve) => gateway.server.close(resolve));
    if (pgrst) pgrst.kill("SIGTERM");
    down({ quiet: true });
    dist.cleanup();
    rmSync(clockDir, { recursive: true, force: true });
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (error) => { console.error(error); process.exit(1); },
);

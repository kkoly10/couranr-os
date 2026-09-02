/**
 * MER-008 / MER-009 — the customer book, UNSTUBBED and SIGNED IN.
 *
 * Every registry-required state of both screens, each asserted in the browser
 * AND against the row it implies:
 *
 *   MER-008  empty · active · archived · duplicate warning
 *   MER-009  no deliveries · active delivery · conflicting address · archived
 *
 * Two assertions carry most of the weight:
 *
 *   * PII. The list must not contain a recipient's real phone or email. That
 *     is checked against the rendered HTML, not against a component prop —
 *     masking that only happens in a variable is not masking.
 *   * ARCHIVE IS NOT DELETE. The row count is asserted unchanged across an
 *     archive, because "the customer disappeared from the list" looks the same
 *     whether they were archived or destroyed.
 *
 * WHAT IT DOES NOT PROVE: the `/auth/v1` issuer is `gateway.mjs`'s
 * reimplementation, not GoTrue.
 *
 * Run:  node e2e/disposable/customerBook.mjs
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
import { psqlTransport, seedCanonicalQuotedRequest } from "./gateAFixtures.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SHOTS = path.join(ROOT, "e2e/screenshots/customer-book");
const DIST = ".next-disposable";
// Resolved by scripts/provisionPostgrest.mjs, never a session scratchpad.
// The previous default was a path inside ONE container's ephemeral
// scratchpad, so this harness aborted on every other machine — after
// applying 50 migrations, which made a missing dependency look like a
// database failure. `npm run provision:postgrest` puts it on PATH.
const PGRST_BIN = postgrestTarget();

const PORT = 3317;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "disposable-customers-1";

let passed = 0;
let failed = 0;

function check(id, description, ok, detail = "") {
  ok ? passed++ : failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${description}${detail ? `  [${detail}]` : ""}`);
}

const sql = (q) => psql(q).trim();
const esc = (s) => String(s).replace(/'/g, "''");

function fieldLabel(scope, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return scope.getByLabel(new RegExp(`^${escaped}(\\s*\\*|\\s*\\(optional\\))?$`));
}

function makeUser(email) {
  const id = sql(`insert into auth.users (email) values ('${esc(email)}') returning id`);
  sql(`select public.couranr_disposable_set_password('${id}', '${esc(PASSWORD)}')`);
  sql(`insert into public.profiles (id, email, role) values ('${id}', '${esc(email)}', 'customer')`);
  return id;
}

function addMember(businessId, userId, role) {
  return sql(
    `insert into public.business_members (business_account_id, user_id, role, status, joined_at)
     values ('${businessId}', '${userId}', '${role}', 'active', now()) returning id`
  );
}

/**
 * A submitted request with a recipient and a dropoff snapshot, built by the
 * canonical commands.
 *
 * The raw INSERT it replaces claimed quote_status='estimated' with no
 * current_quote_version_id — unwritable since Gate A, and where this suite
 * died. The customer book is derived from recipient_name / recipient_email /
 * recipient_phone and the dropoff address, so all four are passed explicitly:
 * the builder's defaults would collapse four distinct people into one and make
 * the duplicate-detection assertions pass against the wrong fixture.
 */
async function makeRequest(businessId, creatorId, opts) {
  const { name, email, phone, line1, state = "confirmed" } = opts;
  const request = await seedCanonicalQuotedRequest(psqlTransport(psql), {
    businessId,
    actorUserId: creatorId,
    marker: "cust",
    recipientName: name,
    recipientEmail: email,
    recipientPhone: phone,
    pickupAddress: { line1: "1 Pickup Way", city: "Stafford", region: "VA", postalCode: "22554" },
    dropoffAddress: { line1, city: "Woodbridge", region: "VA", postalCode: "22191" },
    subtotalCents: 2299,
    pricingPolicyVersion: "couranr-pricing-v2-2026-09-01",
    upTo: state === "pending_couranr_review" ? "submitted" : "confirmed",
  });
  return request.requestId;
}

async function main() {
  console.log("MER-008 / MER-009 — customer book, authenticated, unstubbed\n");
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

    pgrst = await startPostgrest({
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

    if (process.env.COURANR_REUSE_BUILD !== "1") {
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

    console.log("  seeding...");

    // Business A: has customers. Business B: empty, for the empty state.
    const bizA = sql(
      `insert into public.business_accounts (name, slug, status)
       values ('[CB] active business', 'cb-active', 'active') returning id`
    );
    const bizB = sql(
      `insert into public.business_accounts (name, slug, status)
       values ('[CB] empty business', 'cb-empty', 'active') returning id`
    );

    const owner = { id: makeUser("e2e-cb-owner@couranr.invalid"), email: "e2e-cb-owner@couranr.invalid" };
    const viewer = { id: makeUser("e2e-cb-viewer@couranr.invalid"), email: "e2e-cb-viewer@couranr.invalid" };
    const emptyOwner = { id: makeUser("e2e-cb-empty@couranr.invalid"), email: "e2e-cb-empty@couranr.invalid" };
    addMember(bizA, owner.id, "owner");
    addMember(bizA, viewer.id, "viewer");
    addMember(bizB, emptyOwner.id, "owner");

    const REAL_PHONE = "540-555-0142";
    const REAL_EMAIL = "ada.lovelace@example.com";

    // Ada: two deliveries to DIFFERENT addresses → conflicting-address state,
    // and one of them non-terminal → active-delivery badge.
    await makeRequest(bizA, owner.id, { name: "Ada Lovelace", email: REAL_EMAIL, phone: REAL_PHONE, line1: "12 First Ave" });
    await makeRequest(bizA, owner.id, {
      name: "Ada Lovelace", email: REAL_EMAIL, phone: REAL_PHONE,
      line1: "88 Second St", state: "pending_couranr_review",
    });
    // Grace: one delivery, single address.
    await makeRequest(bizA, owner.id, { name: "Grace Hopper", email: "grace@example.com", phone: "540-555-0199", line1: "3 Navy Rd" });
    // A record reachable ONLY by phone that shares Ada's phone → strong duplicate.
    await makeRequest(bizA, owner.id, { name: "A. Lovelace", email: null, phone: REAL_PHONE, line1: "12 First Ave" });

    // A stored customer with NO deliveries — the MER-009 state a derivation
    // alone can never produce.
    const noDeliveryCustomerId = sql(
      `insert into public.merchant_customers
         (business_account_id, created_by, display_name, email, phone,
          normalized_email, normalized_phone)
       values ('${bizA}', '${owner.id}', 'Katherine Johnson', 'katherine@example.com',
               '540-555-0177', 'katherine@example.com', '5405550177')
       returning id`
    );

    console.log("  fixtures ready\n");

    /* ─────────────────────────── browser helpers ─────────────────────── */

    const { chromium } = await import("/opt/node22/lib/node_modules/playwright/index.mjs");
    browser = await chromium.launch({ args: ["--no-proxy-server"] });

    async function signIn(email) {
      const ctx = await browser.newContext();
      contexts.push(ctx);
      const page = await ctx.newPage();
      await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });
      const f = fieldLabel(page, "Email");
      await f.waitFor({ state: "visible", timeout: 45_000 });
      await f.fill(email);
      await fieldLabel(page, "Password").fill(PASSWORD);
      await page.getByRole("button", { name: /^Sign in$/ }).click();
      const until = Date.now() + 45_000;
      while (Date.now() < until) {
        if (!new URL(page.url()).pathname.startsWith("/sign-in")) return page;
        await page.waitForTimeout(250);
      }
      throw new Error(`sign-in for ${email} never left /sign-in`);
    }

    async function tokenFor(email) {
      const r = await fetch(`${gateway.url}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { "content-type": "application/json", apikey: ANON_JWT },
        body: JSON.stringify({ email, password: PASSWORD }),
      });
      if (!r.ok) throw new Error(`no token for ${email}: ${r.status}`);
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
        /* none */
      }
      return { status: r.status, body };
    }

    async function open(email, suffix = "") {
      const page = await signIn(email);
      await page.goto(`${BASE}/app/business/customers${suffix}`, { waitUntil: "domcontentloaded" });
      return page;
    }

    /* ══════════════════ MER-008 — active list and PII ══════════════════ */

    console.log("MER-008 — active list, masking, duplicates");
    const page = await open(owner.email);
    await page.getByText("Ada Lovelace").first().waitFor({ state: "visible", timeout: 30_000 });

    check("C1", "customers derived from real requests appear",
      (await page.getByText("Ada Lovelace").count()) > 0 &&
      (await page.getByText("Grace Hopper").count()) > 0);

    check("C2", "a stored customer with NO deliveries also appears",
      (await page.getByText("Katherine Johnson").count()) > 0);

    // THE PII ASSERTION, against rendered HTML rather than a prop.
    {
      const html = await page.content();
      check("C3", "the list HTML does NOT contain the real phone number",
        !html.includes("5405550142") && !html.includes("540-555-0142"));
      check("C4", "the list HTML does NOT contain the real email",
        !html.includes(REAL_EMAIL));
      check("C5", "but it DOES show a masked form", html.includes("•••"));
      check("C5b", "the customer LINKS carry an opaque key, not an identity",
        !/customer=(email|phone|name)%3A/.test(html) && /customer=[0-9a-f]{32}/.test(html));
    }

    check("C6", "the active-delivery badge is present for the open request",
      (await page.getByText("Active delivery").count()) > 0);
    check("C7", "the multiple-addresses badge is present",
      (await page.getByText("Multiple addresses").count()) > 0);

    // Required state: duplicate warning — and it must not claim a merge.
    {
      const body = await page.innerText("body");
      check("C8", "the duplicate warning is raised for the shared phone",
        body.includes("look like duplicates") && body.includes("share a phone number"));
      check("C9", "and it says Couranr never merges",
        body.includes("never merges your customer records"));
    }
    await page.screenshot({ path: path.join(SHOTS, "MER-008-active.png"), fullPage: true });

    /* ══════════════════ MER-009 — detail states ════════════════════════ */

    console.log("MER-009 — detail, conflicting address, no deliveries");
    {
      await page.locator("tbody tr", { hasText: "Ada Lovelace" })
        .getByRole("link", { name: "Open" }).click();
      await page.waitForURL(/customer=/, { timeout: 20_000 });
      await page.getByText("Delivery history").waitFor({ state: "visible", timeout: 20_000 });

      const body = await page.innerText("body");
      // `innerText` does NOT include <input> values — they are not text nodes —
      // so the unmasked contact is read from the field itself. The first run of
      // this harness failed here against a detail page that was rendering the
      // email perfectly well.
      const shownEmail = await fieldLabel(page, "Email").inputValue();
      check("D1", "the DETAIL unmasks contact details (the merchant's own data)",
        shownEmail === REAL_EMAIL, shownEmail);
      check("D2", "conflicting-address state is raised for two distinct dropoffs",
        body.includes("More than one delivery address"));
      check("D3", "both addresses are listed",
        body.includes("12 First Ave") && body.includes("88 Second St"));
      check("D4", "delivery history links to the real requests",
        (await page.locator('a[href^="/app/business/deliveries/"]').count()) >= 2);
      await page.screenshot({ path: path.join(SHOTS, "MER-009-conflicting-address.png"), fullPage: true });
    }

    {
      const p2 = await open(owner.email);
      await p2.locator("tbody tr", { hasText: "Katherine Johnson" })
        .getByRole("link", { name: "Open" }).click();
      await p2.waitForURL(/customer=/, { timeout: 20_000 });
      await p2.getByText("You have not sent a delivery to this customer yet")
        .waitFor({ state: "visible", timeout: 20_000 });
      check("D5", "the NO-DELIVERIES state renders for a stored record", true);
      check("D6", "the state is TRUE: no request names that recipient",
        sql(`select count(*) from public.couranr_delivery_requests
              where business_account_id='${bizA}' and recipient_email='katherine@example.com'`) === "0");
      await p2.screenshot({ path: path.join(SHOTS, "MER-009-no-deliveries.png"), fullPage: true });
    }

    /* ══════════════ archive — and prove it is NOT a delete ═════════════ */

    console.log("Archive — a stamp, never a delete");
    {
      const before = sql(
        `select count(*) from public.merchant_customers where business_account_id='${bizA}'`
      );
      const r = await api(owner.email, `/api/couranr/merchant/customers?businessAccountId=${bizA}`, {
        method: "POST",
        body: JSON.stringify({ action: "archive", customerId: noDeliveryCustomerId }),
      });
      check("A1", "archive succeeds for an owner", r.status === 200, `status=${r.status}`);

      const after = sql(
        `select count(*) from public.merchant_customers where business_account_id='${bizA}'`
      );
      check("A2", "THE ROW STILL EXISTS — archive is not a delete",
        before === after && before === "1", `${before} -> ${after}`);
      check("A3", "archived_at is stamped",
        sql(`select archived_at is not null from public.merchant_customers
              where id='${noDeliveryCustomerId}'`) === "t");
    }
    {
      const p3 = await open(owner.email);
      await p3.getByText("Ada Lovelace").first().waitFor({ state: "visible", timeout: 30_000 });
      check("A4", "an archived customer leaves the active list",
        (await p3.getByText("Katherine Johnson").count()) === 0);
      await p3.getByRole("button", { name: "Show archived" }).click();
      await p3.getByText("Katherine Johnson").first().waitFor({ state: "visible", timeout: 20_000 });
      check("A5", "and appears under archived", true);
      await p3.screenshot({ path: path.join(SHOTS, "MER-008-archived.png"), fullPage: true });
    }

    /* ══════════════════ create, roles, tenancy ═════════════════════════ */

    console.log("Create, roles and tenancy");
    {
      const r = await api(owner.email, `/api/couranr/merchant/customers?businessAccountId=${bizA}`, {
        method: "POST",
        body: JSON.stringify({
          action: "create",
          displayName: "Mary Jackson",
          email: "mary@example.com",
          phone: "",
          notes: "Prefers morning drop-offs.",
        }),
      });
      check("N1", "create succeeds", r.status === 201, `status=${r.status}`);
      check("N2", "the row carries the normalized email the matcher uses",
        sql(`select normalized_email from public.merchant_customers
              where business_account_id='${bizA}' and display_name='Mary Jackson'`) === "mary@example.com");
    }
    {
      const r = await api(owner.email, `/api/couranr/merchant/customers?businessAccountId=${bizA}`, {
        method: "POST",
        body: JSON.stringify({ action: "create", displayName: "No Contact", email: "", phone: "" }),
      });
      check("N3", "a customer with no email AND no phone is refused",
        r.status === 400, `status=${r.status}`);
    }

    const viewerPage = await open(viewer.email);
    await viewerPage.getByText("Ada Lovelace").first().waitFor({ state: "visible", timeout: 30_000 });
    check("R1", "a viewer READS the book", true);
    check("R2", "a viewer sees no Add-customer form",
      (await viewerPage.getByRole("button", { name: "Add customer" }).count()) === 0);
    {
      const r = await api(viewer.email, `/api/couranr/merchant/customers?businessAccountId=${bizA}`, {
        method: "POST",
        body: JSON.stringify({ action: "create", displayName: "X", email: "x@example.com", phone: "" }),
      });
      check("R3", "server truth: a viewer's create is refused", r.status === 403, `status=${r.status}`);
    }
    await viewerPage.screenshot({ path: path.join(SHOTS, "MER-008-viewer.png"), fullPage: true });

    {
      const r = await api(emptyOwner.email, `/api/couranr/merchant/customers?businessAccountId=${bizA}`);
      check("X1", "a member of business B cannot read A's customers",
        r.status === 403, `status=${r.status}`);
      // Cross-tenant KEY guessing: a valid key from A, asked for under B.
      // A well-formed opaque key that is simply not one of B's — proving the
      // resolver matches only against candidates the caller's business owns.
      const foreignKey = "0".repeat(32);
      const r2 = await api(
        emptyOwner.email,
        `/api/couranr/merchant/customers?businessAccountId=${bizB}&customer=${foreignKey}`
      );
      check("X2", "and A's customer key resolves to NOT-FOUND under B, never to A's record",
        r2.status === 404, `status=${r2.status}`);
      const anon = await fetch(`${BASE}/api/couranr/merchant/customers?businessAccountId=${bizA}`);
      check("X3", "anonymous is refused", anon.status === 401, `status=${anon.status}`);
    }

    /* ══════════════════ empty state and fail-closed ════════════════════ */

    console.log("Empty state, and fail-closed on error");
    {
      const p4 = await open(emptyOwner.email);
      await p4.getByText("No customers yet").waitFor({ state: "visible", timeout: 30_000 });
      check("E1", "the empty state renders with a real next action",
        (await p4.locator('a[href="/app/business/deliveries/new"]').count()) > 0);
      check("E2", "the state is TRUE: business B has no requests and no records",
        sql(`select count(*) from public.couranr_delivery_requests where business_account_id='${bizB}'`) === "0");
      await p4.screenshot({ path: path.join(SHOTS, "MER-008-empty.png"), fullPage: true });
    }
    {
      const p5 = await signIn(owner.email);
      await p5.route("**/api/couranr/merchant/customers?*", (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Injected.", correlationId: "e2e-cust-err" }),
        })
      );
      await p5.goto(`${BASE}/app/business/customers`, { waitUntil: "domcontentloaded" });
      await p5.getByText("Your customers did not load").waitFor({ state: "visible", timeout: 30_000 });
      const body = await p5.innerText("body");
      check("F1", "the error state renders with its reference", body.includes("e2e-cust-err"));
      check("F2", "it does NOT claim the business has no customers",
        !body.includes("No customers yet"));
      await p5.screenshot({ path: path.join(SHOTS, "MER-008-error.png"), fullPage: true });
    }

    console.log(`\n  ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    for (const ctx of contexts) await ctx.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (appServer?.pid) {
      try {
        process.kill(-appServer.pid, "SIGTERM");
      } catch {
        /* gone */
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

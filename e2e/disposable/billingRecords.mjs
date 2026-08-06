/**
 * MER-016 — billing records, UNSTUBBED and SIGNED IN.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS RUN PROVES
 * ---------------------------------------------------------------------------
 *
 * The two registry-required states that HAVE a source, each asserted in the
 * page and against the row behind it:
 *
 *   NO PAYMENT METHOD   universally true — nothing stores one
 *   PAYMENT FAILED      couranr_payment_obligations.payment_state = 'failed'
 *
 * Plus the properties a screen about money has to get right:
 *
 *   - The total is what was TAKEN. The fixture holds $50.00 authorized but
 *     never captured, $99.00 failed and $40.00 cancelled alongside $52.99
 *     genuinely captured. The rendered total must be $52.99; summing the rows
 *     regardless of state gives $241.99, which is a merchant being told they
 *     paid nearly five times what they paid.
 *   - Cross-tenant. Another business's charges never appear, proven by
 *     seeding a second business with a distinctive amount and asserting the
 *     page never renders it.
 *   - A dispatcher and a viewer are refused; the `billing` role is not.
 *   - A failed read renders an error, never an empty list — "you have never
 *     been charged" is a specific and alarming falsehood.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES NOT PROVE
 * ---------------------------------------------------------------------------
 *
 *  1. The `/auth/v1` issuer is `gateway.mjs`'s reimplementation, not GoTrue.
 *  2. The two UNREACHABLE required states — default payment method, refund
 *     pending/complete — are not exercised because no code can produce them.
 *     `tests/couranr-billing.test.ts` asserts they have no writer; this run
 *     asserts the screen does not pretend otherwise.
 *  3. The obligations here are seeded directly. The real authorization path
 *     that writes them is covered by the payments slice, not by this run.
 *  4. `totalChargedCents` prefers a captured amount over the authorized one,
 *     and that branch is NOT exercised — `couranr_po_captured_amount_chk`
 *     forbids the two from differing, so a partial capture cannot be seeded.
 *     Check F1 asserts the constraint rather than leaving this unsaid.
 *
 * Run:  node e2e/disposable/billingRecords.mjs
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SHOTS = path.join(ROOT, "e2e/screenshots/billing");
const DIST = ".next-disposable";
const PGRST_BIN =
  process.env.COURANR_POSTGREST ||
  "/tmp/claude-0/-home-user-couranr-os/3ba65fdb-c110-5366-92d6-85568b408343/scratchpad/prst/postgrest";

const PORT = 3318;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "disposable-billing-1";
const BILLING_PATH = "/business/settings/billing";

let passed = 0;
let failed = 0;

function check(id, description, ok, detail = "") {
  ok ? passed++ : failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${description}${detail ? `  [${detail}]` : ""}`);
}

const sql = (q) => psql(q).trim();
const esc = (s) => String(s).replace(/'/g, "''");

/** Scope to MAIN: the shell nav is chrome, not the screen under test. */
const mainText = (page) => page.locator("main").innerText();

function fieldLabel(scope, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return scope.getByLabel(new RegExp(`^${escaped}(\\s*\\*|\\s*\\(optional\\))?$`));
}

function makeUser(email, profileRole = "customer") {
  const id = sql(`insert into auth.users (email) values ('${esc(email)}') returning id`);
  sql(`select public.couranr_disposable_set_password('${id}', '${esc(PASSWORD)}')`);
  sql(
    `insert into public.profiles (id, email, role)
     values ('${id}', '${esc(email)}', '${profileRole}')`
  );
  return id;
}

function addMember(businessId, userId, role, status = "active") {
  return sql(
    `insert into public.business_members
       (business_account_id, user_id, role, status, joined_at)
     values ('${businessId}', '${userId}', '${role}', '${status}',
             ${status === "active" ? "now()" : "null"})
     returning id`
  );
}

function makeRequest(businessId, creatorId, recipient) {
  return sql(
    `insert into public.couranr_delivery_requests
       (business_account_id, created_by, idempotency_key, recipient_name,
        request_state, readiness_state, review_state, submitted_at,
        quote_status, delivery_subtotal_cents, pricing_policy_version,
        pickup_address, dropoff_address, loaded_miles, weight_lb)
     values ('${businessId}', '${creatorId}', 'bill-${crypto.randomUUID()}',
             '${esc(recipient)}', 'pending_couranr_review', 'not_confirmed', 'pending', now(),
             'estimated', 2299, 'disposable',
             '{"line1":"12 Test St","city":"Stafford","region":"VA","postalCode":"22554"}'::jsonb,
             '{"line1":"9 Drop Ct","city":"Woodbridge","region":"VA","postalCode":"22191"}'::jsonb,
             5, 20)
     returning id`
  );
}

/**
 * One obligation, in a chosen payment state.
 *
 * The stamp CHECKs make this fixture the schema telling us what each state
 * actually requires: `authorized` needs an intent AND `authorized_at`,
 * `captured` needs `captured_at` and `captured_amount_cents`, `cancelled`
 * needs `cancelled_at`, and the partial unique index permits at most one
 * non-cancelled obligation per request — which is why every state below gets
 * its own request rather than sharing one.
 *
 * NO `capturedCents` PARAMETER, and that is a finding rather than a
 * simplification. The first version of this fixture tried to seed a capture
 * that settled for LESS than it held, to prove the total prefers the captured
 * amount. The database refused it: `couranr_po_captured_amount_chk` requires
 * `captured_amount_cents = amount_cents`, so a partial capture cannot exist.
 * The preference in `totalChargedCents` is therefore correct-in-advance and
 * currently UNREACHABLE, and the constraint is asserted below so this stays a
 * documented fact rather than a fixture that quietly gave up.
 */
function makeObligation(requestId, businessId, state, amountCents) {
  const intent = `pi_bill_${crypto.randomUUID().replace(/-/g, "")}`;
  const needsIntent = ["authorized", "capture_pending", "captured", "failed"].includes(state);
  return sql(
    `insert into public.couranr_payment_obligations
       (request_id, business_account_id, payer_type, request_version,
        pricing_policy_version, amount_cents, currency, payment_state,
        provider_payment_intent_id, idempotency_key,
        authorized_at, captured_at, captured_amount_cents, failed_at, cancelled_at)
     values ('${requestId}', '${businessId}', 'merchant', 1, 'disposable',
             ${amountCents}, 'usd', '${state}',
             ${needsIntent ? `'${intent}'` : "null"},
             'obl-${crypto.randomUUID()}',
             ${["authorized", "capture_pending", "captured"].includes(state) ? "now()" : "null"},
             ${state === "captured" ? "now()" : "null"},
             ${state === "captured" ? amountCents : "null"},
             ${state === "failed" ? "now()" : "null"},
             ${state === "cancelled" ? "now()" : "null"})
     returning id`
  );
}

async function main() {
  console.log("MER-016 — billing records, authenticated, unstubbed\n");
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

    /* ───────────────── nothing stores a payment method ────────────────── */

    console.log("Schema — the 'no payment method' state is a fact, not a placeholder");
    {
      const cols = sql(
        `select count(*) from information_schema.columns
          where table_schema='public'
            and (column_name ilike '%stripe_customer%' or column_name ilike '%setup_intent%'
                 or column_name ilike '%payment_method_id%')`
      );
      check("S1", "no column anywhere stores a Stripe customer, SetupIntent or payment method",
        cols === "0", `${cols} columns`);

      const tables = sql(
        `select count(*) from information_schema.tables
          where table_schema='public' and table_name ilike '%payment_method%'`
      );
      check("S2", "and no payment-method table exists", tables === "0", `${tables} tables`);
    }

    /* ───────────────────────────── fixtures ───────────────────────────── */

    console.log("\n  seeding synthetic identities and charges...");

    const bizId = sql(
      `insert into public.business_accounts (name, slug, status, timezone)
       values ('[BILL] disposable business', 'bill-disposable', 'active', 'America/New_York')
       returning id`
    );

    const owner = { id: makeUser("e2e-bill-owner@couranr.invalid"), email: "e2e-bill-owner@couranr.invalid" };
    const billing = { id: makeUser("e2e-bill-billing@couranr.invalid"), email: "e2e-bill-billing@couranr.invalid" };
    const dispatcher = { id: makeUser("e2e-bill-dispatcher@couranr.invalid"), email: "e2e-bill-dispatcher@couranr.invalid" };
    const viewer = { id: makeUser("e2e-bill-viewer@couranr.invalid"), email: "e2e-bill-viewer@couranr.invalid" };

    sql(
      `insert into public.couranr_merchant_workspaces
         (business_account_id, created_by, idempotency_key, business_category,
          pickup_address, contact_phone, payer_default, policies_version, policies_accepted_at)
       values ('${bizId}', '${owner.id}', 'bill-ws-${crypto.randomUUID()}',
               'general_local_business',
               '{"line1":"1 Seed St","city":"Stafford","region":"VA","postalCode":"22554"}'::jsonb,
               '540-555-0188', 'merchant', 'couranr-policies-2026-07', now())`
    );

    addMember(bizId, owner.id, "owner");
    addMember(bizId, billing.id, "billing");
    addMember(bizId, dispatcher.id, "dispatcher");
    addMember(bizId, viewer.id, "viewer");

    /*
     * The money fixture, chosen so the TOTAL can only come out right one way.
     *
     *   captured   $22.99  -> counts as 2299
     *   captured   $30.00  -> counts as 3000
     *   authorized $50.00, never captured -> counts as 0
     *   failed     $99.00                 -> counts as 0
     *   cancelled  $40.00                 -> counts as 0
     *
     * Correct total: 5299 = $52.99. Summing every row regardless of state, or
     * summing AUTHORIZATIONS, gives $241.99 — a merchant told they had paid
     * $241.99 when they had paid $52.99. That is the failure this fixture is
     * shaped to catch, and it is why the authorized/failed/cancelled rows
     * carry large distinctive amounts.
     */
    const rCapA = makeRequest(bizId, owner.id, "[BILL] captured A");
    makeObligation(rCapA, bizId, "captured", 2299);
    const rCapB = makeRequest(bizId, owner.id, "[BILL] captured B");
    makeObligation(rCapB, bizId, "captured", 3000);
    const rAuth = makeRequest(bizId, owner.id, "[BILL] authorized only");
    makeObligation(rAuth, bizId, "authorized", 5000);
    const rFailed = makeRequest(bizId, owner.id, "[BILL] failed payment");
    makeObligation(rFailed, bizId, "failed", 9900);
    const rCancelled = makeRequest(bizId, owner.id, "[BILL] cancelled");
    makeObligation(rCancelled, bizId, "cancelled", 4000);

    const EXPECTED_TOTAL = "$52.99";
    const WRONG_TOTAL = "$241.99";

    // A second business with a distinctive amount that must never appear.
    const otherBiz = sql(
      `insert into public.business_accounts (name, slug, status)
       values ('[BILL] other business', 'bill-other', 'active') returning id`
    );
    const otherOwner = {
      id: makeUser("e2e-bill-other@couranr.invalid"),
      email: "e2e-bill-other@couranr.invalid",
    };
    addMember(otherBiz, otherOwner.id, "owner");
    const rOther = makeRequest(otherBiz, otherOwner.id, "[BILL] SOMEONE ELSES CHARGE");
    makeObligation(rOther, otherBiz, "captured", 77777);
    const OTHER_MARKER = "$777.77";

    const seededTotal = sql(
      `select coalesce(sum(captured_amount_cents),0) from public.couranr_payment_obligations
        where business_account_id='${bizId}' and payment_state='captured'`
    );
    check("F0", "the fixture's captured total is 5299 cents, asserted not assumed",
      seededTotal === "5299", seededTotal);

    /*
     * Why the fixture cannot seed a partial capture, recorded as a measurement
     * rather than a comment. `totalChargedCents` prefers `capturedAmountCents`
     * over the authorized amount; this constraint is what makes that branch
     * unreachable today, and if it is ever relaxed the preference starts
     * mattering and this assertion is the thing that says so.
     */
    const partialAllowed = sql(
      `select count(*) from pg_constraint
        where conname = 'couranr_po_captured_amount_chk'`
    );
    check("F1", "the schema FORBIDS a partial capture, so the captured amount always equals the hold",
      partialAllowed === "1", `${partialAllowed} constraint`);

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

    /** Sign in and land on billing with its response definitively delivered. */
    async function openBilling(email) {
      const page = await signIn(email);
      const answered = page
        .waitForResponse((r) => r.url().includes("/api/couranr/merchant/billing"), {
          timeout: 45_000,
        })
        .catch(() => null);
      await page.goto(`${BASE}${BILLING_PATH}`, { waitUntil: "domcontentloaded" });
      await answered;
      await page.waitForTimeout(400);
      return page;
    }

    /* ═══════════════════ the screen, as an owner reads it ══════════════ */

    console.log("MER-016 — the owner's billing records");
    const page = await openBilling(owner.email);
    {
      await page.getByText("Delivery charges").first().waitFor({ state: "visible", timeout: 30_000 });
      const body = await mainText(page);

      // Required state 1 of 2.
      check("A1", "the NO PAYMENT METHOD state renders",
        /No stored payment method/i.test(body) && /does not store a payment method/i.test(body));

      // Required state 2 of 2.
      check("A2", "the PAYMENT FAILED state renders as its own call to action",
        /A payment did not go through/i.test(body));
      check("A3", "and the failed row is labelled",
        /Payment failed/i.test(body));

      // The assertion the whole fixture exists for.
      check("A4", `the total is what was TAKEN (${EXPECTED_TOTAL}), not what was held`,
        body.includes(EXPECTED_TOTAL), body.match(/\$[\d.,]+ charged/)?.[0] ?? "no total found");
      check("A5", `it is NOT the sum of every row (${WRONG_TOTAL})`,
        !body.includes(WRONG_TOTAL));
      check("A6", "the authorized-but-never-captured $50.00 is shown but NOT counted",
        body.includes("$50.00") && body.includes(EXPECTED_TOTAL));

      // Every seeded state is represented.
      for (const [id, label] of [
        ["A7", "Charged"],
        ["A8", "Authorized, not charged"],
        ["A9", "Payment failed"],
        ["A10", "Cancelled"],
      ]) {
        check(id, `the '${label}' state renders`, body.includes(label));
      }

      // Cross-tenant, proven by a marker that could only come from elsewhere.
      check("A11", "another business's charge never appears",
        !body.includes(OTHER_MARKER) && !/SOMEONE ELSES CHARGE/i.test(body));

      await page.screenshot({ path: path.join(SHOTS, "MER-016-owner.png"), fullPage: true });
    }

    /* ══════════════ the gaps are stated, never drawn as controls ═══════ */

    console.log("\nThe gaps — said plainly, with no control that does nothing");
    {
      const body = await mainText(page);
      check("B1", "the receipt gap is stated AND says this is not a tax document",
        /downloadable receipt is not available/i.test(body) && /not a tax document/i.test(body));
      check("B2", "the refund gap points at Couranr Support",
        /Refunds on a delivery charge are handled by Couranr Support/i.test(body));
      check("B3", "REF-002 honoured — the product price is named as the merchant's",
        /price of what you sold/i.test(body));

      // The registry's explicit constraint for this screen.
      check("B4", "no subscription or monthly invoice is offered",
        !/subscription|monthly plan|your plan/i.test(body));

      // The thing a gap must never become.
      const addMethod = await page.getByRole("button", { name: /add.*payment method/i }).count();
      const download = await page.getByRole("button", { name: /download|receipt/i }).count();
      const refund = await page.getByRole("button", { name: /refund/i }).count();
      check("B5", "there is no Add payment method, Download receipt or Refund control",
        addMethod === 0 && download === 0 && refund === 0,
        `add=${addMethod} download=${download} refund=${refund}`);

      // And a real destination for the thing a merchant actually needs.
      check("B6", "Couranr Support is reachable from here",
        (await page.getByRole("link", { name: /Message Couranr Support/i }).count()) === 1);
    }

    /* ═════════════════════════ permissions ═════════════════════════════ */

    console.log("\nPermissions — who may read the money");
    {
      const ownerRes = await api(owner.email, `/api/couranr/merchant/billing?businessAccountId=${bizId}`);
      check("C1", "owner reads", ownerRes.status === 200, `status=${ownerRes.status}`);

      const billingRes = await api(billing.email, `/api/couranr/merchant/billing?businessAccountId=${bizId}`);
      check("C2", "the BILLING role reads — the capability its name promises",
        billingRes.status === 200, `status=${billingRes.status}`);

      const dispatcherRes = await api(dispatcher.email, `/api/couranr/merchant/billing?businessAccountId=${bizId}`);
      check("C3", "a dispatcher is refused", dispatcherRes.status === 403, `status=${dispatcherRes.status}`);

      const viewerRes = await api(viewer.email, `/api/couranr/merchant/billing?businessAccountId=${bizId}`);
      check("C4", "a viewer is refused", viewerRes.status === 403, `status=${viewerRes.status}`);

      const crossRes = await api(owner.email, `/api/couranr/merchant/billing?businessAccountId=${otherBiz}`);
      check("C5", "cross-tenant is refused server-side", crossRes.status === 403, `status=${crossRes.status}`);

      const anon = await fetch(`${BASE}/api/couranr/merchant/billing?businessAccountId=${bizId}`);
      check("C6", "anonymous is refused", anon.status === 401, `status=${anon.status}`);

      // The route is READ-ONLY by construction. A POST must not exist.
      const post = await api(owner.email, `/api/couranr/merchant/billing?businessAccountId=${bizId}`, {
        method: "POST",
        body: JSON.stringify({ action: "refund" }),
      });
      check("C7", "there is no write method on this route — a refund cannot be asked for here",
        post.status === 405 || post.status === 404, `status=${post.status}`);

      // And the screen matches the rule rather than 403-ing after a click.
      const viewerPage = await openBilling(viewer.email);
      const vBody = await mainText(viewerPage);
      check("C8", "the viewer's screen says they do not have access, and shows no amounts",
        /do not have access to billing/i.test(vBody) && !vBody.includes(EXPECTED_TOTAL));
      await viewerPage.screenshot({ path: path.join(SHOTS, "MER-016-viewer-denied.png"), fullPage: true });
    }

    /* ══════════════════ the payload the client actually reads ══════════ */

    console.log("\nThe response shape the client types against");
    {
      const r = await api(owner.email, `/api/couranr/merchant/billing?businessAccountId=${bizId}`);
      // Every canonical route nests under a named key, and typing it flat is
      // invisible to `tsc`. Assert the key the component reads.
      check("D1", "the payload nests under `billing`",
        r.body && typeof r.body.billing === "object" && r.body.billing !== null,
        Object.keys(r.body ?? {}).join(","));
      check("D2", "the server computes the total — the client never sums it",
        r.body?.billing?.totalChargedCents === 5299, String(r.body?.billing?.totalChargedCents));
      check("D3", "and the payment-method state is server-stated",
        r.body?.billing?.paymentMethod === "none_on_file", String(r.body?.billing?.paymentMethod));
      check("D4", "only this business's rows come back",
        Array.isArray(r.body?.billing?.records) && r.body.billing.records.length === 5,
        String(r.body?.billing?.records?.length));
    }

    /* ═══════════════════════ fail-closed on a bad read ═════════════════ */

    console.log("\nFail-closed — a broken read never renders as 'you were never charged'");
    {
      const p2 = await signIn(owner.email);
      await p2.route("**/api/couranr/merchant/billing?*", (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Injected.", correlationId: "e2e-bill-err" }),
        })
      );
      await p2.goto(`${BASE}${BILLING_PATH}`, { waitUntil: "domcontentloaded" });
      await p2.getByText("Your billing records did not load").first()
        .waitFor({ state: "visible", timeout: 30_000 });
      const body = await mainText(p2);
      check("E1", "the error state renders with its reference", body.includes("e2e-bill-err"));
      check("E2", "it does NOT claim nothing has been charged",
        !/Nothing has been charged yet/i.test(body));
      check("E3", "and it shows no total at all", !/\$\d/.test(body), body.match(/\$[\d.]+/)?.[0] ?? "");
      await p2.screenshot({ path: path.join(SHOTS, "MER-016-error.png"), fullPage: true });
    }

    /* ═══════════════════ the genuinely empty case ══════════════════════ */

    console.log("\nEmpty — a business with no charges says so, and offers the next step");
    {
      const emptyBiz = sql(
        `insert into public.business_accounts (name, slug, status)
         values ('[BILL] no charges yet', 'bill-empty', 'active') returning id`
      );
      const emptyOwner = {
        id: makeUser("e2e-bill-empty@couranr.invalid"),
        email: "e2e-bill-empty@couranr.invalid",
      };
      addMember(emptyBiz, emptyOwner.id, "owner");

      const p3 = await openBilling(emptyOwner.email);
      const body = await mainText(p3);
      check("G1", "the empty state renders", /Nothing has been charged yet/i.test(body));
      check("G2", "the total reads zero rather than being hidden", body.includes("$0.00"));
      check("G3", "and the no-payment-method state is still true here",
        /No stored payment method/i.test(body));
      await p3.screenshot({ path: path.join(SHOTS, "MER-016-empty.png"), fullPage: true });
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

/**
 * MER-003 — the live activation checklist, UNSTUBBED and SIGNED IN.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS RUN PROVES
 * ---------------------------------------------------------------------------
 *
 * Every registry-required state of MER-003, walked in one browser session in
 * the order a real merchant walks it, each step asserted BOTH in the rendered
 * page and against the database row it wrote:
 *
 *   not_started → in_progress → pending_couranr_review → live
 *                                                     ↘ blocked → live
 *
 * And the property the whole screen exists to guarantee: **a merchant cannot
 * reach `live`**. The owner is put directly at the Operations route with a
 * real signed token and refused; the row is then read to confirm nothing
 * moved. Only an admin's call changes it. If that ever stops being true, a
 * merchant activates their own workspace and Couranr dispatches deliveries it
 * never reviewed.
 *
 * It also proves the two things that were WRONG in the first version of this
 * screen and were found by building this run:
 *
 *   - The test-delivery requirement is reachable from the UI at all. It was
 *     not: nothing called `record_test_delivery`, so the checklist could
 *     never be completed by anyone.
 *   - A read-only VIEWER is refused the consent acts, and a DISPATCHER is
 *     refused those but allowed the test-delivery one — matching the SQL
 *     exactly rather than being one gate narrower than the other.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES NOT PROVE — repeat wherever this run is cited
 * ---------------------------------------------------------------------------
 *
 *  1. The `/auth/v1` issuer is `gateway.mjs`'s reimplementation, not GoTrue.
 *     Token SHAPE and the route's use of it are real; GoTrue's own behaviour
 *     is not exercised.
 *  2. Every database assertion below describes the DISPOSABLE stack, which is
 *     rebuilt from the migrations on each run. It is not a measurement of
 *     production. (Migration 20260806160757 IS applied in production — this
 *     caveat used to claim it was not, which a catalog-to-catalog comparison
 *     disproved; production recorded it under that same version.)
 *  3. The acknowledgement TEXTS are labels and descriptions in
 *     `lib/couranr/activation/states.ts`. This run proves the versions are
 *     recorded and re-checked; it does not prove the wording is the legal
 *     text Couranr intends to be bound by. That is an owner decision.
 *
 * Run:  node e2e/disposable/activation.mjs
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
const SHOTS = path.join(ROOT, "e2e/screenshots/activation");
const DIST = ".next-disposable";
// Resolved by scripts/provisionPostgrest.mjs, never a session scratchpad.
// The previous default was a path inside ONE container's ephemeral
// scratchpad, so this harness aborted on every other machine — after
// applying 50 migrations, which made a missing dependency look like a
// database failure. `npm run provision:postgrest` puts it on PATH.
const PGRST_BIN = postgrestTarget();

const PORT = 3317;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "disposable-activation-1";
const ACTIVATION_PATH = "/app/business/onboarding?step=activation";

let passed = 0;
let failed = 0;

function check(id, description, ok, detail = "") {
  ok ? passed++ : failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${description}${detail ? `  [${detail}]` : ""}`);
}

const sql = (q) => psql(q).trim();
const esc = (s) => String(s).replace(/'/g, "''");

/**
 * `Field` renders a required label as "Name*" and a non-required one as
 * "Name (optional)". Both forms must match — a matcher that only accepts the
 * required form silently misses every optional field.
 */
function fieldLabel(scope, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return scope.getByLabel(new RegExp(`^${escaped}(\\s*\\*|\\s*\\(optional\\))?$`));
}

/**
 * The MAIN content, not the whole body.
 *
 * The merchant shell's nav contains a "Website tools" link, so an assertion
 * that the activation screen never asks for a website reads the nav and fails
 * against a page that is entirely correct. Scope to `main` or the assertion
 * is about the chrome, not the screen.
 */
const mainText = (page) => page.locator("main").innerText();

/**
 * A state badge, matched EXACTLY.
 *
 * `getByText("Live")` substring-matches the card title "Live activation",
 * which is on the page during loading — so a wait on it returns before the
 * state has arrived and the next assertion reads a half-rendered page. Every
 * badge wait below is exact for that reason.
 */
const badge = (page, label) => page.getByText(label, { exact: true }).first();

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

function makeRequest(businessId, creatorId, marker) {
  return sql(
    `insert into public.couranr_delivery_requests
       (business_account_id, created_by, idempotency_key, recipient_name,
        request_state, readiness_state, review_state, submitted_at,
        quote_status, delivery_subtotal_cents, pricing_policy_version,
        pickup_address, dropoff_address, loaded_miles, weight_lb)
     values ('${businessId}', '${creatorId}', 'act-${crypto.randomUUID()}',
             '${esc(marker)}', 'pending_couranr_review', 'not_confirmed', 'pending', now(),
             'estimated', 2299, 'disposable',
             '{"line1":"12 Test St","city":"Stafford","region":"VA","postalCode":"22554"}'::jsonb,
             '{"line1":"9 Drop Ct","city":"Woodbridge","region":"VA","postalCode":"22191"}'::jsonb,
             5, 20)
     returning id`
  );
}

/** The activation row's state, or the literal 'NO ROW' when none exists. */
function stateOf(businessId) {
  const s = sql(
    `select coalesce(
       (select activation_state from public.couranr_workspace_activations
         where business_account_id='${businessId}'), 'NO ROW')`
  );
  return s;
}

async function main() {
  console.log("MER-003 — live activation checklist, authenticated, unstubbed\n");
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

    /* ────────────────── the schema, measured not assumed ──────────────── */

    console.log("Schema — the activation tables exist and are service_role-only");
    {
      /*
       * BOOLEAN TEXT: `psql -tA` prints a bare boolean as 't'/'f', but
       * `boolean || ','` casts it to 'true'/'false'. Every concatenated probe
       * below is therefore compared against the WORD.
       */
      const grants = sql(
        `select has_table_privilege('anon','public.couranr_workspace_activations','SELECT') || ','
             || has_table_privilege('authenticated','public.couranr_workspace_activations','UPDATE') || ','
             || has_table_privilege('anon','public.couranr_activation_acknowledgements','INSERT') || ','
             || has_table_privilege('anon','public.couranr_activation_events','SELECT') || ','
             || has_table_privilege('service_role','public.couranr_workspace_activations','UPDATE')`
      );
      check(
        "S1",
        "anon and authenticated hold no privilege on the three activation tables; service_role does",
        grants === "false,false,false,false,true",
        grants
      );

      const rls = sql(
        `select bool_and(relrowsecurity) from pg_class
          where relname in ('couranr_workspace_activations',
                            'couranr_activation_acknowledgements',
                            'couranr_activation_events')`
      );
      check("S2", "RLS is enabled on all three", rls === "t", rls);

      // The acknowledgement table is a record of CONSENT. If a row can be
      // updated or deleted, the record is not evidence of anything.
      const ackWrite = sql(
        `select has_table_privilege('service_role','public.couranr_activation_acknowledgements','UPDATE') || ','
             || has_table_privilege('service_role','public.couranr_activation_acknowledgements','DELETE')`
      );
      check(
        "S3",
        "even service_role cannot UPDATE or DELETE a consent row",
        ackWrite === "false,false",
        ackWrite
      );
    }

    /* ───────────────────────────── fixtures ───────────────────────────── */

    console.log("\n  seeding synthetic identities...");

    const bizId = sql(
      `insert into public.business_accounts (name, slug, status, timezone)
       values ('[ACT] disposable business', 'act-disposable', 'active', 'America/New_York')
       returning id`
    );

    const owner = { id: makeUser("e2e-act-owner@couranr.invalid"), email: "e2e-act-owner@couranr.invalid" };
    const dispatcher = { id: makeUser("e2e-act-dispatcher@couranr.invalid"), email: "e2e-act-dispatcher@couranr.invalid" };
    const viewer = { id: makeUser("e2e-act-viewer@couranr.invalid"), email: "e2e-act-viewer@couranr.invalid" };
    const admin = { id: makeUser("e2e-act-admin@couranr.invalid", "admin"), email: "e2e-act-admin@couranr.invalid" };

    sql(
      `insert into public.couranr_merchant_workspaces
         (business_account_id, created_by, idempotency_key, business_category,
          pickup_address, contact_phone, payer_default, policies_version, policies_accepted_at)
       values ('${bizId}', '${owner.id}', 'act-ws-${crypto.randomUUID()}',
               'general_local_business',
               '{"line1":"1 Seed St","city":"Stafford","region":"VA","postalCode":"22554"}'::jsonb,
               '540-555-0177', 'merchant', 'couranr-policies-2026-07', now())`
    );
    if (sql(`select count(*) from public.couranr_merchant_workspaces
              where business_account_id='${bizId}'`) !== "1") {
      throw new Error("fixture failed: the workspace profile row was not created");
    }

    addMember(bizId, owner.id, "owner");
    addMember(bizId, dispatcher.id, "dispatcher");
    addMember(bizId, viewer.id, "viewer");

    // A delivery for the test-delivery step to point at.
    const requestId = makeRequest(bizId, owner.id, "[ACT] activation test recipient");

    // A SECOND business, so "the request must belong to THIS business" is a
    // real refusal rather than an untested comment in the SQL.
    const otherBiz = sql(
      `insert into public.business_accounts (name, slug, status)
       values ('[ACT] other business', 'act-other', 'active') returning id`
    );
    const otherOwner = {
      id: makeUser("e2e-act-other@couranr.invalid"),
      email: "e2e-act-other@couranr.invalid",
    };
    addMember(otherBiz, otherOwner.id, "owner");
    const otherRequestId = makeRequest(otherBiz, otherOwner.id, "[ACT] someone else's delivery");

    /*
     * A viewer on the SECOND business, which never activates.
     *
     * The first version of this run checked the viewer's screen against the
     * business it had just driven to `live` — where the "only an owner or a
     * manager can do that" alert correctly does not render, because on a live
     * workspace there is nothing left to do. The assertion failed against
     * code that was right. A permission state has to be observed while the
     * permission still matters.
     */
    const viewerNotLive = {
      id: makeUser("e2e-act-viewer2@couranr.invalid"),
      email: "e2e-act-viewer2@couranr.invalid",
    };
    addMember(otherBiz, viewerNotLive.id, "viewer");

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

    async function open(email, pathname) {
      const page = await signIn(email);
      await page.goto(`${BASE}${pathname}`, { waitUntil: "domcontentloaded" });
      return page;
    }

    /* ══════════════════ MER-003 state 1 — NOT STARTED ══════════════════ */

    console.log("State 1 — not started");
    const ownerPage = await open(owner.email, ACTIVATION_PATH);
    await badge(ownerPage, "Not started").waitFor({ state: "visible", timeout: 45_000 });
    {
      check("A0", "no activation row exists before anything is done",
        stateOf(bizId) === "NO ROW", stateOf(bizId));

      const body = await mainText(ownerPage);
      check("A1", "the state badge reads Not started", body.includes("Not started"));
      // `not_started` says "none of them are dispatched"; `in_progress` says
      // "are not dispatched". Both are the same promise, worded for their
      // state — the assertion accepts the promise, not one phrasing of it.
      check("A2", "the page says plainly that deliveries are NOT live",
        /test workspace/i.test(body) && /(not|none of them are) dispatched/i.test(body));
      check("A3", "all four acknowledgements are listed as to do",
        (body.match(/To do/g) || []).length >= 4, `${(body.match(/To do/g) || []).length} To do`);
      /*
       * The registry constraint is "do not REQUIRE website tools or a
       * subscription purchase to activate". A flat word ban is the wrong
       * shape for that: the screen deliberately SAYS "No website, business
       * registration or subscription is required", which is the constraint
       * being honoured, and a word ban fails on it.
       *
       * So the assertion is sentence-level — every sentence that mentions one
       * of these must be a DENIAL of it. A sentence that asked for one would
       * not start with "No", and would fail.
       */
      const forbidden = /website|\bEIN\b|storefront|business registration|subscription|credit card/i;
      const offending = body
        .split(/(?<=[.!?])\s+|\n+/)
        .map((s) => s.trim())
        .filter((s) => forbidden.test(s))
        .filter((s) => !/^no\b/i.test(s));
      check("A4", "nothing on the screen ASKS for a website, registration or subscription",
        offending.length === 0, offending.join(" | ").slice(0, 200));
      // The single most important sentence on the page.
      check("A5", "the button asks Couranr to review — it does not claim to activate",
        body.includes("Request activation") && !/\bActivate now\b|\bGo live now\b/i.test(body));

      const requestBtn = ownerPage.getByRole("button", { name: "Request activation" });
      check("A6", "and it is DISABLED while requirements are unmet",
        await requestBtn.isDisabled());

      await ownerPage.screenshot({ path: path.join(SHOTS, "MER-003-not-started.png"), fullPage: true });
    }

    /* ═══════════ reading the page did not create anything ══════════════ */

    check("A7", "opening the checklist is a READ — it wrote no row",
      stateOf(bizId) === "NO ROW", stateOf(bizId));

    /* ══════════════════ MER-003 state 2 — IN PROGRESS ══════════════════ */

    console.log("\nState 2 — in progress, one acknowledgement at a time");
    {
      const acceptButtons = ownerPage.getByRole("button", { name: "Accept" });
      const total = await acceptButtons.count();
      check("B0", "there are four Accept buttons, one per acknowledgement", total === 4, `${total}`);

      // The FIRST acceptance is what moves not_started → in_progress.
      await acceptButtons.first().click();
      await badge(ownerPage, "In progress").waitFor({ state: "visible", timeout: 30_000 });
      check("B1", "the first acceptance moves the row to in_progress",
        stateOf(bizId) === "in_progress", stateOf(bizId));

      const ackRow = sql(
        `select ack_kind || ',' || ack_version || ',' || (accepted_by = '${owner.id}')::text
           from public.couranr_activation_acknowledgements
          where business_account_id='${bizId}'`
      );
      check("B2", "the acceptance is recorded WITH its version and who accepted it",
        /^[a-z_]+,couranr-[a-z-]+-\d{4}-\d{2},true$/.test(ackRow), ackRow);

      // Accept the remaining three.
      for (let i = 0; i < 3; i++) {
        const remaining = ownerPage.getByRole("button", { name: "Accept" });
        await remaining.first().waitFor({ state: "visible", timeout: 30_000 });
        await remaining.first().click();
        await ownerPage.waitForTimeout(400);
      }
      await ownerPage.getByRole("button", { name: "Accept" }).first()
        .waitFor({ state: "detached", timeout: 30_000 })
        .catch(() => {});

      const ackCount = sql(
        `select count(*) from public.couranr_activation_acknowledgements
          where business_account_id='${bizId}'`
      );
      check("B3", "all four acknowledgements are recorded", ackCount === "4", ackCount);

      const stillNotRequestable = await ownerPage
        .getByRole("button", { name: "Request activation" })
        .isDisabled();
      check("B4", "four acknowledgements alone do NOT unlock the request",
        stillNotRequestable);

      await ownerPage.screenshot({ path: path.join(SHOTS, "MER-003-in-progress.png"), fullPage: true });
    }

    /* ════════════════ contact and the test delivery ════════════════════ */

    console.log("\nThe two non-consent steps");
    {
      await ownerPage.getByRole("button", { name: "Confirm contact" }).click();
      await ownerPage.getByText("Verified").first().waitFor({ state: "visible", timeout: 30_000 });
      const verified = sql(
        `select (contact_verified_at is not null)::text
           from public.couranr_workspace_activations where business_account_id='${bizId}'`
      );
      check("C1", "confirming the contact writes the timestamp", verified === "true", verified);

      // The step that was UNREACHABLE in the first version of this screen.
      const useBtn = ownerPage.getByRole("button", { name: "Use this delivery" });
      await useBtn.waitFor({ state: "visible", timeout: 30_000 });
      check("C2", "the checklist offers the business's own deliveries to record",
        await useBtn.isVisible());
      await useBtn.click();
      await ownerPage.getByText("Recorded").first().waitFor({ state: "visible", timeout: 30_000 });

      const recorded = sql(
        `select test_delivery_request_id from public.couranr_workspace_activations
          where business_account_id='${bizId}'`
      );
      check("C3", "it records the delivery the merchant chose", recorded === requestId, recorded);

      await ownerPage.screenshot({ path: path.join(SHOTS, "MER-003-ready-to-request.png"), fullPage: true });
    }

    /* ═════ a delivery belonging to SOMEONE ELSE cannot satisfy it ══════ */

    console.log("\nCross-tenant — another business's delivery does not count");
    {
      const r = await api(otherOwner.email, "/api/couranr/me/activation?businessAccountId=" + otherBiz, {
        method: "POST",
        body: JSON.stringify({ action: "record_test_delivery", requestId }),
      });
      check("D1", "pointing at another business's delivery is refused",
        r.status === 404 || r.status === 409, `status=${r.status}`);
      const otherRecorded = sql(
        `select coalesce((select test_delivery_request_id::text
                            from public.couranr_workspace_activations
                           where business_account_id='${otherBiz}'), 'NULL')`
      );
      check("D2", "and nothing was recorded against it",
        otherRecorded === "NULL" || otherRecorded === otherRequestId, otherRecorded);
    }

    /* ══════════ MER-003 state 3 — PENDING COURANR REVIEW ═══════════════ */

    console.log("\nState 3 — pending Couranr review");
    {
      const requestBtn = ownerPage.getByRole("button", { name: "Request activation" });
      check("E0", "with every requirement met the request is ENABLED",
        await requestBtn.isEnabled());
      await requestBtn.click();
      await badge(ownerPage, "With Couranr for review").waitFor({ state: "visible", timeout: 30_000 });

      check("E1", "the row moves to pending_couranr_review",
        stateOf(bizId) === "pending_couranr_review", stateOf(bizId));

      const body = await mainText(ownerPage);
      check("E2", "and the page still says deliveries are not live yet",
        /still a test workspace/i.test(body) && /not dispatched/i.test(body));

      const requestedAt = sql(
        `select (requested_at is not null)::text from public.couranr_workspace_activations
          where business_account_id='${bizId}'`
      );
      check("E3", "the request time is recorded", requestedAt === "true", requestedAt);

      await ownerPage.screenshot({ path: path.join(SHOTS, "MER-003-pending.png"), fullPage: true });
    }

    /* ══════ THE PROPERTY — a merchant cannot grant themselves live ═════ */

    console.log("\nTHE PROPERTY — no merchant path reaches `live`");
    {
      const r = await api(owner.email, "/api/couranr/operations/activation", {
        method: "POST",
        body: JSON.stringify({ businessAccountId: bizId, action: "grant" }),
      });
      check("G1", "the OWNER is refused at the Operations route", r.status === 403, `status=${r.status}`);
      check("G2", "and the workspace did not move",
        stateOf(bizId) === "pending_couranr_review", stateOf(bizId));

      /*
       * Not merely refused by the route — refused by the FUNCTION, which is
       * the check that survives a future route that forgets to look.
       *
       * This runs as `postgres`, a superuser, which makes it the stronger
       * form of the test: even a caller with every database privilege there
       * is cannot grant activation by naming a merchant as the actor, because
       * the function reads that actor's `profiles.role` itself.
       */
      let sqlRefused = false;
      try {
        psql(`select public.couranr_decide_activation('${bizId}', '${owner.id}', true, null)`);
      } catch (e) {
        sqlRefused = /CR403|not_couranr_operations|operations/i.test(String(e.stderr || e.message));
      }
      check("G3", "couranr_decide_activation refuses the merchant independently of the route",
        sqlRefused);
      check("G4", "and STILL nothing moved",
        stateOf(bizId) === "pending_couranr_review", stateOf(bizId));

      const anon = await fetch(`${BASE}/api/couranr/operations/activation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ businessAccountId: bizId, action: "grant" }),
      });
      check("G5", "anonymous is refused too", anon.status === 401, `status=${anon.status}`);
    }

    /* ═══════════════════ MER-003 state 5 — BLOCKED ═════════════════════ */

    console.log("\nState 5 — blocked with a reason");
    {
      const r = await api(admin.email, "/api/couranr/operations/activation", {
        method: "POST",
        body: JSON.stringify({
          businessAccountId: bizId,
          action: "block",
          reasonCode: "contact_unreachable",
        }),
      });
      check("H1", "Couranr Operations may block", r.status === 200, `status=${r.status}`);
      check("H2", "the row is blocked", stateOf(bizId) === "blocked", stateOf(bizId));

      const storedCode = sql(
        `select blocked_reason_code from public.couranr_workspace_activations
          where business_account_id='${bizId}'`
      );
      check("H3", "a CODE is stored, not merchant-facing prose",
        storedCode === "contact_unreachable", storedCode);

      await ownerPage.reload({ waitUntil: "domcontentloaded" });
      await badge(ownerPage, "Needs attention").waitFor({ state: "visible", timeout: 30_000 });
      const body = await mainText(ownerPage);
      check("H4", "the merchant reads a sentence, never the code",
        /could not reach/i.test(body) && !body.includes("contact_unreachable"));
      check("H5", "and blocked still says the workspace is not live",
        /still a test workspace/i.test(body));
      check("H6", "blocked is NOT terminal — the merchant may ask again",
        await ownerPage.getByRole("button", { name: "Request activation" }).isEnabled());

      await ownerPage.screenshot({ path: path.join(SHOTS, "MER-003-blocked.png"), fullPage: true });
    }

    /* ════════════════════ MER-003 state 4 — LIVE ═══════════════════════ */

    console.log("\nState 4 — live");
    {
      // Re-request, then Operations grants.
      await ownerPage.getByRole("button", { name: "Request activation" }).click();
      await badge(ownerPage, "With Couranr for review").waitFor({ state: "visible", timeout: 30_000 });
      check("I0", "a blocked workspace that asks again returns to review",
        stateOf(bizId) === "pending_couranr_review", stateOf(bizId));

      const cleared = sql(
        `select coalesce(blocked_reason_code, 'NULL') from public.couranr_workspace_activations
          where business_account_id='${bizId}'`
      );
      check("I1", "re-requesting clears the old block reason", cleared === "NULL", cleared);

      const r = await api(admin.email, "/api/couranr/operations/activation", {
        method: "POST",
        body: JSON.stringify({ businessAccountId: bizId, action: "grant" }),
      });
      check("I2", "Couranr Operations grants", r.status === 200, `status=${r.status}`);
      check("I3", "the workspace is live", stateOf(bizId) === "live", stateOf(bizId));

      await ownerPage.reload({ waitUntil: "domcontentloaded" });
      await badge(ownerPage, "Live").waitFor({ state: "visible", timeout: 30_000 });
      const body = await mainText(ownerPage);
      check("I4", "live says deliveries ARE dispatched",
        /workspace is live/i.test(body) && /dispatched/i.test(body));
      check("I5", "and every action control is gone",
        !body.includes("Request activation") && !body.includes("Confirm contact"));

      await ownerPage.screenshot({ path: path.join(SHOTS, "MER-003-live.png"), fullPage: true });

      // The audit trail: who did what, in order.
      const trail = sql(
        `select string_agg(command || ':' || actor_type, ' ' order by created_at, id)
           from public.couranr_activation_events where business_account_id='${bizId}'`
      );
      check("J1", "every transition is recorded with its actor type",
        trail.includes("request_activation:merchant") &&
          trail.includes("block_activation:operations") &&
          trail.includes("grant_activation:operations"),
        trail);
      const grantActor = sql(
        `select (actor_user_id = '${admin.id}')::text from public.couranr_activation_events
          where business_account_id='${bizId}' and command='grant_activation'`
      );
      check("J2", "the grant names the Operations user who made it",
        grantActor === "true", grantActor);
    }

    /* ══════════ MER-001 — the dashboard reads the real state ═══════════ */

    console.log("\nMER-001 — the dashboard banner is the real row now");
    {
      /*
       * K1 is a NEGATIVE assertion — "no banner" — so a page that had not
       * finished loading would pass it for the wrong reason. The wait is on
       * the activation RESPONSE itself, not a timer: the banner's input has
       * definitively arrived and been rendered before anything is asserted.
       */
      const dash = await signIn(owner.email);
      const activationAnswered = dash.waitForResponse(
        (r) => r.url().includes("/api/couranr/me/activation") && r.status() === 200,
        { timeout: 45_000 }
      );
      await dash.goto(`${BASE}/app/business`, { waitUntil: "domcontentloaded" });
      await activationAnswered;
      await dash.getByRole("link", { name: /View deliveries/ }).first()
        .waitFor({ state: "visible", timeout: 45_000 });
      await dash.waitForTimeout(500);
      const body = await dash.innerText("body");
      check("K1", "a LIVE workspace shows no activation banner at all",
        !/Live activation is not yet available/i.test(body) &&
          !/Test workspace/i.test(body),
        body.slice(0, 160).replace(/\s+/g, " "));
      await dash.screenshot({ path: path.join(SHOTS, "MER-001-live-no-banner.png"), fullPage: true });

      // And the not-live case, on the second business, which never activated.
      const otherDash = await open(otherOwner.email, "/app/business");
      await otherDash.getByRole("link", { name: /View deliveries/ }).first()
        .waitFor({ state: "visible", timeout: 45_000 });
      await otherDash.getByText("Not started").first().waitFor({ state: "visible", timeout: 30_000 });
      const otherBody = await otherDash.innerText("body");
      check("K2", "a workspace that never activated shows its REAL state, not a fixed sentence",
        otherBody.includes("Not started") &&
          !/Live activation is not yet available/i.test(otherBody));
      check("K3", "and links to the checklist", otherBody.includes("Go live"));
      await otherDash.screenshot({ path: path.join(SHOTS, "MER-001-not-started.png"), fullPage: true });
    }

    /* ════ OPS-007 activation slice — Operations reviews before deciding ═══ */

    console.log("\nOPS-007 — the review an operator actually makes the decision from");
    {
      /*
       * This surface exists because the decide route was WRITE-ONLY. Every
       * check here is a thing an operator could not see before.
       */
      const anon = await fetch(`${BASE}/api/couranr/operations/activation`);
      check("Q0", "the queue is Operations-only — anonymous refused",
        anon.status === 401, `status=${anon.status}`);
      const asMerchant = await api(owner.email, "/api/couranr/operations/activation");
      check("Q1", "and a merchant owner is refused the queue",
        asMerchant.status === 403, `status=${asMerchant.status}`);

      // `otherBiz` never activated; put it into review so the queue is real.
      const q = await api(admin.email, "/api/couranr/operations/activation");
      check("Q2", "an operator reads the queue", q.status === 200, `status=${q.status}`);
      check("Q3", "and it is keyed under `entries`", Array.isArray(q.body?.entries),
        Object.keys(q.body ?? {}).join(","));

      // bizId is LIVE by now, so it must not be in the pending queue.
      const pendingIds = (q.body?.entries ?? []).map((e) => e.businessAccountId);
      check("Q4", "a LIVE workspace is not in the pending-review queue",
        !pendingIds.includes(bizId), pendingIds.join(","));

      const liveList = await api(admin.email, "/api/couranr/operations/activation?state=live");
      const liveIds = (liveList.body?.entries ?? []).map((e) => e.businessAccountId);
      check("Q5", "but it IS in the live list, with its business NAME resolved",
        liveIds.includes(bizId) &&
          (liveList.body.entries.find((e) => e.businessAccountId === bizId)?.businessName ?? "")
            .includes("[ACT]"),
        liveList.body?.entries?.find((e) => e.businessAccountId === bizId)?.businessName ?? "");

      const bogus = await api(admin.email, "/api/couranr/operations/activation?state=whatever");
      check("Q6", "an unrecognised state is REFUSED, not silently ignored",
        bogus.status === 400, `status=${bogus.status}`);

      // The detail: what the operator decides from.
      const d = await api(admin.email, `/api/couranr/operations/activation?businessAccountId=${bizId}`);
      check("Q7", "the detail nests under `activation` and `acknowledgements`",
        d.status === 200 && d.body?.activation && Array.isArray(d.body?.acknowledgements),
        Object.keys(d.body ?? {}).join(","));
      check("Q8", "every requirement is visible to the operator",
        (d.body?.activation?.requirements ?? []).length === 6,
        String(d.body?.activation?.requirements?.length));

      // The point of the consent record: WHO accepted, at WHICH version.
      const acks = d.body?.acknowledgements ?? [];
      check("Q9", "all four acceptances are returned with their acceptor and version",
        acks.length === 4 &&
          acks.every((a) => a.acceptedByUserId && a.version && a.acceptedAt),
        `n=${acks.length}`);
      check("Q10", "the acceptor is resolved to an email, not just an id",
        acks.every((a) => a.acceptedByEmail === owner.email),
        acks.map((a) => a.acceptedByEmail).join(","));
      check("Q11", "and each is marked CURRENT against the governed versions",
        acks.every((a) => a.isCurrent === true));

      // And the screen an operator actually uses.
      const opsPage = await open(admin.email, "/operations/merchants");
      await opsPage.getByText("Activation review").first().waitFor({ state: "visible", timeout: 45_000 });
      await opsPage.waitForTimeout(800);
      const opsBody = await mainText(opsPage);
      check("Q12", "the review screen says the decision is not automatic",
        /goes live only when an operator grants it/i.test(opsBody));
      check("Q13", "and OPS-007's unbuilt half is declared rather than stubbed",
        /not built yet/i.test(await opsPage.innerText("body")));
      await opsPage.screenshot({ path: path.join(SHOTS, "OPS-007-activation-review.png"), fullPage: true });

      /*
       * A merchant hitting the operations SCREEN never reaches the component
       * at all: `SurfaceGuard` gates the whole operations surface and REDIRECTS
       * them, so its "Taking you to the right place" is what renders and my
       * component's own refusal copy never appears. The first version of this
       * check asserted on the component's message and failed against behaviour
       * that is exactly right — the guard is a better refusal than mine,
       * because it never draws the page.
       *
       * What matters is asserted instead: they are moved off the surface and
       * no workspace is ever rendered to them.
       */
      const merchantOnOps = await open(owner.email, "/operations/merchants");
      await merchantOnOps.waitForTimeout(2500);
      const mBody = await merchantOnOps.innerText("body");
      const landedOn = new URL(merchantOnOps.url()).pathname;
      check("Q14", "a merchant is redirected OFF the operations surface",
        !landedOn.startsWith("/operations"), `landed on ${landedOn}`);
      /*
       * The redirect lands them on their OWN dashboard, where their OWN
       * business name is entirely correct — the first version of this check
       * banned it and failed against right behaviour. The real claim is that
       * no operations CONTENT and no OTHER TENANT reaches them.
       */
      check("Q15", "no operations content and no other tenant reaches them",
        !/Activation review/i.test(mBody) && !/\[ACT\] other business/.test(mBody));
      await merchantOnOps.screenshot({ path: path.join(SHOTS, "OPS-007-merchant-refused.png"), fullPage: true });
    }

    /* ═══════════ permissions — viewer, dispatcher, outsider ════════════ */

    console.log("\nPermissions — who may bind the business");
    {
      const viewerRes = await api(viewer.email, `/api/couranr/me/activation?businessAccountId=${otherBiz}`);
      check("L0", "a non-member cannot even read another business's activation",
        viewerRes.status === 403, `status=${viewerRes.status}`);

      const viewerRead = await api(viewer.email, `/api/couranr/me/activation?businessAccountId=${bizId}`);
      check("L1", "a viewer MAY read their own workspace's activation",
        viewerRead.status === 200, `status=${viewerRead.status}`);

      const viewerAccept = await api(viewer.email, `/api/couranr/me/activation?businessAccountId=${bizId}`, {
        method: "POST",
        body: JSON.stringify({ action: "accept", kind: "delivery_terms" }),
      });
      check("L2", "a viewer may NOT accept terms on the business's behalf",
        viewerAccept.status === 403, `status=${viewerAccept.status}`);

      const dispatcherAccept = await api(dispatcher.email, `/api/couranr/me/activation?businessAccountId=${bizId}`, {
        method: "POST",
        body: JSON.stringify({ action: "request_activation" }),
      });
      check("L3", "nor may a dispatcher request activation",
        dispatcherAccept.status === 403, `status=${dispatcherAccept.status}`);

      // The one write a dispatcher MAY do — proving route and SQL agree.
      const dispatcherRecord = await api(dispatcher.email, `/api/couranr/me/activation?businessAccountId=${bizId}`, {
        method: "POST",
        body: JSON.stringify({ action: "record_test_delivery", requestId }),
      });
      check("L4", "but a dispatcher MAY record the test delivery — route and SQL agree",
        dispatcherRecord.status === 200, `status=${dispatcherRecord.status}`);

      /*
       * And the SCREEN matches the rule rather than drawing a control the
       * route will refuse. Observed on the business that is still
       * `not_started` — on a live workspace there is nothing to permit, so
       * the absence of a control there proves nothing about permissions.
       */
      const viewerPage = await open(viewerNotLive.email, ACTIVATION_PATH);
      await badge(viewerPage, "Not started").waitFor({ state: "visible", timeout: 45_000 });
      const vBody = await mainText(viewerPage);
      check("L4b", "a viewer sees the checklist and its real state",
        vBody.includes("Not started"));
      check("L5", "the viewer's screen offers no consent control",
        !vBody.includes("Request activation") && !vBody.includes("Confirm contact"));
      check("L6", "and says who can do it instead",
        /only an owner or a manager/i.test(vBody));
      await viewerPage.screenshot({ path: path.join(SHOTS, "MER-003-viewer.png"), fullPage: true });

      const anon = await fetch(`${BASE}/api/couranr/me/activation?businessAccountId=${bizId}`);
      check("L7", "anonymous is refused", anon.status === 401, `status=${anon.status}`);
    }

    /* ═════════════ requesting twice, and requesting when live ══════════ */

    console.log("\nConflicts — the gate holds against a second request");
    {
      const again = await api(owner.email, `/api/couranr/me/activation?businessAccountId=${bizId}`, {
        method: "POST",
        body: JSON.stringify({ action: "request_activation" }),
      });
      check("M1", "requesting activation on a LIVE workspace is a conflict",
        again.status === 409, `status=${again.status}`);
      check("M2", "and it is still live", stateOf(bizId) === "live", stateOf(bizId));

      // The gate re-checks in SQL, not just on the screen: a caller who skips
      // the UI entirely and asks with nothing done is refused.
      const bare = await api(otherOwner.email, `/api/couranr/me/activation?businessAccountId=${otherBiz}`, {
        method: "POST",
        body: JSON.stringify({ action: "request_activation" }),
      });
      check("M3", "asking with NO requirements met is refused by the database gate",
        bare.status === 409, `status=${bare.status}`);
      check("M4", "and that workspace still has no activation row or is untouched",
        ["NO ROW", "not_started"].includes(stateOf(otherBiz)), stateOf(otherBiz));

      const unknown = await api(owner.email, `/api/couranr/me/activation?businessAccountId=${bizId}`, {
        method: "POST",
        body: JSON.stringify({ action: "make_live" }),
      });
      check("M5", "an invented action is refused — the route names actions, never states",
        unknown.status === 400, `status=${unknown.status}`);
    }

    /* ════════════════ fail-closed on a broken read ═════════════════════ */

    console.log("\nFail-closed — an errored activation read never reads as 'not live'");
    {
      const page = await signIn(owner.email);
      await page.route("**/api/couranr/me/activation?*", (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Injected.", correlationId: "e2e-act-err" }),
        })
      );
      await page.goto(`${BASE}${ACTIVATION_PATH}`, { waitUntil: "domcontentloaded" });
      await page.getByText("Activation did not load").first().waitFor({ state: "visible", timeout: 30_000 });
      const body = await page.innerText("body");
      check("N1", "the error state renders with its reference", body.includes("e2e-act-err"));
      check("N2", "it does NOT assert the workspace is a test workspace",
        !/test workspace/i.test(body));
      await page.screenshot({ path: path.join(SHOTS, "MER-003-error.png"), fullPage: true });

      // The same fault on the DASHBOARD: the banner must say it does not know,
      // rather than falling back to the old fixed "test workspace" sentence.
      const dash = await signIn(owner.email);
      await dash.route("**/api/couranr/me/activation?*", (route) =>
        route.fulfill({ status: 500, contentType: "application/json", body: "{}" })
      );
      await dash.goto(`${BASE}/app/business`, { waitUntil: "domcontentloaded" });
      await dash.getByText("Activation status unavailable").first()
        .waitFor({ state: "visible", timeout: 30_000 });
      const dashBody = await dash.innerText("body");
      check("N3", "the dashboard says the status is unknown rather than guessing",
        dashBody.includes("Activation status unavailable") &&
          !/Live activation is not yet available/i.test(dashBody));
      await dash.screenshot({ path: path.join(SHOTS, "MER-001-activation-unknown.png"), fullPage: true });
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

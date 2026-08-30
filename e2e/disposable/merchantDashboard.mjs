/**
 * MER-001 — the merchant dashboard, driven UNSTUBBED and SIGNED IN.
 *
 * Chromium signs in through the real `/sign-in` form against the disposable
 * stack (real Next server, real PostgREST, real PostgreSQL carrying every
 * forward migration) and drives `/app/business` through all five registry-required
 * states (`UI_SCREEN_REGISTRY.md:272`):
 *
 *   D1  New workspace        a user with zero memberships
 *   D2  Empty                a member whose business has no requests
 *   D3  Active day           real rows grouped by request state
 *   D4  Degraded payments    obligations in requires_action / failed /
 *                            capture_pending, surfaced through the SAME
 *                            lifecycle derivation the Operations queue uses
 *   D5  Activation incomplete  the truthful static test-workspace banner
 *
 * EVERY WRITE IS ASSERTED ON BOTH SIDES. The dashboard's one write path is the
 * reused MerchantReadinessPanel; after clicking "Ready for Couranr" the run
 * asserts `readiness_state`, the version bump AND the audit row in
 * `couranr_delivery_request_events` — never the rendering alone.
 *
 * WHAT THIS DOES NOT PROVE — repeat wherever a run is cited: the `/auth/v1`
 * issuer is `gateway.mjs`'s reimplementation, not GoTrue (authGateway.mjs
 * proves 20 refusals against it); and the fixtures are seeded directly because
 * review/authorization commands would need Stripe to reach these states.
 *
 * Run:  node e2e/disposable/merchantDashboard.mjs
 */

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const SHOTS = path.join(ROOT, "e2e/screenshots/merchant-dashboard");
const DIST = ".next-disposable";
// Resolved by scripts/provisionPostgrest.mjs, never a session scratchpad.
// The previous default was a path inside ONE container's ephemeral
// scratchpad, so this harness aborted on every other machine — after
// applying 50 migrations, which made a missing dependency look like a
// database failure. `npm run provision:postgrest` puts it on PATH.
const PGRST_BIN = postgrestTarget();

const PORT = 3313;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "disposable-dashboard-1";

let passed = 0;
let failed = 0;

function check(id, description, ok, detail = "") {
  ok ? passed++ : failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${description}${detail ? `  [${detail}]` : ""}`);
}

const sql = (q) => psql(q).trim();
const esc = (s) => String(s).replace(/'/g, "''");

/** Same label helper as the other harnesses: `Field` renders "Email*". */
function fieldLabel(scope, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return scope.getByLabel(new RegExp(`^${escaped}(\\s*\\*|\\s*\\(optional\\))?$`));
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

/**
 * A request seeded to a named point in the state machine. Confirmed rows carry
 * the estimate-completeness pair the CHECK constraints demand (`submitted_at`,
 * subtotal + policy version), because the schema states what "confirmed"
 * requires — seeding IS reading the schema.
 */
function makeRequest(businessId, creatorId, marker, { state, readiness = "not_confirmed" }) {
  const submitted = state === "draft" ? "null" : "now()";
  const quoted =
    state === "draft"
      ? { status: "not_quoted", subtotal: "null", policy: "null" }
      : { status: "estimated", subtotal: "2299", policy: "'disposable'" };
  return sql(
    `insert into public.couranr_delivery_requests
       (business_account_id, created_by, idempotency_key, recipient_name,
        request_state, readiness_state, submitted_at,
        quote_status, delivery_subtotal_cents, pricing_policy_version)
     values ('${businessId}', '${creatorId}', 'dash-${marker}-${crypto.randomUUID()}',
             '${esc(marker)} recipient', '${state}', '${readiness}', ${submitted},
             '${quoted.status}', ${quoted.subtotal}, ${quoted.policy})
     returning id`
  );
}

/**
 * A live (non-cancelled) obligation in a named payment state, carrying what
 * the schema says that state requires: an authorized (or in-flight) hold must
 * name its PaymentIntent and its `authorized_at`
 * (`couranr_po_authorized_needs_intent_chk`, `couranr_po_authorized_stamp_chk`)
 * — seeding IS reading the schema.
 */
function makeObligation(requestId, businessId, paymentState) {
  const intent = `pi_dash_${crypto.randomUUID().replace(/-/g, "")}`;
  const authorizedAt =
    paymentState === "authorized" || paymentState === "capture_pending" ? "now()" : "null";
  const failedAt = paymentState === "failed" ? "now()" : "null";
  return sql(
    `insert into public.couranr_payment_obligations
       (request_id, business_account_id, payer_type, request_version,
        pricing_policy_version, amount_cents, payment_state, idempotency_key,
        provider_payment_intent_id, authorized_at, failed_at)
     values ('${requestId}', '${businessId}', 'merchant', 1,
             'disposable', 2299, '${paymentState}', 'dash-po-${crypto.randomUUID()}',
             '${intent}', ${authorizedAt}, ${failedAt})
     returning id`
  );
}

/* --------------------------------------------------------------- the harness */

async function main() {
  console.log("MER-001 merchant dashboard — authenticated, unstubbed\n");
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

    // NEXT_PUBLIC_* are inlined at build time; a reused build carries the LAST
    // run's anon key. Same rule as authenticatedMessaging.mjs.
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
    } else {
      console.log("  REUSING the previous build (COURANR_REUSE_BUILD=1)");
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

    // Business A — the active workspace.
    const bizA = sql(
      `insert into public.business_accounts (name, status)
       values ('[DASH] active business', 'active') returning id`
    );
    const owner = { id: makeUser("e2e-dash-owner@couranr.invalid", "customer"),
                    email: "e2e-dash-owner@couranr.invalid" };
    const viewer = { id: makeUser("e2e-dash-viewer@couranr.invalid", "customer"),
                     email: "e2e-dash-viewer@couranr.invalid" };
    for (const [u, role] of [[owner, "owner"], [viewer, "viewer"]]) {
      sql(
        `insert into public.business_members (business_account_id, user_id, role, status)
         values ('${bizA}', '${u.id}', '${role}', 'active')`
      );
    }

    // Business B — a workspace with no deliveries at all.
    const bizB = sql(
      `insert into public.business_accounts (name, status)
       values ('[DASH] empty business', 'active') returning id`
    );
    const emptyOwner = { id: makeUser("e2e-dash-empty@couranr.invalid", "customer"),
                         email: "e2e-dash-empty@couranr.invalid" };
    sql(
      `insert into public.business_members (business_account_id, user_id, role, status)
       values ('${bizB}', '${emptyOwner.id}', 'owner', 'active')`
    );

    // A signed-in user with no membership anywhere.
    const nobody = { id: makeUser("e2e-dash-nobody@couranr.invalid", "customer"),
                     email: "e2e-dash-nobody@couranr.invalid" };

    // The request set for the active day.
    const rDraft = makeRequest(bizA, owner.id, "DASH-draft", { state: "draft" });
    makeRequest(bizA, owner.id, "DASH-review", { state: "pending_couranr_review" });
    const rPrep = makeRequest(bizA, owner.id, "DASH-prep", {
      state: "confirmed",
      readiness: "preparing",
    });
    makeObligation(rPrep, bizA, "authorized");
    const rFailed = makeRequest(bizA, owner.id, "DASH-failed", { state: "confirmed" });
    makeObligation(rFailed, bizA, "failed");
    const rCapture = makeRequest(bizA, owner.id, "DASH-capture", { state: "confirmed" });
    makeObligation(rCapture, bizA, "capture_pending");
    const rAction = makeRequest(bizA, owner.id, "DASH-action", { state: "confirmed" });
    makeObligation(rAction, bizA, "requires_action");

    // One support thread with an unread Couranr message, so the messages tile
    // has a real boolean to render. Direct seed, same reason as the messaging
    // harness: no command creates a merchant_support conversation yet.
    const convId = sql(
      `insert into public.couranr_conversations
         (kind, business_account_id, status, urgency, waiting_on,
          received_at, response_due_at, awaiting_reply_kind, due_state)
       values ('merchant_support', '${bizA}', 'open', 'routine', 'merchant',
               now() - interval '1 hour',
               public.couranr_add_operating_minutes(now() - interval '1 hour', 15),
               'merchant', 'on_time')
       returning id`
    );
    sql(
      `insert into public.couranr_conversation_participants
         (conversation_id, participant_kind, user_id, member_role)
       values ('${convId}', 'merchant', '${owner.id}', 'owner')`
    );
    const opsUser = { id: makeUser("e2e-dash-ops@couranr.invalid", "admin") };
    const opsPart = sql(
      `insert into public.couranr_conversation_participants
         (conversation_id, participant_kind, user_id)
       values ('${convId}', 'operations', '${opsUser.id}')
       returning id`
    );
    sql(
      `insert into public.couranr_conversation_messages
         (conversation_id, author_participant_id, visibility, authorship, body, idempotency_key)
       values ('${convId}', '${opsPart}', 'participants', 'human',
               '[DASH] your account is ready', 'dash-msg-${crypto.randomUUID()}')`
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
      throw new Error(`sign-in for ${email} never left /sign-in. page said: ${text.slice(0, 300)}`);
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

    async function openDashboard(email) {
      const page = await signIn(email);
      await page.goto(`${BASE}/app/business`, { waitUntil: "domcontentloaded" });
      return page;
    }

    /* ══════════════ D5 + D3 + D4 — the active day, as the owner ════════ */

    console.log("Owner — active day, degraded payments, activation banner");
    const ownerPage = await openDashboard(owner.email);

    // The deliveries card is the anchor: once its state groups render, the
    // list call has resolved and the page is past its skeletons.
    await ownerPage.getByText("No deliveries yet").waitFor({ state: "hidden", timeout: 30_000 }).catch(() => {});
    const deliveriesCard = ownerPage.locator(".cr-card", { hasText: "Open deliveries for" });
    await deliveriesCard.waitFor({ state: "visible", timeout: 30_000 });
    // The card renders a skeleton until the list call resolves, and the
    // attention alerts render only after the fulfillment fan-out completes —
    // wait for CONTENT from each async source before snapshotting any text.
    // The first run of this harness read the card mid-skeleton and failed
    // seven rendering checks that were actually fine.
    await deliveriesCard.getByText("Draft", { exact: true })
      .waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
    await ownerPage.getByText("Payment authorization needs attention")
      .waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
    const cardText = (await deliveriesCard.innerText()).replace(/\s+/g, " ");

    // D5 used to assert a STATIC banner reading "Live activation is not yet
    // available". That string no longer exists anywhere in the application —
    // MerchantDashboard's own header records why: it "was true only while no
    // activation state existed anywhere; MER-003 made that sentence false, so
    // it reads the row". The assertion outlived the code by ten migrations and
    // nobody noticed, because no PostgREST binary meant nobody could run this
    // harness at all.
    //
    // What MER-003 makes checkable is stronger: the banner must name the
    // workspace's REAL activation state, from the governed label set.
    // Parsed from the governed module rather than retyped here — Node cannot
    // import a .ts from a .mjs harness, and a hand-copied list is exactly how
    // the old assertion drifted from the code in the first place.
    const labelSrc = readFileSync(
      path.join(ROOT, "lib/couranr/activation/states.ts"),
      "utf8",
    );
    const labelBlock = labelSrc.match(/ACTIVATION_STATE_LABELS[^{]*\{([^}]*)\}/);
    if (!labelBlock) throw new Error("ACTIVATION_STATE_LABELS not found in the governed module");
    const activationLabelByState = Object.fromEntries(
      [...labelBlock[1].matchAll(/(\w+)\s*:\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]),
    );
    if (Object.keys(activationLabelByState).length === 0) {
      throw new Error("parsed zero activation labels from the governed module");
    }

    // "Test workspace" is NOT the banner title either — it is only the
    // fallback for an activation state the label map does not know, so on any
    // healthy row it is unreachable. The old assertion required it and would
    // therefore have gone red the moment MER-003 started returning a real
    // state, whichever state that was.
    //
    // What is worth asserting is the D3d shape: the banner's words must match
    // the row in the database, not merely be one of the governed strings.
    // No row MEANS not_started — lib/couranr/activation/commands.ts:140 returns
    // that default and its comment says "its absence means `not_started`, not
    // an error". The harness encodes the same rule rather than a second one.
    const dbState =
      sql(
        `select activation_state from public.couranr_workspace_activations
          where business_account_id='${bizA}'`
      ).trim() || "not_started";
    const expectedLabel = activationLabelByState[dbState];
    const activationText = await ownerPage.innerText("body");
    check("D5", "the activation banner renders the REAL state, in its governed words",
      Boolean(expectedLabel) && activationText.includes(expectedLabel),
      `db=${dbState || "(no row)"} label=${expectedLabel ?? "(unmapped)"}`);

    /*
     * §13 typography budgets, on a REAL authenticated merchant page.
     *
     * `npm run test:fonts` can prove the shell stamps `data-couranr-surface`
     * but not what the page title computes to, because unauthenticated the
     * merchant shell renders chrome only and there is no heading to measure.
     * That is the one place this harness can answer and that one cannot.
     *
     * §13 gives Merchant "page title; section title; selected entity title" in
     * Martian and Inter for the rest.
     */
    const type = await ownerPage.evaluate(() => {
      const fam = (sel) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).fontFamily : null;
      };
      return {
        surface: document
          .querySelector("[data-couranr-surface]")
          ?.getAttribute("data-couranr-surface"),
        pageTitle: fam(".cr-page-header .cr-heading--1"),
        body: fam(".cr-text"),
      };
    });
    check("T1", "the merchant shell stamps its surface family",
      type.surface === "merchant", String(type.surface));
    check("T2", "the merchant page title computes to Martian (§13)",
      Boolean(type.pageTitle) && type.pageTitle.includes("Martian Grotesk"),
      type.pageTitle ?? "no page title rendered");
    check("T3", "merchant body copy stays Inter (§13)",
      Boolean(type.body) && type.body.includes("Inter"),
      type.body ?? "no body text rendered");

    check("D3a", "state groups are the real rows: 1 draft", /1\s+Draft/.test(cardText), cardText.slice(0, 120));
    check("D3b", "1 pending Couranr review", /1\s+Pending Couranr review/.test(cardText));
    check("D3c", "4 confirmed", /4\s+Confirmed/.test(cardText));
    {
      const db = sql(
        `select request_state, count(*) from public.couranr_delivery_requests
          where business_account_id='${bizA}' group by 1 order by 1`
      );
      check("D3d", "the database groups agree with the rendered counts",
        db.includes("confirmed|4") && db.includes("draft|1") && db.includes("pending_couranr_review|1"),
        db.replace(/\n/g, " "));
    }

    const bodyText = (await ownerPage.innerText("body")).replace(/\s+/g, " ");
    check("D4a", "a settled failure surfaces as 'Payment authorization needs attention'",
      bodyText.includes("Payment authorization needs attention"));
    check("D4b", "an in-flight capture surfaces as 'Capture pending'",
      bodyText.includes("Capture pending"));
    check("D4c", "requires_action surfaces under 'Awaiting payment authorization'",
      bodyText.includes("Awaiting payment authorization"));
    check("D4d", "each attention item links to the real delivery detail",
      await ownerPage.locator(`a[href="/app/business/deliveries/${rFailed}"]`).count() > 0);
    {
      const db = sql(
        `select payment_state from public.couranr_payment_obligations
          where business_account_id='${bizA}' order by payment_state`
      );
      check("D4e", "the degraded tile is backed by exactly these obligation rows",
        db.split("\n").join(",") === "authorized,capture_pending,failed,requires_action", db);
    }

    check("D3e", "no fabricated metric anywhere on the page (no revenue, no on-time %)",
      !/revenue|on-time/i.test(bodyText));
    check("D3f", "messages tile renders the unread BOOLEAN as a badge, with the kind label",
      bodyText.includes("Unread") && bodyText.includes("Couranr Support"));
    check("D3g", "quick actions render for a write role",
      await ownerPage.locator('a[href="/app/business/deliveries/new"]', { hasText: "Create delivery" }).count() > 0);

    await ownerPage.screenshot({ path: path.join(SHOTS, "MER-001-active-day.png"), fullPage: true });

    /* ══════════════ role matrix — the viewer, BEFORE mark-ready ════════ */

    console.log("Viewer — read-only mirror of DRP-001/TRM-002");
    const viewerPage = await openDashboard(viewer.email);
    const viewerCard = viewerPage.locator(".cr-card", { hasText: "Open deliveries for" });
    await viewerCard.waitFor({ state: "visible", timeout: 30_000 });
    // Same rule as the owner page: wait for each async section's content —
    // the read-only preparation card (fulfillment fan-out) and the messages
    // tile's empty body (conversations) — before snapshotting.
    await viewerPage.getByText("can mark this ready")
      .waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
    await viewerPage.getByText("Delivery chats and Couranr Support conversations appear here")
      .waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
    const viewerText = (await viewerPage.innerText("body")).replace(/\s+/g, " ");

    check("R1", "viewer sees NO Create-delivery action",
      (await viewerPage.locator('a[href="/app/business/deliveries/new"]').count()) === 0);
    check("R2", "viewer sees the preparation item read-only, not the readiness writer",
      viewerText.includes("A teammate with a dispatcher, manager, or owner role can mark this ready") &&
      !(await viewerPage.getByRole("button", { name: "Ready for Couranr" }).isVisible().catch(() => false)));
    check("R3", "viewer's messages tile is the TRM-002 refusal/empty state — no thread rendered",
      viewerText.includes("Delivery chats and Couranr Support conversations appear here") &&
      !viewerText.includes("Unread"));
    {
      const r = await api(viewer.email, "/api/couranr/conversations");
      check("R4", "server truth: viewer's conversation list is empty (TRM-002 read gate)",
        r.status === 200 && Array.isArray(r.body?.conversations) && r.body.conversations.length === 0,
        `status=${r.status} n=${r.body?.conversations?.length}`);
    }
    {
      const r = await api(viewer.email, `/api/couranr/delivery-requests/${rPrep}/readiness`, {
        method: "POST",
        body: JSON.stringify({ businessAccountId: bizA, expectedVersion: 1, readiness: "ready" }),
      });
      check("R5", "server truth: viewer's mark-ready is REFUSED — the hidden button mirrors a real rule",
        r.status === 403, `status=${r.status} code=${r.body?.code}`);
      const untouched = sql(
        `select readiness_state from public.couranr_delivery_requests where id='${rPrep}'`
      );
      check("R6", "the refused write changed nothing", untouched === "preparing", untouched);
    }
    await viewerPage.screenshot({ path: path.join(SHOTS, "MER-001-viewer.png"), fullPage: true });

    /* ══════════════ cross-tenant boundary ══════════════════════════════ */

    {
      const r = await api(emptyOwner.email, `/api/couranr/delivery-requests?businessAccountId=${bizA}`);
      check("X1", "a member of business B asking for business A is refused",
        r.status === 403, `status=${r.status} code=${r.body?.code}`);
    }

    /* ══════════════ the dashboard's one write: mark ready ══════════════ */

    console.log("Owner — mark ready from the dashboard, asserted in the database");
    await ownerPage.getByRole("button", { name: "Ready for Couranr" }).click();
    // The panel reloads the whole dashboard; the preparation section empties
    // because the request has left merchant_preparing.
    await ownerPage
      .getByText("Waiting on your preparation")
      .waitFor({ state: "hidden", timeout: 30_000 });

    {
      const row = sql(
        `select readiness_state || '|' || version
           from public.couranr_delivery_requests where id='${rPrep}'`
      );
      check("W1", "readiness_state is 'ready' and the version advanced", row === "ready|2", row);
      const ev = sql(
        `select command || '|' || from_state || '|' || to_state || '|' || actor_type
           from public.couranr_delivery_request_events
          where request_id='${rPrep}' order by created_at desc limit 1`
      );
      check("W2", "the audit event records the named command, both states and the actor",
        ev === "mark_delivery_ready|preparing|ready|merchant", ev);
      const actor = sql(
        `select actor_user_id from public.couranr_delivery_request_events
          where request_id='${rPrep}' order by created_at desc limit 1`
      );
      check("W3", "the audit row names the signed-in owner, not a service identity",
        actor === owner.id, actor);
    }
    await ownerPage.screenshot({ path: path.join(SHOTS, "MER-001-after-ready.png"), fullPage: true });

    /* ══════════════ D2 — empty workspace ═══════════════════════════════ */

    console.log("Empty-business owner — the empty state");
    const emptyPage = await openDashboard(emptyOwner.email);
    await emptyPage.getByText("No deliveries yet").waitFor({ state: "visible", timeout: 30_000 });
    const emptyText = (await emptyPage.innerText("body")).replace(/\s+/g, " ");
    check("D2a", "the empty state renders with a real next action",
      emptyText.includes("No deliveries yet") &&
      (await emptyPage.locator('a[href="/app/business/deliveries/new"]').count()) > 0);
    check("D2b", "the empty state is true: this business has zero request rows",
      sql(`select count(*) from public.couranr_delivery_requests where business_account_id='${bizB}'`) === "0");
    await emptyPage.screenshot({ path: path.join(SHOTS, "MER-001-empty.png"), fullPage: true });

    /* ══════════════ D1 — new workspace ═════════════════════════════════ */

    console.log("Membership-less user — the new-workspace state");
    const newPage = await openDashboard(nobody.email);
    await newPage.getByText("Welcome to Couranr").waitFor({ state: "visible", timeout: 30_000 });
    check("D1a", "zero memberships lands on the onboarding call to action",
      (await newPage.locator('a[href="/app/business/onboarding"]').count()) > 0);
    check("D1b", "the state is true: this user has zero membership rows",
      sql(`select count(*) from public.business_members where user_id='${nobody.id}'`) === "0");
    await newPage.screenshot({ path: path.join(SHOTS, "MER-001-new-workspace.png"), fullPage: true });

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

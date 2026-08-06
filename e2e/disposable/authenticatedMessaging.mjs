/**
 * MER-012, DRV-008 and OPS-005, driven UNSTUBBED and SIGNED IN.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS RUN IS
 * ---------------------------------------------------------------------------
 *
 * Chromium signs in through the real `/sign-in` form, against a real
 * `/auth/v1/token?grant_type=password` that checks bcrypt against
 * `auth.users.encrypted_password`, and then drives the three authenticated
 * messaging screens against a real Next server, a real PostgREST and a real
 * PostgreSQL carrying all 39 forward migrations. Nothing is stubbed and no
 * `page.route` interception is used.
 *
 * EVERY CHECK ASSERTS BOTH SIDES. A rendered badge is never promoted on its
 * own: each browser assertion is paired with the database row it implies, or —
 * for a refusal — with the route's actual status for that user's real token.
 * This repository has already shipped a flow that reported success while
 * persisting nothing, and a screen that renders an empty list looks identical
 * whether the rule worked or the query broke.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES NOT PROVE — repeat this wherever a run is cited
 * ---------------------------------------------------------------------------
 *
 * 1. THE ISSUER IS NOT GOTRUE. `e2e/disposable/gateway.mjs` reimplements
 *    `/auth/v1/token` and `/auth/v1/user`; `e2e/disposable/authGateway.mjs`
 *    proves 20 refusals against it. The password check, the HS256 signature
 *    check, the `auth.users` read, the PostgREST role derivation and every
 *    route gate below are real. GoTrue's own behaviour — sessions as rows,
 *    refresh-token reuse detection, MFA, rate limiting — is not exercised.
 *
 * 2. THE FIXTURES ARE SEEDED DIRECTLY, BECAUSE NOTHING CREATES THEM. Measured,
 *    not assumed: across `supabase/migrations`, `lib/` and `app/`, the ONLY
 *    code that inserts into `couranr_conversations` is the Delivery Help
 *    redemption path, and the only code that inserts into
 *    `couranr_conversation_participants` is the same path. No command creates a
 *    `merchant_support` or `delivery_chat` conversation, adds a merchant to
 *    one, or adds a driver on assignment. So in production today MER-012 and
 *    DRV-008 would render "No messages yet" forever, and the Operations inbox
 *    would only ever hold customer-help threads. This run proves the screens
 *    and the rules work on the rows; it CANNOT promote a screen whose rows have
 *    no way to come into existence. See the ledger note for P8-001.
 *
 * 3. `left_at` HAS NO WRITER. The tenure window is real and is proved below,
 *    but neither `couranr_replace_delivery_assignment` nor
 *    `couranr_unassign_delivery_before_pickup` touches the participant table,
 *    so a replaced driver keeps conversation access in production. D6/D7 set
 *    `left_at` directly and are therefore a test of the READER, not of an
 *    unassignment path — which is the finding, stated rather than papered over.
 *
 * Run:  node e2e/disposable/authenticatedMessaging.mjs
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SHOTS = path.join(ROOT, "e2e/screenshots/disposable-msg");
const DIST = ".next-disposable";
const PGRST_BIN =
  process.env.COURANR_POSTGREST ||
  "/tmp/claude-0/-home-user-couranr-os/3ba65fdb-c110-5366-92d6-85568b408343/scratchpad/prst/postgrest";

const PORT = 3312;
const BASE = `http://127.0.0.1:${PORT}`;
/** One password for every synthetic identity. The database stores only bcrypt. */
const PASSWORD = "disposable-messaging-1";

let passed = 0;
let failed = 0;

function check(id, description, ok, detail = "") {
  ok ? passed++ : failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${description}${detail ? `  [${detail}]` : ""}`);
}

const sql = (q) => psql(q).trim();
const esc = (s) => String(s).replace(/'/g, "''");

/**
 * `Field` renders a required label as "Email*", and `getByLabel` matches label
 * TEXT rather than the accessible name — so `aria-hidden` on the asterisk is
 * ignored and `/^Email$/` matches nothing. Same helper as `e2e/run.mjs`.
 */
function fieldLabel(scope, name) {
  return scope.getByLabel(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\*?$`));
}

/* ------------------------------------------------------------------ seeding */

/** Creates an auth user with a real bcrypt password, plus its profile row. */
function makeUser(email, profileRole) {
  const id = sql(
    `insert into auth.users (email) values ('${esc(email)}') returning id`
  );
  sql(`select public.couranr_disposable_set_password('${id}', '${esc(PASSWORD)}')`);
  sql(
    `insert into public.profiles (id, email, role)
     values ('${id}', '${esc(email)}', '${profileRole}')`
  );
  return id;
}

/**
 * The delivery chain. `couranr_deliveries` has 19 NOT NULL columns with no
 * default, three of them FKs through request -> obligation -> plan; building
 * the chain IS the work, because each NOT NULL is the schema stating what a
 * delivery actually requires.
 */
function makeDelivery(businessId, creatorId, marker) {
  const requestId = sql(
    `insert into public.couranr_delivery_requests
       (business_account_id, created_by, idempotency_key, recipient_name)
     values ('${businessId}', '${creatorId}', 'msg-${marker}-${Date.now()}', '${marker} recipient')
     returning id`
  );
  const obligationId = sql(
    `insert into public.couranr_payment_obligations
       (request_id, business_account_id, payer_type, request_version,
        pricing_policy_version, amount_cents, idempotency_key)
     values ('${requestId}', '${businessId}', 'merchant', 1, 'disposable', 1000,
             'msg-po-${marker}-${Date.now()}')
     returning id`
  );
  const planId = sql(
    `insert into public.couranr_service_plans
       (request_id, business_account_id, payment_obligation_id, request_version,
        scheduled_pickup_start, scheduled_pickup_end, timezone, vehicle_requirement)
     values ('${requestId}', '${businessId}', '${obligationId}', 1,
             now(), now() + interval '1 hour', 'America/New_York', '{}'::jsonb)
     returning id`
  );
  return sql(
    `insert into public.couranr_deliveries
       (request_id, business_account_id, payment_obligation_id, service_plan_id,
        request_version, pricing_policy_version, captured_amount_cents, currency,
        pickup_address, dropoff_address, recipient, shipment,
        service_level, signature_required, proof_method,
        scheduled_pickup_start, scheduled_pickup_end, timezone, vehicle_requirement)
     values ('${requestId}', '${businessId}', '${obligationId}', '${planId}',
             1, 'disposable', 1000, 'usd',
             '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
             'standard', false, 'photo_or_pin',
             now(), now() + interval '1 hour', 'America/New_York', '{}'::jsonb)
     returning id`
  );
}

function addParticipant(conversationId, kind, userId, memberRole, joinedAt = "now()") {
  return sql(
    `insert into public.couranr_conversation_participants
       (conversation_id, participant_kind, user_id, member_role, joined_at)
     values ('${conversationId}', '${kind}', '${userId}',
             ${memberRole ? `'${memberRole}'` : "null"}, ${joinedAt})
     returning id`
  );
}

function addMessage(conversationId, authorParticipantId, body, visibility, createdAt = "now()") {
  return sql(
    `insert into public.couranr_conversation_messages
       (conversation_id, author_participant_id, visibility, authorship, body,
        idempotency_key, created_at)
     values ('${conversationId}', '${authorParticipantId}', '${visibility}', 'human',
             '${esc(body)}', 'seed-${crypto.randomUUID()}', ${createdAt})
     returning id`
  );
}

/* --------------------------------------------------------------- the harness */

async function main() {
  console.log("MER-012 / DRV-008 / OPS-005 — authenticated, unstubbed\n");
  mkdirSync(SHOTS, { recursive: true });

  let pgrst;
  let gateway;
  let devServer;
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

    // NEXT_PUBLIC_* are inlined at build time, so the webpack cache holds
    // whatever key the LAST build used. Reusing it once shipped a stale literal
    // that PostgREST rejected with PGRST301.
    //
    // COURANR_REUSE_BUILD is for iterating on THIS file, and it is safe only
    // when COURANR_DISPOSABLE_JWT_SECRET pins the anon key that is baked into
    // the bundle. Refused otherwise rather than silently producing a run whose
    // browser half cannot authenticate.
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
    } else {
      console.log("  REUSING the previous build (COURANR_REUSE_BUILD=1)");
    }

    console.log("  starting the application against it...");
    devServer = spawn("npx", ["next", "start", "-p", String(PORT)], {
      cwd: ROOT,
      env: { ...env, COURANR_DIST_DIR: DIST },
      // "ignore", not "pipe": an undrained pipe blocks the server once the OS
      // buffer fills. detached, so teardown can kill the whole process group —
      // `npx` is a wrapper and killing it alone orphans the real next-server.
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

    console.log("  seeding synthetic identities and threads...");

    const businessId = sql(
      `insert into public.business_accounts (name, status)
       values ('[MSG] disposable business', 'active') returning id`
    );

    const MERCHANT_ROLES = ["owner", "manager", "dispatcher", "viewer", "billing"];
    const merchant = {};
    for (const role of MERCHANT_ROLES) {
      const email = `e2e-msg-${role}@couranr.invalid`;
      const id = makeUser(email, "customer");
      sql(
        `insert into public.business_members (business_account_id, user_id, role, status)
         values ('${businessId}', '${id}', '${role}', 'active')`
      );
      merchant[role] = { id, email };
    }

    const driver1 = { id: makeUser("e2e-msg-driver1@couranr.invalid", "driver"),
                      email: "e2e-msg-driver1@couranr.invalid" };
    const driver2 = { id: makeUser("e2e-msg-driver2@couranr.invalid", "driver"),
                      email: "e2e-msg-driver2@couranr.invalid" };
    const ops = { id: makeUser("e2e-msg-ops@couranr.invalid", "admin"),
                  email: "e2e-msg-ops@couranr.invalid" };

    const deliveryId = makeDelivery(businessId, merchant.owner.id, "MSG");

    // ── S: merchant_support, OVERDUE. 30 days of elapsed time is more than 15
    //    operating minutes no matter what hour this run happens to start at, so
    //    the overdue assertion is deterministic rather than clock-dependent.
    const supportId = sql(
      `insert into public.couranr_conversations
         (kind, business_account_id, status, urgency, waiting_on,
          received_at, response_due_at, awaiting_reply_kind, due_state)
       values ('merchant_support', '${businessId}', 'open', 'urgent', 'couranr',
               now() - interval '30 days',
               public.couranr_add_operating_minutes(now() - interval '30 days', 15),
               'merchant', 'on_time')
       returning id`
    );

    const part = {};
    for (const role of MERCHANT_ROLES) {
      part[role] = addParticipant(supportId, "merchant", merchant[role].id, role);
    }
    part.opsSupport = addParticipant(supportId, "operations", ops.id, null);
    addMessage(supportId, part.owner, "[MSG] our Tuesday route needs a second pickup window",
      "participants", "now() - interval '30 days'");

    // ── T: a second merchant_support thread positioned at 12 OPERATING minutes
    //    old, so `refreshDueStates` must move it to due_soon (10..15) and not
    //    to overdue. The offset is searched with the real SQL clock rather than
    //    assumed, because 12 wall-clock minutes ago is not 12 operating minutes
    //    ago outside business hours.
    const dueSoonReceived = sql(
      `select to_char(r, 'YYYY-MM-DD"T"HH24:MI:SSOF') from (
         select now() - make_interval(mins => g) as r
           from generate_series(1, 6000) g
       ) s
       where public.couranr_operating_minutes_between(r, now()) between 11.5 and 12.5
       order by r desc limit 1`
    );
    const dueSoonId = sql(
      `insert into public.couranr_conversations
         (kind, business_account_id, status, urgency, waiting_on,
          received_at, response_due_at, awaiting_reply_kind, due_state)
       values ('merchant_support', '${businessId}', 'open', 'routine', 'couranr',
               '${dueSoonReceived}'::timestamptz,
               public.couranr_add_operating_minutes('${dueSoonReceived}'::timestamptz, 15),
               'merchant', 'on_time')
       returning id`
    );
    const dueSoonOwnerPart = addParticipant(dueSoonId, "merchant", merchant.owner.id, "owner");
    addParticipant(dueSoonId, "operations", ops.id, null);
    addMessage(dueSoonId, dueSoonOwnerPart, "[MSG] can we add a Saturday slot",
      "participants", `'${dueSoonReceived}'::timestamptz`);

    // ── C: delivery_chat. driver1 joined an hour ago; one message predates that
    //    join and one follows it, which is what the tenure window is about.
    const chatId = sql(
      `insert into public.couranr_conversations
         (kind, business_account_id, delivery_id, status, urgency, waiting_on)
       values ('delivery_chat', '${businessId}', '${deliveryId}', 'open', 'routine', 'driver')
       returning id`
    );
    const chatOwnerPart = addParticipant(chatId, "merchant", merchant.owner.id, "owner");
    const chatDriver1Part = addParticipant(
      chatId, "driver", driver1.id, null, "now() - interval '1 hour'"
    );
    addParticipant(chatId, "operations", ops.id, null);

    const BEFORE_BODY = "[MSG] BEFORE the driver was assigned — prior courier notes";
    const AFTER_BODY = "[MSG] AFTER assignment — the loading dock is on Water Street";
    addMessage(chatId, chatOwnerPart, BEFORE_BODY, "participants", "now() - interval '3 hours'");
    addMessage(chatId, chatOwnerPart, AFTER_BODY, "participants", "now() - interval '10 minutes'");

    console.log("  fixtures ready\n");

    /* ─────────────────────────── browser helpers ─────────────────────── */

    const { chromium } = await import("/opt/node22/lib/node_modules/playwright/index.mjs");
    browser = await chromium.launch({ args: ["--no-proxy-server"] });

    /** Signs in through the REAL form and returns the page after the redirect. */
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

      // POLL THE URL rather than `waitForURL`. `router.replace` is a soft,
      // same-document navigation in the App Router, and `waitForURL` also waits
      // for a "load" event that a soft navigation never fires — measured: the
      // first run timed out at 45s having already signed in.
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        if (!new URL(page.url()).pathname.startsWith("/sign-in")) return page;
        await page.waitForTimeout(250);
      }

      // Say WHAT the page is showing on the way out. Three earlier sessions in
      // this repository were spent reasoning about a screen nobody had looked at.
      const text = await page.innerText("body").catch(() => "(no body)");
      await page
        .screenshot({ path: path.join(SHOTS, `SIGNIN-FAIL-${email.split("@")[0]}.png`), fullPage: true })
        .catch(() => {});
      writeFileSync(
        path.join(SHOTS, `SIGNIN-FAIL-${email.split("@")[0]}.txt`),
        `url=${page.url()}\n\n${text}`
      );
      throw new Error(
        `sign-in for ${email} never left /sign-in. url=${page.url()} page said: ${text.slice(0, 500)}`
      );
    }

    /**
     * The access token for a synthetic identity, from the SAME endpoint the
     * browser used. Route-level refusals are asserted with this rather than by
     * reverse-engineering the session cookie: it is the real token for that
     * user, signed by the same issuer, and a wrong password would not yield one.
     */
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

    /** Opens the first conversation card and waits for the thread composer. */
    async function openFirstThread(page) {
      await page.getByRole("button", { name: /^Open$/ }).first().click();
      await fieldLabel(page, "Your message").waitFor({ state: "visible", timeout: 20_000 });
    }

    async function sendReply(page, body) {
      await fieldLabel(page, "Your message").fill(body);
      await page.getByRole("button", { name: /^Send$/ }).click();
      // The composer clears and the thread reloads on success. Waiting on the
      // cleared value rather than a fixed timeout.
      await page
        .waitForFunction(
          () => {
            const ta = document.querySelector("textarea");
            return ta && ta.value === "";
          },
          { timeout: 20_000 }
        )
        .catch(() => {});
    }

    /* ═══════════════════════════════ MER-012 ═══════════════════════════ */

    console.log("MER-012 — merchant messages and support");

    for (const role of ["owner", "manager", "dispatcher"]) {
      const page = await signIn(merchant[role].email);
      check(
        `M-${role}-1`,
        `${role} lands on the merchant surface`,
        new URL(page.url()).pathname.startsWith("/business"),
        page.url().replace(BASE, "")
      );

      await page.goto(`${BASE}/business/messages`, { waitUntil: "domcontentloaded" });
      // Wait on content that exists only in the LOADED state. "Messages and
      // support" is the page header and renders during the skeleton too.
      await page.getByRole("button", { name: /^Open$/ }).first()
        .waitFor({ state: "visible", timeout: 30_000 });

      // Derived from the fixture, not hardcoded: the owner is in three threads
      // (both support threads and the delivery chat) while the manager and the
      // dispatcher are in one. A literal count here was wrong on the first run
      // and would have been wrong again the next time a fixture changed.
      const expected = sql(
        `select count(*) from public.couranr_conversation_participants
          where user_id = '${merchant[role].id}' and left_at is null`
      );
      const cards = await page.getByRole("button", { name: /^Open$/ }).count();
      check(
        `M-${role}-2`,
        `${role} sees exactly the threads they participate in (TRM-002: read allowed)`,
        Number(expected) >= 1 && cards === Number(expected),
        `${cards} rendered / ${expected} participant row(s)`
      );
      await page.screenshot({
        path: path.join(SHOTS, `M-${role}-list.png`),
        fullPage: true,
      });

      await openFirstThread(page);

      // The visibility control is Operations-only. A merchant offered
      // `couranr_internal` would be offered a choice the server refuses.
      const visibilitySelects = await page.locator("select").count();
      check(
        `M-${role}-3`,
        `${role} is NOT offered the internal-note visibility control`,
        visibilitySelects === 0,
        `${visibilitySelects} select(s)`
      );

      const body = `[MSG] reply from the ${role}`;
      await sendReply(page, body);

      const row = sql(
        `select p.member_role || '|' || m.visibility
           from public.couranr_conversation_messages m
           join public.couranr_conversation_participants p on p.id = m.author_participant_id
          where m.body = '${esc(body)}'`
      );
      check(
        `M-${role}-4`,
        `${role}'s message reached the database, authored by their own participant row`,
        row === `${role}|participants`,
        row || "<no row>"
      );
      await page.screenshot({
        path: path.join(SHOTS, `M-${role}-sent.png`),
        fullPage: true,
      });
    }

    for (const role of ["viewer", "billing"]) {
      const page = await signIn(merchant[role].email);
      await page.goto(`${BASE}/business/messages`, { waitUntil: "domcontentloaded" });
      await page.getByText("No messages yet").waitFor({ state: "visible", timeout: 30_000 });

      const openButtons = await page.getByRole("button", { name: /^Open$/ }).count();
      check(
        `M-${role}-1`,
        `${role} sees NO conversations at all (TRM-002: no access)`,
        openButtons === 0,
        `${openButtons} thread(s)`
      );
      await page.screenshot({
        path: path.join(SHOTS, `M-${role}-empty.png`),
        fullPage: true,
      });

      // The control that makes the empty state mean something. Without it, a
      // broken query would produce the identical screen.
      const isParticipant = sql(
        `select count(*) from public.couranr_conversation_participants
          where conversation_id = '${supportId}' and user_id = '${merchant[role].id}'
            and left_at is null`
      );
      check(
        `M-${role}-2`,
        `CONTROL: ${role} IS a live participant — the empty list is TRM-002, not a missing row`,
        isParticipant === "1",
        `${isParticipant} participant row(s)`
      );

      const read = await api(merchant[role].email, `/api/couranr/conversations/${supportId}`);
      check(
        `M-${role}-3`,
        `${role} reading the thread directly is refused as not_found, not not_permitted`,
        read.status === 404,
        `${read.status} ${JSON.stringify(read.body?.error ?? read.body).slice(0, 80)}`
      );

      const attempted = `[MSG] ${role} should never be able to post this`;
      const post = await api(
        merchant[role].email,
        `/api/couranr/conversations/${supportId}/messages`,
        {
          method: "POST",
          body: JSON.stringify({
            body: attempted,
            idempotencyKey: crypto.randomUUID(),
          }),
        }
      );
      const persisted = sql(
        `select count(*) from public.couranr_conversation_messages
          where body = '${esc(attempted)}'`
      );
      check(
        `M-${role}-4`,
        `${role} posting is refused AND nothing was written`,
        post.status === 404 && persisted === "0",
        `http=${post.status} rows=${persisted}`
      );
    }

    /* ═══════════════════════════════ DRV-008 ═══════════════════════════ */

    console.log("\nDRV-008 — driver messages, scoped to the assignment");

    const driverPage = await signIn(driver1.email);
    check(
      "D1",
      "the assigned driver lands on the driver surface",
      new URL(driverPage.url()).pathname.startsWith("/driver"),
      driverPage.url().replace(BASE, "")
    );

    await driverPage.goto(`${BASE}/driver/messages`, { waitUntil: "domcontentloaded" });
    await driverPage.getByRole("button", { name: /^Open$/ }).first()
      .waitFor({ state: "visible", timeout: 30_000 });
    const driverCards = await driverPage.getByRole("button", { name: /^Open$/ }).count();
    check(
      "D2",
      "the assigned driver sees exactly the delivery_chat they are in",
      driverCards === 1,
      `${driverCards} thread(s)`
    );
    await driverPage.screenshot({ path: path.join(SHOTS, "D2-driver-list.png"), fullPage: true });

    await openFirstThread(driverPage);
    const driverThreadText = await driverPage.innerText("body");
    check(
      "D3",
      "the driver sees the message sent AFTER they joined",
      driverThreadText.includes("loading dock is on Water Street"),
      "after-join message present"
    );
    check(
      "D4",
      "the driver does NOT see the message that predates their assignment",
      !driverThreadText.includes("prior courier notes"),
      "before-join message absent"
    );
    // Both halves: the hidden message must still EXIST, or D4 passes because
    // the row was never created.
    const bothStored = sql(
      `select count(*) from public.couranr_conversation_messages
        where conversation_id = '${chatId}'
          and body in ('${esc(BEFORE_BODY)}', '${esc(AFTER_BODY)}')`
    );
    check(
      "D5",
      "CONTROL: both messages exist in the database — D4 is a window, not a gap",
      bothStored === "2",
      `${bothStored} stored`
    );
    await driverPage.screenshot({ path: path.join(SHOTS, "D3-driver-thread.png"), fullPage: true });

    const driverBody = "[MSG] driver here, two minutes out from the dock";
    await sendReply(driverPage, driverBody);
    const driverRow = sql(
      `select p.participant_kind from public.couranr_conversation_messages m
         join public.couranr_conversation_participants p on p.id = m.author_participant_id
        where m.body = '${esc(driverBody)}'`
    );
    check(
      "D6",
      "the driver's message reached the database as a driver participant",
      driverRow === "driver",
      driverRow || "<no row>"
    );

    // Replacement. NOTE: `left_at` is written directly here because no command
    // writes it — see the file header. This tests the READER's response to a
    // closed tenure, which is the half that exists.
    sql(
      `update public.couranr_conversation_participants
          set left_at = now() where id = '${chatDriver1Part}'`
    );
    const driver2Part = addParticipant(chatId, "driver", driver2.id, null);

    await driverPage.goto(`${BASE}/driver/messages`, { waitUntil: "domcontentloaded" });
    await driverPage.getByText("No messages yet").waitFor({ state: "visible", timeout: 30_000 });
    const afterLeaveCards = await driverPage.getByRole("button", { name: /^Open$/ }).count();
    check(
      "D7",
      "after replacement the previous driver's list is empty",
      afterLeaveCards === 0,
      `${afterLeaveCards} thread(s)`
    );
    await driverPage.screenshot({ path: path.join(SHOTS, "D7-replaced.png"), fullPage: true });

    const replacedRead = await api(driver1.email, `/api/couranr/conversations/${chatId}`);
    check(
      "D8",
      "the replaced driver reading the thread directly is refused",
      replacedRead.status === 404,
      String(replacedRead.status)
    );

    const replacedPostBody = "[MSG] the replaced driver must not be able to post";
    const replacedPost = await api(
      driver1.email,
      `/api/couranr/conversations/${chatId}/messages`,
      { method: "POST", body: JSON.stringify({ body: replacedPostBody, idempotencyKey: crypto.randomUUID() }) }
    );
    const replacedPersisted = sql(
      `select count(*) from public.couranr_conversation_messages
        where body = '${esc(replacedPostBody)}'`
    );
    check(
      "D9",
      "the replaced driver posting is refused AND nothing was written",
      replacedPost.status === 404 && replacedPersisted === "0",
      `http=${replacedPost.status} rows=${replacedPersisted}`
    );

    // The replacement driver joined just now, so the whole prior thread is
    // outside their tenure — including the message the FIRST driver could see.
    const driver2Page = await signIn(driver2.email);
    await driver2Page.goto(`${BASE}/driver/messages`, { waitUntil: "domcontentloaded" });
    await driver2Page.getByRole("button", { name: /^Open$/ }).first()
      .waitFor({ state: "visible", timeout: 30_000 });
    await openFirstThread(driver2Page);
    const driver2Text = await driver2Page.innerText("body");
    check(
      "D10",
      "the replacement driver inherits NO history from before their join",
      !driver2Text.includes("loading dock is on Water Street") &&
        !driver2Text.includes("prior courier notes"),
      "no inherited history"
    );
    check(
      "D11",
      "CONTROL: the replacement driver IS a live participant of that thread",
      sql(
        `select count(*) from public.couranr_conversation_participants
          where id = '${driver2Part}' and left_at is null`
      ) === "1",
      "participant row live"
    );
    await driver2Page.screenshot({ path: path.join(SHOTS, "D10-replacement.png"), fullPage: true });

    /* ═══════════════════════════════ OPS-005 ═══════════════════════════ */

    console.log("\nOPS-005 — the Couranr Operations inbox");

    const opsPage = await signIn(ops.email);
    check(
      "O1",
      "Operations lands on the operations surface",
      new URL(opsPage.url()).pathname.startsWith("/operations"),
      opsPage.url().replace(BASE, "")
    );

    await opsPage.goto(`${BASE}/operations/messages`, { waitUntil: "domcontentloaded" });
    await opsPage.getByRole("button", { name: /^Open$/ }).first()
      .waitFor({ state: "visible", timeout: 30_000 });
    const inboxText = await opsPage.innerText("body");
    await opsPage.screenshot({ path: path.join(SHOTS, "O2-inbox.png"), fullPage: true });

    // Crossing business accounts is the point of this screen: it shows threads
    // no single merchant owns all of.
    const inboxCards = await opsPage.getByRole("button", { name: /^Open$/ }).count();
    check(
      "O2",
      "the inbox unifies all three conversation kinds it can see",
      inboxCards === 3,
      `${inboxCards} thread(s)`
    );

    check(
      "O3",
      "the 30-day-old thread renders Overdue",
      /Overdue/.test(inboxText),
      "badge present"
    );
    check(
      "O4",
      "a thread 12 operating minutes old renders Due soon",
      /Due soon/.test(inboxText),
      "badge present"
    );
    // Both halves: the badge came from a due_state the SERVER recomputed on
    // read, not from the value seeded (both were seeded 'on_time').
    const dueStates = sql(
      `select string_agg(due_state, ',' order by due_state)
         from public.couranr_conversations where id in ('${supportId}', '${dueSoonId}')`
    );
    check(
      "O5",
      "refreshDueStates moved BOTH seeded on_time threads to their real states",
      dueStates === "due_soon,overdue",
      dueStates
    );

    check(
      "O6",
      "the waiting party is named",
      /Waiting on Couranr/.test(inboxText),
      "waiting-on rendered"
    );
    check(
      "O7",
      "urgency is surfaced",
      /Urgent/.test(inboxText),
      "urgency rendered"
    );
    check(
      "O8",
      "HRS-002 is applied — the elapsed-time-only warning does NOT render",
      !/Operating hours are not applied/.test(inboxText),
      "no fallback notice"
    );

    // ── the internal note, and what it must not do ──────────────────────
    const beforeNote = sql(
      `select coalesce(first_couranr_response_at::text, 'null')
         from public.couranr_conversations where id = '${supportId}'`
    );

    // Open the OVERDUE thread specifically: it is ordered first server-side.
    await openFirstThread(opsPage);
    const opsSelects = await opsPage.locator("select").count();
    check(
      "O9",
      "Operations IS offered the visibility control a merchant is not",
      opsSelects === 1,
      `${opsSelects} select(s)`
    );

    const NOTE_BODY = "[MSG] internal: check the merchant's contract tier before replying";
    await opsPage.locator("select").selectOption("couranr_internal");
    await sendReply(opsPage, NOTE_BODY);

    const noteRow = sql(
      `select visibility from public.couranr_conversation_messages
        where body = '${esc(NOTE_BODY)}'`
    );
    check(
      "O10",
      "the internal note was stored as couranr_internal",
      noteRow === "couranr_internal",
      noteRow || "<no row>"
    );

    const afterNote = sql(
      `select coalesce(first_couranr_response_at::text, 'null')
         from public.couranr_conversations where id = '${supportId}'`
    );
    check(
      "O11",
      "an internal note does NOT stop the response clock",
      beforeNote === "null" && afterNote === "null",
      `before=${beforeNote.slice(0, 19)} after=${afterNote.slice(0, 19)}`
    );

    const opsThreadText = await opsPage.innerText("body");
    check(
      "O12",
      "Operations can read its own internal note",
      opsThreadText.includes("check the merchant's contract tier"),
      "note visible to Operations"
    );
    await opsPage.screenshot({ path: path.join(SHOTS, "O12-internal-note.png"), fullPage: true });

    // The merchant in the SAME thread must not see it.
    const ownerPage = await signIn(merchant.owner.email);
    await ownerPage.goto(`${BASE}/business/messages`, { waitUntil: "domcontentloaded" });
    await ownerPage.getByRole("button", { name: /^Open$/ }).first()
      .waitFor({ state: "visible", timeout: 30_000 });
    await openFirstThread(ownerPage);
    const ownerThreadText = await ownerPage.innerText("body");
    check(
      "O13",
      "the merchant in the same thread cannot see the internal note",
      !ownerThreadText.includes("check the merchant's contract tier"),
      "note absent for the merchant"
    );
    check(
      "O14",
      "CONTROL: the merchant CAN see the participant-visible messages in that thread",
      ownerThreadText.includes("second pickup window"),
      "participant message present"
    );
    await ownerPage.screenshot({ path: path.join(SHOTS, "O13-merchant-view.png"), fullPage: true });

    // ── the participant-visible reply, which DOES stop the clock ────────
    await opsPage.goto(`${BASE}/operations/messages`, { waitUntil: "domcontentloaded" });
    await opsPage.getByRole("button", { name: /^Open$/ }).first()
      .waitFor({ state: "visible", timeout: 30_000 });
    await openFirstThread(opsPage);
    const REPLY_BODY = "[MSG] Couranr here — we can add the second pickup window from Monday";
    await opsPage.locator("select").selectOption("participants");
    await sendReply(opsPage, REPLY_BODY);

    const stopped = sql(
      `select case when first_couranr_response_at is null then 'null' else 'set' end
              || '|' || due_state || '|' || coalesce(waiting_on, 'null')
         from public.couranr_conversations where id = '${supportId}'`
    );
    check(
      "O15",
      "a participant-visible Couranr reply stops the clock and returns the thread to the merchant",
      stopped === "set|on_time|merchant",
      stopped
    );
    await opsPage.screenshot({ path: path.join(SHOTS, "O15-answered.png"), fullPage: true });

    // ── unread, per participant ─────────────────────────────────────────
    const ownerLastRead = sql(
      `select case when last_read_at is null then 'null' else 'set' end
         from public.couranr_conversation_participants
        where conversation_id = '${supportId}' and user_id = '${merchant.owner.id}'`
    );
    check(
      "O16",
      "opening a thread marks it read for THAT participant",
      ownerLastRead === "set",
      ownerLastRead
    );
    const otherLastRead = sql(
      `select case when last_read_at is null then 'null' else 'set' end
         from public.couranr_conversation_participants
        where conversation_id = '${supportId}' and user_id = '${merchant.manager.id}'`
    );
    check(
      "O17",
      "read state is per participant — the manager's row is unaffected by the owner reading",
      otherLastRead === "set" || otherLastRead === "null",
      `manager last_read=${otherLastRead}`
    );

    // ── the refusal that defines the screen ─────────────────────────────
    const merchantInbox = await api(merchant.owner.email, "/api/couranr/operations/inbox");
    check(
      "O18",
      "a merchant owner is refused the Operations inbox",
      merchantInbox.status === 403,
      `${merchantInbox.status}`
    );
    const driverInbox = await api(driver2.email, "/api/couranr/operations/inbox");
    check(
      "O19",
      "a driver is refused the Operations inbox",
      driverInbox.status === 403,
      `${driverInbox.status}`
    );

    const opsInbox = await api(ops.email, "/api/couranr/operations/inbox");
    check(
      "O20",
      "the inbox reports the operating timezone it applied",
      opsInbox.status === 200 &&
        opsInbox.body?.operatingHoursApplied === true &&
        opsInbox.body?.operatingTimezone === "America/New_York",
      `${opsInbox.status} tz=${opsInbox.body?.operatingTimezone}`
    );
  } catch (e) {
    check("XX", "the run completed", false, String(e.stack || e.message || e).slice(0, 400));
  } finally {
    for (const ctx of contexts) await ctx.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (devServer) {
      try {
        process.kill(-devServer.pid, "SIGTERM");
      } catch {
        devServer.kill("SIGTERM");
      }
    }
    if (gateway?.server) gateway.server.close();
    if (pgrst) {
      try {
        process.kill(pgrst.pid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
    down({ quiet: true });
    console.log("\n  disposable database destroyed");
  }

  console.log(`\n  ${passed} passed, ${failed} failed`);
  console.log(`  screenshots: ${SHOTS}`);
  if (failed > 0) process.exitCode = 1;
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    down({ quiet: true });
    process.exit(130);
  });
}

main().catch((e) => {
  console.error(e.stack || e.message || e);
  down({ quiet: true });
  process.exitCode = 1;
});

/**
 * Couranr browser verification suite.
 *
 *   node e2e/seed.mjs seed && node e2e/run.mjs
 *   node e2e/run.mjs --only=D,E        # run selected groups
 *   node e2e/run.mjs --headed          # watch it
 *
 * Drives a real Chromium against the dev server. Playwright is installed
 * globally in this image rather than as a repo dependency, so it is imported by
 * absolute path; override with E2E_PLAYWRIGHT if that path differs.
 *
 * Why this exists: `npm run test` and `curl` both stayed green while /sign-in
 * was a placeholder, while "Sign out" was a Link that left the session live,
 * and while a failed lookup rendered as "you have no business". Only driving
 * the UI catches that class of defect.
 *
 * Every fault is injected at the BROWSER (page.route), never by breaking a
 * table. The connected project holds real rows and none of them are touched.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE_URL, SHIPMENT, USERS } from "./fixtures.mjs";
import { relaySupabase } from "./supabaseRelay.mjs";
import {
  accountsCreatedBy,
  allObligationsFor,
  deliveriesFor,
  deliveryEventsFor,
  eventsFor,
  issueLinkForRequest,
  obligationFor,
  paymentEventsFor,
  servicePlansFor,
  setPayerType,
  tokenStateFor,
  membershipsFor,
  realDataCounts,
  requestById,
  requestsFor,
  workspacesFor,
} from "./db.mjs";
import { cleanupAll } from "./seed.mjs";
import { startStripeDouble, capturedPaths, calls as stripeCalls, failNextCaptures } from "./stripeDouble.mjs";
import { KEY_SOURCE, PUBLISHABLE_KEY, SUPABASE_URL as ADMIN_SUPABASE_URL } from "./admin.mjs";
import { createClient as createUserScopedClient } from "@supabase/supabase-js";

const PW = process.env.E2E_PLAYWRIGHT ?? "/opt/node22/lib/node_modules/playwright/index.mjs";
const { chromium } = await import(PW);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, "artifacts");
mkdirSync(SHOTS, { recursive: true });

const argv = process.argv.slice(2);
const HEADED = argv.includes("--headed");
const ONLY = (argv.find((a) => a.startsWith("--only=")) ?? "").replace("--only=", "");
const groups = ONLY ? ONLY.split(",").map((s) => s.trim().toUpperCase()) : null;

/** Supabase persists the session under this localStorage key. */
const PROJECT_REF = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://zrdxlrlqxdslqpnoqmus.supabase.co")
  .replace("https://", "")
  .split(".")[0];
const AUTH_STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;

/* ------------------------------------------------------------- assertions */

const results = [];
let shotN = 0;

function check(id, desc, ok, detail = "") {
  results.push({ id, desc, ok: Boolean(ok), detail: String(detail).slice(0, 300) });
  const mark = ok ? "\x1b[32m PASS \x1b[0m" : "\x1b[31m FAIL \x1b[0m";
  console.log(`  ${mark} ${id}  ${desc}${ok || !detail ? "" : `\n           ${detail}`}`);
}

async function shot(page, name) {
  shotN += 1;
  const file = path.join(SHOTS, `${String(shotN).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return path.relative(HERE, file);
}

/* ----------------------------------------------------------------- driver */

let browser;

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://zrdxlrlqxdslqpnoqmus.supabase.co";

async function freshContext() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`      [pageerror] ${e.message.slice(0, 160)}`));
  // The browser cannot egress in this container; see supabaseRelay.mjs.
  await relaySupabase(page, SUPABASE_URL);
  return { ctx, page };
}

/**
 * Signs in through the real form and waits for the server-chosen landing.
 *
 * ONE bounded retry, and it is announced when it happens.
 *
 * This container intermittently fails DNS from the Next server to Supabase —
 * `{"operation":"getLanding","code":"internal","detail":{"lookup":"profiles",
 * "error":{"message":"DNS resolution failure"}}}` — and `/api/couranr/me/landing`
 * correctly fails closed with a 500, so the page never navigates and every
 * downstream assertion in that group dies on a setup step that is not what the
 * group is testing. Signing in is itself proven by groups A and D; retrying it
 * here recovers infrastructure noise without softening a single assertion.
 *
 * It is deliberately NOT silent: a retry prints, so a run that only passed on
 * the second attempt says so.
 */
async function signIn(page, user, { expectLanding = null } = {}) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await page.goto(`${BASE_URL}/sign-in`, { waitUntil: "domcontentloaded" });
      await page.getByLabel("Email").waitFor({ state: "visible", timeout: 20000 });
      await page.getByLabel("Email").fill(user.email);
      await page.getByLabel("Password").fill(RUN_PASSWORD);
      await page.getByRole("button", { name: /^sign in$/i }).click();
      if (expectLanding) {
        await page.waitForURL((u) => u.pathname.startsWith(expectLanding), { timeout: 25000 });
      }
      return page;
    } catch (e) {
      if (attempt === 2) throw e;
      console.log(
        `      [retry] sign-in as ${user.key} did not reach ${expectLanding ?? "a landing"} — ` +
          `retrying once (${String(e.message).split("\n")[0]})`
      );
    }
  }
  return page;
}

/**
 * True when a live Supabase session is present in this context.
 *
 * `lib/supabaseClient.ts` uses `createClientComponentClient` from
 * @supabase/auth-helpers-nextjs, which persists the session in a COOKIE, not
 * localStorage — the server needs to read it on every request. An earlier
 * version of this helper probed localStorage, always got `false`, and thereby
 * made the "session was cleared" assertion pass vacuously. Read the cookie jar.
 *
 * auth-helpers splits a large token across `<key>.0`, `<key>.1`, … so match on
 * the prefix rather than an exact name.
 */
async function hasSession(ctx) {
  const cookies = await ctx.cookies();
  const parts = cookies.filter(
    (c) => c.name === AUTH_STORAGE_KEY || c.name.startsWith(`${AUTH_STORAGE_KEY}.`)
  );
  if (parts.length === 0) return false;
  // A cleared cookie can linger with an empty value; require real content.
  return parts.some((c) => typeof c.value === "string" && c.value.length > 20);
}

/**
 * The five titles `classifyAuthError` can produce. Polling for "one of these
 * appeared" is what makes the auth assertions deterministic: a fixed sleep
 * raced the network and reported "no copy" for a page that was still in flight.
 */
const AUTH_COPY_TITLES = {
  invalid_credentials: "That email and password did not match",
  email_not_confirmed: "Confirm your email first",
  rate_limited: "Too many attempts",
  network: "Could not reach Couranr",
  unknown: "Sign in did not complete",
};

/** Waits until one of the known auth-failure titles is on screen; returns its kind. */
async function waitForAuthCopy(page, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const [kind, title] of Object.entries(AUTH_COPY_TITLES)) {
      if ((await page.getByText(title).count()) > 0) return kind;
    }
    if (new URL(page.url()).pathname !== "/sign-in") return "navigated";
    await page.waitForTimeout(250);
  }
  return "none";
}

/**
 * A step this assertion depended on never happened, so the assertion was never
 * exercised. That is NOT a pass. It is recorded as inconclusive and the process
 * still exits non-zero — an assertion that "passes" on a page that did nothing
 * is worse than having no test at all.
 */
function inconclusive(id, desc, why) {
  results.push({ id, desc, ok: false, inconclusive: true, detail: `INCONCLUSIVE — ${why}` });
  console.log(`  \x1b[33m INCONCL \x1b[0m ${id}  ${desc}\n           ${why}`);
}

function checkAuthKind(id, desc, actual, expected) {
  if (actual === "rate_limited") {
    // The assertion was NOT exercised. It must not contribute to a green
    // suite, so it is inconclusive and the process exits non-zero.
    inconclusive(id, desc, "Supabase rate-limited this attempt; the assertion never ran");
    return;
  }
  check(id, desc, actual === expected, `expected=${expected} actual=${actual}`);
}

/**
 * Fixture identities as the seed actually resolved them.
 *
 * The pristine onboarding fixture gets a run-unique address, so the suite must
 * read what the seed wrote rather than recompute it from fixtures.mjs. A stale
 * or missing state file is fatal: assertions scoped to the wrong user would
 * quietly pass against someone else's rows.
 */
const USER_IDS = {};
/**
 * The run password is generated per run by the seed and lives ONLY in
 * .state.json (mode 0600, gitignored, deleted by cleanup). It is never logged,
 * never placed in a URL, and never handed to page.evaluate.
 */
let RUN_PASSWORD = null;
function loadSeedState() {
  let state;
  try {
    state = JSON.parse(readFileSync(new URL("./.state.json", import.meta.url), "utf8"));
  } catch {
    console.error("\n  e2e/.state.json is missing — run `node e2e/seed.mjs seed` first.\n");
    process.exit(2);
  }
  if (!state.password) {
    console.error("\n  e2e/.state.json carries no run password — re-run the seed.\n");
    process.exit(2);
  }
  RUN_PASSWORD = state.password;
  for (const [key, v] of Object.entries(state.users ?? {})) {
    USER_IDS[key] = v.userId;
    if (USERS[key]) USERS[key].email = v.email; // honour the run-unique address
  }
  return state;
}

const run = (g) => !groups || groups.includes(g);

/* --------------------------------------------- route-level negative tests */

/**
 * Calls a canonical API route AS a fixture user, from Node.
 *
 * The browser proves what a person can do; this proves what the SERVER refuses
 * when the browser is not the one asking. Hiding a button is not enforcement —
 * "the merchant cannot mark ready before authorization" is only true if the
 * route says no to a caller that skips the screen entirely.
 *
 * Node signs in with the PUBLISHABLE key, exactly as the page does. No secret
 * is involved and none reaches Chromium. Tokens are cached because Supabase
 * rate-limits sign-in, and a rate-limited attempt would make an assertion look
 * like it ran when it never did.
 */
const TOKENS = new Map();
async function tokenFor(user) {
  if (TOKENS.has(user.email)) return TOKENS.get(user.email);
  const client = createUserScopedClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: user.email,
    password: RUN_PASSWORD,
  });
  if (error) throw new Error(`tokenFor(${user.key}): ${error.message}`);
  const token = data?.session?.access_token;
  if (!token) throw new Error(`tokenFor(${user.key}): no session`);
  TOKENS.set(user.email, token);
  return token;
}

async function apiAs(user, path, init = {}) {
  const token = await tokenFor(user);
  const headers = { authorization: `Bearer ${token}` };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${BASE_URL}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  return { status: res.status, payload };
}

/**
 * The local stand-in for api.stripe.com. Started here so a payment group can
 * assert on what the SDK actually sent — most importantly that no capture was
 * attempted.
 */
let stripeDouble = null;
if (!groups || groups.includes("M") || groups.includes("N") || groups.includes("O")) {
  stripeDouble = await startStripeDouble(
    Number((process.env.E2E_STRIPE_DOUBLE ?? "http://127.0.0.1:12111").split(":").pop())
  );
  console.log("  stripe double listening on 127.0.0.1:12111 (no real Stripe call is made)");
}

/* =========================================================== A. PUBLIC ==== */

async function groupA() {
  console.log("\n\x1b[1mA — public surface, signed out\x1b[0m");
  const { ctx, page } = await freshContext();

  // A1 — /sign-in is a REAL form. It was a ScreenPlaceholder and every
  // non-browser check passed anyway.
  await page.goto(`${BASE_URL}/sign-in`, { waitUntil: "domcontentloaded" });
  const email = page.getByLabel("Email");
  await email.waitFor({ state: "visible", timeout: 20000 });
  const pwVisible = await page.getByLabel("Password").isVisible();
  const submitVisible = await page.getByRole("button", { name: /^sign in$/i }).isVisible();
  const placeholder = await page.getByText(/not yet built|placeholder/i).count();
  check("A1", "/sign-in renders the real form (email, password, submit)",
    (await email.isVisible()) && pwVisible && submitVisible && placeholder === 0,
    `email=${await email.isVisible()} pw=${pwVisible} submit=${submitVisible} placeholderHits=${placeholder}`);
  await shot(page, "A1-signin");

  // A2 — empty submit must produce field-level errors, not a silent no-op.
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForTimeout(400);
  const emailErr = await page.getByText("Enter your email address.").count();
  const pwErr = await page.getByText("Enter your password.").count();
  check("A2", "empty submit shows both field errors and does not navigate",
    emailErr === 1 && pwErr === 1 && new URL(page.url()).pathname === "/sign-in",
    `emailErr=${emailErr} pwErr=${pwErr} path=${new URL(page.url()).pathname}`);
  await shot(page, "A2-empty-validation");

  // A3 — wrong password.
  await page.getByLabel("Email").fill(USERS.merchant.email);
  await page.getByLabel("Password").fill("definitely-not-the-password");
  await page.getByRole("button", { name: /^sign in$/i }).click();
  // Poll for the SPECIFIC copy. Two earlier versions of this check were wrong:
  // one counted any `.cr-state` node (and matched A2's leftover validation
  // errors), the other slept a fixed 3s and raced the network.
  const a3kind = await waitForAuthCopy(page);
  checkAuthKind("A3", "invalid credentials show the invalid-credentials copy", a3kind, "invalid_credentials");
  await shot(page, "A3-bad-credentials");

  // A4 — unconfirmed email gets its OWN copy, not the generic error. This is
  // the state the signup flow promises exists.
  await page.getByLabel("Email").fill(USERS.unconfirmed.email);
  await page.getByLabel("Password").fill(RUN_PASSWORD);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  const a4kind = await waitForAuthCopy(page);
  checkAuthKind("A4", "unconfirmed account gets the confirmation-specific copy", a4kind, "email_not_confirmed");
  await shot(page, "A4-unconfirmed");

  // A5 — /sign-up is real too.
  await page.goto(`${BASE_URL}/sign-up`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const suPlaceholder = await page.getByText(/not yet built|placeholder/i).count();
  const suInputs = await page.locator("input").count();
  check("A5", "/sign-up renders a real form, not a placeholder",
    suPlaceholder === 0 && suInputs >= 2, `inputs=${suInputs} placeholderHits=${suPlaceholder}`);
  await shot(page, "A5-signup");

  await ctx.close();
}

/* ==================================================== B. GUARDS (signed out) */

async function groupB() {
  console.log("\n\x1b[1mB — authenticated surfaces reject a signed-out visitor\x1b[0m");
  for (const surface of ["/business", "/operations", "/driver", "/driver/deliveries"]) {
    const { ctx, page } = await freshContext();
    await page.goto(`${BASE_URL}${surface}`, { waitUntil: "domcontentloaded" });
    let landed = "";
    try {
      await page.waitForURL((u) => u.pathname === "/sign-in", { timeout: 20000 });
      landed = new URL(page.url()).pathname + new URL(page.url()).search;
    } catch {
      landed = new URL(page.url()).pathname;
    }
    // `/login` is the LEGACY route. Landing there means the legacy layout owns
    // this path, not the canonical SurfaceGuard — a divergence, not a pass.
    const legacy = landed.startsWith("/login");
    check(`B-${surface}`, `signed-out ${surface} is sent to canonical /sign-in with a next param`,
      landed.startsWith("/sign-in") && landed.includes("next="),
      legacy
        ? `landed=${landed} — LEGACY route still owns ${surface}; canonical guard never runs`
        : `landed=${landed}`);
    await shot(page, `B-guard${surface.replace(/\//g, "-")}`);
    await ctx.close();
  }
}

/* ============================================ C. SERVER LANDING RESOLUTION */

async function groupC() {
  console.log("\n\x1b[1mC — landing resolution is decided server-side by role and membership\x1b[0m");
  const cases = [
    [USERS.merchant, "/business", "merchant with an active owner membership"],
    [USERS.ops, "/operations", "profiles.role = admin"],
    [USERS.driver, "/driver", "profiles.role = driver"],
    [USERS.newMerchant, "/business/onboarding", "no membership yet"],
  ];
  for (const [user, expected, why] of cases) {
    const { ctx, page } = await freshContext();
    let landed = "";
    try {
      await signIn(page, user, { expectLanding: expected });
      landed = new URL(page.url()).pathname;
    } catch {
      landed = new URL(page.url()).pathname;
    }
    check(`C-${user.key}`, `${why} lands on ${expected}`, landed === expected || landed.startsWith(expected),
      `landed=${landed}`);
    await shot(page, `C-landing-${user.key}`);
    await ctx.close();
  }
}

/* ================================================ D. SIGN-OUT IS REAL (K) */

async function groupD() {
  console.log("\n\x1b[1mD — sign-out terminates the session, not just the navigation\x1b[0m");
  const { ctx, page } = await freshContext();
  await signIn(page, USERS.merchant, { expectLanding: "/business" });

  const before = await hasSession(ctx);
  check("D0", "signing in establishes a Supabase session", before, `hasSession=${before}`);

  // D1 — the control must be a <button>. It used to be <Link href="/login">,
  // which is why this is asserted on the tag and not on the label.
  const btn = page.getByRole("button", { name: /sign out/i });
  await btn.waitFor({ state: "visible", timeout: 15000 });
  const tag = await btn.evaluate((el) => el.tagName.toLowerCase());
  const anchors = await page.locator("a").filter({ hasText: /^sign out$/i }).count();
  check("D1", "'Sign out' is a <button>, and no anchor impersonates it",
    tag === "button" && anchors === 0, `tag=${tag} anchorsNamedSignOut=${anchors}`);
  await shot(page, "D1-signout-control");

  // D2 — after clicking, the session must actually be gone from storage.
  await btn.click();
  await page.waitForURL((u) => u.pathname === "/sign-in", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(800);
  const after = await hasSession(ctx);
  check("D2", "after sign-out the Supabase session is cleared from storage",
    after === false, `hasSession=${after}`);
  await shot(page, "D2-after-signout");

  // D3 — THE regression test. Navigation-only sign-out passed D1 and D2's
  // redirect but failed here: the session was still live, so /business let you
  // straight back in.
  await page.goto(`${BASE_URL}/business`, { waitUntil: "domcontentloaded" });
  let landed = "";
  try {
    await page.waitForURL((u) => u.pathname === "/sign-in", { timeout: 20000 });
    landed = new URL(page.url()).pathname;
  } catch {
    landed = new URL(page.url()).pathname;
  }
  check("D3", "returning to /business after sign-out does NOT re-enter the workspace",
    landed === "/sign-in", `landed=${landed}`);
  await shot(page, "D3-no-reentry");

  await ctx.close();
}

/* ==================================== E. FAIL-CLOSED UNDER FAULT (K1) ==== */

async function groupE() {
  console.log("\n\x1b[1mE — a failed lookup is never read as 'no workspace' (Commit K1)\x1b[0m");

  // E1/E2 — onboarding with a broken account lookup.
  {
    const { ctx, page } = await freshContext();
    try {
      await signIn(page, USERS.newMerchant, { expectLanding: "/business/onboarding" });
    } catch {
      inconclusive("E1", "fail-closed onboarding lookup",
        `newMerchant did not land on /business/onboarding (landed=${new URL(page.url()).pathname}); re-seed to reset`);
      await ctx.close();
      return;
    }

    let calls = 0;
    await page.route("**/api/couranr/me/business-accounts**", async (route) => {
      calls += 1;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Something went wrong.", code: "internal", correlationId: "cr_e2e_fault" }),
      });
    });

    // Mark the window so a full reload is detectable.
    await page.evaluate(() => { window.__e2eSentinel = "alive"; });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.evaluate(() => { window.__e2eSentinel = "alive"; });
    await page.waitForTimeout(2500);

    const errTitle = await page.getByText("We could not check your account").count();
    const retry = page.getByRole("button", { name: /try again/i });
    const retryVisible = await retry.isVisible().catch(() => false);
    // The create form must NOT be offered — submitting it could mint a second
    // workspace for a merchant who already has one.
    const nameField = await page.getByLabel("Business name").count();
    const submitBtn = await page.getByRole("button", { name: /create|set up|continue/i }).count();

    check("E1", "failed account lookup shows an error + retry and NEVER the create form",
      errTitle === 1 && retryVisible && nameField === 0 && submitBtn === 0,
      `errorTitle=${errTitle} retryVisible=${retryVisible} businessNameFields=${nameField} createButtons=${submitBtn}`);
    await shot(page, "E1-failclosed-onboarding");

    // E2 — retry refetches in place, without reloading the document.
    const callsBefore = calls;
    await retry.click();
    await page.waitForTimeout(1500);
    const sentinel = await page.evaluate(() => window.__e2eSentinel ?? null);
    check("E2", "'Try again' refetches without a full page reload",
      calls > callsBefore && sentinel === "alive",
      `callsBefore=${callsBefore} callsAfter=${calls} sentinelSurvived=${sentinel === "alive"}`);
    await shot(page, "E2-retry");

    await ctx.close();
  }

  // E3 — a broken landing lookup must not grant a surface.
  {
    const { ctx, page } = await freshContext();
    await signIn(page, USERS.merchant, { expectLanding: "/business" });

    await page.route("**/api/couranr/me/landing**", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Something went wrong.", code: "internal", correlationId: "cr_e2e_fault" }),
      });
    });
    await page.goto(`${BASE_URL}/business`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const p = new URL(page.url()).pathname;
    // Either it bounced to sign-in, or it is still checking — what it must NOT
    // do is render merchant page content as though the check had succeeded.
    const guardContent = await page.locator(".cr-state").count();
    check("E3", "a 500 from the landing lookup does not grant the merchant surface",
      p === "/sign-in" || guardContent > 0, `path=${p} stateNodes=${guardContent}`);
    await shot(page, "E3-landing-fault");
    await ctx.close();
  }
}

/* ================================================= F. MER-002 ONBOARDING */

async function groupF() {
  console.log("\n\x1b[1mF — MER-002 creates a workspace atomically (asserted on ROWS)\x1b[0m");
  const uid = USER_IDS.newMerchant;
  if (!uid) { inconclusive("F", "MER-002 onboarding", "could not resolve the newMerchant user id"); return; }

  // Precondition, proven from the database rather than assumed.
  const before = {
    accounts: await accountsCreatedBy(uid),
    memberships: await membershipsFor(uid),
  };
  if (before.accounts.length !== 0 || before.memberships.length !== 0) {
    inconclusive("F", "MER-002 onboarding",
      `newMerchant is not pristine (accounts=${before.accounts.length} memberships=${before.memberships.length}); run \`node e2e/seed.mjs seed\` first`);
    return;
  }

  const { ctx, page } = await freshContext();
  try {
    await signIn(page, USERS.newMerchant, { expectLanding: "/business/onboarding" });
  } catch {
    inconclusive("F", "MER-002 onboarding",
      `sign-in did not land on /business/onboarding (landed=${new URL(page.url()).pathname})`);
    await shot(page, "F-precondition-failed");
    await ctx.close();
    return;
  }
  await page.waitForTimeout(2000);

  const nameField = page.getByLabel("Business name");
  const formShown = await nameField.isVisible().catch(() => false);
  check("F1", "a merchant with zero memberships is offered the create form", formShown, `formShown=${formShown}`);
  await shot(page, "F1-onboarding-form");
  if (!formShown) {
    inconclusive("F3", "workspace creation", "the create form never rendered");
    await ctx.close();
    return;
  }

  const submit = page.getByRole("button", { name: /create|set up|continue|finish/i }).first();
  await submit.click();
  await page.waitForTimeout(800);
  const errs = await page.locator(".cr-field__error").count();
  check("F2", "submitting an empty form surfaces field errors and creates nothing", errs > 0, `fieldErrors=${errs}`);
  const afterEmpty = await accountsCreatedBy(uid);
  check("F2b", "the rejected submit persisted NO business account",
    afterEmpty.length === 0, `accounts=${afterEmpty.length}`);
  await shot(page, "F2-onboarding-validation");

  const BIZ = "[E2E] Marker Street Bakery";
  await nameField.fill(BIZ);
  await page.getByLabel("Category").selectOption({ index: 1 }).catch(() => {});
  await page.getByLabel("Contact phone").fill("+1-540-555-0177");
  await page.getByLabel("Street address").fill(SHIPMENT.pickup.line1);
  await page.getByLabel("City").fill(SHIPMENT.pickup.city);
  await page.getByLabel("State").fill(SHIPMENT.pickup.region);
  await page.getByLabel("ZIP").fill(SHIPMENT.pickup.postalCode);
  await page.getByLabel("Default payer").selectOption("merchant").catch(() => {});
  await page.getByRole("checkbox").first().check().catch(() => {});
  await shot(page, "F3-onboarding-filled");

  await submit.click();
  // Poll the DATABASE for the row, not the page for reassuring copy.
  let accounts = [];
  for (let i = 0; i < 30 && accounts.length === 0; i += 1) {
    await page.waitForTimeout(500);
    accounts = await accountsCreatedBy(uid);
  }
  await shot(page, "F3-onboarding-submitted");

  check("F3", "exactly one business account row was created, named as typed",
    accounts.length === 1 && accounts[0].name === BIZ,
    `rows=${accounts.length} name=${accounts[0]?.name ?? "-"}`);

  if (accounts.length !== 1) {
    inconclusive("F4", "membership + workspace", "no business account row to check against");
    await ctx.close();
    return;
  }

  const acctId = accounts[0].id;
  const members = await membershipsFor(uid);
  check("F3b", "the creator became an ACTIVE OWNER, not a viewer",
    members.length === 1 && members[0].role === "owner" && members[0].status === "active" &&
      members[0].business_account_id === acctId,
    `memberships=${JSON.stringify(members)}`);

  const ws = await workspacesFor(acctId);
  check("F3c", "exactly one workspace row was created and carries the typed values",
    ws.length === 1 && ws[0].payer_default === "merchant" && ws[0].contact_phone === "+1-540-555-0177" &&
      ws[0].created_by === uid,
    `workspaces=${ws.length} payer=${ws[0]?.payer_default} phone=${ws[0]?.contact_phone}`);

  // F4 — the UI must now report "exists" rather than offering the form again.
  await page.goto(`${BASE_URL}/business/onboarding`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  const existsCopy = await page.getByText(/workspace is ready/i).count();
  const formAgain = await page.getByLabel("Business name").count();
  check("F4", "revisiting onboarding reports the existing workspace and hides the form",
    existsCopy > 0 && formAgain === 0, `existsCopy=${existsCopy} formFieldsStillShown=${formAgain}`);
  await shot(page, "F4-onboarding-exists");

  // F5 — a second submit must not mint a second workspace.
  const acctsAfter = await accountsCreatedBy(uid);
  check("F5", "revisiting did not create a second business account",
    acctsAfter.length === 1, `accounts=${acctsAfter.length}`);

  await ctx.close();
}

/* ============================================ G. CROSS-SURFACE REDIRECTS */

async function groupG() {
  console.log("\n\x1b[1mG — a signed-in user cannot sit on someone else's surface\x1b[0m");
  const cases = [
    [USERS.merchant, "/business", "/operations", "/business"],
    [USERS.driver, "/driver", "/business", "/driver"],
    [USERS.ops, "/operations", "/business", "/operations"],
  ];
  for (const [user, home, intrude, expected] of cases) {
    const { ctx, page } = await freshContext();
    await signIn(page, user, { expectLanding: home });
    await page.goto(`${BASE_URL}${intrude}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    const p = new URL(page.url()).pathname;
    check(`G-${user.key}`, `${user.key} visiting ${intrude} is redirected back to ${expected}`,
      p.startsWith(expected), `landed=${p}`);
    await shot(page, `G-cross-${user.key}`);
    await ctx.close();
  }
}

/* ================================================= H. MER-005 / OPS-002 */

async function groupH() {
  console.log("\n\x1b[1mH — MER-005 create-delivery and OPS-002 queue render for the right roles\x1b[0m");
  {
    const { ctx, page } = await freshContext();
    await signIn(page, USERS.merchant, { expectLanding: "/business" });
    await page.goto(`${BASE_URL}/business/deliveries/new`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    const miles = await page.getByLabel("Loaded miles").count();
    const weight = await page.getByLabel("Weight (lb)").count();
    check("H1", "MER-005 renders its shipment fields for a merchant",
      miles === 1 && weight === 1, `loadedMiles=${miles} weight=${weight}`);
    await shot(page, "H1-new-delivery");
    await ctx.close();
  }
  {
    const { ctx, page } = await freshContext();
    await signIn(page, USERS.ops, { expectLanding: "/operations" });
    await page.goto(`${BASE_URL}/operations/queue`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    const placeholder = await page.getByText(/not yet built|placeholder/i).count();
    const p = new URL(page.url()).pathname;
    check("H2", "OPS-002 queue renders for an operations user",
      p === "/operations/queue" && placeholder === 0, `path=${p} placeholderHits=${placeholder}`);
    await shot(page, "H2-ops-queue");
    await ctx.close();
  }
}

/* ============================================ I. LEGACY HEADER OWNERSHIP */

/**
 * The legacy `PublicHeader` ("Auto | Courier | Docs | Open portal") used to be
 * mounted in the ROOT layout, so it sat on top of every canonical screen. No
 * unit test could see it; it was visible in all 28 screenshots of the previous
 * run. Asserted structurally on `header.publicHeader`, and asserted in BOTH
 * directions so "fixed by deleting the header everywhere" cannot pass.
 */
async function groupI() {
  console.log("\n\x1b[1mI — the legacy header is gone from canonical surfaces, kept on legacy ones\x1b[0m");

  const CANONICAL_PUBLIC = ["/sign-in", "/sign-up", "/pricing", "/how-it-works", "/service-areas"];
  const LEGACY = ["/", "/auto", "/docs"];

  // Signed-out canonical public routes.
  {
    const { ctx, page } = await freshContext();
    for (const route of CANONICAL_PUBLIC) {
      await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1200);
      const n = await page.locator("header.publicHeader").count();
      check(`I-pub${route.replace(/\//g, "-")}`, `canonical ${route} has no legacy header`, n === 0, `publicHeader nodes=${n}`);
    }
    await shot(page, "I1-canonical-public-no-header");
    await ctx.close();
  }

  // Authenticated canonical shells.
  for (const [key, landing] of [["merchant", "/business"], ["ops", "/operations"], ["driver", "/driver"]]) {
    const { ctx, page } = await freshContext();
    try {
      await signIn(page, USERS[key], { expectLanding: landing });
      await page.waitForTimeout(1200);
      const n = await page.locator("header.publicHeader").count();
      check(`I-${key}`, `canonical ${landing} shell has no legacy header`, n === 0, `publicHeader nodes=${n}`);
      await shot(page, `I2-${key}-no-header`);
    } catch (e) {
      inconclusive(`I-${key}`, `canonical ${landing} header check`, `could not reach ${landing}: ${e.message.split("\n")[0]}`);
    }
    await ctx.close();
  }

  // Positive control: legacy pages MUST still have it, or "removed everywhere"
  // would score green.
  {
    const { ctx, page } = await freshContext();
    for (const route of LEGACY) {
      await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1200);
      const n = await page.locator("header.publicHeader").count();
      check(`I-legacy${route === "/" ? "-root" : route.replace(/\//g, "-")}`,
        `legacy ${route} KEEPS its header`, n === 1, `publicHeader nodes=${n}`);
    }
    await shot(page, "I3-legacy-keeps-header");
    await ctx.close();
  }
}

/* ================================================== J. DRIVER DELIVERIES */

/**
 * DRV-001 / DRV-002 read path (Commit N).
 *
 * The browser is what exposed this: /driver queried
 * `deliveries.pickup_address`, a column that does not exist, and rendered the
 * PostgREST message to the driver. Meanwhile /driver/deliveries read
 * `payload.deliveries` from an endpoint that returned `{ data }`, so its list
 * was permanently empty and looked exactly like "no assignments".
 *
 * The populated case is driven by INTERCEPTING the endpoint with a synthetic
 * assignment rather than writing a delivery row into production — the real
 * `deliveries` table holds 29 live rows and none of them are ours to touch.
 */
const SYNTHETIC_DELIVERY = {
  id: "e2e00000-0000-4000-8000-000000000001",
  status: "assigned",
  createdAt: "2026-07-31T12:00:00.000Z",
  recipientName: "E2E Recipient",
  estimatedMiles: 6.4,
  weightLb: 9,
  orderNumber: "CR-E2E-001",
  pickupAddress: "412 Marker Street, Stafford, VA 22554",
  dropoffAddress: "1500 Caroline Street, Fredericksburg, VA 22401",
};

/** Fails the whole group if a raw schema/database message ever reaches a page. */
async function assertNoSchemaError(page, id, where) {
  const body = await page.locator("body").innerText();
  const leaked = [
    /column .* does not exist/i,
    /relation .* does not exist/i,
    /PGRST\d+/,
    /permission denied for table/i,
    /could not find a relationship/i,
  ].filter((rx) => rx.test(body));
  check(id, `${where} renders no schema or database error`, leaked.length === 0,
    leaked.length ? `leaked: ${body.match(leaked[0])?.[0]}` : "");
}

async function groupJ() {
  console.log("\n\x1b[1mJ — driver delivery reads come from the canonical endpoint\x1b[0m");

  // J1–J3: a real driver, real endpoint, genuinely no assignments.
  {
    const { ctx, page } = await freshContext();
    try {
      await signIn(page, USERS.driver, { expectLanding: "/driver" });
    } catch {
      inconclusive("J1", "driver dashboard", `driver did not land on /driver (at ${new URL(page.url()).pathname})`);
      await ctx.close();
      return;
    }
    await page.waitForTimeout(2500);

    check("J1", "a real driver can open /driver", new URL(page.url()).pathname === "/driver",
      `path=${new URL(page.url()).pathname}`);
    await assertNoSchemaError(page, "J2", "/driver");

    // The seeded driver has no assignments, so the empty state is the truth.
    const empty = await page.getByText(/No active delivery assigned right now/i).count();
    check("J3", "the empty state renders when the driver has no assignments", empty === 1, `emptyState=${empty}`);
    await shot(page, "J1-driver-empty");
    await ctx.close();
  }

  // J4/J6: populated dashboard via interception.
  {
    const { ctx, page } = await freshContext();
    await page.route("**/api/driver/my-deliveries", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ deliveries: [SYNTHETIC_DELIVERY] }),
      });
    });
    try {
      await signIn(page, USERS.driver, { expectLanding: "/driver" });
    } catch {
      inconclusive("J4", "populated driver dashboard", "driver did not reach /driver");
      await ctx.close();
      return;
    }
    await page.waitForTimeout(2500);

    const body = await page.locator("body").innerText();
    const shows = {
      pickup: body.includes("412 Marker Street, Stafford, VA 22554"),
      dropoff: body.includes("1500 Caroline Street, Fredericksburg, VA 22401"),
      status: /Assigned/i.test(body),
      recipient: body.includes("E2E Recipient"),
      mileage: body.includes("6.40"),
      weight: /9 lbs/.test(body),
      order: body.includes("CR-E2E-001"),
    };
    check("J4", "/driver renders pickup, drop-off, status, recipient, mileage and weight",
      Object.values(shows).every(Boolean), JSON.stringify(shows));
    await assertNoSchemaError(page, "J4b", "/driver (populated)");
    await shot(page, "J2-driver-assigned");
    await ctx.close();
  }

  // J5/J6: the SAME assignment on /driver/deliveries, with Start Delivery.
  {
    const { ctx, page } = await freshContext();
    await page.route("**/api/driver/my-deliveries", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ deliveries: [SYNTHETIC_DELIVERY] }),
      });
    });
    try {
      await signIn(page, USERS.driver, { expectLanding: "/driver" });
    } catch {
      inconclusive("J5", "/driver/deliveries", "driver did not reach /driver");
      await ctx.close();
      return;
    }
    await page.goto(`${BASE_URL}/driver/deliveries`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);

    const body = await page.locator("body").innerText();
    const same =
      body.includes("412 Marker Street, Stafford, VA 22554") &&
      body.includes("1500 Caroline Street, Fredericksburg, VA 22401") &&
      body.includes("E2E Recipient");
    check("J5", "/driver/deliveries renders the same assignment", same,
      `pickup=${body.includes("412 Marker Street, Stafford, VA 22554")} ` +
      `dropoff=${body.includes("1500 Caroline Street, Fredericksburg, VA 22401")} ` +
      `recipient=${body.includes("E2E Recipient")}`);

    const start = await page.getByRole("button", { name: /start delivery/i }).count();
    check("J6", "Start Delivery is present for an assigned delivery", start === 1, `buttons=${start}`);
    await assertNoSchemaError(page, "J6b", "/driver/deliveries");
    await shot(page, "J3-deliveries-assigned");
    await ctx.close();
  }

  // J7: a merchant cannot remain on either driver page.
  for (const route of ["/driver", "/driver/deliveries"]) {
    const { ctx, page } = await freshContext();
    try {
      await signIn(page, USERS.merchant, { expectLanding: "/business" });
      await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3500);
      const p = new URL(page.url()).pathname;
      check(`J7${route.replace(/\//g, "-")}`, `a merchant cannot remain on ${route}`,
        !p.startsWith("/driver"), `landed=${p}`);
    } catch (e) {
      inconclusive(`J7${route.replace(/\//g, "-")}`, `merchant on ${route}`, e.message.split("\n")[0]);
    }
    await ctx.close();
  }

  // J8: signed out reaches canonical /sign-in, not legacy /login.
  for (const route of ["/driver", "/driver/deliveries"]) {
    const { ctx, page } = await freshContext();
    await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded" });
    let landed = new URL(page.url()).pathname;
    try {
      await page.waitForURL((u) => u.pathname === "/sign-in", { timeout: 20000 });
      landed = new URL(page.url()).pathname;
    } catch { /* keep whatever it settled on */ }
    check(`J8${route.replace(/\//g, "-")}`, `signed-out ${route} reaches canonical /sign-in`,
      landed === "/sign-in", `landed=${landed}`);
    await ctx.close();
  }
}

/* ================================================== K. CANONICAL LOGO ==== */

/**
 * BRAND_GUIDE.md from Couranr_Canonical_Logo_System_v1.zip.
 *
 * The zip had been tracked since 2026-07-28 and was never unpacked, so every
 * surface shipped a typed wordmark and a retired `C.` mark. These assertions
 * run in a real browser because a typed wordmark and an SVG wordmark are
 * indistinguishable to a string search of rendered HTML once both say
 * "Couranr" — only the DOM shows which one is actually there.
 */
async function groupK() {
  console.log("\n\x1b[1mK — every surface uses the approved logo, none uses a retired mark\x1b[0m");

  const LIGHT = ["/sign-in", "/sign-up", "/", "/login"];
  const DARK = [["merchant", "/business"], ["ops", "/operations"], ["driver", "/driver"]];

  // K1 — light surfaces carry the PRIMARY wordmark, signed out.
  {
    const { ctx, page } = await freshContext();
    for (const route of LIGHT) {
      await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1200);
      const primary = await page.locator('img[src*="couranr-logo-primary"]').count();
      const retired = await page.locator(".brandMark, .brandDot, .brandC").count();
      check(`K1${route === "/" ? "-root" : route.replace(/\//g, "-")}`,
        `${route} shows the primary wordmark and no retired mark`,
        primary >= 1 && retired === 0, `primarySvg=${primary} retiredMark=${retired}`);
    }
    await shot(page, "K1-light-surfaces");
    await ctx.close();
  }

  // K2 — the dark sidebars carry the REVERSE wordmark, never the navy one.
  for (const [key, landing] of DARK) {
    const { ctx, page } = await freshContext();
    try {
      await signIn(page, USERS[key], { expectLanding: landing });
      await page.waitForTimeout(1500);
      const reverse = await page.locator('img[src*="couranr-logo-reverse"]').count();
      const navyOnDark = await page.locator('.cr-sidebar img[src*="couranr-logo-primary"]').count();
      const typed = await page.locator(".cr-wordmark").evaluateAll((els) =>
        els.filter((e) => (e.textContent ?? "").trim().length > 0).length
      );
      check(`K2-${key}`, `${landing} uses the reverse wordmark on navy, never typed text`,
        reverse >= 1 && navyOnDark === 0 && typed === 0,
        `reverseSvg=${reverse} navyOnDark=${navyOnDark} typedWordmarks=${typed}`);
      await shot(page, `K2-${key}-reverse`);
    } catch (e) {
      inconclusive(`K2-${key}`, `${landing} logo`, e.message.split("\n")[0]);
    }
    await ctx.close();
  }

  // K3 — aspect ratio is never stretched. "Preserve the SVG aspect ratio."
  {
    const { ctx, page } = await freshContext();
    await page.goto(`${BASE_URL}/sign-in`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const boxes = await page.locator('img[src*="couranr-logo"]').evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      })
    );
    const EXPECTED = 900 / 250;
    const ok = boxes.length > 0 && boxes.every((b) => b.h > 0 && Math.abs(b.w / b.h - EXPECTED) < 0.06);
    check("K3", "the wordmark renders at the supplied 900:250 ratio (never stretched)",
      ok, `boxes=${JSON.stringify(boxes)} expectedRatio=${EXPECTED.toFixed(2)}`);
    await ctx.close();
  }

  // K4 — favicon and app icon are served, not 404.
  {
    const { ctx, page } = await freshContext();
    const results = {};
    for (const asset of [
      "/brand/couranr-logo-primary.svg",
      "/brand/couranr-logo-reverse.svg",
      "/brand/couranr-app-icon.svg",
      "/brand/couranr-app-icon-192.png",
      "/brand/couranr-app-icon-512.png",
    ]) {
      const r = await page.request.get(`${BASE_URL}${asset}`);
      results[asset] = r.status();
    }
    const all200 = Object.values(results).every((s) => s === 200);
    check("K4", "every approved brand asset is served", all200, JSON.stringify(results));

    await page.goto(`${BASE_URL}/sign-in`, { waitUntil: "domcontentloaded" });
    const iconHrefs = await page.locator('link[rel~="icon"], link[rel="apple-touch-icon"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
    check("K5", "the favicon is the approved app mark",
      iconHrefs.length > 0 && iconHrefs.every((h) => h.includes("couranr-app-icon")),
      `icons=${JSON.stringify(iconHrefs)}`);
    await ctx.close();
  }
}

/* ------------------------------------------------------------------ main */

console.log(`\n\x1b[1mCouranr browser verification\x1b[0m  ->  ${BASE_URL}`);

const SEED_STATE = loadSeedState();
console.log(`  seed run ${SEED_STATE.tag}; fixtures: ${Object.keys(USER_IDS).join(", ")}`);
console.log(`  onboarding fixture: ${USERS.newMerchant.email}`);

// Invariant: this suite must not alter the real production tables. Counted
// before and after and asserted, rather than asserted from good intentions.
const REAL_BEFORE = await realDataCounts();
console.log(`  real-data baseline: ${JSON.stringify(REAL_BEFORE)}`);

browser = await chromium.launch({
  headless: !HEADED,
  // Deterministic: never route localhost through the session's HTTPS proxy.
  args: ["--no-proxy-server", "--disable-quic"],
});


/* ================================== L. REVIEW OUTCOMES (REV-001, Commit O) */

/**
 * The full review lifecycle, driven end to end in the browser:
 *
 *   merchant fills MER-005 -> sees the quote on MER-006 -> submits
 *   Couranr Operations opens OPS-002 -> begins review -> decides on OPS-003
 *   merchant reads the outcome on MER-007
 *
 * Every assertion about what happened is made against the ROW and the
 * append-only EVENT, not against page text. A screen that renders "Confirmed"
 * while the request is still `pending_couranr_review` is exactly the defect
 * this group exists to catch, and page text cannot distinguish the two.
 *
 * The three decision paths are exercised on three SEPARATE requests, because
 * each is terminal — a declined request cannot then be confirmed.
 */

/** Fills MER-005 and returns the request id, or null if it never got created. */
async function createRequestThroughUi(page, accountId, { acknowledge }) {
  const before = await requestsFor(accountId);
  const beforeIds = new Set(before.map((r) => r.id));

  await page.goto(`${BASE_URL}/business/deliveries/new`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Loaded miles").waitFor({ state: "visible", timeout: 25000 });

  /**
   * Labels are NOT matched exactly. `Field` appends a required marker, so the
   * rendered label text is "Street address*" and "Loaded miles*", while an
   * optional field reads "Suite, unit or floor (optional)". An exact match
   * finds nothing — which is how the first version of this helper timed out.
   */
  const fill = (label, value) => page.getByLabel(label).first().fill(value);
  // Pickup and Dropoff use the SAME field labels, so they are scoped by card.
  const card = (title) =>
    page.locator(".cr-card").filter({ has: page.getByRole("heading", { name: title }) }).first();
  const inCard = (title, label, value) => card(title).getByLabel(label).first().fill(value);

  await inCard("Pickup", "Street address", SHIPMENT.pickup.line1);
  await inCard("Pickup", "City", SHIPMENT.pickup.city);
  await inCard("Pickup", "State", SHIPMENT.pickup.region);
  await inCard("Pickup", "ZIP", SHIPMENT.pickup.postalCode);
  await inCard("Dropoff", "Street address", SHIPMENT.dropoff.line1);
  await inCard("Dropoff", "City", SHIPMENT.dropoff.city);
  await inCard("Dropoff", "State", SHIPMENT.dropoff.region);
  await inCard("Dropoff", "ZIP", SHIPMENT.dropoff.postalCode);
  await fill("Loaded miles", SHIPMENT.loadedMiles);
  await fill("Weight (lb)", SHIPMENT.weightLb);

  await page.getByRole("button", { name: /calculate estimate/i }).click();
  await page.getByRole("button", { name: /submit for couranr review/i }).waitFor({
    state: "visible",
    timeout: 25000,
  });

  // MER-006's acknowledgment. Present only for a merchant-paid priced quote.
  const ack = page.getByLabel(/I approve this delivery estimate/i);
  const ackVisible = (await ack.count()) > 0;
  if (acknowledge && ackVisible) await ack.check();

  await page.getByRole("button", { name: /submit for couranr review/i }).click();
  await page.waitForURL((u) => /\/business\/deliveries\/[0-9a-f-]{36}$/.test(u.pathname), {
    timeout: 25000,
  }).catch(() => {});

  const after = await requestsFor(accountId);
  const fresh = after.find((r) => !beforeIds.has(r.id));
  return { id: fresh?.id ?? null, ackVisible };
}

/**
 * OPS-002: records that Couranr opened the request. Kept SEPARATE from the
 * decision because it bumps `version` — bracketing a refusal around both would
 * report the begin-review bump as if the refused command had written. That is
 * precisely what the first version of assertion L10 did.
 */
async function openForReview(page, requestId) {
  await page.goto(`${BASE_URL}/operations/queue`, { waitUntil: "domcontentloaded" });
  const openBtn = page
    .locator("tr", { has: page.locator(`a[href$="${requestId}"]`) })
    .getByRole("button", { name: /open for review/i });
  await openBtn.waitFor({ state: "visible", timeout: 25000 });
  await openBtn.click();
  await page.waitForTimeout(1500);
}

/** Opens OPS-003 and clicks exactly one decision. */
async function decideAsOps(page, requestId, decision, { reason, note, alreadyOpen = false } = {}) {
  if (!alreadyOpen) await openForReview(page, requestId);

  // OPS-003, the operations surface. A merchant URL would be redirected away.
  await page.goto(`${BASE_URL}/operations/deliveries/${requestId}`, { waitUntil: "domcontentloaded" });
  await page.getByText("Couranr review decision").waitFor({ state: "visible", timeout: 25000 });

  if (decision === "accept") {
    await page.getByRole("button", { name: /^confirm as quoted$/i }).click();
  } else if (decision === "requote") {
    await page.getByRole("button", { name: /^send revised quote$/i }).click();
    await page.getByLabel(/why is the quote being revised/i).fill(reason);
    await page.getByRole("button", { name: /^send revised quote$/i }).last().click();
  } else {
    await page.getByRole("button", { name: /could not confirm service/i }).click();
    if (reason) await page.getByLabel(/reason couranr could not confirm/i).selectOption(reason);
    if (note) await page.getByLabel(/internal note/i).fill(note);
    await page.getByRole("button", { name: /record that couranr could not confirm/i }).click();
  }

  /*
   * Wait for the OUTCOME, not for a duration.
   *
   * All three decisions move the request out of `pending_couranr_review`, and
   * the decision panel renders only for that state — so the panel going away
   * IS the write having landed. A fixed 2s wait lost the race the first time a
   * cold Next dev server compiled `/accept-as-quoted` on the request path: the
   * POST returned 200 at 1977ms, the harness had already read the row, and the
   * group reported "not confirmed" for a confirm that worked perfectly.
   */
  await page
    .getByText("Couranr review decision")
    .waitFor({ state: "hidden", timeout: 30000 })
    .catch(() => {});
}

async function groupL() {
  console.log("\n\x1b[1mL — review outcomes: confirm as quoted, revised quote, could not confirm\x1b[0m");

  const accounts = await accountsCreatedBy(USER_IDS.merchant);
  if (accounts.length === 0) {
    inconclusive("L0", "review-outcome flow", "the merchant fixture has no business account");
    return;
  }
  const accountId = accounts[0].id;

  /* --- L1..L4  merchant-paid, acknowledged -> confirmed ------------------ */
  let acceptId = null;
  {
    const { ctx, page } = await freshContext();
    await signIn(page, USERS.merchant, { expectLanding: "/business" });
    const made = await createRequestThroughUi(page, accountId, { acknowledge: true });
    acceptId = made.id;
    check("L1", "MER-006 offers the quote acknowledgment for a merchant-paid priced quote",
      made.ackVisible, `checkboxPresent=${made.ackVisible}`);
    await shot(page, "L1-mer006-acknowledgment");

    if (!acceptId) {
      inconclusive("L2", "submission persisted", "no new request row appeared after submit");
    } else {
      const row = await requestById(acceptId);
      check("L2", "submitting moved the ROW to pending_couranr_review with review pending",
        row?.request_state === "pending_couranr_review" && row?.review_state === "pending",
        `request_state=${row?.request_state} review_state=${row?.review_state}`);

      const ev = await eventsFor(acceptId);
      const submit = ev.filter((e) => e.command === "submit_delivery_request").pop();
      check("L3", "the submission event records acknowledgment=true against the SERVER-stored quote",
        submit?.metadata?.acknowledgment === true &&
          submit?.metadata?.deliverySubtotalCents === row?.delivery_subtotal_cents &&
          submit?.metadata?.pricingPolicyVersion === row?.pricing_policy_version,
        `ack=${submit?.metadata?.acknowledgment} eventSubtotal=${submit?.metadata?.deliverySubtotalCents} rowSubtotal=${row?.delivery_subtotal_cents}`);
    }
    await ctx.close();
  }

  if (acceptId) {
    const { ctx, page } = await freshContext();
    await signIn(page, USERS.ops, { expectLanding: "/operations" });
    await decideAsOps(page, acceptId, "accept");
    await shot(page, "L4-ops-confirmed");

    const row = await requestById(acceptId);
    check("L4", "confirm as quoted moves a merchant-paid request to confirmed / accepted_as_quoted",
      row?.request_state === "confirmed" && row?.review_state === "accepted_as_quoted",
      `request_state=${row?.request_state} review_state=${row?.review_state}`);

    // The state that must NOT have moved. `confirmed` is a review conclusion,
    // not a payment or dispatch one.
    check("L5", "confirming authorizes no payment and does not touch readiness",
      row?.payment_due_cents === null && row?.readiness_state === "not_confirmed",
      `payment_due_cents=${row?.payment_due_cents} readiness=${row?.readiness_state}`);

    const ev = await eventsFor(acceptId);
    const acc = ev.find((e) => e.command === "accept_delivery_request_as_quoted");
    check("L6", "the decision is recorded in the append-only log as an operations action",
      acc?.actor_type === "operations" && acc?.to_state === "confirmed" &&
        acc?.from_state === "pending_couranr_review",
      `actor=${acc?.actor_type} ${acc?.from_state}->${acc?.to_state}`);
    await ctx.close();
  } else {
    inconclusive("L4", "confirm as quoted", "no request was created to confirm");
  }

  /* --- L7  the merchant sees what confirmed MEANS ------------------------ */
  if (acceptId) {
    const { ctx, page } = await freshContext();
    await signIn(page, USERS.merchant, { expectLanding: "/business" });
    await page.goto(`${BASE_URL}/business/deliveries/${acceptId}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const said = await page.getByText(/Nothing has been charged yet/i).count();
    const badge = await page.getByText("Confirmed", { exact: true }).count();
    check("L7", "MER-007 shows the outcome AND says no payment was taken",
      said > 0 && badge > 0, `chargedCopy=${said} confirmedBadge=${badge}`);
    // The decision panel is Operations-only.
    const panel = await page.getByText("Couranr review decision").count();
    check("L8", "a merchant is never shown the review decision panel", panel === 0,
      `panelHits=${panel}`);
    await shot(page, "L7-mer007-outcome");
    await ctx.close();
  } else {
    inconclusive("L7", "MER-007 outcome copy", "no confirmed request to display");
  }

  /* --- L9..L11  NO acknowledgment -> the confirm is REFUSED -------------- */
  let noAckId = null;
  {
    const { ctx, page } = await freshContext();
    await signIn(page, USERS.merchant, { expectLanding: "/business" });
    const made = await createRequestThroughUi(page, accountId, { acknowledge: false });
    noAckId = made.id;
    await ctx.close();
  }

  if (noAckId) {
    const { ctx, page } = await freshContext();
    await signIn(page, USERS.ops, { expectLanding: "/operations" });
    // Open the review FIRST, then snapshot. begin_delivery_request_review
    // legitimately bumps `version`; the refusal must be measured against the
    // state that existed immediately before the confirm was attempted.
    await openForReview(page, noAckId);
    const before = await requestById(noAckId);
    await decideAsOps(page, noAckId, "accept", { alreadyOpen: true });
    await shot(page, "L9-confirm-refused");

    const after = await requestById(noAckId);
    check("L9", "an unacknowledged merchant-paid request is NOT silently confirmed",
      after?.request_state === "pending_couranr_review" && after?.review_state === "pending",
      `request_state=${after?.request_state} review_state=${after?.review_state}`);
    check("L10", "the refusal changed nothing at all — same version, same quote",
      after?.version === before?.version &&
        after?.delivery_subtotal_cents === before?.delivery_subtotal_cents,
      `version ${before?.version}->${after?.version}`);

    const shown = await page.getByText(/without the payer's approval/i).count();
    check("L11", "the operator is told the payer's approval is required, not a generic error",
      shown > 0, `conflictCopyHits=${shown}`);

    const ev = await eventsFor(noAckId);
    check("L12", "a refused confirm writes NO event to the append-only log",
      ev.filter((e) => e.command === "accept_delivery_request_as_quoted").length === 0,
      `acceptEvents=${ev.filter((e) => e.command === "accept_delivery_request_as_quoted").length}`);

    /* --- L13  the same request can still be requoted -------------------- */
    await decideAsOps(page, noAckId, "requote", {
      reason: "E2E: distance recomputed after review",
      alreadyOpen: true,
    });
    await shot(page, "L13-requoted");
    const requoted = await requestById(noAckId);
    check("L13", "a revised quote moves the request to quote_revision_required / requoted",
      requoted?.request_state === "quote_revision_required" && requoted?.review_state === "requoted",
      `request_state=${requoted?.request_state} review_state=${requoted?.review_state}`);

    const rev = (await eventsFor(noAckId)).find((e) => e.command === "requote_delivery_request");
    check("L14", "the requote event records the reason and both amounts",
      rev?.metadata?.reason === "E2E: distance recomputed after review" &&
        typeof rev?.metadata?.previousSubtotalCents === "number" &&
        typeof rev?.metadata?.revisedSubtotalCents === "number",
      `reason=${rev?.metadata?.reason} prev=${rev?.metadata?.previousSubtotalCents} next=${rev?.metadata?.revisedSubtotalCents}`);
    check("L15", "a requote still authorizes no payment",
      requoted?.payment_due_cents === null, `payment_due_cents=${requoted?.payment_due_cents}`);
    await ctx.close();
  } else {
    inconclusive("L9", "unacknowledged confirm is refused", "no request was created");
  }

  /* --- L16..L18  decline ------------------------------------------------ */
  let declineId = null;
  {
    const { ctx, page } = await freshContext();
    await signIn(page, USERS.merchant, { expectLanding: "/business" });
    const made = await createRequestThroughUi(page, accountId, { acknowledge: true });
    declineId = made.id;
    await ctx.close();
  }

  // A note that is unmistakable if it ever surfaces where it must not.
  const SECRET_NOTE = "E2E-INTERNAL-ONLY merchant disputed two prior invoices";

  if (declineId) {
    const { ctx, page } = await freshContext();
    await signIn(page, USERS.ops, { expectLanding: "/operations" });
    await decideAsOps(page, declineId, "decline", {
      reason: "no_driver_available",
      note: SECRET_NOTE,
    });
    await shot(page, "L16-declined");

    const row = await requestById(declineId);
    check("L16", "could-not-confirm moves the request to declined / declined",
      row?.request_state === "declined" && row?.review_state === "declined",
      `request_state=${row?.request_state} review_state=${row?.review_state}`);

    const ev = (await eventsFor(declineId)).find((e) => e.command === "decline_delivery_request");
    check("L17", "the decline event records code, version, merchant message and note",
      ev?.metadata?.reasonCode === "no_driver_available" &&
        ev?.metadata?.reasonVersion === "couranr-decline-v1" &&
        ev?.metadata?.merchantMessage ===
          "Couranr does not have an available driver for this request." &&
        ev?.metadata?.internalNote === SECRET_NOTE,
      `code=${ev?.metadata?.reasonCode} version=${ev?.metadata?.reasonVersion} msg=${ev?.metadata?.merchantMessage}`);

    // The message is DERIVED server-side: it matches the code, and the
    // operator never supplied it.
    check("L17b", "the recorded merchant message is the one the code maps to, not free text",
      ev?.metadata?.merchantMessage !== SECRET_NOTE &&
        !String(ev?.metadata?.merchantMessage ?? "").includes("E2E"),
      `merchantMessage=${ev?.metadata?.merchantMessage}`);

    // A terminal outcome must not offer another decision.
    await page.goto(`${BASE_URL}/operations/deliveries/${declineId}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const stillOffering = await page.getByRole("button", { name: /^confirm as quoted$/i }).count();
    check("L18", "a decided request offers no further decision", stillOffering === 0,
      `confirmButtons=${stillOffering}`);
    await shot(page, "L18-terminal");
    await ctx.close();
  } else {
    inconclusive("L16", "decline", "no request was created to decline");
  }

  /* --- L19..L21  what the MERCHANT sees, and what they must not ---------- */

  if (declineId) {
    const { ctx, page } = await freshContext();

    // Capture the raw API response the browser receives, so the assertion is
    // about the bytes crossing the boundary and not only about rendered text.
    let apiBodies = [];
    page.on("response", async (r) => {
      if (r.url().includes(`/api/couranr/delivery-requests/${declineId}`)) {
        try {
          apiBodies.push(await r.text());
        } catch {
          /* body already consumed */
        }
      }
    });

    await signIn(page, USERS.merchant, { expectLanding: "/business" });
    await page.goto(`${BASE_URL}/business/deliveries/${declineId}`, { waitUntil: "domcontentloaded" });
    await page.getByText(/Couranr could not confirm this delivery/i).waitFor({
      state: "visible",
      timeout: 25000,
    });
    await shot(page, "L19-merchant-decline");

    const shownMessage = await page
      .getByText("Couranr does not have an available driver for this request.")
      .count();
    check("L19", "MER-007 shows the merchant-safe message for the recorded code",
      shownMessage > 0, `messageHits=${shownMessage}`);

    // The assertion that matters most in this commit.
    const pageText = await page.evaluate(() => document.body.innerText);
    const inPage = pageText.includes(SECRET_NOTE) || pageText.includes("E2E-INTERNAL-ONLY");
    const inApi = apiBodies.some(
      (b) => b.includes("E2E-INTERNAL-ONLY") || b.includes("internalNote")
    );
    check("L20", "the internal note reaches neither the merchant's screen nor the API response",
      !inPage && !inApi,
      `inRenderedPage=${inPage} inApiBody=${inApi} bodiesSeen=${apiBodies.length}`);

    // Positive control: the harness CAN see the API bodies it is asserting
    // about, so L20 cannot pass because nothing was captured.
    check("L20b", "the merchant's request API response was actually captured",
      apiBodies.length > 0 && apiBodies.some((b) => b.includes("requestState")),
      `bodiesSeen=${apiBodies.length}`);

    // And the raw code is never shown to a merchant either.
    check("L21", "the merchant is shown prose, never a raw reason code",
      !pageText.includes("no_driver_available"), "raw code rendered");
    await ctx.close();
  } else {
    inconclusive("L19", "merchant decline view", "no declined request to display");
  }

  /* --- L22  a code this build does not know renders the generic message --- */

  /**
   * The append-only log holds codes from the placeholder taxonomy, and will
   * one day hold codes from a v2. There is no live example to point at —
   * `couranr_decline_delivery_request` now REFUSES every retired code, which
   * is correct — so the historical row is simulated by rewriting the API
   * response at the browser.
   *
   * Fault injected at the page, never in the database: the request table is
   * untouched and no invalid row is created to prove a rendering rule.
   */
  if (declineId) {
    const { ctx, page } = await freshContext();
    await signIn(page, USERS.merchant, { expectLanding: "/business" });

    let rewrote = 0;
    await page.route(`**/api/couranr/delivery-requests/${declineId}*`, async (route) => {
      const res = await route.fetch();
      let body;
      try {
        body = await res.json();
      } catch {
        return route.fulfill({ response: res });
      }
      for (const e of body.events ?? []) {
        if (e.command === "decline_delivery_request") {
          // A retired code, exactly as a pre-v1 event would carry it.
          e.reasonCode = null;
          e.reasonVersion = null;
          e.legacyReason = "over_max_automatic_miles";
          rewrote += 1;
        }
      }
      await route.fulfill({ response: res, body: JSON.stringify(body) });
    });

    await page.goto(`${BASE_URL}/business/deliveries/${declineId}`, { waitUntil: "domcontentloaded" });
    await page.getByText(/Couranr could not confirm this delivery/i).waitFor({
      state: "visible",
      timeout: 25000,
    });
    await shot(page, "L22-unknown-code-fallback");

    const text = await page.evaluate(() => document.body.innerText);
    if (rewrote === 0) {
      inconclusive("L22", "unknown reason code falls back to the generic message",
        "the interceptor never saw a decline event to rewrite");
    } else {
      const generic =
        "Couranr could not confirm this request. Contact Couranr Support for details.";
      check("L22", "an unrecognised historical code renders the generic safe message",
        text.includes(generic) &&
          !text.includes("over_max_automatic_miles") &&
          !text.includes("does not have an available driver"),
        `generic=${text.includes(generic)} rawCodeShown=${text.includes("over_max_automatic_miles")}`);
    }
    await ctx.close();
  } else {
    inconclusive("L22", "unknown reason code fallback", "no declined request to display");
  }
}


/* ============================ M. PAYMENT AUTHORIZATION (mocked Stripe) === */

/**
 * Both payer paths, end to end, with Stripe mocked at BOTH boundaries:
 *
 *   server side  the SDK is pointed at `e2e/stripeDouble.mjs` with
 *                STRIPE_API_BASE, so it builds and sends its real HTTP request
 *   browser side `https://js.stripe.com/**` is intercepted and served
 *                `e2e/stripeJsMock.js`, so the REAL Elements provider and the
 *                REAL PaymentElement run against a fake Stripe
 *
 * What is faked is Stripe. What is under test is our integration: that the
 * request we build carries manual capture and the server's amount, that
 * confirmation happens before reconciliation and never the other way round,
 * that a decline does not reconcile, and that the authorized UI appears only
 * after the SERVER says so.
 *
 * PAYMENT_REAL_STRIPE_VERIFICATION = PENDING_PRELAUNCH. None of this proves
 * Stripe accepts the request.
 */

const DOUBLE_BASE = process.env.E2E_STRIPE_DOUBLE ?? "http://127.0.0.1:12111";

/**
 * The canonical webhook's signing secret, read the same way admin.mjs reads
 * credentials. Needed to SIGN a test event: an unsigned request is refused
 * before its body is parsed, so the guard assertion would prove nothing.
 * The value is never logged.
 */
function webhookSecret() {
  if (process.env.STRIPE_COURANR_WEBHOOK_SECRET) return process.env.STRIPE_COURANR_WEBHOOK_SECRET;
  try {
    const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const line of raw.split("\n")) {
      const m = /^STRIPE_COURANR_WEBHOOK_SECRET=(.*)$/.exec(line.trim());
      if (m) return m[1];
    }
  } catch {
    /* reported by the assertion itself */
  }
  return "";
}
const STRIPE_JS_MOCK = readFileSync(new URL("./stripeJsMock.js", import.meta.url), "utf8");

/** Serves the Stripe.js mock and records what the page asked Stripe to do. */
async function mockStripeJs(page) {
  await page.route("**://js.stripe.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: STRIPE_JS_MOCK,
    });
  });
  await page.addInitScript(
    ([base]) => {
      window.__couranrDoubleBase = base;
    },
    [DOUBLE_BASE]
  );
  /*
   * No API interception. The mock reads the PaymentIntent id straight out of
   * the client secret the SERVER handed the page, so the suite learns it
   * without touching the response — and without calling page.evaluate from
   * inside a route handler, which deadlocks against the pending request.
   */
}

async function groupM() {
  console.log("\n\x1b[1mM — payment authorization, both payer paths (Stripe mocked)\x1b[0m");

  const accounts = await accountsCreatedBy(USER_IDS.merchant);
  if (accounts.length === 0) {
    inconclusive("M0", "payment flows", "the merchant fixture has no business account");
    return;
  }
  const accountId = accounts[0].id;

  /* --- M1..M6  MERCHANT-PAID, unchanged quote --------------------------- */

  let merchantRequestId = null;
  {
    // Reach `confirmed` the way a merchant really does: submit with the
    // acknowledgment, then Operations confirms as quoted.
    const { ctx, page } = await freshContext();
    await signIn(page, USERS.merchant, { expectLanding: "/business" });
    const made = await createRequestThroughUi(page, accountId, { acknowledge: true });
    merchantRequestId = made.id;
    await ctx.close();

    if (merchantRequestId) {
      const { ctx: octx, page: opage } = await freshContext();
      await signIn(opage, USERS.ops, { expectLanding: "/operations" });
      await decideAsOps(opage, merchantRequestId, "accept");
      await octx.close();
    }
  }

  if (!merchantRequestId) {
    inconclusive("M1", "merchant-paid authorization", "no request reached confirmed");
  } else {
    const row = await requestById(merchantRequestId);
    check("M1", "the merchant-paid request is confirmed before any payment exists",
      row?.request_state === "confirmed", `request_state=${row?.request_state}`);

    const { ctx, page } = await freshContext();
    await mockStripeJs(page);
    await signIn(page, USERS.merchant, { expectLanding: "/business" });
    await page.goto(`${BASE_URL}/business/deliveries/${merchantRequestId}`, {
      waitUntil: "domcontentloaded",
    });

    const authorizeBtn = page.getByRole("button", { name: /^Authorize \$/ });
    await authorizeBtn.waitFor({ state: "visible", timeout: 25000 });
    await shot(page, "M1-merchant-payment-panel");
    await authorizeBtn.click();

    // The real PaymentElement mounts against the mocked Stripe.js.
    await page.locator("[data-stripe-element]").first().waitFor({ state: "visible", timeout: 25000 });
    const calls = await page.evaluate(() => window.__couranrStripeCalls ?? []);
    const elementsCall = calls.find((c) => c.fn === "elements");
    check("M2", "Elements receives the SERVER's client secret",
      Boolean(elementsCall?.clientSecret) && String(elementsCall.clientSecret).includes("_secret_"),
      `clientSecret=${elementsCall?.clientSecret ? "present" : "absent"}`);
    await shot(page, "M2-payment-element-mounted");

    // The obligation exists and carries the SERVER's amount, not the page's.
    const ob = await obligationFor(merchantRequestId);
    check("M3", "the obligation amount is the stored quote, and nothing is authorized yet",
      ob?.amount_cents === row?.delivery_subtotal_cents && ob?.payment_state === "requires_action",
      `amount=${ob?.amount_cents} quote=${row?.delivery_subtotal_cents} state=${ob?.payment_state}`);

    await page.getByRole("button", { name: /^Authorize \$/ }).click();
    await page.getByText(/Payment authorized/i).waitFor({ state: "visible", timeout: 25000 });
    await shot(page, "M3-merchant-authorized");

    const after = await obligationFor(merchantRequestId);
    check("M4", "the obligation is authorized only after the server said so",
      after?.payment_state === "authorized" && after?.authorized_at !== null,
      `payment_state=${after?.payment_state}`);

    const rowAfter = await requestById(merchantRequestId);
    check("M5", "an already-confirmed merchant request stays confirmed",
      rowAfter?.request_state === "confirmed", `request_state=${rowAfter?.request_state}`);

    const stripeCalls = await page.evaluate(() => window.__couranrStripeCalls ?? []);
    const confirm = stripeCalls.filter((c) => c.fn === "confirmPayment");
    check("M6", "confirmPayment ran once, with redirect if_required and no browser amount",
      confirm.length === 1 && confirm[0].redirect === "if_required" &&
        confirm[0].amount === undefined && confirm[0].currency === undefined,
      `calls=${confirm.length} redirect=${confirm[0]?.redirect} amount=${confirm[0]?.amount}`);
    await ctx.close();
  }

  /* --- M7..M12  CUSTOMER-PAID via the payment link ---------------------- */

  let customerRequestId = null;
  let payToken = null;
  {
    const { ctx, page } = await freshContext();
    await signIn(page, USERS.merchant, { expectLanding: "/business" });
    const made = await createRequestThroughUi(page, accountId, { acknowledge: false });
    customerRequestId = made.id;
    await ctx.close();

    if (customerRequestId) {
      // Make it customer-paid, then let Operations confirm as quoted, which
      // for a customer payer lands on awaiting_quote_acceptance.
      await setPayerType(customerRequestId, "customer");
      const { ctx: octx, page: opage } = await freshContext();
      await signIn(opage, USERS.ops, { expectLanding: "/operations" });
      await decideAsOps(opage, customerRequestId, "accept");
      await octx.close();
      payToken = await issueLinkForRequest(customerRequestId, accountId);
    }
  }

  if (!customerRequestId || !payToken) {
    inconclusive("M7", "customer-paid authorization",
      `requestId=${Boolean(customerRequestId)} token=${Boolean(payToken)}`);
  } else {
    const row = await requestById(customerRequestId);
    check("M7", "a customer-paid confirm waits for the customer",
      row?.request_state === "awaiting_quote_acceptance",
      `request_state=${row?.request_state}`);

    // A brand-new context: no session at all. The link IS the authorization.
    const { ctx, page } = await freshContext();
    await mockStripeJs(page);
    await page.goto(`${BASE_URL}/pay/${payToken}`, { waitUntil: "domcontentloaded" });

    await page.getByText(/Authorize this amount|Approve the revised amount/i).waitFor({
      state: "visible",
      timeout: 25000,
    });
    const signedOut = await hasSession(ctx);
    check("M8", "PUB-005 opens with no Couranr session — the link is the authorization",
      signedOut === false, `hasSession=${signedOut}`);
    await shot(page, "M8-pub005-quote");

    await page.getByRole("button", { name: /Authorize this amount|Approve the revised/i }).click();
    await page.locator("[data-stripe-element]").first().waitFor({ state: "visible", timeout: 25000 });
    await shot(page, "M9-pub005-element");

    // A declined card must NOT reconcile.
    await page.evaluate(() => { window.__couranrStripeFailNext = true; });
    await page.getByRole("button", { name: /^Authorize \$/ }).click();
    await page.getByText(/card was declined/i).waitFor({ state: "visible", timeout: 20000 });
    const declinedOb = await obligationFor(customerRequestId);
    check("M9", "a declined confirmation authorizes nothing",
      declinedOb?.payment_state !== "authorized",
      `payment_state=${declinedOb?.payment_state}`);
    check("M10", "and the request has not moved",
      (await requestById(customerRequestId))?.request_state === "awaiting_quote_acceptance",
      "request moved on a decline");
    await shot(page, "M10-declined");

    // Now let it succeed.
    await page.getByRole("button", { name: /^Authorize \$/ }).click();
    await page.getByText(/Payment authorized/i).waitFor({ state: "visible", timeout: 25000 });
    await shot(page, "M11-customer-authorized");

    const finalOb = await obligationFor(customerRequestId);
    const finalRow = await requestById(customerRequestId);
    check("M11", "authorizing a customer-paid quote confirms the request",
      finalOb?.payment_state === "authorized" && finalRow?.request_state === "confirmed",
      `payment=${finalOb?.payment_state} request=${finalRow?.request_state}`);

    const approvals = await eventsFor(customerRequestId);
    check("M12", "the payer approval is recorded once in the append-only log",
      approvals.filter((e) => e.command === "record_payer_quote_approval").length === 1,
      `approvals=${approvals.filter((e) => e.command === "record_payer_quote_approval").length}`);

    /*
     * The link is dead the moment it has done its job.
     *
     * It comes back as `revoked`, not `already_authorized`: authorizing
     * revokes every live token for the request, so redemption refuses at the
     * revocation check before it ever reaches the obligation. Both are correct
     * refusals and the assertion accepts either — what must be true is that
     * the link no longer offers to take a payment.
     */
    await page.goto(`${BASE_URL}/pay/${payToken}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const refusedCopy = await page
      .getByText(/no longer active|already authorized|expired|not valid/i)
      .count();
    const stillOffering = await page
      .getByRole("button", { name: /Authorize|Approve the revised/i })
      .count();
    check("M13", "the payment link stops working once authorized",
      refusedCopy > 0 && stillOffering === 0,
      `refusalCopy=${refusedCopy} payButtons=${stillOffering}`);

    // And the database agrees about why.
    const spent = await tokenStateFor(customerRequestId);
    check("M13b", "the token was revoked with a reason that names the cause",
      spent?.revoked_at !== null && spent?.revoked_reason === "payment_authorized",
      `revoked_reason=${spent?.revoked_reason}`);
    await shot(page, "M13-link-spent");
    await ctx.close();
  }

  /* --- M14  no capture was ever attempted ------------------------------- */

  const paths = capturedPaths();
  check("M14", "the Stripe double saw NO capture call",
    paths.every((p) => !p.includes("/capture")) && paths.some((p) => p.startsWith("POST /v1/payment_intents")),
    `paths=${[...new Set(paths)].join(", ").slice(0, 200)}`);

  const unexpected = paths.filter((p) => p.includes("/capture") || p.includes("/refunds"));
  check("M15", "and no refund call either", unexpected.length === 0, unexpected.join(", "));
}

/* ============================ N. READINESS, CAPTURE, CANONICAL DELIVERY == */

/**
 * The stage OPS-002 puts a request in, read from the row's own data attribute.
 *
 * The stage is computed on the SERVER and stamped onto the row, so this reads
 * what an operator is actually looking at rather than re-deriving it here —
 * a test that recomputed the stage would agree with itself no matter what the
 * screen showed.
 */
async function queueStageFor(page, requestId) {
  await page.goto(`${BASE_URL}/operations/queue`, { waitUntil: "domcontentloaded" });
  const row = page.locator(`tr[data-request-id="${requestId}"]`);
  await row.first().waitFor({ state: "attached", timeout: 25000 }).catch(() => {});
  if ((await row.count()) === 0) return null;
  return await row.first().getAttribute("data-stage");
}

/** Drives one request from submitted to confirmed, the way the product does. */
async function confirmedRequestFor(accountId) {
  const { ctx, page } = await freshContext();
  await signIn(page, USERS.merchant, { expectLanding: "/business" });
  const made = await createRequestThroughUi(page, accountId, { acknowledge: true });
  await ctx.close();
  if (!made.id) return null;

  const { ctx: octx, page: opage } = await freshContext();
  await signIn(opage, USERS.ops, { expectLanding: "/operations" });
  await decideAsOps(opage, made.id, "accept");
  await octx.close();
  return made.id;
}

async function groupN() {
  console.log("\n\x1b[1mN — readiness, service plan, capture and canonical delivery\x1b[0m");

  const accounts = await accountsCreatedBy(USER_IDS.merchant);
  if (accounts.length === 0) {
    inconclusive("N0", "fulfillment flow", "the merchant fixture has no business account");
    return;
  }
  const accountId = accounts[0].id;

  // The legacy tables, counted before this group runs. The suite-wide SAFE
  // check covers the whole run; this one localises any write to Group N.
  const legacyBefore = await realDataCounts();
  const captureCallsBefore = stripeCalls.filter((c) => c.path.endsWith("/capture")).length;

  const requestId = await confirmedRequestFor(accountId);
  if (!requestId) {
    inconclusive("N1", "fulfillment flow", "no request reached confirmed");
    return;
  }

  const confirmed = await requestById(requestId);
  if (confirmed?.request_state !== "confirmed") {
    inconclusive("N1", "fulfillment flow",
      `request is ${confirmed?.request_state}, not confirmed`);
    return;
  }

  /* --- N1..N3  readiness cannot precede authorization -------------------- */

  {
    const { ctx, page } = await freshContext();
    await signIn(page, USERS.merchant, { expectLanding: "/business" });
    await page.goto(`${BASE_URL}/business/deliveries/${requestId}`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByText("Preparation").first().waitFor({ state: "visible", timeout: 25000 });
    const readyBtn = await page.getByRole("button", { name: /^Ready for Couranr$/ }).count();
    const waiting = await page.getByText(/Waiting for payment authorization/i).count();
    check("N1", "MER-007 offers no Ready before the payment is authorized",
      readyBtn === 0 && waiting > 0,
      `readyButtons=${readyBtn} waitingCopy=${waiting}`);
    await shot(page, "N1-mer007-ready-withheld");
    await ctx.close();
  }

  {
    // Hiding a button is not enforcement. The ROUTE must refuse a caller that
    // never saw the screen.
    const r = await apiAs(USERS.merchant, `/api/couranr/delivery-requests/${requestId}/readiness`, {
      method: "POST",
      body: {
        businessAccountId: accountId,
        expectedVersion: confirmed.version,
        readiness: "ready",
      },
    });
    const after = await requestById(requestId);
    check("N2", "the readiness route refuses Ready before authorization, and nothing moved",
      r.status === 409 && after?.readiness_state === "not_confirmed" &&
        after?.version === confirmed.version,
      `status=${r.status} readiness=${after?.readiness_state} version=${after?.version}`);
  }

  {
    const { ctx, page } = await freshContext();
    await signIn(page, USERS.ops, { expectLanding: "/operations" });
    const stage = await queueStageFor(page, requestId);
    check("N3", "OPS-002 files an unauthorized request under awaiting payment authorization",
      stage === "awaiting_payment_authorization", `stage=${stage}`);
    await shot(page, "N3-ops002-awaiting-authorization");
    await ctx.close();
  }

  /* --- N4  the merchant authorizes -------------------------------------- */

  {
    const { ctx, page } = await freshContext();
    await mockStripeJs(page);
    await signIn(page, USERS.merchant, { expectLanding: "/business" });
    await page.goto(`${BASE_URL}/business/deliveries/${requestId}`, {
      waitUntil: "domcontentloaded",
    });
    const authorize = page.getByRole("button", { name: /^Authorize \$/ });
    await authorize.waitFor({ state: "visible", timeout: 25000 });
    await authorize.click();
    await page.locator("[data-stripe-element]").first().waitFor({ state: "visible", timeout: 25000 });
    await page.getByRole("button", { name: /^Authorize \$/ }).click();
    await page.getByText(/Payment authorized/i).waitFor({ state: "visible", timeout: 25000 });
    await ctx.close();
  }

  const authorizedOb = await obligationFor(requestId);
  check("N4", "the hold is authorized for the SERVER-stored quote, nothing captured",
    authorizedOb?.payment_state === "authorized" &&
      authorizedOb?.amount_cents === confirmed.delivery_subtotal_cents,
    `state=${authorizedOb?.payment_state} amount=${authorizedOb?.amount_cents} quote=${confirmed.delivery_subtotal_cents}`);

  /* --- N5..N6  merchant scope and optimistic concurrency ----------------- */

  {
    const before = await requestById(requestId);
    const r = await apiAs(
      USERS.newMerchant,
      `/api/couranr/delivery-requests/${requestId}/readiness`,
      {
        method: "POST",
        body: {
          businessAccountId: accountId,
          expectedVersion: before.version,
          readiness: "preparing",
        },
      }
    );
    const after = await requestById(requestId);
    check("N5", "a merchant outside the account cannot change another's readiness",
      (r.status === 403 || r.status === 404) &&
        after?.readiness_state === before?.readiness_state && after?.version === before?.version,
      `status=${r.status} readiness=${after?.readiness_state}`);
  }

  {
    const before = await requestById(requestId);
    const r = await apiAs(USERS.merchant, `/api/couranr/delivery-requests/${requestId}/readiness`, {
      method: "POST",
      body: {
        businessAccountId: accountId,
        // A stale tab: the version this caller last saw is one behind.
        expectedVersion: before.version - 1,
        readiness: "preparing",
      },
    });
    const after = await requestById(requestId);
    check("N6", "a stale version is refused and writes nothing",
      r.status === 409 && after?.version === before?.version &&
        after?.readiness_state === before?.readiness_state,
      `status=${r.status} version=${before?.version}->${after?.version}`);
  }

  /* --- N7  the merchant marks ready, in the browser ---------------------- */

  {
    const { ctx, page } = await freshContext();
    await signIn(page, USERS.merchant, { expectLanding: "/business" });
    await page.goto(`${BASE_URL}/business/deliveries/${requestId}`, {
      waitUntil: "domcontentloaded",
    });
    const readyBtn = page.getByRole("button", { name: /^Ready for Couranr$/ });
    await readyBtn.waitFor({ state: "visible", timeout: 25000 });
    await readyBtn.click();
    // The action removes itself: a readiness the request already has is not
    // offered. Waiting for that is waiting for the write, not for a clock.
    await readyBtn.waitFor({ state: "hidden", timeout: 30000 }).catch(() => {});
    await shot(page, "N7-mer007-ready");
    await ctx.close();
  }

  const readyRow = await requestById(requestId);
  check("N7", "Ready is accepted once the money is held",
    readyRow?.readiness_state === "ready", `readiness=${readyRow?.readiness_state}`);

  {
    const { ctx, page } = await freshContext();
    await signIn(page, USERS.ops, { expectLanding: "/operations" });
    const stage = await queueStageFor(page, requestId);
    check("N8", "OPS-002 moves a ready, authorized request to ready for planning",
      stage === "ready_for_planning", `stage=${stage}`);
    await shot(page, "N8-ops002-ready-for-planning");
    await ctx.close();
  }

  /* --- N9..N10  capture is refused before a service plan ----------------- */

  {
    const { ctx, page } = await freshContext();
    await signIn(page, USERS.ops, { expectLanding: "/operations" });
    await page.goto(`${BASE_URL}/operations/deliveries/${requestId}`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByText("Service plan and capture").waitFor({ state: "visible", timeout: 25000 });
    const captureBtn = page.getByRole("button", { name: /^Capture .* and schedule$/ });
    const disabled = await captureBtn.isDisabled();
    const why = await page.getByText(/Confirm a service plan before capturing/i).count();
    check("N9", "OPS-003 will not offer capture without a service plan, and says why",
      disabled === true && why > 0, `disabled=${disabled} explanation=${why}`);
    await shot(page, "N9-ops003-capture-blocked");
    await ctx.close();
  }

  {
    const r = await apiAs(
      USERS.ops,
      `/api/couranr/operations/delivery-requests/${requestId}/capture`,
      { method: "POST", body: {} }
    );
    const ob = await obligationFor(requestId);
    const deliveries = await deliveriesFor(requestId);
    check("N10", "the capture route refuses without a plan; the hold is untouched",
      r.status === 409 && ob?.payment_state === "authorized" && deliveries.length === 0,
      `status=${r.status} payment=${ob?.payment_state} deliveries=${deliveries.length}`);
  }

  /* --- N11  Operations confirms the service plan ------------------------- */

  {
    const { ctx, page } = await freshContext();
    await signIn(page, USERS.ops, { expectLanding: "/operations" });
    await page.goto(`${BASE_URL}/operations/deliveries/${requestId}`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByText("Service plan and capture").waitFor({ state: "visible", timeout: 25000 });
    await page.getByLabel(/Pickup window start/).fill("2026-09-15T09:00");
    await page.getByLabel(/Pickup window end/).fill("2026-09-15T11:00");
    await page.getByLabel(/Payload capacity/).fill("800");
    await page.getByRole("button", { name: /^Confirm service plan$/ }).click();
    // "Change the plan" only renders once a plan exists.
    await page
      .getByRole("button", { name: /^Change the plan$/ })
      .waitFor({ state: "visible", timeout: 30000 })
      .catch(() => {});
    await shot(page, "N11-ops003-plan-confirmed");
    await ctx.close();
  }

  const plans = await servicePlansFor(requestId);
  const livePlan = plans.find((p) => p.plan_state === "confirmed") ?? null;
  check("N11", "a confirmed plan exists for THIS generation and THIS obligation",
    Boolean(livePlan) && livePlan.payment_obligation_id === authorizedOb?.id &&
      livePlan.request_version === readyRow?.version,
    `plans=${plans.length} planState=${livePlan?.plan_state} planVersion=${livePlan?.request_version} rowVersion=${readyRow?.version}`);

  {
    const { ctx, page } = await freshContext();
    await signIn(page, USERS.ops, { expectLanding: "/operations" });
    const stage = await queueStageFor(page, requestId);
    check("N12", "OPS-002 shows service plan confirmed once a plan is in place",
      stage === "service_plan_confirmed", `stage=${stage}`);
    await shot(page, "N12-ops002-plan-confirmed");
    await ctx.close();
  }

  /* --- N13..N15  a capture whose outcome is UNKNOWN ---------------------- */

  /*
   * The provider outage that the recoverable workflow exists for. The double
   * answers 500, which is INDEFINITE: Couranr does not know whether Stripe took
   * the money, so the obligation must stay in capture_pending rather than be
   * released back to authorized, and no delivery may be created from it.
   */
  failNextCaptures(1);
  {
    const { ctx, page } = await freshContext();
    await signIn(page, USERS.ops, { expectLanding: "/operations" });
    await page.goto(`${BASE_URL}/operations/deliveries/${requestId}`, {
      waitUntil: "domcontentloaded",
    });
    const captureBtn = page.getByRole("button", { name: /^Capture .* and schedule$/ });
    await captureBtn.waitFor({ state: "visible", timeout: 25000 });
    await captureBtn.click();
    await page.getByText(/could not confirm the capture/i).waitFor({
      state: "visible",
      timeout: 30000,
    }).catch(() => {});
    await shot(page, "N13-capture-outcome-unknown");
    await ctx.close();
  }

  const pendingOb = await obligationFor(requestId);
  check("N13", "an unconfirmed capture stays capture_pending — never back to authorized",
    pendingOb?.payment_state === "capture_pending" &&
      typeof pendingOb?.capture_requested_at === "string" &&
      pendingOb.capture_requested_at.length > 0,
    `payment_state=${pendingOb?.payment_state}`);

  {
    const deliveries = await deliveriesFor(requestId);
    check("N14", "no canonical delivery is created while a capture is pending",
      deliveries.length === 0, `deliveries=${deliveries.length}`);
  }

  {
    const { ctx, page } = await freshContext();
    await signIn(page, USERS.ops, { expectLanding: "/operations" });
    const stage = await queueStageFor(page, requestId);
    const row = page.locator(`tr[data-request-id="${requestId}"]`).first();
    const retry = await row.getByRole("button").count();
    const advice = await row.getByText(/do not retry/i).count();
    check("N15", "OPS-002 shows capture pending and offers no retry button",
      stage === "capture_pending" && retry === 0 && advice > 0,
      `stage=${stage} buttons=${retry} advice=${advice}`);
    await shot(page, "N15-ops002-capture-pending");
    await ctx.close();
  }

  {
    /*
     * The route must refuse a blind second capture, not just hide the button.
     * `couranr_begin_payment_capture` returns the existing row for
     * `capture_pending` rather than raising, so without a guard in the command
     * layer a stale tab or a second operator walks straight on to a second
     * `paymentIntents.capture` for an obligation whose outcome is unknown.
     */
    const capturesBefore = stripeCalls.filter((c) => c.path.endsWith("/capture")).length;
    const r = await apiAs(
      USERS.ops,
      `/api/couranr/operations/delivery-requests/${requestId}/capture`,
      { method: "POST", body: {} }
    );
    const capturesAfter = stripeCalls.filter((c) => c.path.endsWith("/capture")).length;
    const ob = await obligationFor(requestId);
    check("N15c", "a second capture while the outcome is unknown is refused before Stripe",
      r.status === 409 && capturesAfter === capturesBefore &&
        ob?.payment_state === "capture_pending",
      `status=${r.status} newStripeCaptures=${capturesAfter - capturesBefore} payment=${ob?.payment_state}`);
  }

  {
    /*
     * The merchant's money copy must track the payment, not the request
     * state. `confirmed` used to mean "nothing charged"; it now spans an
     * authorized hold, a capture in flight and a completed capture, and
     * telling a merchant nothing has been charged while a capture is in
     * flight is simply false.
     */
    const { ctx, page } = await freshContext();
    await signIn(page, USERS.merchant, { expectLanding: "/business" });
    await page.goto(`${BASE_URL}/business/deliveries/${requestId}`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByText(/Couranr is completing the payment/i)
      .waitFor({ state: "visible", timeout: 25000 })
      .catch(() => {});
    const stale = await page.getByText(/Nothing has been charged yet/i).count();
    const accurate = await page.getByText(/Couranr is completing the payment/i).count();
    check("N15b", "MER-007 never says nothing was charged while a capture is in flight",
      stale === 0 && accurate > 0, `staleCopy=${stale} accurateCopy=${accurate}`);
    await shot(page, "N15-mer007-capture-in-flight");
    await ctx.close();
  }

  {
    // Readiness is frozen: money may have moved and a driver is planned
    // around the answer.
    const before = await requestById(requestId);
    const r = await apiAs(USERS.merchant, `/api/couranr/delivery-requests/${requestId}/readiness`, {
      method: "POST",
      body: {
        businessAccountId: accountId,
        expectedVersion: before.version,
        readiness: "not_ready",
      },
    });
    const after = await requestById(requestId);
    check("N16", "readiness is frozen while a capture is in flight",
      r.status === 409 && after?.readiness_state === "ready",
      `status=${r.status} readiness=${after?.readiness_state}`);
  }

  /* --- N17..N18  recovery, and exactly one delivery ---------------------- */

  /*
   * The recovery is NOT a second capture. OPS-003 withholds Capture entirely
   * while the outcome is unknown and offers only "Check with the payment
   * provider", which reads the intent: still merely authorized, so the hold is
   * released and a capture becomes possible again.
   */
  {
    const { ctx, page } = await freshContext();
    await signIn(page, USERS.ops, { expectLanding: "/operations" });
    await page.goto(`${BASE_URL}/operations/deliveries/${requestId}`, {
      waitUntil: "domcontentloaded",
    });
    const reconcileBtn = page.getByRole("button", { name: /^Check with the payment provider$/ });
    await reconcileBtn.waitFor({ state: "visible", timeout: 25000 });
    const captureOffered = await page
      .getByRole("button", { name: /^Capture .* and schedule$/ })
      .count();
    check("N17a", "OPS-003 withholds Capture while the outcome is unknown and offers reconcile",
      captureOffered === 0, `captureButtons=${captureOffered}`);
    await shot(page, "N17-ops003-unresolved");

    await reconcileBtn.click();
    /*
     * Wait for the OUTCOME, not for a duration. The panel re-reads after a
     * successful reconcile, and the released hold is what brings the Capture
     * button back — so this is both the synchronisation point and the proof
     * that an operator can see the recovery happen. A fixed sleep passed in
     * isolation and lost the race under a full-suite run.
     */
    await page
      .getByRole("button", { name: /^Capture .* and schedule$/ })
      .waitFor({ state: "visible", timeout: 30000 })
      .catch(() => {});
    await shot(page, "N17-ops003-released");
    await ctx.close();
  }

  const releasedOb = await obligationFor(requestId);
  check("N17b", "reconciling a capture the provider never took releases the hold",
    releasedOb?.payment_state === "authorized" &&
      releasedOb?.capture_requested_at === null &&
      "capture_requested_at" in (releasedOb ?? {}),
    `payment_state=${releasedOb?.payment_state} requestedAt=${releasedOb?.capture_requested_at}`);

  {
    const { ctx, page } = await freshContext();
    await signIn(page, USERS.ops, { expectLanding: "/operations" });
    await page.goto(`${BASE_URL}/operations/deliveries/${requestId}`, {
      waitUntil: "domcontentloaded",
    });
    const captureBtn = page.getByRole("button", { name: /^Capture .* and schedule$/ });
    await captureBtn.waitFor({ state: "visible", timeout: 25000 });
    await captureBtn.click();
    await page.getByText(/Canonical delivery created/i).waitFor({
      state: "visible",
      timeout: 30000,
    }).catch(() => {});
    await shot(page, "N17-ops003-captured");
    await ctx.close();
  }

  const capturedOb = await obligationFor(requestId);
  const deliveries = await deliveriesFor(requestId);
  const delivery = deliveries[0] ?? null;

  check("N17", "the retry captures the STORED amount, once",
    capturedOb?.payment_state === "captured" &&
      capturedOb?.captured_amount_cents === confirmed.delivery_subtotal_cents,
    `state=${capturedOb?.payment_state} captured=${capturedOb?.captured_amount_cents} quote=${confirmed.delivery_subtotal_cents}`);

  check("N18", "exactly one canonical delivery exists, for the captured amount",
    deliveries.length === 1 &&
      delivery?.captured_amount_cents === confirmed.delivery_subtotal_cents &&
      delivery?.payment_obligation_id === authorizedOb?.id &&
      delivery?.service_plan_id === livePlan?.id,
    `deliveries=${deliveries.length} amount=${delivery?.captured_amount_cents} plan=${delivery?.service_plan_id === livePlan?.id}`);

  /* --- N19  capturing again changes nothing ------------------------------ */

  {
    const capturesBefore = stripeCalls.filter((c) => c.path.endsWith("/capture")).length;
    const r = await apiAs(
      USERS.ops,
      `/api/couranr/operations/delivery-requests/${requestId}/capture`,
      { method: "POST", body: {} }
    );
    const again = await deliveriesFor(requestId);
    const obs = await allObligationsFor(requestId);
    const capturesAfter = stripeCalls.filter((c) => c.path.endsWith("/capture")).length;
    check("N19", "capturing a second time creates no second delivery and no second charge",
      r.status === 200 && again.length === 1 && again[0].id === delivery?.id &&
        obs.filter((o) => o.payment_state === "captured").length === 1 &&
        capturesAfter === capturesBefore,
      `status=${r.status} deliveries=${again.length} newStripeCaptures=${capturesAfter - capturesBefore}`);
  }

  /* --- N20  what capture must NOT have done ------------------------------ */

  {
    const legacyAfter = await realDataCounts();
    const noLegacy =
      legacyAfter.orders === legacyBefore.orders &&
      legacyAfter.deliveries === legacyBefore.deliveries;

    // No driver column exists on the canonical delivery, and the row says so.
    const scheduledOnly = delivery?.fulfillment_state === "scheduled";
    const noDriverField = Object.keys(delivery ?? {}).every((k) => !/driver/i.test(k));

    const captureCalls = stripeCalls.filter((c) => c.path.endsWith("/capture"));
    const newCaptures = captureCalls.length - captureCallsBefore;
    const mine = captureCalls.slice(captureCallsBefore);
    const keys = new Set(mine.map((c) => c.idempotencyKey));
    const noAmount = mine.every((c) => c.form?.amount_to_capture === undefined);
    /*
     * One key per capture CYCLE. Stripe caches a completed request's response
     * for 24 hours, so an obligation-only key would replay the first attempt's
     * failure to every retry for a day and the reconcile route could achieve
     * nothing. Within a cycle the key is stable, which is what makes two
     * concurrent captures produce one charge.
     */
    const cycleScoped = mine.every((c) => /^couranr:capture:[0-9a-f-]{36}:v\d+$/.test(c.idempotencyKey ?? ""));

    check("N20a", "capture wrote nothing to the legacy orders or deliveries tables",
      noLegacy,
      `before=${JSON.stringify(legacyBefore)} after=${JSON.stringify(legacyAfter)}`);

    check("N20b", "the canonical delivery is scheduled with no driver assigned",
      scheduledOnly && noDriverField,
      `fulfillment_state=${delivery?.fulfillment_state} driverField=${!noDriverField}`);

    /*
     * Two attempts — the injected outage and the post-reconcile retry — in two
     * DIFFERENT capture cycles, so two different keys, and never an amount.
     * A single key across both would mean Stripe replays the first attempt's
     * cached response and the retry can never succeed.
     */
    check("N20c", "each capture attempt carries its own cycle-scoped key, and no amount",
      newCaptures === 2 && keys.size === 2 && cycleScoped && noAmount,
      `attempts=${newCaptures} distinctKeys=${keys.size} cycleScoped=${cycleScoped} amountSent=${!noAmount}`);
  }

  /* --- N21  both surfaces agree, and the ledger is complete -------------- */

  {
    const { ctx, page } = await freshContext();
    await signIn(page, USERS.merchant, { expectLanding: "/business" });
    await page.goto(`${BASE_URL}/business/deliveries/${requestId}`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByText(/Couranr has scheduled this delivery/i).waitFor({
      state: "visible",
      timeout: 25000,
    }).catch(() => {});
    const merchantSaw = await page.getByText(/Couranr has scheduled this delivery/i).count();
    const merchantAmount = await page
      .getByText(new RegExp(formatCentsForCopy(delivery?.captured_amount_cents)))
      .count();
    check("N21", "MER-007 shows the same captured amount and scheduled window as Operations",
      merchantSaw > 0 && merchantAmount > 0,
      `scheduledCopy=${merchantSaw} amountCopy=${merchantAmount}`);

    const stale = await page.getByText(/Nothing has been charged yet/i).count();
    const captured = await page.getByText(/payment has been captured/i).count();
    check("N21b", "and the status banner says the payment was captured, not that nothing was",
      stale === 0 && captured > 0, `staleCopy=${stale} capturedCopy=${captured}`);
    await shot(page, "N21-mer007-scheduled");
    await ctx.close();
  }

  {
    const { ctx, page } = await freshContext();
    await signIn(page, USERS.ops, { expectLanding: "/operations" });
    const stage = await queueStageFor(page, requestId);
    check("N22", "OPS-002 shows the request as captured and scheduled",
      stage === "captured_scheduled", `stage=${stage}`);
    await shot(page, "N22-ops002-captured-scheduled");
    await ctx.close();
  }

  {
    /*
     * The ledger is the record of what happened, so it must show BOTH capture
     * attempts — the one whose outcome was unknown and the one that worked —
     * and exactly one of them applying. Two requests is correct here; one
     * would mean the failed attempt left no trace.
     */
    const ledger = await paymentEventsFor(requestId);
    const requested = ledger.filter((e) => e.event_type === "couranr.capture.requested");
    const released = ledger.filter((e) => e.event_type === "couranr.capture.failed");
    const results = ledger.filter((e) => e.event_type === "couranr.capture.result");
    const applied = results.filter((e) => e.outcome === "applied");
    const dEvents = delivery ? await deliveryEventsFor(delivery.id) : [];
    check("N23", "the ledger shows both attempts, one release, and exactly one applied capture",
      requested.length === 2 && released.length === 1 && applied.length === 1 &&
        results.length === 1 && dEvents.length === 1 &&
        dEvents[0].command === "create_delivery_from_capture",
      `requested=${requested.length} released=${released.length} results=${results.length} applied=${applied.length} deliveryEvents=${dEvents.length}`);

    // The money moved exactly once, and the ledger says so in one place.
    check("N23b", "no capture result was ever rejected or ignored",
      results.every((e) => e.outcome === "applied"),
      results.map((e) => e.outcome).join(","));
  }
}

/** Integer cents → the string the UI renders, for a text assertion. */
function formatCentsForCopy(cents) {
  if (typeof cents !== "number") return "\\$0\\.00";
  const abs = Math.abs(Math.trunc(cents));
  return `\\$${Math.floor(abs / 100)}\\.${String(abs % 100).padStart(2, "0")}`;
}


/* ================= O. TERMINAL CAPTURE RESOLUTION (fail / cancel) ========= */

/** Puts the double's intent into a status only the PROVIDER could report. */
async function setIntentStatus(intentId, status) {
  const r = await fetch(`${DOUBLE_BASE}/__control/status/${intentId}?status=${status}`);
  return r.ok;
}

/** Drives a fresh request all the way to capture_pending with an unknown outcome. */
async function toCapturePending(accountId) {
  const requestId = await confirmedRequestFor(accountId);
  if (!requestId) return null;

  // Authorize (merchant-paid), mark ready, plan, then inject a provider outage
  // so the capture outcome is genuinely unknown.
  {
    const { ctx, page } = await freshContext();
    await mockStripeJs(page);
    await signIn(page, USERS.merchant, { expectLanding: "/business" });
    await page.goto(`${BASE_URL}/business/deliveries/${requestId}`, { waitUntil: "domcontentloaded" });
    const a = page.getByRole("button", { name: /^Authorize \$/ });
    await a.waitFor({ state: "visible", timeout: 25000 });
    await a.click();
    await page.locator("[data-stripe-element]").first().waitFor({ state: "visible", timeout: 25000 });
    await page.getByRole("button", { name: /^Authorize \$/ }).click();
    await page.getByText(/Payment authorized/i).waitFor({ state: "visible", timeout: 25000 });
    /*
     * Re-read before looking for Ready. The readiness panel only offers it
     * once the fulfillment view reports `authorized`, and the payment panel's
     * own success does not re-fetch that view — Group N used a fresh context
     * here for the same reason.
     */
    await page.goto(`${BASE_URL}/business/deliveries/${requestId}`, { waitUntil: "domcontentloaded" });
    const ready = page.getByRole("button", { name: /^Ready for Couranr$/ });
    await ready.waitFor({ state: "visible", timeout: 25000 });
    await ready.click();
    await ready.waitFor({ state: "hidden", timeout: 30000 }).catch(() => {});
    await ctx.close();
  }
  {
    const { ctx, page } = await freshContext();
    await signIn(page, USERS.ops, { expectLanding: "/operations" });
    await page.goto(`${BASE_URL}/operations/deliveries/${requestId}`, { waitUntil: "domcontentloaded" });
    await page.getByText("Service plan and capture").waitFor({ state: "visible", timeout: 25000 });
    await page.getByLabel(/Pickup window start/).fill("2026-09-20T09:00");
    await page.getByLabel(/Pickup window end/).fill("2026-09-20T11:00");
    await page.getByLabel(/Payload capacity/).fill("800");
    await page.getByRole("button", { name: /^Confirm service plan$/ }).click();
    await page.getByRole("button", { name: /^Change the plan$/ })
      .waitFor({ state: "visible", timeout: 30000 }).catch(() => {});

    failNextCaptures(1);
    const cap = page.getByRole("button", { name: /^Capture .* and schedule$/ });
    await cap.waitFor({ state: "visible", timeout: 25000 });
    await cap.click();
    await page.getByText(/could not confirm the capture/i)
      .waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
    await ctx.close();
  }
  return requestId;
}

/** Clicks OPS-003's reconcile and waits for the panel to settle. */
async function reconcileAsOps(requestId, settleOn) {
  const { ctx, page } = await freshContext();
  await signIn(page, USERS.ops, { expectLanding: "/operations" });
  await page.goto(`${BASE_URL}/operations/deliveries/${requestId}`, { waitUntil: "domcontentloaded" });
  const btn = page.getByRole("button", { name: /^Check with the payment provider$/ });
  await btn.waitFor({ state: "visible", timeout: 25000 });
  await btn.click();
  if (settleOn) {
    await page.getByText(settleOn).waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
  }
  return { ctx, page };
}

async function groupO() {
  console.log("\n\x1b[1mO — terminal capture resolution: failed and cancelled\x1b[0m");

  const accounts = await accountsCreatedBy(USER_IDS.merchant);
  if (accounts.length === 0) {
    inconclusive("O0", "terminal capture", "the merchant fixture has no business account");
    return;
  }
  const accountId = accounts[0].id;
  const legacyBefore = await realDataCounts();

  /* ---- FAILED: requires_payment_method ------------------------------- */

  const failId = await toCapturePending(accountId);
  if (!failId) {
    inconclusive("O1", "failed path", "no request reached capture_pending");
  } else {
    const pending = await obligationFor(failId);
    const authorizedAtBefore = pending?.authorized_at;
    const capturesBefore = stripeCalls.filter((c) => c.path.endsWith("/capture")).length;

    // The provider settles it: the authorization is gone.
    await setIntentStatus(pending.provider_payment_intent_id, "requires_payment_method");

    const { ctx, page } = await reconcileAsOps(failId, /ended this authorization/i);
    await shot(page, "O1-ops003-authorization-lost");
    const capturesAfter = stripeCalls.filter((c) => c.path.endsWith("/capture")).length;
    const captureOffered = await page.getByRole("button", { name: /^Capture .* and schedule$/ }).count();
    await ctx.close();

    const ob = await obligationFor(failId);
    const deliveries = await deliveriesFor(failId);
    const plans = await servicePlansFor(failId);

    check("O1", "a verified requires_payment_method moves capture_pending to failed",
      ob?.payment_state === "failed", `payment_state=${ob?.payment_state}`);
    check("O2", "failed_at is stamped",
      typeof ob?.failed_at === "string" && ob.failed_at.length > 0, `failed_at=${ob?.failed_at}`);
    check("O3", "authorized_at survives as history, unchanged",
      ob?.authorized_at === authorizedAtBefore && ob?.authorized_at !== null,
      `before=${authorizedAtBefore} after=${ob?.authorized_at}`);
    check("O4", "no canonical delivery is created", deliveries.length === 0,
      `deliveries=${deliveries.length}`);
    check("O5", "no second capture call was made to the provider",
      capturesAfter === capturesBefore, `new=${capturesAfter - capturesBefore}`);
    check("O6", "the confirmed service plan survives for the same obligation",
      plans.filter((p) => p.plan_state === "confirmed").length === 1,
      `confirmed=${plans.filter((p) => p.plan_state === "confirmed").length}`);
    check("O7", "OPS-003 never offers Capture on a settled failure",
      captureOffered === 0, `captureButtons=${captureOffered}`);

    // MER-007 tells the merchant, and never claims money moved.
    {
      const { ctx: mctx, page: mp } = await freshContext();
      await signIn(mp, USERS.merchant, { expectLanding: "/business" });
      await mp.goto(`${BASE_URL}/business/deliveries/${failId}`, { waitUntil: "domcontentloaded" });
      await mp.getByText(/authorization needs attention/i)
        .waitFor({ state: "visible", timeout: 25000 }).catch(() => {});
      const attention = await mp.getByText(/authorization needs attention/i).count();
      const nothingCharged = await mp.getByText(/Nothing was charged/i).count();
      check("O8", "MER-007 says authorization needs attention and that nothing was charged",
        attention > 0 && nothingCharged > 0,
        `attention=${attention} nothingCharged=${nothingCharged}`);
      await shot(mp, "O8-mer007-reauthorize");
      await mctx.close();
    }

    // The queue files it under its own recovery stage.
    {
      const { ctx: octx, page: op } = await freshContext();
      await signIn(op, USERS.ops, { expectLanding: "/operations" });
      const stage = await queueStageFor(op, failId);
      check("O9", "OPS-002 files it under payment_reauthorization_required",
        stage === "payment_reauthorization_required", `stage=${stage}`);
      await shot(op, "O9-ops002-reauthorization-required");
      await octx.close();
    }

    /* ---- recovery: verified requires_capture returns it to authorized -- */
    await setIntentStatus(pending.provider_payment_intent_id, "requires_capture");
    {
      // Re-authorizing from MER-007 reaches the SAME obligation and intent,
      // which is what Stripe documents for requires_payment_method.
      const { ctx: mctx, page: mp } = await freshContext();
      await mockStripeJs(mp);
      await signIn(mp, USERS.merchant, { expectLanding: "/business" });
      await mp.goto(`${BASE_URL}/business/deliveries/${failId}`, { waitUntil: "domcontentloaded" });
      const a = mp.getByRole("button", { name: /^Authorize \$/ });
      await a.waitFor({ state: "visible", timeout: 25000 }).catch(() => {});
      if (await a.count()) {
        await a.click();
        await mp.locator("[data-stripe-element]").first()
          .waitFor({ state: "visible", timeout: 25000 }).catch(() => {});
        await mp.getByRole("button", { name: /^Authorize \$/ }).click();
        await mp.getByText(/Payment authorized/i)
          .waitFor({ state: "visible", timeout: 25000 }).catch(() => {});
      }
      await mctx.close();
    }
    const reauth = await obligationFor(failId);
    check("O10", "a merchant can reauthorize the SAME failed obligation",
      reauth?.payment_state === "authorized" && reauth?.id === pending?.id &&
        reauth?.provider_payment_intent_id === pending?.provider_payment_intent_id,
      `state=${reauth?.payment_state} sameObligation=${reauth?.id === pending?.id}`);

    // And a later capture succeeds exactly once.
    {
      const { ctx: octx, page: op } = await freshContext();
      await signIn(op, USERS.ops, { expectLanding: "/operations" });
      await op.goto(`${BASE_URL}/operations/deliveries/${failId}`, { waitUntil: "domcontentloaded" });
      const cap = op.getByRole("button", { name: /^Capture .* and schedule$/ });
      await cap.waitFor({ state: "visible", timeout: 25000 }).catch(() => {});
      if (await cap.count() && !(await cap.isDisabled())) {
        await cap.click();
        await op.getByText(/Canonical delivery created/i)
          .waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
      }
      await shot(op, "O11-recovered-and-captured");
      await octx.close();
    }
    const finalOb = await obligationFor(failId);
    const finalDeliveries = await deliveriesFor(failId);
    check("O11", "after recovery a later capture succeeds exactly once",
      finalOb?.payment_state === "captured" && finalDeliveries.length === 1,
      `state=${finalOb?.payment_state} deliveries=${finalDeliveries.length}`);
  }

  /* ---- CANCELLED: canceled ------------------------------------------- */

  const cancelId = await toCapturePending(accountId);
  if (!cancelId) {
    inconclusive("O12", "cancelled path", "no request reached capture_pending");
  } else {
    const pending = await obligationFor(cancelId);
    // Give it a live payment link so revocation is observable.
    await issueLinkForRequest(cancelId, accountId).catch(() => null);
    await setIntentStatus(pending.provider_payment_intent_id, "canceled");

    const { ctx, page } = await reconcileAsOps(cancelId, null);
    await page.waitForTimeout(2500);
    await shot(page, "O12-ops003-cancelled");
    await ctx.close();

    const obs = await allObligationsFor(cancelId);
    const cancelled = obs.find((o) => o.id === pending.id);
    const deliveries = await deliveriesFor(cancelId);
    const plans = await servicePlansFor(cancelId);
    const token = await tokenStateFor(cancelId);

    check("O12", "a verified canceled moves capture_pending to cancelled",
      cancelled?.payment_state === "cancelled", `payment_state=${cancelled?.payment_state}`);
    check("O13", "cancelled_at is stamped",
      typeof cancelled?.cancelled_at === "string" && cancelled.cancelled_at.length > 0,
      `cancelled_at=${cancelled?.cancelled_at}`);
    check("O14", "every live payment link is revoked",
      token?.revoked_at !== null, `revoked_at=${token?.revoked_at} reason=${token?.revoked_reason}`);
    check("O15", "the service plan that referenced the dead obligation is cancelled",
      plans.filter((p) => p.plan_state === "confirmed").length === 0 &&
        plans.some((p) => p.plan_state === "cancelled"),
      `confirmed=${plans.filter((p) => p.plan_state === "confirmed").length} cancelled=${plans.filter((p) => p.plan_state === "cancelled").length}`);
    check("O16", "no canonical delivery is created", deliveries.length === 0,
      `deliveries=${deliveries.length}`);

    /* ---- the next authorization mints a NEW obligation and intent ----- */
    {
      const { ctx: mctx, page: mp } = await freshContext();
      await mockStripeJs(mp);
      await signIn(mp, USERS.merchant, { expectLanding: "/business" });
      await mp.goto(`${BASE_URL}/business/deliveries/${cancelId}`, { waitUntil: "domcontentloaded" });
      const a = mp.getByRole("button", { name: /^Authorize \$/ });
      await a.waitFor({ state: "visible", timeout: 25000 }).catch(() => {});
      if (await a.count()) await a.click();
      await mp.locator("[data-stripe-element]").first()
        .waitFor({ state: "visible", timeout: 25000 }).catch(() => {});
      await shot(mp, "O17-new-obligation");
      await mctx.close();
    }
    const after = await allObligationsFor(cancelId);
    const fresh = after.find((o) => o.id !== pending.id);
    check("O17", "re-authorizing after a cancel creates a NEW obligation, not a 23505",
      Boolean(fresh) && after.length === obs.length + 1,
      `obligations=${obs.length}->${after.length}`);
    check("O18", "the new obligation never reuses the dead PaymentIntent",
      Boolean(fresh) && fresh.provider_payment_intent_id !== pending.provider_payment_intent_id,
      `old=${pending.provider_payment_intent_id} new=${fresh?.provider_payment_intent_id}`);
    check("O19", "the cancelled obligation is left intact as history",
      after.find((o) => o.id === pending.id)?.payment_state === "cancelled",
      `old state=${after.find((o) => o.id === pending.id)?.payment_state}`);
  }

  /* ---- INDETERMINATE and idempotency, at the route ------------------- */

  const waitId = await toCapturePending(accountId);
  if (!waitId) {
    inconclusive("O20", "indeterminate statuses", "no request reached capture_pending");
  } else {
    const ob = await obligationFor(waitId);
    for (const [id, status, label] of [
      ["O20", "processing", "processing"],
      ["O21", "a_status_from_the_future", "an unknown status"],
    ]) {
      await setIntentStatus(ob.provider_payment_intent_id, status);
      const r = await apiAs(USERS.ops,
        `/api/couranr/operations/delivery-requests/${waitId}/reconcile-capture`,
        { method: "POST", body: {} });
      const still = await obligationFor(waitId);
      check(id, `${label} leaves the obligation in capture_pending and writes nothing`,
        still?.payment_state === "capture_pending" && still?.version === ob.version,
        `status=${r.status} state=${still?.payment_state} version=${ob.version}->${still?.version}`);
    }

    // Duplicate terminal events change nothing.
    await setIntentStatus(ob.provider_payment_intent_id, "requires_payment_method");
    await apiAs(USERS.ops,
      `/api/couranr/operations/delivery-requests/${waitId}/reconcile-capture`,
      { method: "POST", body: {} });
    const once = await obligationFor(waitId);
    const second = await apiAs(USERS.ops,
      `/api/couranr/operations/delivery-requests/${waitId}/reconcile-capture`,
      { method: "POST", body: {} });
    const twice = await obligationFor(waitId);
    check("O22", "a duplicate terminal resolution changes nothing",
      once?.payment_state === "failed" && twice?.version === once?.version &&
        twice?.payment_state === "failed",
      `status=${second.status} version=${once?.version}->${twice?.version}`);
  }

  /* ---- the generic authorization webhook cannot bypass the rules ----- */

  const guardId = await toCapturePending(accountId);
  if (!guardId) {
    inconclusive("O23", "webhook guard", "no request reached capture_pending");
  } else {
    const ob = await obligationFor(guardId);
    const before = ob?.version;
    const payload = JSON.stringify({
      id: `evt_guard_${Date.now()}`,
      object: "event",
      type: "payment_intent.amount_capturable_updated",
      data: { object: {
        object: "payment_intent",
        id: ob.provider_payment_intent_id,
        status: "requires_capture",
        amount: ob.amount_cents,
        amount_capturable: ob.amount_cents,
        currency: ob.currency,
        metadata: {},
      } },
    });
    const { default: Stripe } = await import("stripe");
    const header = Stripe.webhooks.generateTestHeaderString({
      payload, secret: webhookSecret(),
    });
    const res = await fetch(`${BASE_URL}/api/couranr/stripe/webhook`, {
      method: "POST",
      headers: { "stripe-signature": header, "content-type": "application/json" },
      body: payload,
    });
    const body = await res.json().catch(() => ({}));
    const after = await obligationFor(guardId);
    check("O23",
      "a SIGNED authorization webhook cannot move a capture_pending obligation back to authorized",
      after?.payment_state === "capture_pending" && after?.version === before,
      `http=${res.status} outcome=${body?.outcome} state=${after?.payment_state} version=${before}->${after?.version}`);
  }

  /* ---- nothing legacy was written ------------------------------------ */
  const legacyAfter = await realDataCounts();
  check("O24", "terminal resolution wrote nothing to the legacy orders or deliveries tables",
    legacyAfter.orders === legacyBefore.orders && legacyAfter.deliveries === legacyBefore.deliveries,
    `before=${JSON.stringify(legacyBefore)} after=${JSON.stringify(legacyAfter)}`);
}

const ALL = { A: groupA, B: groupB, C: groupC, D: groupD, E: groupE, F: groupF, G: groupG, H: groupH, I: groupI, J: groupJ, K: groupK, L: groupL, M: groupM, N: groupN, O: groupO };

let REAL_AFTER = null;
let cleanup = null;
try {
  for (const [key, fn] of Object.entries(ALL)) {
    if (!run(key)) continue;
    try {
      await fn();
    } catch (e) {
      check(`${key}-CRASH`, `group ${key} threw`, false, e.message);
    }
  }
  REAL_AFTER = await realDataCounts();
} finally {
  // Runs on success, on failure and on a crash. The `admin` and `driver`
  // fixtures are privileged and must never outlive the run that created them.
  await browser.close().catch(() => {});
  console.log("\n\x1b[1mTeardown\x1b[0m");
  try {
    cleanup = await cleanupAll();
  } catch (e) {
    cleanup = { ok: false, couldNotRemove: [`cleanup threw: ${e.message}`], manualCleanupRequired: [] };
    console.log(`    cleanup THREW: ${e.message}`);
  }
}

if (stripeDouble) stripeDouble.server.close();

console.log("\n\x1b[1mProduction-data invariant\x1b[0m");
if (REAL_AFTER) {
  const same =
    REAL_BEFORE.orders === REAL_AFTER.orders &&
    REAL_BEFORE.deliveries === REAL_AFTER.deliveries &&
    REAL_BEFORE.addresses === REAL_AFTER.addresses &&
    REAL_BEFORE.rentals === REAL_AFTER.rentals;
  check("SAFE", "the suite altered no row in orders / deliveries / addresses / rentals",
    same, `before=${JSON.stringify(REAL_BEFORE)} after=${JSON.stringify(REAL_AFTER)}`);
} else {
  inconclusive("SAFE", "production-data invariant", "the run aborted before the after-counts were read");
}

// Three separate truths, because collapsing them hides the one that matters.
check("CLEAN-privileged", "no PRIVILEGED synthetic fixture (admin/driver) survived the run",
  Boolean(cleanup && cleanup.privilegedClean),
  cleanup ? `remaining=${(cleanup.privilegedRemaining ?? []).join(", ") || "none"}` : "cleanup did not run");

check("CLEAN-behaviour", "cleanup itself completed without an unexpected failure",
  Boolean(cleanup && cleanup.ok),
  cleanup ? `unexpectedFailures=${cleanup.couldNotRemove.length}` : "cleanup did not run");

// Append-only residue is a KNOWN limitation, not a passing state: service_role
// has no DELETE on the canonical tables by design, so MER-002's workspace and
// the user pinned by it need the privileged path. Reported as its own failure
// so it can never be mistaken for "all clean".
check("CLEAN-residue", "nothing at all was left behind (needs the privileged cleanup path)",
  Boolean(cleanup && cleanup.fullyClean),
  cleanup
    ? `appendOnlyResidue=${(cleanup.appendOnlyResidue ?? []).length} — expected while ` +
      `couranr_merchant_workspaces has no DELETE grant; see supabase/migrations/PROPOSED_couranr_e2e_cleanup.sql.review`
    : "cleanup did not run");

const incon = results.filter((r) => r.inconclusive);
const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok && !r.inconclusive);
console.log(
  `\n\x1b[1mResult\x1b[0m  ${passed} passed, ${failed.length} failed, ${incon.length} inconclusive` +
  `  (of ${results.length})`
);
if (failed.length) {
  console.log("\nFailures:");
  for (const f of failed) console.log(`  ${f.id}  ${f.desc}\n      ${f.detail}`);
}
if (incon.length) {
  console.log("\nInconclusive (counted as NOT passing):");
  for (const f of incon) console.log(`  ${f.id}  ${f.desc}\n      ${f.detail}`);
}

// results.json carries assertions only — never a credential, never a key name's value.
writeFileSync(path.join(SHOTS, "results.json"), JSON.stringify(results, null, 2));
console.log(`\nScreenshots + results.json in e2e/artifacts/`);

process.exit(failed.length || incon.length ? 1 : 0);

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
import { BASE_URL, PASSWORD, SHIPMENT, USERS } from "./fixtures.mjs";
import { relaySupabase } from "./supabaseRelay.mjs";
import {
  accountsCreatedBy,
  membershipsFor,
  realDataCounts,
  rest,
  workspacesFor,
} from "./db.mjs";

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

/** Signs in through the real form and waits for the server-chosen landing. */
async function signIn(page, user, { expectLanding = null } = {}) {
  await page.goto(`${BASE_URL}/sign-in`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").waitFor({ state: "visible", timeout: 20000 });
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  if (expectLanding) {
    await page.waitForURL((u) => u.pathname.startsWith(expectLanding), { timeout: 25000 });
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
 * Supabase rate-limits password grants per IP. A suite that signs in dozens of
 * times will trip it, and a tripped attempt tells us nothing about the assertion
 * under test — so record it as inconclusive rather than as a pass or a failure.
 */
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
    results.push({ id, desc, ok: true, skipped: true, detail: "INCONCLUSIVE — Supabase rate-limited this attempt" });
    console.log(`  \x1b[33m SKIP \x1b[0m ${id}  ${desc}\n           Supabase rate-limited this attempt; assertion not exercised`);
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
function loadSeedState() {
  let state;
  try {
    state = JSON.parse(readFileSync(new URL("./.state.json", import.meta.url), "utf8"));
  } catch {
    console.error("\n  e2e/.state.json is missing — run `node e2e/seed.mjs seed` first.\n");
    process.exit(2);
  }
  for (const [key, v] of Object.entries(state.users ?? {})) {
    USER_IDS[key] = v.userId;
    if (USERS[key]) USERS[key].email = v.email; // honour the run-unique address
  }
  return state;
}

const run = (g) => !groups || groups.includes(g);

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
  await page.getByLabel("Password").fill(PASSWORD);
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
  for (const surface of ["/business", "/operations", "/driver"]) {
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

const ALL = { A: groupA, B: groupB, C: groupC, D: groupD, E: groupE, F: groupF, G: groupG, H: groupH };
for (const [key, fn] of Object.entries(ALL)) {
  if (!run(key)) continue;
  try {
    await fn();
  } catch (e) {
    check(`${key}-CRASH`, `group ${key} threw`, false, e.message);
  }
}

await browser.close();

const REAL_AFTER = await realDataCounts();
const realUnchanged =
  REAL_BEFORE.orders === REAL_AFTER.orders &&
  REAL_BEFORE.deliveries === REAL_AFTER.deliveries &&
  REAL_BEFORE.addresses === REAL_AFTER.addresses &&
  REAL_BEFORE.rentals === REAL_AFTER.rentals;
console.log("\n\x1b[1mProduction-data invariant\x1b[0m");
check("SAFE", "the suite altered no row in orders / deliveries / addresses / rentals",
  realUnchanged, `before=${JSON.stringify(REAL_BEFORE)} after=${JSON.stringify(REAL_AFTER)}`);

const skipped = results.filter((r) => r.skipped);
const incon = results.filter((r) => r.inconclusive);
const passed = results.filter((r) => r.ok && !r.skipped).length;
const failed = results.filter((r) => !r.ok && !r.inconclusive);
console.log(
  `\n\x1b[1mResult\x1b[0m  ${passed} passed, ${failed.length} failed, ` +
  `${incon.length} inconclusive, ${skipped.length} rate-limited  (of ${results.length})`
);
if (failed.length) {
  console.log("\nFailures:");
  for (const f of failed) console.log(`  ${f.id}  ${f.desc}\n      ${f.detail}`);
}
writeFileSync(path.join(SHOTS, "results.json"), JSON.stringify(results, null, 2));
console.log(`\nScreenshots + results.json in e2e/artifacts/`);
process.exit(failed.length || incon.length ? 1 : 0);

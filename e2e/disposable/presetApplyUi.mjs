/**
 * Starting a New Delivery from a saved preset — UNSTUBBED and SIGNED IN.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS RUN PROVES
 * ---------------------------------------------------------------------------
 *
 * `presetsUi.mjs` proves a merchant can BUILD a preset. This proves the thing
 * presets exist for: that one shortens the delivery they send every week — and
 * that it does so without ever deciding anything on their behalf.
 *
 * The promise, end to end, against a real PostgreSQL with every forward
 * migration, a real PostgREST, a real Next server and a real Chromium:
 *
 *   - THE MERCHANT'S OWN WORDS SURVIVE. A handling note typed BEFORE the preset
 *     is applied is still there, character for character, afterwards. This is
 *     the one failure a merchant would actually feel, so it is asserted against
 *     the live input value, not against a message claiming it.
 *   - WHAT HAPPENED IS SAID OUT LOUD. Filled, left alone, and not applied are
 *     three different sentences, and the form must not claim to have filled a
 *     field this form does not have.
 *   - THE BODY COMES FROM THE SERVER, AT APPLY TIME. The preset is edited in
 *     the database behind the browser's back, and the form applies the NEW
 *     value — a tab open for an hour can never apply yesterday's preset.
 *   - AN ARCHIVED PRESET IS REFUSED IN WORDS, and stops being offered. Silence
 *     is the worst answer a button can give.
 *   - TENANCY HOLDS AT THE ROUTE, not in the picker. Another business's preset
 *     id, and a guessed one, are both fetched directly from the signed-in
 *     browser session and both must answer not_found with no body.
 *
 * ---------------------------------------------------------------------------
 * WHY THE DESCRIPTION IS NOT FILLED HERE
 * ---------------------------------------------------------------------------
 *
 * The merchant form has no "what should the driver look for" field — Smart
 * Intake owns the description and pushes it one way. A preset that filled it
 * would be pointing at a box that is not on screen. So this run asserts the
 * OPPOSITE of what a naive build would: that the description is reported as not
 * applied, and that the fields which do have a home are filled anyway.
 *
 * Run:  node e2e/disposable/presetApplyUi.mjs
 *
 * On a developer Mac the cluster paths and Playwright are not where Linux CI
 * keeps them, so point the harness at them:
 *
 *   COURANR_PGBIN=/opt/homebrew/opt/postgresql@17/bin \
 *   COURANR_DISPOSABLE_DIR="$HOME/couranr-disposable" \
 *     node e2e/disposable/presetApplyUi.mjs
 */

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { up, down, psql, dbUrl } from "./up.mjs";
import { startPostgrest, startGateway, waitForPostgrest, SERVICE_ROLE_JWT, ANON_JWT } from "./gateway.mjs";
import { postgrestTarget } from "../../scripts/provisionPostgrest.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SHOTS = path.join(ROOT, "e2e/screenshots/preset-apply");
const DIST = ".next-disposable";
const PGRST_BIN = postgrestTarget();
const DISPOSABLE_DIR = process.env.COURANR_DISPOSABLE_DIR || "/var/lib/postgresql/couranr-disposable";

const PORT = 3321;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "disposable-preset-apply-1";

/**
 * Playwright lives in the image on Linux CI and in the global npm root on a
 * developer machine. Hard-coding the first made this suite unrunnable on the
 * second, which is how a harness quietly becomes "we never run that one".
 */
function playwrightEntry() {
  const candidates = [
    process.env.COURANR_PLAYWRIGHT,
    "/opt/node22/lib/node_modules/playwright/index.mjs",
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      execFileSync("test", ["-f", c]);
      return c;
    } catch {
      /* try the next */
    }
  }
  const root = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
  return path.join(root, "playwright/index.mjs");
}

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
  sql(`insert into public.profiles (id,email,role) values ('${id}','${esc(email)}','customer')`);
  return id;
}

function makeBusiness(label, slug, ownerId, category) {
  const bizId = sql(
    `insert into public.business_accounts (name,slug,status,timezone)
     values ('${esc(label)}','${esc(slug)}','active','America/New_York') returning id`
  );
  sql(
    `insert into public.couranr_merchant_workspaces
       (business_account_id,created_by,idempotency_key,business_category,secondary_categories,
        pickup_address,contact_phone,payer_default,policies_version,policies_accepted_at)
     values ('${bizId}','${ownerId}','pa-${crypto.randomUUID()}',
             '${esc(category)}', array[]::text[],
             '{"line1":"1 Seed St","city":"Stafford","region":"VA","postalCode":"22554"}'::jsonb,
             '540-555-0111','merchant','couranr-policies-2026-07',now())`
  );
  sql(
    `insert into public.business_members (business_account_id,user_id,role,status,joined_at)
     values ('${bizId}','${ownerId}','owner','active',now())`
  );
  return bizId;
}

function makePreset(bizId, ownerId, name, body) {
  return sql(
    // No idempotency_key on this table: a merchant preset is identified by its
    // own id and guarded by optimistic concurrency on `version`.
    `insert into public.couranr_merchant_presets
       (business_account_id,created_by,name,body,version)
     values ('${bizId}','${ownerId}','${esc(name)}',
             '${esc(JSON.stringify(body))}'::jsonb,1)
     returning id`
  );
}

async function main() {
  console.log("Starting a New Delivery from a saved preset — authenticated, unstubbed\n");
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
      workDir: path.join(DISPOSABLE_DIR, "pgrst"),
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
      for (const stale of ["types", path.join("dev", "types")]) {
        rmSync(path.join(ROOT, ".next", stale), { recursive: true, force: true });
      }
      console.log("  building the application against the disposable stack...");
      execFileSync("npx", ["next", "build"], {
        cwd: ROOT,
        env: { ...env, COURANR_DIST_DIR: DIST },
        stdio: "ignore",
        timeout: 1_800_000,
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

    console.log("\n  seeding...");
    const ownerEmail = "e2e-pa-owner@couranr.invalid";
    const owner = makeUser(ownerEmail);
    const bizId = makeBusiness("[PA] Petal & Stem", "pa-petal-stem", owner, "florists_gifts_specialty_retail");

    const presetId = makePreset(bizId, owner, "Weekly florist run", {
      commonItem: "Two dozen roses in a box",
      packageCount: 3,
      handling: "Keep upright",
      proofMethod: "signature",
      payerPreference: "customer",
    });

    // A SECOND business the signed-in merchant has nothing to do with.
    const stranger = makeUser("e2e-pa-stranger@couranr.invalid");
    const otherBiz = makeBusiness("[PA] Someone Else", "pa-someone-else", stranger, "bakeries_prepared_food_catering");
    const otherPresetId = makePreset(otherBiz, stranger, "Not yours", { commonItem: "Wedding cake", packageCount: 1 });

    console.log("  fixtures ready\n");

    /* ─────────────────────────── browser helpers ─────────────────────── */

    const { chromium } = await import(playwrightEntry());
    browser = await chromium.launch({ args: ["--no-proxy-server"] });

    async function signIn(email) {
      const ctx = await browser.newContext();
      contexts.push(ctx);
      const page = await ctx.newPage();
      await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });
      const emailField = fieldLabel(page, "Email");
      await emailField.waitFor({ state: "visible", timeout: 60_000 });
      await emailField.fill(email);
      await fieldLabel(page, "Password").fill(PASSWORD);
      await page.getByRole("button", { name: /^Sign in$/ }).click();
      const until = Date.now() + 60_000;
      while (Date.now() < until) {
        if (!new URL(page.url()).pathname.startsWith("/sign-in")) return page;
        await page.waitForTimeout(250);
      }
      throw new Error(`sign-in for ${email} never left /sign-in`);
    }

    const opener = (page) => page.getByTestId("preset-start-open");
    const apply = (page) => page.getByTestId("preset-start-apply");
    const text = async (page, id) =>
      (await page.getByTestId(id).count()) ? (await page.getByTestId(id).innerText()).trim() : "";

    /* ──────────────────────────── the journey ─────────────────────────── */

    console.log("  A merchant starts a delivery from their weekly preset\n");

    const page = await signIn(ownerEmail);
    const presetCalls = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/couranr/merchant/presets")) presetCalls.push(r.url());
    });

    await page.goto(`${BASE}/app/business/deliveries/new`, { waitUntil: "domcontentloaded" });
    await opener(page).waitFor({ state: "visible", timeout: 60_000 });
    await page.waitForTimeout(1500);

    check("PA-01", "New Delivery offers to start from a saved preset", await opener(page).isVisible());
    check(
      "PA-02",
      "nothing is fetched until the merchant asks — the picker loads on open, not at mount",
      presetCalls.length === 0,
      `${presetCalls.length} call(s)`
    );

    // THE MERCHANT'S OWN WORDS, typed BEFORE the preset is applied.
    const MINE = "Ring the bell twice, do not leave with the neighbour";
    const handling = fieldLabel(page, "Handling note for the driver");
    await handling.fill(MINE);

    await opener(page).click();
    await page.getByTestId("preset-start-select").waitFor({ state: "visible", timeout: 30_000 });
    const optionText = await page.getByTestId("preset-start-select").innerText();
    check("PA-03", "the picker lists the merchant's own preset", /Weekly florist run/.test(optionText));
    check(
      "PA-04",
      "and does not list another business's preset",
      !/Not yours/.test(optionText),
      optionText.replace(/\s+/g, " ").slice(0, 60)
    );

    await page.getByTestId("preset-start-select").selectOption(presetId);
    await apply(page).click();
    await page.getByTestId("preset-start-filled").waitFor({ state: "visible", timeout: 30_000 });

    check(
      "PA-05",
      "THE MERCHANT'S HANDLING NOTE SURVIVES, character for character",
      (await handling.inputValue()) === MINE,
      (await handling.inputValue()).slice(0, 40)
    );
    check(
      "PA-06",
      "the empty package count is filled from the preset",
      (await fieldLabel(page, "Package count").inputValue()) === "3"
    );

    const filled = await text(page, "preset-start-filled");
    const kept = await text(page, "preset-start-kept");
    const notApplied = await text(page, "preset-start-not-applied");

    check("PA-07", "what was filled is named in merchant language", /Package count/i.test(filled), filled);
    check("PA-08", "what the merchant typed is named back as theirs", /Handling note/i.test(kept), kept);
    check(
      "PA-09",
      "no field name leaks into what the merchant reads",
      !/pickup[A-Z]|proofMethod|payerType|body|jsonb/.test(`${filled} ${kept} ${notApplied}`)
    );
    check(
      "PA-10",
      "the form does NOT claim to have filled a description it has no field for",
      !/What to look for/i.test(filled) && /What to look for/i.test(notApplied),
      notApplied
    );
    check(
      "PA-11",
      "a preset never moves who pays — it is reported as not applied, not as something entered",
      /Who pays/i.test(notApplied) && !/Who pays/i.test(kept)
    );

    await page.screenshot({ path: path.join(SHOTS, "01-applied.png"), fullPage: true });

    /* Applying twice is harmless. */
    await apply(page).click();
    await page.waitForTimeout(1200);
    check(
      "PA-12",
      "applying the same preset twice changes nothing and overwrites nothing",
      (await handling.inputValue()) === MINE &&
        (await fieldLabel(page, "Package count").inputValue()) === "3"
    );

    /* FRESHNESS: the preset is edited behind the browser's back. */
    sql(
      `update public.couranr_merchant_presets
          set body = jsonb_set(body,'{packageCount}','7'::jsonb), version = version + 1
        where id = '${presetId}'`
    );
    const page2 = await signIn(ownerEmail);
    await page2.goto(`${BASE}/app/business/deliveries/new`, { waitUntil: "domcontentloaded" });
    await page2.getByTestId("preset-start-open").waitFor({ state: "visible", timeout: 60_000 });
    await page2.getByTestId("preset-start-open").click();
    await page2.getByTestId("preset-start-select").waitFor({ state: "visible", timeout: 30_000 });
    await page2.getByTestId("preset-start-select").selectOption(presetId);
    await page2.getByTestId("preset-start-apply").click();
    await page2.getByTestId("preset-start-filled").waitFor({ state: "visible", timeout: 30_000 });
    check(
      "PA-13",
      "the body applied is the CURRENT one, resolved server-side at apply time",
      (await fieldLabel(page2, "Package count").inputValue()) === "7",
      await fieldLabel(page2, "Package count").inputValue()
    );

    /* AVAILABILITY: archived behind the browser's back. */
    sql(`update public.couranr_merchant_presets set archived_at = now() where id = '${presetId}'`);
    await page2.getByTestId("preset-start-apply").click();
    const refusal = page2.getByText(/archived or removed/i);
    await refusal.waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
    check("PA-14", "an archived preset is refused IN WORDS rather than doing nothing", await refusal.isVisible());
    await page2.waitForTimeout(1500);
    const afterArchive = (await page2.getByTestId("preset-start-select").count())
      ? await page2.getByTestId("preset-start-select").innerText()
      : "";
    check(
      "PA-15",
      "and the dead preset stops being offered",
      !/Weekly florist run/.test(afterArchive),
      afterArchive.replace(/\s+/g, " ").slice(0, 60)
    );
    await page2.screenshot({ path: path.join(SHOTS, "02-archived-refusal.png"), fullPage: true });

    /*
     * TENANCY, asserted against an AUTHENTICATED request made by the app itself.
     *
     * The first version of this section hand-rolled `fetch` from the page. Every
     * canonical route resolves its actor from a Bearer token, a hand-rolled
     * fetch carries none, and so all three "tenancy" assertions passed on a 401
     * that proved only that an ANONYMOUS call is refused — not the question
     * being asked. `client.ts` warns about exactly this, having been caught by
     * it once already. A positive control caught it here.
     *
     * So the request is not hand-rolled at all: the real client makes it, with
     * the real session, through its real code path, and the URL is rewritten in
     * flight. The server therefore sees a genuinely signed-in merchant asking
     * for a preset that is not theirs, which is the actual threat.
     */
    async function attemptRewritten(label, rewrite) {
      const p = await signIn(ownerEmail);
      const fresh = makePreset(bizId, owner, `Control ${label}`, {
        commonItem: "Control box",
        packageCount: 2,
      });
      await p.goto(`${BASE}/app/business/deliveries/new`, { waitUntil: "domcontentloaded" });
      await p.getByTestId("preset-start-open").waitFor({ state: "visible", timeout: 60_000 });
      await p.getByTestId("preset-start-open").click();
      await p.getByTestId("preset-start-select").waitFor({ state: "visible", timeout: 30_000 });
      await p.getByTestId("preset-start-select").selectOption(fresh);

      let status = null;
      let hadAuth = false;
      p.on("response", (res) => {
        const u = new URL(res.url());
        if (u.pathname === "/api/couranr/merchant/presets" && u.searchParams.get("presetId")) {
          status = res.status();
          hadAuth = Boolean(res.request().headers()["authorization"]);
        }
      });
      await p.route("**/api/couranr/merchant/presets*", async (route) => {
        const u = new URL(route.request().url());
        if (!u.searchParams.get("presetId")) return route.continue();
        rewrite(u);
        return route.continue({ url: u.toString() });
      });

      await p.getByTestId("preset-start-apply").click();
      await p.waitForTimeout(3000);
      return { page: p, status, hadAuth, body: await p.locator("main").innerText() };
    }

    // POSITIVE CONTROL: the same machinery, rewriting nothing, must SUCCEED and
    // must carry an Authorization header. Only then do the refusals below mean
    // anything at all.
    const control = await attemptRewritten("ok", () => {});
    check(
      "PA-16",
      "POSITIVE CONTROL — the same request, unrewritten, is authenticated and resolves",
      control.hadAuth && control.status === 200,
      `HTTP ${control.status}, Authorization sent: ${control.hadAuth}`
    );

    const foreign = await attemptRewritten("foreign", (u) => u.searchParams.set("presetId", otherPresetId));
    check(
      "PA-17",
      "another business's preset cannot be applied by a SIGNED-IN merchant asking for it directly",
      foreign.hadAuth && foreign.status >= 400 && !/Wedding cake/.test(foreign.body),
      `HTTP ${foreign.status}, Authorization sent: ${foreign.hadAuth}`
    );

    const guessed = await attemptRewritten("guessed", (u) =>
      u.searchParams.set("presetId", crypto.randomUUID())
    );
    check(
      "PA-18",
      "a guessed preset id answers not_found rather than anything useful",
      guessed.hadAuth && guessed.status >= 400,
      `HTTP ${guessed.status}`
    );

    const acrossTenant = await attemptRewritten("cross-tenant", (u) => {
      u.searchParams.set("businessAccountId", otherBiz);
      u.searchParams.set("presetId", otherPresetId);
    });
    check(
      "PA-19",
      "and naming the OTHER business as the account is refused by the membership gate",
      acrossTenant.hadAuth && acrossTenant.status >= 400 && !/Wedding cake/.test(acrossTenant.body),
      `HTTP ${acrossTenant.status}`
    );

    /* A withdrawn proof method is substituted and said out loud. */
    const withdrawnId = makePreset(bizId, owner, "Old door-drop run", {
      commonItem: "Box",
      packageCount: 1,
      proofMethod: "leave_at_door",
    });
    const page3 = await signIn(ownerEmail);
    await page3.goto(`${BASE}/app/business/deliveries/new`, { waitUntil: "domcontentloaded" });
    await page3.getByTestId("preset-start-open").waitFor({ state: "visible", timeout: 60_000 });
    await page3.getByTestId("preset-start-open").click();
    await page3.getByTestId("preset-start-select").waitFor({ state: "visible", timeout: 30_000 });
    await page3.getByTestId("preset-start-select").selectOption(withdrawnId);
    await page3.getByTestId("preset-start-apply").click();
    await page3.getByTestId("preset-start-filled").waitFor({ state: "visible", timeout: 30_000 });
    const proof = await fieldLabel(page3, "Proof of delivery").inputValue();
    const body3 = await page3.locator("main").innerText();
    check(
      "PA-20",
      "a preset holding a withdrawn proof method is substituted, never carried",
      proof !== "leave_at_door",
      proof
    );
    check(
      "PA-21",
      "and the substitution is said out loud rather than made silently",
      /no longer|not available|withdraw/i.test(body3)
    );
    await page3.screenshot({ path: path.join(SHOTS, "03-withdrawn-proof.png"), fullPage: true });

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

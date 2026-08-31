/**
 * ACP-024 — the category pickers, UNSTUBBED and SIGNED IN.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS RUN PROVES
 * ---------------------------------------------------------------------------
 *
 * Both surfaces that let a merchant choose categories, each asserted in the
 * browser AND against the row it wrote:
 *
 *   MER-002  onboarding — primary plus up to three secondaries, on a workspace
 *            that does not exist yet
 *   MER-014  settings   — loading what is stored, editing it, and the limit
 *
 * And the rules that only a browser can show are actually enforced on a
 * person rather than only in a validator:
 *
 *   - the fourth checkbox is DISABLED at the limit, not silently dropped on
 *     submit
 *   - changing the primary REMOVES a secondary that would collide, so a
 *     merchant never submits a pair the command and a CHECK both refuse
 *   - a viewer cannot edit, and the controls say so by being disabled
 *   - the screen states that a category never limits what a merchant can send
 *
 * The last one is the registry's own constraint — "Category controls initial
 * recommendations, not eligibility" — and it is the reason none of this gates
 * anything.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES NOT PROVE
 * ---------------------------------------------------------------------------
 *
 *  1. The `/auth/v1` issuer is `gateway.mjs`'s reimplementation, not GoTrue.
 *  2. Assertions here describe the DISPOSABLE stack, not production. (Migration
 *     20260806160443 IS applied in production; this caveat used to say the
 *     opposite and a catalog comparison disproved it.)
 *  3. The database half — every refusal called directly, and the CHECKs firing
 *     on a direct UPDATE — is `e2e/disposable/businessCategories.mjs`, 19/19.
 *     This run does not repeat it.
 *
 * Run:  node e2e/disposable/categoriesUi.mjs
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
const SHOTS = path.join(ROOT, "e2e/screenshots/categories");
const DIST = ".next-disposable";
// Resolved by scripts/provisionPostgrest.mjs, never a session scratchpad.
// The previous default was a path inside ONE container's ephemeral
// scratchpad, so this harness aborted on every other machine — after
// applying 50 migrations, which made a missing dependency look like a
// database failure. `npm run provision:postgrest` puts it on PATH.
const PGRST_BIN = postgrestTarget();

const PORT = 3319;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "disposable-categories-1";

let passed = 0;
let failed = 0;

function check(id, description, ok, detail = "") {
  ok ? passed++ : failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${description}${detail ? `  [${detail}]` : ""}`);
}

const sql = (q) => psql(q).trim();
const esc = (s) => String(s).replace(/'/g, "''");
const mainText = (page) => page.locator("main").innerText();

function fieldLabel(scope, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return scope.getByLabel(new RegExp(`^${escaped}(\\s*\\*|\\s*\\(optional\\))?$`));
}

function makeUser(email) {
  const id = sql(`insert into auth.users (email) values ('${esc(email)}') returning id`);
  sql(`select public.couranr_disposable_set_password('${id}', '${esc(PASSWORD)}')`);
  sql(
    `insert into public.profiles (id, email, role)
     values ('${id}', '${esc(email)}', 'customer')`
  );
  return id;
}

/** The stored pair, as `primary|secondary,secondary` plus the version. */
function categoriesOf(businessId) {
  return sql(
    `select business_category || '|' || array_to_string(secondary_categories, ',')
         || '|' || coalesce(category_registry_version, 'NULL')
       from public.couranr_merchant_workspaces where business_account_id = '${businessId}'`
  );
}

async function main() {
  console.log("ACP-024 — category pickers, authenticated, unstubbed\n");
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

    /* ───────────────────────────── fixtures ───────────────────────────── */

    console.log("\n  seeding synthetic identities...");
    const newcomer = {
      id: makeUser("e2e-cat-new@couranr.invalid"),
      email: "e2e-cat-new@couranr.invalid",
    };
    const owner = {
      id: makeUser("e2e-cat-owner@couranr.invalid"),
      email: "e2e-cat-owner@couranr.invalid",
    };
    const viewer = {
      id: makeUser("e2e-cat-viewer@couranr.invalid"),
      email: "e2e-cat-viewer@couranr.invalid",
    };

    // An EXISTING workspace for the settings half, seeded with two secondaries
    // so the screen has something real to load rather than an empty default.
    const bizId = sql(
      `insert into public.business_accounts (name, slug, status, timezone)
       values ('[CAT] existing business', 'cat-existing', 'active', 'America/New_York')
       returning id`
    );
    sql(
      `insert into public.couranr_merchant_workspaces
         (business_account_id, created_by, idempotency_key, business_category,
          secondary_categories, category_registry_version,
          pickup_address, contact_phone, payer_default, policies_version, policies_accepted_at)
       values ('${bizId}', '${owner.id}', 'cat-ws-${crypto.randomUUID()}',
               'florists_gifts_specialty_retail',
               array['printing_signage_promotional','repair_and_electronics'],
               'couranr-categories-2026-08',
               '{"line1":"1 Seed St","city":"Stafford","region":"VA","postalCode":"22554"}'::jsonb,
               '540-555-0199', 'merchant', 'couranr-policies-2026-07', now())`
    );
    for (const [u, r] of [
      [owner.id, "owner"],
      [viewer.id, "viewer"],
    ]) {
      sql(
        `insert into public.business_members (business_account_id, user_id, role, status, joined_at)
         values ('${bizId}', '${u}', '${r}', 'active', now())`
      );
    }
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
      throw new Error(`sign-in for ${email} never left /sign-in`);
    }

    async function open(email, pathname) {
      const page = await signIn(email);
      await page.goto(`${BASE}${pathname}`, { waitUntil: "domcontentloaded" });
      return page;
    }

    /** The checkbox for a category, by its visible label. */
    const box = (page, label) => page.getByRole("checkbox", { name: label });

    /* ══════════════════ MER-002 — onboarding ═══════════════════════════ */

    console.log("MER-002 — choosing categories on a workspace that does not exist yet");
    const onboarding = await open(newcomer.email, "/app/business/onboarding");
    {
      const categorySelect = fieldLabel(onboarding, "Category");
      await categorySelect.waitFor({ state: "visible", timeout: 45_000 });

      // The secondaries are offered only AFTER a primary exists: asking
      // "what else?" before "what?" is a form that reads out of order.
      check("A1", "no secondary options are offered before a primary is chosen",
        (await box(onboarding, "Repair and electronics").count()) === 0);

      await categorySelect.selectOption("florists_gifts_specialty_retail");
      await box(onboarding, "Repair and electronics").waitFor({ state: "visible", timeout: 15_000 });
      check("A2", "choosing a primary reveals the secondary options",
        (await box(onboarding, "Repair and electronics").isVisible()) === true);

      // The chosen primary must not be offered to itself.
      check("A3", "the primary is NOT offered as one of its own secondaries",
        (await box(onboarding, "Florists, gifts, specialty retail").count()) === 0);

      const body = await mainText(onboarding);
      check("A4", "the screen says a category does not limit what can be sent",
        /does not limit what you can send|never limits/i.test(body));

      await box(onboarding, "Repair and electronics").check();
      await box(onboarding, "Printing, signage, promotional products").check();
      await box(onboarding, "Furniture and home goods").check();

      // THE LIMIT, enforced on a person rather than at submit.
      const fourth = box(onboarding, "Books, cards, collectibles, hobby");
      check("A5", "at three, a fourth checkbox is DISABLED rather than silently dropped",
        (await fourth.isDisabled()) === true);
      check("A6", "and the count is shown", /3 of 3 chosen/i.test(await mainText(onboarding)));

      // Changing the primary to a CHOSEN secondary must remove it, not produce
      // a pair the command and a CHECK both refuse.
      await categorySelect.selectOption("repair_and_electronics");
      await onboarding.waitForTimeout(300);
      check("A7", "changing the primary REMOVES the secondary that would collide",
        (await box(onboarding, "Repair and electronics").count()) === 0 &&
          /2 of 3 chosen/i.test(await mainText(onboarding)));

      await onboarding.screenshot({ path: path.join(SHOTS, "MER-002-categories.png"), fullPage: true });

      // Fill the rest and submit.
      await fieldLabel(onboarding, "Business name").fill("[CAT] brand new business");
      await fieldLabel(onboarding, "Contact phone").fill("540-555-0123");
      for (const [label, value] of [
        ["Street address", "9 New St"],
        ["City", "Stafford"],
        ["State", "VA"],
        ["ZIP", "22554"],
      ]) {
        const f = fieldLabel(onboarding, label);
        if ((await f.count()) > 0) await f.first().fill(value);
      }
      const accept = onboarding.getByRole("checkbox", { name: /policies|terms|accept/i });
      if ((await accept.count()) > 0) await accept.first().check();

      await onboarding.getByRole("button", { name: /Create|Continue|Set up/i }).first().click();
      await onboarding.waitForTimeout(4000);

      const created = sql(
        `select coalesce((select business_account_id::text from public.couranr_merchant_workspaces
                           where created_by = '${newcomer.id}'), 'NONE')`
      );
      check("A8", "the workspace was created", created !== "NONE", created);
      if (created !== "NONE") {
        check("A9", "and BOTH categories and the registry version are stored",
          categoriesOf(created) ===
            "repair_and_electronics|printing_signage_promotional,furniture_and_home_goods|couranr-categories-2026-08",
          categoriesOf(created));
      }
    }

    /* ══════════════════ MER-014 — settings ═════════════════════════════ */

    console.log("\nMER-014 — loading, editing and re-reading what is stored");
    {
      const settings = await open(owner.email, "/app/business/settings");
      await settings.getByText("Business category").first().waitFor({ state: "visible", timeout: 45_000 });
      await settings.waitForTimeout(800);

      // The bug this catches: the `.select()` originally did not fetch
      // `secondary_categories`, so the screen would have shown NO secondaries
      // for a merchant who had two — indistinguishable from having none.
      check("B1", "the two STORED secondaries load as checked",
        (await box(settings, "Printing, signage, promotional products").isChecked()) &&
          (await box(settings, "Repair and electronics").isChecked()));
      check("B2", "and one they do not have is unchecked",
        (await box(settings, "Furniture and home goods").isChecked()) === false);
      check("B3", "the count reflects what is stored",
        /2 of 3 chosen/i.test(await mainText(settings)));

      await settings.screenshot({ path: path.join(SHOTS, "MER-014-loaded.png"), fullPage: true });

      // Edit: drop one, add another.
      await box(settings, "Repair and electronics").uncheck();
      await box(settings, "Books, cards, collectibles, hobby").check();
      await settings.getByRole("button", { name: /^Save/ }).first().click();
      await settings.waitForTimeout(3000);

      check("B4", "the edit is stored, in the order chosen",
        categoriesOf(bizId) ===
          "florists_gifts_specialty_retail|printing_signage_promotional,books_cards_collectibles_hobby|couranr-categories-2026-08",
        categoriesOf(bizId));

      // And re-read from the SERVER, not from what the browser hoped it sent.
      const reread = await open(owner.email, "/app/business/settings");
      await reread.getByText("Business category").first().waitFor({ state: "visible", timeout: 45_000 });
      await reread.waitForTimeout(800);
      check("B5", "reloading shows what was STORED",
        (await box(reread, "Books, cards, collectibles, hobby").isChecked()) &&
          (await box(reread, "Repair and electronics").isChecked()) === false);
      await reread.screenshot({ path: path.join(SHOTS, "MER-014-saved.png"), fullPage: true });
    }

    /* ══════════════════ a viewer may look, not edit ════════════════════ */

    console.log("\nPermissions — a viewer reads the categories and cannot change them");
    {
      const page = await open(viewer.email, "/app/business/settings");
      await page.getByText("Business category").first().waitFor({ state: "visible", timeout: 45_000 });
      await page.waitForTimeout(800);

      check("C1", "a viewer SEES the stored categories",
        (await box(page, "Printing, signage, promotional products").isChecked()) === true);
      check("C2", "but every category control is DISABLED",
        (await box(page, "Printing, signage, promotional products").isDisabled()) &&
          (await box(page, "Furniture and home goods").isDisabled()) &&
          (await fieldLabel(page, "Primary category").isDisabled()));

      // And the server refuses regardless of what the screen drew.
      const r = await fetch(`${BASE}/api/couranr/me/settings?businessAccountId=${bizId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secondaryCategories: ["furniture_and_home_goods"] }),
      });
      check("C3", "and an unauthenticated PATCH is refused", r.status === 401, `status=${r.status}`);
      check("C4", "with the row untouched",
        categoriesOf(bizId).startsWith("florists_gifts_specialty_retail|printing_signage_promotional,books"),
        categoriesOf(bizId));

      await page.screenshot({ path: path.join(SHOTS, "MER-014-viewer.png"), fullPage: true });
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

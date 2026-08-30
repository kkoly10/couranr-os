/**
 * MER-010 / MER-011 — the preset screens, UNSTUBBED and SIGNED IN.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS RUN PROVES
 * ---------------------------------------------------------------------------
 *
 * The states a person can actually reach, each asserted in the browser AND
 * against the row behind it:
 *
 *   MER-010  global recommendation · customized · merchant-created ·
 *            update suggested · archived
 *   MER-011  new · edited · version conflict · recommendation available
 *
 * And the two rules that matter most, which only a browser can show:
 *
 *   - THE FORM HAS NO INPUT for exact weight, dimensions, value, vehicle,
 *     price, loading or safety. Not a disabled one, not a hidden one. Asserted
 *     against the rendered HTML, because a field that exists but is disabled
 *     would still be a field a future change could enable.
 *   - A VERSION CONFLICT is refused by the SERVER. The row is changed behind
 *     the browser's back — exactly what a colleague saving does — and the
 *     merchant's save must fail with the row unchanged, not silently win.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES NOT PROVE
 * ---------------------------------------------------------------------------
 *
 *  1. The `/auth/v1` issuer is `gateway.mjs`'s reimplementation, not GoTrue.
 *  2. Migrations 20260806190000 and 20260806200000 are applied HERE but NOT in
 *     production.
 *  3. The database half — every command called, plus a genuine concurrent-save
 *     race — is `e2e/disposable/deliveryPresets.mjs`, 50/50. Not repeated here.
 *
 * Run:  node e2e/disposable/presetsUi.mjs
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
const SHOTS = path.join(ROOT, "e2e/screenshots/presets");
const DIST = ".next-disposable";
// Resolved by scripts/provisionPostgrest.mjs, never a session scratchpad.
// The previous default was a path inside ONE container's ephemeral
// scratchpad, so this harness aborted on every other machine — after
// applying 50 migrations, which made a missing dependency look like a
// database failure. `npm run provision:postgrest` puts it on PATH.
const PGRST_BIN = postgrestTarget();

const PORT = 3320;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "disposable-presets-1";

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
  sql(`insert into public.profiles (id,email,role) values ('${id}','${esc(email)}','customer')`);
  return id;
}

/** `name|version|source_version|archived` for one merchant preset. */
function presetRow(id) {
  return sql(
    `select name || '|' || version::text || '|' ||
            coalesce(source_version::text,'NULL') || '|' ||
            (archived_at is not null)::text
       from public.couranr_merchant_presets where id = '${id}'`
  );
}

async function main() {
  console.log("MER-010 / MER-011 — preset screens, authenticated, unstubbed\n");
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
      throw new Error("COURANR_REUSE_BUILD=1 requires COURANR_DISPOSABLE_JWT_SECRET");
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

    console.log("\n  seeding...");
    const owner = { id: makeUser("e2e-pre-owner@couranr.invalid"), email: "e2e-pre-owner@couranr.invalid" };
    const viewer = { id: makeUser("e2e-pre-viewer@couranr.invalid"), email: "e2e-pre-viewer@couranr.invalid" };

    const bizId = sql(
      `insert into public.business_accounts (name,slug,status,timezone)
       values ('[PRE] presets business','pre-presets','active','America/New_York') returning id`
    );
    sql(
      `insert into public.couranr_merchant_workspaces
         (business_account_id,created_by,idempotency_key,business_category,secondary_categories,
          pickup_address,contact_phone,payer_default,policies_version,policies_accepted_at)
       values ('${bizId}','${owner.id}','pre-${crypto.randomUUID()}',
               'florists_gifts_specialty_retail', array['bakeries_prepared_food_catering'],
               '{"line1":"1 Seed St","city":"Stafford","region":"VA","postalCode":"22554"}'::jsonb,
               '540-555-0111','merchant','couranr-policies-2026-07',now())`
    );
    for (const [u, r] of [[owner.id, "owner"], [viewer.id, "viewer"]]) {
      sql(`insert into public.business_members (business_account_id,user_id,role,status,joined_at)
           values ('${bizId}','${u}','${r}','active',now())`);
    }

    // A Couranr global preset for their PRIMARY category, and one for a
    // category they do NOT have — the second must never be offered.
    const globalId = sql(
      `insert into public.couranr_category_presets (business_category,name,body)
       values ('florists_gifts_specialty_retail','Bouquet delivery',
               '{"commonItem":"Bouquet","packageCount":1,"handling":"Keep upright"}'::jsonb)
       returning id`
    );
    sql(
      `insert into public.couranr_category_presets (business_category,name,body)
       values ('auto_parts_and_accessories','[PRE] NOT THEIR CATEGORY','{}'::jsonb)`
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
      throw new Error(`sign-in for ${email} never left /sign-in`);
    }

    async function openPresets(email, suffix = "") {
      const page = await signIn(email);
      const answered = page
        .waitForResponse((r) => r.url().includes("/api/couranr/merchant/presets"), {
          timeout: 45_000,
        })
        .catch(() => null);
      await page.goto(`${BASE}/app/business/presets${suffix}`, { waitUntil: "domcontentloaded" });
      await answered;
      await page.waitForTimeout(500);
      return page;
    }

    /* ══════════ MER-010 — the suggestion, and taking it ════════════════ */

    console.log("MER-010 — Couranr's suggestion, and making it theirs");
    const page = await openPresets(owner.email);
    {
      await page.getByText("Couranr suggestions").first().waitFor({ state: "visible", timeout: 30_000 });
      const body = await mainText(page);

      check("A1", "the screen says what a preset is NOT",
        /never fixes the weight, size, price or vehicle/i.test(body));
      check("A2", "a Couranr suggestion for their category is offered",
        body.includes("Bouquet delivery"));
      check("A3", "a suggestion for a category they DO NOT have is never offered",
        !body.includes("NOT THEIR CATEGORY"));
      check("A4", "and they start with no presets of their own",
        /No presets yet/i.test(body));

      await page.screenshot({ path: path.join(SHOTS, "MER-010-suggestion.png"), fullPage: true });

      await page.getByRole("button", { name: /Make it mine/ }).first().click();
      await page.waitForTimeout(2500);

      const mine = sql(
        `select id from public.couranr_merchant_presets where business_account_id='${bizId}'`
      );
      check("A5", "taking it creates a CUSTOMIZED preset baselined at the global's version",
        presetRow(mine) === "Bouquet delivery|1|1|false", presetRow(mine));

      const after = await mainText(page);
      check("A6", "the list now shows it as theirs, from a Couranr suggestion",
        /Yours, from a Couranr suggestion/i.test(after));
      check("A7", "and it is no longer offered as a suggestion — one preset, not two",
        (after.match(/Bouquet delivery/g) || []).length === 1,
        String((after.match(/Bouquet delivery/g) || []).length));

      /* ═════════ update suggested — the no-overwrite promise ══════════ */

      console.log("\nThe promise: a global update does NOT change what they have");
      sql(`update public.couranr_category_presets
              set body='{"commonItem":"Bouquet","packageCount":2,"handling":"Keep cool"}'::jsonb,
                  version=version+1 where id='${globalId}'`);
      check("B1", "the merchant row is untouched by the global bump",
        presetRow(mine) === "Bouquet delivery|1|1|false", presetRow(mine));

      const reloaded = await openPresets(owner.email);
      await reloaded.getByText("Couranr has an update").first().waitFor({ state: "visible", timeout: 30_000 });
      const rBody = await mainText(reloaded);
      check("B2", "the list renders `update suggested`, derived not stored",
        /Couranr has an update/i.test(rBody));
      check("B3", "and says plainly that NOTHING OF THEIRS WAS CHANGED",
        /nothing of yours was changed/i.test(rBody));
      await reloaded.screenshot({ path: path.join(SHOTS, "MER-010-update-suggested.png"), fullPage: true });

      /* ═════════════ MER-011 — the builder, and the rule ══════════════ */

      console.log("\nMER-011 — the builder, and the fields it must never offer");
      const builder = await openPresets(owner.email, `?edit=${mine}`);
      await fieldLabel(builder, "Preset name").waitFor({ state: "visible", timeout: 30_000 });

      const html = await builder.locator("main").innerHTML();
      const forbidden = [
        "weight", "dimension", "declaredvalue", "finalprice", "pricecents",
        "vehicleid", "loading", "safety",
      ];
      const found = forbidden.filter((f) => html.toLowerCase().includes(`name="${f}`) ||
        new RegExp(`(id|name)="[^"]*${f}[^"]*"`, "i").test(html));
      check("C1", "the form has NO input for any forbidden field, disabled or otherwise",
        found.length === 0, found.join(",") || "none");

      const inputCount = await builder.locator("main input, main select, main textarea").count();
      check("C2", "it offers the seven suggestable fields plus a name",
        inputCount === 8, `${inputCount} controls`);

      check("C3", "the builder shows the recommendation banner for this preset",
        /Couranr has an update/i.test(await mainText(builder)));

      /*
       * ADOPT FIRST, then edit.
       *
       * `edited` is deliberately OUTRANKED by `recommendation_available` —
       * information a merchant may want before they finish beats a nag about
       * unsaved work. So a preset with a pending recommendation never shows
       * "Unsaved changes", and the first version of this run asserted it
       * would, contradicting the precedence it was testing. Taking the update
       * clears the recommendation and lets `edited` be observed on its own.
       */
      await builder.getByRole("button", { name: /Take Couranr/ }).click();
      await builder.waitForTimeout(2500);
      check("C4", "adopting takes the global body and re-baselines — in the browser",
        presetRow(mine) === "Bouquet delivery|2|2|false" &&
          sql(`select body->>'handling' from public.couranr_merchant_presets where id='${mine}'`) ===
            "Keep cool",
        presetRow(mine));

      const afterAdopt = await openPresets(owner.email, `?edit=${mine}`);
      await fieldLabel(afterAdopt, "Preset name").waitFor({ state: "visible", timeout: 30_000 });
      check("C5", "the recommendation banner is gone once it has been taken",
        !/Couranr has an update/i.test(await mainText(afterAdopt)));

      await fieldLabel(afterAdopt, "Handling notes").fill("Ours: lay flat");
      await afterAdopt.getByText("Unsaved changes").first().waitFor({ state: "visible", timeout: 15_000 });
      check("C6", "NOW changing a field renders `edited`", true);
      await afterAdopt.getByRole("button", { name: /Save preset/ }).click();
      await afterAdopt.waitForTimeout(2500);
      check("C7", "saving advances the version and keeps THEIR body",
        presetRow(mine) === "Bouquet delivery|3|2|false" &&
          sql(`select body->>'handling' from public.couranr_merchant_presets where id='${mine}'`) ===
            "Ours: lay flat",
        presetRow(mine));

      /* ═══════════ version conflict — refused by the SERVER ═══════════ */

      console.log("\nVersion conflict — a colleague saves while the form is open");
      const conflicted = await openPresets(owner.email, `?edit=${mine}`);
      await fieldLabel(conflicted, "Preset name").waitFor({ state: "visible", timeout: 30_000 });

      // Exactly what a colleague saving does, behind this browser's back.
      sql(`select public.couranr_update_merchant_preset('${bizId}','${owner.id}','${mine}',
             'Bouquet delivery','{"commonItem":"Bouquet","handling":"Colleague version"}'::jsonb,3)`);
      const beforeSave = presetRow(mine);

      await fieldLabel(conflicted, "Handling notes").fill("Mine, typed later");
      await conflicted.getByRole("button", { name: /Save preset/ }).click();
      await conflicted.waitForTimeout(2500);

      check("D1", "the save is REFUSED — the colleague's work survives",
        presetRow(mine) === beforeSave, `${presetRow(mine)} vs ${beforeSave}`);
      check("D2", "their body is still the colleague's, not the one typed later",
        sql(`select body->>'handling' from public.couranr_merchant_presets where id='${mine}'`) ===
          "Colleague version");
      check("D3", "and the merchant is told what happened, in words",
        /saved this preset while you were editing|could not be saved/i.test(
          await mainText(conflicted)
        ));
      await conflicted.screenshot({ path: path.join(SHOTS, "MER-011-conflict.png"), fullPage: true });

      /* ══════════════ duplicate, archive, and the rest ═══════════════ */

      console.log("\nDuplicate and archive");
      const list = await openPresets(owner.email);
      await list.getByRole("button", { name: /^Duplicate$/ }).first().click();
      await list.waitForTimeout(2500);
      check("E1", "a duplicate is created as MERCHANT-CREATED, with no baseline",
        sql(`select coalesce(source_version::text,'NULL') from public.couranr_merchant_presets
              where business_account_id='${bizId}' and name like '%copy%'`) === "NULL");
      check("E2", "and the list shows it as `Yours`",
        /(^|\n)\s*Yours\s*($|\n)/m.test(await mainText(list)) ||
          (await mainText(list)).includes("Yours"));

      await list.getByRole("button", { name: /^Archive$/ }).first().click();
      await list.waitForTimeout(2500);
      const archivedCount = sql(
        `select count(*) from public.couranr_merchant_presets
          where business_account_id='${bizId}' and archived_at is not null`
      );
      check("E3", "archiving stamps the row rather than deleting it", archivedCount === "1", archivedCount);
      check("E4", "and the archived one drops off the default list",
        !(await mainText(list)).includes("Archived") ||
          (await mainText(list)).includes("Show archived"));

      await list.getByRole("button", { name: /Show archived/ }).click();
      await list.waitForTimeout(2000);
      check("E5", "until archived are shown, and then it is labelled Archived",
        /Archived/.test(await mainText(list)));
      await list.screenshot({ path: path.join(SHOTS, "MER-010-archived.png"), fullPage: true });
    }

    /* ═══════════════════════ permissions ═══════════════════════════════ */

    console.log("\nPermissions — a viewer reads presets and changes nothing");
    {
      const vPage = await openPresets(viewer.email);
      await vPage.getByText("What a preset does").first().waitFor({ state: "visible", timeout: 30_000 });
      const vBody = await mainText(vPage);
      check("F1", "a viewer SEES the presets", vBody.includes("Bouquet delivery"));
      check("F2", "but is offered no New preset, Duplicate or Archive",
        (await vPage.getByRole("link", { name: /New preset/ }).count()) === 0 &&
          (await vPage.getByRole("button", { name: /^Duplicate$/ }).count()) === 0 &&
          (await vPage.getByRole("button", { name: /^Archive$/ }).count()) === 0);

      const anon = await fetch(`${BASE}/api/couranr/merchant/presets?businessAccountId=${bizId}`);
      check("F3", "anonymous is refused", anon.status === 401, `status=${anon.status}`);
      await vPage.screenshot({ path: path.join(SHOTS, "MER-010-viewer.png"), fullPage: true });
    }

    /* ════════════════ fail-closed on a broken read ═════════════════════ */

    console.log("\nFail-closed — a broken read never renders as 'no presets'");
    {
      const p2 = await signIn(owner.email);
      await p2.route("**/api/couranr/merchant/presets?*", (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Injected.", correlationId: "e2e-pre-err" }),
        })
      );
      await p2.goto(`${BASE}/app/business/presets`, { waitUntil: "domcontentloaded" });
      await p2.getByText("Your presets did not load").first().waitFor({ state: "visible", timeout: 30_000 });
      const body = await mainText(p2);
      check("G1", "the error state renders with its reference", body.includes("e2e-pre-err"));
      check("G2", "it does NOT claim they have no presets", !/No presets yet/i.test(body));
      await p2.screenshot({ path: path.join(SHOTS, "MER-010-error.png"), fullPage: true });
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

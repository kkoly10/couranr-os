/**
 * MER-013 — website tools, UNSTUBBED and SIGNED IN.
 *
 * ---------------------------------------------------------------------------
 * THE QR IS DECODED, NOT EYEBALLED
 * ---------------------------------------------------------------------------
 *
 * A screenshot of a QR code proves a black-and-white square rendered. It does
 * not prove the square encodes the merchant's link — a generator bug, a wrong
 * slug or an off-by-one in the module loop all still look like a QR code.
 *
 * So: the BROWSER rasterizes the SVG it actually rendered onto a canvas and
 * hands back the pixels, and NODE decodes those pixels with `jsqr` and
 * compares the decoded string to the URL derived from a `select slug` row.
 * Browser-rendered pixels in, a string out, checked against the database.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES NOT PROVE
 * ---------------------------------------------------------------------------
 *
 *  1. The `/auth/v1` issuer is `gateway.mjs`'s reimplementation, not GoTrue.
 *  2. That the link RESOLVES. It cannot: `/request/[merchantSlug]` is PUB-004
 *     and does not exist. That is the screen's whole "not live yet" state, and
 *     it is asserted as copy rather than as a working URL.
 *
 * Run:  node e2e/disposable/websiteTools.mjs
 */

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
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

const require = createRequire(import.meta.url);
const jsQR = require("jsqr").default ?? require("jsqr");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SHOTS = path.join(ROOT, "e2e/screenshots/website-tools");
const DIST = ".next-disposable";
// Resolved by scripts/provisionPostgrest.mjs, never a session scratchpad.
// The previous default was a path inside ONE container's ephemeral
// scratchpad, so this harness aborted on every other machine — after
// applying 50 migrations, which made a missing dependency look like a
// database failure. `npm run provision:postgrest` puts it on PATH.
const PGRST_BIN = postgrestTarget();

const PORT = 3316;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "disposable-webtools-1";

let passed = 0;
let failed = 0;

function check(id, description, ok, detail = "") {
  ok ? passed++ : failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${description}${detail ? `  [${detail}]` : ""}`);
}

const sql = (q) => psql(q).trim();
const esc = (s) => String(s).replace(/'/g, "''");

/**
 * `Field` decorates every label: required ones get a "*", and NON-required
 * ones get " (optional)" (components/couranr/forms.tsx:55-64). `getByLabel`
 * matches label TEXT rather than the accessible name, so `aria-hidden` on the
 * asterisk is ignored and a bare /^Link$/ matches neither shape. This accepts
 * both — which is what the first run of this harness discovered by timing out
 * on a field that was rendering perfectly well.
 */
function fieldLabel(scope, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return scope.getByLabel(new RegExp(`^${escaped}(\\s*\\*|\\s*\\(optional\\))?$`));
}

function makeUser(email) {
  const id = sql(`insert into auth.users (email) values ('${esc(email)}') returning id`);
  sql(`select public.couranr_disposable_set_password('${id}', '${esc(PASSWORD)}')`);
  sql(
    `insert into public.profiles (id, email, role) values ('${id}', '${esc(email)}', 'customer')`
  );
  return id;
}

function addMember(businessId, userId, role) {
  return sql(
    `insert into public.business_members (business_account_id, user_id, role, status, joined_at)
     values ('${businessId}', '${userId}', '${role}', 'active', now()) returning id`
  );
}

async function main() {
  console.log("MER-013 — website tools, authenticated, unstubbed\n");
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
    const bizId = sql(
      `insert into public.business_accounts (name, slug, status)
       values ('[WT] disposable business', 'wt-disposable-shop', 'active') returning id`
    );
    const owner = { id: makeUser("e2e-wt-owner@couranr.invalid"), email: "e2e-wt-owner@couranr.invalid" };
    const viewer = { id: makeUser("e2e-wt-viewer@couranr.invalid"), email: "e2e-wt-viewer@couranr.invalid" };
    addMember(bizId, owner.id, "owner");
    addMember(bizId, viewer.id, "viewer");

    const otherBiz = sql(
      `insert into public.business_accounts (name, slug, status)
       values ('[WT] other business', 'wt-other-shop', 'active') returning id`
    );
    const outsider = { id: makeUser("e2e-wt-outsider@couranr.invalid"), email: "e2e-wt-outsider@couranr.invalid" };
    addMember(otherBiz, outsider.id, "owner");

    const dbSlug = sql(`select slug from public.business_accounts where id='${bizId}'`);
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
        /* none */
      }
      return { status: r.status, body };
    }

    async function open(email) {
      const page = await signIn(email);
      await page.goto(`${BASE}/app/business/website-tools`, { waitUntil: "domcontentloaded" });
      return page;
    }

    /* ══════════════════ draft state, link, and the QR ══════════════════ */

    console.log("Owner — draft state, link, QR");
    const page = await open(owner.email);
    const linkField = fieldLabel(page, "Link");
    await linkField.waitFor({ state: "visible", timeout: 30_000 });

    const expectedUrl = `${BASE}/request/${dbSlug}`;
    const shownUrl = await linkField.inputValue();
    check("W1", "the link is built from the REAL slug row", shownUrl === expectedUrl,
      `${shownUrl} vs ${expectedUrl}`);

    check("W2", "a merchant with no config row starts in DRAFT",
      (await page.getByText("Draft", { exact: true }).count()) > 0 &&
      sql(`select count(*) from public.couranr_website_tool_configs
            where business_account_id='${bizId}'`) === "0");

    check("W3", "the screen says the link is not live yet (PUB-004 is unshipped)",
      (await page.innerText("body")).includes("goes live when hosted requests launch"));

    // THE DECODE. The browser rasterizes its own rendered SVG; Node decodes it.
    const qrPixels = await page.evaluate(async () => {
      const host = document.querySelector('[data-testid="couranr-qr"]');
      if (!host) return null;
      const svg = host.querySelector("svg");
      if (!svg) return null;
      const xml = new XMLSerializer().serializeToString(svg);
      const url = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(xml)));
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = url;
      });
      const size = 512;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size);
      return { width: data.width, height: data.height, data: Array.from(data.data) };
    });

    if (!qrPixels) {
      check("W4", "the QR rendered and could be rasterized", false, "no canvas data");
    } else {
      const decoded = jsQR(Uint8ClampedArray.from(qrPixels.data), qrPixels.width, qrPixels.height);
      check("W4", "the rendered QR DECODES to the merchant's real link",
        decoded?.data === expectedUrl, `decoded=${decoded?.data ?? "null"}`);
    }
    await page.screenshot({ path: path.join(SHOTS, "MER-013-draft.png"), fullPage: true });

    check("W5", "no scan, click or conversion number anywhere",
      !/\d+\s*(scans|clicks|conversions)/i.test(await page.innerText("body")));

    /* ══════════════════ the embed snippet ══════════════════════════════ */

    console.log("Embed — anchor only, never an iframe or a script");
    {
      const snippet = await fieldLabel(page, "Paste this into your site").inputValue();
      check("E1", "the snippet is an anchor to the real link",
        snippet.startsWith("<a ") && snippet.includes(expectedUrl), snippet.slice(0, 80));
      check("E2", "it is NOT an iframe and NOT a script",
        !snippet.includes("<iframe") && !snippet.includes("<script"));
      const preview = await page.locator('[data-testid="couranr-embed-preview"] a').count();
      check("E3", "the live preview renders the anchor", preview === 1);
    }

    /* ══════════════ invalid embed settings — a required state ══════════ */

    console.log("Invalid embed settings");
    {
      await fieldLabel(page, "Colour").fill("not-a-colour");
      await fieldLabel(page, "Width (px)").fill("5000");
      await page
        .getByText("These settings cannot be used yet")
        .first()
        .waitFor({ state: "visible", timeout: 15_000 });
      check("I1", "invalid values raise the invalid-embed state", true);
      check("I2", "Publish is disabled while the config cannot render",
        await page.getByRole("button", { name: "Publish" }).isDisabled());
      check("I3", "nothing was persisted by an invalid edit",
        sql(`select count(*) from public.couranr_website_tool_configs
              where business_account_id='${bizId}'`) === "0");
      await page.screenshot({ path: path.join(SHOTS, "MER-013-invalid-embed.png"), fullPage: true });

      // Back to a valid config.
      await fieldLabel(page, "Colour").fill("#22aa55");
      await fieldLabel(page, "Width (px)").fill("300");
      await page
        .getByText("These settings cannot be used yet")
        .first()
        .waitFor({ state: "hidden", timeout: 15_000 });
    }

    /* ══════════════════ publish and disable ════════════════════════════ */

    console.log("Publish, then disable");
    await page.getByRole("button", { name: "Publish" }).click();
    {
      const until = Date.now() + 20_000;
      let row = "";
      while (Date.now() < until) {
        row = sql(
          `select status || '|' || embed_color || '|' || embed_width
             from public.couranr_website_tool_configs where business_account_id='${bizId}'`
        );
        if (row.startsWith("published")) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      check("P1", "publishing wrote the row with the merchant's design",
        row === "published|#22aa55|300", row);
      check("P2", "the badge says published AND pending launch",
        (await page.innerText("body")).includes("pending launch"));
      const updatedBy = sql(
        `select updated_by from public.couranr_website_tool_configs where business_account_id='${bizId}'`
      );
      check("P3", "the row records who published it", updatedBy === owner.id, updatedBy);
      await page.screenshot({ path: path.join(SHOTS, "MER-013-published.png"), fullPage: true });
    }

    await page.getByRole("button", { name: "Disable link" }).click();
    {
      const until = Date.now() + 20_000;
      let row = "";
      while (Date.now() < until) {
        row = sql(
          `select status from public.couranr_website_tool_configs where business_account_id='${bizId}'`
        );
        if (row === "disabled") break;
        await new Promise((r) => setTimeout(r, 500));
      }
      check("P4", "disabling wrote the disabled state", row === "disabled", row);
      await page.screenshot({ path: path.join(SHOTS, "MER-013-disabled.png"), fullPage: true });
    }

    /* ══════════════════ roles and tenancy ══════════════════════════════ */

    console.log("Roles and tenancy");
    const viewerPage = await open(viewer.email);
    await fieldLabel(viewerPage, "Link").waitFor({ state: "visible", timeout: 30_000 });
    check("R1", "a viewer READS the tools (every active member may)", true);
    check("R2", "a viewer sees the read-only banner and no Publish control",
      (await viewerPage.innerText("body")).includes("You have read-only access") &&
      (await viewerPage.getByRole("button", { name: "Publish" }).count()) === 0);
    {
      const before = sql(
        `select status from public.couranr_website_tool_configs where business_account_id='${bizId}'`
      );
      const r = await api(viewer.email, `/api/couranr/merchant/website-tools?businessAccountId=${bizId}`, {
        method: "PUT",
        body: JSON.stringify({
          action: "publish",
          embed: { label: "Hacked", color: "#000000", width: 200, variant: "button" },
        }),
      });
      check("R3", "server truth: a viewer's PUT is refused", r.status === 403, `status=${r.status}`);
      const after = sql(
        `select status from public.couranr_website_tool_configs where business_account_id='${bizId}'`
      );
      check("R4", "the refused write changed nothing", before === after, `${before} -> ${after}`);
    }
    await viewerPage.screenshot({ path: path.join(SHOTS, "MER-013-viewer.png"), fullPage: true });

    {
      const r = await api(outsider.email, `/api/couranr/merchant/website-tools?businessAccountId=${bizId}`);
      check("X1", "a member of another business cannot read these tools",
        r.status === 403, `status=${r.status}`);
      const w = await api(outsider.email, `/api/couranr/merchant/website-tools?businessAccountId=${bizId}`, {
        method: "PUT",
        body: JSON.stringify({
          action: "publish",
          embed: { label: "x", color: "#000000", width: 200, variant: "button" },
        }),
      });
      check("X2", "and cannot write them", w.status === 403, `status=${w.status}`);
      const anon = await fetch(`${BASE}/api/couranr/merchant/website-tools?businessAccountId=${bizId}`);
      check("X3", "anonymous is refused", anon.status === 401, `status=${anon.status}`);
    }

    /* ══════════ the route refuses a raw status, by construction ════════ */

    {
      // The convention this repo enforces: a route names an action, never a
      // target state. Sending a status where an action belongs must fail.
      const r = await api(owner.email, `/api/couranr/merchant/website-tools?businessAccountId=${bizId}`, {
        method: "PUT",
        body: JSON.stringify({
          status: "published",
          embed: { label: "x", color: "#000000", width: 200, variant: "button" },
        }),
      });
      check("A1", "a body naming a STATUS instead of an action is refused",
        r.status === 400, `status=${r.status}`);
      check("A2", "and the row is still disabled",
        sql(`select status from public.couranr_website_tool_configs
              where business_account_id='${bizId}'`) === "disabled");
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

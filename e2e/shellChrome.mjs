/**
 * `npm run test:shell-chrome` — layout invariants that only a real browser can
 * check.
 *
 * Three things live here, and all three are things a jsdom test, a typecheck
 * and a 200 from curl all pass straight through:
 *
 *  1. STICKY CHROME. `.cr-topbar`, `.cr-sidebar`, `.cr-appbar` and
 *     `.cr-driverbar` are `position: sticky; top: 0`. A single non-visible
 *     `overflow` value on an ancestor turns that ancestor into a scroll
 *     container, and a sticky element sticks to its nearest scroll container
 *     rather than the viewport — so `overflow-x: hidden` on `.cr-shell`
 *     silently un-stuck every piece of chrome in all five shells while the
 *     computed style still read `sticky`. Nothing caught it for the life of
 *     the shell. This does.
 *
 *  2. HERO ART DIRECTION. PUB-001's hero is a full-bleed photograph. The wide
 *     source is 16:9; `cover`-cropped into a 390px viewport it shows about two
 *     fifths of its width and the hero reads as a flat navy block. A narrow
 *     viewport must therefore resolve the PORTRAIT source, not the wide one.
 *
 *  3. NO HORIZONTAL SCROLL. The hero escapes its container with
 *     `margin-inline: calc(50% - 50vw)`, and `100vw` includes the classic
 *     scrollbar. If the clip that absorbs that overshoot is ever moved or
 *     dropped, every public page grows a horizontal scrollbar.
 *
 * `--positive-control` re-runs the sticky assertion with the old
 * `overflow-x: hidden` rule injected, and fails if the check does NOT report
 * the breakage — so this file cannot rot into a test that passes regardless.
 *
 * Needs no database and no fixtures: every route it visits renders its shell
 * unauthenticated. Reuses a dev server already listening on BASE_URL (default
 * http://127.0.0.1:3000) and only boots one when nothing answers — Next 16's
 * Turbopack dev server refuses to start a second instance in the same
 * directory, so spawning unconditionally fails the moment anyone has `npm run
 * dev` open.
 */

import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const PORT = Number(new URL(BASE).port || 3000);
const APP_LOG = path.join(ROOT, "e2e/artifacts/shell-chrome-app.log");
const CONTROL = process.argv.includes("--positive-control");

/* Playwright is installed globally in this image, not as a repo dependency —
   the same resolution the other browser harnesses use. */
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_PATH || "/opt/node22/lib/node_modules/playwright",
);

const PUBLIC_ROUTES = [
  "/",
  "/pricing",
  "/businesses",
  "/service-areas",
  "/how-it-works",
  "/sign-in",
  "/sign-up",
  "/estimate",
];

/** Every shell, the chrome it is supposed to keep pinned, and a viewport that
    renders that chrome (the sidebar collapses to `.cr-appbar` below 1024px). */
const SHELLS = [
  { route: "/", selector: ".cr-topbar", width: 1440 },
  { route: "/business", selector: ".cr-sidebar", width: 1440 },
  { route: "/operations", selector: ".cr-sidebar", width: 1440 },
  { route: "/business", selector: ".cr-appbar", width: 900 },
  { route: "/driver", selector: ".cr-driverbar", width: 390 },
];

const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${message}`);
  return ok;
};

let appServer;

async function reachable() {
  try {
    return (await fetch(BASE, { redirect: "manual" })).status < 500;
  } catch {
    return false;
  }
}

/** Only tears down a server this process started. */
function stopApp() {
  if (!appServer) return;
  try {
    process.kill(-appServer.pid, "SIGTERM");
  } catch {
    /* already gone */
  }
  appServer = undefined;
}

async function startApp() {
  if (await reachable()) {
    console.log(`reusing the dev server already answering at ${BASE}`);
    return;
  }
  console.log(`starting next dev on ${PORT} ...`);
  const log = openSync(APP_LOG, "w");
  appServer = spawn("npx", ["next", "dev", "-p", String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), NODE_ENV: "development" },
    stdio: ["ignore", log, log],
    detached: true,
  });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await reachable()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`the application did not start — see ${APP_LOG}`);
}

/**
 * Scrolls a page that is genuinely tall enough to scroll and reports whether
 * the chrome held its position. These routes render short unauthenticated
 * shells, so filler is injected first: without it the page cannot scroll and
 * the assertion would pass no matter what the CSS said.
 */
async function chromeHolds(page, selector, extraCss) {
  if (extraCss) await page.addStyleTag({ content: extraCss });
  await page.evaluate(() => {
    const filler = document.createElement("div");
    filler.style.height = "3000px";
    filler.dataset.testFiller = "1";
    document.querySelector(".cr-shell__main").appendChild(filler);
  });
  const el = page.locator(selector).first();
  if ((await el.count()) === 0) return { present: false };
  const top = () => el.evaluate((e) => Math.round(e.getBoundingClientRect().top));
  const before = await top();
  const room = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  );
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(150);
  return { present: true, before, after: await top(), room };
}

async function main() {
  await startApp();
  const browser = await chromium.launch();

  /* ---- 1. sticky chrome, in every shell ------------------------------- */
  console.log("\nsticky chrome");
  for (const { route, selector, width } of SHELLS) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
    const r = await chromeHolds(page, selector);
    const where = `${selector} on ${route} @${width}px`;
    if (!r.present) check(false, `${where}: not rendered — cannot verify`);
    else if (r.room < 500) check(false, `${where}: page only ${r.room}px scrollable — test is vacuous`);
    else check(r.after === r.before, `${where}: stays at top ${r.before} after scrolling (was ${r.after})`);
    await page.close();
  }

  /* ---- positive control ------------------------------------------------ */
  if (CONTROL) {
    console.log("\npositive control — restoring `overflow-x: hidden` on .cr-shell");
    const page = await browser.newPage({ viewport: { width: 1440, height: 800 } });
    await page.goto(`${BASE}/business`, { waitUntil: "networkidle" });
    const r = await chromeHolds(page, ".cr-sidebar", ".cr-shell { overflow-x: hidden !important; }");
    await page.close();
    await browser.close();
    stopApp();
    if (r.present && r.room >= 500 && r.after !== r.before) {
      console.log(
        `\ntest:shell-chrome positive control ok — with the old rule the sidebar ` +
          `moved ${r.before} → ${r.after}, so the check can go red`,
      );
      process.exit(0);
    }
    console.error("\npositive control FAILED — the planted regression was not detected");
    process.exit(1);
  }

  /* ---- 2. hero art direction ------------------------------------------ */
  console.log("\nPUB-001 hero art direction");
  for (const [label, width, want] of [
    ["desktop", 1440, "hero-wide"],
    ["mobile", 390, "hero-portrait"],
  ]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    const src = await page.locator(".cr-hero__photo").evaluate((img) => ({
      current: img.currentSrc,
      loaded: img.complete && img.naturalWidth > 0,
    }));
    check(src.loaded, `${label}: hero photograph decoded`);
    check(
      src.current.includes(want),
      `${label} @${width}px resolves the ${want} source (got ${src.current.split("/").pop()})`,
    );
    await page.close();
  }

  /* ---- 3. no horizontal scroll on any public route -------------------- */
  console.log("\nno horizontal overflow");
  for (const route of PUBLIC_ROUTES) {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const res = await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
      const m = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      }));
      check(res.status() === 200, `${route} @${width}px returns 200`);
      check(
        m.scrollW <= m.clientW + 1,
        `${route} @${width}px does not scroll sideways (${m.scrollW} vs ${m.clientW})`,
      );
      await page.close();
    }
  }

  await browser.close();
  stopApp();

  if (failures.length) {
    console.error(`\n${failures.length} failure(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`\ntest:shell-chrome: all ${SHELLS.length + 4 + PUBLIC_ROUTES.length * 4} assertions passed`);
}

main().catch((e) => {
  console.error(e);
  stopApp();
  process.exit(1);
});

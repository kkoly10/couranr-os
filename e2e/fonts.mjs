/**
 * `npm run test:fonts` — proves the governed typography actually renders.
 *
 * Visual system §10: "The browser must actually render the governed fonts. A
 * CSS stack that silently falls through to `system-ui` is a failure." Nothing
 * else in the repo can catch that. A typecheck passes, the build passes, the
 * page returns 200, and every heading renders in Helvetica.
 *
 * Four things, all of which need a real browser:
 *
 *  1. THE FILES LOAD. No 404, no CORS failure, correct content-type. A
 *     `@font-face` pointing at a missing file fails silently — the browser
 *     just uses the next family in the stack.
 *
 *  2. THE FAMILY IS ACTUALLY AVAILABLE. `document.fonts.check()` answers
 *     whether the browser can render a string in a family, which is not the
 *     same question as whether a stylesheet mentions it.
 *
 *  3. THE WIDTH AXIS IS EXPOSED. §10.2: "Do not write `font-stretch: 112.5%`
 *     and assume it worked." If the `@font-face` omits a `font-stretch` range
 *     the axis is not exposed, every `font-stretch` in a type role is inert,
 *     and the page looks plausible while the hierarchy the system is built on
 *     does nothing. Two identical strings are measured at the axis extremes;
 *     identical widths mean the axis is dead.
 *
 *  4. THE FALLBACK IS NOT THE RESULT. A control specimen in a deliberately
 *     nonexistent family must measure DIFFERENTLY from the Martian specimen —
 *     otherwise assertion 2 could pass on a browser that silently substituted.
 *
 * `--positive-control` re-runs the width-axis measurement with the axis range
 * stripped from the `@font-face` rule, and fails if the check does not notice.
 *
 * Reuses a dev server on BASE_URL (default http://127.0.0.1:3000) and only
 * boots one when nothing answers — Next 16's Turbopack dev server refuses a
 * second instance in the same directory.
 */

import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const PORT = Number(new URL(BASE).port || 3000);
const APP_LOG = path.join(ROOT, "e2e/artifacts/fonts-app.log");
const CONTROL = process.argv.includes("--positive-control");

const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_PATH || "/opt/node22/lib/node_modules/playwright",
);

/** family → the file it must resolve to, and whether it carries a width axis. */
const FONTS = [
  { family: "Martian Grotesk Variable", file: "/fonts/MartianGrotesk-Variable.woff2", width: true },
  { family: "Inter Variable", file: "/fonts/Inter-Variable.woff2", width: false },
  { family: "Martian Mono", file: "/fonts/MartianMono-Variable.woff2", width: true },
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
 * Renders one string twice in the same family at two `font-stretch` values and
 * returns both measured widths. Absolutely positioned and unwrapped so the only
 * thing that can move the number is the font itself.
 */
async function measureWidthAxis(page, family, a, b) {
  return page.evaluate(
    async ({ family, a, b }) => {
      const make = (stretch) => {
        const el = document.createElement("span");
        el.textContent = "HAMBURGEFONTSIV 0123456789";
        el.style.cssText = `position:absolute;left:-9999px;top:0;white-space:nowrap;font-size:64px;font-family:${JSON.stringify(family)};font-stretch:${stretch};`;
        document.body.appendChild(el);
        return el;
      };
      const ea = make(a);
      const eb = make(b);
      await document.fonts.ready;
      const wa = ea.getBoundingClientRect().width;
      const wb = eb.getBoundingClientRect().width;
      ea.remove();
      eb.remove();
      return { a: wa, b: wb };
    },
    { family, a, b },
  );
}

async function main() {
  await startApp();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  /* Every font request the page makes, and how it ended. */
  const fontRequests = [];
  page.on("response", (r) => {
    if (/\.woff2?(\?|$)/.test(r.url())) {
      fontRequests.push({ url: r.url(), status: r.status(), type: r.headers()["content-type"] });
    }
  });
  page.on("requestfailed", (r) => {
    if (/\.woff2?(\?|$)/.test(r.url())) {
      fontRequests.push({ url: r.url(), status: "FAILED", type: r.failure()?.errorText });
    }
  });

  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  if (CONTROL) {
    /*
     * Pin the width axis and re-measure. The check must notice.
     *
     * The first control tried removing the `font-stretch` range from the
     * `@font-face` rule, on the assumption that the descriptor is what exposes
     * the axis. Measured in Chromium, that is wrong: a variable font's axes
     * stay reachable without it and the spread was unchanged at 560px. The
     * descriptor governs face MATCHING, not axis availability.
     *
     * `font-variation-settings: "wdth" 100` genuinely disables variation —
     * measured spread 0.00px, the same as Inter (which has no width axis at
     * all) and the same as a non-variable system stack. That makes it a real
     * negative, so the control tests the assertion rather than agreeing with it.
     */
    console.log("\npositive control — pinning the width axis with font-variation-settings");
    const m = await page.evaluate(async () => {
      const mk = (stretch) => {
        const el = document.createElement("span");
        el.textContent = "HAMBURGEFONTSIV 0123456789";
        el.style.cssText =
          `position:absolute;left:-9999px;white-space:nowrap;font-size:64px;` +
          `font-family:"Martian Grotesk Variable";font-stretch:${stretch};` +
          `font-variation-settings:"wdth" 100;`;
        document.body.appendChild(el);
        return el;
      };
      const a = mk("75%");
      const b = mk("200%");
      await document.fonts.ready;
      const r = { a: a.getBoundingClientRect().width, b: b.getBoundingClientRect().width };
      a.remove();
      b.remove();
      return r;
    });
    await browser.close();
    stopApp();
    const spread = Math.abs(m.b - m.a);
    if (spread <= 1) {
      console.log(
        `test:fonts positive control ok — with the axis pinned the spread collapses to ` +
          `${spread.toFixed(2)}px (75%: ${m.a.toFixed(1)}px, 200%: ${m.b.toFixed(1)}px), ` +
          `so the width assertion can go red`,
      );
      process.exit(0);
    }
    console.error(
      `positive control FAILED — pinning the axis still produced a ` +
        `${spread.toFixed(1)}px spread, so the width assertion may be measuring something else`,
    );
    process.exit(1);
  }

  /* ---- 1. the files load ------------------------------------------------ */
  console.log("\nfont files");
  for (const { family, file } of FONTS) {
    const res = await page.request.get(`${BASE}${file}`);
    check(res.status() === 200, `${file} serves 200 (${family})`);
    check(
      (res.headers()["content-type"] || "").includes("font/woff2"),
      `${file} content-type is font/woff2 (got ${res.headers()["content-type"] || "none"})`,
    );
  }
  const bad = fontRequests.filter((r) => r.status !== 200);
  check(bad.length === 0, `no failed font requests on the page (${bad.map((b) => `${b.status} ${b.url.split("/").pop()}`).join(", ") || "none"})`);

  /* ---- 2. the families are available ------------------------------------ */
  // `document.fonts.check()` alone is the wrong question, and asking it that
  // way failed here first: @font-face rules are LAZY, so a face nothing on the
  // page currently uses is never activated and `check` returns false even
  // though the file is served, cached and perfectly renderable. Inter passed
  // (`.cr-root` uses it) while both Martian faces "failed" — a false negative
  // that would have read as a broken font.
  //
  // `fonts.load()` activates the face, then `check()` answers the question
  // actually being asked: can the browser render text in this family. Until
  // PUB-001 adopts the display roles in V2, Martian is used by nothing on the
  // page, and that is expected mid-migration rather than a defect.
  console.log("\nfamilies available to the renderer");
  for (const { family } of FONTS) {
    const ok = await page.evaluate(async (f) => {
      const spec = `64px ${JSON.stringify(f)}`;
      try {
        await document.fonts.load(spec, "HAMBURGEFONTSIV 0123456789");
      } catch {
        return false;
      }
      return document.fonts.check(spec);
    }, family);
    check(ok, `"${family}" is loadable and renderable`);
  }

  /* ---- 3. body copy actually computes to the governed family ------------ */
  console.log("\ncomputed families on the live page");
  const computed = await page.evaluate(() => {
    const root = document.querySelector(".cr-root");
    return {
      root: root ? getComputedStyle(root).fontFamily : null,
      body: getComputedStyle(document.body).fontFamily,
    };
  });
  check(
    /Inter/.test(computed.root || ""),
    `.cr-root resolves to the Inter body family (${(computed.root || "").split(",")[0]})`,
  );

  /* ---- 4. the width axis is exposed ------------------------------------- */
  console.log("\nvariable width axis (§10.2)");
  for (const { family, width } of FONTS) {
    if (!width) continue;
    const m = await measureWidthAxis(page, family, "75%", family === "Martian Mono" ? "112.5%" : "200%");
    const spread = Math.abs(m.b - m.a);
    check(
      spread > 1,
      `${family}: font-stretch changes rendered width — ` +
        `${m.a.toFixed(1)}px vs ${m.b.toFixed(1)}px, spread ${spread.toFixed(1)}px`,
    );
  }

  // The measurement has to DISCRIMINATE, not merely produce a number. Inter
  // carries a weight axis and no width axis, so the identical measurement on it
  // must collapse to zero — if it does not, the spread above is noise.
  {
    const m = await measureWidthAxis(page, "Inter Variable", "75%", "200%");
    const spread = Math.abs(m.b - m.a);
    check(
      spread <= 1,
      `control: Inter has no width axis, so font-stretch must not move it — spread ${spread.toFixed(2)}px`,
    );
  }

  /* ---- 5. the fallback is not silently the result ----------------------- */
  console.log("\nfallback is not the result");
  const real = await measureWidthAxis(page, "Martian Grotesk Variable", "100%", "100%");
  const fake = await measureWidthAxis(page, "Couranr Nonexistent Face", "100%", "100%");
  check(
    Math.abs(real.a - fake.a) > 1,
    `Martian renders differently from a nonexistent family — ` +
      `${real.a.toFixed(1)}px vs fallback ${fake.a.toFixed(1)}px`,
  );

  /* ---- 6. §13's per-surface budgets, in a real browser ------------------ */
  //
  // The propagation for 55 product screens is four selectors in couranr.css
  // keyed on `data-couranr-surface`. A unit test proves the CSS says the right
  // thing; only a browser proves the shell actually stamps the attribute.
  //
  // The computed FONT on a product page title cannot be measured in this
  // container, and the reason is recorded rather than worked around. Every
  // product route is behind an access gate; with no session the shells render
  // chrome only — measured, not assumed: the DOM at /business, /operations and
  // /driver contains `.cr-sidebar*` classes and no `.cr-heading` or `.cr-text`
  // node at all. The authenticated harness that would reach one exists
  // (e2e/disposable/merchantDashboard.mjs signs in for real) and aborts here
  // after applying its 50 migrations because its PostgREST binary is absent.
  //
  // So this asserts what a browser CAN establish — the marker the whole
  // cascade hangs off — and prints an explicit UNVERIFIED line for the rest.
  // Not a skip: it is counted and reported in the summary on every run.
  console.log("\n§13 per-surface typography budgets");

  const DISPLAY = "Martian Grotesk Variable";
  const unverified = [];

  for (const [route, surface] of [
    ["/business", "merchant"],
    ["/operations", "operations"],
    ["/driver", "driver"],
  ]) {
    const tab = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const res = await tab.goto(`${BASE}${route}`, { waitUntil: "commit" });
    await tab
      .waitForSelector(".cr-page-header .cr-heading--1", { state: "attached", timeout: 3000 })
      .catch(() => {});

    const m = await tab.evaluate(() => {
      const root = document.querySelector("[data-couranr-surface]");
      const h = document.querySelector(".cr-page-header .cr-heading--1");
      return {
        surface: root?.getAttribute("data-couranr-surface") ?? null,
        pageTitle: h ? getComputedStyle(h).fontFamily : null,
      };
    });

    check(res.status() === 200, `${route} returns 200`);
    check(
      m.surface === surface,
      `${route} stamps data-couranr-surface="${surface}" (${m.surface})`,
    );

    if (m.pageTitle) {
      check(
        m.pageTitle.includes(DISPLAY),
        `${surface} page title computes to Martian (${m.pageTitle.slice(0, 40)})`,
      );
    } else {
      unverified.push(`${surface}: no page title rendered without a session`);
      console.log(`  ??    ${surface} page-title font UNVERIFIED — access-gated, no session available`);
    }

    await tab.close();
  }

  await browser.close();
  stopApp();

  if (failures.length) {
    console.error(`\n${failures.length} failure(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  if (unverified.length) {
    console.log(`\ntest:fonts: all assertions passed, ${unverified.length} UNVERIFIED:`);
    for (const u of unverified) console.log(`  ?  ${u}`);
    console.log(
      "  reason: product routes are access-gated and the authenticated harness " +
        "(e2e/disposable/merchantDashboard.mjs) cannot start PostgREST in this container.",
    );
    return;
  }
  console.log(`\ntest:fonts: all assertions passed`);
}

main().catch((e) => {
  console.error(e);
  stopApp();
  process.exit(1);
});

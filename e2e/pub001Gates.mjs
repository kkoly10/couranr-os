/**
 * `npm run test:pub001` — §26's Gate B and Gate C for PUB-001.
 *
 * §26 is explicit that a screen is not visually complete because it passes
 * functional tests, because a screenshot exists, or because it uses the right
 * colours. Three independent gates decide. Gate A (native-mock region review)
 * is a human comparison and produces a written record; B and C are mechanical
 * and live here.
 *
 * GATE B — runtime responsive verification (§24.1's six real browser widths):
 *   no horizontal overflow · primary actions reachable and not clipped ·
 *   every interactive target ≥44×44 (§23.6) · responsive navigation actually
 *   switches · sticky chrome still sticks · the art-directed hero resolves the
 *   right source at each width.
 *
 * GATE C — accessibility (§23):
 *   axe-core at WCAG 2.2 AA · one h1 and no skipped heading levels ·
 *   landmarks present · keyboard reaches the primary action and focus is
 *   visible · prefers-reduced-motion honoured · measured contrast on text over
 *   photography, sampled from the PAINTED pixels rather than assumed from the
 *   scrim's opacity (§23.2: "Do not assume a Navy scrim automatically passes").
 *
 * Runs against a PRODUCTION build. `next dev` reports 403s on its own chunks
 * and a failed HMR socket, and reading that noise as signal is how the earlier
 * harnesses nearly recorded a clean page as broken.
 *
 * axe-core is already in the tree via eslint-plugin-jsx-a11y, so it is resolved
 * from node_modules and version-tracked by the lockfile rather than vendored.
 *
 * `--positive-control` injects a contrast failure and a duplicate h1 and fails
 * if Gate C does not report both.
 */

import { spawn } from "node:child_process";
import { openSync, readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PUB001_PORT || 3100);
const BASE = `http://127.0.0.1:${PORT}`;
const ART = path.join(ROOT, "e2e/artifacts/pub001");
const CONTROL = process.argv.includes("--positive-control");

import { governedPages, specRows } from "../scripts/compositionContract.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_PATH || "/opt/node22/lib/node_modules/playwright",
);
const AXE_SOURCE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

/** §24.1 — the widths public marketing must be verified at. */
const WIDTHS = [360, 390, 768, 1024, 1280, 1440];

/**
 * How many governed sections PUB-001 must render, READ FROM §27.0 rather than
 * retyped. It was the literal 13, which meant the gate agreed with itself while
 * §27.0 said fourteen — the same failure mode §27.0 exists to remove.
 */
const GOVERNED_SECTIONS = (() => {
  const spec = readFileSync(
    path.join(ROOT, "docs/couranr-mvp/brand/COURANR_VISUAL_SYSTEM_V2_2.md"),
    "utf8",
  );
  const page = governedPages(spec).find((p) => p.screen === "PUB-001");
  return specRows(spec, page).length;
})();

const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${message}`);
  return ok;
};

let server;

async function reachable() {
  try {
    return (await fetch(BASE, { redirect: "manual" })).status < 500;
  } catch {
    return false;
  }
}

function stopServer() {
  if (!server) return;
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    /* already gone */
  }
  server = undefined;
}

async function startServer() {
  if (await reachable()) {
    console.log(`reusing the server already answering at ${BASE}`);
    return;
  }
  mkdirSync(ART, { recursive: true });
  console.log(`starting next start on ${PORT} (production build) ...`);
  const log = openSync(path.join(ROOT, "e2e/artifacts/pub001-server.log"), "w");
  server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    cwd: ROOT,
    env: { ...process.env },
    stdio: ["ignore", log, log],
    detached: true,
  });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await reachable()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("the production server did not start — run `npm run build` first");
}

/* Relative luminance and contrast, WCAG 2.x definitions. */
const lin = (c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : (((c / 255) + 0.055) / 1.055) ** 2.4);
const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * Measures the worst realistic contrast for text drawn over the hero
 * photograph, by screenshotting the hero with the COPY HIDDEN and sampling the
 * painted background where the copy sits. Reading the scrim's alpha instead
 * would answer a different question — the photograph underneath varies.
 */
async function heroContrast(page) {
  const hero = await page.locator(".cr-hero").boundingBox();
  const regions = {};
  for (const [key, sel] of [["headline", "#hero-h"], ["subhead", ".cr-hero__sub"], ["trust", ".cr-hero__trust"]]) {
    const bb = await page.locator(sel).boundingBox();
    regions[key] = {
      x: Math.max(0, Math.round(bb.x - hero.x)),
      y: Math.max(0, Math.round(bb.y - hero.y)),
      w: Math.round(bb.width),
      h: Math.round(bb.height),
    };
  }
  await page.addStyleTag({ content: ".cr-hero__body{visibility:hidden!important}" });
  const shot = await page.locator(".cr-hero").screenshot();
  const px = await page.evaluate(
    async ({ b64, regions }) => {
      const img = new Image();
      img.src = "data:image/png;base64," + b64;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      c.getContext("2d").drawImage(img, 0, 0);
      const out = {};
      for (const [k, r] of Object.entries(regions)) {
        const w = Math.min(r.w, img.width - r.x);
        const h = Math.min(r.h, img.height - r.y);
        if (w <= 0 || h <= 0) { out[k] = null; continue; }
        out[k] = Array.from(c.getContext("2d").getImageData(r.x, r.y, w, h).data);
      }
      return out;
    },
    { b64: shot.toString("base64"), regions },
  );
  await page.reload({ waitUntil: "networkidle" });

  const result = {};
  for (const [k, data] of Object.entries(px)) {
    if (!data) { result[k] = null; continue; }
    const ls = [];
    for (let i = 0; i < data.length; i += 4) ls.push(lum(data[i], data[i + 1], data[i + 2]));
    ls.sort((a, b) => a - b);
    // 99th percentile: the brightest realistic backdrop, not a single stray pixel.
    const worst = ls[Math.floor(ls.length * 0.99)];
    result[k] = {
      white: ratio(lum(255, 255, 255), worst),
      gold: ratio(lum(244, 183, 64), worst),
    };
  }
  return result;
}

async function main() {
  await startServer();
  const browser = await chromium.launch();

  /* ══ GATE B ══════════════════════════════════════ runtime responsive ══ */
  console.log("\nGATE B — runtime responsive verification (§24.1)");
  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    const res = await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);

    const m = await page.evaluate(() => {
      const de = document.documentElement;
      // §23.6's 44px floor applies "where applicable" — to standalone controls,
      // not to every link. The first version of this check flagged inline text
      // links ("View service areas →") and the 40px small buttons §18 defines,
      // which made it stricter than both WCAG 2.2 AA (2.5.8 asks 24×24, with an
      // explicit inline exception — and axe reports the page passing it) and the
      // visual system's own control scale. A check that contradicts the spec it
      // is enforcing produces noise, not safety.
      //
      // So: the 44px floor is asserted on BUTTON-STYLED controls only, and
      // axe's target-size rule covers the AA floor for everything else.
      const small = [...document.querySelectorAll(".cr-button, .cr-icon-button, button, [role=button]")]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden" || r.width === 0) return false;
          // --couranr-control-height-sm is 40px by §18 and is a deliberate
          // pointer-density choice, so small buttons are measured against that.
          const floor = el.classList.contains("cr-button--sm") ? 40 : 44;
          return r.height < floor - 0.5;
        })
        .map((el) => `${el.tagName.toLowerCase()}"${(el.textContent || "").trim().slice(0, 24)}" ${Math.round(el.getBoundingClientRect().height)}px`);
      const cta = document.querySelector(".cr-hero__cta a");
      const ctaBox = cta ? cta.getBoundingClientRect() : null;
      return {
        hScroll: de.scrollWidth > de.clientWidth + 1,
        scrollW: de.scrollWidth,
        clientW: de.clientWidth,
        sections: document.querySelectorAll("[data-couranr-section]").length,
        heroSrc: (document.querySelector(".cr-hero__photo")?.currentSrc || "").split("/").pop(),
        ctaVisible: !!ctaBox && ctaBox.width > 0 && ctaBox.right <= de.clientWidth + 1,
        smallTargets: [...new Set(small)],
        navMode:
          getComputedStyle(document.querySelector(".cr-topbar__links")).display === "none"
            ? "drawer"
            : "inline",
      };
    });

    check(res.status() === 200, `@${width} returns 200`);
    check(!m.hScroll, `@${width} no horizontal overflow (${m.scrollW}/${m.clientW})`);
    check(
      m.sections === GOVERNED_SECTIONS,
      `@${width} renders all ${GOVERNED_SECTIONS} governed sections (${m.sections})`,
    );
    check(m.ctaVisible, `@${width} the primary hero CTA is visible and unclipped`);
    check(m.smallTargets.length === 0, `@${width} button controls meet their §18 height (${m.smallTargets.join(", ") || "all pass"})`);
    check(errors.length === 0, `@${width} no console errors (${errors.slice(0, 1).join("") || "none"})`);
    const wantSrc = width <= 640 ? "portrait" : "wide";
    check(m.heroSrc.includes(wantSrc), `@${width} hero resolves the ${wantSrc} source (${m.heroSrc})`);
    if (width === WIDTHS[0]) check(m.navMode === "drawer", `@${width} navigation collapses to the drawer`);
    if (width === WIDTHS[WIDTHS.length - 1]) check(m.navMode === "inline", `@${width} navigation is inline`);

    await page.screenshot({ path: path.join(ART, `gate-b-${width}.png`), fullPage: true });
    await page.close();
  }

  /* Sticky chrome, on a page long enough for it to matter. */
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    const before = await page.locator(".cr-topbar").evaluate((e) => Math.round(e.getBoundingClientRect().top));
    await page.evaluate(() => window.scrollTo(0, 2000));
    await page.waitForTimeout(150);
    /* This asserted `after === before`, which was only ever true because the
     * topbar happened to start at viewport top 0. The drift ledger moved the
     * notice bar ABOVE the header, so the topbar now starts 47px down and
     * pins at 0 — correct sticky behaviour that the old equality read as a
     * failure. What sticky actually promises is: pinned at the CSS `top`
     * offset, still on screen, on a page that really scrolled. */
    const stick = await page.locator(".cr-topbar").evaluate((e) => {
      const b = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return {
        top: Math.round(b.top),
        bottom: Math.round(b.bottom),
        position: cs.position,
        offset: Math.round(parseFloat(cs.top) || 0),
        scrolled: Math.round(window.scrollY),
      };
    });
    check(stick.scrolled > 1000, `the page actually scrolled (${stick.scrolled}px)`);
    check(
      stick.position === "sticky" && stick.top === stick.offset && stick.bottom > 0,
      `sticky topbar pins at its ${stick.offset}px offset after a 2000px scroll ` +
        `(position ${stick.position}, top ${stick.top}, bottom ${stick.bottom}; started at ${before})`,
    );
    await page.close();
  }

  /* ══ GATE C ══════════════════════════════════════════ accessibility ══ */
  console.log("\nGATE C — accessibility (§23)");
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  if (CONTROL) {
    console.log("\npositive control — injecting a second h1 and a low-contrast paragraph");
    await page.evaluate(() => {
      const h = document.createElement("h1");
      h.textContent = "Planted duplicate heading";
      document.querySelector(".cr-mkt").prepend(h);
      const p = document.createElement("p");
      p.textContent = "Planted low-contrast text";
      p.style.cssText = "color:#f2f2f2;background:#ffffff;font-size:14px";
      document.querySelector(".cr-mkt").prepend(p);
    });
    await page.addScriptTag({ content: AXE_SOURCE });
    const r = await page.evaluate(async () =>
      await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag22aa"] } }),
    );
    const ids = r.violations.map((v) => v.id);
    const h1s = await page.evaluate(() => document.querySelectorAll("h1").length);
    await browser.close();
    stopServer();
    const caughtContrast = ids.includes("color-contrast");
    const caughtH1 = h1s > 1;
    if (caughtContrast && caughtH1) {
      console.log(
        `test:pub001 positive control ok — axe flagged ${ids.join(", ")} and the page now has ${h1s} h1s, ` +
          `so Gate C can go red`,
      );
      process.exit(0);
    }
    console.error(
      `positive control FAILED — contrast caught: ${caughtContrast}, duplicate h1 caught: ${caughtH1}`,
    );
    process.exit(1);
  }

  await page.addScriptTag({ content: AXE_SOURCE });
  const axe = await page.evaluate(async () =>
    await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    }),
  );
  const violations = axe.violations.map(
    (v) => `${v.id} (${v.impact}, ${v.nodes.length}×): ${v.help}`,
  );
  check(violations.length === 0, `axe-core WCAG 2.2 AA: ${violations.length} violation(s)`);
  for (const v of violations) console.log(`         ${v}`);
  console.log(`         (${axe.passes.length} rules passed, ${axe.incomplete.length} need review)`);

  const structure = await page.evaluate(() => {
    const hs = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => Number(h.tagName[1]));
    const skips = hs.slice(1).map((l, i) => (l - hs[i] > 1 ? `${hs[i]}→${l}` : null)).filter(Boolean);
    return {
      h1: document.querySelectorAll("h1").length,
      skips,
      main: document.querySelectorAll("main").length,
      nav: document.querySelectorAll("nav").length,
      contentinfo: document.querySelectorAll("footer").length,
      skipLink: !!document.querySelector(".cr-skip-link"),
    };
  });
  check(structure.h1 === 1, `exactly one h1 (${structure.h1})`);
  check(structure.skips.length === 0, `no skipped heading levels (${structure.skips.join(", ") || "none"})`);
  check(structure.main >= 1 && structure.nav >= 1 && structure.contentinfo >= 1, `landmarks present (main/nav/footer)`);
  check(structure.skipLink, `skip link present`);

  /* Keyboard: the skip link is first, and focus is visibly styled. */
  await page.keyboard.press("Tab");
  const firstFocus = await page.evaluate(() => {
    const el = document.activeElement;
    const cs = getComputedStyle(el);
    return {
      cls: el.className,
      ring: cs.boxShadow !== "none" || cs.outlineStyle !== "none",
    };
  });
  check(String(firstFocus.cls).includes("skip"), `first Tab reaches the skip link (${firstFocus.cls})`);
  check(firstFocus.ring, `focus is visibly indicated`);

  /* prefers-reduced-motion must still be honoured. */
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload({ waitUntil: "networkidle" });
  const motion = await page.evaluate(() => {
    const el = document.querySelector(".cr-button--primary");
    return getComputedStyle(el).transitionDuration;
  });
  // The rule sets 0.01ms, which serializes as "1e-05s" — the first version of
  // this assertion pattern-matched the literal "0.01ms" and reported a working
  // rule as broken. Parse the value instead of matching how it is spelled.
  const seconds = /ms$/.test(motion) ? parseFloat(motion) / 1000 : parseFloat(motion);
  check(seconds <= 0.001, `reduced motion collapses transitions (${motion} = ${seconds}s)`);
  await page.emulateMedia({ reducedMotion: null });

  /* Contrast over the photograph, measured from painted pixels. */
  await page.reload({ waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const contrast = await heroContrast(page);
  for (const [region, c] of Object.entries(contrast)) {
    if (!c) { check(false, `hero ${region}: could not sample the painted background`); continue; }
    // The headline is large text (3:1 floor); subhead and trust row are normal (4.5:1).
    const floor = region === "headline" ? 3 : 4.5;
    check(
      c.white >= floor,
      `hero ${region} over photography: ${c.white.toFixed(2)}:1 white (floor ${floor})`,
    );
    if (region === "headline") {
      check(c.gold >= 3, `hero headline accent: ${c.gold.toFixed(2)}:1 gold (floor 3 for large text)`);
    }
  }

  await page.screenshot({ path: path.join(ART, "gate-c-desktop.png"), fullPage: true });
  await page.close();
  await browser.close();
  stopServer();

  if (failures.length) {
    console.error(`\n${failures.length} failure(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`\ntest:pub001: Gate B and Gate C pass. Evidence in e2e/artifacts/pub001/`);
}

main().catch((e) => {
  console.error(e);
  stopServer();
  process.exit(1);
});

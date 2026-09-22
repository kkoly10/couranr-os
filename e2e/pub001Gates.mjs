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
 *   axe-core at WCAG 2.2 AA, at both art-directed widths · one h1 and no skipped heading levels ·
 *   landmarks present · keyboard reaches the primary action and focus is
 *   visible · prefers-reduced-motion honoured · measured contrast on text over
 *   photography, sampled from the PAINTED pixels rather than assumed from the
 *   scrim's opacity (§23.2: "Do not assume a Navy scrim automatically passes"),
 *   at BOTH art-directed widths and in the colour each region actually renders.
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
const PORT = Number(process.env.PUB001_PORT || 3120);
const BASE = `http://127.0.0.1:${PORT}`;

/* PUB-001 moved from `/` to `/business` with LEG-004, and `/` is PUB-012 now.
   Read from the screen source rather than typed, so this gate follows the next
   move instead of silently driving whatever page happens to answer `/`. */
const PUB_001_ROUTE = JSON.parse(
  readFileSync(path.join(ROOT, "ui_screen_registry.json"), "utf8"),
).screens.find((s) => s.id === "PUB-001").routes[0];
const ART = path.join(ROOT, "e2e/artifacts/pub001");
const CONTROL = process.argv.includes("--positive-control");

import { governedPages, specRows } from "../scripts/compositionContract.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_PATH || "playwright",
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

/* ─────────────────────────────────────── requests the PLATFORM serves ──
   `<CouranrAnalytics/>` (app/layout.tsx) injects Vercel Analytics, whose script
   the VERCEL EDGE serves at /_vercel/insights/script.js. Nothing in this repo
   answers that path — there is no public/_vercel and no route for it — so
   `next start` returns 404 on any machine that is not Vercel, and Chromium logs
   a console error for the failed script. On the deployed site the edge serves
   it and the console is clean.

   That makes the 404 a property of running the production build OUTSIDE Vercel,
   not a defect in the page, so the fix belongs in this harness rather than in
   the assertion: the console-error check keeps its full strength over
   everything the page itself emits.

   Scoped to the platform prefix, and to `console` messages only — `pageerror`
   is never exempted, because a thrown exception is the page's own code. Every
   exemption is counted in the check's own message, so this can never grow
   quietly into a filter that hides real errors, and it has its own positive
   control in Gate B. */
const PLATFORM_SERVED = /\/_vercel\//;

/* Set by Gate B under --positive-control, read by Gate C's control verdict —
   which is the only place that can report it, because the control block always
   `process.exit`s there. */
let controlConsoleCaught = false;


/* The typography hotfix's measures, as the hotfix wrote them: a count of `ch`.
   See the MEASURE block in Gate C for why the pixel form had to go. */
const HOTFIX_MEASURES = [
  { sel: ".cr-hero__h1-lead", ch: 15, font: 60 },
  { sel: ".cr-hero__h1-accent", ch: 24, font: 49.8 },
  /* RETIRED, not re-pointed — and that distinction is the whole correction.
     This row was `.cr-mkt-editorial > h2` at 544px/44px: the FIRST such
     heading on the page, which was `pickup-problem`'s `cr-type-statement`
     h2. The 2026-09 lock deleted that section, the bare selector silently
     re-pointed at `product-choice`'s heading, and the measure failed at
     480px/40px with no style having changed (`.cr-mkt-editorial > h1, > h2
     { max-width: 16ch }` is byte-identical base and HEAD).

     Re-pointing it was tried and is wrong: the two `.cr-mkt-editorial`
     sections that remain on /business (`product-choice`, `shipment-safety`)
     both use `cr-type-marketing-section`, not `cr-type-statement`, so they
     render at a different type scale and any 544/44 expectation on them
     would be a fabricated number. No element on this page now carries the
     combination this row measured.

     The CSS RULE is still exercised — by both of those headings — so the
     hotfix is not unguarded; what is gone is this specific recorded
     measurement. Re-pin it from a real browser measurement at the MVP
     completion pass, alongside the PUB_001_VISUAL_DRIFT_LEDGER row for
     `pickup-problem`, which is now equally stale. */
  { sel: ".cr-mkt-proof__copy p", ch: 62, font: 20 },
];

/* Resolve each hotfix measure IN THE BROWSER, returning the used width beside
   the width its declared `ch` count comes to here. Shared by the real check and
   by the positive control, so the control exercises the code the gate trusts. */
async function measureHotfix(page, specs) {
  return page.evaluate(
    (rows) =>
      rows.map((s) => {
        const el = document.querySelector(s.sel);
        if (!el) return { ...s, missing: true };
        /* Let CSS resolve `1ch` in the element's OWN font context: a child
           inherits the font, so `width:1ch` on it resolves through exactly the
           unit the element's `max-width: Nch` uses. Measuring the "0" glyph
           through the `font` shorthand is NOT equivalent — the shorthand drops
           font-variation-settings, and the two disagreed here. */
        const probe = document.createElement("span");
        probe.style.cssText = "display:block;width:1ch;height:0;visibility:hidden";
        el.appendChild(probe);
        const ch1 = probe.getBoundingClientRect().width;
        probe.remove();
        return {
          ...s,
          ch1,
          gotWidth: el.getBoundingClientRect().width,
          gotFont: parseFloat(getComputedStyle(el).fontSize),
        };
      }),
    specs,
  );
}

/* A measure is wrong when the element does not render the `ch` count the hotfix
   approved — shadowed by a later declaration, or clipped because a container
   has become the binding constraint. */
const measureOff = (m) => m.missing || Math.abs(m.gotWidth - m.ch * m.ch1) > 1;

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
 *
 * EACH REGION IS MEASURED AGAINST THE COLOUR IT ACTUALLY RENDERS IN, read from
 * `getComputedStyle` at this viewport. That is not a refinement: the hero is
 * art-directed, so the headline accent is white at desktop and GOLD below
 * 768px, and the small label is white at desktop and gold below it. This used
 * to report a fixed `gold` figure computed against the DESKTOP backdrop and
 * label it "hero headline accent" — a colour that is not painted at that width,
 * measured over a photograph that is not the one it appears on. The crop below
 * 768px is a different source file. §23.2 says do not assume the scrim passes;
 * measuring the wrong crop is the same mistake one level down.
 */
async function heroContrast(page) {
  const hero = await page.locator(".cr-hero").boundingBox();
  const regions = {};
  const colors = {};
  for (const [key, sel] of [
    ["headline", "#hero-h"],
    ["accent", ".cr-hero__h1-accent"],
    ["subhead", ".cr-hero__sub"],
    ["trust", ".cr-hero__trust"],
  ]) {
    const bb = await page.locator(sel).boundingBox();
    if (!bb) continue;
    regions[key] = {
      x: Math.max(0, Math.round(bb.x - hero.x)),
      y: Math.max(0, Math.round(bb.y - hero.y)),
      w: Math.round(bb.width),
      h: Math.round(bb.height),
    };
    colors[key] = await page.locator(sel).evaluate((e) => {
      const cs = getComputedStyle(e);
      const nums = (v) => (v.match(/\d+(\.\d+)?/g) || []).map(Number);
      const c = nums(cs.color);
      const bg = nums(cs.backgroundColor);
      return {
        color: [c[0], c[1], c[2]],
        // A region with its OWN translucent fill — the hero pill has one below
        // 768px — is not read against the photograph. WCAG compares the glyph
        // to the colour composited immediately behind it, which is
        // fill-over-photo. The fill is composited in here rather than sampled,
        // because the sampling pass hides the copy and would take the fill with
        // it. Transparent regions get alpha 0 and are unaffected.
        fill: bg.length >= 3 ? [bg[0], bg[1], bg[2], bg.length > 3 ? bg[3] : 1] : [0, 0, 0, 0],
      };
    });
  }
  /* The copy is hidden so the PHOTOGRAPH behind it can be sampled — and every
     fixed and sticky element on the page is hidden with it. An element
     screenshot of `.cr-hero` includes anything painted OVER it, and the hero is
     overlapped at BOTH ends: `.cr-topbar` is `position: sticky` and the hero
     carries a negative top margin that tucks it under the header, so the top
     ~52px of the hero screenshot is the WHITE HEADER. At 390px that put 1.4% of
     the headline's sample box at pure white, which is enough to drag a 99th
     percentile to 1.0 and report 1.00:1 for text that is actually white on a
     0.009-luminance photograph. The same thing happened at the other end when a
     bottom bar was pinned to the viewport.

     Hiding the chrome is not weakening the check: WCAG compares the glyph to
     what is composited immediately behind it, and the header is not behind the
     headline — it is in front of a different part of the hero. Whether fixed
     chrome sits over content is a real question, but an OCCLUSION one, and this
     gate is not where it is answered. */
  await page.addStyleTag({
    content:
      ".cr-hero__body,.cr-askc,.cr-topbar{visibility:hidden!important}",
  });
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
    const [fr, fg, fb, fa] = colors[k].fill;
    const over = (channel, sampled) => fa * channel + (1 - fa) * sampled;
    const ls = [];
    for (let i = 0; i < data.length; i += 4) {
      ls.push(lum(over(fr, data[i]), over(fg, data[i + 1]), over(fb, data[i + 2])));
    }
    ls.sort((a, b) => a - b);
    // 99th percentile: the brightest realistic backdrop, not a single stray pixel.
    const worst = ls[Math.floor(ls.length * 0.99)];
    const [r, g, bl] = colors[k].color;
    result[k] = {
      ratio: ratio(lum(r, g, bl), worst),
      color: `rgb(${r}, ${g}, ${bl})`,
      fill: colors[k].fill[3] > 0 ? `rgba(${colors[k].fill.join(", ")})` : null,
    };
  }
  return result;
}

/**
 * The sections on this page that paint TEXT OVER A PHOTOGRAPH. Same structural
 * test e2e/publicFamilyGates.mjs uses, and deliberately duplicated rather than
 * shared — these two harnesses are independent processes, and a refactor of one
 * must not silently change the other's verdict.
 *
 * `heroContrast` below samples exactly one region by name, so a SECOND
 * photographic band on PUB-001 would be measured by nothing. That is the shape
 * of the defect the family harness was extended to catch on PUB-011: white copy
 * at 3.19:1 that axe scores as a PASS at 18.24:1 and no gate reads. If the assertion that
 * uses this fails, the fix is to port that harness's `photoTextContrast` over,
 * not to widen the expected list.
 */
async function photographicSections(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("[data-couranr-section]")]
      .filter((sec) => {
        const r = sec.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return false;
        /* A CSS `background-image: url(...)` that covers the section is the same
           arrangement by another mechanism, and the first version of this
           predicate missed it entirely while its comment claimed to state its own
           limit. Gradients are background-images too, so this looks for a url()
           specifically — otherwise every scrim and tinted panel in the tree would
           register as a photograph. */
        const painted = [sec, ...sec.querySelectorAll("*")].some((el) => {
          const cs = getComputedStyle(el);
          if (!/url\(/.test(cs.backgroundImage)) return false;
          const er = el.getBoundingClientRect();
          return er.width >= r.width - 2 && er.height >= r.height - 2;
        });
        if (painted) return true;
        return [...sec.querySelectorAll("img")].some((img) => {
          const ir = img.getBoundingClientRect();
          if (ir.width < r.width - 2 || ir.height < r.height - 2) return false;
          /* THE LAYER THAT PUSHES THE IMAGE BEHIND THE COPY IS OFTEN NOT THE
             <img>: this page's own hero carries `position: absolute; z-index:
             -2` on its <picture> wrapper and leaves the <img> static inside it.
             Reading the <img> alone reported the hero as not photographic. */
          let outOfFlow = false;
          let z = null;
          for (let el = img; el && el !== sec; el = el.parentElement) {
            const cs = getComputedStyle(el);
            if (cs.position === "absolute" || cs.position === "fixed") outOfFlow = true;
            /* The MOST NEGATIVE explicit z-index on the climb, not the first one
               found. A wrapper with `z-index: 0` between the image and the
               section would otherwise mask a `z-index: -2` on the image itself
               and report the section as not photographic. */
            if (cs.zIndex !== "auto") {
              const v = Number(cs.zIndex);
              if (Number.isFinite(v) && (z === null || v < z)) z = v;
            }
          }
          return outOfFlow && z !== null && z < 0;
        });
      })
      .map((sec) => sec.getAttribute("data-couranr-section")),
  );
}

async function main() {
  await startServer();
  const browser = await chromium.launch({ executablePath: process.env.COURANR_BROWSER_EXECUTABLE || undefined });

  /* ══ GATE B ══════════════════════════════════════ runtime responsive ══ */
  console.log("\nGATE B — runtime responsive verification (§24.1)");
  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    const platform = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      /* The URL of a failed subresource is in location(), NOT in text(): text()
         is the generic "Failed to load resource: ... 404 (Not Found)" with no
         URL in it at all. Matching the exemption against text() would have
         exempted nothing — or, written loosely, everything. */
      const where = m.location()?.url || "";
      (PLATFORM_SERVED.test(where) ? platform : errors).push(`${m.text()} ${where}`.trim());
    });
    /* The evidence the exemption rests on, and a check in its own right: a 404
       that never reaches the console — a prefetch, an image, a fetch() whose
       rejection is swallowed — is invisible to the listener above. This says
       the platform path is the ONLY thing on this page that fails to resolve,
       so the exemption can never be quietly covering something else. */
    const badResponses = [];
    page.on("response", (r) => {
      if (r.status() >= 400 && !PLATFORM_SERVED.test(r.url())) {
        badResponses.push(`${r.status()} ${r.url()}`);
      }
    });
    const res = await page.goto(`${BASE}${PUB_001_ROUTE}`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    if (CONTROL && width === WIDTHS[0]) {
      /* POSITIVE CONTROL for the exemption above: emit an error of the kind the
         page itself could emit and prove it is still counted. One width only,
         so the control shows one red line rather than six. */
      await page.evaluate(() => console.error("planted: pub001 control console error"));
      await new Promise((r) => setTimeout(r, 250));
      controlConsoleCaught = errors.some((e) => e.includes("planted: pub001 control console error"));
    }

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
    check(
      errors.length === 0,
      `@${width} no console errors (${errors.slice(0, 1).join("") || "none"})` +
        (platform.length ? ` [${platform.length} platform-served exempt: /_vercel/*]` : ""),
    );
    check(
      badResponses.length === 0,
      `@${width} every non-platform subresource resolved ` +
        `(${badResponses.slice(0, 2).join("; ") || "none failed"})`,
    );
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
    await page.goto(`${BASE}${PUB_001_ROUTE}`, { waitUntil: "networkidle" });
    const before = await page.locator(".cr-topbar").evaluate((e) => Math.round(e.getBoundingClientRect().top));
    await page.evaluate(() => window.scrollTo(0, 2000));
    await page.waitForTimeout(150);
    /* This asserted `after === before`, which was only ever true because the
     * topbar happened to start at viewport top 0. A notice bar above the header
     * once made it start 47px down and pin at 0 — correct sticky behaviour that
     * the old equality read as a failure. The owner removed that bar on
     * 2026-08-29 and the topbar starts at 0 again, so the equality would pass
     * today; the generic form is kept because it is the one that states what
     * sticky actually promises: pinned at the CSS `top` offset, still on
     * screen, on a page that really scrolled. */
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
  await page.goto(`${BASE}${PUB_001_ROUTE}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  if (CONTROL) {
    console.log(
      "\npositive control — injecting a second h1, a low-contrast paragraph, and a " +
        "second photographic section",
    );
    await page.evaluate(() => {
      const h = document.createElement("h1");
      h.textContent = "Planted duplicate heading";
      document.querySelector(".cr-mkt").prepend(h);
      const p = document.createElement("p");
      p.textContent = "Planted low-contrast text";
      p.style.cssText = "color:#f2f2f2;background:#ffffff;font-size:14px";
      document.querySelector(".cr-mkt").prepend(p);
    });
    /* A second photographic band, in the arrangement the predicate looks for:
       a covering image, out of flow, behind the section's own content. The
       "hero is the only one" assertion must notice — a guard that cannot fail
       is not a guard, and this one shipped without a control the first time. */
    /* THE VICTIM IS DERIVED, not named. This planted into
       `[data-couranr-section="pickup-problem"]`, and the 2026-09
       marketing-architecture lock deleted that section — `querySelector`
       returned null and the whole control died on a TypeError before any
       assertion, so the proof that Gate C can go red silently stopped
       existing. Two sibling controls named the same section and were repaired;
       this third one was missed because it lives in e2e/, which the per-push
       tier never runs.

       Any non-hero section will do: what the predicate looks for is a SECOND
       photographic band, not a particular one. Picking the first section that
       is not the hero keeps the control alive across any future reorder. */
    const victim = await page.evaluate(() => {
      const secs = [...document.querySelectorAll("[data-couranr-section]")]
        .map((e) => e.getAttribute("data-couranr-section"))
        .filter((id) => id !== "hero");
      return secs[0] ?? null;
    });
    if (!victim) {
      console.error("test:pub001 positive control FAILED — no non-hero section to plant into");
      process.exit(1);
    }
    await page.evaluate((id) => {
      const sec = document.querySelector(`[data-couranr-section="${id}"]`);
      sec.style.position = "relative";
      sec.style.isolation = "isolate";
      const img = document.createElement("img");
      img.src = "/images/pub-001-hero-wide-1024.webp";
      img.alt = "";
      img.style.cssText =
        "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2";
      sec.prepend(img);
    }, victim);
    await page.waitForFunction(
      (id) => {
        const i = document.querySelector(`[data-couranr-section="${id}"] img`);
        return !!i && i.complete && i.naturalWidth > 0;
      },
      victim,
      { timeout: 15_000 },
    );
    await page.addScriptTag({ content: AXE_SOURCE });
    const r = await page.evaluate(async () =>
      await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag22aa"] } }),
    );
    const ids = r.violations.map((v) => v.id);
    const h1s = await page.evaluate(() => document.querySelectorAll("h1").length);
    // Read the planted section BEFORE the browser goes away — this is a live
    // page query, not a value already collected.
    const plantedPhotographic = await photographicSections(page);
    /* FOURTH PLANT — the historical defect itself, reproduced exactly. The
       original was a LATER declaration of identical specificity setting `78ch`
       over the hotfix's `62ch`, so the measure check is planted the same way:
       an appended stylesheet, same selector, no `!important`. It must live here
       rather than beside the measure block, because this control always
       `process.exit`s and a `CONTROL ?` branch down there would be dead code —
       which is precisely the mistake recorded further down this file. */
    await page.addStyleTag({ content: ".cr-mkt-proof__copy p { max-width: 78ch; }" });
    const shadowed = await measureHotfix(page, HOTFIX_MEASURES);
    const shadowedRow = shadowed.find((m) => m.sel === ".cr-mkt-proof__copy p");
    const caughtMeasure = !!shadowedRow && measureOff(shadowedRow);
    await browser.close();
    stopServer();
    const caughtSecondPhoto =
      plantedPhotographic.length === 2 && plantedPhotographic.includes(victim);
    const caughtContrast = ids.includes("color-contrast");
    const caughtH1 = h1s > 1;
    if (caughtContrast && caughtH1 && caughtSecondPhoto && caughtMeasure && controlConsoleCaught) {
      console.log(
        `test:pub001 positive control ok — axe flagged ${ids.join(", ")}, the page now has ${h1s} h1s, ` +
          `the planted second photographic section was detected ` +
          `(${plantedPhotographic.join(", ")}), the shadowed 78ch measure was caught ` +
          `(${shadowedRow.gotWidth.toFixed(1)}px against a ${shadowedRow.ch}ch authority of ` +
          `${(shadowedRow.ch * shadowedRow.ch1).toFixed(1)}px), and a planted console error was still ` +
          `counted past the /_vercel/* exemption, so Gates B and C can go red`,
      );
      process.exit(0);
    }
    console.error(
      `positive control FAILED — contrast caught: ${caughtContrast}, duplicate h1 caught: ${caughtH1}, ` +
        `second photographic section caught: ${caughtSecondPhoto} (${plantedPhotographic.join(", ") || "none"}), ` +
        `shadowed measure caught: ${caughtMeasure}, planted console error counted: ${controlConsoleCaught}`,
    );
    process.exit(1);
  }

  /* axe at BOTH art-directed widths. It ran at 1440 only, which left every
     rule that depends on layout or on a mobile-only colour unasserted: below
     768px the hero accent turns gold and the header sheds both auth actions
     into the drawer. None of that exists at 1440, so none of it was ever
     scanned. (This list used to name a navy notice bar and a fixed bottom
     bar; the owner removed the bottom bar on 2026-08-20 and the notice bar on
     2026-08-29, and neither is what the check is for.) */
  for (const width of [1440, 390]) {
    const apage =
      width === 1440 ? page : await browser.newPage({ viewport: { width, height: 844 } });
    if (apage !== page) await apage.goto(`${BASE}${PUB_001_ROUTE}`, { waitUntil: "networkidle" });
    await apage.evaluate(() => document.fonts.ready);
    await apage.addScriptTag({ content: AXE_SOURCE });
    const axe = await apage.evaluate(async () =>
      await window.axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
      }),
    );
    const violations = axe.violations.map(
      (v) => `${v.id} (${v.impact}, ${v.nodes.length}×): ${v.help}`,
    );
    check(violations.length === 0, `@${width} axe-core WCAG 2.2 AA: ${violations.length} violation(s)`);
    for (const v of violations) console.log(`         ${v}`);
    console.log(`         (${axe.passes.length} rules passed, ${axe.incomplete.length} need review)`);
    if (apage !== page) await apage.close();
  }

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

  /* MEASURE — the typography hotfix's regression check.

     This exists because that hotfix shipped a defect every other gate passed.
     `.cr-mkt-proof__copy p { max-width: 62ch }` was written, reviewed, built
     and deployed, and never applied: a later declaration in the same file had
     identical specificity and set 78ch, so the paragraph rendered ~1014px and
     ~80 characters a line. Nothing was red. Measuring the element in a browser
     is what caught it.

     Two assertions, both on the RENDER, never on the rule:

     1. Named elements this hotfix sized must still render THE MEASURE IT SET.
        Written as a count of `ch`, which is what the hotfix actually approved,
        not as the pixel count that count happened to come to in one browser.

        It was pixels — 690/888/806 — and those three numbers are not
        reproducible in any browser, including the one that recorded them. They
        imply 46.0px per `ch` for the 60px lead and 37.0px for the 49.8px
        accent, and those are the SAME font: `ch` scales with font-size, so one
        of them has to be wrong (37/46 = 0.804, but 49.8/60 = 0.83). Every
        recorded value is an exact integer of pixels — 46, 37, 13, and 40 and
        35 at the other widths in the review doc — which is the signature of an
        engine that rounded `ch` to whole pixels. Today's Chromium resolves it
        sub-pixel: 44.879, 37.250, 12.617. The hotfix's own note recorded
        `ch` here is 13px (Inter's 0 is 0.65em); the same byte-identical
        Inter-Variable.woff2 now measures 0.6309em.

        Nothing in the repo moved: the `15ch`/`24ch`/`62ch` declarations,
        `.cr-type-hero`, `.cr-hero__body`, `--couranr-container-max` and all
        three font files are byte-identical to the hotfix commit, and all three
        elements render their declared measure exactly. What moved is the
        browser — the Playwright this gate names is not installed on every
        machine that runs it.

        So the measure is asserted against `N * (1ch resolved here)`. That is
        strictly stronger than a pixel constant, not weaker: the shadowed `78ch`
        this check exists to catch still lands hundreds of pixels off its `62ch`
        authority, a container that starts clipping the measure still fails, and
        the expectation can no longer silently pass on a browser whose `ch`
        differs. The `ch` counts stay hard-coded here on purpose — reading them
        back out of couranr.css would make the check circular, because a
        shadowing declaration is exactly what it must not trust.

     2. A generic invariant: a heading's measure must be at least eight times
        its OWN font-size. This is the `ch`-scope failure written as something a
        browser can check. `max-width: 16ch` on the section rather than on the
        heading resolved against the section's small body font, so the
        display-face heading got a 240px column — 3.3x its 72px size — and broke
        mid-word across five lines. Eight is below every legitimate heading on
        this page (the narrowest is the card heading at 18x) and far above the
        defect, so it discriminates without policing composition.

     What this deliberately does NOT do is police the whole page's line length.
     The homepage's `62ch` house measure yields 77 characters at 16px and 87 at
     14px, because `ch` tracks the font rather than the character count — a real
     question, but a page-wide typography policy question for the owner, not
     something to settle inside a regression check. It is recorded in
     PUB_001_TYPOGRAPHY_HOTFIX_REVIEW.md instead. */
  const measured = await measureHotfix(page, HOTFIX_MEASURES);
  for (const m of measured) {
    if (m.missing) { check(false, `@1440 measure ${m.sel}: element not rendered`); continue; }
    check(
      !measureOff(m) && Math.abs(m.gotFont - m.font) <= 1,
      `@1440 measure ${m.sel}: ${m.gotWidth.toFixed(1)}px at ${m.gotFont}px ` +
        `(hotfix set ${m.ch}ch = ${(m.ch * m.ch1).toFixed(1)}px at ${m.font}px)`,
    );
  }

  const squeezed = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll(
      ".cr-mkt-section h2, .cr-mkt-editorial h1, .cr-mkt-editorial h2, .cr-mkt-card__h2",
    )) {
      const w = el.getBoundingClientRect().width;
      const f = parseFloat(getComputedStyle(el).fontSize);
      if (w === 0) continue;
      out.push({ text: el.textContent.trim().slice(0, 34), ratio: w / f, w: Math.round(w), f });
    }
    return out;
  });
  check(squeezed.length >= 8, `measure gate found ${squeezed.length} headings to check`);
  const worst = squeezed.reduce((a, b) => (b.ratio < a.ratio ? b : a), squeezed[0]);
  for (const h of squeezed) {
    if (h.ratio >= 8) continue;
    check(false, `@1440 heading "${h.text}…" has a ${h.w}px measure at ${h.f}px — ${h.ratio.toFixed(1)}x its own size, below the 8x floor`);
  }
  check(
    worst.ratio >= 8,
    `@1440 narrowest heading measure is "${worst.text}…" at ${worst.ratio.toFixed(1)}x its own font-size (floor 8x)`,
  );

  /* Contrast over the photograph, measured from painted pixels — AT BOTH
     art-directed widths. The hero swaps both its photographic crop and two of
     its text colours below 768px, so a single desktop measurement leaves the
     gold accent and the gold pill, which exist only on mobile, unmeasured over
     the crop they actually appear on. */
  for (const width of [1440, 390]) {
    const cpage =
      width === 1440 ? page : await browser.newPage({ viewport: { width, height: 844 } });
    if (cpage !== page) await cpage.goto(`${BASE}${PUB_001_ROUTE}`, { waitUntil: "networkidle" });
    await cpage.reload({ waitUntil: "networkidle" });
    await cpage.evaluate(() => document.fonts.ready);

    /* Checked at BOTH art-directed widths, because this is the one page whose
       imagery changes with the viewport — the hero swaps source files at 640px,
       and a band that is photographic only on mobile would be invisible to a
       1440-only assertion. It runs before `heroContrast`, which injects a
       stylesheet and reloads. */
    const photographic = await photographicSections(cpage);
    /* NO `CONTROL ?` BRANCH. One was added here and it was dead code: the
       control block earlier in this file always `process.exit`s, so this line
       only ever runs in a normal run where nothing is planted. The branch came
       with a comment asserting it ran under --positive-control, which was
       simply false — a comment is a factual claim like any other. The control's
       own assertion about the planted section lives where the plant does. */
    check(
      JSON.stringify(photographic) === JSON.stringify(["hero"]),
      `@${width} the hero is the only section painting text over photography, so ` +
        `heroContrast covers all of it (found: ${photographic.join(", ") || "none"})`,
    );

    const contrast = await heroContrast(cpage);
    for (const [region, c] of Object.entries(contrast)) {
      if (!c) { check(false, `@${width} hero ${region}: could not sample the painted background`); continue; }
      // The headline and its accent are large text (3:1 floor). The subhead
      // and the trust row are normal text (4.5:1).
      const floor = region === "headline" || region === "accent" ? 3 : 4.5;
      check(
        c.ratio >= floor,
        `@${width} hero ${region} over photography: ${c.ratio.toFixed(2)}:1 ` +
          `as painted (${c.color}${c.fill ? ` on ${c.fill}` : ""}, floor ${floor})`,
      );
    }
    if (cpage !== page) await cpage.close();
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

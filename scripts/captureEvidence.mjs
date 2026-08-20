#!/usr/bin/env node
/**
 * `node scripts/captureEvidence.mjs <before|after> [port]` — the PUB-001
 * evidence bundle COURANR_VISUAL_FIDELITY_AMENDMENT.md §10 requires under
 * docs/couranr-mvp/ui-reference/evidence/PUB-001/.
 *
 * §10 names the files, so the widths and the filenames are not parameters:
 *
 *   native-mock-references.md      current-branch-before-1440.png
 *   reconciled-after-1440.png      current-branch-before-390.png
 *   reconciled-after-390.png       PUB_001_VISUAL_DRIFT_LEDGER.csv
 *   region-review.md               typography-proof.json
 *   responsive-proof.json          accessibility-proof.json
 *   intentional-deviations.md
 *
 * The three `*-proof.json` files are MEASURED here, in a real browser, on the
 * `after` run. A hand-typed proof file is a claim, and §26's whole point is
 * that a claim is not evidence. The screenshots are full-page so a region that
 * moved is visible in the same frame as the regions that did not.
 *
 * The two markdown files and the ledger copy are written by hand and live in
 * the repo; this script does not generate them.
 *
 * `before` runs against a `next dev` server on the pre-correction tree (git
 * stash, capture, pop); `after` runs against a production build, which is also
 * what Gate B and Gate C measure. Both are recorded in region-review.md.
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "docs/couranr-mvp/ui-reference/evidence/PUB-001");
const phase = process.argv[2];
if (!["before", "after"].includes(phase)) {
  console.error("usage: captureEvidence.mjs <before|after> [port]");
  process.exit(2);
}
const port = Number(process.argv[3] || 3000);
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "/opt/node22/lib/node_modules/playwright");

const WIDTHS = [
  { w: 1440, h: 900, name: "1440" },
  { w: 390, h: 844, name: "390" },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
for (const { w, h, name } of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  // `load` never fires reliably against the dev server and `img.decode()` on a
  // source the server is still compiling never settles, so neither is waited on.
  // A fixed settle is enough for a photograph: the risk being managed is only
  // that a full-page shot records a grey box where the hero image belongs.
  await page.waitForTimeout(2000);
  // Images below the fold are lazy. A full-page shot renders the whole document
  // at once but does NOT trigger the loads a scroll would, so the footer
  // wordmark photographs as a blank — walk the page first, then return to the
  // top so the sticky chrome is where it belongs in the frame.
  await page.evaluate(async () => {
    const step = window.innerHeight;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(1200);
  const file = path.join(
    OUT,
    `${phase === "before" ? "current-branch-before" : "reconciled-after"}-${name}.png`,
  );
  await page.screenshot({ path: file, fullPage: true });
  console.log(`captured ${path.relative(ROOT, file)}`);
  await ctx.close();
}

/* ─────────────────────────────── the three measured proof files ───────── */

if (phase === "after") {
  /** §12's type roles, and where each is expected to appear on PUB-001. */
  const TYPE_SAMPLES = [
    ["hero headline", "h1.cr-type-hero, #hero-h"],
    ["hero small label", ".cr-hero__label"],
    ["hero supporting copy", ".cr-hero__sub"],
    ["editorial statement", ".cr-mkt-editorial--hero .cr-type-statement, .cr-type-statement"],
    ["marketing section heading", ".cr-type-marketing-section"],
    ["card section heading", ".cr-mkt-card__h2"],
    ["card title", ".cr-type-card-title"],
    ["lead paragraph", ".cr-type-lead"],
    ["metric", ".cr-type-metric"],
    ["small label", ".cr-type-label"],
  ];

  /** §24.1's six widths. Same list Gate B uses. */
  const GATE_B_WIDTHS = [360, 390, 768, 1024, 1280, 1440];

  const typography = { url: `http://127.0.0.1:${port}/`, widths: {} };
  const responsive = { url: `http://127.0.0.1:${port}/`, widths: {} };

  for (const width of GATE_B_WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);

    typography.widths[width] = await page.evaluate((samples) => {
      const out = {};
      for (const [role, sel] of samples) {
        const el = document.querySelector(sel);
        if (!el) {
          out[role] = null;
          continue;
        }
        const cs = getComputedStyle(el);
        out[role] = {
          selector: sel,
          fontFamily: cs.fontFamily.split(",")[0].replace(/["']/g, ""),
          fontSize: cs.fontSize,
          fontWeight: cs.fontWeight,
          lineHeight: cs.lineHeight,
          letterSpacing: cs.letterSpacing,
          color: cs.color,
        };
      }
      return out;
    }, TYPE_SAMPLES);

    responsive.widths[width] = await page.evaluate(async () => {
      const de = document.documentElement;
      const small = [];
      for (const el of document.querySelectorAll("a, button, summary, [role=button]")) {
        const b = el.getBoundingClientRect();
        if (b.width === 0 && b.height === 0) continue;
        if (b.height < 44) small.push(el.className || el.tagName);
      }
      const before = Math.round(document.querySelector(".cr-topbar").getBoundingClientRect().top);
      window.scrollTo(0, 2000);
      await new Promise((r) => setTimeout(r, 150));
      const bar = document.querySelector(".cr-topbar");
      const barBox = bar.getBoundingClientRect();
      // The bottom bar is fixed only below 768px; above it the same wrapper is
      // an ordinary static element whose CTA is hidden and whose only visible
      // child is the floating Ask Couranr launcher.
      const bottomBar = document.querySelector(".cr-mobilebar");
      const barFixed = bottomBar ? getComputedStyle(bottomBar).position === "fixed" : false;
      const askPill = document.querySelector(".cr-askc__pill");
      const askBox = askPill ? askPill.getBoundingClientRect() : null;
      window.scrollTo(0, 0);
      return {
        horizontalOverflow: de.scrollWidth > de.clientWidth + 1,
        scrollWidth: de.scrollWidth,
        clientWidth: de.clientWidth,
        governedSections: document.querySelectorAll("[data-couranr-section]").length,
        navigation:
          getComputedStyle(document.querySelector(".cr-topbar__links")).display === "none"
            ? "drawer"
            : "inline",
        headerAuthActionsVisible: [...document.querySelectorAll(".cr-topbar__auth")].some(
          (e) => getComputedStyle(e).display !== "none",
        ),
        heroSource: (document.querySelector(".cr-hero__photo")?.currentSrc || "").split("/").pop(),
        mobileBottomBar: barFixed,
        askCouranrTrigger: askBox
          ? { width: Math.round(askBox.width), height: Math.round(askBox.height) }
          : null,
        topbarTopAtRest: before,
        topbarTopAfter2000pxScroll: Math.round(barBox.top),
        // A BROADER sweep than Gate B's, which measures button-styled controls
        // only (see e2e/pub001Gates.mjs). Every anchor and summary is measured
        // here, so this list is expected to be non-empty: the wordmark, the
        // footer links and inline text links are all under 44px tall. WCAG 2.2
        // AA's own floor is 2.5.8 Target Size (Minimum) at 24px with a spacing
        // exception, and axe's `target-size` rule is in the accessibility proof
        // beside this file. Read this as a measurement, not a violation list.
        anchorsAndControlsUnder44pxHigh: [...new Set(small)],
      };
    });

    await ctx.close();
  }

  /* Accessibility: axe at WCAG 2.2 AA, plus the structural checks §23 names. */
  const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.addScriptTag({ content: AXE });
  const accessibility = await page.evaluate(async () => {
    const r = await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    });
    const levels = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) =>
      Number(h.tagName[1]),
    );
    const skips = levels.filter((l, i) => i > 0 && l - levels[i - 1] > 1);
    return {
      standard: "WCAG 2.2 AA (axe-core)",
      violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
      passes: r.passes.length,
      incomplete: r.incomplete.map((v) => v.id),
      h1Count: document.querySelectorAll("h1").length,
      headingLevels: levels,
      skippedHeadingLevels: skips.length,
      landmarks: {
        main: !!document.querySelector("main"),
        nav: document.querySelectorAll("nav").length,
        footer: !!document.querySelector("footer"),
      },
      skipLink: !!document.querySelector(".cr-skip-link"),
      nativeDisclosures: document.querySelectorAll("details.cr-mkt-faq__item").length,
    };
  });
  await ctx.close();

  const stamp = { generated_by: "scripts/captureEvidence.mjs", phase, port };
  for (const [name, body] of [
    ["typography-proof.json", { ...stamp, ...typography }],
    ["responsive-proof.json", { ...stamp, ...responsive }],
    ["accessibility-proof.json", { ...stamp, ...accessibility }],
  ]) {
    writeFileSync(path.join(OUT, name), `${JSON.stringify(body, null, 2)}\n`);
    console.log(`wrote ${path.relative(ROOT, path.join(OUT, name))}`);
  }
}

await browser.close();

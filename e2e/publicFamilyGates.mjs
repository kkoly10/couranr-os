/**
 * `npm run test:pub-family` — §26's Gate B and Gate C for the rest of the
 * public marketing family: PUB-008 /pricing, PUB-009 /businesses,
 * PUB-010 /service-areas, PUB-011 /how-it-works.
 *
 * GATE A CANNOT RUN HERE, and that is a fact about the inputs rather than a
 * shortcut. `UI_SCREEN_REGISTRY.md` records all four as "Derived from PUB-001
 * design system; no separate approved mock", and §26's Gate A is a named-region
 * comparison against a canonical mock. §29 step 5 asks each sibling to be
 * compared with its own mock "not merely with the golden screen" — where none
 * exists, the substitute is the family-coherence review in
 * docs/couranr-mvp/brand/PUB-FAMILY_V3_REVIEW.md, and §25's registry records
 * these screens as `visual_authority: "derived"` naming PUB-001.
 *
 * Gates B and C need a browser, not a mock, so they run in full:
 *
 * GATE B — §24.1's six real browser widths: no horizontal overflow, the
 *   governed sections all render, the primary action is reachable and
 *   unclipped, button-styled controls meet their §18 height, no console errors.
 *   The section list and count come from §27.1 via the shared composition
 *   contract — this harness does not know how many sections a page has, it
 *   reads the spec, so a page and a table that disagree fail here as well as in
 *   the unit test.
 *
 * GATE C — axe-core at WCAG 2.2 AA, one h1, no skipped heading levels,
 *   landmarks, skip link, keyboard focus visible, reduced motion honoured.
 *   No hero-photograph contrast sampling: none of these four renders text over
 *   photography, so the measurement PUB-001 needs has nothing to measure.
 *
 * Runs against a PRODUCTION build for the same reason `pub001Gates` does —
 * `next dev` emits 403s on its own chunks and a failed HMR socket, and reading
 * that noise as signal nearly recorded a clean page as broken once already.
 *
 * `--positive-control` injects a duplicate h1 and an overflowing element and
 * fails if the gates do not report both.
 */

import { spawn } from "node:child_process";
import { openSync, readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { governedPages, specRows } from "../scripts/compositionContract.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PUBFAMILY_PORT || 3101);
const BASE = `http://127.0.0.1:${PORT}`;
const ART = path.join(ROOT, "e2e/artifacts/pub-family");
const CONTROL = process.argv.includes("--positive-control");

const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_PATH || "/opt/node22/lib/node_modules/playwright",
);
const AXE_SOURCE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

/** §24.1 — the widths public marketing must be verified at. */
const WIDTHS = [360, 390, 768, 1024, 1280, 1440];

/** The four family pages and their expected sections, straight from §27.1. */
const SPEC = readFileSync(
  path.join(ROOT, "docs/couranr-mvp/brand/COURANR_VISUAL_SYSTEM_V2_2.md"),
  "utf8",
);
const PAGES = governedPages(SPEC)
  .filter((p) => p.screen !== "PUB-001")
  .map((p) => ({ ...p, sections: specRows(SPEC, p).map((r) => r.id) }));

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
  const log = openSync(path.join(ROOT, "e2e/artifacts/pub-family-server.log"), "w");
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

async function main() {
  await startServer();
  const browser = await chromium.launch();

  for (const page of PAGES) {
    /* ══ GATE B ═══════════════════════════════════ runtime responsive ══ */
    console.log(`\nGATE B — ${page.screen} ${page.route} (§24.1)`);

    for (const width of WIDTHS) {
      const tab = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      tab.on("pageerror", (e) => errors.push(e.message));
      tab.on("console", (m) => m.type() === "error" && errors.push(m.text()));

      const res = await tab.goto(`${BASE}${page.route}`, { waitUntil: "networkidle" });
      await tab.evaluate(() => document.fonts.ready);

      if (CONTROL && width === WIDTHS[0]) {
        // Plant an element wider than the viewport. Gate B must notice.
        await tab.evaluate(() => {
          const d = document.createElement("div");
          d.style.cssText = "width:200vw;height:4px";
          document.body.appendChild(d);
        });
      }

      const m = await tab.evaluate(() => {
        const de = document.documentElement;
        // §23.6's 44px floor applies to standalone controls, not to inline text
        // links — WCAG 2.2 AA's 2.5.8 asks 24×24 with an explicit inline
        // exception, and §18 defines a deliberate 40px small-button size.
        const small = [...document.querySelectorAll(".cr-button, .cr-icon-button, button, [role=button]")]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            if (cs.display === "none" || cs.visibility === "hidden" || r.width === 0) return false;
            const floor = el.classList.contains("cr-button--sm") ? 40 : 44;
            return r.height + 0.5 < floor;
          })
          .map((el) => `${el.className || el.tagName}@${Math.round(el.getBoundingClientRect().height)}px`);

        const primary = document.querySelector(".cr-mkt .cr-button--primary");
        const pr = primary?.getBoundingClientRect();

        return {
          scrollW: de.scrollWidth,
          clientW: de.clientWidth,
          hScroll: de.scrollWidth > de.clientWidth + 1,
          sections: [...document.querySelectorAll("[data-couranr-section]")].map(
            (s) => s.dataset.couranrSection,
          ),
          ctaVisible: !!pr && pr.width > 0 && pr.right <= de.clientWidth + 1,
          smallTargets: small,
        };
      });

      check(res.status() === 200, `@${width} returns 200`);
      check(!m.hScroll, `@${width} no horizontal overflow (${m.scrollW}/${m.clientW})`);
      check(
        JSON.stringify(m.sections) === JSON.stringify(page.sections),
        `@${width} renders §27.1's ${page.sections.length} sections in order (${m.sections.join(",") || "none"})`,
      );
      check(m.ctaVisible, `@${width} the primary action is visible and unclipped`);
      check(
        m.smallTargets.length === 0,
        `@${width} button controls meet their §18 height (${m.smallTargets.join(", ") || "all pass"})`,
      );
      check(errors.length === 0, `@${width} no console errors (${errors.slice(0, 1).join("") || "none"})`);

      if (width === WIDTHS[WIDTHS.length - 1]) {
        await tab.screenshot({
          path: path.join(ART, `${page.screen}-desktop.png`),
          fullPage: true,
        });
      }
      if (width === WIDTHS[1]) {
        await tab.screenshot({
          path: path.join(ART, `${page.screen}-mobile.png`),
          fullPage: true,
        });
      }
      await tab.close();
    }

    /* ══ GATE C ═════════════════════════════════════════ accessibility ══ */
    console.log(`\nGATE C — ${page.screen} accessibility (§23)`);
    const tab = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
    await tab.goto(`${BASE}${page.route}`, { waitUntil: "networkidle" });
    await tab.evaluate(() => document.fonts.ready);

    if (CONTROL) {
      await tab.evaluate(() => {
        const h = document.createElement("h1");
        h.textContent = "planted duplicate";
        document.body.appendChild(h);
      });
    }

    await tab.addScriptTag({ content: AXE_SOURCE });
    const axe = await tab.evaluate(async () =>
      await window.axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
      }),
    );
    check(
      axe.violations.length === 0,
      `${page.screen} axe-core WCAG 2.2 AA: ${axe.violations.length} violation(s)` +
        (axe.violations.length
          ? ` — ${axe.violations.map((v) => `${v.id}(${v.nodes.length})`).join(", ")}`
          : ` (${axe.passes.length} rules passed)`),
    );

    const structure = await tab.evaluate(() => {
      const hs = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) =>
        Number(h.tagName[1]),
      );
      const skips = [];
      for (let i = 1; i < hs.length; i++) if (hs[i] - hs[i - 1] > 1) skips.push(`${hs[i - 1]}→${hs[i]}`);
      return {
        h1: document.querySelectorAll("h1").length,
        skips,
        landmarks: {
          main: !!document.querySelector("main"),
          nav: !!document.querySelector("nav"),
          footer: !!document.querySelector("footer"),
        },
        skipLink: !!document.querySelector(".cr-skip-link"),
      };
    });
    check(structure.h1 === 1, `${page.screen} exactly one h1 (${structure.h1})`);
    check(structure.skips.length === 0, `${page.screen} no skipped heading levels (${structure.skips.join(",") || "none"})`);
    check(
      structure.landmarks.main && structure.landmarks.nav && structure.landmarks.footer,
      `${page.screen} landmarks present (main/nav/footer)`,
    );
    check(structure.skipLink, `${page.screen} skip link present`);

    await tab.keyboard.press("Tab");
    const focused = await tab.evaluate(() => {
      const el = document.activeElement;
      const cs = getComputedStyle(el);
      return {
        cls: el?.className || el?.tagName,
        ring: cs.outlineStyle !== "none" || cs.boxShadow !== "none",
      };
    });
    check(String(focused.cls).includes("cr-skip-link"), `${page.screen} first Tab reaches the skip link (${focused.cls})`);
    check(focused.ring, `${page.screen} focus is visibly indicated`);

    await tab.close();

    const reduced = await browser.newPage({
      viewport: { width: 1440, height: 1024 },
      reducedMotion: "reduce",
    });
    await reduced.goto(`${BASE}${page.route}`, { waitUntil: "domcontentloaded" });
    const dur = await reduced.evaluate(() => {
      const el = document.querySelector(".cr-button");
      return el ? getComputedStyle(el).transitionDuration : "none";
    });
    // Serialized as `1e-05s`, not `0.01ms` — parse it, do not pattern-match.
    const seconds = parseFloat(dur);
    check(
      Number.isFinite(seconds) && seconds < 0.05,
      `${page.screen} reduced motion collapses transitions (${dur})`,
    );
    await reduced.close();
  }

  await browser.close();
  stopServer();

  if (CONTROL) {
    const caught =
      failures.some((f) => f.includes("no horizontal overflow")) &&
      failures.some((f) => f.includes("exactly one h1"));
    if (!caught) {
      console.error(
        "\npositive control FAILED — a planted overflow and duplicate h1 were not both detected",
      );
      console.error(failures.length ? failures.join("\n") : "  (nothing was reported at all)");
      process.exit(1);
    }
    console.log("\ntest:pub-family positive control ok — both planted defects were flagged");
    process.exit(0);
  }

  if (failures.length) {
    console.error(`\ntest:pub-family: ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(
    `\ntest:pub-family: Gate B and Gate C pass for ${PAGES.length} pages. Evidence in e2e/artifacts/pub-family/`,
  );
}

main().catch((e) => {
  stopServer();
  console.error(e);
  process.exit(1);
});

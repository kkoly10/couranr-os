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
 *   landmarks, skip link, keyboard focus visible, reduced motion honoured, and
 *   §23.2's contrast measurement for any text painted over a photograph.
 *
 *   THAT LAST CHECK REPLACES A COMMENT THAT WENT STALE AND HID A REAL DEFECT.
 *   It used to read "none of these four renders text over photography, so the
 *   measurement PUB-001 needs has nothing to measure" — true when it was
 *   written, false the moment PUB-011's `confirmation` band took a photograph.
 *   White copy over that frame measured 4.08:1 at 390px against §23.2's 4.5:1
 *   floor and no gate saw it: axe reports text over a background image as
 *   `incomplete` rather than a violation, and Gate C ran at 1440 only, where
 *   the same band measures 14.9:1. So the harness no longer carries a claim
 *   about which pages have photography — it DISCOVERS them, at each of §24.1's
 *   six widths, and measures whatever it finds. A page that adds a photographic
 *   band tomorrow is covered without anyone remembering to amend this comment.
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

/* Relative luminance and contrast, WCAG 2.x definitions. Duplicated from
   e2e/pub001Gates.mjs rather than shared: the two harnesses are deliberately
   independent processes, and three lines of arithmetic are not worth a module
   that would let one gate's refactor silently change the other's verdict. */
const lin = (c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * Finds the governed sections that paint TEXT OVER A PHOTOGRAPH, by what is
 * actually rendered rather than by a list kept in this file. The test is
 * structural: an `<img>` inside the section, positioned out of flow, on a
 * NEGATIVE z-index, covering the section's own box. That is precisely the
 * "photo behind the content" arrangement — a photograph that merely sits in
 * the section as an ordinary block has text beside it, not over it, and axe
 * already handles that case correctly.
 *
 * Discovered per width, because a band can be photographic at one width and
 * not another: `<picture>` art direction and a `display: none` at a breakpoint
 * both change the answer.
 *
 * KNOWN LIMIT, stated rather than left to be discovered: a section that puts
 * its photograph behind the copy by DOM order and a positioned foreground,
 * with no negative z-index anywhere, is not detected. Both bands in the tree
 * use the negative-z-index arrangement, and widening the predicate to "any
 * covering image" would sweep in the ordinary side-by-side frames on
 * `category-breadth` and `outcomes`, where the text is beside the picture and
 * axe already reads the contrast correctly. If a third arrangement appears,
 * this is the function to extend — not the caller.
 */
const findPhotographicSections = () =>
  [...document.querySelectorAll("[data-couranr-section]")]
    .filter((sec) => {
      const r = sec.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      return [...sec.querySelectorAll("img")].some((img) => {
        const ir = img.getBoundingClientRect();
        if (ir.width < r.width - 2 || ir.height < r.height - 2) return false;
        /* THE LAYER THAT PUSHES THE IMAGE BEHIND THE COPY IS OFTEN NOT THE
           <img>. PUB-001's hero carries `position: absolute; z-index: -2` on
           its <picture> wrapper and leaves the <img> inside it static at
           100%/100%; PUB-011's band carries both on the <img> itself. Reading
           the <img> alone reported the hero as not photographic. So climb to
           the section and take the first positioning and the first explicit
           z-index found on the way. */
        let outOfFlow = false;
        let z = null;
        for (let el = img; el && el !== sec; el = el.parentElement) {
          const cs = getComputedStyle(el);
          if (cs.position === "absolute" || cs.position === "fixed") outOfFlow = true;
          if (z === null && cs.zIndex !== "auto") z = Number(cs.zIndex);
        }
        return outOfFlow && z !== null && z < 0;
      });
    })
    .map((sec) => sec.getAttribute("data-couranr-section"));

/**
 * §23.2, verbatim: "Text over photography must be measured against the actual
 * painted region after crop/overlay. Do not assume a Navy scrim automatically
 * passes."
 *
 * So this measures the PAINTED pixels, not the scrim's declared alpha. The
 * text is hidden, the section is screenshotted, and each text element's own box
 * is sampled out of that image. Three things it does that a naive version
 * would not:
 *
 *   - It composites the glyph's OWN alpha over the sampled ground. This band's
 *     body copy is `rgba(255,255,255,0.86)` and its note `rgba(255,255,255,0.7)`
 *     — measuring those as if they were `#fff` overstates them.
 *   - It takes the worse of the 1st and 99th luminance percentiles, so it is
 *     correct for dark text on a bright frame as well as light text on a dark
 *     one, and a single stray pixel cannot decide the verdict either way.
 *   - It derives the floor from the computed font metrics (WCAG large text:
 *     >=24px, or >=18.66px at weight 700+), rather than from a hand-kept list
 *     of which regions count as headings.
 */
async function photoTextContrast(tab, sectionId) {
  const probes = await tab.evaluate((id) => {
    const sec = document.querySelector(`[data-couranr-section="${id}"]`);
    sec.scrollIntoView({ block: "center" });
    const box = sec.getBoundingClientRect();
    const nums = (v) => (v.match(/[\d.]+/g) || []).map(Number);
    const out = [];
    let n = 0;
    for (const el of sec.querySelectorAll("*")) {
      const own = [...el.childNodes].some(
        (c) => c.nodeType === 3 && c.textContent.trim().length > 1,
      );
      if (!own) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      const c = nums(cs.color);
      const bg = nums(cs.backgroundColor);
      const size = parseFloat(cs.fontSize);
      const weight = Number(cs.fontWeight) || 400;
      const key = `${el.tagName.toLowerCase()}.${(el.className || "").toString().split(/\s+/)[0] || "-"}#${n}`;
      el.setAttribute("data-crphototext", String(n++));
      out.push({
        key,
        rect: {
          x: Math.max(0, Math.round(r.x - box.x)),
          y: Math.max(0, Math.round(r.y - box.y)),
          w: Math.round(r.width),
          h: Math.round(r.height),
        },
        color: [c[0], c[1], c[2], c.length > 3 ? c[3] : 1],
        /* An element with its own translucent fill is not read against the
           photograph directly — WCAG compares the glyph to what is composited
           immediately behind it. The fill is composited here rather than
           sampled, because the sampling pass hides the text and takes the
           fill with it. */
        fill: bg.length >= 3 ? [bg[0], bg[1], bg[2], bg.length > 3 ? bg[3] : 1] : [0, 0, 0, 0],
        floor: size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5,
        text: (el.textContent || "").trim().slice(0, 44),
      });
    }
    return out;
  }, sectionId);

  if (!probes.length) return [];

  /* The text goes; so does the sticky chrome, which an element screenshot
     would otherwise composite into the top of the sample. Same reasoning as
     pub001Gates: the header is not BEHIND this text, it is in front of a
     different part of the page, and whether fixed chrome occludes content is a
     separate question this gate does not answer. */
  await tab.addStyleTag({
    content:
      "[data-crphototext]{visibility:hidden!important}.cr-topbar,.cr-topnotice,.cr-askc{visibility:hidden!important}",
  });
  const shot = await tab
    .locator(`[data-couranr-section="${sectionId}"]`)
    .screenshot();

  const sampled = await tab.evaluate(
    async ({ b64, probes }) => {
      const img = new Image();
      img.src = "data:image/png;base64," + b64;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      return probes.map((p) => {
        const w = Math.min(p.rect.w, img.width - p.rect.x);
        const h = Math.min(p.rect.h, img.height - p.rect.y);
        if (w <= 0 || h <= 0) return null;
        return Array.from(ctx.getImageData(p.rect.x, p.rect.y, w, h).data);
      });
    },
    { b64: shot.toString("base64"), probes },
  );

  const results = [];
  probes.forEach((p, i) => {
    const data = sampled[i];
    if (!data) {
      results.push({ ...p, ratio: null });
      return;
    }
    const [fr, fg, fb, fa] = p.fill;
    /* Every sampled pixel, with the element's own fill already composited over
       it, sorted by luminance. The 1st and 99th percentiles are taken as
       PIXELS rather than as luminances, because the glyph's alpha has to be
       composited over the ground's channels to get the colour actually
       painted. */
    const px = [];
    for (let j = 0; j < data.length; j += 4) {
      px.push([
        fa * fr + (1 - fa) * data[j],
        fa * fg + (1 - fa) * data[j + 1],
        fa * fb + (1 - fa) * data[j + 2],
      ]);
    }
    px.sort((a, b) => lum(...a) - lum(...b));
    const [cr, cg, cb, ca] = p.color;
    const against = (ground) =>
      ratio(
        lum(
          ca * cr + (1 - ca) * ground[0],
          ca * cg + (1 - ca) * ground[1],
          ca * cb + (1 - ca) * ground[2],
        ),
        lum(...ground),
      );
    /* Both extremes, worse of the two: correct for dark text on a bright frame
       as well as light text on a dark one, and no single stray pixel decides
       the verdict in either direction. */
    const worst = Math.min(
      against(px[Math.floor(px.length * 0.01)]),
      against(px[Math.floor(px.length * 0.99)]),
    );
    results.push({ ...p, ratio: worst });
  });
  return results;
}

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

      /* ── §23.2 contrast over photography ────────────────────────────────
         A Gate C check running inside Gate B's loop, deliberately. The floor
         is §23.2's and the finding is an accessibility one, but the DEFECT IS
         WIDTH-DEPENDENT — this band passed at 14.9:1 at 1440 and failed at
         4.08:1 at 390, because the scrim was a horizontal gradient written for
         a copy well that only sits in the band's left half while the band is
         wide. Gate C runs at 1440. Re-opening six more tabs to keep the
         labels tidy would cost six page loads to learn nothing, so the
         measurement runs where the six widths already are, and says which
         gate it belongs to. It runs LAST in the loop because it hides text and
         injects a stylesheet — nothing after it may read this tab. */
      const photographic = await tab.evaluate(findPhotographicSections);
      if (CONTROL && photographic.length && width === WIDTHS[1]) {
        // Take the scrim away and the copy sits on the raw frame. The new
        // check must notice; if it cannot fail, it is not a gate.
        await tab.addStyleTag({
          content: ".cr-mkt-band__scrim{background:none!important;display:none!important}",
        });
      }
      if (!photographic.length) {
        console.log(`  --    @${width} §23.2 text-over-photography: no photographic section`);
      }
      for (const id of photographic) {
        const measured = await photoTextContrast(tab, id);
        for (const r of measured) {
          if (r.ratio === null) {
            check(false, `@${width} ${id} "${r.text}": the painted region could not be sampled`);
            continue;
          }
          check(
            r.ratio >= r.floor,
            `@${width} ${id} "${r.text}" over photography: ${r.ratio.toFixed(2)}:1 as painted ` +
              `(rgba(${r.color.join(", ")}), floor ${r.floor})`,
          );
        }
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
      failures.some((f) => f.includes("exactly one h1")) &&
      // The scrim was removed under the photographic band; §23.2's measurement
      // must report the copy failing on the raw frame.
      failures.some((f) => f.includes("over photography"));
    if (!caught) {
      console.error(
        "\npositive control FAILED — a planted overflow, duplicate h1 and " +
          "scrimless text-over-photography were not all detected",
      );
      console.error(failures.length ? failures.join("\n") : "  (nothing was reported at all)");
      process.exit(1);
    }
    console.log("\ntest:pub-family positive control ok — all three planted defects were flagged");
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

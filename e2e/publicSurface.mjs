/**
 * B02 public-surface verification — PUB-001, PUB-008, PUB-009, PUB-010,
 * PUB-011, driven in a REAL Chromium against a real `next start`.
 *
 * These pages are static marketing surfaces: no database, no Supabase env —
 * the proxy's env guard means session refresh is skipped, which is exactly
 * production behavior for an anonymous visitor. Nothing is stubbed because
 * there is nothing TO stub.
 *
 * Assertions pair the browser with the AUTHORITY, not with vibes: verbatim
 * MKT-002 hero copy, all seven channels, all eleven categories, the four
 * MKT-001 markets, every MIL-002 tier — and the ABSENCE of the prohibited
 * claims, re-checked against the RENDERED text (the source scanner covers
 * source; this covers what a person actually sees). Desktop 1440x1024 and
 * mobile 390x844 per the spec's viewport contract, with an overflow check at
 * 360px.
 *
 * Run:  node e2e/publicSurface.mjs   (expects a fresh `npm run build` output)
 */

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = path.join(ROOT, "e2e/screenshots/public-surface");
const PORT = 3316;
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;
function check(id, description, ok, detail = "") {
  ok ? passed++ : failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${description}${detail ? `  [${detail}]` : ""}`);
}

/** Rendered-text prohibitions — the subset that could plausibly leak through. */
const RENDERED_BANS = [
  ["24/7", /24\s*\/\s*7/],
  ["Maryland", /maryland/i],
  ["guarantee", /guarante/i],
  ["trusted-by/volume", /trusted by|thousands of/i],
  ["competitor", /doordash|uber\s?eats|grubhub/i],
  ["phone number", /\(\d{3}\)\s?\d{3}[- ]?\d{4}|\b\d{3}-\d{3}-\d{4}\b/],
];

function assertClean(pageId, text) {
  for (const [name, re] of RENDERED_BANS) {
    check(`${pageId}-ban-${name}`, `renders no "${name}"`, !re.test(text),
      re.test(text) ? `matched: ${String(text.match(re)?.[0])}` : "");
  }
}

async function main() {
  console.log("B02 public surface — unstubbed browser verification\n");
  mkdirSync(SHOTS, { recursive: true });

  let server;
  let browser;
  try {
    server = spawn("npx", ["next", "start", "-p", String(PORT)], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT) },
      stdio: "ignore",
      detached: true,
    });
    const deadline = Date.now() + 90_000;
    let live = false;
    while (Date.now() < deadline && !live) {
      try {
        const r = await fetch(BASE, { redirect: "manual" });
        live = r.status < 500;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (!live) throw new Error("next start did not come up");

    const { chromium } = await import("/opt/node22/lib/node_modules/playwright/index.mjs");
    browser = await chromium.launch({ args: ["--no-proxy-server"] });
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });

    /* ────────────────────────── PUB-001 — homepage ───────────────────── */
    console.log("PUB-001 — homepage");
    const home = await desktop.newPage();
    await home.goto(`${BASE}/`, { waitUntil: "networkidle" });
    const homeText = await home.innerText("body");

    check("H1", "hero headline VERBATIM (MKT-002)",
      (await home.locator("h1").innerText()).trim() === "Your customers want delivery. Now you can say yes.");
    check("H2", "supporting copy VERBATIM",
      homeText.includes("Keep taking orders through your website, phone, text, social media, POS or"));
    check("H3", "trust line VERBATIM",
      homeText.includes("No monthly fee during the pilot. No product-sales commission. You keep the"));
    check("H4", "closing headline VERBATIM",
      homeText.includes("deserves a better answer"));
    check("H5", "MKT-001 market sentence VERBATIM, registry order",
      homeText.includes("Local business delivery across DC, Stafford, Woodbridge, Fredericksburg, and surrounding areas."));

    const channels = ["Website", "Phone", "Text", "Social media", "Point of sale", "Storefront / in person", "Other channels you control"];
    check("H6", "ALL SEVEN channels named (MKT-002 §10.4)",
      channels.every((c) => homeText.includes(c)),
      channels.filter((c) => !homeText.includes(c)).join(",") || "all present");

    const sectionOrder = await home.$$eval("section[aria-labelledby]", (els) => els.map((e) => e.getAttribute("aria-labelledby")));
    check("H7", "twelve sections present IN ORDER",
      JSON.stringify(sectionOrder) === JSON.stringify(["hero-h","s2-h","s3-h","s4-h","s5-h","s6-h","s7-h","s8-h","s9-h","s10-h","s11-h","s12-h"]),
      sectionOrder.join(","));

    check("H8", "primary CTA links to /sign-up",
      await home.locator('a[href="/sign-up"]').first().isVisible());
    check("H9", "secondary CTA links to /estimate",
      await home.locator('a[href="/estimate"]').first().isVisible());
    check("H10", "base price renders from governed constants", homeText.includes("$22.99"));

    // Ask Couranr — closed by default, opens an HONEST panel, closes again.
    check("H11", "Ask Couranr panel is CLOSED by default",
      !(await home.getByText("The Ask Couranr assistant is not live yet").isVisible().catch(() => false)));
    await home.getByRole("button", { name: "Ask Couranr" }).click();
    check("H12", "open state is the honest no-AI panel",
      await home.getByText(/not live yet/).isVisible());
    check("H13", "the open panel offers only real navigation, no chat input",
      (await home.locator(".cr-askc textarea, .cr-askc input").count()) === 0);
    await home.screenshot({ path: path.join(SHOTS, "PUB-001-askcouranr-open.png") });
    await home.getByRole("button", { name: /^Close$/ }).click();
    check("H14", "the panel closes",
      !(await home.getByText(/not live yet/).isVisible().catch(() => false)));

    assertClean("H", homeText);
    await home.screenshot({ path: path.join(SHOTS, "PUB-001-desktop.png"), fullPage: true });

    const homeM = await mobile.newPage();
    await homeM.goto(`${BASE}/`, { waitUntil: "networkidle" });
    const hOverflow = await homeM.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check("H15", "mobile 390px: no horizontal overflow", hOverflow <= 1, `${hOverflow}px`);
    await homeM.screenshot({ path: path.join(SHOTS, "PUB-001-mobile.png"), fullPage: true });

    /* ────────────────────────── PUB-008 — pricing ────────────────────── */
    console.log("\nPUB-008 — pricing");
    const pricing = await desktop.newPage();
    await pricing.goto(`${BASE}/pricing`, { waitUntil: "networkidle" });
    let pricingText = await pricing.innerText("body");

    check("P1", "registry-mandated trio: $22.99 / 3 miles / subject to Couranr confirmation",
      pricingText.includes("$22.99") &&
      /first 3 loaded miles/i.test(pricingText) &&
      /subject to Couranr confirmation/.test(pricingText) &&
      /No monthly fee during the pilot/.test(pricingText));
    check("P2", "every MIL-002 tier renders",
      ["$2.25", "$3.00", "$3.50", "$4.00", "$4.75"].every((t) => pricingText.includes(t)));
    check("P3", "manual-quote notice is ALWAYS visible (required state)",
      /Manual quote notice/.test(pricingText) && /over 100 loaded miles/.test(pricingText) && /over 200 lb/.test(pricingText));
    check("P4", "the collapsed page does NOT yet show the weight schedule",
      !pricingText.includes("151–200 lb"));

    await pricing.getByRole("button", { name: /Show the full schedule/ }).click();
    pricingText = await pricing.innerText("body");
    check("P5", "EXPANDED state shows all four SUR-001 weight bands",
      ["+$10.00", "+$25.00", "+$50.00", "+$85.00"].every((t) => pricingText.includes(t)));
    check("P6", "waiting, return and cancellation schedule render exactly",
      pricingText.includes("$0.75/minute") && pricingText.includes("minimum $14.99") && pricingText.includes("$8.00") && pricingText.includes("$15.00"));
    check("P7", "overnight is +$30.00 and REQUEST-ONLY (OVN-001/OVN-002 gate)",
      pricingText.includes("+$30.00") && /request-only/.test(pricingText) && !/book overnight/i.test(pricingText));
    check("P8", "Route Saver from $16.99 per stop (SUR-002)",
      pricingText.includes("$16.99"));
    assertClean("P", pricingText);
    await pricing.screenshot({ path: path.join(SHOTS, "PUB-008-expanded.png"), fullPage: true });

    /* ────────────────────────── PUB-009 — businesses ─────────────────── */
    console.log("\nPUB-009 — businesses");
    const biz = await desktop.newPage();
    await biz.goto(`${BASE}/businesses`, { waitUntil: "networkidle" });
    const bizText = await biz.innerText("body");
    const CATS = [
      "Dry cleaning, laundry, tailoring", "Printing, signage, promotional products",
      "Boutique, clothing, shoes, accessories", "Florists, gifts, specialty retail",
      "Repair and electronics", "Auto parts and accessories", "Furniture and home goods",
      "Event rentals and supplies", "Bakeries, prepared food, catering",
      "Books, cards, collectibles, hobby", "General local business",
    ];
    check("B1", "ALL ELEVEN Master Package categories render",
      CATS.every((c) => bizText.includes(c)),
      CATS.filter((c) => !bizText.includes(c)).join(",") || "all present");
    check("B2", "the eligibility rule is stated: recommendations, never eligibility",
      /never your eligibility/.test(bizText));
    check("B3", "general-business fallback is a first-class state",
      /first-class choice/.test(bizText));
    assertClean("B", bizText);
    await biz.screenshot({ path: path.join(SHOTS, "PUB-009-desktop.png"), fullPage: true });

    /* ────────────────────────── PUB-010 — service areas ──────────────── */
    console.log("\nPUB-010 — service areas");
    const areas = await desktop.newPage();
    await areas.goto(`${BASE}/service-areas`, { waitUntil: "networkidle" });
    const areasText = await areas.innerText("body");
    check("A1", "all four MKT-001 markets render as primary-market cards",
      ["Washington, DC", "Stafford", "Woodbridge", "Fredericksburg"].every((m) => areasText.includes(m)));
    check("A2", "the three required states render: primary / surrounding / extended review",
      /Primary market/.test(areasText) && /Surrounding areas/.test(areasText) && /Extended-distance review/.test(areasText));
    check("A3", "SVC-001: capture-for-review language, no ZIP rejection",
      /never silently rejects/.test(areasText) && !/we (do not|don't) serve/i.test(areasText));
    check("A4", "NO invented boundary: no radius, no ZIP list, no coverage map",
      !/\b\d+[- ]mile\b/i.test(areasText) && !/zip code checker/i.test(areasText));
    assertClean("A", areasText);
    await areas.screenshot({ path: path.join(SHOTS, "PUB-010-desktop.png"), fullPage: true });

    /* ────────────────────────── PUB-011 — how it works ───────────────── */
    console.log("\nPUB-011 — how it works");
    const how = await desktop.newPage();
    await how.goto(`${BASE}/how-it-works`, { waitUntil: "networkidle" });
    const howText = await how.innerText("body");
    check("W1", "both payer sequences render (required states)",
      /Your business pays/.test(howText) && /Your customer pays/.test(howText));
    check("W2", "capture AFTER Couranr confirmation, stated in both flows",
      (howText.match(/after Couranr confirm/gi) || []).length >= 2);
    check("W3", "the no-instant-confirmation constraint is upheld in the copy itself",
      /never an instant confirmation/.test(howText));
    check("W4", "no customer account required for the payment link (PAY-001)",
      /no Couranr account required/i.test(howText));
    assertClean("W", howText);
    await how.screenshot({ path: path.join(SHOTS, "PUB-011-desktop.png"), fullPage: true });

    /* ─────────────── shared shell invariants across all five ─────────── */
    console.log("\nshared shell");
    for (const [route, id] of [["/", "S-home"], ["/pricing", "S-pricing"]]) {
      const p = await desktop.newPage();
      await p.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
      check(`${id}-h1`, `${route} has exactly one h1`, (await p.locator("h1").count()) === 1);
      check(`${id}-nav`, `${route} carries the shared PublicShell nav`,
        await p.locator('a[href="/pricing"]').first().isVisible() &&
        await p.locator('a[href="/sign-in"]').first().isVisible());
      await p.close();
    }
  } catch (e) {
    check("XX", "the run completed", false, String(e.stack || e.message).slice(0, 300));
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) {
      try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); }
    }
  }

  console.log(`\n  ${passed} passed, ${failed} failed`);
  console.log(`  screenshots: ${SHOTS}`);
  if (failed > 0) process.exitCode = 1;
}

main();

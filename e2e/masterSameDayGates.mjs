/**
 * V10 acceptance gates F, G and H — PUB-012 `/`, PUB-013 `/sameday`, and the
 * consumer tracking launcher.
 *
 * WHY THIS EXISTS. An audit of the V10 slice asked, per gate bullet, "which
 * assertion covers this?" and the honest answer for most of gates F, G and H
 * was "none". `test:pub-family` drives both pages, but it asserts the
 * COMPOSITION contract — section order and the four data attributes — plus axe
 * and overflow. It reads no section CONTENT. So:
 *
 *   - `consumer-availability` shipped presenting ZERO of the nine states the
 *     work order names, as two prose paragraphs, and every gate stayed green.
 *   - the workflow rail's connector was declared only above 900px, leaving the
 *     "connected sequence" disconnected at three of the five widths gate G
 *     names screenshots at.
 *   - the tracking launcher accepted ANY host, and the only thing standing in
 *     for gate H was a source-text scan asserting the string "router.push"
 *     appears — which is true of a component that navigates to the wrong place.
 *
 * Each of those is a content or behaviour requirement, and a content
 * requirement needs a content assertion. Everything here reads the rendered
 * page or drives it; nothing greps a source file.
 *
 * Structure is deliberately duplicated with `publicFamilyGates.mjs` (its own
 * port, its own artifacts) rather than shared: that gate reuses a server it
 * finds answering, and two suites sharing one is how a gate ends up measuring
 * a stale build.
 */
import { spawn } from "node:child_process";
import { openSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

/**
 * Copy transcribed from the WORK ORDER, not imported from
 * `lib/couranr/public/masterSameDayCopy.ts`.
 *
 * That is the point. A gate that imports the module the page renders checks
 * only that the page and the module agree — they always will, they are one
 * edit — and would go green on copy no decision approved. These are the
 * owner's strings, typed here once, so the gate compares the rendered page
 * against the requirement.
 */
const WO = {
  master_consumer_door: "Send something",
  master_business_door: "Add delivery to my business",
  tracking_stages: ["Confirmed", "Picked up", "Delivered"],
  chrome: {
    same_day: "Same Day",
    for_business: "For Business",
    business_sign_in: "Business sign in",
    track_a_delivery: "Track a delivery",
    start_a_delivery: "Start a delivery",
  },
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.MASTERSD_PORT || 3103);
const BASE = `http://127.0.0.1:${PORT}`;
const ART = path.join(ROOT, "e2e/artifacts/master-sameday");
const CONTROL = process.argv.includes("--positive-control");

const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_PATH || "/opt/node22/lib/node_modules/playwright",
);

/** Gate F and G both name exactly these five. */
const WIDTHS = [1440, 1024, 768, 390, 320];

const MASTER_SECTIONS = ["master-hero", "master-network", "master-service-area"];
const SAMEDAY_SECTIONS = [
  "sameday-hero",
  "already-bought",
  "send-what-you-have",
  "consumer-breadth",
  "consumer-workflow",
  "consumer-price",
  "consumer-availability",
  "consumer-tracking",
  "consumer-closing",
];

/* The work order's own list, transcribed. Kept literal rather than read from
   the copy module so a bad edit to the module cannot also move the goalposts. */
const AVAILABILITY_STATES = [
  "idle",
  "focused",
  "typing",
  "suggestions",
  "selected",
  "checking",
  "eligible",
  "review-needed",
  "error",
];

let pass = 0;
let fail = 0;
const lines = [];

function check(name, ok, detail) {
  if (ok) pass++;
  else fail++;
  lines.push(`${ok ? "  ok  " : "  FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

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
  mkdirSync(ART, { recursive: true });
  if (await reachable()) {
    console.log(`reusing the server already answering at ${BASE}`);
    return;
  }
  console.log(`starting next start on ${PORT} (production build) ...`);
  const log = openSync(path.join(ROOT, "e2e/artifacts/master-sameday-server.log"), "w");
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

/* ── gate F + G: structure, at every width the work order names ─────────── */

async function structureGate(browser, route, expected, tag, affordanceSelector) {
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });

    /* A screenshot at every named width, not at two of them. The gates said
       "Screenshots: 1440 / 1024 / 768 / 390 / 320" and the family harness
       wrote a desktop and a mobile one, so three of the five were never
       rendered to look at. */
    await page.screenshot({ path: path.join(ART, `${tag}-${width}.png`), fullPage: true });

    const got = await page.$$eval("[data-couranr-section]", (els) =>
      els.map((e) => e.getAttribute("data-couranr-section")),
    );
    check(
      `${tag}@${width} governed section order`,
      JSON.stringify(got) === JSON.stringify(expected),
      JSON.stringify(got) === JSON.stringify(expected) ? `${got.length} regions` : `got ${JSON.stringify(got)}`,
    );

    const box = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }));
    check(`${tag}@${width} no horizontal overflow`, box.sw <= box.cw + 1, `${box.sw} vs ${box.cw}`);

    /* Gate F: "both intent doors pushed too far below the fold" is a fail.
       Gate G: "both intent actions immediately discoverable on mobile". Same
       measurement — where the SECOND one starts. */
    const tops = await page.$$eval(affordanceSelector, (els) =>
      els.map((e) => e.getBoundingClientRect().top + window.scrollY),
    );
    check(`${tag}@${width} exactly two audience affordances`, tops.length === 2, `${tops.length} found`);
    if (tops.length === 2) {
      const deepest = Math.max(...tops);
      check(
        `${tag}@${width} both affordances near the fold`,
        deepest <= 900 * 1.5,
        `second starts at ${Math.round(deepest)}px`,
      );
    }

    const mains = await page.$$eval("main", (e) => e.length);
    check(`${tag}@${width} exactly one main landmark`, mains === 1, `${mains}`);
    check(`${tag}@${width} no page errors`, errors.length === 0, errors.join("; "));

    await ctx.close();
  }
}

/* ── gate G: the section CONTENT nothing was reading ─────────────────────── */

async function sameDayContentGate(browser) {
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/sameday`, { waitUntil: "networkidle" });

    /* consumer-availability — "Present the full address/availability
       interaction story", nine named states. This is the assertion whose
       absence let the section ship as two paragraphs. */
    const states = await page.$$eval("[data-couranr-address-state]", (els) =>
      els.map((e) => ({
        id: e.getAttribute("data-couranr-address-state"),
        label: e.querySelector(".cr-sd-state__label")?.textContent?.trim() ?? "",
        caption: e.querySelector(".cr-sd-state__caption")?.textContent?.trim() ?? "",
        visible: e.getBoundingClientRect().height > 0,
      })),
    );
    check(
      `sameday@${width} all nine availability states, in order`,
      JSON.stringify(states.map((s) => s.id)) === JSON.stringify(AVAILABILITY_STATES),
      states.map((s) => s.id).join(",") || "none rendered",
    );
    check(
      `sameday@${width} every state visible with a label and a caption`,
      states.length === 9 && states.every((s) => s.visible && s.label && s.caption),
    );

    /* consumer-workflow — "Connected sequence". The connector is the claim, so
       it is measured rather than assumed; it was declared above 900px only. */
    const connectors = await page.$$eval(".cr-sd-rail__step", (els) =>
      els.slice(0, -1).map((e) => {
        const cs = getComputedStyle(e, "::after");
        return { drawn: cs.content !== "none", w: parseFloat(cs.width) || 0, h: parseFloat(cs.height) || 0 };
      }),
    );
    const drawn = connectors.filter((c) => c.drawn && c.w > 0 && c.h > 0);
    check(
      `sameday@${width} workflow rail is a CONNECTED sequence`,
      connectors.length === 4 && drawn.length === 4,
      `${drawn.length}/${connectors.length} connectors drawn`,
    );

    /* consumer-tracking — three product-story stages, and no live data. */
    const stages = await page.$$eval(".cr-sd-track__stage", (els) =>
      els.map((e) => e.textContent.trim()),
    );
    check(
      `sameday@${width} tracking shows the three story stages`,
      JSON.stringify(stages) === JSON.stringify(WO.tracking_stages),
      stages.join(" → "),
    );

    /* "no fake price, availability, confirmation, driver or live tracking
       data" — checked against the RENDERED text of the three sections that
       could carry it, not the whole document (the footer legitimately has
       none of this, and Next's inlined runtime contains the word "error"). */
    for (const section of ["consumer-price", "consumer-availability", "consumer-tracking"]) {
      const text = await page.$eval(
        `[data-couranr-section="${section}"]`,
        (e) => e.textContent || "",
      );
      check(
        `sameday@${width} ${section} fabricates no data`,
        !/\$\s?\d|\b\d{1,5}\s+[A-Z][a-z]+\s+(St|Ave|Rd|Blvd|Street|Avenue|Road)\b|\bETA\b|\b\d+\s*min(ute)?s?\b/.test(
          text,
        ),
        text.slice(0, 90),
      );
    }

    /* "no generic consumer sign-in" anywhere in the consumer chrome. */
    const chrome = await page.$$eval(".cr-topbar a, .cr-topbar button", (els) =>
      els.map((e) => (e.textContent || "").trim()),
    );
    check(
      `sameday@${width} no generic consumer sign-in`,
      !chrome.some((l) => /^(sign in|log in|create account|sign up)$/i.test(l)),
      chrome.join(" | "),
    );

    await ctx.close();
  }

  /* Desktop only: "Desktop orientation reverses from the prior editorial
     section", and the hero's ~45/55 interaction-to-photography target. */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/sameday`, { waitUntil: "networkidle" });

  const order = await page.evaluate(() => {
    const read = (sel) => {
      const s = document.querySelector(`[data-couranr-section="${sel}"]`);
      const media = s?.querySelector(".cr-sd-editorial__media");
      const copy = s?.querySelector(".cr-sd-editorial__copy");
      if (!media || !copy) return null;
      return media.getBoundingClientRect().left < copy.getBoundingClientRect().left
        ? "media-first"
        : "copy-first";
    };
    return { two: read("already-bought"), three: read("send-what-you-have") };
  });
  check(
    "sameday@1440 the two editorial sections alternate",
    order.two !== null && order.three !== null && order.two !== order.three,
    `already-bought=${order.two}, send-what-you-have=${order.three}`,
  );

  const heroSplit = await page.evaluate(() => {
    const lead = document.querySelector(".cr-sd-hero__lead");
    const media = document.querySelector(".cr-sd-hero__media");
    if (!lead || !media) return null;
    const l = lead.getBoundingClientRect().width;
    const m = media.getBoundingClientRect().width;
    return Math.round((l / (l + m)) * 100);
  });
  check(
    "sameday@1440 hero is roughly 45% interaction / 55% photography",
    heroSplit !== null && heroSplit >= 38 && heroSplit <= 52,
    `interaction ${heroSplit}%`,
  );

  /* All three approved consumer photographs, each in its locked role. */
  const roles = [
    ["sameday-hero", "consumer-doorstep-handoff"],
    ["already-bought", "consumer-dry-cleaning-pickup"],
    ["send-what-you-have", "consumer-send-from-office"],
  ];
  for (const [section, asset] of roles) {
    const srcs = await page.$$eval(
      `[data-couranr-section="${section}"] img`,
      (els) => els.map((e) => e.getAttribute("src") || ""),
    );
    check(
      `sameday@1440 ${section} carries ${asset}`,
      srcs.some((s) => s.includes(asset)),
      srcs.join(", ") || "no img",
    );
  }
  await ctx.close();
}

/* ── gate F: master copy, destinations and the fail list ─────────────────── */

async function masterContentGate(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });

  const doors = await page.$$eval("[data-couranr-door]", (els) =>
    els.map((e) => ({
      audience: e.getAttribute("data-couranr-door"),
      href: e.getAttribute("href"),
      title: e.querySelector(".cr-master-door__title")?.textContent?.trim(),
    })),
  );
  check("master both doors resolve to the canonical audience route",
    doors.length === 2 &&
      doors.find((d) => d.audience === "consumer")?.href === "/sameday" &&
      doors.find((d) => d.audience === "business")?.href === "/business",
    doors.map((d) => `${d.audience}→${d.href}`).join(", "));
  check(
    "master door titles are the locked MKT-005 strings",
    doors.find((d) => d.audience === "consumer")?.title === WO.master_consumer_door &&
      doors.find((d) => d.audience === "business")?.title === WO.master_business_door,
    doors.map((d) => d.title).join(" / "),
  );

  /* "business-only notice or footer leakage" and "universal businesses-only
     Couranr description" are both gate F fail conditions. The businesses-only
     descriptor shipped on this page for real, inside MKT-001's market
     sentence, so this reads the rendered document. */
  const body = await page.$eval("body", (e) => e.textContent || "");
  check(
    "master carries no businesses-only descriptor",
    !/local delivery infrastructure for local businesses/i.test(body) &&
      !/Local business delivery across/i.test(body),
    body.match(/Local business delivery across[^.]*\./)?.[0] ?? "clean",
  );

  /* Gate F's prohibited additions, as rendered rather than as source. */
  const headings = await page.$$eval("h2, h3", (els) =>
    els.map((e) => (e.textContent || "").trim().toLowerCase()),
  );
  check(
    "master adds no FAQ, testimonial or metrics band",
    !headings.some((h) => /faq|frequently asked|testimonial|what our|trusted by|by the numbers/.test(h)),
    headings.join(" | "),
  );

  /* "dead CTA": every in-app link on the page must resolve. */
  const hrefs = [...new Set(await page.$$eval("a[href^='/']", (els) => els.map((e) => e.getAttribute("href"))))];
  for (const href of hrefs) {
    const res = await page.request.get(`${BASE}${href}`, { maxRedirects: 5 });
    check(`master CTA ${href} is not dead`, res.status() < 400, `HTTP ${res.status()}`);
  }

  const chrome = await page.$$eval(".cr-topbar a, .cr-topbar button", (els) =>
    els.map((e) => (e.textContent || "").trim()).filter(Boolean),
  );
  for (const want of [
    WO.chrome.same_day,
    WO.chrome.for_business,
    WO.chrome.business_sign_in,
  ]) {
    check(`master header carries "${want}"`, chrome.includes(want), chrome.join(" | "));
  }

  await ctx.close();
}

/* ── gate H: the tracking launcher, driven ───────────────────────────────── */

async function trackingLauncherGate(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  /* Every request the page makes, so "it never logs, stores or sends the
     pasted link" is measured rather than asserted from the source. */
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));

  await page.goto(`${BASE}/sameday`, { waitUntil: "networkidle" });

  check(
    "gate H: Track a delivery is not a link to a generic /track",
    (await page.locator('a[href="/track"], a[href="/track/"], a[href^="/track?"]').count()) === 0,
  );

  const open = async () => {
    await page.getByRole("button", { name: WO.chrome.track_a_delivery }).first().click();
    await page.waitForSelector(".cr-track-launcher__panel", { state: "visible" });
  };
  const submit = async (value) => {
    const input = page.locator(".cr-track-launcher__panel input").first();
    await input.fill(value);
    await page.getByRole("button", { name: "Open tracking" }).first().click();
    await page.waitForTimeout(400);
    return page.url();
  };

  await open();

  const TOKEN = CONTROL ? "CONTROL-TOKEN" : "GATE-H-TOKEN";

  for (const [value, why] of [
    [`https://evil.test/track/${TOKEN}`, "an external host"],
    [`https://couranr.com.evil.test/track/${TOKEN}`, "a lookalike host"],
    ["not a tracking link", "malformed input"],
    ["javascript:alert(1)", "a javascript: URL"],
    [`//evil.test/track/${TOKEN}`, "a protocol-relative URL"],
  ]) {
    const url = await submit(value);
    check(`gate H: ${why} is refused`, url.endsWith("/sameday"), `landed on ${url}`);
  }

  const error = await page.locator(".cr-field__error").first().textContent().catch(() => null);
  check("gate H: a refusal is shown to the visitor", !!error && error.trim().length > 0, error ?? "silent");

  /* Nothing the visitor pasted may have left the browser. Checked before the
     accepted case navigates, so a token in a URL here is a real leak. */
  const leaked = requests.filter((u) => u.includes(TOKEN) || u.includes("evil.test"));
  check("gate H: no refused token or foreign host left the browser", leaked.length === 0, leaked.join(", "));

  const url = await submit(`${BASE}/track/${TOKEN}`);
  check(`gate H: a link on this host navigates locally`, url.endsWith(`/track/${TOKEN}`), url);

  await ctx.close();
}

async function main() {
  await startServer();
  const browser = await chromium.launch();
  try {
    await structureGate(browser, "/", MASTER_SECTIONS, "master", "[data-couranr-door]");
    await structureGate(browser, "/sameday", SAMEDAY_SECTIONS, "sameday", ".cr-sd-intent");
    await masterContentGate(browser);
    await sameDayContentGate(browser);
    await trackingLauncherGate(browser);
  } finally {
    await browser.close();
    /* The server stays up: the positive control below drives the same pages to
       prove each assertion can see a planted violation, and stopping here left
       it navigating to a refused connection. `stopServer()` runs on both exit
       paths instead. */
  }

  console.log(lines.join("\n"));
  console.log(`\nmaster + Same Day gates (F, G, H): ${pass}/${pass + fail} passed`);
  console.log(`screenshots: e2e/artifacts/master-sameday/ (${WIDTHS.length} widths × 2 pages)`);

  if (CONTROL) {
    /* A control that just exits 1 proves the process can exit 1. It proves
       nothing about the ASSERTIONS, which is exactly the hole that let three of
       these requirements be "covered" by a gate that could not see them.
       So each probe re-runs a real comparison against a deliberately wrong
       expectation and the control passes only when EVERY one goes red. */
    if (fail > 0) {
      console.log("\npositive control: the gate reported real failures — fix those first");
      stopServer();
      process.exit(1);
    }

    const probes = [];
    const probe = (name, wentRed, detail) => probes.push({ name, wentRed, detail });

    const b = await chromium.launch();
    try {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/sameday`, { waitUntil: "networkidle" });

      const sections = await page.$$eval("[data-couranr-section]", (els) =>
        els.map((e) => e.getAttribute("data-couranr-section")));
      const swapped = [...SAMEDAY_SECTIONS];
      [swapped[6], swapped[7]] = [swapped[7], swapped[6]];
      probe("section-order comparison detects a swapped pair",
        JSON.stringify(sections) !== JSON.stringify(swapped));

      const states = await page.$$eval("[data-couranr-address-state]", (els) =>
        els.map((e) => e.getAttribute("data-couranr-address-state")));
      probe("availability-state comparison detects a missing state",
        JSON.stringify(states) !== JSON.stringify(AVAILABILITY_STATES.slice(0, 8)),
        `${states.length} rendered`);

      const stages = await page.$$eval(".cr-sd-track__stage", (e) => e.map((n) => n.textContent.trim()));
      probe("tracking-stage comparison detects wrong copy",
        JSON.stringify(stages) !== JSON.stringify(["Confirmed", "In transit", "Delivered"]));

      /* The fabricated-data regex has to actually match fabricated data. */
      const FAKE = /\$\s?\d|\b\d{1,5}\s+[A-Z][a-z]+\s+(St|Ave|Rd|Blvd|Street|Avenue|Road)\b|\bETA\b|\b\d+\s*min(ute)?s?\b/;
      probe("fabricated-data detector matches a price", FAKE.test("Your delivery is $18.50"));
      probe("fabricated-data detector matches an address", FAKE.test("Picking up at 1200 Main Street"));
      probe("fabricated-data detector matches an ETA", FAKE.test("Arriving in 25 minutes"));
      probe("fabricated-data detector clears the real section",
        !FAKE.test(await page.$eval('[data-couranr-section="consumer-availability"]', (e) => e.textContent)));

      /* The connector measurement has to be able to see an absent connector. */
      await page.addStyleTag({ content: ".cr-sd-rail__step::after { content: none !important; }" });
      const after = await page.$$eval(".cr-sd-rail__step", (els) =>
        els.slice(0, -1).filter((e) => getComputedStyle(e, "::after").content !== "none").length);
      probe("connector measurement detects a removed connector", after === 0, `${after} still drawn`);

      await ctx.close();
    } finally {
      await b.close();
      stopServer();
    }

    const blind = probes.filter((p) => !p.wentRed);
    console.log("\npositive control:");
    for (const p of probes) {
      console.log(`  ${p.wentRed ? "ok  " : "BLIND"}  ${p.name}${p.detail ? `  — ${p.detail}` : ""}`);
    }
    if (blind.length) {
      console.log(`\npositive control FAILED: ${blind.length} assertion(s) cannot see their own violation`);
      process.exit(1);
    }
    console.log(`\npositive control: all ${probes.length} assertions detect a planted violation — the gate can go red`);
    process.exit(1);
  }
  stopServer();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  stopServer();
  console.error(e);
  process.exit(1);
});

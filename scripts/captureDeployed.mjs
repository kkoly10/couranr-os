#!/usr/bin/env node
/**
 * `node scripts/captureDeployed.mjs <outDir> [prefix] [baseUrl]` — screenshots
 * the DEPLOYED homepage, from inside a container whose Chromium cannot reach it.
 *
 * Chromium here gets `net::ERR_CONNECTION_RESET` for any external host; Node's
 * `fetch` goes through the configured agent proxy and works. So every request
 * the page makes is intercepted and satisfied from Node — the same method
 * `e2e/supabaseRelay.mjs` uses to make the auth suite runnable.
 *
 * WHAT THIS CHANGES ABOUT WHAT THE SHOT PROVES, stated rather than buried: the
 * bytes are the deployed bytes and the rendering is a real browser's, but the
 * production network path is not exercised — no CDN edge behaviour, no real
 * latency, no HTTP/2 prioritisation. For judging typography and composition,
 * which is what this is for, none of that matters. For anything about loading
 * behaviour it would.
 *
 * TLS verification is untouched and `HTTPS_PROXY` is untouched.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const [outDir = "/tmp/deployed", prefix = "deployed", base = "https://couranr-os.vercel.app"] =
  process.argv.slice(2);
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "/opt/node22/lib/node_modules/playwright");

const WIDTHS = [
  { w: 1440, h: 900 },
  { w: 1280, h: 800 },
  { w: 1024, h: 800 },
  { w: 390, h: 844 },
];

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();

for (const { w, h } of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();

  let relayed = 0;
  let failed = 0;
  await page.route("**/*", async (route) => {
    const req = route.request();
    try {
      const res = await fetch(req.url(), {
        method: req.method(),
        headers: { ...req.headers(), host: undefined },
        body: ["GET", "HEAD"].includes(req.method()) ? undefined : req.postDataBuffer(),
        redirect: "follow",
      });
      const body = Buffer.from(await res.arrayBuffer());
      const headers = {};
      res.headers.forEach((v, k) => {
        // Node's fetch has already decoded the body; passing these through
        // makes Chromium try to decode it a second time and render nothing.
        if (!["content-encoding", "content-length", "transfer-encoding"].includes(k)) headers[k] = v;
      });
      relayed++;
      await route.fulfill({ status: res.status, headers, body });
    } catch (e) {
      failed++;
      await route.abort();
    }
  });

  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message.slice(0, 100)));
  page.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 100)));

  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(3500);
  // Lazy images below the fold do not load for a full-page shot unless the page
  // is walked first; the footer wordmark photographs as a blank otherwise.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 150));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(1500);

  const file = path.join(outDir, `${prefix}-${w}.png`);
  await page.screenshot({ path: file, fullPage: true });
  const height = await page.evaluate(() => document.body.scrollHeight);
  console.log(
    `${String(w).padStart(5)}  ${file}  (page ${height}px, ${relayed} relayed, ${failed} failed, ` +
      `${errs.length ? `errors: ${errs.slice(0, 2).join(" | ")}` : "no console errors"})`,
  );
  await ctx.close();
}
await browser.close();

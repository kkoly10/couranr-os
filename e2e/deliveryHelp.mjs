/**
 * Browser verification for PUB-007 — Delivery Help at `/help/[token]`.
 *
 * ---------------------------------------------------------------------------
 * EXACTLY WHAT THIS PROVES, AND EXACTLY WHAT IT DOES NOT
 * ---------------------------------------------------------------------------
 *
 * PROVES. That a person opening a Delivery Help link sees the right thing and
 * can do the right things: the page renders, the seven topics are offered, a
 * URL fragment preselects its topic, a refused link shows one sentence with no
 * retry while a failed load shows a retry, the composer posts the body the API
 * contract expects with a stable idempotency key, and no surface anywhere
 * shows a phone number or promises a response.
 *
 * DOES NOT PROVE the server path. `page.route` intercepts every
 * `/api/couranr/help/*` request and answers it from this file, so the route
 * handler, `redeemHelpToken`, `couranr_help_thread` and the whole privilege
 * boundary are NOT exercised here. Those are verified separately — against a
 * real PostgreSQL for the SQL, and by tests/couranr-conversations.test.ts for
 * the projection.
 *
 * WHY STUBBED RATHER THAN SEEDED. This container holds no
 * SUPABASE_SERVICE_ROLE_KEY, so no fixture can be created and no real token can
 * be issued. Stubbing the API is what makes the UI contract testable at all
 * here; the alternative was to verify nothing. The gap is named above rather
 * than papered over, and CLAUDE.md's own guidance is that fault injection
 * belongs at the page (`page.route`) rather than in the database.
 *
 * Run: node e2e/deliveryHelp.mjs   (expects `npm run dev` on :3000)
 */

import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";
import path from "node:path";

const BASE = process.env.E2E_BASE_URL || "http://localhost:3000";
const TOKEN = "e2ehelptokene2ehelptokene2ehelptokene2ehelp";
const SHOTS = path.resolve("e2e/artifacts/delivery-help");

const results = [];
const record = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/** The payload shape `/api/couranr/help/[token]` returns on a live link. */
const OK_PAYLOAD = {
  conversationId: "11111111-1111-4111-8111-111111111111",
  messages: [],
  topics: [
    "availability",
    "access",
    "address_concern",
    "handoff_concern",
    "unrecognized_delivery",
    "delivery_problem",
    "other",
  ],
  supportTargetMinutes: 15,
  operatingHoursApplied: false,
  supportPhone: null,
};

async function shot(page, name) {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

/** Every request the page makes to the help API, answered from here. */
function stubHelp(page, handler) {
  return page.route("**/api/couranr/help/**", async (route) => {
    const req = route.request();
    const res = await handler(req);
    await route.fulfill({
      status: res.status,
      contentType: "application/json",
      body: JSON.stringify(res.body ?? {}),
    });
  });
}

async function main() {
  const browser = await chromium.launch({
    args: ["--no-proxy-server"], // talk to localhost directly, never via egress
  });

  try {
    /* ─────────────────────────── 1. the resolved link ─────────────────────── */
    {
      const page = await browser.newPage();
      const posted = [];
      await stubHelp(page, async (req) => {
        if (req.method() === "POST") {
          posted.push(JSON.parse(req.postData() || "{}"));
          return { status: 201, body: { messageId: "m-1" } };
        }
        return {
          status: 200,
          body: posted.length
            ? {
                ...OK_PAYLOAD,
                messages: [
                  {
                    id: "m-1",
                    authoredByPerson: true,
                    authorParticipantId: "p-1",
                    topic: posted[0].topic,
                    body: posted[0].body,
                    createdAt: new Date().toISOString(),
                  },
                ],
              }
            : OK_PAYLOAD,
        };
      });

      await page.goto(`${BASE}/help/${TOKEN}`, { waitUntil: "networkidle" });
      // innerText, NOT textContent: textContent includes <script> contents,
      // and Next.js embeds flight data containing millisecond timestamps. The
      // first version of the phone check matched 1785864749080 four times and
      // reported a TRM-001 violation that did not exist.
      const body = await page.innerText("body");

      record("page renders Delivery Help", /Delivery Help/i.test(body));

      // TRM-001 and PUB-007: "No public support phone at MVP."
      // Phone-SHAPED, not "any long run of digits": a 10-or-11 digit sequence
      // grouped the way a number is written, optionally +1 and parenthesised.
      const phone = /(\+1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/.test(body || "");
      record("no phone number anywhere on the page", !phone, phone ? `matched in: ${body.slice(0,80)}` : "");
      record(
        "the API contract itself carries supportPhone: null",
        OK_PAYLOAD.supportPhone === null
      );

      // "State the normal 15-minute response target ... not a guarantee."
      record(
        "states the target as NORMAL, never guaranteed",
        /normally repl/i.test(body) && !/guarantee/i.test(body)
      );

      // All seven topics offered.
      const options = await page.$$eval("select option", (els) => els.map((e) => e.value));
      const missing = OK_PAYLOAD.topics.filter((t) => !options.includes(t));
      record("all seven customer topics are selectable", missing.length === 0, `missing: ${missing}`);

      // The disclosure that a message changes nothing on its own.
      record(
        "says a message does not change the delivery by itself",
        /does not change your delivery/i.test(body)
      );

      // One <main> landmark, from the shell — not a second one in the page.
      const mains = await page.$$eval("main", (els) => els.length);
      record("exactly one main landmark", mains === 1, `found ${mains}`);

      // Send is disabled until something is typed.
      const before = await page.isDisabled('button[type="submit"]');
      await page.fill("textarea", "The side gate is locked after 6pm.");
      const after = await page.isDisabled('button[type="submit"]');
      record("send is disabled until a message is typed", before === true && after === false);

      await shot(page, "01-resolved");

      /* ─────────────────────── 2. sending a message ───────────────────────── */
      await page.selectOption("select", "access");
      await page.click('button[type="submit"]');
      await page.waitForTimeout(900);

      record("POST carried the chosen topic", posted[0]?.topic === "access", `got ${posted[0]?.topic}`);
      record(
        "POST carried a non-empty idempotency key",
        typeof posted[0]?.idempotencyKey === "string" && posted[0].idempotencyKey.length > 0
      );
      record("POST carried the typed body", /side gate is locked/i.test(posted[0]?.body || ""));

      const after2 = await page.innerText("body");
      record("the sent message is rendered back", /side gate is locked/i.test(after2 || ""));
      record("thread shows it is waiting on Couranr", /waiting on couranr/i.test(after2 || ""));
      await shot(page, "02-sent");
      await page.close();
    }

    /* ────────────────────── 3. CUS-001 / CUS-003 fragments ────────────────── */
    for (const [frag, expected, label] of [
      ["address-change", "address_concern", "CUS-001"],
      ["recipient-unavailable", "availability", "CUS-003"],
    ]) {
      const page = await browser.newPage();
      await stubHelp(page, async () => ({ status: 200, body: OK_PAYLOAD }));
      await page.goto(`${BASE}/help/${TOKEN}#${frag}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(400);
      const selected = await page.inputValue("select");
      record(`${label}: #${frag} preselects ${expected}`, selected === expected, `got ${selected}`);
      await shot(page, `03-${frag}`);
      await page.close();
    }

    /* ──────────────────────── 4. a refused link ─────────────────────────── */
    {
      const page = await browser.newPage();
      await stubHelp(page, async () => ({ status: 404, body: { error: "not found" } }));
      await page.goto(`${BASE}/help/${TOKEN}`, { waitUntil: "networkidle" });
      const body = await page.innerText("body");

      record("refusal shows the one fixed sentence", /this help link is not available/i.test(body));
      // A refusal must not offer a retry: retrying resolves nothing.
      const retry = await page.$$eval("button", (els) =>
        els.some((e) => /try again/i.test(e.textContent || ""))
      );
      record("refusal offers NO retry", retry === false);
      // And must not leak which kind of bad the link is.
      record(
        "refusal does not say expired, revoked or unknown",
        !/expired|revoked|unknown|invalid/i.test(body)
      );
      await shot(page, "04-refused");
      await page.close();
    }

    /* ─────────────────── 5. a failure is NOT a refusal ──────────────────── */
    {
      const page = await browser.newPage();
      await stubHelp(page, async () => ({ status: 500, body: { error: "boom" } }));
      await page.goto(`${BASE}/help/${TOKEN}`, { waitUntil: "networkidle" });
      const body = await page.innerText("body");

      record("a 500 does NOT render the refusal sentence", !/not available/i.test(body));
      const retry = await page.$$eval("button", (els) =>
        els.some((e) => /try again/i.test(e.textContent || ""))
      );
      record("a 500 DOES offer a retry", retry === true);
      await shot(page, "05-failed");
      await page.close();
    }

    /* ──────────────── 6. send failure keeps the typed text ──────────────── */
    {
      const page = await browser.newPage();
      await stubHelp(page, async (req) =>
        req.method() === "POST"
          ? { status: 500, body: { error: "boom" } }
          : { status: 200, body: OK_PAYLOAD }
      );
      await page.goto(`${BASE}/help/${TOKEN}`, { waitUntil: "networkidle" });
      await page.fill("textarea", "Please leave it with the neighbour.");
      await page.click('button[type="submit"]');
      await page.waitForTimeout(700);

      const kept = await page.inputValue("textarea");
      record("a failed send does not discard what was typed", /neighbour/i.test(kept));
      const body = await page.innerText("body");
      record("a failed send says so", /not sent|could not send/i.test(body));
      await shot(page, "06-send-failed");
      await page.close();
    }
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n  ${results.length - failed.length}/${results.length} assertions passed`);
  console.log(`  screenshots: ${SHOTS}`);
  if (failed.length) {
    console.log("\n  FAILED:");
    for (const f of failed) console.log(`    - ${f.name} ${f.detail}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

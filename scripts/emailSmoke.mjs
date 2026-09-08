// Sends ONE real Couranr email through the real sender, to prove the chain.
//
// Usage:  node scripts/emailSmoke.mjs you@example.com [--template <name>]
//         npm run email:smoke -- you@example.com
//
// WHY THIS EXISTS. The email subsystem shipped 13 templates, a preview gallery
// and 11 green tests while being physically unable to send: nothing imported it
// and no sender existed. Unit tests with an injected fetch now cover the send
// logic, but an injected fetch proves the code, not the ACCOUNT — it cannot tell
// you the API key is live, that `mail.couranr.com` is DKIM-verified, or that the
// message reaches an inbox rather than a spam folder. Only a real send does.
//
// This drives the SAME `sendRenderedEmail` the application uses. It does not
// reimplement the POST — a smoke test that reimplements the thing it is testing
// proves nothing about the thing.
//
// It sends real mail to whatever address you pass, so it takes the recipient as
// an explicit argument and refuses to guess one.

import { build } from "esbuild";
import { readFileSync } from "fs";
import { fileURLToPath, pathToFileURL } from "url";
import path from "path";
import os from "os";
import { writeFileSync, mkdtempSync } from "fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ---------------------------------------------------------------- args --- */

const args = process.argv.slice(2);
const to = args.find((a) => !a.startsWith("--"));
const tIdx = args.indexOf("--template");
const templateName = tIdx !== -1 && args[tIdx + 1] ? args[tIdx + 1] : "bizQuoteReady";

if (!to) {
  console.error(
    "usage: node scripts/emailSmoke.mjs <recipient@example.com> [--template <name>]\n" +
      "       This sends a REAL email. Pass the address explicitly."
  );
  process.exit(2);
}

/* ------------------------------------------------------------ env load --- */
// .env.local is not loaded for a bare node script the way it is for `next dev`.

function loadEnvLocal() {
  let raw;
  try {
    raw = readFileSync(path.join(root, ".env.local"), "utf8");
  } catch {
    return 0;
  }
  let n = 0;
  for (const line of raw.split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) {
      process.env[m[1]] = value;
      n++;
    }
  }
  return n;
}
loadEnvLocal();

if (!process.env.RESEND_API_KEY) {
  console.error("RESEND_API_KEY is not set (checked process.env and .env.local).");
  process.exit(1);
}

/* A laptop is not Vercel production, so the sender's environment guard would
   refuse. Arm it explicitly for this process only — never exported, never
   written to a file. Deliberate and visible rather than a hidden default. */
process.env.COURANR_EMAIL_SEND = "live";
/* NOT set: COURANR_EMAIL_REDIRECT_TO. The operator named the recipient on the
   command line, so redirecting it somewhere else would be a lie about what was
   tested. */
delete process.env.COURANR_EMAIL_REDIRECT_TO;

/* -------------------------------------------------------------- bundle --- */
// `send.ts` imports through the `@/` alias, so esbuild is pointed at the repo
// tsconfig to resolve `paths` rather than hand-maintaining a second alias map.

const entry = `
export { sendRenderedEmail } from ${JSON.stringify(path.join(root, "lib/couranr/email/send.ts"))};
export { defaultEmailConfig } from ${JSON.stringify(path.join(root, "lib/couranr/email/theme.ts"))};
export { buildSamples } from ${JSON.stringify(path.join(root, "lib/couranr/email/sampleData.ts"))};
export * as business from ${JSON.stringify(path.join(root, "lib/couranr/email/templates/business.ts"))};
export * as customer from ${JSON.stringify(path.join(root, "lib/couranr/email/templates/customer.ts"))};
`;

const bundled = await build({
  stdin: { contents: entry, resolveDir: root, loader: "ts", sourcefile: "smoke-entry.ts" },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  tsconfig: path.join(root, "tsconfig.json"),
  write: false,
});

const tmp = mkdtempSync(path.join(os.tmpdir(), "couranr-email-smoke-"));
const modPath = path.join(tmp, "smoke.mjs");
writeFileSync(modPath, bundled.outputFiles[0].text, "utf8");
const mod = await import(pathToFileURL(modPath).href);

/* ------------------------------------------------------------- render --- */

const cfg = mod.defaultEmailConfig;
const s = mod.buildSamples(cfg);

const TEMPLATES = {
  bizWorkspaceCreated: () => mod.business.bizWorkspaceCreated(cfg, s.business.workspaceCreated),
  bizQuoteReady: () => mod.business.bizQuoteReady(cfg, s.business.quoteReady),
  bizPaymentReceipt: () => mod.business.bizPaymentReceipt(cfg, s.business.paymentReceipt),
  bizDeliveredReceipt: () => mod.business.bizDeliveredReceipt(cfg, s.business.deliveredReceipt),
  custOrderConfirmed: () => mod.customer.custOrderConfirmed(cfg, s.customer.orderConfirmed),
  custOutForDelivery: () => mod.customer.custOutForDelivery(cfg, s.customer.outForDelivery),
  custDelivered: () => mod.customer.custDelivered(cfg, s.customer.delivered),
};

const make = TEMPLATES[templateName];
if (!make) {
  console.error(
    `unknown template "${templateName}".\navailable: ${Object.keys(TEMPLATES).join(", ")}`
  );
  process.exit(2);
}

const email = make();

/* --------------------------------------------------------------- send --- */

console.log(`sending   : ${templateName}`);
console.log(`from      : ${email.from}`);
console.log(`to        : ${to}`);
console.log(`subject   : ${email.subject}`);
console.log("");

const result = await mod.sendRenderedEmail(email, {
  to,
  /* Stable per template+recipient, so re-running within 24h does NOT spam the
     inbox — Resend dedupes on this key. Pass --template to send a different one,
     or wait out the window. */
  idempotencyKey: `smoke:${templateName}:${to}`,
});

if (result.sent) {
  console.log(`OK  provider accepted it — message id ${result.id}`);
  console.log(`    delivered to ${result.to}${result.redirected ? " (REDIRECTED)" : ""}`);
  console.log("");
  console.log("Check the inbox. If nothing arrives, the provider accepted it and");
  console.log("the failure is downstream — look at the Resend dashboard's event log");
  console.log("for bounce/complaint/blocked on this message id.");
  process.exit(0);
}

console.error(`FAILED  reason: ${result.reason}`);
if (result.detail) console.error(`        detail: ${result.detail}`);
if (result.correlationId) console.error(`        correlationId: ${result.correlationId}`);
console.error("");
if (result.reason === "provider_rejected") {
  console.error("The provider REJECTED it. The usual cause is an unverified sending");
  console.error(`domain: this sent from ${email.from}. Only mail.couranr.com is`);
  console.error("verified on the account — the apex couranr.com is not.");
}
process.exit(1);

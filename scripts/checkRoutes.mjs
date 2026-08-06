/**
 * `npm run check:routes` — the route manifest gate.
 *
 * Two invariants, both measured from the filesystem rather than a ledger:
 *
 *  1. ZERO canonical API routes without an authentication/gate marker.
 *     "Zero canonical routes under app/api/couranr are ungated" is a standing
 *     security claim in IMPLEMENTATION_STATUS.md; this makes it a gate instead
 *     of a sentence. The marker set is the WIDENED one that already caught a
 *     false positive (`redeem\w*Token` missed `redeemPaymentLink`).
 *
 *  2. Every screen-ledger row that names a page path points at a file that
 *     exists — a ledger that references deleted pages is lying about coverage.
 *
 * Positive control: `--positive-control` writes a temporary ungated route,
 * expects THIS script's own scan to flag it, and removes it. Driven by
 * scripts/positiveControls.mjs so the batch gate proves the gate can go red.
 */

import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const GATE_MARKER = new RegExp(
  [
    "requireAdmin",
    "resolveRequestActor",
    "resolveUserId",
    "getUserFromRequest",
    "redeem\\w*(Token|Link)",
    "constructEvent",
    "authorization",
    "bearer",
    "TEST_MODE",
    "IS_PROD",
    "getUser\\(",
    "getSession\\(",
    "signature",
  ].join("|"),
  "i"
);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (entry === "route.ts" || entry === "route.js") out.push(p);
  }
  return out;
}

function scanUngated() {
  const routes = walk(path.join(ROOT, "app/api/couranr"));
  const ungated = routes.filter((f) => !GATE_MARKER.test(readFileSync(f, "utf8")));
  return { routes, ungated };
}

function scanLedgerPaths() {
  const csv = readFileSync(path.join(ROOT, "docs/couranr-mvp/SCREEN_IMPLEMENTATION_LEDGER.csv"), "utf8");
  // The page-path column is the 6th; a naive split breaks on quoted commas, so
  // extract every app/… token that looks like a page path instead.
  const paths = [...new Set([...csv.matchAll(/app\/[^",\s]*page\.tsx/g)].map((m) => m[0]))];
  const missing = paths.filter((p) => !existsSync(path.join(ROOT, p)));
  return { paths, missing };
}

function main() {
  const positiveControl = process.argv.includes("--positive-control");

  if (positiveControl) {
    const dir = path.join(ROOT, "app/api/couranr/__gate_control__");
    mkdirSync(dir, { recursive: true });
    const f = path.join(dir, "route.ts");
    writeFileSync(f, "export async function GET() { return new Response('open'); }\n");
    try {
      const { ungated } = scanUngated();
      const caught = ungated.some((u) => u.includes("__gate_control__"));
      console.log(caught
        ? "  positive control: the planted ungated route WAS flagged — the gate can go red"
        : "  POSITIVE CONTROL FAILED: the planted ungated route was not flagged");
      process.exitCode = caught ? 0 : 1;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    return;
  }

  const { routes, ungated } = scanUngated();
  const { paths, missing } = scanLedgerPaths();

  console.log(`check:routes — ${routes.length} canonical API routes, ${paths.length} ledger page paths`);
  for (const u of ungated) console.error(`  UNGATED: ${path.relative(ROOT, u)}`);
  for (const m of missing) console.error(`  LEDGER PATH MISSING: ${m}`);

  if (ungated.length || missing.length) {
    console.error(`\n  FAIL — ${ungated.length} ungated canonical route(s), ${missing.length} dead ledger path(s)`);
    process.exitCode = 1;
    return;
  }
  console.log("  PASS — zero ungated canonical routes; every ledger page path exists");
}

main();

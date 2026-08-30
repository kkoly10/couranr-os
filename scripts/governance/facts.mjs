#!/usr/bin/env node
/**
 * `npm run governance:facts` — measures the numbers that used to be pinned by
 * hand in `CLAUDE.md` and elsewhere.
 *
 * Every value here was, at the consolidation baseline, written into prose in at
 * least one live document — and several were already wrong. `CLAUDE.md` claimed
 * "1629 tests across 51 files" and "53 files, 2013 tests" in two different
 * places while the suite actually ran 2073 across 54; its decision-registry
 * fingerprint line had been corrected twice and carried a paragraph of
 * apology about the two fingerprints before it.
 *
 * A number that must be re-measured by hand is a number that goes stale between
 * the commit that changes it and the commit that remembers to. So the documents
 * now point at this command instead of quoting it.
 *
 * Read-only. Prints a table by default, `--json` for machine use.
 */
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { ROOT, screenSource } from "./screenRegistry.mjs";

function csvRows(rel) {
  const text = readFileSync(join(ROOT, rel), "utf8");
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const data = rows.filter((r) => r.length > 1 || r[0] !== "");
  const header = data[0];
  return data.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

export function facts() {
  const registryPath = join(ROOT, "02_DECISION_REGISTRY.json");
  const registryRaw = readFileSync(registryPath);
  const registry = JSON.parse(registryRaw.toString("utf8"));

  const screens = screenSource().screens;
  const bySurface = {};
  for (const s of screens) bySurface[s.surface] = (bySurface[s.surface] ?? 0) + 1;
  const byTier = {};
  for (const s of screens) byTier[s.tier] = (byTier[s.tier] ?? 0) + 1;

  const items = csvRows("docs/couranr-mvp/IMPLEMENTATION_LEDGER.csv");
  const screenRows = csvRows("docs/couranr-mvp/SCREEN_IMPLEMENTATION_LEDGER.csv");
  const itemsVerified = items.filter((r) => r.status === "complete_verified").length;
  /* The screen ledger's status column is `implementation_status`, not `status`
     — reading the wrong key returned 0 of 66 on the first run, which is exactly
     the kind of confidently-wrong number this command exists to retire. */
  const screensVerified = screenRows.filter(
    (r) => r.implementation_status === "functional_verified",
  ).length;
  const screenStatus = {};
  for (const r of screenRows) {
    screenStatus[r.implementation_status] = (screenStatus[r.implementation_status] ?? 0) + 1;
  }
  const itemStatus = {};
  for (const r of items) itemStatus[r.status] = (itemStatus[r.status] ?? 0) + 1;

  return {
    decision_registry: {
      path: "02_DECISION_REGISTRY.json",
      records: registry.decisions.length,
      bytes: registryRaw.length,
      sha256: createHash("sha256").update(registryRaw).digest("hex"),
    },
    screens: {
      source: "ui_screen_registry.json",
      canonical: screens.length,
      by_surface: bySurface,
      by_tier: byTier,
    },
    implementation: {
      work_items: items.length,
      work_items_complete_verified: itemsVerified,
      screen_rows: screenRows.length,
      screens_functional_verified: screensVerified,
      work_item_status: itemStatus,
      screen_status: screenStatus,
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const f = facts();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(f, null, 2));
  } else {
    console.log(`decision registry   ${f.decision_registry.records} records, ${f.decision_registry.bytes} bytes`);
    console.log(`                    sha256 ${f.decision_registry.sha256}`);
    console.log(`canonical screens   ${f.screens.canonical}  (${Object.entries(f.screens.by_surface).map(([k, v]) => `${k} ${v}`).join(", ")})`);
    console.log(`                    tiers: ${Object.entries(f.screens.by_tier).map(([k, v]) => `${k} ${v}`).join(", ")}`);
    console.log(`work items          ${f.implementation.work_items_complete_verified} of ${f.implementation.work_items} complete_verified`);
    console.log(`screen rows         ${f.implementation.screens_functional_verified} of ${f.implementation.screen_rows} functional_verified`);
    if (!existsSync(join(ROOT, "node_modules"))) console.log("\n(test counts need `npm ci`; run `npm run test:run` for those)");
  }
}

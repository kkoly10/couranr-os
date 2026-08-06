/**
 * `npm run check:legacy-imports` — the quarantine boundary gate.
 *
 * The canonical trees must not import the legacy runtime. Today the count is
 * zero — this gate keeps it zero, so the B12 cutover never has to untangle a
 * dependency that grew back overnight. The known live conflicts (legacy
 * pricing at $15/4mi/$1.75 vs the specified $22.99/3mi/tiered, the 60-mile
 * radius) stay quarantined behind these module names.
 *
 * Positive control: `--positive-control` plants a canonical file importing a
 * banned module, expects the scan to flag it, and removes it.
 */

import { readFileSync, readdirSync, statSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CANONICAL_TREES = ["app/(couranr)", "app/api/couranr", "lib/couranr", "components/couranr"];

/** Legacy modules canonical code must never reach. */
const BANNED = [
  "@/lib/delivery/",
  "@/lib/serviceArea",
  "@/lib/businessPricing",
  "@/lib/getUserRole",
  "@/lib/auth\"", // legacy Bearer helper — canonical code uses lib/couranr/requests/actor
  "@/app/auto",
  "@/app/docs",
  "@/app/api/auto",
  "@/app/api/docs",
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
}

function scan() {
  const offenders = [];
  for (const tree of CANONICAL_TREES) {
    for (const file of walk(path.join(ROOT, tree))) {
      const src = readFileSync(file, "utf8");
      for (const banned of BANNED) {
        if (src.includes(`from "${banned.replace(/"$/, "")}"`) || src.includes(`from "${banned}`)) {
          offenders.push(`${path.relative(ROOT, file)} -> ${banned}`);
        }
      }
    }
  }
  return offenders;
}

function main() {
  if (process.argv.includes("--positive-control")) {
    const planted = path.join(ROOT, "lib/couranr/__legacy_control__.ts");
    writeFileSync(planted, 'import { DELIVERY_POLICY } from "@/lib/delivery/policy";\nexport const x = DELIVERY_POLICY;\n');
    try {
      const offenders = scan();
      const caught = offenders.some((o) => o.includes("__legacy_control__"));
      console.log(caught
        ? "  positive control: the planted legacy import WAS flagged — the gate can go red"
        : "  POSITIVE CONTROL FAILED: the planted legacy import was not flagged");
      process.exitCode = caught ? 0 : 1;
    } finally {
      rmSync(planted, { force: true });
    }
    return;
  }

  const offenders = scan();
  console.log(`check:legacy-imports — ${CANONICAL_TREES.length} canonical trees scanned`);
  for (const o of offenders) console.error(`  LEGACY IMPORT: ${o}`);
  if (offenders.length) {
    console.error(`\n  FAIL — ${offenders.length} legacy import(s) from canonical code`);
    process.exitCode = 1;
    return;
  }
  console.log("  PASS — canonical code imports no legacy module");
}

main();

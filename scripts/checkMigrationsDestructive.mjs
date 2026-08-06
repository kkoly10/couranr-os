/**
 * Destructive-statement scan for forward migrations — half of
 * `npm run check:migrations` (the other half is the 13 repo-wide pairing and
 * sequencing rules in tests/couranr-migrations.test.ts, which already exist
 * and have already caught real defects).
 *
 * The repository rule: forward migrations are additive and never drop a
 * table, drop a column, truncate, or delete data. This scan STRIPS SQL
 * comments first — the naive grep's only hit repo-wide was a comment saying
 * "no DROP TABLE", which is exactly the false positive that teaches people to
 * ignore a gate.
 *
 * Positive control: `--positive-control` plants a forward migration containing
 * `drop table`, expects the scan to flag it, and removes it.
 */

import { readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "supabase/migrations");

const DESTRUCTIVE = /\b(drop\s+table|drop\s+column|truncate\s+(table\s+)?[a-z_"]|delete\s+from)\b/i;

/** Strip -- line comments and /* *\/ block comments, NOT string literals'
 * contents beyond what a scan needs — a destructive statement inside a string
 * would still be flagged, and that is the safe direction to be wrong in. */
function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => {
      const i = line.indexOf("--");
      return i === -1 ? line : line.slice(0, i);
    })
    .join("\n");
}

function scan() {
  const offenders = [];
  for (const f of readdirSync(DIR).filter((f) => f.endsWith(".sql"))) {
    const body = stripComments(readFileSync(path.join(DIR, f), "utf8"));
    const m = body.match(DESTRUCTIVE);
    if (m) offenders.push(`${f}: ${m[0]}`);
  }
  return offenders;
}

function main() {
  if (process.argv.includes("--positive-control")) {
    const planted = path.join(DIR, "99999999999999_gate_control.sql");
    writeFileSync(planted, "drop table public.orders;\n");
    try {
      const offenders = scan();
      const caught = offenders.some((o) => o.includes("gate_control"));
      console.log(caught
        ? "  positive control: the planted DROP TABLE WAS flagged — the gate can go red"
        : "  POSITIVE CONTROL FAILED: the planted DROP TABLE was not flagged");
      process.exitCode = caught ? 0 : 1;
    } finally {
      rmSync(planted, { force: true });
    }
    return;
  }

  const offenders = scan();
  console.log("check:migrations (destructive scan) — comments stripped before matching");
  for (const o of offenders) console.error(`  DESTRUCTIVE: ${o}`);
  if (offenders.length) {
    console.error(`\n  FAIL — ${offenders.length} destructive statement(s) in forward migrations`);
    process.exitCode = 1;
    return;
  }
  console.log("  PASS — no destructive statement in any forward migration");
}

main();

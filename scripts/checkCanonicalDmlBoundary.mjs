/** Static boundary for the canonical commercial spine. */
import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME_TREES = ["app/api/couranr", "lib/couranr"];
const PROTECTED = [
  "couranr_delivery_requests",
  "couranr_delivery_request_events",
  "couranr_quote_versions",
  "couranr_payment_obligations",
  "couranr_payment_events",
  "couranr_service_plans",
  "couranr_deliveries",
  "couranr_delivery_events",
  "couranr_delivery_assignments",
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

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => {
      const i = line.indexOf("//");
      return i === -1 ? line : line.slice(0, i);
    })
    .join("\n");
}

function scanFile(file) {
  const src = stripComments(readFileSync(file, "utf8"));
  const aliases = new Map();
  for (const match of src.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*["'`]([^"'`]+)["'`]/g)) {
    if (PROTECTED.includes(match[2])) aliases.set(match[1], match[2]);
  }

  const offenders = [];
  for (const match of src.matchAll(/\.from\(\s*([^\)]+?)\s*\)/g)) {
    const arg = match[1].trim();
    const literal = arg.match(/^["'`]([^"'`]+)["'`]$/)?.[1];
    const table = literal ?? aliases.get(arg);
    if (!table || !PROTECTED.includes(table)) continue;
    const semicolon = src.indexOf(";", match.index);
    const end = Math.min(
      semicolon === -1 ? match.index + 1600 : semicolon + 1,
      match.index + 1600
    );
    const chain = src.slice(match.index, end);
    const write = chain.match(/\.(insert|update|delete|upsert)\s*\(/);
    if (write) offenders.push(`${table}: .${write[1]}()`);
  }

  const names = PROTECTED.join("|");
  const rawDml = new RegExp(
    `\\b(insert\\s+into|update|delete\\s+from)\\s+(?:public\\.)?(?:${names})\\b`,
    "ig"
  );
  for (const match of src.matchAll(rawDml)) offenders.push(`raw SQL: ${match[0]}`);
  return offenders;
}

function scan() {
  const offenders = [];
  for (const tree of RUNTIME_TREES) {
    for (const file of walk(path.join(ROOT, tree))) {
      for (const violation of scanFile(file)) {
        offenders.push(`${path.relative(ROOT, file)} -> ${violation}`);
      }
    }
  }
  return offenders;
}

function main() {
  if (process.argv.includes("--positive-control")) {
    const planted = path.join(ROOT, "lib/couranr/__dml_control__.ts");
    writeFileSync(
      planted,
      'const db: any = null; db.from("couranr_payment_obligations").update({ amount_cents: 1 });\n'
    );
    try {
      const caught = scan().some((o) => o.includes("__dml_control__"));
      console.log(caught
        ? "positive control: planted protected UPDATE was flagged"
        : "POSITIVE CONTROL FAILED: planted protected UPDATE was not flagged");
      process.exitCode = caught ? 0 : 1;
    } finally {
      rmSync(planted, { force: true });
    }
    return;
  }

  const offenders = scan();
  console.log(`check:canonical-dml — ${RUNTIME_TREES.length} runtime trees, ${PROTECTED.length} protected objects`);
  for (const offender of offenders) console.error(`  DIRECT DML: ${offender}`);
  if (offenders.length) {
    console.error(`FAIL — ${offenders.length} protected direct-DML path(s)`);
    process.exitCode = 1;
    return;
  }
  console.log("PASS — protected commercial mutations use named commands");
}

main();

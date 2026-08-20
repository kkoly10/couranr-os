#!/usr/bin/env node
/**
 * `npm run check:drift-ledger` — validates
 * docs/couranr-mvp/ui-reference/PUB_001_VISUAL_DRIFT_LEDGER.csv.
 *
 * COURANR_VISUAL_FIDELITY_AMENDMENT.md §4 replaces Gate A with a region-by-region
 * drift ledger and fixes its shape: eleven columns, twenty-four named regions, and
 * five allowed classifications. §4 also states the promotion rule:
 *
 *   "No `VERIFY` row may remain when PUB-001 is promoted to visual completion."
 *
 * So this checks the ledger against the AMENDMENT ITSELF — the region list is
 * parsed out of §4's own fenced block rather than retyped here, which is the
 * same rule §27.0's table follows: a checklist that carries its own copy of the
 * spec is a checklist that can agree with itself while disagreeing with the
 * document.
 *
 * What it enforces:
 *   - exactly §4's regions, in §4's order, no extras and no omissions;
 *   - exactly §4's columns;
 *   - every classification is one of the five allowed values;
 *   - a row that is not KEEP names a required_change — a defect with no
 *     remedy recorded is a note, not a ledger entry;
 *   - a row citing a mock names a file that EXISTS on disk;
 *   - a row whose mock file is the "no artboard" marker is classified KEEP or
 *     VERIFY, never REBUILD/RESTYLE — you cannot restyle toward a reference
 *     that does not exist;
 *   - every intentional_deviation names an authority (§10: "Each intentional
 *     deviation must name the written authority that requires it").
 *
 * `--promote` additionally enforces §4's promotion rule and is what a visual
 * completion claim must run. It is separate because the ordinary check must
 * pass while the work is still in progress.
 *
 * `--positive-control` plants a violation of each rule and fails if any goes
 * undetected.
 *
 * Read-only.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const LEDGER = "docs/couranr-mvp/ui-reference/PUB_001_VISUAL_DRIFT_LEDGER.csv";
const AMENDMENT = "docs/couranr-mvp/brand/COURANR_VISUAL_FIDELITY_AMENDMENT.md";

const CLASSIFICATIONS = ["KEEP", "REMOVE", "RESTYLE", "REBUILD", "VERIFY"];
/** The marker a row uses when no artboard covers its region. */
const NO_REFERENCE = "(none";

/** Minimal RFC4180 reader — the prose columns are full of commas and quotes. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}

/** §4's own region and column lists, read from the amendment. */
function amendmentContract(doc) {
  const block = (label) => {
    const m = doc.match(new RegExp(`${label}[\\s\\S]*?\`\`\`text\\n([\\s\\S]*?)\`\`\``));
    if (!m) throw new Error(`${AMENDMENT}: could not find the "${label}" block`);
    return m[1].trim().split("\n").map((l) => l.trim()).filter(Boolean);
  };
  return { columns: block("Required columns:"), regions: block("Required PUB-001 regions:") };
}

function scan(text, doc, { promote = false } = {}) {
  const fail = [];
  const { columns, regions } = amendmentContract(doc);
  const rows = parseCsv(text);
  if (rows.length < 2) return { fail: ["the ledger has no data rows"], rows: [] };

  const header = rows[0];
  if (JSON.stringify(header) !== JSON.stringify(columns)) {
    fail.push(`columns disagree with the amendment — ledger [${header.join(", ")}], §4 [${columns.join(", ")}]`);
  }

  const data = rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
  const got = data.map((r) => r.region);
  if (JSON.stringify(got) !== JSON.stringify(regions)) {
    const missing = regions.filter((x) => !got.includes(x));
    const extra = got.filter((x) => !regions.includes(x));
    fail.push(
      `regions disagree with §4 — ${missing.length ? `missing: ${missing.join(", ")}; ` : ""}` +
        `${extra.length ? `extra: ${extra.join(", ")}; ` : ""}` +
        `${!missing.length && !extra.length ? "same set, wrong order" : ""}`,
    );
  }

  for (const r of data) {
    const at = `${r.region}`;
    if (!CLASSIFICATIONS.includes(r.classification)) {
      fail.push(`${at}: classification "${r.classification}" is not one of ${CLASSIFICATIONS.join("/")}`);
    }
    if (r.classification !== "KEEP" && !r.required_change.trim()) {
      fail.push(`${at}: classified ${r.classification} with no required_change — a defect with no remedy is a note, not a ledger row`);
    }
    if (r.intentional_deviation.trim() && !r.written_content_authority.trim() && !/\b[A-Z]{3}-\d{3}\b|§|amendment/i.test(r.intentional_deviation)) {
      fail.push(`${at}: intentional_deviation names no authority (§10)`);
    }

    const refs = r.canonical_mock_file.trim();
    if (refs && !refs.startsWith(NO_REFERENCE)) {
      for (const f of refs.split(";").map((x) => x.trim()).filter(Boolean)) {
        if (!existsSync(join(repo, f))) fail.push(`${at}: canonical_mock_file "${f}" does not exist`);
      }
    } else if (["REBUILD", "RESTYLE", "REMOVE"].includes(r.classification)) {
      fail.push(`${at}: classified ${r.classification} but names no canonical reference — nothing to reconcile toward`);
    }

    if (promote && r.classification === "VERIFY") {
      fail.push(`${at}: still VERIFY — §4 forbids promoting PUB-001 to visual completion with an unresolved row`);
    }
  }
  return { fail, rows: data };
}

const text = readFileSync(join(repo, LEDGER), "utf8");
const doc = readFileSync(join(repo, AMENDMENT), "utf8");

if (process.argv.includes("--positive-control")) {
  /* Every plant must actually change the text. When the ledger reached all-KEEP
   * the two controls that grepped for a literal `,REBUILD,` and for a surviving
   * `VERIFY` row silently planted NOTHING and would have reported a pass on an
   * unchanged file — the exact shape of "a check that cannot fail". Each plant
   * is now asserted to have modified the input before its result is read. */
  const reclassify = (t, to) => t.replace(/^(footer,)([\s\S]*?),KEEP,/m, `$1$2,${to},`);
  const controls = [
    ["an unknown classification", (t) => t.replace(",KEEP,", ",LOOKS_FINE,"), "is not one of"],
    ["a non-KEEP row with no required_change", (t) => reclassify(t, "REBUILD"), "no required_change"],
    ["a dropped region", (t) => t.split("\n").filter((l) => !l.startsWith("footer,")).join("\n"), "regions disagree"],
    ["a mock file that does not exist", (t) => t.replace(/0E4F029F-[0-9A-F-]+\.png/, "NOT-A-REAL-FILE.png"), "does not exist"],
    [
      "a REBUILD against a region with no artboard",
      (t) => t.replace(/^(pickup-problem,)([\s\S]*?),KEEP,/m, "$1$2,REBUILD,"),
      "names no canonical reference",
    ],
  ];
  let bad = 0;
  for (const [what, plant, expect] of controls) {
    const planted = plant(text);
    if (planted === text) {
      console.error(`positive control FAILED — could not plant ${what}; the control tested nothing`);
      bad++;
      continue;
    }
    const { fail } = scan(planted, doc);
    const hit = fail.find((f) => f.includes(expect));
    if (!hit) { console.error(`positive control FAILED — ${what} was not detected`); bad++; }
    else console.log(`check:drift-ledger positive control ok — ${what} was rejected: "${hit.slice(0, 110)}"`);
  }
  // And the promotion rule, which the ordinary scan deliberately does not apply.
  // The live ledger is all-KEEP, so this plants the VERIFY row it must reject.
  const unresolved = reclassify(text, "VERIFY");
  if (unresolved === text) {
    console.error("positive control FAILED — could not plant an unresolved VERIFY row");
    bad++;
  } else {
    const { fail } = scan(unresolved, doc, { promote: true });
    if (!fail.some((f) => f.includes("still VERIFY"))) {
      console.error("positive control FAILED — --promote did not reject an unresolved VERIFY row");
      bad++;
    } else {
      console.log("check:drift-ledger positive control ok — --promote rejects an unresolved VERIFY row");
    }
  }
  process.exit(bad ? 1 : 0);
}

const promote = process.argv.includes("--promote");
const { fail, rows } = scan(text, doc, { promote });
if (fail.length) {
  console.error(`check-drift-ledger: ${fail.length} problem(s) in ${LEDGER}\n`);
  for (const f of fail) console.error(`  - ${f}`);
  process.exit(1);
}
const counts = rows.reduce((a, r) => ((a[r.classification] = (a[r.classification] ?? 0) + 1), a), {});
const noRef = rows.filter((r) => r.canonical_mock_file.trim().startsWith(NO_REFERENCE)).length;
console.log(
  `check-drift-ledger: ok — ${rows.length} regions ` +
    `(${CLASSIFICATIONS.filter((c) => counts[c]).map((c) => `${counts[c]} ${c}`).join(", ")}), ` +
    `${noRef} with no canonical reference` +
    (promote ? "; PROMOTION rule satisfied" : `; run with --promote before claiming visual completion`),
);

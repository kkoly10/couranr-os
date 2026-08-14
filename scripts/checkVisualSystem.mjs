#!/usr/bin/env node
/**
 * `npm run check:visual-system` — validates the internal consistency of
 * docs/couranr-mvp/brand/COURANR_VISUAL_SYSTEM_V2_2.md.
 *
 * That document is a specification, not code, but §27.0's table is a contract
 * the PUB-001 implementation gets tested against: it fixes the twelve governed
 * `data-couranr-section` ids, the `data-composition` each must carry, and the
 * three DOM flags whose counts §32.3 asserts. A spec that quietly contradicts
 * itself produces an implementation that passes its own invented gate — which
 * is exactly the failure §27.0 was added to remove.
 *
 * So this re-derives, from the document text:
 *   - §27.0 has exactly twelve rows, numbered 1..12, with unique ids
 *   - every `data-composition` value is an approved §19 type (closed vocabulary)
 *   - no two adjacent sections share a composition        (§19 hard rule)
 *   - grid-dominant count <= 2                            (§19 hard rule)
 *   - image-led count >= 2                                (§27 / §1.12)
 *   - product-proof count >= 1                            (§27 / §1.14)
 *   - exactly one workflow-rail section                   (§32.3)
 *   - §25's composition_regions == the twelve ids + `navigation`
 *   - §32.3's example id is on the table
 *   - no normative reference to a superseded version of this document
 *
 * `--positive-control` runs the same checks against an in-memory copy with one
 * row's composition duplicated onto its neighbour, and fails if the adjacency
 * rule does NOT catch it. Nothing on disk is written.
 *
 * Read-only.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOC = "docs/couranr-mvp/brand/COURANR_VISUAL_SYSTEM_V2_2.md";
const SELF_VERSION = "v2.2";

/** The whole scan, pure in the document text, so the control can mutate a copy. */
function scan(doc) {
  const fail = [];

  /* ---- §19: the approved composition vocabulary ------------------------ */
  const approved = new Set(
    [...doc.matchAll(/^## 19\.\d+ (.+)$/gm)].map((m) => m[1].toLowerCase().replace(/ /g, "-")),
  );
  if (approved.size === 0) fail.push("§19 declares no composition types");

  /* ---- §27.0: the normative section table ------------------------------ */
  const table = doc.match(/## 27\.0 Governed section identifiers[\s\S]*?\n\n(\| # [\s\S]*?)\n\n/);
  if (!table) return { fail: ["§27.0 normative table not found"] };

  const rows = table[1]
    .trim()
    .split("\n")
    .filter((r) => /^\|\s*\d+\s*\|/.test(r))
    .map((r) => {
      const c = r.replace(/^\||\|$/g, "").split("|").map((x) => x.trim());
      const flag = (v) => v.replace(/\*\*/g, "");
      return {
        n: Number(c[0]),
        id: c[1].replace(/`/g, ""),
        composition: c[4].replace(/`/g, ""),
        imageLed: flag(c[5]),
        gridDominant: flag(c[6]),
        productProof: flag(c[7]),
      };
    });

  if (rows.length !== 12) fail.push(`§27.0 has ${rows.length} rows, expected 12`);
  if (rows.some((r, i) => r.n !== i + 1)) fail.push("§27.0 rows are not numbered 1..12 in order");
  if (new Set(rows.map((r) => r.id)).size !== rows.length) fail.push("§27.0 has a duplicate section id");

  for (const r of rows) {
    if (!approved.has(r.composition)) {
      fail.push(`section ${r.n} (${r.id}): "${r.composition}" is not an approved §19 type`);
    }
    for (const [k, v] of [["image-led", r.imageLed], ["grid-dominant", r.gridDominant], ["product-proof", r.productProof]]) {
      if (v !== "true" && v !== "false") fail.push(`section ${r.n} (${r.id}): ${k} is "${v}", want true/false`);
    }
  }

  /* ---- the budgets §32.3 asserts --------------------------------------- */
  const adjacent = rows
    .slice(1)
    .map((r, i) => (r.composition === rows[i].composition ? `${rows[i].n}+${r.n} both "${r.composition}"` : null))
    .filter(Boolean);
  if (adjacent.length) fail.push(`§19 forbids consecutive identical compositions: ${adjacent.join(", ")}`);

  const count = (k) => rows.filter((r) => r[k] === "true").length;
  if (count("gridDominant") > 2) fail.push(`grid-dominant sections: ${count("gridDominant")}, cap is 2`);
  if (count("imageLed") < 2) fail.push(`image-led sections: ${count("imageLed")}, floor is 2`);
  if (count("productProof") < 1) fail.push(`product-proof sections: ${count("productProof")}, floor is 1`);

  const rails = rows.filter((r) => r.composition === "workflow-rail").length;
  if (rails !== 1) fail.push(`workflow-rail sections: ${rails}, must be exactly 1`);

  /* ---- §25 must use the same vocabulary -------------------------------- */
  const regionsBlock = doc.match(/"composition_regions": \[([\s\S]*?)\]/);
  if (!regionsBlock) fail.push("§25 declares no composition_regions");
  else {
    const regions = [...regionsBlock[1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
    if (!regions.includes("navigation")) fail.push("§25 composition_regions is missing `navigation`");
    const ids = new Set(rows.map((r) => r.id));
    const extra = regions.filter((r) => r !== "navigation" && !ids.has(r));
    const missing = [...ids].filter((i) => !regions.includes(i));
    if (extra.length) fail.push(`§25 region(s) not on the §27.0 table: ${extra.join(", ")}`);
    if (missing.length) fail.push(`§27.0 id(s) absent from §25 regions: ${missing.join(", ")}`);
  }

  /* ---- §32.3's example must be a real id ------------------------------- */
  const example = doc.match(/data-couranr-section="([a-z-]+)"/);
  if (!example) fail.push("§32.3 shows no data-couranr-section example");
  else if (!rows.some((r) => r.id === example[1])) {
    fail.push(`§32.3 example id "${example[1]}" is not on the §27.0 table`);
  }

  /* ---- no NORMATIVE reference to a superseded version ------------------- */
  // Historical sentences about what an earlier draft said are legitimate and
  // must survive — they are the audit trail, and the revision log quotes them
  // verbatim. So this checks LOCATIONS rather than pattern-matching prose:
  // the four regions whose text either becomes production authority or is the
  // contract an implementer executes. A stale version in §2.1 is the worst of
  // them — §2 instructs that object to be committed to the root decision
  // registry, where it would be permanent.
  const REGIONS = [
    ["§2.1 decision object (lands in 02_DECISION_REGISTRY.json)", /## 2\.1 Root decision registry[\s\S]*?(?=\n## 2\.2 )/],
    ["§3 authority-by-question table", /# 3\. Authority by question[\s\S]*?(?=\n# 4\. )/],
    ["§31 migration steps", /# 31\. Migration from current[\s\S]*?(?=\n# 32\. )/],
    ["§35 implementation directive", /# 35\. Claude \/ Fable implementation directive[\s\S]*?(?=\n# 36\. )/],
  ];
  for (const [label, re] of REGIONS) {
    const region = doc.match(re);
    if (!region) {
      fail.push(`could not locate ${label} — the version check cannot run over it`);
      continue;
    }
    for (const m of region[0].matchAll(/^.*v2\.[01]\b.*$/gm)) {
      fail.push(`${label} cites a superseded version — ${m[0].trim().slice(0, 90)}`);
    }
  }

  /* ---- §2.5 materialization gate --------------------------------------- */
  // §2 forbids treating the v2.2 typography as authoritative until the decision
  // exists in the higher authorities. That gate is prose, so it is checked here
  // instead — otherwise the whole point of §2 (a lower-ranked design file must
  // not silently override a higher-ranked spec) survives only as good manners.
  let materialized = false;
  try {
    const registry = JSON.parse(readFileSync(join(repo, "02_DECISION_REGISTRY.json"), "utf8"));
    const vis = registry.decisions.find((e) => e.id === "VIS-001");
    if (!vis) {
      fail.push("§2.1 not materialized: no VIS-001 decision in 02_DECISION_REGISTRY.json");
    } else {
      materialized = true;
      if (vis.status !== "decided") fail.push(`VIS-001 status is "${vis.status}", expected "decided"`);
      for (const k of ["display_font", "body_font", "mono_font", "token_namespace", "accessibility_floor"]) {
        if (!vis.value?.[k]) fail.push(`VIS-001 value is missing "${k}"`);
      }
      if (vis.value?.token_namespace !== "--couranr-*") {
        fail.push(`VIS-001 records token_namespace "${vis.value?.token_namespace}", expected "--couranr-*"`);
      }
    }
  } catch (e) {
    fail.push(`could not read 02_DECISION_REGISTRY.json — ${e.message}`);
  }

  const uiReg = readFileSync(join(repo, "UI_SCREEN_REGISTRY.md"), "utf8");
  if (/Typography:\*\* Geist Sans or Inter/.test(uiReg)) {
    fail.push("§2.2 not materialized: UI_SCREEN_REGISTRY.md still says 'Geist Sans or Inter'");
  }
  for (const f of ["Martian Grotesk Variable", "Inter Variable", "Martian Mono"]) {
    if (!uiReg.includes(f)) fail.push(`§2.2 not materialized: UI_SCREEN_REGISTRY.md does not name ${f}`);
  }
  if (!uiReg.includes("COURANR_VISUAL_SYSTEM_V2_2.md")) {
    fail.push("§2.2 not materialized: UI_SCREEN_REGISTRY.md has no visual-system cross-reference");
  }

  // §2.3 — the differentiation statement must exist as approved marketing copy.
  const blueprint = readFileSync(
    join(repo, "docs/couranr-mvp/MARKETING_POSITIONING_AND_HOMEPAGE_BLUEPRINT.md"), "utf8");
  if (!blueprint.includes("Local delivery, built for more than restaurants.")) {
    fail.push("§2.3 not materialized: the approved differentiation statement is not in the marketing blueprint");
  }
  if (!blueprint.includes("Local delivery should not stop at restaurant orders.")) {
    fail.push("§2.3 violated: the existing conceptual framing was removed, and §2.3 says to keep it");
  }

  // §2.4 — the brand guide's tagline rule must survive untouched.
  const brand = readFileSync(
    join(repo, "docs/couranr-mvp/brand/couranr_logo_system/BRAND_GUIDE.md"), "utf8");
  if (!/DELIVERY MADE SIMPLE/.test(brand) || !/Do not use the tagline inside small headers/.test(brand)) {
    fail.push("§2.4 violated: the BRAND_GUIDE tagline-lockup rule was removed or rewritten");
  }

  return {
    fail,
    summary:
      `12 sections, ${approved.size} approved compositions, ` +
      `${count("imageLed")} image-led, ${count("gridDominant")} grid-dominant, ` +
      `${count("productProof")} product-proof, ${rails} workflow rail, 0 adjacent duplicates; ` +
      `§2 materialization ${materialized ? "landed (VIS-001)" : "MISSING"}`,
  };
}

const doc = readFileSync(join(repo, DOC), "utf8");

if (process.argv.includes("--positive-control")) {
  // Copy section 6's composition onto section 7. The adjacency rule must fire.
  const broken = doc.replace(
    /(\| 7 \| `product-proof` \|[^|]*\|[^|]*\| )`product-proof`/,
    "$1`workflow-rail`",
  );
  if (broken === doc) {
    console.error("positive control could not plant a violation — §27.0 row 7 not matched");
    process.exit(1);
  }
  const { fail } = scan(broken);
  if (!fail.some((f) => f.includes("consecutive identical compositions"))) {
    console.error("positive control FAILED — a planted adjacent duplicate was not detected");
    console.error(fail.length ? fail.join("\n") : "  (the scan reported nothing at all)");
    process.exit(1);
  }
  console.log(`check:visual-system positive control ok — planted adjacency violation was flagged`);
  process.exit(0);
}

const { fail, summary } = scan(doc);
if (fail.length) {
  console.error(`check-visual-system: ${fail.length} problem(s) in ${DOC}\n`);
  for (const f of fail) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`check-visual-system: ok — ${summary} (${SELF_VERSION})`);

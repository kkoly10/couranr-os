#!/usr/bin/env node
/**
 * `npm run check:visual-system` — validates the internal consistency of
 * docs/couranr-mvp/brand/COURANR_VISUAL_SYSTEM_V2_2.md.
 *
 * That document is a specification, not code, but its governed section tables
 * are a contract the implementation gets tested against: they fix the governed
 * `data-couranr-section` ids, the `data-composition` each must carry, and the
 * three DOM flags whose counts §32.3 asserts. A spec that quietly contradicts
 * itself produces an implementation that passes its own invented gate — which
 * is exactly the failure §27.0 was added to remove.
 *
 * Five pages are governed now, not one: §27.0 for PUB-001 and §27.1 for
 * PUB-008/009/010/011. Every table is checked the same way; only the numeric
 * budgets differ, because §32.3 says the family pages' counts are page-specific
 * and must not be copied from PUB-001.
 *
 * So this re-derives, from the document text:
 *   - §27.0 has exactly EXPECTED_ROWS rows, numbered 1..n, with unique ids
 *   - EVERY governed table numbers 1..n and has unique ids
 *   - every `data-composition` value is an approved §19 type (closed vocabulary)
 *   - no two adjacent sections share a composition        (§19 hard rule, all pages)
 *   - PUB-001: grid-dominant <= 2, image-led >= 2, product-proof >= 1,
 *     exactly one workflow rail                           (§32.3's stated numbers)
 *   - each §27.1 page: its own declared `**Budgets:**` line holds
 *   - §25's composition_regions == PUB-001's ids + `navigation`
 *   - §32.3's example id is on the PUB-001 table
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
import {
  withPlantedContract,
  approvedCompositions,
  budgetHolds,
  budgets,
  countFlag,
  governedPages,
  specRows,
} from "./compositionContract.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOC = "docs/couranr-mvp/brand/COURANR_VISUAL_SYSTEM_V2_2.md";
const SELF_VERSION = "v2.2";

/**
 * How many rows §27.0 must carry.
 *
 * Thirteen since MKT-003 added `delivery-options`. This is asserted rather than
 * derived so that a row silently DISAPPEARING from the table is caught: every
 * other check here is a property of whatever rows it finds, and all of them
 * pass happily on a table that lost a section. Changing this number is a
 * content decision and belongs in 02_DECISION_REGISTRY.json first.
 */
const EXPECTED_ROWS = 14;

/**
 * The screens with a canonical artboard. COURANR_VISUAL_FIDELITY_AMENDMENT.md
 * §3.1 demotes §19's adjacency prohibition to a drift diagnostic FOR THESE, and
 * §12 leaves it in force for the family pages, which have no independent mock
 * and derive from the public family instead.
 */
const HAS_CANONICAL_MOCK = new Set(["PUB-001"]);

/** The whole scan, pure in the document text, so the control can mutate a copy. */
function scan(doc) {
  const fail = [];
  /** Reported, never fatal. See the adjacency block below. */
  const diagnostics = [];

  /* ---- §19: the approved composition vocabulary ------------------------ */
  const approved = approvedCompositions(doc);
  if (approved.size === 0) fail.push("§19 declares no composition types");

  /* ---- every governed table, §27.0 and §27.1 --------------------------- */
  const pages = governedPages(doc);
  const tables = new Map();

  for (const page of pages) {
    let rows;
    try {
      rows = specRows(doc, page);
    } catch (e) {
      fail.push(e.message);
      continue;
    }
    tables.set(page.screen, rows);

    if (rows.some((r, i) => r.n !== i + 1)) {
      fail.push(`${page.screen}: rows are not numbered 1..${rows.length} in order`);
    }
    if (new Set(rows.map((r) => r.id)).size !== rows.length) {
      fail.push(`${page.screen}: duplicate section id in the table`);
    }

    for (const r of rows) {
      if (!approved.has(r.composition)) {
        fail.push(`${page.screen} section ${r.n} (${r.id}): "${r.composition}" is not an approved §19 type`);
      }
      for (const [k, v] of [["image-led", r.imageLed], ["grid-dominant", r.gridDominant], ["product-proof", r.productProof]]) {
        if (v !== "true" && v !== "false") {
          fail.push(`${page.screen} section ${r.n} (${r.id}): ${k} is "${v}", want true/false`);
        }
      }
    }

    /* §19's adjacency rule.
     *
     * It used to be enforced on every page as "a property of the grammar". The
     * amendment splits that: on a screen WITH a canonical mock it is a drift
     * DIAGNOSTIC, because the artboard's own sequence may contain adjacent
     * duplicates and a gate that forbids them forces the screen away from the
     * design (§3.1, §5.7 — `delivery-options` and `pricing` are the two it
     * forced on this branch). On a screen with no mock the rule still governs,
     * which is where the anti-template grammar is doing its intended job. */
    const adjacent = rows
      .slice(1)
      .map((r, i) => (r.composition === rows[i].composition ? `${rows[i].n}+${r.n} both "${r.composition}"` : null))
      .filter(Boolean);
    diagnostics.push(...adjacent.map((a) => `${page.screen}: adjacent duplicate composition — ${a}`));
    if (adjacent.length && !HAS_CANONICAL_MOCK.has(page.screen)) {
      fail.push(
        `${page.screen}: §19 forbids consecutive identical compositions on a screen with no canonical mock — ${adjacent.join(", ")}`,
      );
    }

    // Per-page budgets. §32.3 states PUB-001's numerically and says the family
    // pages' are page-specific, so those come from their own declared line.
    const rails = rows.filter((r) => r.composition === "workflow-rail").length;
    if (page.screen === "PUB-001") {
      if (rows.length !== EXPECTED_ROWS) {
        fail.push(`§27.0 has ${rows.length} rows, expected ${EXPECTED_ROWS}`);
      }
      if (countFlag(rows, "gridDominant") > 2) fail.push(`PUB-001 grid-dominant: ${countFlag(rows, "gridDominant")}, cap is 2`);
      if (countFlag(rows, "imageLed") < 2) fail.push(`PUB-001 image-led: ${countFlag(rows, "imageLed")}, floor is 2`);
      if (countFlag(rows, "productProof") < 1) fail.push(`PUB-001 product-proof: ${countFlag(rows, "productProof")}, floor is 1`);
      if (rails !== 1) fail.push(`PUB-001 workflow-rail sections: ${rails}, must be exactly 1`);
      continue;
    }

    const budget = budgets(doc, page);
    if (!budget) {
      // A family page with no declared budget is the §32.3 hole reopening —
      // "page-specific counts" with nothing written down is not a contract.
      fail.push(`${page.screen}: §27.1 declares no **Budgets:** line, so its counts are unenforceable`);
      continue;
    }
    const actual = {
      gridDominant: countFlag(rows, "gridDominant"),
      imageLed: countFlag(rows, "imageLed"),
      productProof: countFlag(rows, "productProof"),
      workflowRail: rails,
    };
    for (const [key, rule] of Object.entries(budget)) {
      if (!budgetHolds(rule, actual[key])) {
        fail.push(`${page.screen}: ${key} is ${actual[key]}, budget says ${rule.op} ${rule.n}`);
      }
    }
    // §19's cap is a hard rule of the grammar; a page may declare a tighter
    // budget than 2 but never a looser one.
    if (actual.gridDominant > 2) {
      fail.push(`${page.screen}: grid-dominant ${actual.gridDominant} exceeds §19's hard cap of 2`);
    }
  }

  const rows = tables.get("PUB-001") ?? [];
  const count = (k) => countFlag(rows, k);
  const rails = rows.filter((r) => r.composition === "workflow-rail").length;

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
    diagnostics,
    summary:
      `${pages.length} governed page(s) — ` +
      pages.map((p) => `${p.screen}:${tables.get(p.screen)?.length ?? "?"}`).join(" ") +
      `; ${approved.size} approved compositions; PUB-001 ` +
      `${count("imageLed")} image-led, ${count("gridDominant")} grid-dominant, ` +
      `${count("productProof")} product-proof, ${rails} workflow rail, ` +
      `${diagnostics.length} adjacent duplicate(s); ` +
      `§2 materialization ${materialized ? "landed (VIS-001)" : "MISSING"}`,
  };
}

const doc = readFileSync(join(repo, DOC), "utf8");

if (process.argv.includes("--positive-control")) {
  let bad = 0;
  const control = (what, plant, expect, where = "fail") => {
    const broken = plant(doc);
    if (broken === doc) {
      console.error(`positive control could not plant a violation — ${what}`);
      bad++;
      return;
    }
    const result = scan(broken);
    const hit = result[where].find((f) => f.includes(expect));
    if (!hit) {
      console.error(`positive control FAILED — ${what} was not detected`);
      console.error(result[where].length ? result[where].join("\n") : "  (nothing reported at all)");
      bad++;
    } else {
      console.log(`check:visual-system positive control ok — ${what}: "${hit.slice(0, 110)}"`);
    }
  };

  /* THESE PLANTS MOVED FROM THE MARKDOWN INTO THE CONTRACT, and the move is the
     point. They used to rewrite a §27 table string; once the composition
     contract became structured data, that mutated a document this gate no
     longer reads, so the controls passed while testing nothing. `check:gates:
     controls` caught it the first time the migration ran — which is what a
     control registry is for. */
  const rowsOf = (reg, screen) =>
    reg.composition.pages.find((p) => p.screen === screen).rows;
  const contractControl = (what, patch, expect, where = "fail") => {
    const result = withPlantedContract(patch, () => scan(doc));
    const hit = result[where].find((f) => f.includes(expect));
    if (!hit) {
      console.error(`positive control FAILED — ${what} was not detected`);
      console.error(result[where].length ? result[where].join("\n") : "  (nothing reported at all)");
      bad++;
    } else {
      console.log(`check:visual-system positive control ok — ${what}: "${hit.slice(0, 110)}"`);
    }
  };

  // A planted adjacency on a FAMILY page, which has no canonical mock, must
  // still be fatal — that is where §19's grammar still governs.
  contractControl(
    "an adjacent duplicate on a page with no canonical mock",
    // PUB-011 row 2 (`sequence`, a `workflow-rail`) copied onto row 1's
    // `editorial-statement`, so rows 1 and 2 collide.
    (reg) => { rowsOf(reg, "PUB-011")[1].composition = "editorial-statement"; },
    "no canonical mock",
  );
  // On PUB-001 the same shape must be REPORTED and must not be fatal — a gate
  // that fails here is the gate that forced `pricing` to navy.
  contractControl(
    "an adjacent duplicate on PUB-001 is reported as a diagnostic",
    (reg) => { rowsOf(reg, "PUB-001")[7].composition = "structured-information-block"; },
    "adjacent duplicate composition",
    "diagnostics",
  );
  // And a row that silently disappears is still caught by the row count.
  contractControl(
    "a dropped §27.0 row",
    (reg) => { rowsOf(reg, "PUB-001").splice(6, 1); },
    "expected 14",
  );
  process.exit(bad ? 1 : 0);
}

const { fail, diagnostics, summary } = scan(doc);
for (const d of diagnostics) console.log(`  diagnostic  ${d}`);
if (fail.length) {
  console.error(`check-visual-system: ${fail.length} problem(s) in ${DOC}\n`);
  for (const f of fail) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`check-visual-system: ok — ${summary} (${SELF_VERSION})`);

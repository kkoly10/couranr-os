/**
 * The v2.2 composition contract, parsed once and shared.
 *
 * §32.3 makes the anti-template guarantees executable on PUB-001 and then says:
 * "For PUB-008/009/010/011, use the same metadata contract on their top-level
 * marketing sections... Their counts are page-specific; do not blindly copy
 * PUB-001's numeric budgets unless this document explicitly applies them."
 *
 * Which left the same hole §27.0 was written to close, four more times: a
 * metadata contract with no normative list to check against, and per-page
 * budgets described as "page-specific" without saying what they are. So §27.1
 * now carries a table per page and a machine-readable budget line per page,
 * and this module is the single parser for all five.
 *
 * ONE implementation, imported by both readers — `scripts/checkVisualSystem.mjs`
 * (which validates the spec against itself) and
 * `tests/couranr-public-composition.test.ts` (which validates the pages against
 * the spec). Two parsers would be two chances to disagree about what the
 * document says, and the disagreement would look like a passing gate.
 *
 * Both sides are still read from source. Nothing here retypes an expected value.
 */
import { readFileSync } from "node:fs";

export const SPEC = "docs/couranr-mvp/brand/COURANR_VISUAL_SYSTEM_V2_2.md";

/** §19's closed vocabulary, from its own subsection headings. */
export function approvedCompositions(doc) {
  return new Set(
    [...doc.matchAll(/^## 19\.\d+ (.+)$/gm)].map((m) => m[1].toLowerCase().replace(/ /g, "-")),
  );
}

const cells = (row) => row.replace(/^\||\|$/g, "").split("|").map((x) => x.trim());
const plain = (v) => v.replace(/\*\*/g, "").replace(/`/g, "").trim();

/**
 * Rows of a `| # | id | … | composition | image-led | grid-dominant |
 * product-proof |` table. Every governed table uses the same eight columns and
 * the same column ORDER, including the two prose columns in positions 3 and 4 —
 * PUB-001's are "§27 section" and "§27 wording", the family pages' are
 * "required state" and "device". Keeping the shape identical is what lets one
 * parser serve all five without a per-page special case.
 */
function parseTable(block) {
  return block
    .trim()
    .split("\n")
    .filter((r) => /^\|\s*\d+\s*\|/.test(r))
    .map((r) => {
      const c = cells(r);
      return {
        n: Number(c[0]),
        id: plain(c[1]),
        composition: plain(c[4]),
        imageLed: plain(c[5]),
        gridDominant: plain(c[6]),
        productProof: plain(c[7]),
      };
    });
}

/**
 * The governed pages and where they live.
 *
 * PUB-001 is declared here rather than parsed from §27.1's index table, because
 * §27.0 is its own normative section and predates the family contract. The
 * other four come from the document so a page cannot be added to the spec and
 * silently skipped by the gate.
 */
export function governedPages(doc) {
  const out = [
    {
      screen: "PUB-001",
      route: "/",
      file: "app/(couranr)/(public)/page.tsx",
      heading: "## 27.0 Governed section identifiers",
    },
  ];

  const index = doc.match(
    /## 27\.1 Public family composition contracts[\s\S]*?\n\n(\| screen [\s\S]*?)\n\n/,
  );
  if (!index) return out;

  for (const row of index[1].trim().split("\n")) {
    if (!/^\|\s*`PUB-\d+`/.test(row)) continue;
    const c = cells(row);
    out.push({
      screen: plain(c[0]),
      route: plain(c[1]),
      file: plain(c[2]),
      heading: `### ${plain(c[0])} —`,
    });
  }
  return out;
}

/** A page's normative table, from the document. */
export function specRows(doc, page) {
  const start = doc.indexOf(page.heading);
  if (start < 0) throw new Error(`${page.screen}: normative heading "${page.heading}" not found`);
  // Stop at the next heading of the same or higher level so one page's table
  // can never be read as another's.
  const rest = doc.slice(start + page.heading.length);
  const end = rest.search(/\n#{1,3} /);
  const region = end < 0 ? rest : rest.slice(0, end);
  // From the header row to the end of the region, NOT to the next blank line:
  // a table that is the last thing before the next heading has no trailing
  // blank line inside its own region, and matching on one silently found no
  // table for three of the four family pages while reporting the fourth fine.
  // parseTable keeps only `| <digit> |` rows, so trailing prose is ignored.
  const table = region.match(/\n(\| # [\s\S]*)/);
  if (!table) throw new Error(`${page.screen}: no governed section table under "${page.heading}"`);
  const rows = parseTable(table[1]);
  if (!rows.length) throw new Error(`${page.screen}: governed section table parsed to zero rows`);
  return rows;
}

/**
 * A page's budgets, read from its `**Budgets:**` line.
 *
 * Written as a machine-readable line rather than prose precisely because
 * §32.3 leaves the family pages' counts undefined. Prose budgets are budgets
 * nobody checks.
 *
 *   **Budgets:** grid-dominant <= 2 · image-led >= 1 · product-proof >= 0 · workflow-rail == 0
 *
 * PUB-001's budgets stay in §27.0's own prose and are asserted separately —
 * they are the ones §32.3 states numerically and this parser does not restate.
 */
const BUDGET_KEYS = {
  "grid-dominant": "gridDominant",
  "image-led": "imageLed",
  "product-proof": "productProof",
  "workflow-rail": "workflowRail",
};

export function budgets(doc, page) {
  const start = doc.indexOf(page.heading);
  if (start < 0) return null;
  const rest = doc.slice(start + page.heading.length);
  const end = rest.search(/\n#{1,3} /);
  const region = end < 0 ? rest : rest.slice(0, end);
  const line = region.match(/\*\*Budgets:\*\*(.+)/);
  if (!line) return null;

  const out = {};
  for (const part of line[1].split("·")) {
    const m = part.trim().match(/^([a-z-]+)\s*(<=|>=|==)\s*(\d+)$/);
    if (!m) throw new Error(`${page.screen}: unparseable budget clause "${part.trim()}"`);
    const key = BUDGET_KEYS[m[1]];
    if (!key) throw new Error(`${page.screen}: unknown budget "${m[1]}"`);
    out[key] = { op: m[2], n: Number(m[3]) };
  }
  return out;
}

export function budgetHolds({ op, n }, actual) {
  if (op === "<=") return actual <= n;
  if (op === ">=") return actual >= n;
  return actual === n;
}

/**
 * What a page's source actually declares, in document order.
 *
 * Any section missing a marker is returned with that marker `undefined` rather
 * than skipped — a section that opts out of being counted defeats the whole
 * gate, so the callers must fail on it.
 */
export function pageRows(src) {
  const out = [];
  const re = /data-couranr-section="([a-z-]+)"([\s\S]{0,400}?)>/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const [, id, rest] = m;
    const attr = (name) => {
      const hit = rest.match(new RegExp(`data-${name}="([^"]*)"`));
      return hit ? hit[1] : undefined;
    };
    out.push({
      n: out.length + 1,
      id,
      composition: attr("composition"),
      imageLed: attr("image-led"),
      gridDominant: attr("grid-dominant"),
      productProof: attr("product-proof"),
    });
  }
  return out;
}

export function readSpec(repo) {
  return readFileSync(`${repo}/${SPEC}`, "utf8");
}

/** Counts a boolean-flag column over rows whose flags are the strings "true"/"false". */
export function countFlag(rows, key) {
  return rows.filter((r) => r[key] === "true").length;
}

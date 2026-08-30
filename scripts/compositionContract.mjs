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
 *
 * THE CONTRACT NOW LIVES IN STRUCTURED DATA, NOT IN MARKDOWN PUNCTUATION.
 *
 * It used to be parsed out of `COURANR_VISUAL_SYSTEM_V2_2.md` by matching exact
 * tokens: backticked screen ids in the §27.1 index, a `### PUB-0xx —` heading
 * with an em dash, a literal `**Budgets:**` label, and a section title that
 * enumerated its own members. Every one of those was an undocumented
 * configuration language, and each produced a real defect across package
 * revisions v4-v7 — a screen-prefixed budget label that parsed to nothing, an
 * unbackticked index row that would have been SILENTLY skipped, a heading
 * prefix that throws, a title that went stale as soon as a page was added.
 *
 * `VISUAL_REGISTRY.json` is the writable source now. The Markdown remains the
 * human design handbook and its §27 tables are rendered from that source, so
 * the document stays readable without being a machine API. The exported
 * signatures still accept the spec text for call compatibility; it is no longer
 * read for the contract.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const SPEC = "docs/couranr-mvp/brand/COURANR_VISUAL_SYSTEM_V2_2.md";
export const VISUAL_REGISTRY = "docs/couranr-mvp/ui-reference/VISUAL_REGISTRY.json";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

let cached = null;
let override = null;
function registry() {
  if (override) return override;
  if (!cached) cached = JSON.parse(readFileSync(join(REPO, VISUAL_REGISTRY), "utf8"));
  return cached;
}

/**
 * Run `fn` against a MUTATED copy of the contract. Positive controls need this:
 * they used to plant a violation by rewriting the Markdown, and once the
 * contract moved into structured data those plants changed a document nothing
 * reads — the controls kept "passing" while testing nothing, which is the exact
 * failure mode a positive control exists to prevent. Now they mutate the thing
 * that actually governs.
 */
export function withPlantedContract(patch, fn) {
  const base = JSON.parse(JSON.stringify(registry()));
  patch(base);
  override = base;
  try {
    return fn();
  } finally {
    override = null;
  }
}

/** §19's closed vocabulary, from its own subsection headings. */
export function approvedCompositions(_doc) {
  return new Set(registry().composition.vocabulary);
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
export function governedPages(_doc) {
  /* No hardcoded PUB-001 entry and no backticked-index parsing. Both were
     load-bearing tokens: the hardcode bound PUB-001 to `/` and one file path in
     TypeScript, and an index row that lost its backticks was skipped in
     silence, which would have dropped a whole page from the governed set while
     every gate stayed green. */
  return registry().composition.pages.map((p) => ({
    screen: p.screen,
    route: p.route,
    file: p.file,
    heading: p.doc_heading,
  }));
}

/** A page's normative table, from the document. */
export function specRows(_doc, page) {
  const p = registry().composition.pages.find((x) => x.screen === page.screen);
  if (!p) throw new Error(`${page.screen}: no composition contract in ${VISUAL_REGISTRY}`);
  if (!p.rows.length) throw new Error(`${page.screen}: composition contract has zero rows`);
  return p.rows;
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

export function budgets(_doc, page) {
  const p = registry().composition.pages.find((x) => x.screen === page.screen);
  return p ? p.budgets : null;
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

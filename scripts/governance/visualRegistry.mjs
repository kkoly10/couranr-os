/**
 * Visual-domain checks.
 *
 * AUTHORITY: `docs/couranr-mvp/ui-reference/VISUAL_REGISTRY.json`.
 *
 * The composition contract moved OUT of Markdown punctuation and into that
 * file. `COURANR_VISUAL_SYSTEM_V2_2.md` stays the human design handbook, and
 * §27's tables stay hand-written prose — but they must not be allowed to drift
 * away from the source that now governs the gates, or the document becomes a
 * confident description of a contract nobody enforces.
 *
 * So the old Markdown parser is kept HERE, demoted from source-of-truth to
 * verifier. It reads §27 exactly the way the gates used to, and the check
 * asserts the two agree. That keeps the readable document honest without making
 * its backticks, em dashes and `**Budgets:**` label load-bearing again.
 *
 * Read-only.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const SPEC = "docs/couranr-mvp/brand/COURANR_VISUAL_SYSTEM_V2_2.md";
export const VISUAL_REGISTRY = "docs/couranr-mvp/ui-reference/VISUAL_REGISTRY.json";

const cells = (row) => row.replace(/^\||\|$/g, "").split("|").map((x) => x.trim());
const plain = (v) => v.replace(/\*\*/g, "").replace(/`/g, "").trim();

/** §19's closed vocabulary, from its own subsection headings. */
function docVocabulary(doc) {
  return [...doc.matchAll(/^## 19\.\d+ (.+)$/gm)]
    .map((m) => m[1].toLowerCase().replace(/ /g, "-"))
    .sort();
}

function docPages(doc) {
  const out = [
    { screen: "PUB-001", heading: "## 27.0 Governed section identifiers" },
  ];
  const index = doc.match(
    /## 27\.1 Public family composition contracts[\s\S]*?\n\n(\| screen [\s\S]*?)\n\n/,
  );
  if (!index) return out;
  for (const row of index[1].trim().split("\n")) {
    if (!/^\|\s*`PUB-\d+`/.test(row)) continue;
    const c = cells(row);
    out.push({ screen: plain(c[0]), heading: `### ${plain(c[0])} —` });
  }
  return out;
}

function docRows(doc, page) {
  const start = doc.indexOf(page.heading);
  if (start < 0) return null;
  const rest = doc.slice(start + page.heading.length);
  const end = rest.search(/\n#{1,3} /);
  const region = end < 0 ? rest : rest.slice(0, end);
  const table = region.match(/\n(\| # [\s\S]*)/);
  if (!table) return null;
  const rows = [];
  for (const line of table[1].split("\n")) {
    if (!/^\|\s*\d+\s*\|/.test(line)) continue;
    const c = cells(line);
    rows.push({
      n: Number(plain(c[0])),
      id: plain(c[1]),
      composition: plain(c[4]),
      imageLed: plain(c[5]),
      gridDominant: plain(c[6]),
      productProof: plain(c[7]),
    });
  }
  return rows;
}

/**
 * Does the human handbook still describe the contract the gates enforce?
 * Returns a list of disagreements; empty means the document is honest.
 */
export function visualDocDrift(root) {
  const fail = [];
  const doc = readFileSync(join(root, SPEC), "utf8");
  const reg = JSON.parse(readFileSync(join(root, VISUAL_REGISTRY), "utf8"));

  const dv = docVocabulary(doc);
  const rv = [...reg.composition.vocabulary].sort();
  if (JSON.stringify(dv) !== JSON.stringify(rv)) {
    fail.push(
      `§19's vocabulary and ${VISUAL_REGISTRY} disagree — doc [${dv.join(", ")}] ` +
        `vs registry [${rv.join(", ")}]`,
    );
  }

  const docScreens = docPages(doc).map((p) => p.screen);
  const regScreens = reg.composition.pages.map((p) => p.screen);
  if (JSON.stringify(docScreens) !== JSON.stringify(regScreens)) {
    fail.push(
      `governed pages disagree — §27 [${docScreens.join(", ")}] vs registry ` +
        `[${regScreens.join(", ")}]`,
    );
  }

  for (const p of reg.composition.pages) {
    const rows = docRows(doc, { heading: p.doc_heading });
    if (!rows) {
      fail.push(`${p.screen}: no §27 table found under "${p.doc_heading}"`);
      continue;
    }
    if (JSON.stringify(rows) !== JSON.stringify(p.rows)) {
      const a = JSON.stringify(rows);
      const b = JSON.stringify(p.rows);
      let i = 0;
      while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
      fail.push(
        `${p.screen}: the §27 table and ${VISUAL_REGISTRY} disagree — ` +
          `${rows.length} doc row(s) vs ${p.rows.length} registry row(s); ` +
          `first difference near ${JSON.stringify(a.slice(Math.max(0, i - 40), i + 40))}`,
      );
    }
  }
  return fail;
}

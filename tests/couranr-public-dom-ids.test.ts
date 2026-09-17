import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * DOM ID UNIQUENESS on the canonical public pages.
 *
 * THIS GATE DID NOT EXIST, and its absence cost exactly what an absent gate
 * costs. The 2026-09 marketing-architecture lock renumbered PUB-001 from
 * fourteen sections to fifteen and emitted `id="s5-h"` twice and `id="s11-h"`
 * twice: the `responsibility` region took the `outcomes` heading's accessible
 * name and the `pricing` card took `shipment-safety`'s, because
 * `aria-labelledby` resolves to the FIRST element carrying the id. Every gate
 * in the repository stayed green — lint, three typechecks, 3503 unit tests, the
 * composition contract, the visual-token scan, the claims scanner and a
 * production build. None of them looks at ids.
 *
 * The defect class is specific and recurring: a page whose section ids are
 * hand-numbered, edited by inserting a section in the middle. That is the
 * ordinary way these pages change, so the guard belongs here permanently
 * rather than as a one-off assertion on the page that happened to break.
 *
 * SOURCE-LEVEL, not rendered. A rendered check would need a server and would
 * only cover the states that render; `id="..."` in the JSX is where the
 * collision is authored, and a literal duplicate there is a defect at every
 * state. The trade-off is that runtime-composed ids are invisible to this —
 * which is why the scan asserts it found a non-trivial number of them.
 */

const ROOT = path.resolve(__dirname, "..");
const PUBLIC_TREE = "app/(couranr)/(public)";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx$/.test(entry)) out.push(p);
  }
  return out;
}

/**
 * Literal `id="..."` attributes. Comments are stripped first: a note recording
 * a retired id would otherwise read as a live one, which is the same lesson the
 * prohibited-claims scanner and the destructive-migration scanner both wrote
 * down, and which this batch re-learned twice.
 */
function literalIds(source: string): string[] {
  const code = source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
  return [...code.matchAll(/\bid="([^"{}]+)"/g)].map((m) => m[1]);
}

const PAGES = walk(path.join(ROOT, PUBLIC_TREE)).filter((f) => f.endsWith("page.tsx"));

describe("canonical public pages emit unique DOM ids", () => {
  it("scans a real, non-trivial set of pages", () => {
    // A gate over zero files is not a gate.
    expect(PAGES.length).toBeGreaterThanOrEqual(8);
  });

  for (const file of PAGES) {
    const rel = path.relative(ROOT, file);
    it(`${rel} has no duplicate id`, () => {
      const ids = literalIds(readFileSync(file, "utf8"));
      const seen = new Map<string, number>();
      for (const id of ids) seen.set(id, (seen.get(id) ?? 0) + 1);
      const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([id, n]) => `${id} x${n}`);
      expect(dupes).toEqual([]);
    });
  }

  it("every aria-labelledby target exists in the same file", () => {
    /* The other half of the failure. A duplicate id makes a region take the
       WRONG name; a missing id makes it take none at all, and both are
       invisible to every other gate. */
    const orphans: string[] = [];
    for (const file of PAGES) {
      const src = readFileSync(file, "utf8")
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
        .replace(/\/\*[\s\S]*?\*\//g, " ");
      const ids = new Set(literalIds(src));
      for (const m of src.matchAll(/aria-labelledby="([^"{}]+)"/g)) {
        for (const target of m[1].split(/\s+/).filter(Boolean)) {
          if (!ids.has(target)) orphans.push(`${path.relative(ROOT, file)} -> ${target}`);
        }
      }
    }
    expect(orphans).toEqual([]);
  });

  it("finds the ids to check at all", () => {
    // Guards against the regex silently matching nothing — which would make
    // every assertion above vacuously true, the exact failure this batch
    // already shipped once in a different test.
    const total = PAGES.reduce((n, f) => n + literalIds(readFileSync(f, "utf8")).length, 0);
    expect(total).toBeGreaterThan(20);
  });

  it("POSITIVE CONTROL: a planted duplicate is detected", () => {
    const planted = '<h2 id="dup-h">A</h2><section aria-labelledby="dup-h"/><h2 id="dup-h">B</h2>';
    const ids = literalIds(planted);
    const seen = new Map<string, number>();
    for (const id of ids) seen.set(id, (seen.get(id) ?? 0) + 1);
    expect([...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id)).toEqual(["dup-h"]);
  });

  it("POSITIVE CONTROL: a comment mentioning a retired id is not counted", () => {
    const withComment = '{/* id="s5-h" was retired */}<h2 id="s6-h">A</h2>';
    expect(literalIds(withComment)).toEqual(["s6-h"]);
  });
});

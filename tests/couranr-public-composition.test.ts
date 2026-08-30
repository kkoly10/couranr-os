import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  approvedCompositions,
  budgetHolds,
  budgets,
  countFlag,
  governedPages,
  pageRows,
  specRows,
} from "../scripts/compositionContract.mjs";

/**
 * §32.3 — the composition contract for the public marketing family, made
 * executable.
 *
 * The visual system's anti-template rules are its whole point: a cap on
 * grid-dominant sections, floors on image-led and product proof, one connected
 * workflow rail where a page has a process, and never the same composition
 * twice in a row. Stated as prose they are advice. Stated here they are a gate.
 *
 * BOTH SIDES ARE PARSED FROM SOURCE. The expected values come from §27.0 and
 * §27.1 of COURANR_VISUAL_SYSTEM_V2_2.md; the actual values come from the
 * `data-*` attributes in each page. Neither is retyped into this file, so the
 * test cannot drift into agreeing with itself — editing one side without the
 * other is exactly what it exists to catch.
 *
 * It covers FIVE pages now. PUB-001's budgets are the ones §32.3 states
 * numerically; the family pages carry their own `**Budgets:**` line, because
 * §32.3 says their counts are page-specific and copying PUB-001's would demand
 * photography and a product proof that /pricing has no business carrying.
 *
 * §32.3's own words: "missing metadata is a test failure, not a skip."
 */

const ROOT = path.resolve(__dirname, "..");
const SPEC = path.join(ROOT, "docs/couranr-mvp/brand/COURANR_VISUAL_SYSTEM_V2_2.md");
const doc = readFileSync(SPEC, "utf8");

const PAGES = governedPages(doc);
const APPROVED = approvedCompositions(doc);

type Row = ReturnType<typeof pageRows>[number];

function rowsFor(file: string): Row[] {
  return pageRows(readFileSync(path.join(ROOT, file), "utf8"));
}

describe("the governed public pages are declared at all", () => {
  /* PUB-012 and PUB-013 joined when MKT-004 split the public brand. The list
     is still asserted explicitly rather than derived from the registry it
     validates — a governed page silently disappearing is exactly what this
     catches, and deriving it from the same file would make it vacuous. */
  it("governs PUB-001, the business family, and the two MKT-004 surfaces", () => {
    expect(PAGES.map((p) => p.screen)).toEqual([
      "PUB-001",
      "PUB-008",
      "PUB-009",
      "PUB-010",
      "PUB-011",
      "PUB-012",
      "PUB-013",
    ]);
  });

  /* Each governed page's declared file must exist and must carry the section
     ids the contract names, in order. The contract having a page the repo does
     not is how a gate ends up asserting against nothing. */
  it("every governed page's declared file exists", () => {
    const missing = PAGES.filter((p) => !existsSync(path.join(ROOT, p.file))).map((p) => `${p.screen} -> ${p.file}`);
    expect(missing).toEqual([]);
  });

  it("finds §19's vocabulary in the spec", () => {
    expect(APPROVED.size).toBeGreaterThanOrEqual(7);
    expect(APPROVED).toContain("workflow-rail");
    expect(APPROVED).toContain("image-integrated-hero");
  });
});

describe.each(PAGES)("$screen ($route) matches its normative table", (page) => {
  const spec = specRows(doc, page);
  const rendered = rowsFor(page.file);

  it("the page renders exactly the governed sections, in order", () => {
    expect(rendered.map((r) => r.id)).toEqual(spec.map((r) => r.id));
  });

  it("every governed section carries all four required markers", () => {
    // A section missing a marker must FAIL, not be quietly skipped — the whole
    // gate is defeated by a section that opts out of being counted.
    for (const r of rendered) {
      expect(r.composition, `section "${r.id}" has no data-composition`).toBeDefined();
      expect(r.imageLed, `section "${r.id}" has no data-image-led`).toBeDefined();
      expect(r.gridDominant, `section "${r.id}" has no data-grid-dominant`).toBeDefined();
      expect(r.productProof, `section "${r.id}" has no data-product-proof`).toBeDefined();
      for (const [k, v] of [
        ["image-led", r.imageLed],
        ["grid-dominant", r.gridDominant],
        ["product-proof", r.productProof],
      ] as const) {
        expect(["true", "false"], `section "${r.id}" data-${k} is "${v}"`).toContain(v);
      }
    }
  });

  it("every section carries the composition its table assigns it", () => {
    for (const s of spec) {
      const p = rendered.find((r) => r.id === s.id);
      expect(p, `section "${s.id}" is missing from the page`).toBeDefined();
      expect(p!.composition, `section "${s.id}"`).toBe(s.composition);
    }
  });

  it("every composition is one of §19's approved types", () => {
    for (const p of rendered) {
      expect(APPROVED, `"${p.composition}" on section "${p.id}"`).toContain(p.composition);
    }
  });

  /**
   * §19's adjacency rule, as COURANR_VISUAL_FIDELITY_AMENDMENT.md §3.1 leaves
   * it: a DRIFT DIAGNOSTIC, not a hard rule.
   *
   * This asserted `[]` and, on PUB-001, that is what forced `delivery-options`
   * to `split-story` and `pricing` to `full-bleed-interruption` — away from the
   * card row and the light card the artboard actually shows. Amendment §9:
   * "A test must never make the implementation less faithful to the canonical
   * design."
   *
   * So the expectation is derived from the SPEC's own table rather than fixed
   * at zero. An adjacency the normative table sanctions is allowed; one the
   * page invents still fails, which is the drift this was written to catch. A
   * page with no canonical mock has no sanctioned adjacency in its table, so
   * for PUB-008/009/010/011 this is still, in effect, `[]`.
   */
  it("introduces no adjacent duplicate composition the table does not sanction", () => {
    const adjacent = (rows: { id: string; composition: string }[]) =>
      rows
        .slice(1)
        .map((r, i) => (r.composition === rows[i].composition ? `${rows[i].id}+${r.id}` : null))
        .filter(Boolean);
    expect(adjacent(rendered)).toEqual(adjacent(spec));
  });

  it("never exceeds §19's hard cap of two grid-dominant sections", () => {
    const grids = rendered.filter((r) => r.gridDominant === "true").map((r) => r.id);
    expect(grids.length, `grid-dominant: ${grids.join(", ")}`).toBeLessThanOrEqual(2);
  });

  it("the page's flags agree with the table section by section", () => {
    for (const s of spec) {
      const p = rendered.find((r) => r.id === s.id)!;
      expect({
        id: p.id,
        imageLed: p.imageLed,
        gridDominant: p.gridDominant,
        productProof: p.productProof,
      }).toEqual({
        id: s.id,
        imageLed: s.imageLed,
        gridDominant: s.gridDominant,
        productProof: s.productProof,
      });
    }
  });

  it("holds its declared budgets", () => {
    if (page.screen === "PUB-001") {
      // §32.3 states these numerically for the homepage, so they are asserted
      // here rather than read from a budget line.
      // Fourteen since §27.0 r6 promoted `payer-choice` to its own section.
      expect(spec).toHaveLength(14);
      expect(countFlag(rendered, "imageLed"), "image-led floor is 2").toBeGreaterThanOrEqual(2);
      expect(countFlag(rendered, "productProof"), "product-proof floor is 1").toBeGreaterThanOrEqual(1);
      expect(
        rendered.filter((r) => r.composition === "workflow-rail").map((r) => r.id),
        "exactly one connected workflow rail",
      ).toEqual(["workflow"]);
      return;
    }

    const budget = budgets(doc, page);
    // A family page with no budget line is the §32.3 hole reopening: counts
    // described as "page-specific" with nothing written down are not a
    // contract. That is a failure, not a skip.
    expect(budget, `${page.screen} declares no **Budgets:** line in §27.1`).toBeTruthy();

    const actual = {
      gridDominant: countFlag(rendered, "gridDominant"),
      imageLed: countFlag(rendered, "imageLed"),
      productProof: countFlag(rendered, "productProof"),
      workflowRail: rendered.filter((r) => r.composition === "workflow-rail").length,
    };
    for (const [key, rule] of Object.entries(budget!)) {
      expect(
        budgetHolds(rule as { op: string; n: number }, actual[key as keyof typeof actual]),
        `${key} is ${actual[key as keyof typeof actual]}, budget says ${(rule as { op: string }).op} ${(rule as { n: number }).n}`,
      ).toBe(true);
    }
  });
});

/**
 * The parsers themselves are tested, because a regex that silently matches
 * nothing would make every assertion above pass vacuously — the exact shape of
 * failure this repository keeps rediscovering.
 */
describe("the composition parsers cannot pass vacuously", () => {
  it("finds a non-empty table and a non-empty page for every governed screen", () => {
    for (const page of PAGES) {
      expect(specRows(doc, page).length, `${page.screen} spec table`).toBeGreaterThan(0);
      expect(rowsFor(page.file).length, `${page.screen} page sections`).toBeGreaterThan(0);
    }
  });

  it("flags a planted adjacent-duplicate composition", () => {
    const rows = rowsFor(PAGES[0].file);
    const broken = rows.map((r, i) => (i === 1 ? { ...r, composition: rows[0].composition } : r));
    const clashes = broken.slice(1).filter((r, i) => r.composition === broken[i].composition);
    expect(clashes.length).toBeGreaterThan(0);
  });

  it("flags a planted third grid-dominant section", () => {
    const rows = rowsFor(PAGES[0].file).map((r, i) => (i < 3 ? { ...r, gridDominant: "true" } : r));
    expect(rows.filter((r) => r.gridDominant === "true").length).toBeGreaterThan(2);
  });

  it("flags a planted budget violation", () => {
    // budgetHolds is what every family page's gate rests on; prove it can say no.
    expect(budgetHolds({ op: "<=", n: 2 }, 3)).toBe(false);
    expect(budgetHolds({ op: ">=", n: 1 }, 0)).toBe(false);
    expect(budgetHolds({ op: "==", n: 1 }, 0)).toBe(false);
    expect(budgetHolds({ op: "<=", n: 2 }, 2)).toBe(true);
  });
});

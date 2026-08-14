import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * §32.3 — the composition contract for PUB-001, made executable.
 *
 * The visual system's anti-template rules are its whole point: at most two
 * grid-dominant sections, at least two image-led, at least one product proof,
 * one connected workflow rail, and never the same composition twice in a row.
 * Stated as prose they are advice. Stated here they are a gate.
 *
 * BOTH SIDES ARE PARSED FROM SOURCE. The expected values come from §27.0's
 * table in COURANR_VISUAL_SYSTEM_V2_2.md; the actual values come from the
 * `data-*` attributes in page.tsx. Neither is retyped into this file, so the
 * test cannot drift into agreeing with itself — editing one side without the
 * other is exactly what it exists to catch.
 *
 * §32.3's own words: "missing metadata is a test failure, not a skip."
 */

const ROOT = path.resolve(__dirname, "..");
const SPEC = path.join(ROOT, "docs/couranr-mvp/brand/COURANR_VISUAL_SYSTEM_V2_2.md");
const PAGE = path.join(ROOT, "app/(couranr)/(public)/page.tsx");

type Row = {
  n: number;
  id: string;
  composition: string;
  imageLed: boolean;
  gridDominant: boolean;
  productProof: boolean;
};

/** §27.0's normative table — the twelve governed sections. */
function specRows(): Row[] {
  const doc = readFileSync(SPEC, "utf8");
  const table = doc.match(/## 27\.0 Governed section identifiers[\s\S]*?\n\n(\| # [\s\S]*?)\n\n/);
  if (!table) throw new Error("§27.0 normative table not found in the visual system");
  const bool = (v: string) => v.replace(/\*\*/g, "").trim() === "true";
  return table[1]
    .trim()
    .split("\n")
    .filter((r) => /^\|\s*\d+\s*\|/.test(r))
    .map((r) => {
      const c = r.replace(/^\||\|$/g, "").split("|").map((x) => x.trim());
      return {
        n: Number(c[0]),
        id: c[1].replace(/`/g, ""),
        composition: c[4].replace(/`/g, ""),
        imageLed: bool(c[5]),
        gridDominant: bool(c[6]),
        productProof: bool(c[7]),
      };
    });
}

/** What page.tsx actually declares, in document order. */
function pageRows(): Row[] {
  const src = readFileSync(PAGE, "utf8");
  const out: Row[] = [];
  const re = /data-couranr-section="([a-z-]+)"([\s\S]{0,400}?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const [, id, rest] = m;
    const attr = (name: string) => {
      const hit = rest.match(new RegExp(`data-${name}="([^"]*)"`));
      return hit ? hit[1] : undefined;
    };
    const composition = attr("composition");
    const imageLed = attr("image-led");
    const gridDominant = attr("grid-dominant");
    const productProof = attr("product-proof");
    // A section missing any marker must FAIL, not be quietly skipped — the
    // whole gate is defeated by a section that opts out of being counted.
    expect(composition, `section "${id}" has no data-composition`).toBeDefined();
    expect(imageLed, `section "${id}" has no data-image-led`).toBeDefined();
    expect(gridDominant, `section "${id}" has no data-grid-dominant`).toBeDefined();
    expect(productProof, `section "${id}" has no data-product-proof`).toBeDefined();
    for (const [k, v] of [["image-led", imageLed], ["grid-dominant", gridDominant], ["product-proof", productProof]] as const) {
      expect(["true", "false"], `section "${id}" data-${k} is "${v}"`).toContain(v);
    }
    out.push({
      n: out.length + 1,
      id,
      composition: composition!,
      imageLed: imageLed === "true",
      gridDominant: gridDominant === "true",
      productProof: productProof === "true",
    });
  }
  return out;
}

/** §19's closed vocabulary of approved composition types. */
function approvedCompositions(): Set<string> {
  const doc = readFileSync(SPEC, "utf8");
  return new Set(
    [...doc.matchAll(/^## 19\.\d+ (.+)$/gm)].map((m) => m[1].toLowerCase().replace(/ /g, "-")),
  );
}

describe("PUB-001 matches the §27.0 composition contract", () => {
  const spec = specRows();
  const page = pageRows();

  it("the spec still declares exactly twelve governed sections", () => {
    expect(spec).toHaveLength(12);
  });

  it("the page renders exactly the twelve governed sections, in order", () => {
    expect(page.map((r) => r.id)).toEqual(spec.map((r) => r.id));
  });

  it("every section carries the composition §27.0 assigns it", () => {
    for (const s of spec) {
      const p = page.find((r) => r.id === s.id);
      expect(p, `section "${s.id}" is missing from the page`).toBeDefined();
      expect(p!.composition, `section "${s.id}"`).toBe(s.composition);
    }
  });

  it("every composition is one of §19's approved types", () => {
    const approved = approvedCompositions();
    expect(approved.size).toBeGreaterThan(0);
    for (const p of page) {
      expect(approved, `"${p.composition}" on section "${p.id}"`).toContain(p.composition);
    }
  });

  it("no two adjacent sections share a composition (§19 hard rule)", () => {
    const clashes = page
      .slice(1)
      .map((r, i) => (r.composition === page[i].composition ? `${page[i].id}+${r.id}` : null))
      .filter(Boolean);
    expect(clashes).toEqual([]);
  });

  it("at most two sections are grid-dominant (§19 cap)", () => {
    const grids = page.filter((r) => r.gridDominant).map((r) => r.id);
    expect(grids.length, `grid-dominant: ${grids.join(", ")}`).toBeLessThanOrEqual(2);
  });

  it("at least two sections are image-led (§27 floor)", () => {
    const led = page.filter((r) => r.imageLed).map((r) => r.id);
    expect(led.length, `image-led: ${led.join(", ")}`).toBeGreaterThanOrEqual(2);
  });

  it("at least one section is a real product proof (§27 floor)", () => {
    const proof = page.filter((r) => r.productProof).map((r) => r.id);
    expect(proof.length, `product-proof: ${proof.join(", ")}`).toBeGreaterThanOrEqual(1);
  });

  it("exactly one section is the connected workflow rail (§32.3)", () => {
    const rails = page.filter((r) => r.composition === "workflow-rail").map((r) => r.id);
    expect(rails).toEqual(["workflow"]);
  });

  it("the page's flags agree with §27.0 section by section", () => {
    for (const s of spec) {
      const p = page.find((r) => r.id === s.id)!;
      expect({ id: p.id, imageLed: p.imageLed, gridDominant: p.gridDominant, productProof: p.productProof })
        .toEqual({ id: s.id, imageLed: s.imageLed, gridDominant: s.gridDominant, productProof: s.productProof });
    }
  });
});

/**
 * The parsers themselves are tested, because a regex that silently matches
 * nothing would make every assertion above pass vacuously — the exact shape of
 * failure this repository keeps rediscovering.
 */
describe("the composition parsers cannot pass vacuously", () => {
  it("finds twelve sections in the page source", () => {
    expect(pageRows()).toHaveLength(12);
  });

  it("finds §19's vocabulary in the spec", () => {
    const approved = approvedCompositions();
    expect(approved.size).toBeGreaterThanOrEqual(7);
    expect(approved).toContain("workflow-rail");
    expect(approved).toContain("image-integrated-hero");
  });

  it("flags a planted adjacent-duplicate composition", () => {
    const rows = pageRows();
    const broken = rows.map((r, i) =>
      i === 1 ? { ...r, composition: rows[0].composition } : r,
    );
    const clashes = broken
      .slice(1)
      .filter((r, i) => r.composition === broken[i].composition);
    expect(clashes.length).toBeGreaterThan(0);
  });

  it("flags a planted third grid-dominant section", () => {
    const rows = pageRows().map((r, i) => (i < 3 ? { ...r, gridDominant: true } : r));
    expect(rows.filter((r) => r.gridDominant).length).toBeGreaterThan(2);
  });
});

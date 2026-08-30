/**
 * MKT-006 — the right market sentence on the right surface.
 *
 * MKT-001 has ONE public market sentence and it opens "Local BUSINESS delivery
 * across …". That was correct while Couranr was a merchant-only brand. MKT-004
 * expanded the brand to two entry paths, and the sentence then shipped verbatim
 * on both surfaces MKT-004 created: a person reading `/sameday` — a page whose
 * entire job is to offer THEM a delivery — was told Couranr delivers for
 * businesses, and the master homepage carried the businesses-only description
 * that MKT-004.value.product_description_after had already retired.
 *
 * Nothing caught it. The copy test only compares the module against the
 * registry, and both sides said the same wrong thing; the composition gates
 * read attributes, not sentences. So this test asserts the SURFACE, which is
 * where the defect actually lived: which page renders which sentence.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  MARKETED_MARKETS,
  MARKETS_PUBLIC_COPY,
  MARKETS_PUBLIC_COPY_NEUTRAL,
} from "@/lib/couranr/public/governed";

const ROOT = path.join(__dirname, "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const REGISTRY = JSON.parse(read("02_DECISION_REGISTRY.json"));
const rec = (id: string) =>
  REGISTRY.decisions.find((r: { id: string }) => r.id === id);

/** The two consumer-and-master surfaces MKT-006 governs. */
const NEUTRAL_SURFACES = [
  "app/(couranr)/(public)/(master-public)/page.tsx",
  "app/(couranr)/(public)/(consumer-public)/sameday/page.tsx",
];

/** Business public surfaces, which keep MKT-001's sentence unchanged. */
const BUSINESS_SURFACES = [
  "app/(couranr)/(public)/(business-public)/business/page.tsx",
  "app/(couranr)/(public)/(business-public)/service-areas/page.tsx",
];

describe("MKT-006 is materialized", () => {
  it("exists as a decided record that amends MKT-001", () => {
    const m6 = rec("MKT-006");
    expect(m6).toBeTruthy();
    expect(m6.status).toBe("decided");
    expect(m6.amends).toBe("MKT-001");
    expect(rec("MKT-001").amended_by).toContain("MKT-006");
  });

  it("matches the module byte for byte", () => {
    expect(MARKETS_PUBLIC_COPY_NEUTRAL).toBe(rec("MKT-006").value.public_copy_neutral);
    expect(MARKETS_PUBLIC_COPY).toBe(rec("MKT-001").value.public_copy);
  });

  it("leaves MKT-001's own sentence untouched", () => {
    expect(MARKETS_PUBLIC_COPY).toMatch(/^Local business delivery across/);
  });

  /* The point of the amendment is FRAMING, not a different coverage claim. If
     the two sentences ever named different places, one of them would be a
     second market authority — exactly what routing everything through MKT-001
     exists to prevent. */
  it("names the same markets as MKT-001, in the same order", () => {
    const shortName = (m: string) => (m === "Washington, DC" ? "DC" : m);
    for (const sentence of [MARKETS_PUBLIC_COPY, MARKETS_PUBLIC_COPY_NEUTRAL]) {
      let cursor = -1;
      for (const market of MARKETED_MARKETS) {
        const at = sentence.indexOf(shortName(market));
        expect(at, `${market} missing from: ${sentence}`).toBeGreaterThan(-1);
        expect(at, `${market} out of order in: ${sentence}`).toBeGreaterThan(cursor);
        cursor = at;
      }
      expect(sentence).toContain("surrounding areas");
    }
  });

  /* SVC-002 is UNRESOLVED and MKT-001 excludes Maryland from initial
     marketing. Neither sentence may quietly acquire either. */
  it("invents no boundary and markets no Maryland", () => {
    for (const sentence of [MARKETS_PUBLIC_COPY, MARKETS_PUBLIC_COPY_NEUTRAL]) {
      expect(sentence).not.toMatch(/radius|polygon|\bZIP\b|\bmiles?\b|Maryland|\bMD\b/i);
    }
  });
});

describe("each surface renders the sentence written for its audience", () => {
  /* Comments stripped first. Both pages explain in prose WHY they no longer
     read `MARKETS_PUBLIC_COPY`, and a rule about what the page renders must not
     be tripped by a sentence describing the bug it fixed. */
  const code = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

  it.each(NEUTRAL_SURFACES)("%s reads the neutral sentence, not the business one", (file) => {
    const src = code(file);
    expect(src).toContain("MARKETS_PUBLIC_COPY_NEUTRAL");
    /* `MARKETS_PUBLIC_COPY_NEUTRAL` contains `MARKETS_PUBLIC_COPY` as a
       substring, so a bare `toContain` would pass on the neutral import alone.
       The boundary is what makes this assertion mean anything. */
    expect(src, `${file} still reads MKT-001's business sentence`).not.toMatch(
      /MARKETS_PUBLIC_COPY(?!_NEUTRAL)/,
    );
  });

  it.each(BUSINESS_SURFACES)("%s keeps MKT-001's business sentence", (file) => {
    expect(code(file)).toMatch(/MARKETS_PUBLIC_COPY(?!_NEUTRAL)/);
  });

  /* Neither sentence may be typed into a page: MKT-001 owns the markets and
     the work order says so in as many words for PUB-012. */
  it.each([...NEUTRAL_SURFACES, ...BUSINESS_SURFACES])(
    "%s types no market name of its own",
    (file) => {
      const src = read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      for (const market of ["Stafford", "Woodbridge", "Fredericksburg"]) {
        expect(src, `${file} types "${market}"`).not.toContain(market);
      }
    },
  );

  it("POSITIVE CONTROL: the business sentence on a neutral surface is detected", () => {
    const tampered = 'import { MARKETS_PUBLIC_COPY } from "@/lib/couranr/public/governed";';
    expect(tampered).toMatch(/MARKETS_PUBLIC_COPY(?!_NEUTRAL)/);
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROHIBITED_CLASSES } from "@/lib/couranr/shipment/facts";
import {
  PROHIBITED_GROUPS,
  PROHIBITED_LABELS,
  allProhibitedLabels,
  groupLabels,
} from "@/lib/couranr/public/prohibitedSummary";

/**
 * The parity that makes `/sameday`'s "what Couranr does not deliver" section a
 * RENDERING of the enforced vocabulary rather than a second policy list.
 *
 * MKT-ARCH §6: "Do NOT create a second policy list that can silently drift.
 * Preferred: derive/group presentation from canonical policy where clean, and
 * test parity." This is that parity test, and it is written so that the drift
 * it guards against turns it RED rather than leaving it quietly true:
 *
 *   - a new prohibited class with no label fails;
 *   - a new prohibited class in no group fails;
 *   - a label for an id the vocabulary does not have fails;
 *   - a class placed in two groups fails.
 *
 * The last two matter as much as the first two. A presentation that names
 * something the engine does not prohibit is a marketing claim with nothing
 * behind it, which is the same defect in the other direction.
 */

const ROOT = path.resolve(__dirname, "..");
const SAMEDAY = path.join(ROOT, "app/(couranr)/(public)/(consumer-public)/sameday/page.tsx");

const canonical = new Set<string>(PROHIBITED_CLASSES);

describe("the public prohibition summary is derived from the enforced vocabulary", () => {
  it("the vocabulary it derives from is non-empty and is the shipment one", () => {
    // A positive control on the fixture itself. Every assertion below is about
    // coverage of this set; an empty set would make all of them vacuously true.
    expect(PROHIBITED_CLASSES.length).toBeGreaterThan(20);
    expect(canonical.has("alcohol")).toBe(true);
    expect(canonical.has("people")).toBe(true);
  });

  it("labels exactly the canonical classes — no gap, no invention", () => {
    const labelled = Object.keys(PROHIBITED_LABELS).sort();
    expect(labelled).toEqual([...PROHIBITED_CLASSES].sort());
  });

  it("gives every class a non-empty, human label", () => {
    for (const c of PROHIBITED_CLASSES) {
      const label = PROHIBITED_LABELS[c];
      expect(label, `${c} has no label`).toBeTruthy();
      // A label that is just the id echoed back is not a translation.
      expect(label, `${c} is unlabelled machine vocabulary`).not.toBe(c);
      expect(label).not.toMatch(/_/);
    }
  });

  it("places every class in exactly one group", () => {
    const seen = new Map<string, number>();
    for (const g of PROHIBITED_GROUPS) {
      for (const c of g.classes) seen.set(c, (seen.get(c) ?? 0) + 1);
    }
    const missing = PROHIBITED_CLASSES.filter((c) => !seen.has(c));
    const duplicated = [...seen.entries()].filter(([, n]) => n > 1).map(([c]) => c);
    const unknown = [...seen.keys()].filter((c) => !canonical.has(c));
    expect({ missing, duplicated, unknown }).toEqual({ missing: [], duplicated: [], unknown: [] });
  });

  it("groups are readable headings, not machine ids", () => {
    for (const g of PROHIBITED_GROUPS) {
      expect(g.title).toBeTruthy();
      expect(g.title).not.toMatch(/_/);
      expect(g.classes.length).toBeGreaterThan(0);
    }
    // Distinct headings; two groups with one name read as one broken group.
    const titles = PROHIBITED_GROUPS.map((g) => g.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("the rendered words cover every category the owner named", () => {
    /* MKT-ARCH §6 lists the categories the section "must include". They are
       checked as a SUBSTRING of the rendered words rather than as ids, because
       what the brief names is what a customer must be able to read. */
    const rendered = allProhibitedLabels().join(" | ").toLowerCase();
    for (const required of [
      "alcohol",
      "tobacco",
      "vaping",
      "nicotine",
      "cannabis",
      "thc",
      "firearms",
      "ammunition",
      "prescription",
      "controlled substances",
      "fuel",
      "compressed gas",
      "fireworks",
      "explosives",
      "illegal goods",
      "stolen goods",
      "cash",
      "checks",
      "negotiable",
      "biological specimens",
      "live animals",
      "people",
    ]) {
      expect(rendered, `the summary never says "${required}"`).toContain(required);
    }
    // "hazardous materials" is rendered as the specific classes the engine
    // carries — corrosive, toxic, and the regulated-dangerous-goods catch-all.
    expect(rendered).toContain("corrosive");
    expect(rendered).toContain("toxic");
    expect(rendered).toContain("regulated dangerous goods");
  });

  it("groupLabels resolves through the same keyed map", () => {
    for (const g of PROHIBITED_GROUPS) {
      expect(groupLabels(g)).toEqual(g.classes.map((c) => PROHIBITED_LABELS[c]));
    }
    expect(allProhibitedLabels().length).toBe(PROHIBITED_CLASSES.length);
  });
});

describe("the Same Day page renders the derivation, not a typed list", () => {
  const src = readFileSync(SAMEDAY, "utf8");

  it("imports the derived summary", () => {
    expect(src).toMatch(/from "@\/lib\/couranr\/public\/prohibitedSummary"/);
  });

  it("types no category label of its own", () => {
    /* The failure this catches is someone pasting the readable list into the
       JSX "just to get the spacing right" and leaving it there. Checked
       against the labels themselves: if a label's words appear in the page
       source, they were typed rather than mapped. */
    const typed = Object.values(PROHIBITED_LABELS).filter((label) => src.includes(label));
    expect(typed).toEqual([]);
  });

  it("renders the prohibition section at all", () => {
    expect(src).toContain('data-couranr-section="consumer-prohibited"');
  });
});

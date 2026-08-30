/**
 * MKT-005 parity: the copy module must say exactly what the decision says.
 *
 * The registry is the authority for these strings; `masterSameDayCopy.ts` is
 * the render-time implementation of it. Without this test the two drift the
 * first time someone tweaks a headline in the module — the same failure mode
 * `governed.ts` has been guarded against since the pricing values landed.
 *
 * Byte-exact, both directions, and deliberately unforgiving about punctuation:
 * the owner brief itself spelled two strings with an ASCII apostrophe in one
 * place and U+2019 in another, which is exactly the kind of difference a
 * human reviewer reads straight past.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MKT_005_COPY } from "@/lib/couranr/public/masterSameDayCopy";

const ROOT = path.join(__dirname, "..");
const REGISTRY = JSON.parse(readFileSync(path.join(ROOT, "02_DECISION_REGISTRY.json"), "utf8"));
const MKT005 = REGISTRY.decisions.find((r: { id: string }) => r.id === "MKT-005");

/** "master.hero_headline" -> string | string[], for both sides. */
function flatten(node: unknown, trail: string[] = []): Record<string, unknown> {
  if (typeof node === "string" || Array.isArray(node)) return { [trail.join(".")]: node };
  if (node && typeof node === "object") {
    return Object.entries(node).reduce(
      (acc, [k, v]) => ({ ...acc, ...flatten(v, [...trail, k]) }),
      {} as Record<string, unknown>,
    );
  }
  return {};
}

const GROUPS = ["master", "same_day", "send", "chrome"] as const;

describe("MKT-005 is materialized", () => {
  it("exists as a decided record with a structured value", () => {
    expect(MKT005).toBeTruthy();
    expect(MKT005.status).toBe("decided");
    expect(typeof MKT005.value).toBe("object");
    for (const g of GROUPS) expect(MKT005.value[g], `MKT-005.value.${g}`).toBeTruthy();
  });

  it("stores no route or URL — routes belong to the screen source", () => {
    const strings = Object.values(flatten(MKT_005_COPY)).flat().filter((s) => typeof s === "string");
    expect(strings.length).toBeGreaterThan(40);
    for (const s of strings as string[]) {
      expect(s, `copy string contains a path: ${s}`).not.toMatch(/(^|\s)\/[a-z[]/);
      expect(s, `copy string contains a URL: ${s}`).not.toMatch(/https?:\/\//);
    }
  });

  /* Decision-dependent values have their own records and their own module.
     A price or a market name typed into locked copy would be a second
     authority for a fact PRC-001, MIL-002, MKT-001 and HRS-001 already own. */
  it("stores no price, market name or operating hour", () => {
    const strings = Object.values(flatten(MKT_005_COPY)).flat() as string[];
    for (const s of strings) {
      expect(s, `price literal: ${s}`).not.toMatch(/\$\s?\d/);
      expect(s, `operating-hour literal: ${s}`).not.toMatch(/\b\d{1,2}:\d{2}\s*(am|pm)?\b/i);
      for (const market of ["Stafford", "Woodbridge", "Fredericksburg", "Washington, DC"]) {
        expect(s, `market literal: ${s}`).not.toContain(market);
      }
    }
  });
});

describe("the copy module and MKT-005 agree", () => {
  const registrySide = flatten(
    Object.fromEntries(GROUPS.map((g) => [g, MKT005.value[g]])),
  );
  const moduleSide = flatten(MKT_005_COPY);

  it("has the same set of keys in both directions", () => {
    expect(Object.keys(moduleSide).sort()).toEqual(Object.keys(registrySide).sort());
    expect(Object.keys(moduleSide).length).toBeGreaterThan(40);
  });

  it("matches every string byte for byte, apostrophes included", () => {
    const mismatches: string[] = [];
    for (const [key, want] of Object.entries(registrySide)) {
      const got = moduleSide[key];
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        mismatches.push(`${key}\n    registry: ${JSON.stringify(want)}\n    module:   ${JSON.stringify(got)}`);
      }
    }
    expect(mismatches.join("\n  ")).toBe("");
  });

  /* U+2019 everywhere, as MKT-005.value.apostrophe_normalization records. An
     ASCII apostrophe reaching either side is the exact defect that entry
     exists to prevent, and it is invisible in a diff. */
  it("uses U+2019 for every apostrophe, on both sides", () => {
    for (const [side, flat] of [["registry", registrySide], ["module", moduleSide]] as const) {
      const ascii = Object.entries(flat)
        .flatMap(([k, v]) => (Array.isArray(v) ? v.map((s) => [k, s] as const) : [[k, v] as const]))
        .filter(([, s]) => typeof s === "string" && s.includes("'"))
        .map(([k, s]) => `${side}.${k}: ${s}`);
      expect(ascii).toEqual([]);
    }
    /* The normalization is only meaningful if U+2019 is actually in use. */
    const curly = Object.values(moduleSide).flat().filter((s) => typeof s === "string" && s.includes("’"));
    expect(curly.length).toBeGreaterThan(5);
  });

  it("POSITIVE CONTROL: a one-character copy edit is detected", () => {
    const tampered = { ...moduleSide, "master.hero_headline": "Local delivery, built around you" };
    expect(tampered["master.hero_headline"]).not.toBe(registrySide["master.hero_headline"]);
  });
});

/**
 * `PRODUCT_SPEC.md` is an EXTRACTION from the Master Package, and this proves it.
 *
 * The authority consolidation promoted narrative product doctrine into one live
 * document and reclassified the Master Package as HISTORICAL. That move is only
 * safe if the extraction is verifiably lossless — otherwise "we archived the old
 * spec" means "we quietly rewrote the spec", which §9 of the work order forbids
 * by name ("do not silently change product decisions while cleaning docs").
 *
 * So: byte-identity, both directions. Every doctrine line in the package appears
 * in the spec, and every line in the spec that is not its own new header appears
 * in the package.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const PACKAGE = read("Couranr_Claude_Code_Master_Package.md");
const SPEC = read("docs/couranr-mvp/PRODUCT_SPEC.md");

const MASTER_SPEC_H1 = "# Couranr Merchant Delivery MVP — Master Implementation Specification";
const CUTOVER_H1 = "# Couranr Repository Cutover Matrix";
const AI_H1 = "# Couranr AI and Communication Specification";
const START_PROMPT_H1 = "# Claude Code Start Prompt — Couranr Merchant Delivery MVP";

/** The doctrine regions of the package, by their own H1 boundaries. */
function packageRegions() {
  const lines = PACKAGE.split("\n");
  const at = (h: string) => {
    const i = lines.indexOf(h);
    expect(i, `package has no "${h}"`).toBeGreaterThan(-1);
    return i;
  };
  const masterSpec = lines.slice(at(MASTER_SPEC_H1), at(CUTOVER_H1)).join("\n");
  const aiAndRelease = lines.slice(at(AI_H1), at(START_PROMPT_H1)).join("\n");
  /* Trailing `---` separators belong to the package's own stitching, not to the
     doctrine, so they are trimmed on both sides identically. */
  const trim = (s: string) => s.replace(/\n+-{3}\n*$/, "").replace(/\s+$/, "");
  return { masterSpec: trim(masterSpec), aiAndRelease: trim(aiAndRelease) };
}

describe("PRODUCT_SPEC.md", () => {
  const regions = packageRegions();

  it("reproduces the Master Implementation Specification byte for byte", () => {
    expect(regions.masterSpec.length).toBeGreaterThan(10_000);
    expect(SPEC).toContain(regions.masterSpec);
  });

  it("reproduces the AI/Communication spec and Release Acceptance Matrix byte for byte", () => {
    expect(regions.aiAndRelease.length).toBeGreaterThan(5_000);
    expect(SPEC).toContain(regions.aiAndRelease);
  });

  it("adds nothing to the doctrine beyond its own header", () => {
    const body = SPEC.slice(SPEC.indexOf(MASTER_SPEC_H1));
    const rebuilt = `${regions.masterSpec}\n\n---\n\n${regions.aiAndRelease}\n`;
    expect(body).toBe(rebuilt);
  });

  it("leaves the execution-history sections behind", () => {
    /* Branch instructions and dated plans are not live doctrine. Their H1s must
       NOT appear here, and their absence is checked positively rather than
       assumed from what was copied. */
    for (const h of [CUTOVER_H1, START_PROMPT_H1, "# Couranr Phased Claude Code Execution Plan"]) {
      expect(PACKAGE).toContain(h);
      expect(SPEC).not.toContain(h);
    }
  });

  it("is what the decision registry now cites, and every cited section is present", () => {
    const registry = JSON.parse(read("02_DECISION_REGISTRY.json"));
    const citing = registry.decisions.filter(
      (r: { authority_file: string }) => r.authority_file === "docs/couranr-mvp/PRODUCT_SPEC.md",
    );
    expect(citing.length).toBeGreaterThan(0);
    /* Every §N a record names must be a real heading in this document. A
       repointed authority_file that lands on a file without the section is a
       broken citation, and nothing else would notice. */
    const headings = new Set(
      [...SPEC.matchAll(/^## (\d+)\. /gm)].map((m) => m[1]),
    );
    expect(headings.size).toBeGreaterThan(10);
    let checked = 0;
    for (const r of citing) {
      /* An authority_section can name another document in the same string —
         "§11 Delivery lifecycle — Return; §8 authority" is this file, but
         "UI_SCREEN_REGISTRY.md §7" is not. Checking every § in the string would
         demand §7 exist here, and it happens to, which is exactly the kind of
         coincidence that makes an assertion look strong and prove nothing. */
      for (const clause of String(r.authority_section).split(";")) {
        if (/\.(md|json|csv)/.test(clause)) continue;
        for (const m of clause.matchAll(/§(\d+)/g)) {
          checked++;
          expect(headings.has(m[1]), `${r.id} cites §${m[1]}, which is not a section here`).toBe(true);
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("no decision still cites the Master Package as its authority file", () => {
    const registry = JSON.parse(read("02_DECISION_REGISTRY.json"));
    const stale = registry.decisions
      .filter((r: { authority_file: string }) => r.authority_file === "Couranr_Claude_Code_Master_Package.md")
      .map((r: { id: string }) => r.id);
    expect(stale).toEqual([]);
  });
});

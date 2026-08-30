/**
 * Guards on the authority model itself.
 *
 * `npm run check:governance` proves the model holds at gate time. These are the
 * assertions that must hold for the GATE's own design to stay valid — the ones
 * that would make a rule quietly wrong rather than red.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const manifest = JSON.parse(read("docs/couranr-mvp/authority/AUTHORITY_MANIFEST.json"));

/** Every source file that could plausibly read a data file. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const skip = new Set([
    "node_modules", ".git", ".next", "coverage", "canonical-mvp-images",
    "e2e/artifacts", "docs",
  ]);
  const walk = (rel: string) => {
    for (const name of readdirSync(path.join(ROOT, rel || "."))) {
      const r = rel ? `${rel}/${name}` : name;
      if (skip.has(name) || skip.has(r) || name.startsWith(".")) continue;
      const st = statSync(path.join(ROOT, r));
      if (st.isDirectory()) walk(r);
      else if (/\.(mjs|cjs|js|ts|tsx)$/.test(name)) out.push(r);
    }
  };
  walk("");
  return out;
}

describe("generated screen CSV", () => {
  /* The CSV carries its do-not-edit marker as a leading `#` line, which costs
     strict RFC4180 conformance. That trade is only defensible while nothing
     parses the file. If a consumer appears, this test goes red and the marker
     has to move rather than the consumer having to strip it. */
  it("has no code consumer, which is what the leading `#` marker depends on", () => {
    const files = sourceFiles();
    /* A walker that finds nothing makes the assertion below vacuously true —
       which is exactly how a guard tests nothing while printing a tick. */
    expect(files.length).toBeGreaterThan(150);
    expect(files).toContain("scripts/ciLocal.mjs");
    const readers = files.filter((f) => {
      if (f.startsWith("scripts/governance/")) return false; // the generator itself
      if (f === "tests/couranr-governance.test.ts") return false; // this guard, which is marker-aware
      return /ui_screen_registry\.csv/.test(read(f));
    });
    expect(readers).toEqual([]);
  });

  it("is still parseable as CSV once the marker line is dropped", () => {
    const lines = read("ui_screen_registry.csv").split("\r\n");
    expect(lines[0].startsWith("#")).toBe(true);
    expect(lines[1].split(",").length).toBe(14);
    const src = JSON.parse(read("ui_screen_registry.json"));
    // header + one row per screen + trailing empty from the final CRLF
    expect(lines.length).toBe(1 + 1 + src.screens.length + 1);
  });
});

describe("authority manifest", () => {
  it("never repeats a product fact — it says where truth lives, nothing more", () => {
    /* The manifest may name PATHS and DOMAINS. A screen id, a route or a price
       inside it would make it a second registry, which §9 forbids by name. */
    const text = read("docs/couranr-mvp/authority/AUTHORITY_MANIFEST.json");
    const bodyOnly = text
      .split("\n")
      .filter((l) => !/"\$rule"|"\$note"|"note"|"marker_exempt"|"status"/.test(l))
      .join("\n");
    expect(bodyOnly).not.toMatch(/\b(PUB|MER|DRV|OPS|CUS|CLS)-\d{3}\b/);
    expect(bodyOnly).not.toMatch(/\$\d/);
  });

  it("declares every domain authority exactly once", () => {
    const authorities = manifest.domains.map((d: { authority: string }) => d.authority);
    expect(new Set(authorities).size).toBe(authorities.length);
  });

  it("classifies no path as both non-authority and authority/generated", () => {
    const owned = new Set<string>([
      ...manifest.domains.map((d: { authority: string }) => d.authority),
      ...manifest.domains.flatMap((d: { generated?: string[] }) => d.generated ?? []),
    ]);
    const na = manifest.non_authority;
    for (const h of na.historical) expect(owned.has(h.path)).toBe(false);
    for (const f of na.evidence_files) expect(owned.has(f)).toBe(false);
  });

  /* A marker_exempt entry is a hole in the rule. Every one must say why, so the
     exemption is a decision somebody can read rather than an empty string. */
  it("makes every marker exemption state a reason", () => {
    for (const h of manifest.non_authority.historical) {
      if (!("marker_exempt" in h)) continue;
      expect(typeof h.marker_exempt).toBe("string");
      expect(h.marker_exempt.trim().length).toBeGreaterThan(30);
    }
  });
});

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

describe("generated tab/comma-separated reports", () => {
  /* The CSV carries its do-not-edit marker as a leading `#` line, which costs
     strict RFC4180 conformance. That trade is only defensible while nothing
     parses the file. If a consumer appears, this test goes red and the marker
     has to move rather than the consumer having to strip it. */
  /* Two generated reports carry their do-not-edit marker as a leading `#` line,
     which costs strict RFC4180 / TSV conformance. That trade is only defensible
     while nothing parses them. If a consumer appears, this goes red and the
     marker has to move rather than the consumer having to strip it. */
  it.each(["ui_screen_registry.csv", "docs/couranr-mvp/ui-reference/CANONICAL_SCREEN_SOURCE_MAP.tsv"])(
    "%s has no code consumer, which is what the leading `#` marker depends on",
    (target) => {
      const files = sourceFiles();
      /* A walker that finds nothing makes the assertion below vacuously true —
         which is exactly how a guard tests nothing while printing a tick. */
      expect(files.length).toBeGreaterThan(150);
      expect(files).toContain("scripts/ciLocal.mjs");
      const base = target.split("/").pop() as string;
      const readers = files.filter((f) => {
        if (f.startsWith("scripts/governance/")) return false; // the generators themselves
        if (f === "tests/couranr-governance.test.ts") return false; // this guard, marker-aware
        return new RegExp(base.replace(/\./g, "\\.")).test(read(f));
      });
      expect(readers).toEqual([]);
    },
  );

  it("keeps the screen CSV parseable once the marker line is dropped", () => {
    const lines = read("ui_screen_registry.csv").split("\r\n");
    expect(lines[0].startsWith("#")).toBe(true);
    expect(lines[1].split(",").length).toBe(14);
    const src = JSON.parse(read("ui_screen_registry.json"));
    // marker + header + one row per screen + trailing empty from the final CRLF
    expect(lines.length).toBe(1 + 1 + src.screens.length + 1);
  });

  it("keeps the provenance TSV parseable once the marker line is dropped", () => {
    const lines = read("docs/couranr-mvp/ui-reference/CANONICAL_SCREEN_SOURCE_MAP.tsv")
      .split("\n")
      .filter((l) => l.length);
    expect(lines[0].startsWith("#")).toBe(true);
    expect(lines[1].split("\t")).toEqual(["screen_id", "source_png", "title", "note"]);
    for (const l of lines.slice(2)) expect(l.split("\t")).toHaveLength(4);
  });
});

describe("visual-source registry", () => {
  const visual = JSON.parse(read("docs/couranr-mvp/ui-reference/VISUAL_REGISTRY.json"));
  const screens = JSON.parse(read("ui_screen_registry.json")).screens;

  /* The representation the whole PUB-004 contradiction was waiting for: a
     screen may be visually DERIVED and still carry a delivered nested asset.
     Before `nested_sources` existed the only field available was
     `canonical_sources`, which a derived screen may not have — so the asset had
     to be either invisible or a false canonical claim. */
  it("lets a derived screen carry a nested reference without claiming canonical", () => {
    const pub004 = visual.sources.screens["PUB-004"];
    expect(pub004.visual_authority).toBe("derived");
    expect(pub004.root_sources).toEqual([]);
    expect(pub004.nested_sources).toHaveLength(1);
    expect(pub004.nested_sources[0].role).toBe("reference");
    expect(pub004.nested_sources[0].path).toContain("canonical-mvp-images/");
  });

  it("records one visual-source entry per canonical screen", () => {
    expect(Object.keys(visual.sources.screens).sort()).toEqual(
      screens.map((s: { id: string }) => s.id).sort(),
    );
  });

  it("keeps every root asset accounted for, and no nested path in the root census", () => {
    for (const [id, rec] of Object.entries<{ root_sources: string[] }>(visual.sources.screens)) {
      for (const f of rec.root_sources) {
        expect(f, `${id} root source`).not.toContain("/");
        expect(visual.sources.assets[f], `${id}: ${f} has no asset entry`).toBeTruthy();
      }
    }
  });

  /* Two hand-maintained documents disagreed about three root PNGs and nothing
     compared them. The migration preserved both claims instead of picking a
     winner; this holds the disagreement visible until an owner resolves it. */
  it("names every census/provenance disagreement in `disputes`", () => {
    const disputed = new Set(visual.sources.disputes.map((d: { file: string }) => d.file));
    for (const [id, rec] of Object.entries<{ root_sources: string[] }>(visual.sources.screens)) {
      for (const f of rec.root_sources) {
        const owner = visual.sources.assets[f].owner;
        if (owner !== id) expect(disputed.has(f), `${f}: ${id} vs ${owner}`).toBe(true);
      }
    }
    expect(visual.sources.disputes.length).toBeGreaterThan(0);
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

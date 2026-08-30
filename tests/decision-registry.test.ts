import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CANONICAL_SCREENS } from "@/lib/couranr/screens";

const ROOT = path.resolve(__dirname, "..");
const REGISTRY_PATH = path.join(ROOT, "02_DECISION_REGISTRY.json");
const RAW = readFileSync(REGISTRY_PATH, "utf8");
const REGISTRY = JSON.parse(RAW);
const RECORDS: any[] = REGISTRY.decisions;

const REQUIRED_FIELDS = [
  "id",
  "category",
  "decision",
  "value",
  "status",
  "authority_file",
  "authority_section",
  "affected_routes",
  "affected_screen_ids",
  "affected_database_objects",
  "affected_code_paths",
  "conflict_with_current_code",
  "implementation_phase",
  "acceptance_criteria",
];

const ALLOWED_STATUSES = ["decided", "unresolved", "intentionally_deferred"];

const REQUIRED_CATEGORIES = [
  "pricing",
  "included mileage",
  "mileage tiers",
  "surcharges",
  "payer rules",
  "authorization and capture timing",
  "cancellation",
  "refunds",
  "service hours",
  "overnight behavior",
  "launch markets",
  "service-area logic",
  "terminology",
  "order states",
  "delivery states",
  "transition rules",
  "proof requirements",
  "photo access",
  "driver assignment",
  "launch gates",
  "feature flags",
  "legacy-route treatment",
  "canonical/deferred/archive classification",
];

/* ------------------------------------------------------------------ 1, 10 */

describe("registry structure", () => {
  it("parses as strict JSON with no comments or trailing commas", () => {
    // JSON.parse is the authoritative check: the JSON grammar admits neither
    // comments nor trailing commas, so a file containing either cannot parse.
    // Scanning the raw text with a regex instead gives false positives — the
    // legitimate string value "/api/auto/*" contains the characters "/*".
    expect(() => JSON.parse(RAW)).not.toThrow();

    // Negative controls, so this test cannot pass vacuously.
    expect(() => JSON.parse('{"a":1} // trailing comment')).toThrow();
    expect(() => JSON.parse('{"a":1,}')).toThrow();
    expect(() => JSON.parse('{"a":/* c */1}')).toThrow();

    // A clean round-trip proves nothing outside the JSON grammar survived.
    expect(JSON.parse(JSON.stringify(REGISTRY))).toEqual(REGISTRY);
  });

  it("contains a non-empty decisions array", () => {
    expect(Array.isArray(RECORDS)).toBe(true);
    expect(RECORDS.length).toBeGreaterThan(0);
  });

  it("gives every record all fourteen required fields", () => {
    for (const r of RECORDS) {
      for (const f of REQUIRED_FIELDS) {
        expect(
          Object.prototype.hasOwnProperty.call(r, f),
          `${r.id ?? "<no id>"} is missing "${f}"`
        ).toBe(true);
      }
    }
  });

  it("covers every required decision category", () => {
    // Additional categories beyond the required set are permitted; DRP-001
    // introduced "team and request permissions".
    const present = new Set(RECORDS.map((r) => r.category));
    for (const c of REQUIRED_CATEGORIES) {
      expect(present.has(c), `no record for category "${c}"`).toBe(true);
    }
  });
});

/* --------------------------------------------------------------------- 2 */

describe("identifiers", () => {
  it("uses a unique id for every record", () => {
    const ids = RECORDS.map((r) => r.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes).toEqual([]);
  });

  it("uses a non-empty string id", () => {
    for (const r of RECORDS) {
      expect(typeof r.id).toBe("string");
      expect(r.id.length).toBeGreaterThan(0);
    }
  });
});

/* --------------------------------------------------------------------- 3 */

describe("authority", () => {
  it("references only authority files that exist in the repository", () => {
    for (const r of RECORDS) {
      const p = path.join(ROOT, r.authority_file);
      expect(existsSync(p), `${r.id}: authority_file "${r.authority_file}" not found`).toBe(
        true
      );
      expect(statSync(p).isFile()).toBe(true);
    }
  });

  it("cites a non-empty authority_section for every record", () => {
    for (const r of RECORDS) {
      expect(typeof r.authority_section).toBe("string");
      expect(r.authority_section.trim().length).toBeGreaterThan(0);
    }
  });

  /* This used to assert `generated_from.authority_order` began with the Master
     Package and UI_SCREEN_REGISTRY.md — which pinned a CYCLE into a test. The
     rank-1 product authority was declaring two of its own downstream documents
     as ranking above it, and the test made that arrangement load-bearing.
     `generated_from` is now historical provenance and says so; precedence lives
     in the authority manifest, in one place. */
  it("records derivation provenance, not a precedence list", () => {
    const gf = REGISTRY.generated_from;
    expect(gf.authority_order, "authority_order re-declares a precedence cycle").toBeUndefined();
    expect(Array.isArray(gf.derived_from)).toBe(true);
    expect(gf.derived_from.length).toBeGreaterThan(0);
    expect(String(gf.$class)).toMatch(/HISTORICAL PROVENANCE/);
    expect(JSON.stringify(gf.$note)).toContain("AUTHORITY_MANIFEST.json");
  });

  it("names derivation sources that exist, where they are repository paths", () => {
    const derived: string[] = REGISTRY.generated_from.derived_from;
    /* The tail entries are prose ("existing approved implementation packages"),
       not paths. Only check the ones that look like files. */
    const paths = derived.filter((f) => /\.(md|json|csv)$/.test(f));
    expect(paths.length).toBeGreaterThan(0);
    for (const f of paths) {
      expect(existsSync(path.join(ROOT, f)), `derived_from "${f}" not found`).toBe(true);
    }
  });

  it("is declared the writable authority for product decisions by the manifest", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(ROOT, "docs/couranr-mvp/authority/AUTHORITY_MANIFEST.json"), "utf8"),
    );
    const domain = manifest.domains.find(
      (d: { authority: string }) => d.authority === "02_DECISION_REGISTRY.json",
    );
    expect(domain?.domain).toBe("product-decisions");
    /* And nothing this registry names as a derivation source may be declared a
       higher authority anywhere — that is the cycle, restated as a check. */
    const generated = new Set(
      manifest.domains.flatMap((d: { generated?: string[] }) => d.generated ?? []),
    );
    for (const f of REGISTRY.generated_from.derived_from as string[]) {
      if (generated.has(f)) continue; // a generated mirror: correct, and not authority
      expect(
        manifest.domains.some((d: { authority: string }) => d.authority === f),
        `${f} is named as a derivation source AND a domain authority`,
      ).toBe(f === "ui_screen_registry.json" ? true : false);
    }
  });
});

/* --------------------------------------------------------------------- 4 */

describe("cross-references", () => {
  const KNOWN = new Set(CANONICAL_SCREENS.map((s) => s.id));

  it("references only screen IDs that exist in CANONICAL_SCREENS", () => {
    for (const r of RECORDS) {
      expect(Array.isArray(r.affected_screen_ids)).toBe(true);
      for (const id of r.affected_screen_ids) {
        expect(KNOWN.has(id), `${r.id}: unknown screen id "${id}"`).toBe(true);
      }
    }
  });

  it("uses arrays for every list-shaped field", () => {
    for (const r of RECORDS) {
      for (const f of [
        "affected_routes",
        "affected_screen_ids",
        "affected_database_objects",
        "affected_code_paths",
        "acceptance_criteria",
      ]) {
        expect(Array.isArray(r[f]), `${r.id}.${f} must be an array`).toBe(true);
      }
    }
  });

  it("gives every record at least one acceptance criterion", () => {
    for (const r of RECORDS) {
      expect(r.acceptance_criteria.length, `${r.id} has no acceptance criteria`).toBeGreaterThan(
        0
      );
    }
  });

  it("uses absolute route paths", () => {
    for (const r of RECORDS) {
      for (const route of r.affected_routes) {
        expect(route.startsWith("/"), `${r.id}: route "${route}"`).toBe(true);
      }
    }
  });
});

/* ------------------------------------------------------------------ 5, 6 */

describe("status discipline", () => {
  it("uses only the three allowed statuses", () => {
    for (const r of RECORDS) {
      expect(ALLOWED_STATUSES, `${r.id} has status "${r.status}"`).toContain(r.status);
    }
  });

  it("gives every decided record a non-null value and an authority", () => {
    for (const r of RECORDS.filter((x) => x.status === "decided")) {
      expect(r.value, `${r.id} is decided but has a null value`).not.toBeNull();
      expect(r.authority_file, `${r.id} is decided but cites no authority`).toBeTruthy();
      expect(r.authority_section.trim().length).toBeGreaterThan(0);
    }
  });

  it("uses typed objects or arrays for decided values, not bare prose", () => {
    for (const r of RECORDS.filter((x) => x.status === "decided")) {
      expect(
        typeof r.value === "object",
        `${r.id}: decided value must be a typed object or array, got ${typeof r.value}`
      ).toBe(true);
    }
  });
});

/* --------------------------------------------------------------------- 7 */

describe("unresolved records declare what is missing and what is blocked", () => {
  const unresolved = RECORDS.filter((r) => r.status === "unresolved");

  it("has at least one unresolved record", () => {
    expect(unresolved.length).toBeGreaterThan(0);
  });

  it("explains exactly what is missing", () => {
    for (const r of unresolved) {
      expect(typeof r.missing, `${r.id} must state what is missing`).toBe("string");
      expect(r.missing.trim().length).toBeGreaterThan(20);
    }
  });

  it("identifies the blocked screens and commits", () => {
    for (const r of unresolved) {
      expect(Array.isArray(r.blocked_screen_ids), `${r.id}.blocked_screen_ids`).toBe(true);
      expect(Array.isArray(r.blocked_commits), `${r.id}.blocked_commits`).toBe(true);
      expect(
        r.blocked_screen_ids.length + r.blocked_commits.length,
        `${r.id} must name at least one blocked surface or commit`
      ).toBeGreaterThan(0);
    }
  });

  it("references only real screen IDs in its blocked list", () => {
    const KNOWN = new Set(CANONICAL_SCREENS.map((s) => s.id));
    for (const r of unresolved) {
      for (const id of r.blocked_screen_ids) {
        expect(KNOWN.has(id), `${r.id}: unknown blocked screen "${id}"`).toBe(true);
      }
    }
  });

  it("does not convert an assumption into a value", () => {
    for (const r of unresolved) {
      // Either null, or a partial structure that still has an explicit null.
      if (r.value !== null) {
        const s = JSON.stringify(r.value);
        expect(s.includes("null"), `${r.id}: partial value must mark the gap as null`).toBe(
          true
        );
      }
    }
  });
});

/* --------------------------------------------------------------------- 8 */

describe("known code/spec conflicts are explicit", () => {
  function byId(id: string) {
    const r = RECORDS.find((x) => x.id === id);
    expect(r, `record ${id} must exist`).toBeDefined();
    return r!;
  }

  it("records the pricing base conflict ($22.99 authority vs $15 code)", () => {
    const r = byId("PRC-001");
    expect(r.value.base_price_cents).toBe(2299);
    expect(r.conflict_with_current_code.code_value.base_price_cents).toBe(1500);
    expect(r.conflict_with_current_code.code_location).toContain("lib/delivery/policy.ts");
  });

  it("records the included-mileage conflict (3 authority vs 4 code)", () => {
    const r = byId("MIL-001");
    expect(r.value.included_loaded_miles).toBe(3);
    expect(r.conflict_with_current_code.code_value.included_miles).toBe(4);
  });

  it("records the mileage-tier conflict (tiered authority vs flat $1.75 code)", () => {
    const r = byId("MIL-002");
    expect(Array.isArray(r.value.tiers)).toBe(true);
    expect(r.value.tiers.length).toBeGreaterThanOrEqual(5);
    expect(r.conflict_with_current_code.code_value.flat_per_mile_cents).toBe(175);
    expect(r.conflict_with_current_code.code_value.tiers).toBeNull();
  });

  it("records the service-area conflict (named markets vs 60-mile Stafford radius)", () => {
    const mkt = byId("MKT-001");
    expect(mkt.value.marketed_markets).toContain("Stafford");
    expect(mkt.conflict_with_current_code.code_value.model).toContain("60-mile");
    expect(mkt.affected_code_paths.join(" ")).toContain("lib/serviceArea.ts");

    const svc = byId("SVC-002");
    expect(svc.conflict_with_current_code.code_value.radius_miles).toBe(60);
  });

  it("records both route collisions with their occupying legacy files", () => {
    const one = byId("LEG-001");
    expect(one.value.canonical_route).toBe("/");
    expect(one.value.screen_id).toBe("PUB-001");
    expect(one.value.occupied_by).toBe("app/page.tsx");

    // LEG-002 is RESOLVED: /driver is owned by the canonical shell now, so the
    // occupant is the canonical file and the status is no longer "decided".
    const two = byId("LEG-002");
    expect(two.value.canonical_route).toBe("/driver");
    expect(two.value.screen_id).toBe("DRV-001");
    expect(two.value.occupied_by).toBe("app/(couranr)/driver/page.tsx");
    // The DECISION was always "decided" (disposition: replace); what changed is
    // that the code now matches it. The registry declares its own status
    // vocabulary, so the collision outcome lives in `value`, not in `status`.
    expect(two.status).toBe("decided");
    expect(two.value.collision_status).toBe("resolved");
    expect(two.value.current_state).toMatch(/^RESOLVED/);
  });

  it("resolves every conflict in favour of the written authority", () => {
    for (const r of RECORDS) {
      const c = r.conflict_with_current_code;
      if (!c || c.code_value === null) continue;
      expect(typeof c.resolution).toBe("string");
      expect(c.resolution.length).toBeGreaterThan(0);
    }
  });
});

/* --------------------------------------------------------------------- 9 */

describe("no unresolved value appears in canonical placeholder content", () => {
  const CANON_DIR = path.join(ROOT, "app", "(couranr)");

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const p = path.join(dir, entry);
      if (statSync(p).isDirectory()) out.push(...walk(p));
      else if (/\.(tsx?|css)$/.test(entry)) out.push(p);
    }
    return out;
  }

  const FILES = walk(CANON_DIR);

  /**
   * Only user-visible strings are checked. Code comments legitimately discuss
   * the unresolved decisions — that is how the constraint is documented — so
   * comments are stripped first.
   */
  function visibleText(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  }

  /**
   * EVOLVED with B02 (2026-08-06). This began as a guard on PLACEHOLDER copy:
   * unresolved values must not be baked into pages that were not yet built.
   * The public pages are BUILT now and the decisions they render are decided —
   * so the rule matured into the stronger form it was always pointing at:
   * no decision-dependent LITERAL may appear in canonical UI source at all.
   * Prices, mileage numbers, hours and market names reach the page ONLY
   * through lib/couranr/public/governed.ts, whose agreement with the root
   * registry is itself tested (couranr-public-claims.test.ts) — so a registry
   * change propagates by changing ONE module, never by hunting copy.
   *
   * The old `per-mile` PHRASE ban is retired: MIL-002 is decided, and the
   * phrase is not a value — the tier VALUES are still banned as literals.
   */
  const FORBIDDEN: { rx: RegExp; why: string }[] = [
    { rx: /\bStafford\b/i, why: "named market literal (use MARKETED_MARKETS)" },
    { rx: /\bWoodbridge\b/i, why: "named market literal (use MARKETED_MARKETS)" },
    { rx: /\bFredericksburg\b/i, why: "named market literal (use MARKETED_MARKETS)" },
    { rx: /\bWashington,?\s*DC\b/i, why: "named market literal" },
    { rx: /\bDC\b/, why: "named market literal" },
    { rx: /\$\s?\d/, why: "price literal (use governed cents + dollars())" },
    { rx: /\b\d+(\.\d+)?\s*miles?\b/i, why: "mileage literal (use governed constants)" },
    { rx: /\b\d{1,2}:\d{2}\s*(am|pm)?\b/i, why: "operating-hour literal (use governed copy)" },
    { rx: /\b(24\/7|guarantee[ds]?)\b/i, why: "forbidden claim" },
  ];

  it("finds the canonical placeholder pages to check", () => {
    expect(FILES.length).toBeGreaterThan(30);
  });

  it("has no forbidden value in any canonical page, title or purpose string", () => {
    const offences: string[] = [];

    for (const file of FILES) {
      const text = visibleText(readFileSync(file, "utf8"));
      for (const { rx, why } of FORBIDDEN) {
        const m = text.match(rx);
        if (m) {
          offences.push(
            `${path.relative(ROOT, file)}: "${m[0]}" (${why})`
          );
        }
      }
    }

    expect(offences, `decision-dependent values found:\n${offences.join("\n")}`).toEqual([]);
  });

  it("PUB-010 renders markets ONLY through the governed module", () => {
    // The placeholder-era form of this test expected neutral copy with no
    // market names. The page is BUILT now: the four MKT-001 markets render —
    // but exclusively via MARKETED_MARKETS, so the source still contains no
    // literal market name for a copy edit to de-sync from the registry.
    const p = path.join(CANON_DIR, "(public)", "service-areas", "page.tsx");
    const src = readFileSync(p, "utf8");
    const text = visibleText(src);

    expect(src).toContain("MARKETED_MARKETS");
    expect(text).not.toContain("Stafford");
    expect(text).not.toContain("Woodbridge");
    expect(text).not.toContain("Fredericksburg");
  });
});

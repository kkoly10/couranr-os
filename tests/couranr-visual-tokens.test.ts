import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * §32.1 static token tests, and §32.4's eyebrow rule.
 *
 * These are two of the eight test families §32 requires and the two that had no
 * implementation. Their absence was not theoretical: VIS-001's fourth
 * acceptance criterion says *"No `--cr-*` custom property namespace exists
 * anywhere in the canonical tree"*, and nineteen usages of three `--cr-btn-*`
 * names sat in `couranr.css` from before that criterion was written. Nothing
 * caught it because this file did not exist. The names are now
 * `--couranr-btn-*` and this test is what keeps them that way.
 *
 * §32.1 asks for exactly this list:
 *   - the three font tokens declared exactly once in the active token layer;
 *   - `--couranr-font-sans` resolving as the compatibility body alias;
 *   - the locked brand hexes unchanged;
 *   - every Couranr custom property in the `--couranr-*` namespace;
 *   - no `--cr-*` namespace;
 *   - the canonical logo component and paths still in use;
 *   - Route Blue never used to recolor the logo;
 *   - no duplicate ACTIVE token definitions that silently disagree.
 *
 * "Active" is doing real work in that last rule. A token redeclared inside a
 * media query or scoped to a container is a deliberate override — the
 * responsive card padding and the tinted-surface muted text are both — and
 * flagging those would make the test noise. Only two definitions in the SAME
 * root selector can disagree without anyone choosing, so that is what is
 * checked.
 */

const ROOT = path.resolve(__dirname, "..");
const CANON = path.join(ROOT, "app/(couranr)");
const CSS = readFileSync(path.join(CANON, "couranr.css"), "utf8");
const SHELL = readFileSync(path.join(CANON, "shell.css"), "utf8");

/** Every file the canonical visual system owns. */
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(e)) out.push(p);
  }
  return out;
}

const CANON_FILES = [
  ...walk(CANON),
  ...walk(path.join(ROOT, "components/couranr")),
  ...walk(path.join(ROOT, "components/brand")),
];

/**
 * Strips comments before scanning, so a rule QUOTED in a comment — this
 * repository's comments quote the values they are explaining constantly —
 * cannot be mistaken for a live declaration.
 */
function live(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const LIVE_CSS = live(CSS);
const LIVE_SHELL = live(SHELL);

describe("§32.1 — the font token layer", () => {
  const FONT_TOKENS = [
    "--couranr-font-display",
    "--couranr-font-body",
    "--couranr-font-mono",
  ];

  it.each(FONT_TOKENS)("%s is declared exactly once", (token) => {
    const rx = new RegExp(`^\\s*${token}\\s*:`, "gm");
    const inCss = (LIVE_CSS.match(rx) || []).length;
    const inShell = (LIVE_SHELL.match(rx) || []).length;
    expect(inCss + inShell, `${token} declared ${inCss + inShell} time(s)`).toBe(1);
  });

  it("--couranr-font-sans survives as the compatibility body alias", () => {
    // §9 keeps the legacy alias resolving during migration rather than
    // deleting it under its existing consumers. It must exist, be declared
    // once, and point at the BODY family — an alias that quietly became the
    // display family would restyle every legacy consumer.
    const decl = LIVE_CSS.match(/^\s*--couranr-font-sans\s*:\s*([^;]+);/m);
    expect(decl, "--couranr-font-sans is not declared").toBeTruthy();
    expect((LIVE_CSS.match(/^\s*--couranr-font-sans\s*:/gm) || []).length).toBe(1);
    expect(decl![1]).toContain("--couranr-font-body");
  });

  it("the display and body families are the governed ones", () => {
    const display = LIVE_CSS.match(/^\s*--couranr-font-display\s*:\s*([^;]+);/m)![1];
    const body = LIVE_CSS.match(/^\s*--couranr-font-body\s*:\s*([^;]+);/m)![1];
    expect(display).toContain("Martian Grotesk");
    expect(body).toContain("Inter");
    expect(LIVE_CSS.match(/^\s*--couranr-font-mono\s*:\s*([^;]+);/m)![1]).toContain(
      "Martian Mono",
    );
  });
});

describe("§32.1 — the locked brand primitives (§7)", () => {
  // §7: "These existing values remain unchanged." Transcribed from §7's own
  // block, and the test below re-reads §7 so this list cannot drift from it.
  const LOCKED: Record<string, string> = {
    "--couranr-navy": "#0d1525",
    "--couranr-gold": "#f4b740",
    "--couranr-route-blue": "#2563eb",
    "--couranr-canvas": "#f7f8f5",
    "--couranr-surface": "#ffffff",
    "--couranr-border": "#e3e7ed",
    "--couranr-text-muted": "#667085",
    "--couranr-success": "#15803d",
  };

  it.each(Object.entries(LOCKED))("%s is still %s", (token, hex) => {
    const decl = LIVE_CSS.match(new RegExp(`^\\s*${token}\\s*:\\s*([^;]+);`, "m"));
    expect(decl, `${token} is not declared at all`).toBeTruthy();
    expect(decl![1].trim().toLowerCase()).toBe(hex);
  });

  it("this list still matches §7 of the visual system", () => {
    // The expectations above would be worthless if §7 changed and nobody
    // noticed. Parsed from the spec, compared to the list.
    const spec = readFileSync(
      path.join(ROOT, "docs/couranr-mvp/brand/COURANR_VISUAL_SYSTEM_V2_2.md"),
      "utf8",
    );
    const block = spec.match(/# 7\. Locked brand primitives[\s\S]*?```css\n([\s\S]*?)```/);
    expect(block, "§7's locked-primitive block was not found").toBeTruthy();
    const fromSpec = Object.fromEntries(
      [...block![1].matchAll(/(--couranr-[a-z-]+)\s*:\s*([^;]+);/g)].map((m) => [
        m[1],
        m[2].trim().toLowerCase(),
      ]),
    );
    expect(fromSpec).toEqual(LOCKED);
  });
});

describe("§32.1 — the namespace is single and it is --couranr-*", () => {
  it("no --cr-* custom property exists anywhere in the canonical tree", () => {
    // VIS-001 acceptance criterion 4, made executable. `--cr-btn-bg`,
    // `--cr-btn-fg` and `--cr-btn-border` were live at 19 sites when this test
    // was written; they are `--couranr-btn-*` now.
    const offenders: string[] = [];
    for (const f of CANON_FILES) {
      const src = live(readFileSync(f, "utf8"));
      for (const m of src.matchAll(/--cr-[a-z][a-z0-9-]*/g)) {
        if (m[0].startsWith("--couranr-")) continue;
        offenders.push(`${path.relative(ROOT, f)}: ${m[0]}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("every custom property declared in the canonical stylesheets is --couranr-*", () => {
    const offenders: string[] = [];
    for (const [name, src] of [
      ["couranr.css", LIVE_CSS],
      ["shell.css", LIVE_SHELL],
    ] as const) {
      for (const m of src.matchAll(/^\s*(--[a-z][a-z0-9-]*)\s*:/gm)) {
        if (!m[1].startsWith("--couranr-")) offenders.push(`${name}: ${m[1]}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("no two definitions of one token DISAGREE inside the same root selector", () => {
    // Scoped and media-query overrides are deliberate — the responsive card
    // padding, the tinted-surface muted text. Two values in ONE selector block
    // are not: nobody chose which wins.
    const offenders: string[] = [];
    for (const [name, src] of [
      ["couranr.css", LIVE_CSS],
      ["shell.css", LIVE_SHELL],
    ] as const) {
      for (const block of src.matchAll(/\{([^{}]*)\}/g)) {
        const seen = new Map<string, string>();
        for (const d of block[1].matchAll(/(--couranr-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
          const prev = seen.get(d[1]);
          if (prev !== undefined && prev !== d[2].trim()) {
            offenders.push(`${name}: ${d[1]} = "${prev}" and "${d[2].trim()}" in one block`);
          }
          seen.set(d[1], d[2].trim());
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

describe("§32.1 — the canonical logo", () => {
  const LOGO = readFileSync(path.join(ROOT, "components/brand/CouranrLogo.tsx"), "utf8");

  it("the four approved SVG sources are the ones referenced", () => {
    for (const v of ["primary", "reverse", "monochrome-navy", "monochrome-white"]) {
      expect(LOGO).toContain(`/brand/couranr-logo-${v}.svg`);
    }
  });

  it("the fixed 900x250 aspect is still enforced", () => {
    expect(LOGO).toContain("250 / 900");
  });

  it("nothing recolors the logo, and Route Blue never touches it", () => {
    // §7: "Route Blue remains product/UI color, not logo color." BRAND_GUIDE
    // also forbids recoloring the gold accent. A CSS `filter` or a `fill`
    // override on the logo element would do both silently.
    expect(LOGO).not.toMatch(/route-blue/i);

    // BOTH stylesheets. The wordmark's rules live in shell.css, not
    // couranr.css — scanning only the latter matched zero rules and passed
    // without checking anything, which is the vacuous-gate failure this
    // repository keeps rediscovering. Asserted non-empty for that reason.
    const rules = [
      ...(LIVE_CSS.match(/\.cr-wordmark[^{]*\{[^}]*\}/g) ?? []),
      ...(LIVE_SHELL.match(/\.cr-wordmark[^{]*\{[^}]*\}/g) ?? []),
    ];
    expect(rules.length, "no .cr-wordmark rule was found to check").toBeGreaterThan(0);
    for (const r of rules) {
      expect(r, `a .cr-wordmark rule recolors the logo: ${r}`).not.toMatch(
        /(^|[^-])(fill|filter)\s*:/,
      );
    }
  });

  it("no page types the wordmark in a live font instead of using the component", () => {
    // BRAND_GUIDE "Prohibited": never type `couranr` in a font as a substitute
    // for the outlined SVG. Any element whose visible text is exactly the
    // wordmark is the failure this looks for.
    const offenders: string[] = [];
    for (const f of CANON_FILES.filter((f) => f.endsWith(".tsx"))) {
      const src = readFileSync(f, "utf8");
      if (f.endsWith("CouranrLogo.tsx")) continue;
      for (const m of src.matchAll(/>\s*couranr\s*</gi)) {
        offenders.push(`${path.relative(ROOT, f)}: ${m[0].trim()}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

describe("§32.4 — the eyebrow rule", () => {
  it("no universal SectionEyebrow marketing primitive exists", () => {
    // §32.4: "Do not create a universal `SectionEyebrow` marketing primitive.
    // A static test may prohibit that component name/pattern while allowing
    // explicit governed copy such as the PUB-001 hero eyebrow."
    const offenders: string[] = [];
    for (const f of CANON_FILES.filter((f) => f.endsWith(".tsx"))) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(
        /\b(?:function|const)\s+(Section[A-Z]\w*Eyebrow|SectionEyebrow|Eyebrow)\b/g,
      )) {
        offenders.push(`${path.relative(ROOT, f)}: ${m[1]}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("the governed eyebrows themselves are still allowed and still present", () => {
    // The counterpart §32.4 asks for explicitly: the rule bans a COMPONENT,
    // not the copy. If this ever goes red the ban has been over-applied.
    const home = readFileSync(path.join(CANON, "(public)/page.tsx"), "utf8");
    expect(home).toContain("Local delivery for independent businesses");
  });

  it("no page spends more than the §14.5 eyebrow budget", () => {
    // §14.5 caps a page at two to three. Counted per page rather than
    // repo-wide, because the cap is a per-page one.
    for (const f of CANON_FILES.filter((f) => /\(public\)[\\/].*page\.tsx$/.test(f))) {
      const src = readFileSync(f, "utf8");
      const n = (src.match(/className="cr-(mkt|hero__)eyebrow"/g) || []).length;
      expect(n, `${path.relative(ROOT, f)} renders ${n} eyebrows`).toBeLessThanOrEqual(3);
    }
  });
});

describe("MUTATION CONTROLS — these checks can actually reject", () => {
  it("the namespace scan flags a planted --cr-* token", () => {
    const planted = live(".cr-thing { --cr-planted: 1px; color: var(--cr-planted); }");
    const hits = [...planted.matchAll(/--cr-[a-z][a-z0-9-]*/g)].filter(
      (m) => !m[0].startsWith("--couranr-"),
    );
    expect(hits.length).toBeGreaterThan(0);
  });

  it("the disagreeing-duplicate scan flags a planted conflict", () => {
    const planted = ".x { --couranr-navy: #000; --couranr-navy: #fff; }";
    const found: string[] = [];
    for (const block of planted.matchAll(/\{([^{}]*)\}/g)) {
      const seen = new Map<string, string>();
      for (const d of block[1].matchAll(/(--couranr-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
        const prev = seen.get(d[1]);
        if (prev !== undefined && prev !== d[2].trim()) found.push(d[1]);
        seen.set(d[1], d[2].trim());
      }
    }
    expect(found).toEqual(["--couranr-navy"]);
  });

  it("the comment stripper does not hide a real declaration", () => {
    expect(live("/* --couranr-navy: #fff; */\n.x { --couranr-navy: #0d1525; }")).toContain(
      "--couranr-navy: #0d1525",
    );
    expect(live("/* --couranr-navy: #fff; */")).not.toContain("#fff");
  });

  it("the logo-recolor scan flags a planted filter", () => {
    const planted = ".cr-wordmark { filter: hue-rotate(90deg); }";
    const rules = planted.match(/\.cr-wordmark[^{]*\{[^}]*\}/g) ?? [];
    expect(rules.length).toBe(1);
    expect(rules[0]).toMatch(/(^|[^-])(fill|filter)\s*:/);
  });

  it("the canonical file walk actually found the tree", () => {
    // Every scan above iterates CANON_FILES. An empty list would make all of
    // them pass.
    expect(CANON_FILES.length).toBeGreaterThan(20);
    expect(CANON_FILES.some((f) => f.endsWith("couranr.css"))).toBe(true);
    expect(CANON_FILES.some((f) => f.endsWith("CouranrLogo.tsx"))).toBe(true);
  });

  it("the eyebrow scan flags a planted SectionEyebrow component", () => {
    const planted = "export function SectionEyebrow() { return null; }";
    expect(
      [...planted.matchAll(/\b(?:function|const)\s+(SectionEyebrow|Eyebrow)\b/g)].length,
    ).toBeGreaterThan(0);
  });
});

/**
 * §13 — the per-surface typography budgets, bound at the shell.
 *
 * The five shells each declare `data-couranr-surface`, and couranr.css adds
 * those surfaces to the §12 role rules. That is the whole propagation mechanism
 * for 55 product screens, so both halves are asserted: a shell that loses its
 * marker, or a role rule that stops naming a surface, silently reverts a whole
 * family to the pre-v2.2 heading sizes with nothing else going red.
 */
describe("§13 — surface families and their type budgets", () => {
  const SHELLS = readFileSync(
    path.join(ROOT, "components/couranr/shell/shells.tsx"),
    "utf8",
  );
  const SURFACES = ["public", "merchant", "operations", "driver", "customer"] as const;

  it("all five shells declare their surface family", () => {
    const declared = [...SHELLS.matchAll(/data-couranr-surface="([a-z]+)"/g)].map((m) => m[1]);
    expect(declared.sort()).toEqual([...SURFACES].sort());
  });

  it("the surface names match §6's five families", () => {
    const spec = readFileSync(
      path.join(ROOT, "docs/couranr-mvp/brand/COURANR_VISUAL_SYSTEM_V2_2.md"),
      "utf8",
    );
    // §6 titles them in prose; VIS-001 records the machine names.
    const reg = JSON.parse(readFileSync(path.join(ROOT, "02_DECISION_REGISTRY.json"), "utf8"));
    const vis = reg.decisions.find((d: { id: string }) => d.id === "VIS-001");
    const families = Object.keys(vis.value.surface_families);
    // `auth` has no shell of its own — it renders inside the public shell —
    // and `public_marketing`/`customer_token` are the registry's longer names.
    const mapped = families
      .map((f: string) => f.replace("public_marketing", "public").replace("customer_token", "customer"))
      .filter((f: string) => f !== "auth");
    expect(mapped.sort()).toEqual([...SURFACES].sort());
    expect(spec).toContain("# 6. Surface families");
  });

  /**
   * §13's list, transcribed once. The assertions below check the CSS agrees.
   * Operations deliberately gets ONLY the page title: §13 gives it "page title;
   * selected real counters" and Inter for everything else.
   */
  const EXPECT_MARTIAN: Record<string, string[]> = {
    merchant: [".cr-page-header .cr-heading--1", ".cr-heading--2", ".cr-heading--3"],
    operations: [".cr-page-header .cr-heading--1"],
    driver: [".cr-page-header .cr-heading--1"],
    customer: [".cr-page-header .cr-heading--1"],
  };

  it.each(Object.entries(EXPECT_MARTIAN))(
    "%s gets exactly its §13 Martian selectors",
    (surface, selectors) => {
      const found = [
        ...LIVE_CSS.matchAll(
          new RegExp(`\\[data-couranr-surface="${surface}"\\]\\s+([^,{]+)[,{]`, "g"),
        ),
      ]
        .map((m) => m[1].trim())
        // The identifier rule is Martian MONO, a separate role from the
        // display headings this budget is about.
        .filter((sel) => sel !== ".cr-text--numeric");
      expect(found.sort()).toEqual([...selectors].sort());
    },
  );

  it("operations never gets a Martian section or entity heading", () => {
    // The rule §6.3 states outright: no display type inside dense operational
    // surfaces. Asserted as an absence, because that is what would rot.
    expect(LIVE_CSS).not.toMatch(/\[data-couranr-surface="operations"\]\s+\.cr-heading--[234]/);
  });

  it("every product surface renders identifiers in the mono face", () => {
    for (const s of ["merchant", "operations", "driver", "customer"]) {
      expect(
        LIVE_CSS,
        `${s} does not bind .cr-text--numeric to the mono face`,
      ).toContain(`[data-couranr-surface="${s}"] .cr-text--numeric`);
    }
    // …and the PUBLIC surface does not: a price on a marketing page is
    // editorial, not an operational identifier.
    expect(LIVE_CSS).not.toContain('[data-couranr-surface="public"] .cr-text--numeric');
  });

  it("the bound selectors sit in the same block as the role they extend", () => {
    // The point of extending the role rule rather than writing a parallel one
    // is that there is no second copy of the values to drift. If these ever
    // separate, the propagation is duplicated rather than shared.
    for (const [role, surface] of [
      ["cr-type-page-title", "merchant"],
      ["cr-type-section-title", "merchant"],
      ["cr-type-card-title", "merchant"],
      ["cr-type-identifier", "operations"],
    ] as const) {
      const block = LIVE_CSS.match(new RegExp(`\\.${role},[^{]*\\{[^}]*\\}`));
      expect(block, `.${role} has no extended selector list`).toBeTruthy();
      expect(block![0]).toContain(`[data-couranr-surface="${surface}"]`);
      expect(block![0]).toContain("--couranr-font-");
    }
  });
});

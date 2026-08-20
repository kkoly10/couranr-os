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

describe("§32.4 + fidelity amendment §6 — the eyebrow rule", () => {
  /*
   * The rule CHANGED, and the old test enforced the old one.
   *
   * v2.2 §14.5 allowed "2-3 eyebrows per page" and this file asserted `<= 3`.
   * Under that budget the implementation generalised one contextual label —
   * which the PUB-001 artboard genuinely shows in its hero — into a shared
   * `.cr-mkt-eyebrow` class on FIVE public pages, four of which have no
   * canonical mock at all. The budget did not catch it. The budget authorised
   * it.
   *
   * COURANR_VISUAL_FIDELITY_AMENDMENT.md §3.3 deletes the allowance:
   * "There is no shared/public marketing eyebrow pattern by default." A label
   * is permitted only where that screen's canonical mock visibly contains one,
   * or written authority requires it, and its styling stays screen-specific.
   *
   * So this asserts a SHAPE, not a count.
   */

  it("no universal eyebrow component exists", () => {
    // §32.4's original rule, unchanged: no `SectionEyebrow` primitive.
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

  it("no SHARED marketing eyebrow class exists or is used", () => {
    // The class this branch created and spread. Retired by amendment §6, and
    // deleted rather than left unused — an unused class is one import away
    // from returning.
    const offenders: string[] = [];
    for (const f of CANON_FILES) {
      const src = live(readFileSync(f, "utf8"));
      if (/cr-mkt-eyebrow/.test(src)) offenders.push(path.relative(ROOT, f));
    }
    expect(offenders, `shared eyebrow reintroduced in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("exactly ONE public screen carries a contextual label, and it is PUB-001", () => {
    // PUB-001's artboard visibly shows a rounded bordered pill above the
    // headline, so the treatment is mock-supported and stays. Nothing else has
    // a mock, so nothing else may have one.
    const carrying: string[] = [];
    for (const f of CANON_FILES.filter((f) => /\(public\)[\\/].*page\.tsx$/.test(f))) {
      if (/cr-hero__label/.test(readFileSync(f, "utf8"))) {
        carrying.push(path.relative(ROOT, f));
      }
    }
    expect(carrying).toEqual(["app/(couranr)/(public)/page.tsx"]);
  });

  it("the retired eyebrow was not swapped for another small-label pattern", () => {
    // Amendment §6: "Do not replace removed eyebrows with pills, chips, tiny
    // uppercase labels, badge components, or decorative rules." Checked as an
    // absence on the four screens the label was removed from, because a
    // like-for-like swap is the obvious way to defeat this rule.
    const RETIRED = ["businesses", "service-areas", "how-it-works", "pricing"];
    for (const page of RETIRED) {
      const src = readFileSync(
        path.join(CANON, `(public)/${page}/page.tsx`),
        "utf8",
      );
      const heroBlock = src.slice(0, src.indexOf("</section>"));
      for (const banned of ["cr-mkt-chip", "cr-badge", "cr-mkt-eyebrow", "cr-hero__label"]) {
        expect(
          heroBlock.includes(banned),
          `${page} hero reintroduces "${banned}" where the eyebrow was removed`,
        ).toBe(false);
      }
    }
  });

  it("the governed hero copy is still present", () => {
    // The ban is on the PATTERN, not the copy. If this goes red the removal
    // was over-applied. MKT-002's descriptor stays until the owner resolves
    // the mock-vs-MKT-002 copy conflict recorded in amendment §5.1.
    const home = readFileSync(path.join(CANON, "(public)/page.tsx"), "utf8");
    expect(home).toContain("Local delivery for independent businesses");
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

/**
 * Every `cr-*` class the canonical tree RENDERS has at least one rule.
 *
 * A class with no rule at all is either a typo or dead markup, and nothing else
 * in this suite can see either. It found two live ones the first time it ran:
 * `.cr-mkt-channelstrip__label`, rendered on PUB-009 with no rule anywhere, and
 * `.cr-mkt-closing__copy`.
 *
 * It does NOT catch the payer-card defect the test below it was written for —
 * `.cr-mkt-payer` did have a rule, a Gate C token override — and that is worth
 * stating rather than implying otherwise.
 *
 * Scope: `className` attributes only, string literals only. An `id` or an
 * `aria-controls` value is not a class, and a class assembled at runtime from a
 * variable cannot be resolved statically — an earlier draft that also swept
 * bare `"cr-…"` string literals reported `cr-main` and `cr-pricing-schedule`,
 * which are both element ids, one of them inside a comment.
 */
describe("every rendered cr-* class is defined", () => {
  /** `className="…"`, `className={…}`, and the string literals inside either. */
  function classExpressions(src: string): string[] {
    const out: string[] = [];
    for (let i = src.indexOf("className="); i >= 0; i = src.indexOf("className=", i + 1)) {
      const j = i + "className=".length;
      if (src[j] === '"' || src[j] === "'") {
        const end = src.indexOf(src[j], j + 1);
        if (end > 0) out.push(src.slice(j, end + 1));
      } else if (src[j] === "{") {
        let depth = 0;
        let k = j;
        for (; k < src.length; k++) {
          if (src[k] === "{") depth++;
          else if (src[k] === "}" && --depth === 0) break;
        }
        out.push(src.slice(j + 1, k));
      }
    }
    return out;
  }

  const used = new Map<string, string>();
  for (const file of CANON_FILES.filter((f) => f.endsWith(".tsx"))) {
    const src = readFileSync(file, "utf8");
    for (const expr of classExpressions(src)) {
      for (const m of expr.matchAll(/["'`]([^"'`]*)["'`]/g)) {
        // An interpolation is marked, not deleted: `cr-stack--${gap}` must be
        // skipped whole. Replacing `${…}` with a SPACE instead left the prefix
        // `cr-stack--` behind and reported nine primitives as undefined.
        for (const c of m[1].replace(/\$\{[^}]*\}/g, "\u0000").split(/\s+/)) {
          if (c.includes("\u0000")) continue;
          if (c.startsWith("cr-") && !used.has(c)) used.set(c, path.relative(ROOT, file));
        }
      }
    }
  }

  it("finds the classes to check at all", () => {
    // A selector bug in the scanner above would make every assertion below pass
    // on an empty set. An earlier draft did exactly that and reported 9.
    expect(used.size).toBeGreaterThan(150);
  });

  it.each([...used].map(([cls, file]) => [cls, file]))(
    "%s has a rule (used in %s)",
    (cls) => {
      // Both stylesheets, comments stripped: a selector quoted in a comment is
      // documentation, not a rule.
      const defined = new RegExp(`\\.${cls}(?![A-Za-z0-9_-])`).test(LIVE_CSS + "\n" + LIVE_SHELL);
      expect(defined, `.${cls} is rendered but no rule defines it`).toBe(true);
    },
  );
});

/**
 * A `border-color` that nothing gives a border to.
 *
 * The defect: `.cr-mkt-payer--merchant` and `.cr-mkt-payer--customer` set
 * `border-color` and `background`, and there was NO `.cr-mkt-payer` base rule —
 * no `border-width`, no `border-style`, no `padding`, no radius. `border-color`
 * alone renders nothing, because the initial `border-style` is `none`. Both
 * PUB-001 payer cards painted their tint edge to edge with the text touching
 * it, on a page whose every gate was green: the typecheck has nothing to check,
 * axe reads contrast and not padding, Gate B measures overflow and target size,
 * and the composition test asserts `data-*` attributes. It took putting a
 * screenshot beside the artboard to see it.
 *
 * This is the general shape of that bug and it is statically decidable: a rule
 * that sets `border-color` without also establishing a border is a no-op unless
 * some OTHER rule gives the same element one. Usually that other rule is the
 * base class the modifier extends, which is why the base class is what is
 * looked for.
 *
 * Zero hits on the current stylesheets; two when the base rule is deleted.
 */
describe("no border-color that nothing gives a border to", () => {
  const rules = [...(LIVE_CSS + "\n" + LIVE_SHELL).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    sel: m[1].trim().replace(/\s+/g, " "),
    body: m[2],
  }));
  // `border:`, `border-top:` … and the longhands that make a border render.
  const establishes = (b: string) =>
    /(^|[;\s])border(-(top|right|bottom|left))?\s*:/.test(b) || /border-(width|style)\s*:/.test(b);

  it("scans a plausible number of rules", () => {
    expect(rules.length).toBeGreaterThan(300);
  });

  it("every border-color declaration lands on an element that has a border", () => {
    const problems: string[] = [];
    for (const r of rules) {
      if (!/border(-(top|right|bottom|left))?-color\s*:/.test(r.body)) continue;
      if (establishes(r.body)) continue;
      for (const target of r.sel.split(",").map((s) => s.trim())) {
        const leafSel = target.split(/\s+/).pop()!;
        const classes = leafSel.match(/\.[A-Za-z0-9_-]+/g);
        if (!classes) continue;
        const leaf = classes[classes.length - 1];
        const base = leaf.replace(/--[A-Za-z0-9_-]+$/, "");
        const bordered = rules.some(
          (o) =>
            o !== r &&
            establishes(o.body) &&
            o.sel.split(",").some((s) => {
              const l = s.trim().split(/\s+/).pop()!;
              return l === leaf || l === base || l.endsWith(base);
            }),
        );
        if (!bordered) problems.push(`${target} sets a border-color but nothing gives ${base} a border`);
      }
    }
    expect(problems).toEqual([]);
  });
});

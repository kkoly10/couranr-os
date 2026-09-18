import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPreviewEnabled } from "@/lib/couranr/previewGate";

const CSS_DIR = path.resolve(__dirname, "../app/(couranr)");

/** Every stylesheet in the canonical route group, not just couranr.css. */
const CSS_FILES = readdirSync(CSS_DIR)
  .filter((f) => f.endsWith(".css"))
  .sort();

const CSS = CSS_FILES.map((f) =>
  readFileSync(path.join(CSS_DIR, f), "utf8")
).join("\n");

/**
 * Comments are stripped before any assertion about what the stylesheet DOES.
 * The header comment deliberately names the legacy `:root` values this file
 * must avoid (#c8a12b, #e6e8ee, #5b6472), so asserting against the raw text
 * would fail on the documentation rather than on the code.
 */
const CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * The foundation's core safety property is that it is ADDITIVE. The repo has
 * 818 lines of plain CSS whose `:root` already defines --border, --muted,
 * --card and --shadow with different values than the canonical system. If a
 * token here were unprefixed, or a rule unscoped, it would silently restyle
 * every legacy auto/docs page. These tests fail if that regresses.
 */
describe("design foundation is additive", () => {
  it("declares no custom property outside the --couranr-* namespace", () => {
    const declared = Array.from(CODE.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)).map(
      (m) => m[1]
    );
    expect(declared.length).toBeGreaterThan(40);

    const foreign = declared.filter(
      (name) => !name.startsWith("--couranr-") && !name.startsWith("--cr-")
    );
    expect(foreign).toEqual([]);
  });

  it("never targets :root, html or body", () => {
    expect(CODE).not.toMatch(/(^|[^-\w]):root\b/);
    expect(CODE).not.toMatch(/^\s*html\s*[,{]/m);
    expect(CODE).not.toMatch(/^\s*body\s*[,{]/m);
  });

  it("scopes every selector under the .cr- namespace", () => {
    // Strip comments, at-rule preludes and declaration blocks, then check that
    // each remaining selector mentions a cr- class.
    const selectors = Array.from(
      CODE.matchAll(/(^|\})\s*([^{}@]+)\{/g)
    )
      .map((m) => m[2].trim())
      .filter((s) => s && !s.startsWith("from") && !s.startsWith("to") && !/^\d+%$/.test(s));

    for (const sel of selectors) {
      expect(sel.includes(".cr-")).toBe(true);
    }
  });

  it("defines the canonical brand colours from UI_SCREEN_REGISTRY.md §2", () => {
    expect(CSS).toContain("--couranr-navy: #0d1525");
    expect(CSS).toContain("--couranr-gold: #f4b740");
    expect(CSS).toContain("--couranr-route-blue: #2563eb");
    expect(CSS).toContain("--couranr-canvas: #f7f8f5");
    expect(CSS).toContain("--couranr-border: #e3e7ed");
    expect(CSS).toContain("--couranr-text-muted: #667085");
    expect(CSS).toContain("--couranr-success: #15803d");
  });

  it("does NOT reuse the legacy gold, border or muted values", () => {
    // Legacy app/globals.css :root values that must not leak in.
    expect(CODE).not.toContain("#c8a12b"); // legacy --gold
    expect(CODE).not.toContain("#e6e8ee"); // legacy --border
    expect(CODE).not.toContain("#5b6472"); // legacy --muted
  });
});

describe("every canonical stylesheet is covered by these rules", () => {
  it("finds both couranr.css and shell.css", () => {
    expect(CSS_FILES).toContain("couranr.css");
    expect(CSS_FILES).toContain("shell.css");
  });

  it("checks shell selectors too", () => {
    // Proof the concatenated source really includes the shell rules.
    expect(CSS).toContain(".cr-sidebar");
    expect(CSS).toContain(".cr-tabbar");
    expect(CSS).toContain(".cr-navdrawer");
  });
});

describe("design foundation meets the §2 and §7 requirements", () => {
  it("uses a control height in the 46–52px band and a 44px touch minimum", () => {
    expect(CSS).toContain("--couranr-control-height: 48px");
    expect(CSS).toContain("--couranr-touch-min: 44px");
  });

  it("uses a card radius in the 18–22px band", () => {
    const m = CSS.match(/--couranr-radius-lg:\s*(\d+)px/);
    expect(m).not.toBeNull();
    const radius = Number(m![1]);
    expect(radius).toBeGreaterThanOrEqual(18);
    expect(radius).toBeLessThanOrEqual(22);
  });

  it("uses card padding in the 24–32px band", () => {
    expect(CSS).toContain("--couranr-card-padding: 24px");
    expect(CSS).toContain("--couranr-card-padding: 32px");
  });

  it("supports prefers-reduced-motion", () => {
    expect(CSS).toContain("prefers-reduced-motion: reduce");
  });

  it("provides a visible focus ring via :focus-visible", () => {
    expect(CSS).toContain(":focus-visible");
    expect(CSS).toContain("--couranr-focus-ring");
  });

  it("scrolls wide content inside its own container, not the page", () => {
    expect(CSS).toContain(".cr-table-scroll");
    expect(CSS).toMatch(/\.cr-table-scroll\s*\{[^}]*overflow-x:\s*auto/);
  });

  it("provides a skip link and a visually-hidden utility", () => {
    expect(CSS).toContain(".cr-skip-link");
    expect(CSS).toContain(".cr-visually-hidden");
  });
});

describe("internal preview route is actually routable", () => {
  /**
   * Next.js App Router treats a folder whose name starts with `_` as a PRIVATE
   * folder and excludes it from routing entirely. The preview first shipped at
   * `app/(couranr)/_preview/ui/page.tsx`, which built without error and
   * produced no route at all — a preview nobody could open. It lives at
   * `internal/` instead, and the gate is what keeps it non-public.
   */
  it("does not live under an underscore-prefixed (private) folder", () => {
    const previewPage = path.resolve(
      __dirname,
      "../app/(couranr)/internal/ui/page.tsx"
    );
    expect(existsSync(previewPage)).toBe(true);

    const legacyPrivatePath = path.resolve(
      __dirname,
      "../app/(couranr)/_preview"
    );
    expect(existsSync(legacyPrivatePath)).toBe(false);
  });

  it("calls notFound() rather than rendering when the gate is closed", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../app/(couranr)/internal/ui/page.tsx"),
      "utf8"
    );
    expect(source).toContain("isPreviewEnabled");
    expect(source).toContain("notFound()");
  });
});

describe("internal preview gate", () => {
  const saved = process.env.NODE_ENV;
  const savedFlag = process.env.COURANR_UI_PREVIEW;

  function restore() {
    (process.env as any).NODE_ENV = saved;
    if (savedFlag === undefined) delete process.env.COURANR_UI_PREVIEW;
    else process.env.COURANR_UI_PREVIEW = savedFlag;
  }

  it("is enabled outside production", () => {
    (process.env as any).NODE_ENV = "development";
    delete process.env.COURANR_UI_PREVIEW;
    expect(isPreviewEnabled()).toBe(true);
    restore();
  });

  it("is DISABLED in production unless explicitly opted in", () => {
    (process.env as any).NODE_ENV = "production";
    delete process.env.COURANR_UI_PREVIEW;
    expect(isPreviewEnabled()).toBe(false);
    restore();
  });

  it("can be explicitly opted into in production", () => {
    (process.env as any).NODE_ENV = "production";
    process.env.COURANR_UI_PREVIEW = "1";
    expect(isPreviewEnabled()).toBe(true);
    restore();
  });

  it("treats any value other than \"1\" as off", () => {
    (process.env as any).NODE_ENV = "production";
    process.env.COURANR_UI_PREVIEW = "true";
    expect(isPreviewEnabled()).toBe(false);
    restore();
  });
});


/**
 * The master-network wash is written in rgba, because this stylesheet has no
 * `color-mix` and derives every alpha variant the same way its shadow tokens
 * do. That is consistent, but it means the gradient holds a COPY of two brand
 * colours rather than a reference to them — so a future change to
 * `--couranr-gold` or `--couranr-navy` would leave the homepage washed in the
 * old palette with nothing to say so.
 *
 * The CSS carries a comment telling the next editor to mirror the change. A
 * comment is not a mechanism. This is.
 */
describe("the master-network gradient tracks its brand tokens", () => {
  const rgbOf = (hex: string) => {
    const h = hex.replace("#", "");
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  };
  const tokenHex = (name: string) => {
    const m = new RegExp(`--couranr-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(CSS);
    expect(m, `--couranr-${name} is not defined`).toBeTruthy();
    return m![1];
  };
  /* The two gradients — stacked and side-by-side — and nothing else. */
  const washes = () => {
    const start = CSS.indexOf(".cr-master-network {");
    const end = CSS.indexOf(".cr-master-network__item {");
    expect(start, "the master-network block moved").toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return CSS.slice(start, end);
  };

  it("paints the warm end in --couranr-gold and the cool end in --couranr-navy", () => {
    const wash = washes();
    const [gr, gg, gb] = rgbOf(tokenHex("gold"));
    const [nr, ng, nb] = rgbOf(tokenHex("navy"));
    /* Read the triplets OUT of the CSS rather than asserting it contains a
       string this test also hardcodes — that passes when both are wrong. */
    const triplets = [...wash.matchAll(/rgba\((\d+),\s*(\d+),\s*(\d+),/g)].map((m) =>
      [Number(m[1]), Number(m[2]), Number(m[3])].join(","),
    );
    expect(triplets.length, "expected both gradients to be present").toBeGreaterThanOrEqual(4);
    const distinct = [...new Set(triplets)].sort();
    expect(distinct).toEqual([[gr, gg, gb].join(","), [nr, ng, nb].join(",")].sort());
  });

  it("keeps every wash stop faint enough for body text to clear AA over it", () => {
    /* The ceiling is not taste. `--couranr-text-muted` is the weakest thing the
       surface still permits anywhere, and the wash must not push a reader below
       the AA floor. 0.2 leaves the navy end above 4.5:1 with room to spare. */
    const alphas = [...washes().matchAll(/rgba\(\d+,\s*\d+,\s*\d+,\s*([\d.]+)\)/g)].map((m) =>
      Number(m[1]),
    );
    expect(alphas.length).toBeGreaterThan(0);
    for (const a of alphas) expect(a).toBeLessThanOrEqual(0.2);
  });
});

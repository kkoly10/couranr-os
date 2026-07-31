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

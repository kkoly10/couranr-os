import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Enforces BRAND_GUIDE.md from Couranr_Canonical_Logo_System_v1.zip.
 *
 * The zip has been tracked in this repo since 2026-07-28 and was never
 * unpacked, so every surface shipped a typed wordmark and a `C.` mark the guide
 * explicitly retires. A rule nothing checks is a rule that decays, and this one
 * already did — the canonical `Wordmark` carried the comment "never redraw or
 * substitute" directly above the line that substituted it with text.
 */

const ROOT = path.resolve(__dirname, "..");
const EXTS = new Set([".ts", ".tsx"]);

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTS.has(path.extname(full))) out.push(full);
  }
  return out;
}

const FILES = ["app", "components"].flatMap((d) => walk(path.join(ROOT, d)));
const rel = (f: string) => path.relative(ROOT, f);

/** Strips comments so a doc block quoting a prohibition is not itself a hit. */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
}

const APPROVED = [
  "couranr-logo-primary.svg",
  "couranr-logo-reverse.svg",
  "couranr-logo-monochrome-navy.svg",
  "couranr-logo-monochrome-white.svg",
  "couranr-app-icon.svg",
];

describe("approved logo assets are present", () => {
  for (const f of APPROVED) {
    it(`public/brand/${f} exists`, () => {
      expect(existsSync(path.join(ROOT, "public/brand", f))).toBe(true);
    });
  }

  it("the wordmark SVGs keep the supplied 900x250 viewBox", () => {
    // "Preserve the SVG aspect ratio. Never stretch."
    for (const f of APPROVED.filter((x) => x.includes("logo"))) {
      const svg = readFileSync(path.join(ROOT, "public/brand", f), "utf8");
      expect(svg, f).toMatch(/viewBox\s*=\s*"0 0 900 250"/);
    }
  });

  it("CouranrLogo uses the approved paths and the fixed aspect ratio", () => {
    const src = readFileSync(path.join(ROOT, "components/brand/CouranrLogo.tsx"), "utf8");
    for (const f of APPROVED.filter((x) => x.includes("logo"))) {
      expect(src).toContain(`/brand/${f}`);
    }
    expect(src).toContain("250 / 900");
  });
});

describe("retired brand marks are not used anywhere", () => {
  /**
   * "Do not use the old `C.` header logo." / "Do not use a map-pin/C symbol."
   * Asserted on the class names that rendered them.
   */
  it("no component renders the retired C. mark", () => {
    const offenders = FILES.filter((f) => /brandMark|brandDot|\bbrandC\b/.test(code(f))).map(rel);
    expect(offenders, `retired C. mark still rendered in:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });

  /**
   * "Do not type `couranr` with a font as a substitute for the outlined SVG."
   * Matches a JSX text node that is exactly the wordmark.
   */
  it("no component types the wordmark as text", () => {
    const offenders = FILES.filter((f) => />\s*[Cc]ouranr\s*</.test(code(f))).map(rel);
    expect(offenders, `typed wordmark in:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });

  /**
   * Positive control. Without it a broken comment-stripper or a regex that
   * matches nothing would make both assertions above pass vacuously.
   */
  it("the detectors DO fire on a known-bad sample", () => {
    const bad = '<span className="brandMark">C</span><span>Couranr</span>';
    expect(/brandMark|brandDot|\bbrandC\b/.test(bad)).toBe(true);
    expect(/>\s*[Cc]ouranr\s*</.test(bad)).toBe(true);
  });

  it("finds files to police", () => {
    expect(FILES.length).toBeGreaterThan(50);
  });
});

describe("shell surfaces pair the logo variant to their background", () => {
  /**
   * `.cr-sidebar` and the mobile drawer are `--couranr-navy`. The guide says
   * "Do not place the navy logo directly over photography" and to use the
   * reverse wordmark on dark — so every sidebar Wordmark must pass tone="dark".
   */
  it("every sidebar and drawer wordmark declares tone=\"dark\"", () => {
    for (const f of ["components/couranr/shell/shells.tsx", "components/couranr/shell/MobileNav.tsx"]) {
      const src = readFileSync(path.join(ROOT, f), "utf8");
      for (const line of src.split("\n")) {
        if (!line.includes("<Wordmark")) continue;
        // The light surfaces are the public topbar (no href) and the token bar.
        if (line.includes('href="#"') || /<Wordmark\s*\/>/.test(line)) continue;
        expect(line, `${f}: ${line.trim()}`).toContain('tone="dark"');
      }
    }
  });
});

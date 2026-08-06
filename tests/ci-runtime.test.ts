import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The CI runtime must satisfy what the locked dependency tree requires.
 *
 * This exists because CI ran Node 20 while `jsdom@30` requires
 * `^22.22.2 || ^24.15.0 || >=26.0.0`. On Node 20 jsdom could not load —
 * undici threw "webidl.util.markAsUncloneable is not a function" — so every
 * `*.dom.test.tsx` file was SKIPPED and vitest exited 1 on the unhandled
 * errors. 43 DOM tests had never once run in CI, and the failure looked like
 * a test failure rather than a missing runtime.
 *
 * A version number in a workflow file is invisible to the type checker and to
 * every other test, so it is checked here against the lockfile itself.
 */

const ROOT = path.resolve(__dirname, "..");
const CI = readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
const LOCK = JSON.parse(readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));

/** The major Node version `actions/setup-node` is told to install. */
function ciNodeMajor(): number {
  const m = CI.match(/node-version:\s*"?(\d+)"?/);
  expect(m, "ci.yml declares no node-version").not.toBeNull();
  return Number(m![1]);
}

/** `engines.node` for a locked package, or null if it declares none. */
function lockedEngines(pkg: string): string | null {
  const entry = LOCK.packages?.[`node_modules/${pkg}`];
  expect(entry, `${pkg} is not in the lockfile`).toBeTruthy();
  return entry.engines?.node ?? null;
}

/**
 * Does `major` satisfy a semver range, considering only the major?
 *
 * Deliberately conservative: a `^X.Y.Z` clause is treated as satisfied by
 * major X, and `>=X` by any major at or above X. That is enough to catch the
 * class of mistake this guards — running a whole major below the floor.
 */
function majorSatisfies(major: number, range: string): boolean {
  return range.split("||").some((clause) => {
    // `v` prefixes are legal in engines fields (`>=v12.22.7`).
    const c = clause.trim().replace(/v(?=\d)/g, "");
    if (c === "" || c === "*" || c === "x") return true; // any version
    let m = c.match(/^\^(\d+)\./);
    if (m) return major === Number(m[1]);
    m = c.match(/^>=\s*(\d+)/);
    if (m) return major >= Number(m[1]);
    m = c.match(/^>\s*(\d+)/);
    if (m) return major > Number(m[1]);
    m = c.match(/^(\d+)\./);
    if (m) return major === Number(m[1]);
    // An unparsed clause must not silently count as satisfied.
    return false;
  });
}

describe("CI Node version", () => {
  const major = ciNodeMajor();

  it("is declared in the workflow", () => {
    expect(Number.isInteger(major)).toBe(true);
    expect(major).toBeGreaterThan(0);
  });

  /** The two packages that actually broke. */
  for (const pkg of ["jsdom", "undici"]) {
    it(`satisfies the locked engines of ${pkg}`, () => {
      const range = lockedEngines(pkg);
      if (range === null) return; // declares no constraint
      expect(
        majorSatisfies(major, range),
        `ci.yml runs Node ${major}, but ${pkg} requires "${range}"`
      ).toBe(true);
    });
  }

  it("satisfies every locked engines.node constraint in the tree", () => {
    // CI runs ubuntu (linux/x64). An OPTIONAL package whose os/cpu exclude
    // that platform can never install there, so its engines row constrains
    // nothing — Next 16's sharp ships per-platform binaries (e.g.
    // @img/sharp-win32-ia32, engines ^20.9.0) that made this sweep fail for
    // an artifact that will never exist on the runner.
    const CI_OS = "linux";
    const CI_CPU = "x64";
    const offenders: string[] = [];
    for (const [name, entry] of Object.entries<any>(LOCK.packages ?? {})) {
      const range = entry?.engines?.node;
      if (typeof range !== "string" || name === "") continue;
      if (entry?.optional === true) {
        const os: string[] | undefined = entry?.os;
        const cpu: string[] | undefined = entry?.cpu;
        const osExcludes = Array.isArray(os) && !os.includes(CI_OS);
        const cpuExcludes = Array.isArray(cpu) && !cpu.includes(CI_CPU);
        if (osExcludes || cpuExcludes) continue;
      }
      if (!majorSatisfies(major, range)) offenders.push(`${name} requires ${range}`);
    }
    expect(offenders, `Node ${major} fails: ${offenders.join("; ")}`).toEqual([]);
  });

  /**
   * The failure mode this whole file exists for: jsdom silently unavailable,
   * so DOM suites vanish instead of failing. If jsdom cannot be required, the
   * DOM tests are not running wherever this executes.
   */
  it("can actually load jsdom in the current runtime", async () => {
    await expect(import("jsdom")).resolves.toBeTruthy();
  });

  it("matches .nvmrc, so local and CI agree", () => {
    const nvmrc = path.join(ROOT, ".nvmrc");
    expect(existsSync(nvmrc), ".nvmrc is missing").toBe(true);
    expect(Number(readFileSync(nvmrc, "utf8").trim().replace(/^v/, "").split(".")[0])).toBe(major);
  });
});

describe("CI workflow coverage", () => {
  it("runs on the claude/** feature branches", () => {
    // Without this, every check ran for the first time only after a merge.
    expect(CI).toMatch(/"claude\/\*\*"/);
  });

  it("installs the locked tree with npm ci, not npm install", () => {
    expect(CI).toMatch(/run:\s*npm ci\b/);
    expect(CI).not.toMatch(/run:\s*npm install\b/);
  });

  it("still runs all four gates", () => {
    for (const script of ["npm run lint", "npm run typecheck", "npm run test:run", "npm run build"]) {
      expect(CI, `${script} is missing`).toContain(script);
    }
  });
});

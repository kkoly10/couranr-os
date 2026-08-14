/**
 * `npm run check:gates:controls` — proves every new gate can go RED.
 *
 * §16 of the execution spec: "Each new check requires a positive control
 * showing it fails when its invariant is broken." A check that cannot fail is
 * worse than no check — this repository has already had a preflight that
 * probed the wrong table and passed while the real blocker stood.
 *
 * Each gate implements its own `--positive-control` mode (plant a violation,
 * expect the scan to flag it, clean up); this driver runs them all and fails
 * if any gate proved unable to detect its planted violation.
 *
 * The db:test control is EXCLUDED here by default because it needs a full
 * disposable database bring-up (~40s); run it directly with
 * `node e2e/disposable/dbTest.mjs --rls-only --positive-control`.
 * `--with-db` includes it. `test:shell-chrome` is excluded for the same reason
 * — it needs a dev server and a browser — and `--with-browser` includes it.
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const GATES = [
  ["check:routes", ["scripts/checkRoutes.mjs", "--positive-control"]],
  ["check:legacy-imports", ["scripts/checkLegacyImports.mjs", "--positive-control"]],
  ["check:migrations", ["scripts/checkMigrationsDestructive.mjs", "--positive-control"]],
  ["check:mocks", ["scripts/checkMockMap.mjs", "--positive-control"]],
  ["check:visual-system", ["scripts/checkVisualSystem.mjs", "--positive-control"]],
];

if (process.argv.includes("--with-db")) {
  GATES.push(["db:test", ["e2e/disposable/dbTest.mjs", "--rls-only", "--positive-control"]]);
}

// test:shell-chrome needs a running dev server and a browser, so like db:test
// it is opt-in rather than part of the default sweep. `--with-browser` reuses
// a dev server on BASE_URL and only boots one when nothing answers.
if (process.argv.includes("--with-browser")) {
  GATES.push(["test:shell-chrome", ["e2e/shellChrome.mjs", "--positive-control"]]);
}

let failed = 0;
for (const [name, argv] of GATES) {
  process.stdout.write(`${name}: `);
  try {
    const out = execFileSync("node", argv, { cwd: ROOT, encoding: "utf8" });
    console.log(out.trim().split("\n").pop());
  } catch (e) {
    failed++;
    console.error(`FAILED — the gate could not detect its planted violation`);
    console.error(String(e.stdout || e.message).slice(0, 400));
  }
}

if (failed) {
  console.error(`\n${failed} gate(s) cannot go red. Refusing to pass.`);
  process.exit(1);
}
console.log("\nevery gate proved it can fail");

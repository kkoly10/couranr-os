/**
 * `npm run check:dev-isolation` — no harness may write Next's generated output
 * into a type-checked path.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS GUARDS
 * ---------------------------------------------------------------------------
 *
 * `next dev` writes route types into `<distDir>/dev/types/`, `validator.ts`
 * among them, incrementally. Three harnesses started `next dev` with no distDir
 * override — so it went to the developer's `.next` — and every one of them
 * kills the server with a signal, which lands mid-write. `tsconfig.json`
 * type-checks `.next/dev/types/**\/*.ts`, so the next typecheck or build failed
 * on a file nobody edited:
 *
 *     .next/dev/types/validator.ts(2456,32): error TS1005: ';' expected.
 *
 * It cost a green gate mid-verification and needed a manual `rm -rf .next`.
 *
 * The repair is e2e/devDistDir.mjs: an isolated directory outside tsconfig's
 * `include`, removed on every observable exit path. This gate is what stops the
 * next harness from quietly reintroducing the trap — the fix is one forgotten
 * env key away from being undone, and nothing else would notice until a
 * typecheck went red for reasons that look like a code defect.
 *
 * WHAT IT CHECKS: every `next dev` and `next build` spawned from `e2e/` passes
 * COURANR_DIST_DIR in its env. `next.config.js` maps that to `distDir`. Those
 * two WRITE generated types; `next start` only serves a build that already
 * exists, and the tier-4 browser gates depend on it serving the real `.next`.
 *
 * WHAT IT DOES NOT CHECK: that the value is a directory outside tsconfig's
 * include. That is asserted by e2e/devDistDir.mjs owning the name, and proved
 * empirically by leaving a validator.ts in `.next-devharness/` and running
 * `npm run typecheck` — exit 0.
 *
 * Run:  node scripts/checkDevServerIsolation.mjs [--positive-control]
 */
import { readFileSync, readdirSync, statSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_ROOT = path.join(ROOT, "e2e");
/**
 * `dev` and `build` WRITE generated types; `start` only serves a build that
 * already exists. Including `start` was the first version of this gate and it
 * was wrong in a way worth recording: it flagged the four tier-4 browser gates,
 * which deliberately serve the production `.next` that the build stage just
 * produced. Forcing an isolated distDir on them would point them at an empty
 * directory — the gate would have "passed" by breaking the suites it guards.
 */
const VERBS = ["dev", "build"];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === "node_modules" || entry === "screenshots" || entry === "artifacts") continue;
      out.push(...walk(p));
    } else if (entry.endsWith(".mjs")) out.push(p);
  }
  return out;
}

/**
 * The options object that follows an argv array, by brace matching rather than
 * by a fixed character window — a window either truncates a long env literal
 * (false positive) or runs into the next call (false negative), and both were
 * observed while writing this.
 */
function optionsObjectAfter(src, from) {
  const brace = src.indexOf("{", from);
  if (brace === -1) return null;
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(brace, i + 1);
    }
  }
  return null;
}

function scan(file) {
  const src = readFileSync(file, "utf8");
  const offenders = [];
  for (const verb of VERBS) {
    const needle = `"next", "${verb}"`;
    let at = src.indexOf(needle);
    while (at !== -1) {
      const closeBracket = src.indexOf("]", at);
      const opts = closeBracket === -1 ? null : optionsObjectAfter(src, closeBracket);
      if (!opts || !opts.includes("COURANR_DIST_DIR")) {
        const line = src.slice(0, at).split("\n").length;
        offenders.push({ file: path.relative(ROOT, file), line, verb });
      }
      at = src.indexOf(needle, at + needle.length);
    }
  }
  return offenders;
}

function run() {
  return walk(SCAN_ROOT).flatMap(scan);
}

const POSITIVE_CONTROL = process.argv.includes("--positive-control");

if (POSITIVE_CONTROL) {
  // Plant a harness that starts `next dev` straight into the developer's
  // `.next` — the exact shape that shipped — and require the scan to see it.
  const planted = path.join(SCAN_ROOT, "__devIsolationControl.mjs");
  writeFileSync(
    planted,
    'import { spawn } from "node:child_process";\n' +
      'spawn("npx", ["next", "dev", "-p", "3999"], { cwd: ".", env: { ...process.env } });\n',
  );
  let caught = false;
  try {
    caught = run().some((o) => o.file.endsWith("__devIsolationControl.mjs"));
  } finally {
    rmSync(planted, { force: true });
  }
  if (!caught) {
    console.error("check:dev-isolation POSITIVE CONTROL FAILED — the planted violation was not detected");
    process.exit(1);
  }
  console.log("check:dev-isolation positive control ok — the planted violation was detected");
  process.exit(0);
}

const offenders = run();
if (offenders.length) {
  console.error("check:dev-isolation FAILED — a Next server is writing into a type-checked path:\n");
  for (const o of offenders) {
    console.error(`  ${o.file}:${o.line}  next ${o.verb} spawned without COURANR_DIST_DIR`);
  }
  console.error(
    "\nPass COURANR_DIST_DIR in the spawn env. For a dev server use " +
      "claimDevDistDir() from e2e/devDistDir.mjs, which also removes the directory on exit.",
  );
  process.exit(1);
}
console.log("check:dev-isolation ok — every Next server spawned from e2e/ writes to an isolated distDir");

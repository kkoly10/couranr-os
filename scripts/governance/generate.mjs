#!/usr/bin/env node
/**
 * `npm run governance:generate` — rewrites every mirror owned by the authority
 * model from its declared source.
 *
 * This is the ONLY sanctioned way to change a generated artifact. Editing one
 * by hand makes `check:governance` red, which is the point: the gate is what
 * lets a mirror be de-authorized without anyone having to remember it is a
 * mirror.
 *
 * Prints what changed, so a run that silently rewrites a document nobody
 * expected to move is visible in the diff rather than in a later surprise.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT, screenSource, SCREEN_OUTPUTS } from "./screenRegistry.mjs";
import { SCREENS_MODULE_OUTPUT } from "./screensModule.mjs";

const src = screenSource();
const written = [];
const unchanged = [];

for (const o of [...SCREEN_OUTPUTS, SCREENS_MODULE_OUTPUT]) {
  const path = join(ROOT, o.path);
  const generated = o.render(src);
  const before = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (before === generated) {
    unchanged.push(o.path);
    continue;
  }
  writeFileSync(path, generated);
  written.push(o.path);
}

for (const p of written) console.log(`  rewrote   ${p}`);
for (const p of unchanged) console.log(`  unchanged ${p}`);
console.log(
  `governance:generate: ${written.length} rewritten, ${unchanged.length} already current`,
);

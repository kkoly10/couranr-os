#!/usr/bin/env node
/**
 * `npm run check:mocks` — verifies docs/couranr-mvp/MOCK_TO_SCREEN_MAP.md
 * against the filesystem.
 *
 * That map is the only index tying a canonical screen ID to the design mock it
 * must be built from, and it is hand-maintained. Nothing else notices when a
 * filename in it is wrong: a typo'd UUID silently means "this screen has no
 * mock", which is exactly the failure the map exists to fix. So this gate
 * re-derives every count in the document from disk rather than trusting prose.
 *
 * Fails when:
 *   - a filename in the map does not exist at the repo root
 *   - a root PNG is claimed by no screen and is not on the unmapped list
 *   - a file is claimed twice (by two screens, or by a screen and the list)
 *   - a screen ID in the map is not one of the 66 in UI_SCREEN_REGISTRY.md
 *   - the census table's numbers disagree with what was just counted
 *
 * `--positive-control` proves the gate can go red: it runs the same scan
 * against an in-memory copy of the document with one filename corrupted and
 * fails if that corruption is NOT flagged. Nothing on disk is written.
 *
 * Read-only. Never deletes, moves or renames a root PNG.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAP = "docs/couranr-mvp/MOCK_TO_SCREEN_MAP.md";

/**
 * The whole scan, as a pure function of the document text, so the positive
 * control can feed it a mutated copy without touching the file.
 */
function scan(doc) {
  const fail = [];
  const onDisk = readdirSync(repo).filter((f) => f.endsWith(".png"));
  const diskSet = new Set(onDisk);

  const fence = doc.match(/```json\n([\s\S]*?)\n```/);
  if (!fence) return { fail: [`${MAP}: no \`\`\`json block found`] };
  let screens;
  try {
    screens = JSON.parse(fence[1]);
  } catch (e) {
    return { fail: [`${MAP}: the json block does not parse — ${e.message}`] };
  }

  /* 1. every mapped filename exists, and is claimed exactly once */
  const claimedBy = new Map();
  for (const [id, files] of Object.entries(screens)) {
    for (const f of files) {
      if (!diskSet.has(f)) fail.push(`${id}: "${f}" is not at the repo root`);
      if (claimedBy.has(f)) fail.push(`"${f}" claimed by both ${claimedBy.get(f)} and ${id}`);
      claimedBy.set(f, id);
    }
  }

  /* 2. files named in prose: the unmapped list, the photography table, the
        brand sheet. The unmapped list gives 8-4 UUID prefixes; the tables give
        whole filenames. */
  const unmappedSection = doc.slice(doc.indexOf("## Screens the mocks show"));
  const prefixes = [...unmappedSection.matchAll(/`([0-9A-F]{8}-[0-9A-F]{4})`/g)].map((m) => m[1]);
  const wholeNames = [...doc.matchAll(/`([0-9A-F-]{36}\.png)`/g)].map((m) => m[1]);

  const unmapped = new Set();
  for (const p of prefixes) {
    const hits = onDisk.filter((f) => f.startsWith(p));
    if (hits.length !== 1) {
      fail.push(`prefix "${p}" resolves to ${hits.length} files (want exactly 1)`);
      continue;
    }
    if (claimedBy.has(hits[0])) {
      fail.push(`"${hits[0]}" is both mapped to ${claimedBy.get(hits[0])} and listed as unmapped`);
    }
    unmapped.add(hits[0]);
  }
  for (const f of wholeNames) {
    if (!diskSet.has(f)) fail.push(`"${f}" named in prose is not at the repo root`);
    else if (!claimedBy.has(f)) unmapped.add(f);
  }

  /* 3. nothing on disk is unaccounted for */
  const unaccounted = onDisk.filter((f) => !claimedBy.has(f) && !unmapped.has(f));
  if (unaccounted.length) {
    fail.push(`${unaccounted.length} root PNG(s) claimed by nothing: ${unaccounted.join(", ")}`);
  }

  /* 4. screen IDs are the registry's */
  const registry = readFileSync(join(repo, "UI_SCREEN_REGISTRY.md"), "utf8");
  const known = new Set(
    [...registry.matchAll(/\b((?:PUB|MER|DRV|OPS|CUS)-\d{3})\b/g)].map((m) => m[1]),
  );
  for (const id of Object.keys(screens)) {
    if (!known.has(id)) fail.push(`"${id}" is not a screen ID in UI_SCREEN_REGISTRY.md`);
  }
  if (Object.keys(screens).length !== 66) {
    fail.push(`map covers ${Object.keys(screens).length} screens, registry has 66`);
  }

  /* 5. the census table matches what was just counted */
  const withMockCount = Object.values(screens).filter((v) => v.length).length;
  const rows = {
    "PNGs at repo root": onDisk.length,
    "…that map to one of the 66 registry screens": claimedBy.size,
    "…that depict a screen **not** in the registry, or are photography": unmapped.size,
    "…unaccounted for": unaccounted.length,
    "Registry screens with **no** mock": 66 - withMockCount,
  };
  for (const [label, want] of Object.entries(rows)) {
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const row = doc.match(new RegExp(`^\\| ${esc} \\| \\*{0,2}(\\d+)\\*{0,2} \\|$`, "m"));
    if (!row) fail.push(`census table has no row "${label}"`);
    else if (Number(row[1]) !== want) {
      fail.push(`census "${label}": table says ${row[1]}, disk says ${want}`);
    }
  }
  const withMockRow = doc.match(/^\| Registry screens with at least one mock \| (\d+) of 66 \|$/m);
  if (!withMockRow) fail.push(`census table has no "at least one mock" row`);
  else if (Number(withMockRow[1]) !== withMockCount) {
    fail.push(`census "at least one mock": table says ${withMockRow[1]}, disk says ${withMockCount}`);
  }

  return {
    fail,
    summary:
      `${onDisk.length} root PNGs, ${claimedBy.size} mapped to ${withMockCount}/66 screens, ` +
      `${unmapped.size} unmapped, ${unaccounted.length} unaccounted`,
  };
}

const doc = readFileSync(join(repo, MAP), "utf8");

if (process.argv.includes("--positive-control")) {
  // Corrupt one mapped filename in memory. The scan must notice three things:
  // the name is gone, the real file is now orphaned, and the census disagrees.
  const broken = doc.replace(/"([0-9A-F-]{36})\.png"/, '"$1-BROKEN.png"');
  if (broken === doc) {
    console.error("positive control could not plant a violation — no mapped filename found");
    process.exit(1);
  }
  const { fail } = scan(broken);
  if (!fail.length) {
    console.error("positive control FAILED — a corrupted filename was not detected");
    process.exit(1);
  }
  console.log(`check:mocks positive control ok — planted violation produced ${fail.length} error(s)`);
  process.exit(0);
}

const { fail, summary } = scan(doc);
if (fail.length) {
  console.error(`check-mock-map: ${fail.length} problem(s)\n`);
  for (const f of fail) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`check-mock-map: ok — ${summary}`);

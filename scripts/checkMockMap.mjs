#!/usr/bin/env node
/**
 * `npm run check:mocks` — validates the ROOT-PNG subset of the structured
 * visual registry against the filesystem.
 *
 * It used to parse a ```json fence out of `MOCK_TO_SCREEN_MAP.md`, plus three
 * different prose formats — 8-4 UUID prefixes in one list, whole filenames in
 * two tables — to work out which root PNGs were accounted for. That map is now
 * GENERATED from `docs/couranr-mvp/ui-reference/VISUAL_REGISTRY.json`, and this
 * gate reads the source instead. A Markdown fence is not a machine API.
 *
 * The scope is unchanged and deliberate: this gate is about RESIDENCY at the
 * repo root. It is what proves no root PNG is silently orphaned and that no
 * screen claims a file that is not there. Nested canonical images are a
 * different question with a different answer, and the registry now has a field
 * for each — which is what ended PUB-004's contradiction. This gate refuses a
 * nested path in `root_sources` rather than tolerating one.
 *
 * Fails when:
 *   - a root_sources filename is not at the repo root
 *   - a root PNG on disk has no `assets` entry
 *   - an `assets` entry names a file that is not there
 *   - a file is claimed by two screens
 *   - a `root_sources` entry is a path rather than a root filename
 *   - a screen id is not one of the canonical screens, or a screen is missing
 *   - a nested_sources path does not exist, or lives at the repo root
 *
 * `--positive-control` mutates an in-memory copy of the registry and fails if
 * the corruption is NOT flagged. Nothing on disk is written.
 *
 * Read-only. Never deletes, moves or renames a root PNG.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = "docs/couranr-mvp/ui-reference/VISUAL_REGISTRY.json";
const SCREENS = "ui_screen_registry.json";

/** The whole scan, as a pure function of the registry, for the control. */
function scan(reg) {
  const fail = [];
  const onDisk = readdirSync(repo).filter((f) => f.endsWith(".png"));
  const diskSet = new Set(onDisk);
  const s = reg.sources;

  /* Screen ids come from the screen-topology authority. This gate hardcoded the
     literal 66 in five places once; the count comes from the source now. */
  const canonical = JSON.parse(readFileSync(join(repo, SCREENS), "utf8")).screens.map((x) => x.id);
  const CANONICAL_COUNT = canonical.length;

  /* 1. root_sources: every filename resides at the root and is claimed once */
  const claimedBy = new Map();
  for (const id of Object.keys(s.screens)) {
    if (!canonical.includes(id)) fail.push(`"${id}" is not a canonical screen id`);
    for (const f of s.screens[id].root_sources) {
      if (f.includes("/")) {
        fail.push(`${id}: root_sources entry "${f}" is a path — nested assets belong in nested_sources`);
        continue;
      }
      if (!diskSet.has(f)) fail.push(`${id}: "${f}" is not at the repo root`);
      if (claimedBy.has(f)) fail.push(`"${f}" claimed by both ${claimedBy.get(f)} and ${id}`);
      claimedBy.set(f, id);
    }
  }
  for (const id of canonical) {
    if (!s.screens[id]) fail.push(`${id} has no visual-source record`);
  }
  if (Object.keys(s.screens).length !== CANONICAL_COUNT) {
    fail.push(
      `registry covers ${Object.keys(s.screens).length} screens, screen source has ${CANONICAL_COUNT}`,
    );
  }

  /* 2. assets: one entry per root PNG, in both directions */
  for (const f of Object.keys(s.assets)) {
    if (!diskSet.has(f)) fail.push(`assets names "${f}", which is not at the repo root`);
  }
  const unaccounted = onDisk.filter((f) => !s.assets[f]);
  if (unaccounted.length) {
    fail.push(`${unaccounted.length} root PNG(s) accounted for by nothing: ${unaccounted.join(", ")}`);
  }
  for (const [f, a] of Object.entries(s.assets)) {
    if (!a.owner) fail.push(`assets["${f}"] declares no owner`);
  }

  /* 3. nested assets exist, and are not root PNGs pretending to be nested */
  let nested = 0;
  for (const [id, rec] of Object.entries(s.screens)) {
    for (const n of rec.nested_sources ?? []) {
      nested++;
      if (!n.path.includes("/")) {
        fail.push(`${id}: nested_sources entry "${n.path}" is a bare root filename`);
      } else if (!existsSync(join(repo, n.path))) {
        fail.push(`${id}: nested source "${n.path}" does not exist`);
      }
      if (!["reference", "canonical", "provenance-only"].includes(n.role)) {
        fail.push(`${id}: nested source "${n.path}" has unknown role "${n.role}"`);
      }
    }
  }

  /* 4. visual_authority agrees with what the sources actually are */
  for (const [id, rec] of Object.entries(s.screens)) {
    const want = rec.root_sources.length ? "canonical" : "derived";
    if (rec.visual_authority !== want) {
      fail.push(
        `${id}: visual_authority is "${rec.visual_authority}" but it has ` +
          `${rec.root_sources.length} root source(s) — expected "${want}"`,
      );
    }
  }

  /* 5. every dispute names a file that is actually disputed */
  for (const d of s.disputes ?? []) {
    const census = Object.keys(s.screens).find((id) => s.screens[id].root_sources.includes(d.file));
    if (census !== d.census_screen) {
      fail.push(`dispute for "${d.file}" says census_screen ${d.census_screen}, registry says ${census}`);
    }
    if (s.assets[d.file]?.owner !== d.provenance_owner) {
      fail.push(
        `dispute for "${d.file}" says provenance_owner ${d.provenance_owner}, ` +
          `assets says ${s.assets[d.file]?.owner}`,
      );
    }
  }
  const undisputed = [...claimedBy].filter(
    ([f, id]) => s.assets[f] && s.assets[f].owner !== id &&
      !(s.disputes ?? []).some((d) => d.file === f),
  );
  for (const [f, id] of undisputed) {
    fail.push(
      `"${f}" is mapped to ${id} but owned by ${s.assets[f].owner} and is not in disputes — ` +
        `record the disagreement rather than letting two documents answer differently`,
    );
  }

  const withMock = Object.values(s.screens).filter((v) => v.root_sources.length).length;
  return {
    fail,
    summary:
      `${onDisk.length} root PNGs, ${claimedBy.size} mapped to ${withMock}/${CANONICAL_COUNT} screens, ` +
      `${onDisk.length - claimedBy.size} unmapped, ${unaccounted.length} unaccounted, ` +
      `${nested} nested reference(s), ${(s.disputes ?? []).length} recorded dispute(s)`,
  };
}

const registry = JSON.parse(readFileSync(join(repo, REGISTRY), "utf8"));

if (process.argv.includes("--positive-control")) {
  /* Four plants, one per rule that would otherwise be untested: a corrupted
     filename, a nested path smuggled into root_sources, a dropped assets entry
     and an unrecorded ownership disagreement. */
  const clone = () => JSON.parse(JSON.stringify(registry));
  const plants = [
    ["a corrupted root filename", () => {
      const r = clone();
      const id = Object.keys(r.sources.screens).find((k) => r.sources.screens[k].root_sources.length);
      r.sources.screens[id].root_sources[0] += "-BROKEN.png";
      return r;
    }],
    ["a nested path smuggled into root_sources", () => {
      const r = clone();
      const id = Object.keys(r.sources.screens).find((k) => r.sources.screens[k].root_sources.length);
      r.sources.screens[id].root_sources[0] = "canonical-mvp-images/public/PUB-004_delivery-estimate-and-hosted-request.png";
      return r;
    }],
    ["a root PNG no longer accounted for", () => {
      const r = clone();
      delete r.sources.assets[Object.keys(r.sources.assets)[0]];
      return r;
    }],
    ["an ownership disagreement that is not recorded", () => {
      const r = clone();
      r.sources.disputes = [];
      return r;
    }],
  ];
  let bad = 0;
  for (const [what, plant] of plants) {
    const { fail } = scan(plant());
    if (!fail.length) {
      console.error(`positive control FAILED — ${what} was not detected`);
      bad++;
    } else {
      console.log(`check:mocks positive control ok — ${what} produced ${fail.length} error(s): "${fail[0].slice(0, 100)}"`);
    }
  }
  const clean = scan(registry);
  if (clean.fail.length) {
    console.error("positive control ran against a registry that is already failing:");
    for (const f of clean.fail) console.error(`  - ${f}`);
    bad++;
  }
  process.exit(bad ? 1 : 0);
}

const { fail, summary } = scan(registry);
if (fail.length) {
  console.error(`check-mock-map: ${fail.length} problem(s)\n`);
  for (const f of fail) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`check-mock-map: ok — ${summary}`);

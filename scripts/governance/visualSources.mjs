/**
 * Visual-source generators.
 *
 * AUTHORITY: `docs/couranr-mvp/ui-reference/VISUAL_REGISTRY.json` → `sources`.
 * GENERATED:  `docs/couranr-mvp/MOCK_TO_SCREEN_MAP.md` (root-PNG census report)
 *             `docs/couranr-mvp/ui-reference/CANONICAL_SCREEN_SOURCE_MAP.tsv`
 *               (provenance report)
 *
 * The two used to be independently hand-maintained, and they DISAGREED about
 * three root PNGs — `5780C3C2` (PUB-001 vs PUB-009), `892BDA6D` (OPS-005 vs
 * OPS-006) and `BFAD28C4` (CUS-006 vs MER-007). Nothing compared them, so both
 * documents were confidently wrong about each other for as long as they existed.
 * The migration preserved both claims rather than picking a winner: the census
 * screen and the provenance owner are separate fields, and `sources.disputes`
 * names all three. Resolving one is an owner decision.
 *
 * Every count in the census table is DERIVED here. The document used to assert
 * them in prose, which is how "none of the 62 canonical-mvp-images/** paths
 * exist on disk" stayed in the preamble after thirteen of them landed.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, screenSource } from "./screenRegistry.mjs";

export const VISUAL_REGISTRY = "docs/couranr-mvp/ui-reference/VISUAL_REGISTRY.json";
export const MOCK_MAP = "docs/couranr-mvp/MOCK_TO_SCREEN_MAP.md";
export const SOURCE_MAP_TSV = "docs/couranr-mvp/ui-reference/CANONICAL_SCREEN_SOURCE_MAP.tsv";

export function visualRegistry() {
  return JSON.parse(readFileSync(join(ROOT, VISUAL_REGISTRY), "utf8"));
}

/** Repo-root PNGs, as the filesystem actually has them. */
export function rootPngs() {
  return readdirSync(join(ROOT, ".")).filter((f) => f.endsWith(".png")).sort();
}

/**
 * Every number the census table prints, measured rather than remembered.
 * Exported so `check:mocks` scores the same arithmetic the document renders.
 */
export function census(reg = visualRegistry(), src = screenSource()) {
  const s = reg.sources;
  const ids = src.screens.map((x) => x.id);
  const claimed = new Set();
  for (const id of ids) for (const f of s.screens[id].root_sources) claimed.add(f);
  const withMock = ids.filter((id) => s.screens[id].root_sources.length > 0);
  const byDesign = src.screens.filter((x) => !x.image).map((x) => x.id);
  const onDisk = rootPngs();
  return {
    onDisk: onDisk.length,
    screens: ids.length,
    mapped: claimed.size,
    unmapped: onDisk.length - claimed.size,
    unaccounted: onDisk.filter((f) => !claimed.has(f) && !s.assets[f]).length,
    withMock: withMock.length,
    withoutMock: ids.length - withMock.length,
    byDesign,
    gaps: ids.length - withMock.length - byDesign.length,
  };
}

function censusTable(c) {
  const first = c.byDesign[0];
  const last = c.byDesign[c.byDesign.length - 1];
  const span = `${first}…${last.slice(-3)}`;
  return [
    "| | count |",
    "|---|---|",
    `| PNGs at repo root | ${c.onDisk} |`,
    `| …that map to one of the ${c.screens} registry screens | ${c.mapped} |`,
    `| …that depict a screen **not** in the registry, or are photography | ${c.unmapped} |`,
    `| …unaccounted for | **${c.unaccounted}** |`,
    `| Registry screens with at least one mock | ${c.withMock} of ${c.screens} |`,
    `| Registry screens with **no** mock | ${c.withoutMock} |`,
    `| …of which "no mock" is correct by design | ${c.byDesign.length} (${span}) |`,
    `| …leaving real design gaps | **${c.gaps}** |`,
  ].join("\n");
}

export const TSV_MARKER =
  "# GENERATED FILE — DO NOT EDIT. Source: docs/couranr-mvp/ui-reference/VISUAL_REGISTRY.json. " +
  "Regenerate with `npm run governance:generate`.";

export function renderMockMap(reg = visualRegistry(), src = screenSource()) {
  const d = reg.sources.document;
  const c = census(reg, src);
  const fence = {};
  for (const s of src.screens) fence[s.id] = reg.sources.screens[s.id].root_sources;

  return [
    d.preamble,
    "",
    d.census_heading,
    "",
    censusTable(c),
    "",
    d.census_after,
    "",
    d.authority,
    "",
    d.fence_intro,
    "",
    "```json",
    JSON.stringify(fence, null, 2),
    "```",
    "",
    d.fence_after,
    "",
    d.photography,
    "",
    d.brand,
    "",
    d.out_of_scope,
    "",
    d.no_mock,
    "",
  ].join("\n");
}

export function renderSourceMapTsv(reg = visualRegistry(), src = screenSource()) {
  const s = reg.sources;
  const rows = [];
  for (const [file, a] of Object.entries(s.assets)) {
    rows.push([a.owner, file, a.title, a.note]);
  }
  for (const screen of src.screens) {
    for (const n of s.screens[screen.id].nested_sources ?? []) {
      rows.push([screen.id, n.path, n.title, n.note]);
    }
  }
  rows.sort((x, y) => (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0));
  /* Leading `#` marker, same trade and same guard as ui_screen_registry.csv:
     nothing parses this file, and tests/couranr-governance.test.ts holds that
     true. */
  return [TSV_MARKER, "screen_id\tsource_png\ttitle\tnote", ...rows.map((r) => r.join("\t"))].join("\n") + "\n";
}

export const VISUAL_SOURCE_OUTPUTS = [
  { path: MOCK_MAP, render: (src) => renderMockMap(visualRegistry(), src) },
  { path: SOURCE_MAP_TSV, render: (src) => renderSourceMapTsv(visualRegistry(), src) },
];

/**
 * Screen-topology generators.
 *
 * AUTHORITY: root `ui_screen_registry.json`.
 * GENERATED:  `UI_SCREEN_REGISTRY.md`, `ui_screen_registry.csv`.
 *
 * Why this exists: at the consolidation baseline the same 66 screens were
 * written out three times — the JSON, the CSV and the Markdown — with no
 * generator between them, so a route change was a search-and-replace across
 * three files that could each independently be right or wrong. The Markdown
 * additionally declared ITSELF the approved source of truth, which made the
 * JSON a mirror of a document that was a mirror of nothing.
 *
 * The parity requirement is strict and deliberate: these renderers must
 * reproduce the checked-in Markdown and CSV BYTE FOR BYTE before anything is
 * de-authorized. A generator that "mostly" reproduces its target is a generator
 * that silently rewrites authority the first time it runs.
 *
 * Route multiplicity is the one schema change. Three screens encoded several
 * routes in one prose string (`/estimate and /request/[merchantSlug]`), which
 * no consumer could split reliably. `routes[]` is now authoritative and
 * `route_label` carries the exact prose the documents render, so the split is
 * available to code without changing a single rendered byte.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SCREEN_SOURCE = "ui_screen_registry.json";
export const SCREEN_MD = "UI_SCREEN_REGISTRY.md";
export const SCREEN_CSV = "ui_screen_registry.csv";

export function screenSource() {
  return JSON.parse(readFileSync(join(ROOT, SCREEN_SOURCE), "utf8"));
}

/** RFC4180 field: quote only when the value forces it, matching the checked-in file. */
function csvField(v) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_COLUMNS = [
  "id", "surface", "name", "route", "tier", "phase", "viewport",
  "canonical_path", "image", "purpose", "actions", "states", "source", "constraints",
];

/**
 * A leading `#` comment line carries the do-not-edit marker.
 *
 * It costs strict RFC4180 conformance, so it is only defensible because NOTHING
 * reads this file as data — the JSON is the machine input and the CSV is a
 * spreadsheet-openable export. `tests/couranr-governance.test.ts` asserts that
 * stays true; if a consumer ever appears, the marker has to move rather than the
 * consumer having to strip it.
 */
export const CSV_MARKER =
  "# GENERATED FILE — DO NOT EDIT. Source: ui_screen_registry.json. " +
  "Regenerate with `npm run governance:generate`.";

export function renderScreenCsv(src) {
  const lines = [CSV_MARKER, CSV_COLUMNS.join(",")];
  for (const s of src.screens) {
    lines.push(
      CSV_COLUMNS.map((c) => csvField(c === "route" ? s.route_label : s[c])).join(","),
    );
  }
  // CRLF, because the checked-in interchange file is CRLF and parity is byte-exact.
  return lines.join("\r\n") + "\r\n";
}

export function renderScreenMd(src) {
  const d = src.document;
  const out = [];
  out.push(d.preamble, "");
  out.push("## 4. Route and screen registry", "");
  out.push(d.registry_note, "");

  for (const surface of d.surface_order) {
    out.push(`### ${surface}`, "");
    out.push("| ID | Screen | Route / state | Tier | Phase | Viewport | Canonical image |");
    out.push("|---|---|---|---|---|---|---|");
    for (const s of src.screens.filter((x) => x.surface === surface)) {
      out.push(
        `| ${s.id} | ${s.name} | \`${s.route_label}\` | ${s.tier} | ${s.phase} | ` +
          `${s.viewport} | \`${s.canonical_path}\` |`,
      );
    }
    out.push("");
  }

  out.push("## 5. Detailed screen contracts", "");
  out.push(d.contracts_note, "");
  for (const group of d.contract_group_order) {
    const surface = group.replace(/ contracts$/, "");
    out.push(`### ${group}`, "");
    for (const s of src.screens.filter((x) => x.surface === surface)) {
      out.push(`#### ${s.id} — ${s.name}`, "");
      out.push(`- **Route/state:** \`${s.route_label}\``);
      out.push(`- **Tier / phase:** ${s.tier} / Phase ${s.phase}`);
      out.push(`- **Purpose:** ${s.purpose}`);
      out.push(`- **Allowed actions:** ${s.actions}`);
      out.push(`- **Required states:** ${s.states}`);
      out.push(`- **Authoritative source:** ${s.source}`);
      out.push(`- **Mandatory correction/constraint:** ${s.constraints}`);
      out.push(`- **Canonical visual:** \`${s.canonical_path}\``);
      out.push("");
    }
  }

  out.push(d.tail.replace(/^\n+/, ""));
  return out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n*$/, "\n");
}

export const SCREEN_OUTPUTS = [
  { path: SCREEN_MD, render: renderScreenMd },
  { path: SCREEN_CSV, render: renderScreenCsv },
];

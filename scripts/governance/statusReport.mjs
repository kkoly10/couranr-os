/**
 * `docs/couranr-mvp/IMPLEMENTATION_STATUS.md` — current state, generated.
 *
 * AUTHORITY: the two ledgers, plus a repository scan.
 *
 * It was a 721-line hand-written narrative that opened by calling itself the
 * current-state source of truth, and it restated per-row facts the ledgers
 * already owned — every verification SHA with a paragraph about what it proved,
 * which is the ledgers' `test_evidence` and `browser_verified` columns written
 * out a second time. Two copies of a fact is the problem this consolidation
 * exists to remove, and the copy that goes stale is always the prose one: it
 * still described a merge from 2026-08-06 and counted 39 migrations against 50
 * on disk.
 *
 * That document is preserved whole under
 * `autonomous-evidence/status-archive/`. Nothing here restates a per-row fact:
 * it counts, it lists what is open, and it points at the row.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROOT, screenSource } from "./screenRegistry.mjs";

export const STATUS = "docs/couranr-mvp/IMPLEMENTATION_STATUS.md";
const ITEM_LEDGER = "docs/couranr-mvp/IMPLEMENTATION_LEDGER.csv";
const SCREEN_LEDGER = "docs/couranr-mvp/SCREEN_IMPLEMENTATION_LEDGER.csv";

function csvRows(rel) {
  const text = readFileSync(join(ROOT, rel), "utf8");
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const data = rows.filter((r) => r.length > 1 || r[0] !== "");
  const header = data[0];
  return data.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

/** Walk `app/` counting route files, split canonical vs legacy. */
function routeScan() {
  const out = { pages: 0, canonicalPages: 0, apis: 0, canonicalApis: 0 };
  const walk = (rel) => {
    const dir = join(ROOT, rel);
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const r = `${rel}/${name}`;
      if (statSync(join(ROOT, r)).isDirectory()) { walk(r); continue; }
      /* Canonical PAGES live in the `(couranr)` route group; canonical APIs
         live under `app/api/couranr`. Two different roots, which is why a
         single prefix test reported zero canonical API routes. */
      if (name === "page.tsx") { out.pages++; if (r.startsWith("app/(couranr)/")) out.canonicalPages++; }
      if (name === "route.ts") { out.apis++; if (r.startsWith("app/api/couranr/")) out.canonicalApis++; }
    }
  };
  walk("app");
  return out;
}

const countOf = (dir, suffix) =>
  existsSync(join(ROOT, dir)) ? readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(suffix)).length : 0;

function tally(rows, key) {
  const t = {};
  for (const r of rows) t[r[key]] = (t[r[key]] ?? 0) + 1;
  return Object.entries(t).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function renderStatus() {
  const items = csvRows(ITEM_LEDGER);
  const screens = csvRows(SCREEN_LEDGER);
  const src = screenSource();
  const routes = routeScan();

  const shas = [...new Set([
    ...items.map((r) => r.last_verified_sha),
    ...screens.map((r) => r.last_verified_sha),
  ])].filter(Boolean).sort();

  const shaTable = shas.map((s) => {
    const i = items.filter((r) => r.last_verified_sha === s).map((r) => r.work_item_id);
    const c = screens.filter((r) => r.last_verified_sha === s).map((r) => r.screen_id);
    const parts = [];
    if (i.length) parts.push(`${i.length} work item${i.length === 1 ? "" : "s"}`);
    if (c.length) parts.push(`${c.length} screen${c.length === 1 ? "" : "s"}`);
    return `| \`${s}\` | ${parts.join(", ")} | ${[...i, ...c].join(", ")} |`;
  });

  const open = items
    .filter((r) => ["partial", "placeholder_only", "not_started", "blocked"].includes(r.status))
    .map((r) => `| \`${r.work_item_id}\` | ${r.status} | ${r.title} |`);

  const placeholders = screens
    .filter((r) => r.implementation_status === "placeholder_only")
    .map((r) => r.screen_id);

  const blocked = items
    .filter((r) => r.blocker_or_deferment.trim())
    .map((r) => `| \`${r.work_item_id}\` | ${r.blocker_or_deferment.replace(/\|/g, "\\|")} |`);

  return `# Couranr — implementation status

**GENERATED FILE — DO NOT EDIT.** Rendered by \`npm run governance:generate\`
from \`IMPLEMENTATION_LEDGER.csv\`, \`SCREEN_IMPLEMENTATION_LEDGER.csv\`,
\`ui_screen_registry.json\` and a scan of \`app/\` and \`supabase/\`.

Every number here is counted at render time. Nothing is restated from a commit
message, a plan, or an earlier report — and nothing here is authority. The
ledgers own per-item state; this is their sum.

The 721-line hand-written version of this file is preserved whole at
[\`autonomous-evidence/status-archive/IMPLEMENTATION_STATUS-2026-08-06.md\`](./autonomous-evidence/status-archive/IMPLEMENTATION_STATUS-2026-08-06.md).
It restated per-row evidence the ledgers already carried, and the restatement is
what went stale: it counted 39 migrations while ${countOf("supabase/migrations", ".sql")} were on disk.

## Where truth lives

| Domain | Source |
|---|---|
| Authority topology | [\`authority/AUTHORITY_MANIFEST.json\`](./authority/AUTHORITY_MANIFEST.json) |
| Product decisions | [\`02_DECISION_REGISTRY.json\`](../../02_DECISION_REGISTRY.json) |
| Screens and routes | [\`ui_screen_registry.json\`](../../ui_screen_registry.json) |
| Visual sources and composition | [\`ui-reference/VISUAL_REGISTRY.json\`](./ui-reference/VISUAL_REGISTRY.json) |
| Work-item state | [\`IMPLEMENTATION_LEDGER.csv\`](./IMPLEMENTATION_LEDGER.csv) |
| Screen state | [\`SCREEN_IMPLEMENTATION_LEDGER.csv\`](./SCREEN_IMPLEMENTATION_LEDGER.csv) |

Run \`npm run governance:facts\` for the live counts; \`npm run check:governance\`
proves every generated view matches its source.

## Work items — ${items.length} total

| Status | Count |
|---|---|
${tally(items, "status").map(([k, v]) => `| \`${k}\` | ${v} |`).join("\n")}

## Screens — ${screens.length} rows against ${src.screens.length} canonical screens

| Status | Count |
|---|---|
${tally(screens, "implementation_status").map(([k, v]) => `| \`${k}\` | ${v} |`).join("\n")}

${placeholders.length ? `Still rendering \`ScreenPlaceholder\` (${placeholders.length}): ${placeholders.map((p) => `\`${p}\``).join(" · ")}.` : "No screen renders a placeholder."}

## Measured repository state

| | count |
|---|---|
| Page routes | ${routes.pages} |
| …canonical, under \`app/(couranr)\` | ${routes.canonicalPages} |
| …legacy | ${routes.pages - routes.canonicalPages} |
| API routes | ${routes.apis} |
| …canonical, under \`app/api/couranr\` | ${routes.canonicalApis} |
| …legacy | ${routes.apis - routes.canonicalApis} |
| Forward migrations | ${countOf("supabase/migrations", ".sql")} |
| Paired rollbacks | ${countOf("supabase/rollbacks", ".sql")} |
| Canonical screens | ${src.screens.length} |
| …Core | ${src.screens.filter((s) => s.tier === "Core").length} |
| …MVP-complete | ${src.screens.filter((s) => s.tier === "MVP-complete").length} |

## Open work items

${open.length ? `| Item | Status | Title |\n|---|---|---|\n${open.join("\n")}` : "None."}

## Recorded blockers and deferments

${blocked.length ? `| Item | Blocker or deferment |\n|---|---|\n${blocked.join("\n")}` : "None recorded."}

## Verification SHAs

One row per distinct \`last_verified_sha\` in either ledger. What was verified at
each is in the ledger row itself — \`test_evidence\`, \`browser_verified\` and
\`repository_evidence\` — and is deliberately not restated here.

| SHA | covers | rows |
|---|---|---|
${shaTable.join("\n")}
`;
}

export const STATUS_OUTPUT = { path: STATUS, render: () => renderStatus() };

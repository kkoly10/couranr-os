/**
 * `lib/couranr/screens.ts` — the runtime screen list, generated.
 *
 * It was hand-maintained, and it had drifted from BOTH of its authorities:
 *
 *   - topology (id, name, group, routes, tier, phase, viewport) belongs to
 *     `ui_screen_registry.json`. That half happened to still agree, verified
 *     field by field across all 66 rows before this generator replaced it.
 *   - `implemented` is implementation STATE and belongs to
 *     `SCREEN_IMPLEMENTATION_LEDGER.csv`. That half disagreed on **15 of 66**
 *     screens — eight the ledger calls `functional_verified` were flagged
 *     `implemented: false`, and `partial` and `functional_unverified` rows were
 *     flagged inconsistently in both directions. `tests/couranr-screens.test.ts`
 *     even carried a comment admitting "the flags had lagged the screen ledger",
 *     and then pinned the lagging list as an expectation.
 *
 * A boolean cannot carry a five-value vocabulary, so the generated record now
 * carries `status` verbatim from the ledger and derives `implemented` from it.
 * `partial`, `placeholder_only` and `missing` are not implemented; a screen has
 * to be functional to count, verified or not.
 *
 * The module is a build-time projection, not a runtime CSV read: `navigation.ts`
 * and the internal preview page import it into the Next bundle.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./screenRegistry.mjs";

export const SCREENS_MODULE = "lib/couranr/screens.ts";
export const SCREEN_LEDGER = "docs/couranr-mvp/SCREEN_IMPLEMENTATION_LEDGER.csv";

const GROUP = {
  Public: "public", Merchant: "merchant", Driver: "driver",
  Operations: "operations", Customer: "customer",
};
const TIER = { Core: "core", "MVP-complete": "mvp-complete" };
const VIEWPORT = {
  Responsive: "responsive",
  "Mobile-first responsive": "mobile-first",
  "Desktop-first responsive": "desktop-first",
  "Mobile primary": "mobile-primary",
  "Desktop primary": "desktop-primary",
};

/** Ledger statuses that mean the screen is BUILT, not stubbed. */
export const IMPLEMENTED_STATUSES = ["functional_verified", "functional_unverified"];

/** Minimal RFC4180 reader — the ledger's prose cells contain commas. */
function readLedger() {
  const text = readFileSync(join(ROOT, SCREEN_LEDGER), "utf8");
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
  const out = new Map();
  for (const r of data.slice(1)) {
    const o = Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""]));
    out.set(o.screen_id, o.implementation_status);
  }
  return out;
}

const lit = (s) => JSON.stringify(s);

export function renderScreensModule(src) {
  const ledger = readLedger();
  const missing = src.screens.filter((s) => !ledger.has(s.id)).map((s) => s.id);
  if (missing.length) {
    throw new Error(
      `${SCREEN_LEDGER} has no row for ${missing.join(", ")} — the runtime screen ` +
        `list cannot be generated while a canonical screen has no implementation state`,
    );
  }

  const statuses = [...new Set([...ledger.values()])].sort();
  const rows = src.screens.map((s) => {
    const group = GROUP[s.surface];
    const tier = TIER[s.tier];
    const viewport = VIEWPORT[s.viewport];
    for (const [what, v, raw] of [["surface", group, s.surface], ["tier", tier, s.tier], ["viewport", viewport, s.viewport]]) {
      if (!v) throw new Error(`${s.id}: no runtime mapping for ${what} ${JSON.stringify(raw)}`);
    }
    return (
      `  { id: ${lit(s.id)}, name: ${lit(s.name)}, group: ${lit(group)}, ` +
      `routes: [${s.routes.map(lit).join(", ")}], tier: ${lit(tier)}, ` +
      `phase: ${lit(s.phase)}, viewport: ${lit(viewport)}, status: ${lit(ledger.get(s.id))} },`
    );
  });

  return `/**
 * Canonical MVP screen registry — the runtime view.
 *
 * GENERATED FILE — DO NOT EDIT. Run \`npm run governance:generate\`.
 *
 * Two authorities, one projection:
 *
 *   - topology (id, name, group, routes, tier, phase, viewport) comes from
 *     \`ui_screen_registry.json\`, the writable source for screen topology;
 *   - \`status\` comes from \`docs/couranr-mvp/SCREEN_IMPLEMENTATION_LEDGER.csv\`,
 *     the writable source for screen implementation state.
 *
 * This file used to be hand-maintained with a hand-maintained \`implemented\`
 * boolean, and that boolean disagreed with the ledger on 15 of 66 screens.
 * \`implemented\` is now derived — it is true for ${IMPLEMENTED_STATUSES.join(" and ")}
 * and false for everything else — and \`status\` is carried through so a consumer
 * that needs the distinction is not forced to flatten it.
 *
 * The registry controls WHICH screens are MVP and their routes and states. It
 * does NOT control pricing, policy, permissions, state transitions or copy —
 * when a canonical image and a written spec disagree, the written specification
 * wins and the mock is corrected.
 */

export type ScreenGroup =
${Object.values(GROUP).map((g, i) => `  ${i === 0 ? "|" : "|"} ${lit(g)}`).join("\n")};

export type ScreenTier = ${Object.values(TIER).map(lit).join(" | ")};

export type ScreenViewport =
${Object.values(VIEWPORT).map((v) => `  | ${lit(v)}`).join("\n")};

/** The screen ledger's closed status vocabulary, as used by these screens. */
export type ScreenStatus =
${statuses.map((s) => `  | ${lit(s)}`).join("\n")};

export type CanonicalScreen = {
  id: string;
  name: string;
  group: ScreenGroup;
  /** One entry per route the registry lists for this screen. */
  routes: string[];
  tier: ScreenTier;
  /** Implementation phase from the screen registry. */
  phase: string;
  viewport: ScreenViewport;
  /** Verbatim from the screen implementation ledger. */
  status: ScreenStatus;
};

const SCREENS: CanonicalScreen[] = [
${rows.join("\n")}
];

/** Ledger statuses that mean the screen is BUILT rather than stubbed. */
export const IMPLEMENTED_STATUSES: ScreenStatus[] = [
${IMPLEMENTED_STATUSES.map((s) => `  ${lit(s)},`).join("\n")}
];

export function isImplemented(screen: CanonicalScreen): boolean {
  return IMPLEMENTED_STATUSES.includes(screen.status);
}

export const CANONICAL_SCREENS: (CanonicalScreen & { implemented: boolean })[] =
  SCREENS.map((s) => ({ ...s, implemented: isImplemented(s) }));

export const SCREEN_COUNT = CANONICAL_SCREENS.length;

export function screensByGroup(group: ScreenGroup) {
  return CANONICAL_SCREENS.filter((s) => s.group === group);
}

export function getScreen(id: string) {
  return CANONICAL_SCREENS.find((s) => s.id === id);
}

/** Core screens are required before the production canary. */
export function coreScreens() {
  return CANONICAL_SCREENS.filter((s) => s.tier === "core");
}

/** Every distinct canonical route across all screens. */
export function canonicalRoutes(): string[] {
  return Array.from(new Set(CANONICAL_SCREENS.flatMap((s) => s.routes))).sort();
}

/**
 * Progress against the screen ledger, not against a hand-kept flag.
 * Reported by the internal preview route; never surfaced publicly.
 */
export function implementationProgress() {
  const done = CANONICAL_SCREENS.filter((s) => s.implemented).length;
  const byStatus: Record<string, number> = {};
  for (const s of CANONICAL_SCREENS) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
  return {
    total: SCREEN_COUNT,
    implemented: done,
    remaining: SCREEN_COUNT - done,
    coreTotal: coreScreens().length,
    coreImplemented: coreScreens().filter((s) => s.implemented).length,
    byStatus,
  };
}
`;
}

export const SCREENS_MODULE_OUTPUT = { path: SCREENS_MODULE, render: renderScreensModule };

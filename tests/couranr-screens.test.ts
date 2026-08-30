import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CANONICAL_SCREENS,
  SCREEN_COUNT,
  canonicalRoutes,
  coreScreens,
  getScreen,
  implementationProgress,
  screensByGroup,
} from "@/lib/couranr/screens";

const ROOT = path.join(__dirname, "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const SOURCE = JSON.parse(read("ui_screen_registry.json"));
const LEDGER = read("docs/couranr-mvp/SCREEN_IMPLEMENTATION_LEDGER.csv");
/* The EFFECTIVE classification decision, not CLS-001 by name: CLS-002 amends its
   counts to 68/64/4 and CLS-001 is preserved as the historical sixty-six-screen
   record. Naming the id here would either pin the old counts or force the
   amendment to overwrite the history it exists to keep. */
const DECISIONS = JSON.parse(read("02_DECISION_REGISTRY.json")).decisions;
const CLASSIFICATION = DECISIONS.filter(
  (r: { category: string; status: string }) =>
    r.category === "canonical/deferred/archive classification" && r.status === "decided",
);
const AMENDED = new Set(
  CLASSIFICATION.flatMap((r: { amends?: string | string[] }) =>
    Array.isArray(r.amends) ? r.amends : r.amends ? [r.amends] : [],
  ),
);
const EFFECTIVE = CLASSIFICATION.filter((r: { id: string }) => !AMENDED.has(r.id));
const CLS = EFFECTIVE[0];

type SourceScreen = { id: string; surface: string; tier: string; routes: string[] };
const sourceScreens: SourceScreen[] = SOURCE.screens;

/**
 * `lib/couranr/screens.ts` is GENERATED from `ui_screen_registry.json` plus the
 * screen ledger. These assert the projection, not a remembered snapshot of it.
 *
 * Every count here used to be a literal — 66, 11/16/10/21/8, 62/4, and a
 * 26-entry list of implemented ids. Phase D moves all of them at once, and a
 * literal in a test is one more place that has to be found. §5 of the authority
 * consolidation work order names this specifically.
 */
describe("canonical screen registry", () => {
  it("registers exactly the screens the source declares", () => {
    expect(SCREEN_COUNT).toBe(sourceScreens.length);
    expect(CANONICAL_SCREENS.map((s) => s.id)).toEqual(sourceScreens.map((s) => s.id));
  });

  it("matches the per-surface counts in the source", () => {
    const bySurface = (surface: string) =>
      sourceScreens.filter((s) => s.surface === surface).length;
    expect(screensByGroup("public")).toHaveLength(bySurface("Public"));
    expect(screensByGroup("merchant")).toHaveLength(bySurface("Merchant"));
    expect(screensByGroup("driver")).toHaveLength(bySurface("Driver"));
    expect(screensByGroup("operations")).toHaveLength(bySurface("Operations"));
    expect(screensByGroup("customer")).toHaveLength(bySurface("Customer"));
    /* A mapping that dropped a surface would leave every bucket at 0 and pass
       the five assertions above without noticing. */
    expect(
      screensByGroup("public").length +
        screensByGroup("merchant").length +
        screensByGroup("driver").length +
        screensByGroup("operations").length +
        screensByGroup("customer").length,
    ).toBe(sourceScreens.length);
  });

  it("has exactly one un-amended classification decision to reconcile against", () => {
    expect(EFFECTIVE.map((r: { id: string }) => r.id)).toHaveLength(1);
    expect(AMENDED.size).toBeGreaterThan(0);
  });

  it("reconciles the tier split to the governing classification decision", () => {
    const core = sourceScreens.filter((s) => s.tier === "Core").length;
    const complete = sourceScreens.filter((s) => s.tier === "MVP-complete").length;
    expect(coreScreens()).toHaveLength(core);
    expect(CANONICAL_SCREENS.filter((s) => s.tier === "mvp-complete")).toHaveLength(complete);
    expect(CLS.value.canonical_screens).toBe(sourceScreens.length);
    expect(CLS.value.core).toBe(core);
    expect(CLS.value.mvp_complete).toBe(complete);
  });

  it("uses unique screen ids", () => {
    const ids = CANONICAL_SCREENS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every screen at least one route", () => {
    for (const s of CANONICAL_SCREENS) {
      expect(s.routes.length).toBeGreaterThan(0);
      for (const r of s.routes) {
        expect(r.startsWith("/")).toBe(true);
      }
    }
  });

  it("carries the canonical auth route names, not the legacy ones", () => {
    const routes = canonicalRoutes();
    expect(routes).toContain("/sign-in");
    expect(routes).toContain("/sign-up");
    // The legacy routes are /login and /signup; they are not canonical.
    expect(routes).not.toContain("/login");
    expect(routes).not.toContain("/signup");
  });

  it("keeps the registry's multi-route screens intact", () => {
    /* Derived from the source rather than typed, because LEG-004 added `/send`
       to PUB-004's family and a literal here would have had to be found. The
       assertion that matters is that a multi-route screen keeps ALL its routes
       in the source's order — a projection that took only the first would still
       satisfy every count in this file. */
    const multi = sourceScreens.filter((s) => s.routes.length > 1);
    expect(multi.length).toBeGreaterThan(1);
    for (const s of multi) {
      expect(getScreen(s.id)?.routes, `${s.id} routes`).toEqual(s.routes);
    }
    expect(getScreen("PUB-004")?.routes[0]).toBe("/send");
  });

  it("records the MVP-complete screens CLS-001 names, by id", () => {
    const ids = CANONICAL_SCREENS.filter((s) => s.tier === "mvp-complete")
      .map((s) => s.id)
      .sort();
    expect(ids).toEqual([...CLS.value.mvp_complete_ids].sort());
    expect(ids.length).toBeGreaterThan(0);
  });

  /**
   * `implemented` is DERIVED from the screen ledger now — true for
   * `functional_verified` and `functional_unverified`, false for `partial`,
   * `placeholder_only` and `missing`.
   *
   * It used to be a hand-kept boolean, and this test used to pin the resulting
   * 26 ids as a literal list. The boolean disagreed with the ledger on 15 of 66
   * screens — eight of them `functional_verified` and flagged false — and the
   * comment above the list said as much ("the flags had lagged the screen
   * ledger") while the list kept the lag pinned.
   */
  it("derives `implemented` from the ledger, row by row", () => {
    const status = new Map<string, string>();
    {
      /* A real RFC4180 read. A naive split on "," picks up a page path out of a
         quoted prose cell — which is exactly what the first draft of this test
         did, and it reported "app/(couranr)/operations/settings/page.tsx" as a
         status. */
      const rows: string[][] = [];
      let row: string[] = [], field = "", quoted = false;
      for (let i = 0; i < LEDGER.length; i++) {
        const c = LEDGER[i];
        if (quoted) {
          if (c === '"') {
            if (LEDGER[i + 1] === '"') { field += '"'; i++; } else quoted = false;
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
      const idCol = header.indexOf("screen_id");
      const statusCol = header.indexOf("implementation_status");
      expect(idCol).toBeGreaterThanOrEqual(0);
      expect(statusCol).toBeGreaterThanOrEqual(0);
      for (const r of data.slice(1)) status.set(r[idCol], r[statusCol]);
    }
    expect(status.size).toBe(SCREEN_COUNT);
    for (const s of CANONICAL_SCREENS) {
      expect(s.status, `${s.id} status`).toBe(status.get(s.id));
      expect(s.implemented, `${s.id} implemented`).toBe(
        s.status === "functional_verified" || s.status === "functional_unverified",
      );
    }
  });

  /* The invariant that matters and cannot be restated as a count: a screen the
     ledger calls a placeholder is never reported as implemented. This is the
     assertion the old literal list existed to protect. */
  it("never reports a placeholder, partial or missing screen as implemented", () => {
    const wrong = CANONICAL_SCREENS.filter(
      (s) => s.implemented && ["placeholder_only", "partial", "missing", "static_only"].includes(s.status),
    );
    expect(wrong.map((s) => `${s.id}:${s.status}`)).toEqual([]);
  });

  it("reports progress consistent with the ledger's own totals", () => {
    const p = implementationProgress();
    expect(p.total).toBe(SCREEN_COUNT);
    expect(p.implemented + p.remaining).toBe(p.total);
    expect(p.implemented).toBe(CANONICAL_SCREENS.filter((s) => s.implemented).length);
    expect(p.coreTotal).toBe(coreScreens().length);
    expect(p.coreImplemented).toBe(coreScreens().filter((s) => s.implemented).length);
    expect(Object.values(p.byStatus).reduce((a, b) => a + b, 0)).toBe(p.total);
    /* A projection that marked everything implemented would satisfy the
       arithmetic above. The ledger says some screens are placeholders. */
    expect(p.implemented).toBeLessThan(p.total);
    expect(p.implemented).toBeGreaterThan(0);
  });

  /**
   * OPS-002 declares two routes. Only `/operations/queue` is built; the second
   * is still a placeholder, so it is asserted here rather than silently implied
   * by the flag.
   */
  it("OPS-002 is built at /operations/queue only", () => {
    const ops = getScreen("OPS-002");
    expect(ops?.routes).toEqual(["/operations/queue", "/operations/deliveries"]);
  });

  it("returns undefined for an unknown id", () => {
    expect(getScreen("NOPE-999")).toBeUndefined();
  });
});

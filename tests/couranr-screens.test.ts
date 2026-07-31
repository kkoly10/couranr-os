import { describe, expect, it } from "vitest";
import {
  CANONICAL_SCREENS,
  SCREEN_COUNT,
  canonicalRoutes,
  coreScreens,
  getScreen,
  implementationProgress,
  screensByGroup,
} from "@/lib/couranr/screens";

/**
 * These assert the screen map against UI_SCREEN_REGISTRY.md §4. If someone
 * regenerates or hand-edits the map and drops a screen, this fails.
 */
describe("canonical screen registry", () => {
  it("registers all 66 canonical MVP screens", () => {
    expect(SCREEN_COUNT).toBe(66);
    expect(CANONICAL_SCREENS).toHaveLength(66);
  });

  it("matches the per-group counts in the registry", () => {
    expect(screensByGroup("public")).toHaveLength(11);
    expect(screensByGroup("merchant")).toHaveLength(16);
    expect(screensByGroup("driver")).toHaveLength(10);
    expect(screensByGroup("operations")).toHaveLength(21);
    expect(screensByGroup("customer")).toHaveLength(8);
  });

  it("has 62 Core screens and 4 MVP-complete", () => {
    expect(coreScreens()).toHaveLength(62);
    expect(CANONICAL_SCREENS.filter((s) => s.tier === "mvp-complete")).toHaveLength(4);
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
    // PUB-004 is listed as "/estimate and /request/[merchantSlug]".
    expect(getScreen("PUB-004")?.routes).toEqual([
      "/estimate",
      "/request/[merchantSlug]",
    ]);
    // OPS-002 is "/operations/queue and /operations/deliveries".
    expect(getScreen("OPS-002")?.routes).toEqual([
      "/operations/queue",
      "/operations/deliveries",
    ]);
  });

  it("records the four MVP-complete screens by id", () => {
    const ids = CANONICAL_SCREENS.filter((s) => s.tier === "mvp-complete")
      .map((s) => s.id)
      .sort();
    expect(ids).toEqual(["OPS-014", "OPS-017", "OPS-018", "OPS-021"]);
  });

  /**
   * `implemented` means the screen is BUILT, not that a placeholder exists for
   * it. The count is asserted against the explicit id list so a placeholder
   * cannot be marked implemented without this failing.
   */
  it("reports honest progress — only the built screens are marked implemented", () => {
    const built = CANONICAL_SCREENS.filter((s) => s.implemented)
      .map((s) => s.id)
      .sort();
    expect(built).toEqual([
      "MER-002",
      "MER-005",
      "MER-006",
      "MER-007",
      "OPS-002",
      "PUB-003",
    ]);

    const p = implementationProgress();
    expect(p.total).toBe(66);
    expect(p.implemented).toBe(6);
    expect(p.remaining).toBe(60);
    expect(p.coreTotal).toBe(62);
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

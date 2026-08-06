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
      // PUB-005 and CUS-005 are the same route; CUS-005 is it at
      // ?mode=requote. Both ship with the payment authorization slice.
      "CUS-005",
      // MER-001 and MER-004 are the B03 dashboard and deliveries list —
      // compositions of existing endpoints.
      "MER-001",
      "MER-002",
      "MER-004",
      "MER-005",
      "MER-006",
      "MER-007",
      // MER-014 and MER-015 are the B03 settings and team screens; MER-015
      // brings the team-management capability that did not previously exist.
      "MER-014",
      "MER-015",
      "OPS-002",
      // OPS-003's review workspace ships with Commit O. Managed dispatch —
      // vehicle, driver and schedule selection — is still absent, so the flag
      // covers the review outcomes only.
      "OPS-003",
      // PUB-001 and PUB-008..011 are the B02 public launch surface; PUB-007 is
      // the Phase 8 Delivery Help page. All six were browser-verified before
      // these flags caught up — the flags had lagged the screen ledger.
      "PUB-001",
      "PUB-002",
      "PUB-003",
      "PUB-005",
      "PUB-007",
      "PUB-008",
      "PUB-009",
      "PUB-010",
      "PUB-011",
    ]);

    const p = implementationProgress();
    expect(p.total).toBe(66);
    expect(p.implemented).toBe(20);
    expect(p.remaining).toBe(46);
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

import { describe, expect, it } from "vitest";
import {
  ROUTE_COLLISIONS,
  activeNavItem,
  isActiveRoute,
  merchantSettingsNav,
  navigationFor,
  shellForPath,
  type ShellRole,
} from "@/lib/couranr/navigation";
import { CANONICAL_SCREENS, getScreen } from "@/lib/couranr/screens";

/**
 * Segment-aware prefix test. A raw `startsWith` is wrong here: "/businesses"
 * (PUB-009, a public marketing page) starts with the string "/business" but is
 * NOT inside the merchant area. Route ownership is about path segments.
 */
function inArea(path: string, area: string): boolean {
  return path === area || path.startsWith(area + "/");
}

const ROLES: ShellRole[] = [
  "public",
  "customer",
  "merchant",
  "driver",
  "operations",
];

/**
 * Role isolation is the security-shaped property of the shells: a merchant
 * shell must not be able to link into Operations, and vice versa. It is a
 * consequence of deriving navigation from the registry by surface, and these
 * tests hold that derivation to it.
 */
describe("role isolation", () => {
  it("gives every nav item a screen that belongs to that role's surface", () => {
    const expected: Record<string, string> = {
      public: "public",
      merchant: "merchant",
      driver: "driver",
      operations: "operations",
    };

    for (const role of ["public", "merchant", "driver", "operations"] as const) {
      for (const item of navigationFor(role)) {
        const screen = getScreen(item.screenId);
        expect(screen, `${item.screenId} must exist in the registry`).toBeDefined();
        expect(screen!.group).toBe(expected[role]);
      }
    }
  });

  it("never lets one role's navigation reach another role's route prefix", () => {
    const prefixes: Record<string, string> = {
      merchant: "/business",
      driver: "/driver",
      operations: "/operations",
    };

    for (const [role, ownPrefix] of Object.entries(prefixes)) {
      const items = navigationFor(role as ShellRole);
      expect(items.length).toBeGreaterThan(0);

      for (const item of items) {
        expect(inArea(item.href, ownPrefix)).toBe(true);

        for (const [otherRole, otherPrefix] of Object.entries(prefixes)) {
          if (otherRole === role) continue;
          expect(inArea(item.href, otherPrefix)).toBe(false);
        }
      }
    }
  });

  it("keeps public navigation out of every authenticated area", () => {
    for (const item of navigationFor("public")) {
      expect(inArea(item.href, "/business")).toBe(false);
      expect(inArea(item.href, "/driver")).toBe(false);
      expect(inArea(item.href, "/operations")).toBe(false);
    }
    // Guards the distinction the check above depends on.
    expect(navigationFor("public").map((i) => i.href)).toContain("/businesses");
  });

  /**
   * All eight CUS screens are token-scoped fragments of /pay, /track and /help,
   * and §3 makes customer accounts optional — so there is no authenticated
   * customer navigation to build. Returning an empty list is the correct
   * answer, not a gap.
   */
  it("returns no navigation for the token-scoped customer shell", () => {
    expect(navigationFor("customer")).toEqual([]);
  });

  it("produces navigation for every role that has any", () => {
    for (const role of ROLES) {
      const items = navigationFor(role);
      if (role === "customer") continue;
      expect(items.length, `${role} should have navigation`).toBeGreaterThan(0);
    }
  });

  it("gives every nav item a non-empty label and an absolute href", () => {
    for (const role of ROLES) {
      for (const item of navigationFor(role)) {
        expect(item.label.trim().length).toBeGreaterThan(0);
        expect(item.href.startsWith("/")).toBe(true);
      }
    }
  });

  it("uses unique hrefs within a role", () => {
    for (const role of ROLES) {
      const hrefs = navigationFor(role).map((i) => i.href);
      expect(new Set(hrefs).size).toBe(hrefs.length);
    }
  });
});

describe("navigation omits routes a legacy page already occupies", () => {
  it("records both known collisions", () => {
    const routes = ROUTE_COLLISIONS.map((c) => c.route).sort();
    // /driver was here until DRV-001 was resolved: app/(couranr)/driver/ now
    // owns every /driver route under DriverShell + SurfaceGuard, so it is no
    // longer a collision and IS reachable from driver navigation.
    expect(routes).toEqual(["/"]);
  });

  it("does not link to a colliding route from any shell", () => {
    const colliding = new Set(ROUTE_COLLISIONS.map((c) => c.route));
    for (const role of ROLES) {
      for (const item of navigationFor(role)) {
        expect(colliding.has(item.href)).toBe(false);
      }
    }
  });

  it("still references the screens those routes belong to", () => {
    for (const c of ROUTE_COLLISIONS) {
      expect(getScreen(c.screenId)).toBeDefined();
    }
  });
});

describe("active route derivation", () => {
  it("matches a section root only exactly", () => {
    const root = { href: "/business", exact: true };
    expect(isActiveRoute("/business", root)).toBe(true);
    expect(isActiveRoute("/business/deliveries", root)).toBe(false);
  });

  it("matches a non-root item on itself and its descendants", () => {
    const item = { href: "/business/deliveries" };
    expect(isActiveRoute("/business/deliveries", item)).toBe(true);
    expect(isActiveRoute("/business/deliveries/new", item)).toBe(true);
    expect(isActiveRoute("/business/deliveries/abc-123", item)).toBe(true);
    expect(isActiveRoute("/business/customers", item)).toBe(false);
  });

  it("does not treat a shared prefix as a match", () => {
    // /business/deliveries must not light up for /business/deliveries-archive
    expect(isActiveRoute("/business/deliveries-archive", { href: "/business/deliveries" })).toBe(
      false
    );
  });

  it("tolerates trailing slashes and empty pathnames", () => {
    expect(isActiveRoute("/business/", { href: "/business", exact: true })).toBe(true);
    expect(isActiveRoute(null, { href: "/business", exact: true })).toBe(false);
    expect(isActiveRoute(undefined, { href: "/business", exact: true })).toBe(false);
    expect(isActiveRoute("", { href: "/", exact: true })).toBe(true);
  });

  it("selects exactly one active item, longest match winning", () => {
    const items = navigationFor("merchant");
    const active = activeNavItem("/business/deliveries/new", items);
    expect(active?.href).toBe("/business/deliveries");

    const dashboard = activeNavItem("/business", items);
    expect(dashboard?.href).toBe("/business");
  });

  it("returns undefined when nothing matches", () => {
    expect(activeNavItem("/nowhere", navigationFor("merchant"))).toBeUndefined();
  });

  it("keeps merchant settings sub-navigation distinct", () => {
    const sub = merchantSettingsNav();
    expect(activeNavItem("/business/settings", sub)?.screenId).toBe("MER-014");
    expect(activeNavItem("/business/settings/team", sub)?.screenId).toBe("MER-015");
    expect(activeNavItem("/business/settings/billing", sub)?.screenId).toBe("MER-016");
  });
});

describe("shell ownership of a path", () => {
  it("routes each prefix to its own shell", () => {
    expect(shellForPath("/")).toBe("public");
    expect(shellForPath("/pricing")).toBe("public");
    expect(shellForPath("/business")).toBe("merchant");
    expect(shellForPath("/business/deliveries/new")).toBe("merchant");
    expect(shellForPath("/driver")).toBe("driver");
    expect(shellForPath("/driver/messages")).toBe("driver");
    expect(shellForPath("/operations/queue")).toBe("operations");
  });

  it("treats every token-scoped route as the customer shell", () => {
    expect(shellForPath("/pay/abc")).toBe("customer");
    expect(shellForPath("/track/abc")).toBe("customer");
    expect(shellForPath("/help/abc")).toBe("customer");
  });

  it("does not mistake a similarly named public route for a role area", () => {
    // /businesses (PUB-009) is public and must not resolve to the merchant shell.
    expect(shellForPath("/businesses")).toBe("public");
  });
});

describe("navigation states no unresolved product decision", () => {
  /**
   * Commit E must not hard-code pricing, mileage, hours, markets, payer,
   * refund or payment behaviour — all of it is unresolved until the Decision
   * Registry exists.
   */
  /**
   * The rule is that no decision-dependent VALUE is hard-coded. Naming a
   * registered screen is fine — "Refunds" is OPS-011's registry name, and
   * "Payments" is OPS-009's. What must never appear is a number, a currency
   * amount, a clock time or a named market, because each of those is a locked
   * product decision that does not exist yet.
   */
  const FORBIDDEN = [
    /\d/,                       // any numeric value at all
    /[$€£]/,
    /per[- ]mile/i,
    /\bstafford\b/i,
    /\bwoodbridge\b/i,
    /\bfredericksburg\b/i,
    /\bwashington,?\s*dc\b/i,
    /\bovernight\b/i,
    /\bsame[- ]day\b/i,
    /\bcutoff\b/i,
    /\bguarantee/i,
    /\b24\/7\b/i,
  ];

  it("has no forbidden token in any navigation label", () => {
    for (const role of ROLES) {
      for (const item of navigationFor(role)) {
        for (const rx of FORBIDDEN) {
          expect(
            rx.test(item.label),
            `nav label "${item.label}" matched ${rx}`
          ).toBe(false);
        }
      }
    }
  });

  it("keeps registry screen names as the source of navigation vocabulary", () => {
    // Every nav destination corresponds to a real registered screen.
    const ids = new Set(CANONICAL_SCREENS.map((s) => s.id));
    for (const role of ROLES) {
      for (const item of navigationFor(role)) {
        expect(ids.has(item.screenId)).toBe(true);
      }
    }
  });
});

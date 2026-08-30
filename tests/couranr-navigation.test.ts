import { describe, expect, it } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
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

const ROOT = path.join(__dirname, "..");

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
      merchant: "/app/business",
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
      expect(inArea(item.href, "/app/business")).toBe(false);
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

/* The LEG-004 route shim is GONE. It existed only while the canonical merchant
   routes had no pages; V10 moved the tree to app/(couranr)/app/business/** and
   navigation reads the canonical route directly again. What replaces the shim's
   self-retiring guard is the assertion below: every navigation href must resolve
   to a page that actually exists on disk. That is the property the shim was
   protecting, stated directly instead of through an indirection. */
describe("every navigation destination is a real page", () => {
  /**
   * Every page.tsx under app/, keyed by the URL it actually serves.
   *
   * Route GROUPS — the `(name)` segments — are organizational and do not appear
   * in the URL, so they are stripped. Resolving by joining a fixed prefix would
   * miss `app/(couranr)/(public)/(business-public)/business/page.tsx` entirely,
   * which is the shape V10's chrome architecture introduces.
   */
  function routeIndex() {
    const index = new Map();
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === "page.tsx") {
          const segments = path
            .relative(path.join(ROOT, "app"), path.dirname(full))
            .split(path.sep)
            .filter((s) => s && !(s.startsWith("(") && s.endsWith(")")));
          index.set(`/${segments.join("/")}`.replace(/\/$/, "") || "/", full);
        }
      }
    };
    walk(path.join(ROOT, "app"));
    return index;
  }
  const ROUTES = routeIndex();

  /** /app/business/settings/team -> that route's page file, or null. */
  function pageFileFor(href) {
    const clean = href.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
    return ROUTES.get(clean) ?? null;
  }

  it("resolves every role's navigation hrefs to page files that exist", () => {
    const dead = [];
    for (const role of ROLES) {
      for (const item of navigationFor(role)) {
        if (!pageFileFor(item.href)) dead.push(`${role}/${item.screenId} -> ${item.href}`);
      }
    }
    expect(dead).toEqual([]);
  });

  it("resolves merchant settings sub-navigation to page files that exist", () => {
    const dead = merchantSettingsNav()
      .filter((i) => !pageFileFor(i.href))
      .map((i) => `${i.screenId} -> ${i.href}`);
    expect(dead).toEqual([]);
  });

  /* A resolver that finds nothing would make both assertions vacuously true. */
  it("POSITIVE CONTROL: the page resolver rejects a route with no file", () => {
    expect(pageFileFor("/app/business")).toBeTruthy();
    expect(pageFileFor("/app/business/does-not-exist")).toBeNull();
  });
});

describe("section roots are derived, not counted", () => {
  /* The old rule was `segments <= 1`, which encoded the accident that every
     section root was one segment deep. The LEG-004 move to `/app/business`
     broke it silently: the dashboard stopped being exact and lit up on every
     merchant page. These assert the PROPERTY instead of the old arithmetic. */
  it("marks an item exact exactly when another item nests under it", () => {
    for (const role of ROLES) {
      const items = navigationFor(role);
      const hrefs = items.map((i) => i.href);
      for (const item of items) {
        const hasChild = hrefs.some((h) => h !== item.href && h.startsWith(`${item.href}/`));
        expect(Boolean(item.exact), `${role}/${item.screenId} (${item.href})`).toBe(hasChild);
      }
    }
  });

  /* Not every surface puts its root in the nav — DRV-001 is reached by the
     wordmark, not a nav item — so this asserts the roots that ARE nav
     destinations, and asserts that at least one exists so it cannot pass by
     finding none. */
  it("keeps the section roots that ARE nav destinations exact, whatever their depth", () => {
    const roots = { merchant: "/app/business", operations: "/operations" };
    for (const [role, root] of Object.entries(roots)) {
      const item = navigationFor(role as ShellRole).find((i) => i.href === root);
      expect(item, `${role} has no nav item for its root ${root}`).toBeTruthy();
      expect(item!.exact, `${root} must be exact or it lights up for every child`).toBe(true);
    }
  });

  it("does not light a section root on one of its children", () => {
    const items = navigationFor("merchant");
    expect(activeNavItem("/app/business/deliveries", items)?.href).toBe("/app/business/deliveries");
    expect(activeNavItem("/app/business", items)?.href).toBe("/app/business");
  });
});

describe("active route derivation", () => {
  it("matches a section root only exactly", () => {
    const root = { href: "/app/business", exact: true };
    expect(isActiveRoute("/app/business", root)).toBe(true);
    expect(isActiveRoute("/app/business/deliveries", root)).toBe(false);
  });

  it("matches a non-root item on itself and its descendants", () => {
    const item = { href: "/app/business/deliveries" };
    expect(isActiveRoute("/app/business/deliveries", item)).toBe(true);
    expect(isActiveRoute("/app/business/deliveries/new", item)).toBe(true);
    expect(isActiveRoute("/app/business/deliveries/abc-123", item)).toBe(true);
    expect(isActiveRoute("/app/business/customers", item)).toBe(false);
  });

  it("does not treat a shared prefix as a match", () => {
    // /app/business/deliveries must not light up for /app/business/deliveries-archive
    expect(isActiveRoute("/app/business/deliveries-archive", { href: "/app/business/deliveries" })).toBe(
      false
    );
  });

  it("tolerates trailing slashes and empty pathnames", () => {
    expect(isActiveRoute("/app/business/", { href: "/app/business", exact: true })).toBe(true);
    expect(isActiveRoute(null, { href: "/app/business", exact: true })).toBe(false);
    expect(isActiveRoute(undefined, { href: "/app/business", exact: true })).toBe(false);
    expect(isActiveRoute("", { href: "/", exact: true })).toBe(true);
  });

  it("selects exactly one active item, longest match winning", () => {
    const items = navigationFor("merchant");
    const active = activeNavItem("/app/business/deliveries/new", items);
    expect(active?.href).toBe("/app/business/deliveries");

    const dashboard = activeNavItem("/app/business", items);
    expect(dashboard?.href).toBe("/app/business");
  });

  it("returns undefined when nothing matches", () => {
    expect(activeNavItem("/nowhere", navigationFor("merchant"))).toBeUndefined();
  });

  it("keeps merchant settings sub-navigation distinct", () => {
    const sub = merchantSettingsNav();
    expect(activeNavItem("/app/business/settings", sub)?.screenId).toBe("MER-014");
    expect(activeNavItem("/app/business/settings/team", sub)?.screenId).toBe("MER-015");
    expect(activeNavItem("/app/business/settings/billing", sub)?.screenId).toBe("MER-016");
  });
});

describe("shell ownership of a path", () => {
  it("routes each prefix to its own shell", () => {
    expect(shellForPath("/")).toBe("public");
    expect(shellForPath("/pricing")).toBe("public");
    expect(shellForPath("/app/business")).toBe("merchant");
    expect(shellForPath("/app/business/deliveries/new")).toBe("merchant");
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

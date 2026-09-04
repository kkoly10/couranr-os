import {
  CANONICAL_SCREENS,
  type CanonicalScreen,
  type ScreenGroup,
} from "@/lib/couranr/screens";

/**
 * Role-aware navigation, derived from the canonical screen registry.
 *
 * Every destination traces to a screen ID in UI_SCREEN_REGISTRY.md §4. Nothing
 * is invented: `navigationFor()` filters CANONICAL_SCREENS by surface, so a
 * shell can only ever link to routes belonging to its own role. That isolation
 * is a property of the derivation, not a convention to remember.
 *
 * LABELS are shortened forms of the registry's screen names, for use inside a
 * shell where the surface is already implied ("Merchant dashboard" -> "Dashboard").
 * They are navigation affordances, not product copy. No label here states
 * pricing, mileage, hours, markets, payer, refund or payment behaviour — those
 * are Decision Registry concerns and are deliberately absent.
 */

export type ShellRole =
  | "public"
  | "customer"
  | "merchant"
  | "driver"
  | "operations";

export type NavItem = {
  /** Screen ID this destination implements. */
  screenId: string;
  /** Short label for use inside the shell. */
  label: string;
  href: string;
  /** Match only on an exact pathname (used for section roots). */
  exact?: boolean;
};

/** ShellRole -> the screen registry surface it may navigate within. */
const ROLE_GROUP: Record<Exclude<ShellRole, "customer">, ScreenGroup> = {
  public: "public",
  merchant: "merchant",
  driver: "driver",
  operations: "operations",
};

/**
 * Short labels keyed by screen ID. A screen absent from this map is not a
 * primary navigation destination (detail views, step and tab variants).
 */
const NAV_LABELS: Record<string, string> = {
  // Public — PUB-001 is the marketing home; auth entry points are separate.
  "PUB-008": "Pricing",
  "PUB-009": "For businesses",
  "PUB-010": "Service areas",
  "PUB-011": "How it works",

  // Merchant
  "MER-001": "Dashboard",
  "MER-004": "Deliveries",
  "MER-008": "Customers",
  "MER-010": "Presets",
  "MER-012": "Messages",
  "MER-013": "Website tools",
  "MER-014": "Settings",

  // Driver — field-first, small set.
  "DRV-001": "Home",
  "DRV-008": "Messages",
  "DRV-009": "Availability",
  "DRV-010": "Vehicle",

  // Operations
  "OPS-001": "Dashboard",
  "OPS-002": "Queue",
  "OPS-005": "Messages",
  "OPS-006": "Ghost Operations",
  "OPS-007": "Merchants",
  "OPS-008": "Vehicles",
  "OPS-009": "Payments",
  "OPS-011": "Refunds",
  "OPS-012": "Incidents",
  "OPS-013": "Analytics",
  "OPS-015": "Settings",
};

/**
 * Routes NOT yet available in this repository because a legacy route already
 * occupies the path. Recorded here rather than silently dropped; both are
 * "legacy route treatment" decisions for the Decision Registry.
 */
export const ROUTE_COLLISIONS: { route: string; legacyFile: string; screenId: string }[] =
  [
    // PUB-012 resolved: `/` is owned by
    // app/(couranr)/(public)/(master-public)/page.tsx under the master chrome.
    // The legacy app/page.tsx this entry described had already been deleted;
    // the descriptor outlived the file and is retired with the collision.
    //
    // DRV-001 resolved: /driver is now owned by app/(couranr)/driver/, which
    // composes DriverShell + SurfaceGuard like every other canonical route.
    // The legacy app/driver/layout.tsx (getSession + redirect to /login) is gone.
  ];

const COLLIDING = new Set(ROUTE_COLLISIONS.map((c) => c.route));

function firstCleanRoute(screen: CanonicalScreen): string | null {
  // A screen may list several routes; navigation uses the first plain path.
  const clean = screen.routes.find(
    (r) => !r.includes("?") && !r.includes("#") && !r.includes("[")
  );
  return clean ?? null;
}

/**
 * Primary navigation for a shell.
 *
 * `customer` returns an empty list by design: all eight CUS screens are
 * token-scoped fragments of /pay/[token], /track/[token] and /help/[token], and
 * §3 states customer accounts are optional. The registry defines no
 * authenticated-customer navigation, so none is invented here.
 */
/**
 * The canonical route a screen owns, for chrome that must link to a SCREEN
 * rather than to a path.
 *
 * Chrome copy names destinations ("Same Day", "For Business"); the screen
 * source owns where those destinations live. Typing the path into a header
 * would make the shell a second route authority — exactly what LEG-004 just
 * finished consolidating away, and exactly how a header survives a route move
 * while silently pointing at a 404.
 *
 * Throws rather than falling back. A chrome link with no destination is a
 * defect to surface, not to paper over at render time.
 */
export function routeForScreen(id: string): string {
  const screen = CANONICAL_SCREENS.find((s) => s.id === id);
  if (!screen) throw new Error(`routeForScreen: ${id} is not a canonical screen`);
  const href = firstCleanRoute(screen);
  if (!href) throw new Error(`routeForScreen: ${id} has no plain route`);
  return href;
}

export function navigationFor(role: ShellRole): NavItem[] {
  if (role === "customer") return [];

  const group = ROLE_GROUP[role];

  const candidates = CANONICAL_SCREENS.filter(
    (s) =>
      s.group === group &&
      (role !== "operations" ||
        (s.status !== "placeholder_only" && s.status !== "missing"))
  )
    .map((s) => ({ screen: s, label: NAV_LABELS[s.id], href: firstCleanRoute(s) }))
    .flatMap((c) =>
      c.label && c.href && !COLLIDING.has(c.href)
        ? [{ screen: c.screen, label: c.label, href: c.href }]
        : [],
    );

  const hrefs = candidates.map((c) => c.href);

  return candidates.map((c) => ({
    screenId: c.screen.id,
    label: c.label,
    href: c.href,
    /* A section ROOT must match exactly, or it stays lit for every child page
       beneath it. What makes an item a root is that another item in the SAME
       navigation nests under it — so that is what this asks.

       It used to count segments (`length <= 1`), which encoded the accident
       that every section root happened to be one segment deep. LEG-004 moved
       the merchant surface to `/app/business` and the dashboard silently
       stopped being exact: it lit up on `/app/business/deliveries` and on every
       other merchant page. Derived from the sibling set, the rule survives the
       next move too. */
    exact: hrefs.some((other) => other !== c.href && other.startsWith(`${c.href}/`)),
  }));
}

/** Sub-navigation for merchant settings (MER-014 / MER-015 / MER-016). */
export function merchantSettingsNav(): NavItem[] {
  /* Derived from the screen registry, so a route change reaches this
     sub-navigation without a second edit. */
  const of = (id: string) => {
    const s = CANONICAL_SCREENS.find((x) => x.id === id);
    const href = s && firstCleanRoute(s);
    if (!href) throw new Error(`${id} has no plain route in the screen registry`);
    return href;
  };
  return [
    { screenId: "MER-014", label: "General", href: of("MER-014"), exact: true },
    { screenId: "MER-015", label: "Team and permissions", href: of("MER-015") },
    { screenId: "MER-016", label: "Billing", href: of("MER-016") },
  ];
}

/**
 * Active-route derivation. A section root matches only itself; any other item
 * matches its own path and everything nested beneath it.
 */
export function isActiveRoute(
  pathname: string | null | undefined,
  item: Pick<NavItem, "href" | "exact">
): boolean {
  const path = (pathname || "").replace(/\/+$/, "") || "/";
  const href = item.href.replace(/\/+$/, "") || "/";

  if (item.exact) return path === href;
  if (path === href) return true;
  return path.startsWith(href + "/");
}

/** The single active item, longest match wins (so /a/b beats /a). */
export function activeNavItem(
  pathname: string | null | undefined,
  items: NavItem[]
): NavItem | undefined {
  const matches = items.filter((i) => isActiveRoute(pathname, i));
  if (matches.length === 0) return undefined;
  return matches.reduce((best, cur) =>
    cur.href.length > best.href.length ? cur : best
  );
}

/** Which shell owns a pathname. Used for route containment checks. */
export function shellForPath(pathname: string): ShellRole {
  const p = pathname.replace(/\/+$/, "") || "/";
  /* `/app/business`, NOT `/business`. LEG-004 gave `/business` to PUB-001, a
     public marketing page — classifying it merchant would wrap public marketing
     in MerchantShell. The prefix is matched on a segment boundary so
     `/app/businesses` and `/app/not-business` stay unclassified. */
  if (p === "/app/business" || p.startsWith("/app/business/")) return "merchant";
  if (p === "/driver" || p.startsWith("/driver/")) return "driver";
  if (p === "/operations" || p.startsWith("/operations/")) return "operations";
  if (
    p.startsWith("/pay/") ||
    p.startsWith("/track/") ||
    p.startsWith("/help/")
  ) {
    return "customer";
  }
  return "public";
}

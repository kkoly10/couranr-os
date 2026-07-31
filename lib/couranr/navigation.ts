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
    { route: "/", legacyFile: "app/page.tsx", screenId: "PUB-001" },
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
export function navigationFor(role: ShellRole): NavItem[] {
  if (role === "customer") return [];

  const group = ROLE_GROUP[role];

  return CANONICAL_SCREENS.filter((s) => s.group === group)
    .map((s): NavItem | null => {
      const label = NAV_LABELS[s.id];
      if (!label) return null;
      const href = firstCleanRoute(s);
      if (!href || COLLIDING.has(href)) return null;
      return {
        screenId: s.id,
        label,
        href,
        // Section roots must match exactly or they stay active for every child.
        exact: href.split("/").filter(Boolean).length <= 1,
      };
    })
    .filter((x): x is NavItem => x !== null);
}

/** Sub-navigation for merchant settings (MER-014 / MER-015 / MER-016). */
export function merchantSettingsNav(): NavItem[] {
  return [
    { screenId: "MER-014", label: "General", href: "/business/settings", exact: true },
    { screenId: "MER-015", label: "Team and permissions", href: "/business/settings/team" },
    { screenId: "MER-016", label: "Billing", href: "/business/settings/billing" },
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
  if (p === "/business" || p.startsWith("/business/")) return "merchant";
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

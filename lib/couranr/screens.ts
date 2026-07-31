/**
 * Canonical MVP screen registry.
 *
 * MECHANICALLY EXTRACTED from UI_SCREEN_REGISTRY.md section 4 "Route and
 * screen registry" — all 66 rows, with their IDs, routes, tiers, phases and
 * viewport intent preserved verbatim. Nothing here is invented.
 *
 * UI_SCREEN_REGISTRY.md controls WHICH screens are MVP and their routes and
 * states. It does NOT control pricing, policy, permissions, state transitions
 * or copy — when a canonical image and a written spec disagree, the written
 * specification wins and the mock is corrected.
 *
 * Screens are declared here before they are built so navigation, route
 * containment and the completion checklist all reference one list.
 * `implemented` records what actually exists in this repository today.
 */

export type ScreenGroup =
  | "public"
  | "merchant"
  | "driver"
  | "operations"
  | "customer";

export type ScreenTier = "core" | "mvp-complete";

export type ScreenViewport =
  | "responsive"
  | "mobile-first"
  | "desktop-first"
  | "mobile-primary"
  | "desktop-primary";

export type CanonicalScreen = {
  id: string;
  name: string;
  group: ScreenGroup;
  /** One entry per route the registry lists for this screen. */
  routes: string[];
  tier: ScreenTier;
  /** Implementation phase from UI_SCREEN_REGISTRY.md section 8. */
  phase: string;
  viewport: ScreenViewport;
  /** True once the route exists in this repository. */
  implemented: boolean;
};

export const CANONICAL_SCREENS: CanonicalScreen[] = [
  { id: "PUB-001", name: "Marketing homepage", group: "public", routes: ["/"], tier: "core", phase: "10", viewport: "responsive", implemented: false },
  { id: "PUB-002", name: "Sign in", group: "public", routes: ["/sign-in"], tier: "core", phase: "10", viewport: "responsive", implemented: true },
  { id: "PUB-003", name: "Business sign up", group: "public", routes: ["/sign-up"], tier: "core", phase: "4", viewport: "responsive", implemented: true },
  { id: "PUB-004", name: "Delivery estimate and hosted request", group: "public", routes: ["/estimate", "/request/[merchantSlug]"], tier: "core", phase: "5–6", viewport: "mobile-first", implemented: false },
  { id: "PUB-005", name: "Secure delivery payment", group: "public", routes: ["/pay/[token]"], tier: "core", phase: "6", viewport: "mobile-first", implemented: true },
  { id: "PUB-006", name: "Secure live tracking", group: "public", routes: ["/track/[token]"], tier: "core", phase: "7–8", viewport: "mobile-first", implemented: false },
  { id: "PUB-007", name: "Delivery Help", group: "public", routes: ["/help/[token]"], tier: "core", phase: "8", viewport: "mobile-first", implemented: false },
  { id: "PUB-008", name: "Pricing page", group: "public", routes: ["/pricing"], tier: "core", phase: "10", viewport: "responsive", implemented: false },
  { id: "PUB-009", name: "Businesses page", group: "public", routes: ["/businesses"], tier: "core", phase: "10", viewport: "responsive", implemented: false },
  { id: "PUB-010", name: "Service areas page", group: "public", routes: ["/service-areas"], tier: "core", phase: "10", viewport: "responsive", implemented: false },
  { id: "PUB-011", name: "How Couranr works", group: "public", routes: ["/how-it-works"], tier: "core", phase: "10", viewport: "responsive", implemented: false },
  { id: "MER-001", name: "Merchant dashboard", group: "merchant", routes: ["/business"], tier: "core", phase: "4–10", viewport: "desktop-first", implemented: false },
  { id: "MER-002", name: "Merchant onboarding", group: "merchant", routes: ["/business/onboarding"], tier: "core", phase: "4", viewport: "desktop-first", implemented: true },
  { id: "MER-003", name: "Live activation checklist", group: "merchant", routes: ["/business/onboarding?step=activation"], tier: "core", phase: "4", viewport: "desktop-first", implemented: false },
  { id: "MER-004", name: "Deliveries list", group: "merchant", routes: ["/business/deliveries"], tier: "core", phase: "5–8", viewport: "desktop-first", implemented: false },
  { id: "MER-005", name: "Create delivery with Smart Intake", group: "merchant", routes: ["/business/deliveries/new"], tier: "core", phase: "5", viewport: "desktop-first", implemented: true },
  { id: "MER-006", name: "Delivery review and quote", group: "merchant", routes: ["/business/deliveries/new?step=review"], tier: "core", phase: "6", viewport: "desktop-first", implemented: true },
  { id: "MER-007", name: "Delivery detail", group: "merchant", routes: ["/business/deliveries/[id]"], tier: "core", phase: "5–8", viewport: "desktop-first", implemented: true },
  { id: "MER-008", name: "Customers list", group: "merchant", routes: ["/business/customers"], tier: "core", phase: "4", viewport: "desktop-first", implemented: false },
  { id: "MER-009", name: "Customer detail", group: "merchant", routes: ["/business/customers?customer=[id]"], tier: "core", phase: "4", viewport: "desktop-first", implemented: false },
  { id: "MER-010", name: "Presets list", group: "merchant", routes: ["/business/presets"], tier: "core", phase: "4", viewport: "desktop-first", implemented: false },
  { id: "MER-011", name: "Preset builder", group: "merchant", routes: ["/business/presets?edit=[id]"], tier: "core", phase: "4", viewport: "desktop-first", implemented: false },
  { id: "MER-012", name: "Merchant messages and support", group: "merchant", routes: ["/business/messages"], tier: "core", phase: "8–9", viewport: "desktop-first", implemented: false },
  { id: "MER-013", name: "Website tools", group: "merchant", routes: ["/business/website-tools"], tier: "core", phase: "10", viewport: "desktop-first", implemented: false },
  { id: "MER-014", name: "Merchant settings", group: "merchant", routes: ["/business/settings"], tier: "core", phase: "4–8", viewport: "desktop-first", implemented: false },
  { id: "MER-015", name: "Team and permissions", group: "merchant", routes: ["/business/settings/team"], tier: "core", phase: "4", viewport: "desktop-first", implemented: false },
  { id: "MER-016", name: "Billing settings", group: "merchant", routes: ["/business/settings/billing"], tier: "core", phase: "6", viewport: "desktop-first", implemented: false },
  { id: "DRV-001", name: "Driver dashboard", group: "driver", routes: ["/driver"], tier: "core", phase: "7", viewport: "mobile-primary", implemented: false },
  { id: "DRV-002", name: "Assigned delivery detail", group: "driver", routes: ["/driver/deliveries/[id]"], tier: "core", phase: "7–8", viewport: "mobile-primary", implemented: false },
  { id: "DRV-003", name: "Pickup PIN and proof", group: "driver", routes: ["/driver/deliveries/[id]?step=pickup-proof"], tier: "core", phase: "7", viewport: "mobile-primary", implemented: false },
  { id: "DRV-004", name: "Package discrepancy", group: "driver", routes: ["/driver/deliveries/[id]?step=discrepancy"], tier: "core", phase: "7", viewport: "mobile-primary", implemented: false },
  { id: "DRV-005", name: "Driving Mode", group: "driver", routes: ["/driver/deliveries/[id]?mode=driving"], tier: "core", phase: "7–9", viewport: "mobile-primary", implemented: false },
  { id: "DRV-006", name: "Drop-off proof", group: "driver", routes: ["/driver/deliveries/[id]?step=delivery-proof"], tier: "core", phase: "7", viewport: "mobile-primary", implemented: false },
  { id: "DRV-007", name: "Offline proof sync", group: "driver", routes: ["/driver/deliveries/[id]?panel=offline-sync"], tier: "core", phase: "7", viewport: "mobile-primary", implemented: false },
  { id: "DRV-008", name: "Driver messages", group: "driver", routes: ["/driver/messages"], tier: "core", phase: "8–9", viewport: "mobile-primary", implemented: false },
  { id: "DRV-009", name: "Driver availability", group: "driver", routes: ["/driver/availability"], tier: "core", phase: "7", viewport: "mobile-primary", implemented: false },
  { id: "DRV-010", name: "Vehicle profile", group: "driver", routes: ["/driver/vehicle"], tier: "core", phase: "7", viewport: "mobile-primary", implemented: false },
  { id: "OPS-001", name: "Operations dashboard", group: "operations", routes: ["/operations"], tier: "core", phase: "7–10", viewport: "desktop-primary", implemented: false },
  { id: "OPS-002", name: "Queue and managed dispatch", group: "operations", routes: ["/operations/queue", "/operations/deliveries"], tier: "core", phase: "7", viewport: "desktop-primary", implemented: true },
  { id: "OPS-003", name: "Delivery review workspace", group: "operations", routes: ["/operations/deliveries/[id]"], tier: "core", phase: "7", viewport: "desktop-primary", implemented: true },
  { id: "OPS-004", name: "Requote and promotional credit", group: "operations", routes: ["/operations/deliveries/[id]?panel=requote"], tier: "core", phase: "6–7", viewport: "desktop-primary", implemented: false },
  { id: "OPS-005", name: "Operations messages and support inbox", group: "operations", routes: ["/operations/messages", "/operations/support"], tier: "core", phase: "8–9", viewport: "desktop-primary", implemented: false },
  { id: "OPS-006", name: "Couranr Ghost Operations", group: "operations", routes: ["/operations/ghost"], tier: "core", phase: "9", viewport: "desktop-primary", implemented: false },
  { id: "OPS-007", name: "Merchant management", group: "operations", routes: ["/operations/merchants"], tier: "core", phase: "4–9", viewport: "desktop-primary", implemented: false },
  { id: "OPS-008", name: "Vehicle management", group: "operations", routes: ["/operations/vehicles"], tier: "core", phase: "7", viewport: "desktop-primary", implemented: false },
  { id: "OPS-009", name: "Payments and reconciliation", group: "operations", routes: ["/operations/payments"], tier: "core", phase: "6", viewport: "desktop-primary", implemented: false },
  { id: "OPS-010", name: "Payment authorization review", group: "operations", routes: ["/operations/payments?tab=authorizations"], tier: "core", phase: "6", viewport: "desktop-primary", implemented: false },
  { id: "OPS-011", name: "Refund management", group: "operations", routes: ["/operations/refunds"], tier: "core", phase: "6–7", viewport: "desktop-primary", implemented: false },
  { id: "OPS-012", name: "Incidents and claims", group: "operations", routes: ["/operations/incidents"], tier: "core", phase: "7", viewport: "desktop-primary", implemented: false },
  { id: "OPS-013", name: "Operations analytics", group: "operations", routes: ["/operations/analytics"], tier: "core", phase: "10", viewport: "desktop-primary", implemented: false },
  { id: "OPS-014", name: "Unmet demand analytics", group: "operations", routes: ["/operations/analytics?tab=unmet-demand"], tier: "mvp-complete", phase: "10", viewport: "desktop-primary", implemented: false },
  { id: "OPS-015", name: "Operations settings", group: "operations", routes: ["/operations/settings"], tier: "core", phase: "3, 8–9", viewport: "desktop-primary", implemented: false },
  { id: "OPS-016", name: "Availability controls", group: "operations", routes: ["/operations/settings?tab=availability"], tier: "core", phase: "3, 7", viewport: "desktop-primary", implemented: false },
  { id: "OPS-017", name: "Policy and pricing registry", group: "operations", routes: ["/operations/settings?tab=policies"], tier: "mvp-complete", phase: "3", viewport: "desktop-primary", implemented: false },
  { id: "OPS-018", name: "Notification template manager", group: "operations", routes: ["/operations/settings?tab=notifications"], tier: "mvp-complete", phase: "8", viewport: "desktop-primary", implemented: false },
  { id: "OPS-019", name: "Ghost auto-reply controls and kill switches", group: "operations", routes: ["/operations/settings?tab=ai"], tier: "core", phase: "9", viewport: "desktop-primary", implemented: false },
  { id: "OPS-020", name: "Activity and audit log", group: "operations", routes: ["/operations/settings?tab=audit"], tier: "core", phase: "2–9", viewport: "desktop-primary", implemented: false },
  { id: "OPS-021", name: "Ask Couranr lead inbox", group: "operations", routes: ["/operations/ghost?tab=leads"], tier: "mvp-complete", phase: "9–10", viewport: "desktop-primary", implemented: false },
  { id: "CUS-001", name: "Address-change request", group: "customer", routes: ["/help/[token]#address-change"], tier: "core", phase: "7–8", viewport: "mobile-first", implemented: false },
  { id: "CUS-002", name: "Cancellation and return request", group: "customer", routes: ["/help/[token]#cancellation-return"], tier: "core", phase: "7–8", viewport: "mobile-first", implemented: false },
  { id: "CUS-003", name: "Recipient unavailable resolution", group: "customer", routes: ["/help/[token]#recipient-unavailable"], tier: "core", phase: "7–8", viewport: "mobile-first", implemented: false },
  { id: "CUS-004", name: "Delivery problem report", group: "customer", routes: ["/help/[token]#delivery-problem"], tier: "core", phase: "7–8", viewport: "mobile-first", implemented: false },
  { id: "CUS-005", name: "Revised quote approval", group: "customer", routes: ["/pay/[token]?mode=requote"], tier: "core", phase: "6–7", viewport: "mobile-first", implemented: true },
  { id: "CUS-006", name: "Proof-of-delivery viewer", group: "customer", routes: ["/track/[token]#proof"], tier: "core", phase: "7", viewport: "mobile-first", implemented: false },
  { id: "CUS-007", name: "Return and refund status", group: "customer", routes: ["/help/[token]#return-status"], tier: "core", phase: "6–8", viewport: "mobile-first", implemented: false },
  { id: "CUS-008", name: "Delivery preferences and access instructions", group: "customer", routes: ["/track/[token]#access"], tier: "core", phase: "7–8", viewport: "mobile-first", implemented: false },
];

export const SCREEN_COUNT = CANONICAL_SCREENS.length;

export function screensByGroup(group: ScreenGroup): CanonicalScreen[] {
  return CANONICAL_SCREENS.filter((s) => s.group === group);
}

export function getScreen(id: string): CanonicalScreen | undefined {
  return CANONICAL_SCREENS.find((s) => s.id === id);
}

/** Core screens are required before the production canary. */
export function coreScreens(): CanonicalScreen[] {
  return CANONICAL_SCREENS.filter((s) => s.tier === "core");
}

/** Every distinct canonical route across all screens. */
export function canonicalRoutes(): string[] {
  return Array.from(new Set(CANONICAL_SCREENS.flatMap((s) => s.routes))).sort();
}

/**
 * Progress against UI_SCREEN_REGISTRY.md section 10 "UI completion definition".
 * Reported by the internal preview route; never surfaced publicly.
 */
export function implementationProgress() {
  const done = CANONICAL_SCREENS.filter((s) => s.implemented).length;
  return {
    total: SCREEN_COUNT,
    implemented: done,
    remaining: SCREEN_COUNT - done,
    coreTotal: coreScreens().length,
    coreImplemented: coreScreens().filter((s) => s.implemented).length,
  };
}

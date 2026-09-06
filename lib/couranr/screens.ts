/**
 * Canonical MVP screen registry — the runtime view.
 *
 * GENERATED FILE — DO NOT EDIT. Run `npm run governance:generate`.
 *
 * Two authorities, one projection:
 *
 *   - topology (id, name, group, routes, tier, phase, viewport) comes from
 *     `ui_screen_registry.json`, the writable source for screen topology;
 *   - `status` comes from `docs/couranr-mvp/SCREEN_IMPLEMENTATION_LEDGER.csv`,
 *     the writable source for screen implementation state.
 *
 * This file used to be hand-maintained with a hand-maintained `implemented`
 * boolean, and that boolean disagreed with the ledger on 15 of 66 screens.
 * `implemented` is now derived — it is true for functional_verified and functional_unverified
 * and false for everything else — and `status` is carried through so a consumer
 * that needs the distinction is not forced to flatten it.
 *
 * The registry controls WHICH screens are MVP and their routes and states. It
 * does NOT control pricing, policy, permissions, state transitions or copy —
 * when a canonical image and a written spec disagree, the written specification
 * wins and the mock is corrected.
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

/** The screen ledger's closed status vocabulary, as used by these screens. */
export type ScreenStatus =
  | "functional_unverified"
  | "functional_verified"
  | "missing"
  | "partial"
  | "placeholder_only";

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
  { id: "PUB-001", name: "Marketing homepage", group: "public", routes: ["/business"], tier: "core", phase: "10", viewport: "responsive", status: "functional_verified" },
  { id: "PUB-002", name: "Sign in", group: "public", routes: ["/sign-in"], tier: "core", phase: "10", viewport: "responsive", status: "functional_verified" },
  { id: "PUB-003", name: "Business sign up", group: "public", routes: ["/sign-up"], tier: "core", phase: "4", viewport: "responsive", status: "functional_verified" },
  { id: "PUB-004", name: "Delivery estimate and hosted request", group: "public", routes: ["/send", "/estimate", "/request/[merchantSlug]"], tier: "core", phase: "5–6", viewport: "mobile-first", status: "partial" },
  { id: "PUB-005", name: "Secure delivery payment", group: "public", routes: ["/pay/[token]"], tier: "core", phase: "6", viewport: "mobile-first", status: "functional_verified" },
  { id: "PUB-006", name: "Secure live tracking", group: "public", routes: ["/track/[token]"], tier: "core", phase: "7–8", viewport: "mobile-first", status: "partial" },
  { id: "PUB-007", name: "Delivery Help", group: "public", routes: ["/help/[token]"], tier: "core", phase: "8", viewport: "mobile-first", status: "functional_verified" },
  { id: "PUB-008", name: "Pricing page", group: "public", routes: ["/pricing"], tier: "core", phase: "10", viewport: "responsive", status: "functional_verified" },
  { id: "PUB-009", name: "Businesses page", group: "public", routes: ["/businesses"], tier: "core", phase: "10", viewport: "responsive", status: "functional_verified" },
  { id: "PUB-010", name: "Service areas page", group: "public", routes: ["/service-areas"], tier: "core", phase: "10", viewport: "responsive", status: "functional_verified" },
  { id: "PUB-011", name: "How Couranr works", group: "public", routes: ["/how-it-works"], tier: "core", phase: "10", viewport: "responsive", status: "functional_verified" },
  { id: "PUB-012", name: "Couranr master homepage", group: "public", routes: ["/"], tier: "core", phase: "10", viewport: "responsive", status: "functional_verified" },
  { id: "PUB-013", name: "Couranr Same Day", group: "public", routes: ["/sameday"], tier: "core", phase: "10", viewport: "mobile-first", status: "functional_verified" },
  { id: "MER-001", name: "Merchant dashboard", group: "merchant", routes: ["/app/business"], tier: "core", phase: "4–10", viewport: "desktop-first", status: "functional_verified" },
  { id: "MER-002", name: "Merchant onboarding", group: "merchant", routes: ["/app/business/onboarding"], tier: "core", phase: "4", viewport: "desktop-first", status: "functional_verified" },
  { id: "MER-003", name: "Live activation checklist", group: "merchant", routes: ["/app/business/onboarding?step=activation"], tier: "core", phase: "4", viewport: "desktop-first", status: "functional_verified" },
  { id: "MER-004", name: "Deliveries list", group: "merchant", routes: ["/app/business/deliveries"], tier: "core", phase: "5–8", viewport: "desktop-first", status: "functional_verified" },
  { id: "MER-005", name: "Create delivery with Smart Intake", group: "merchant", routes: ["/app/business/deliveries/new"], tier: "core", phase: "5", viewport: "desktop-first", status: "partial" },
  { id: "MER-006", name: "Delivery review and quote", group: "merchant", routes: ["/app/business/deliveries/new?step=review"], tier: "core", phase: "6", viewport: "desktop-first", status: "functional_unverified" },
  { id: "MER-007", name: "Delivery detail", group: "merchant", routes: ["/app/business/deliveries/[id]"], tier: "core", phase: "5–8", viewport: "desktop-first", status: "functional_verified" },
  { id: "MER-008", name: "Customers list", group: "merchant", routes: ["/app/business/customers"], tier: "core", phase: "4", viewport: "desktop-first", status: "functional_verified" },
  { id: "MER-009", name: "Customer detail", group: "merchant", routes: ["/app/business/customers?customer=[id]"], tier: "core", phase: "4", viewport: "desktop-first", status: "functional_verified" },
  { id: "MER-010", name: "Presets list", group: "merchant", routes: ["/app/business/presets"], tier: "core", phase: "4", viewport: "desktop-first", status: "functional_verified" },
  { id: "MER-011", name: "Preset builder", group: "merchant", routes: ["/app/business/presets?edit=[id]"], tier: "core", phase: "4", viewport: "desktop-first", status: "functional_verified" },
  { id: "MER-012", name: "Merchant messages and support", group: "merchant", routes: ["/app/business/messages"], tier: "core", phase: "8–9", viewport: "desktop-first", status: "partial" },
  { id: "MER-013", name: "Website tools", group: "merchant", routes: ["/app/business/website-tools"], tier: "core", phase: "10", viewport: "desktop-first", status: "functional_verified" },
  { id: "MER-014", name: "Merchant settings", group: "merchant", routes: ["/app/business/settings"], tier: "core", phase: "4–8", viewport: "desktop-first", status: "functional_verified" },
  { id: "MER-015", name: "Team and permissions", group: "merchant", routes: ["/app/business/settings/team"], tier: "core", phase: "4", viewport: "desktop-first", status: "functional_verified" },
  { id: "MER-016", name: "Billing settings", group: "merchant", routes: ["/app/business/settings/billing"], tier: "core", phase: "6", viewport: "desktop-first", status: "partial" },
  { id: "DRV-001", name: "Driver dashboard", group: "driver", routes: ["/driver"], tier: "core", phase: "7", viewport: "mobile-primary", status: "functional_unverified" },
  { id: "DRV-002", name: "Assigned delivery detail", group: "driver", routes: ["/driver/deliveries/[id]"], tier: "core", phase: "7–8", viewport: "mobile-primary", status: "functional_verified" },
  { id: "DRV-003", name: "Pickup verification and proof", group: "driver", routes: ["/driver/deliveries/[id]?step=pickup-proof"], tier: "core", phase: "7", viewport: "mobile-primary", status: "functional_verified" },
  { id: "DRV-004", name: "Package discrepancy", group: "driver", routes: ["/driver/deliveries/[id]?step=discrepancy"], tier: "core", phase: "7", viewport: "mobile-primary", status: "functional_unverified" },
  { id: "DRV-005", name: "Driving Mode", group: "driver", routes: ["/driver/deliveries/[id]?mode=driving"], tier: "core", phase: "7–9", viewport: "mobile-primary", status: "functional_unverified" },
  { id: "DRV-006", name: "Drop-off proof", group: "driver", routes: ["/driver/deliveries/[id]?step=delivery-proof"], tier: "core", phase: "7", viewport: "mobile-primary", status: "functional_verified" },
  { id: "DRV-007", name: "Offline proof sync", group: "driver", routes: ["/driver/deliveries/[id]?panel=offline-sync"], tier: "core", phase: "7", viewport: "mobile-primary", status: "functional_unverified" },
  { id: "DRV-008", name: "Driver messages", group: "driver", routes: ["/driver/messages"], tier: "core", phase: "8–9", viewport: "mobile-primary", status: "partial" },
  { id: "DRV-009", name: "Driver availability", group: "driver", routes: ["/driver/availability"], tier: "core", phase: "7", viewport: "mobile-primary", status: "functional_unverified" },
  { id: "DRV-010", name: "Vehicle profile", group: "driver", routes: ["/driver/vehicle"], tier: "core", phase: "7", viewport: "mobile-primary", status: "partial" },
  { id: "OPS-001", name: "Operations dashboard", group: "operations", routes: ["/operations"], tier: "core", phase: "7–10", viewport: "desktop-primary", status: "functional_unverified" },
  { id: "OPS-002", name: "Queue and managed dispatch", group: "operations", routes: ["/operations/queue", "/operations/deliveries"], tier: "core", phase: "7", viewport: "desktop-primary", status: "partial" },
  { id: "OPS-003", name: "Delivery review workspace", group: "operations", routes: ["/operations/deliveries/[id]"], tier: "core", phase: "7", viewport: "desktop-primary", status: "functional_verified" },
  { id: "OPS-004", name: "Requote and promotional credit", group: "operations", routes: ["/operations/deliveries/[id]?panel=requote"], tier: "core", phase: "6–7", viewport: "desktop-primary", status: "partial" },
  { id: "OPS-005", name: "Operations messages and support inbox", group: "operations", routes: ["/operations/messages", "/operations/support"], tier: "core", phase: "8–9", viewport: "desktop-primary", status: "functional_verified" },
  { id: "OPS-006", name: "Couranr Ghost Operations", group: "operations", routes: ["/operations/ghost"], tier: "core", phase: "9", viewport: "desktop-primary", status: "placeholder_only" },
  { id: "OPS-007", name: "Merchant management", group: "operations", routes: ["/operations/merchants"], tier: "core", phase: "4–9", viewport: "desktop-primary", status: "partial" },
  { id: "OPS-008", name: "Vehicle management", group: "operations", routes: ["/operations/vehicles"], tier: "core", phase: "7", viewport: "desktop-primary", status: "functional_unverified" },
  { id: "OPS-009", name: "Payments and reconciliation", group: "operations", routes: ["/operations/payments"], tier: "core", phase: "6", viewport: "desktop-primary", status: "partial" },
  { id: "OPS-010", name: "Payment authorization review", group: "operations", routes: ["/operations/payments?tab=authorizations"], tier: "core", phase: "6", viewport: "desktop-primary", status: "partial" },
  { id: "OPS-011", name: "Refund management", group: "operations", routes: ["/operations/refunds"], tier: "core", phase: "6–7", viewport: "desktop-primary", status: "placeholder_only" },
  { id: "OPS-012", name: "Incidents and claims", group: "operations", routes: ["/operations/incidents"], tier: "core", phase: "7", viewport: "desktop-primary", status: "placeholder_only" },
  { id: "OPS-013", name: "Operations analytics", group: "operations", routes: ["/operations/analytics"], tier: "core", phase: "10", viewport: "desktop-primary", status: "placeholder_only" },
  { id: "OPS-014", name: "Unmet demand analytics", group: "operations", routes: ["/operations/analytics?tab=unmet-demand"], tier: "mvp-complete", phase: "10", viewport: "desktop-primary", status: "placeholder_only" },
  { id: "OPS-015", name: "Operations settings", group: "operations", routes: ["/operations/settings"], tier: "core", phase: "3, 8–9", viewport: "desktop-primary", status: "placeholder_only" },
  { id: "OPS-016", name: "Availability controls", group: "operations", routes: ["/operations/settings?tab=availability"], tier: "core", phase: "3, 7", viewport: "desktop-primary", status: "placeholder_only" },
  { id: "OPS-017", name: "Policy and pricing registry", group: "operations", routes: ["/operations/settings?tab=policies"], tier: "mvp-complete", phase: "3", viewport: "desktop-primary", status: "placeholder_only" },
  { id: "OPS-018", name: "Notification template manager", group: "operations", routes: ["/operations/settings?tab=notifications"], tier: "mvp-complete", phase: "8", viewport: "desktop-primary", status: "placeholder_only" },
  { id: "OPS-019", name: "Ghost auto-reply controls and kill switches", group: "operations", routes: ["/operations/settings?tab=ai"], tier: "core", phase: "9", viewport: "desktop-primary", status: "placeholder_only" },
  { id: "OPS-020", name: "Activity and audit log", group: "operations", routes: ["/operations/settings?tab=audit"], tier: "core", phase: "2–9", viewport: "desktop-primary", status: "placeholder_only" },
  { id: "OPS-021", name: "Ask Couranr lead inbox", group: "operations", routes: ["/operations/ghost?tab=leads"], tier: "mvp-complete", phase: "9–10", viewport: "desktop-primary", status: "placeholder_only" },
  { id: "CUS-001", name: "Address-change request", group: "customer", routes: ["/help/[token]#address-change"], tier: "core", phase: "7–8", viewport: "mobile-first", status: "functional_verified" },
  { id: "CUS-002", name: "Cancellation and return request", group: "customer", routes: ["/help/[token]#cancellation-return"], tier: "core", phase: "7–8", viewport: "mobile-first", status: "missing" },
  { id: "CUS-003", name: "Recipient unavailable resolution", group: "customer", routes: ["/help/[token]#recipient-unavailable"], tier: "core", phase: "7–8", viewport: "mobile-first", status: "functional_verified" },
  { id: "CUS-004", name: "Delivery problem report", group: "customer", routes: ["/help/[token]#delivery-problem"], tier: "core", phase: "7–8", viewport: "mobile-first", status: "missing" },
  { id: "CUS-005", name: "Revised quote approval", group: "customer", routes: ["/pay/[token]?mode=requote"], tier: "core", phase: "6–7", viewport: "mobile-first", status: "functional_unverified" },
  { id: "CUS-006", name: "Proof-of-delivery viewer", group: "customer", routes: ["/track/[token]#proof"], tier: "core", phase: "7", viewport: "mobile-first", status: "functional_verified" },
  { id: "CUS-007", name: "Return and refund status", group: "customer", routes: ["/help/[token]#return-status"], tier: "core", phase: "6–8", viewport: "mobile-first", status: "missing" },
  { id: "CUS-008", name: "Delivery preferences and access instructions", group: "customer", routes: ["/track/[token]#access"], tier: "core", phase: "7–8", viewport: "mobile-first", status: "partial" },
];

/** Ledger statuses that mean the screen is BUILT rather than stubbed. */
export const IMPLEMENTED_STATUSES: ScreenStatus[] = [
  "functional_verified",
  "functional_unverified",
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

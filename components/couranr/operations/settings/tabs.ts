/**
 * The Operations settings tab vocabulary — OPS-015's five sub-screens.
 *
 * WHY THE TAB IS A QUERY PARAMETER AND NOT A PATH SEGMENT. `ui_screen_registry
 * .json` declares the routes literally:
 *
 *   OPS-015  /operations/settings
 *   OPS-016  /operations/settings?tab=availability
 *   OPS-017  /operations/settings?tab=policies
 *   OPS-018  /operations/settings?tab=notifications
 *   OPS-019  /operations/settings?tab=ai
 *   OPS-020  /operations/settings?tab=audit
 *
 * The registry is rank-1 authority for canonical screen routes, so `?tab=` is
 * the route shape, not a choice. A `/operations/settings/availability` segment
 * would be a different screen from the one the registry declares.
 *
 * NO "use client" DIRECTIVE. This module is imported by BOTH the server page
 * (which resolves the tab from `searchParams` so the header never flashes the
 * wrong title) and the client tab strip. Data only — no component, no hook, no
 * browser API.
 */

export const SETTINGS_TABS = [
  {
    id: "availability",
    screenId: "OPS-016",
    label: "Availability",
    title: "Availability controls",
    /** The registry's own `purpose`, verbatim. */
    purpose:
      "Control service levels, hours, cutoff, overnight, weather-limited mode, market availability, and closures.",
    built: true,
  },
  {
    id: "policies",
    screenId: "OPS-017",
    label: "Policies and pricing",
    title: "Policy and pricing registry",
    purpose:
      "View versioned deterministic pricing and policy rules with effective dates and audit.",
    built: false,
  },
  {
    id: "notifications",
    screenId: "OPS-018",
    label: "Notifications",
    title: "Notification template manager",
    purpose:
      "Manage approved, versioned operational templates by audience, channel, language, and event.",
    built: false,
  },
  {
    id: "ai",
    screenId: "OPS-019",
    label: "AI controls",
    title: "Ghost auto-reply controls and kill switches",
    purpose:
      "Control safe auto-replies by category, merchant, conversation, provider, and global state.",
    built: false,
  },
  {
    id: "audit",
    screenId: "OPS-020",
    label: "Activity and audit",
    title: "Activity and audit log",
    purpose:
      "Inspect state commands, policy versions, AI decisions, data access, payment events, and overrides.",
    built: true,
  },
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];

/** The tab a bare `/operations/settings` resolves to — OPS-015's own shell. */
export const DEFAULT_SETTINGS_TAB: SettingsTabId = "availability";

export function isSettingsTabId(v: unknown): v is SettingsTabId {
  return typeof v === "string" && SETTINGS_TABS.some((t) => t.id === v);
}

/**
 * Resolve `?tab=` to a tab.
 *
 * An UNKNOWN value falls back to the default rather than 404ing. A settings
 * surface that 404s on a mistyped query parameter is worse than one that opens
 * on its first tab, and the registry declares no error route for this screen.
 */
export function resolveSettingsTab(raw: unknown): SettingsTabId {
  return isSettingsTabId(raw) ? raw : DEFAULT_SETTINGS_TAB;
}

export function settingsTab(id: SettingsTabId) {
  return SETTINGS_TABS.find((t) => t.id === id)!;
}

/** The canonical href for a tab, in the registry's own shape. */
export function settingsTabHref(id: SettingsTabId): string {
  return `/operations/settings?tab=${id}`;
}

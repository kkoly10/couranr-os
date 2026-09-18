"use client";

import * as React from "react";
import Link from "next/link";
import { SETTINGS_TABS, settingsTabHref, type SettingsTabId } from "./tabs";

/**
 * OPS-015's tab strip, driven by the URL rather than by component state.
 *
 * WHY NOT `components/couranr/interactive.tsx`'s `Tabs`. That primitive owns
 * its selection in `useState` and only accepts a `defaultTabId`. Here the
 * selection IS the route — `ui_screen_registry.json` gives OPS-016 and OPS-020
 * their own `?tab=` addresses — so a component holding a second copy of it
 * would drift the moment someone used the back button, pasted a link, or
 * followed one from the audit trail. Making the URL the single source removes
 * the class of bug rather than synchronising two copies of the answer. The
 * shared primitive is not modified: it is the right shape for an in-page tab
 * set, which this is not.
 *
 * EACH TAB IS A REAL LINK. Middle-click, copy-link and open-in-new-tab all
 * work, and the server page re-renders with the new `searchParams` so the
 * heading is never one navigation behind.
 *
 * ARIA: the MANUAL-ACTIVATION variant of the tabs pattern. Arrow keys, Home and
 * End move FOCUS along the strip; Enter (a link's own activation) follows it.
 * Automatic activation is the wrong variant when selecting a tab performs a
 * navigation — the APG says so, and here every arrow press would otherwise
 * fetch a route.
 */
export function SettingsTabs({ activeTab }: { activeTab: SettingsTabId }) {
  const refs = React.useRef<Record<string, HTMLAnchorElement | null>>({});

  function onKeyDown(e: React.KeyboardEvent) {
    const idx = SETTINGS_TABS.findIndex((t) => t.id === activeTab);
    if (idx < 0) return;

    const focusedId =
      (document.activeElement as HTMLElement | null)?.getAttribute("data-tab-id") ?? activeTab;
    const from = SETTINGS_TABS.findIndex((t) => t.id === focusedId);
    const cursor = from < 0 ? idx : from;

    let next = cursor;
    if (e.key === "ArrowRight") next = (cursor + 1) % SETTINGS_TABS.length;
    else if (e.key === "ArrowLeft") next = (cursor - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = SETTINGS_TABS.length - 1;
    else return;

    e.preventDefault();
    refs.current[SETTINGS_TABS[next].id]?.focus();
  }

  return (
    <div
      className="cr-tabs__list"
      role="tablist"
      aria-label="Operations settings sections"
      onKeyDown={onKeyDown}
    >
      {SETTINGS_TABS.map((t) => {
        const selected = t.id === activeTab;
        return (
          <Link
            key={t.id}
            href={settingsTabHref(t.id)}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            data-tab-id={t.id}
            role="tab"
            id={`cr-tab-${t.id}`}
            aria-selected={selected}
            aria-controls="cr-settings-panel"
            /*
             * Roving tab sequence: only the selected tab is reachable by Tab,
             * so a keyboard user steps INTO the strip once and then along it
             * with the arrow keys, rather than through five links.
             */
            tabIndex={selected ? 0 : -1}
            className="cr-tabs__tab"
            /*
             * A tab that is registered but not built says so in its accessible
             * name. Silently looking identical to a working tab is how someone
             * reports "the policies tab is broken" about a screen that was
             * never built.
             */
            aria-describedby={t.built ? undefined : `cr-tab-note-${t.id}`}
          >
            {t.label}
            {t.built ? null : (
              <span className="cr-visually-hidden" id={`cr-tab-note-${t.id}`}>
                {" "}
                — not built yet
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

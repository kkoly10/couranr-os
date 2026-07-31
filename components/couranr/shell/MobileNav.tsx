"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActiveRoute, type NavItem } from "@/lib/couranr/navigation";
import { Wordmark } from "./parts";

/**
 * Mobile / tablet navigation drawer.
 *
 * §7 requires keyboard navigation, visible focus and reduced motion. This traps
 * focus while open, closes on Escape, closes on backdrop click, and restores
 * focus to the trigger on close — the same behaviour as the Dialog primitive,
 * implemented here so the shell has no dependency on it.
 */

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function MobileNav({
  items,
  label,
  roleLabel,
  footer,
  homeHref = "/",
  triggerClassName = "cr-icon-button",
}: {
  items: NavItem[];
  label: string;
  roleLabel?: string;
  footer?: React.ReactNode;
  /**
   * Where the drawer's wordmark links. Defaults to the public home, but a
   * role shell must pass its own root so the drawer cannot navigate the user
   * out of their area.
   */
  homeHref?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  // Close on navigation so the drawer never persists across a route change.
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  React.useEffect(() => {
    if (!open) return;

    const trigger = triggerRef.current;
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first || panelRef.current)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key !== "Tab") return;

      const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!nodes || nodes.length === 0) return;
      const list = Array.from(nodes);
      const firstEl = list[0];
      const lastEl = list[list.length - 1];

      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      trigger?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">☰</span>
        <span className="cr-visually-hidden">Open {label}</span>
      </button>

      {open ? (
        <div
          className="cr-overlay cr-overlay--nav"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            ref={panelRef}
            className="cr-navdrawer"
            role="dialog"
            aria-modal="true"
            aria-label={label}
            tabIndex={-1}
          >
            <div className="cr-cluster cr-cluster--between">
              <div>
                <Wordmark href={homeHref} tone="dark" />
                {roleLabel ? <div className="cr-sidebar__role">{roleLabel}</div> : null}
              </div>
              <button
                type="button"
                className="cr-icon-button"
                onClick={() => setOpen(false)}
              >
                <span aria-hidden="true">×</span>
                <span className="cr-visually-hidden">Close {label}</span>
              </button>
            </div>

            <nav aria-label={label}>
              <div className="cr-sidebar__nav">
                {items.map((item) => {
                  const active = isActiveRoute(pathname, item);
                  return (
                    <Link
                      key={item.screenId}
                      href={item.href}
                      className="cr-sidebar__link"
                      aria-current={active ? "page" : undefined}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </nav>

            {footer ? <div className="cr-sidebar__footer">{footer}</div> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Desktop sidebar navigation list. Client-side for active-route derivation. */
export function SidebarNav({ items, label }: { items: NavItem[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label}>
      <div className="cr-sidebar__nav">
        {items.map((item) => {
          const active = isActiveRoute(pathname, item);
          return (
            <Link
              key={item.screenId}
              href={item.href}
              className="cr-sidebar__link"
              aria-current={active ? "page" : undefined}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** Public top-bar links. */
export function TopbarNav({ items, label }: { items: NavItem[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="cr-topbar__links">
      {items.map((item) => {
        const active = isActiveRoute(pathname, item);
        return (
          <Link
            key={item.screenId}
            href={item.href}
            className="cr-topbar__link"
            aria-current={active ? "page" : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Driver bottom tab bar. Field-first: large targets, few destinations. */
export function DriverTabBar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Driver navigation" className="cr-tabbar">
      {items.map((item) => {
        const active = isActiveRoute(pathname, item);
        return (
          <Link
            key={item.screenId}
            href={item.href}
            className="cr-tabbar__link"
            aria-current={active ? "page" : undefined}
          >
            <span className="cr-tabbar__glyph" aria-hidden="true">
              {TAB_GLYPH[item.screenId] ?? "•"}
            </span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

const TAB_GLYPH: Record<string, string> = {
  "DRV-008": "✉",
  "DRV-009": "◷",
  "DRV-010": "⛟",
};

"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Interactive primitives: Tabs, Dialog, Drawer, Menu.
 *
 * §7 requires keyboard navigation, visible focus, accessible names and
 * reduced-motion support. These implement the WAI-ARIA patterns directly rather
 * than pulling in a component library, because the baseline requires the
 * design system to be additive and dependency-light.
 */

/* ------------------------------------------------------------------ Tabs */

export type TabItem = {
  id: string;
  label: React.ReactNode;
  content: React.ReactNode;
};

/**
 * ARIA tabs pattern with roving focus: Left/Right move between tabs, Home/End
 * jump to the ends, and only the active tab is in the tab sequence.
 */
export function Tabs({
  items,
  defaultTabId,
  label,
  onChange,
}: {
  items: TabItem[];
  defaultTabId?: string;
  label: string;
  onChange?: (id: string) => void;
}) {
  const [active, setActive] = React.useState(defaultTabId || items[0]?.id);
  const refs = React.useRef<Record<string, HTMLButtonElement | null>>({});

  function select(id: string) {
    setActive(id);
    onChange?.(id);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const idx = items.findIndex((t) => t.id === active);
    if (idx < 0) return;

    let next = idx;
    if (e.key === "ArrowRight") next = (idx + 1) % items.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else return;

    e.preventDefault();
    const id = items[next].id;
    select(id);
    refs.current[id]?.focus();
  }

  const activeItem = items.find((t) => t.id === active);

  return (
    <div>
      <div className="cr-tabs__list" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {items.map((t) => {
          const selected = t.id === active;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[t.id] = el;
              }}
              type="button"
              role="tab"
              id={`cr-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`cr-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              className="cr-tabs__tab"
              onClick={() => select(t.id)}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {activeItem ? (
        <div
          role="tabpanel"
          id={`cr-panel-${activeItem.id}`}
          aria-labelledby={`cr-tab-${activeItem.id}`}
          tabIndex={0}
          className="cr-tabs__panel"
        >
          {activeItem.content}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------- Focus trap for overlays */

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

function useOverlayBehaviour(
  open: boolean,
  onClose: () => void,
  panelRef: React.RefObject<HTMLElement>
) {
  React.useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Move focus into the overlay so the keyboard user is not left behind it.
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first || panelRef.current)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
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
      // Return focus to whatever opened the overlay.
      previouslyFocused?.focus?.();
    };
  }, [open, onClose, panelRef]);
}

/* ---------------------------------------------------------------- Dialog */

export function Dialog({
  open,
  onClose,
  title,
  description,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  useOverlayBehaviour(open, onClose, panelRef);

  if (!open) return null;

  return (
    <div
      className="cr-overlay cr-overlay--dialog"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="cr-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cr-dialog-title"
        aria-describedby={description ? "cr-dialog-desc" : undefined}
        tabIndex={-1}
      >
        <div className="cr-dialog__header">
          <h2 className="cr-dialog__title" id="cr-dialog-title">
            {title}
          </h2>
          <button
            type="button"
            className="cr-button cr-button--ghost cr-button--sm"
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
            <span className="cr-visually-hidden">Close</span>
          </button>
        </div>

        {description ? (
          <p className="cr-text cr-text--sm cr-text--muted" id="cr-dialog-desc">
            {description}
          </p>
        ) : null}

        {children}

        {footer ? <div className="cr-dialog__footer">{footer}</div> : null}
      </div>
    </div>
  );
}

/**
 * Destructive confirmation with consequence text (§6). The consequence is a
 * required prop, so a caller cannot ship a bare "Are you sure?".
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  consequence,
  confirmLabel = "Confirm",
  destructive,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: React.ReactNode;
  consequence: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  loading?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button
            type="button"
            className="cr-button cr-button--secondary"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="button"
            className={cn(
              "cr-button",
              destructive ? "cr-button--destructive" : "cr-button--primary"
            )}
            onClick={onConfirm}
            disabled={loading}
            aria-busy={loading || undefined}
          >
            {loading ? "Working…" : confirmLabel}
          </button>
        </>
      }
    >
      <p className="cr-text cr-text--sm">{consequence}</p>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- Drawer */

export function Drawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children?: React.ReactNode;
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  useOverlayBehaviour(open, onClose, panelRef);

  if (!open) return null;

  return (
    <div
      className="cr-overlay cr-overlay--drawer"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="cr-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cr-drawer-title"
        tabIndex={-1}
      >
        <div className="cr-drawer__header">
          <h2 className="cr-drawer__title" id="cr-drawer-title">
            {title}
          </h2>
          <button
            type="button"
            className="cr-button cr-button--ghost cr-button--sm"
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
            <span className="cr-visually-hidden">Close</span>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Menu */

export type MenuItem = {
  label: React.ReactNode;
  onSelect?: () => void;
  href?: string;
  destructive?: boolean;
};

export function Menu({
  trigger,
  items,
  label,
}: {
  trigger: React.ReactNode;
  items: MenuItem[];
  label: string;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;

    function onDocDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="cr-menu" ref={rootRef}>
      <button
        type="button"
        className="cr-button cr-button--secondary cr-button--sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {trigger}
      </button>

      {open ? (
        <ul className="cr-menu__list" role="menu" aria-label={label}>
          {items.map((item, i) => (
            <li key={i} role="none">
              {item.href ? (
                <a
                  role="menuitem"
                  href={item.href}
                  className={cn(
                    "cr-menu__item",
                    item.destructive && "cr-menu__item--destructive"
                  )}
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </a>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  className={cn(
                    "cr-menu__item",
                    item.destructive && "cr-menu__item--destructive"
                  )}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect?.();
                  }}
                >
                  {item.label}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

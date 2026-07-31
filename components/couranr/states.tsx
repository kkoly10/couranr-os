import * as React from "react";
import { cn } from "@/lib/cn";
import { Button } from "./primitives";

/**
 * The required UI states from UI_SCREEN_REGISTRY.md §6.
 *
 * Two rules are enforced by construction here:
 *   - a loading skeleton PRESERVES PAGE STRUCTURE and never flashes
 *     unauthorized data, so skeletons take a shape, not a data payload;
 *   - permission-denied and tenant-mismatch states REVEAL NO EXISTENCE or
 *     private detail, so PermissionDeniedState accepts no record identifier
 *     and renders a fixed message.
 */

/* -------------------------------------------------------------- Skeleton */

export function Skeleton({
  variant = "text",
  width,
  className,
  ...rest
}: React.HTMLAttributes<HTMLSpanElement> & {
  variant?: "text" | "title" | "block";
  width?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("cr-skeleton", `cr-skeleton--${variant}`, className)}
      style={{ display: "block", width, ...rest.style }}
      {...rest}
    />
  );
}

/**
 * Wraps a skeleton in a live region so assistive technology is told the page
 * is loading rather than being read an empty document.
 */
export function LoadingState({
  label = "Loading",
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="cr-visually-hidden">{label}</span>
      {children}
    </div>
  );
}

/** Structure-preserving default: a card-shaped skeleton. */
export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="cr-card">
      <Skeleton variant="title" width="45%" />
      <div style={{ height: 16 }} />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? "60%" : "100%"} />
      ))}
    </div>
  );
}

export function TableSkeleton({
  rows = 5,
  columns = 4,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div className="cr-card cr-card--flush">
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="cr-cluster cr-cluster--4"
          style={{ padding: "12px 16px", borderBottom: "1px solid var(--couranr-border)" }}
        >
          {Array.from({ length: columns }).map((__, c) => (
            <Skeleton key={c} width={`${100 / columns - 4}%`} />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------- Result states */

type StateAction = {
  label: string;
  onClick?: () => void;
  href?: string;
};

function StateShell({
  icon,
  tone,
  title,
  body,
  action,
  role = "status",
}: {
  icon: string;
  tone?: "success" | "danger" | "warning";
  title: React.ReactNode;
  body?: React.ReactNode;
  action?: StateAction;
  role?: "status" | "alert";
}) {
  return (
    <div className="cr-state" role={role}>
      <span
        className={cn("cr-state__icon", tone && `cr-state__icon--${tone}`)}
        aria-hidden="true"
      >
        {icon}
      </span>
      <h2 className="cr-state__title">{title}</h2>
      {body ? <p className="cr-state__body">{body}</p> : null}
      {action ? (
        <div className="cr-state__actions">
          {action.href ? (
            <a className="cr-button cr-button--secondary" href={action.href}>
              {action.label}
            </a>
          ) : (
            <Button variant="secondary" onClick={action.onClick}>
              {action.label}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** §6: one clear next action, and no fake sample metrics. */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: React.ReactNode;
  body?: React.ReactNode;
  action?: StateAction;
}) {
  return <StateShell icon="+" title={title} body={body} action={action} />;
}

export function ErrorState({
  title = "Something went wrong",
  body = "This did not load. Try again, and contact Couranr Support if it keeps happening.",
  action,
}: {
  title?: React.ReactNode;
  body?: React.ReactNode;
  action?: StateAction;
}) {
  return (
    <StateShell
      icon="!"
      tone="danger"
      role="alert"
      title={title}
      body={body}
      action={action}
    />
  );
}

export function SuccessState({
  title,
  body,
  action,
}: {
  title: React.ReactNode;
  body?: React.ReactNode;
  action?: StateAction;
}) {
  return (
    <StateShell icon="✓" tone="success" title={title} body={body} action={action} />
  );
}

/**
 * §6: reveals no existence or private detail.
 *
 * Deliberately takes no record id, tenant name, or owner — the copy is fixed so
 * a caller cannot leak "this delivery exists but is not yours" by passing a
 * detail through. Same reason /api/delivery/photo-url returns an identical 403
 * for a missing and an unauthorized delivery.
 */
export function PermissionDeniedState({ action }: { action?: StateAction }) {
  return (
    <StateShell
      icon="—"
      tone="warning"
      role="alert"
      title="You do not have access to this"
      body="Check that you are signed in to the right Couranr account. If you think this is a mistake, contact Couranr Support."
      action={action}
    />
  );
}

/** §6: concurrent-update / version-conflict state. */
export function ConflictState({ action }: { action?: StateAction }) {
  return (
    <StateShell
      icon="!"
      tone="warning"
      role="alert"
      title="This changed while you were working"
      body="Someone else updated this record. Reload to see the current version before trying again."
      action={action}
    />
  );
}

/** §6: network failure and retry. */
export function OfflineState({ action }: { action?: StateAction }) {
  return (
    <StateShell
      icon="!"
      tone="warning"
      role="alert"
      title="You appear to be offline"
      body="Your work is kept on this device and will sync when the connection returns."
      action={action}
    />
  );
}

import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Couranr canonical UI primitives — presentational only.
 *
 * Authority: UI_SCREEN_REGISTRY.md §2 (visual system), §6 (required states),
 * §7 (responsive and accessibility).
 *
 * Every class is `cr-`-prefixed and every token is `--couranr-*`, scoped under
 * `.cr-root`. Nothing here can restyle a legacy auto/docs page.
 *
 * These are server-safe: no hooks, no "use client". Interactive primitives that
 * need state live in `components/couranr/interactive.tsx`.
 */

/* ---------------------------------------------------------------- Layout */

export function Container({
  width = "default",
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & {
  width?: "default" | "narrow" | "full";
}) {
  return (
    <div
      className={cn(
        "cr-container",
        width === "narrow" && "cr-container--narrow",
        width === "full" && "cr-container--full",
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function Stack({
  gap = 4,
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { gap?: 1 | 2 | 3 | 4 | 6 | 8 }) {
  return (
    <div className={cn("cr-stack", `cr-stack--${gap}`, className)} {...rest}>
      {children}
    </div>
  );
}

export function Cluster({
  gap = 3,
  justify,
  align,
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & {
  gap?: 2 | 3 | 4;
  justify?: "between" | "end";
  align?: "start";
}) {
  return (
    <div
      className={cn(
        "cr-cluster",
        `cr-cluster--${gap}`,
        justify === "between" && "cr-cluster--between",
        justify === "end" && "cr-cluster--end",
        align === "start" && "cr-cluster--start-align",
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function Grid({
  columns = 3,
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { columns?: 2 | 3 | 4 }) {
  return (
    <div className={cn("cr-grid", `cr-grid--${columns}`, className)} {...rest}>
      {children}
    </div>
  );
}

export function Divider(props: React.HTMLAttributes<HTMLHRElement>) {
  return <hr {...props} className={cn("cr-divider", props.className)} />;
}

/* ------------------------------------------------------------ Typography */

export function Heading({
  level = 2,
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLHeadingElement> & { level?: 1 | 2 | 3 | 4 }) {
  const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4";
  return (
    <Tag className={cn("cr-heading", `cr-heading--${level}`, className)} {...rest}>
      {children}
    </Tag>
  );
}

export function Text({
  size,
  muted,
  strong,
  numeric,
  as: Tag = "p",
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLElement> & {
  size?: "xs" | "sm";
  muted?: boolean;
  strong?: boolean;
  numeric?: boolean;
  as?: "p" | "span" | "div";
}) {
  return (
    <Tag
      className={cn(
        "cr-text",
        size && `cr-text--${size}`,
        muted && "cr-text--muted",
        strong && "cr-text--strong",
        numeric && "cr-text--numeric",
        className
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function VisuallyHidden({ children }: { children: React.ReactNode }) {
  return <span className="cr-visually-hidden">{children}</span>;
}

/* ------------------------------------------------------------------ Card */

export function Card({
  padding = "default",
  elevation = "default",
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & {
  padding?: "default" | "flush";
  elevation?: "default" | "raised" | "quiet";
}) {
  return (
    <div
      className={cn(
        "cr-card",
        padding === "flush" && "cr-card--flush",
        elevation === "raised" && "cr-card--raised",
        elevation === "quiet" && "cr-card--quiet",
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  actions,
  titleId,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  titleId?: string;
}) {
  return (
    <div className="cr-card__header">
      <div>
        <h3 className="cr-card__title" id={titleId}>
          {title}
        </h3>
        {description ? <p className="cr-card__description">{description}</p> : null}
      </div>
      {actions ? <div className="cr-cluster cr-cluster--2">{actions}</div> : null}
    </div>
  );
}

export function CardFooter({ children }: { children: React.ReactNode }) {
  return <div className="cr-card__footer">{children}</div>;
}

/* ---------------------------------------------------------------- Button */

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "destructive"
  | "link";

export function buttonClassName(opts: {
  variant?: ButtonVariant;
  size?: "sm" | "default";
  block?: boolean;
  className?: string;
}) {
  const { variant = "secondary", size = "default", block, className } = opts;
  return cn(
    "cr-button",
    `cr-button--${variant}`,
    size === "sm" && "cr-button--sm",
    block && "cr-button--block",
    className
  );
}

export function Button({
  variant = "secondary",
  size = "default",
  block,
  loading,
  loadingLabel = "Working…",
  className,
  children,
  disabled,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "default";
  block?: boolean;
  loading?: boolean;
  loadingLabel?: string;
}) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClassName({ variant, size, block, className })}
    >
      {loading ? (
        <>
          <span className="cr-button__spinner" aria-hidden="true" />
          <span>{loadingLabel}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

/* ----------------------------------------------------------------- Badge */

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

/**
 * §7 forbids colour-only status meaning, so the label is required and a shape
 * cue (the dot) accompanies the tone.
 */
export function Badge({
  tone = "neutral",
  children,
  className,
  ...rest
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span className={cn("cr-badge", `cr-badge--${tone}`, className)} {...rest}>
      <span className="cr-badge__dot" aria-hidden="true" />
      {children}
    </span>
  );
}

/* ----------------------------------------------------------------- Alert */

const ALERT_ICON: Record<BadgeTone, string> = {
  neutral: "i",
  info: "i",
  success: "✓",
  warning: "!",
  danger: "!",
};

export function Alert({
  tone = "info",
  title,
  children,
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & {
  tone?: Exclude<BadgeTone, "neutral">;
  title?: React.ReactNode;
}) {
  // Errors and warnings are announced assertively; informational ones politely.
  const assertive = tone === "danger" || tone === "warning";
  return (
    <div
      role={assertive ? "alert" : "status"}
      aria-live={assertive ? "assertive" : "polite"}
      className={cn("cr-alert", `cr-alert--${tone}`, className)}
      {...rest}
    >
      <span className="cr-alert__icon" aria-hidden="true">
        {ALERT_ICON[tone]}
      </span>
      <div className="cr-alert__body">
        {title ? <p className="cr-alert__title">{title}</p> : null}
        <div className="cr-alert__message">{children}</div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Table */

export function TableScroll({ children }: { children: React.ReactNode }) {
  // §7: wide content scrolls inside its own container; the page never scrolls
  // horizontally. tabIndex makes the scroll region keyboard-reachable.
  return (
    <div className="cr-table-scroll" tabIndex={0} role="region">
      {children}
    </div>
  );
}

export function Table({
  caption,
  numeric,
  className,
  children,
  ...rest
}: React.TableHTMLAttributes<HTMLTableElement> & {
  caption?: React.ReactNode;
  numeric?: boolean;
}) {
  return (
    <table
      className={cn("cr-table", numeric && "cr-table--numeric", className)}
      {...rest}
    >
      {caption ? <caption>{caption}</caption> : null}
      {children}
    </table>
  );
}

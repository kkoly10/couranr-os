import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { CouranrLogo } from "@/components/brand/CouranrLogo";
import { Container, Heading, Text } from "@/components/couranr/primitives";

/**
 * Shared shell pieces. Server-safe; interactive navigation lives in
 * `components/couranr/shell/MobileNav.tsx`.
 */

export const MAIN_CONTENT_ID = "cr-main";

/** §7: skip-to-content. First tabbable element in every shell. */
export function SkipLink() {
  return (
    <a className="cr-skip-link" href={`#${MAIN_CONTENT_ID}`}>
      Skip to main content
    </a>
  );
}

/**
 * The Couranr wordmark.
 *
 * This used to render the literal text `couranr` — directly under a comment
 * saying "never redraw or substitute". BRAND_GUIDE.md from
 * Couranr_Canonical_Logo_System_v1.zip prohibits exactly that: "Do not type
 * `couranr` with a font as a substitute for the outlined SVG." It now renders
 * the approved outlined SVG.
 *
 * `tone` describes the BACKGROUND this sits on, not the logo colour, so callers
 * cannot get the pairing backwards. `.cr-sidebar` and the mobile drawer are
 * `--couranr-navy`, so they pass "dark" and receive the reverse wordmark; the
 * topbar and token bar are `--couranr-surface` and take the primary.
 */
export function Wordmark({
  href = "/",
  className,
  tone = "light",
  width = 132,
}: {
  href?: string;
  className?: string;
  tone?: "light" | "dark";
  width?: number;
}) {
  return (
    <Link href={href} className={cn("cr-wordmark", className)} aria-label="Couranr">
      <CouranrLogo variant={tone === "dark" ? "reverse" : "primary"} width={width} />
    </Link>
  );
}

/**
 * The <main> landmark every shell wraps its page in. tabIndex={-1} makes it a
 * valid target for the skip link without putting it in the tab sequence.
 */
export function ShellMain({
  children,
  contained = true,
}: {
  children: React.ReactNode;
  contained?: boolean;
}) {
  const inner = <div className="cr-shell__content">{children}</div>;
  return (
    <main id={MAIN_CONTENT_ID} tabIndex={-1} className="cr-shell__main">
      {contained ? <Container>{inner}</Container> : inner}
    </main>
  );
}

export type Crumb = { label: string; href?: string };

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  breadcrumbs?: Crumb[];
  actions?: React.ReactNode;
}) {
  return (
    <div className="cr-page-header">
      <div>
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <nav aria-label="Breadcrumb">
            <ol className="cr-breadcrumb">
              {breadcrumbs.map((c, i) => {
                const last = i === breadcrumbs.length - 1;
                return (
                  <li key={`${c.label}-${i}`}>
                    {c.href && !last ? (
                      <Link href={c.href}>{c.label}</Link>
                    ) : (
                      <span aria-current={last ? "page" : undefined}>{c.label}</span>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
        ) : null}

        <Heading level={1}>{title}</Heading>
        {description ? (
          <Text muted style={{ marginTop: "var(--couranr-space-2)" }}>
            {description}
          </Text>
        ) : null}
      </div>

      {actions ? <div className="cr-cluster cr-cluster--2">{actions}</div> : null}
    </div>
  );
}

/**
 * Neutral placeholder for a registered-but-unbuilt screen.
 *
 * Deliberately states no pricing, mileage, hours, market, payer, refund or
 * payment behaviour — those are Decision Registry concerns and are not settled.
 */
export function ScreenPlaceholder({
  screenId,
  name,
  purpose,
}: {
  screenId: string;
  name: string;
  purpose?: string;
}) {
  return (
    <div className="cr-placeholder">
      <span className="cr-placeholder__id">{screenId}</span>
      <Heading level={3} style={{ marginTop: "var(--couranr-space-2)" }}>
        {name}
      </Heading>
      {purpose ? (
        <Text muted size="sm" style={{ marginTop: "var(--couranr-space-2)" }}>
          {purpose}
        </Text>
      ) : null}
      <Text size="sm" muted style={{ marginTop: "var(--couranr-space-4)" }}>
        This screen is registered in the canonical MVP registry and its shell is
        in place. The screen itself is not built yet.
      </Text>
    </div>
  );
}

export function AccountBlock({
  name,
  meta,
  onNavy,
}: {
  name: string;
  meta?: string;
  onNavy?: boolean;
}) {
  return (
    <div className={cn("cr-account", onNavy && "cr-account--on-navy")}>
      <div>
        <div className="cr-account__name">{name}</div>
        {meta ? <div className="cr-account__meta">{meta}</div> : null}
      </div>
    </div>
  );
}

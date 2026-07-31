import * as React from "react";
import Link from "next/link";
import { navigationFor } from "@/lib/couranr/navigation";
import { Container, Text } from "@/components/couranr/primitives";
import {
  DriverTabBar,
  MobileNav,
  SidebarNav,
  TopbarNav,
} from "./MobileNav";
import { AccountBlock, ShellMain, SkipLink, Wordmark } from "./parts";
import { SignOutButton } from "@/components/couranr/auth/SignOutButton";

/**
 * The five canonical application shells.
 *
 * Navigation for each is derived by `navigationFor(role)`, which filters the
 * canonical screen registry by surface — so a shell structurally cannot link to
 * another role's routes.
 *
 * No shell renders pricing, mileage, hours, market, payer, refund or payment
 * copy. Those are Decision Registry concerns and remain unresolved.
 */

/* ------------------------------------------------------------ 1. Public */

export function PublicShell({ children }: { children: React.ReactNode }) {
  const items = navigationFor("public");

  return (
    <div className="cr-shell">
      <SkipLink />

      <header className="cr-topbar">
        <Container>
          <div className="cr-topbar__inner">
            <Wordmark />

            <TopbarNav items={items} label="Main navigation" />

            <div className="cr-topbar__actions">
              <Link href="/sign-in" className="cr-button cr-button--ghost cr-button--sm">
                Sign in
              </Link>
              <Link href="/sign-up" className="cr-button cr-button--primary cr-button--sm">
                Create business account
              </Link>
              <span className="cr-topbar__toggle">
                <MobileNav
                  items={items}
                  label="Main navigation"
                  triggerClassName="cr-icon-button cr-icon-button--on-surface"
                />
              </span>
            </div>
          </div>
        </Container>
      </header>

      <ShellMain>{children}</ShellMain>

      <footer className="cr-container" style={{ paddingBlock: "var(--couranr-space-8)" }}>
        <Text size="xs" muted>
          Couranr — local delivery infrastructure for local businesses.
        </Text>
      </footer>
    </div>
  );
}

/* -------------------------------------------------- 2. Customer (token) */

/**
 * Token-scoped customer shell.
 *
 * All eight CUS screens are fragments of /pay/[token], /track/[token] and
 * /help/[token], and §3 states customer accounts are optional — so this shell
 * has NO global navigation, NO account menu and NO sign-out. `navigationFor`
 * returns an empty list for this role by design.
 *
 * The token is never rendered into navigation, a heading or a link label.
 */
export function CustomerTokenShell({
  children,
  reference,
  helpHref,
}: {
  children: React.ReactNode;
  /** A human-facing delivery reference. Never the access token. */
  reference?: string;
  helpHref?: string;
}) {
  return (
    <div className="cr-shell">
      <SkipLink />

      <header className="cr-tokenbar">
        <Container width="narrow">
          <div className="cr-tokenbar__inner">
            <Wordmark href="#" />
            {reference ? (
              <Text size="sm" muted numeric>
                {reference}
              </Text>
            ) : null}
            {helpHref ? (
              <Link href={helpHref} className="cr-button cr-button--ghost cr-button--sm">
                Get help
              </Link>
            ) : null}
          </div>
        </Container>
      </header>

      <main id="cr-main" tabIndex={-1} className="cr-shell__main">
        <Container width="narrow">
          <div className="cr-shell__content">{children}</div>
        </Container>
      </main>
    </div>
  );
}

/* ---------------------------------------------------------- 3. Merchant */

export function MerchantShell({
  children,
  accountName = "Your business",
  accountMeta,
}: {
  children: React.ReactNode;
  accountName?: string;
  accountMeta?: string;
}) {
  const items = navigationFor("merchant");
  const signOut = <SignOutButton />;

  return (
    <div className="cr-shell cr-shell--sidebar">
      <SkipLink />

      <aside className="cr-sidebar">
        <div className="cr-sidebar__brand">
          <div>
            <Wordmark href="/business" tone="dark" />
            <div className="cr-sidebar__role">Merchant</div>
          </div>
        </div>

        <SidebarNav items={items} label="Merchant navigation" />

        <div className="cr-sidebar__footer">
          <AccountBlock name={accountName} meta={accountMeta} onNavy />
          {signOut}
        </div>
      </aside>

      <div className="cr-shell" style={{ flex: "1 1 auto", minWidth: 0 }}>
        <header className="cr-appbar">
          <div className="cr-appbar__inner">
            <MobileNav
              items={items}
              label="Merchant navigation"
              roleLabel="Merchant"
              homeHref="/business"
              footer={
                <>
                  <AccountBlock name={accountName} meta={accountMeta} onNavy />
                  {signOut}
                </>
              }
            />
            <Wordmark href="/business" tone="dark" />
            <span style={{ width: 44 }} aria-hidden="true" />
          </div>
        </header>

        <ShellMain>{children}</ShellMain>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ 4. Driver */

/**
 * Driver field shell — mobile primary (§7).
 *
 * Deliberately NOT a shrunken merchant sidebar: a compact bar carrying the
 * current assignment context, a full-width content area, and a bottom tab bar
 * with large targets. Navigation is intentionally short so the primary delivery
 * actions on the screen stay the focus.
 */
export function DriverShell({
  children,
  driverName = "Driver",
  statusLabel,
}: {
  children: React.ReactNode;
  driverName?: string;
  statusLabel?: string;
}) {
  const items = navigationFor("driver");

  return (
    <div className="cr-shell cr-shell--driver">
      <SkipLink />

      <header className="cr-driverbar">
        <div className="cr-driverbar__inner">
          <div>
            <Wordmark href="/driver" tone="dark" />
            <div className="cr-sidebar__role">{driverName}</div>
          </div>
          <div className="cr-cluster cr-cluster--2">
            {statusLabel ? (
              <span className="cr-badge cr-badge--neutral">
                <span className="cr-badge__dot" aria-hidden="true" />
                {statusLabel}
              </span>
            ) : null}
            {/* A shared device needs this reachable without a menu. */}
            <SignOutButton className="cr-signout--compact" />
          </div>
        </div>
      </header>

      <main id="cr-main" tabIndex={-1} className="cr-shell__main">
        <Container>
          <div className="cr-shell__content">{children}</div>
        </Container>
      </main>

      <DriverTabBar items={items} />
    </div>
  );
}

/* -------------------------------------------------------- 5. Operations */

/**
 * Couranr Operations shell — desktop primary, information dense (§7).
 *
 * The rail narrows between 1024px and 1280px rather than disappearing, so a
 * narrow desktop or landscape tablet keeps its navigation. Below 1024px it
 * becomes the drawer.
 */
export function OperationsShell({
  children,
  operatorName = "Couranr Operations",
  operatorMeta,
}: {
  children: React.ReactNode;
  operatorName?: string;
  operatorMeta?: string;
}) {
  const items = navigationFor("operations");
  const signOut = <SignOutButton />;

  return (
    <div className="cr-shell cr-shell--sidebar">
      <SkipLink />

      <aside className="cr-sidebar">
        <div className="cr-sidebar__brand">
          <div>
            <Wordmark href="/operations" tone="dark" />
            <div className="cr-sidebar__role">Operations</div>
          </div>
        </div>

        <SidebarNav items={items} label="Operations navigation" />

        <div className="cr-sidebar__footer">
          <AccountBlock name={operatorName} meta={operatorMeta} onNavy />
          {signOut}
        </div>
      </aside>

      <div className="cr-shell" style={{ flex: "1 1 auto", minWidth: 0 }}>
        <header className="cr-appbar">
          <div className="cr-appbar__inner">
            <MobileNav
              items={items}
              label="Operations navigation"
              roleLabel="Operations"
              homeHref="/operations"
              footer={
                <>
                  <AccountBlock name={operatorName} meta={operatorMeta} onNavy />
                  {signOut}
                </>
              }
            />
            <Wordmark href="/operations" tone="dark" />
            <span style={{ width: 44 }} aria-hidden="true" />
          </div>
        </header>

        <ShellMain contained={false}>
          <Container width="full">{children}</Container>
        </ShellMain>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- Sign out */

/**
 * Sign-out lives in the shell footer, below account identity, in both the
 * sidebar and the drawer — one consistent placement per shell.
 *
 * It is `components/couranr/auth/SignOutButton`, which terminates the Supabase
 * session and only then navigates. It used to be a `<Link href="/login">`,
 * which navigated and left the session live; the next visit to any merchant
 * page walked straight back in.
 *
 * The customer token shell deliberately has none: that surface is reached by a
 * per-delivery link, not a session, so there is nothing to sign out of.
 */

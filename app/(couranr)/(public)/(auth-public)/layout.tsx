import * as React from "react";
import { MAIN_CONTENT_ID, SkipLink } from "@/components/couranr/shell/parts";

/**
 * The auth entry points carry NO public chrome.
 *
 * PUB-002's canonical artboard (E3473C54-A4FF-41AD-BFF8-191C4F0F28AF.png,
 * `visual_authority: canonical` in VISUAL_AUTHORITY_REGISTRY.json) is a
 * full-bleed two-column composition and nothing else: no header, no marketing
 * navigation, no footer. The screen sat in `(business-public)` and therefore
 * inherited `PublicShell variant="business"` — a sticky topbar with five
 * marketing links and two competing calls to action above a form whose whole
 * job is one decision. Owner instruction 2026-09-06: no top nav bar on sign in.
 *
 * A nested layout COMPOSES with its parent rather than replacing it, so a
 * layout inside `sign-in/` could not have removed the shell. The chrome is
 * chosen by which route group a page lives in — the pattern
 * `(public)/layout.tsx` documents and `(business-public)`, `(master-public)`,
 * `(consumer-public)` and `(token-public)` already follow — so removing the
 * chrome means a group that renders none. Route groups are organizational:
 * `/sign-in` is still `/sign-in`.
 *
 * A SERVER layout, like its four siblings. Nothing here reads `usePathname()`
 * and nothing crosses into the client bundle.
 *
 * What the shell was still providing, and what is kept by hand here:
 *
 *  - the `<main>` landmark and the skip link (§7 wants it first-tabbable in
 *    every shell, and a page with no header needs it no less);
 *  - `data-couranr-surface="public"`, which §13 binds typography through. No
 *    rule selects the `public` value today; dropping the hook would make this
 *    the one public screen a future public-only rule could not reach.
 *
 * `.cr-shell__content` is deliberately NOT rendered. It carries the vertical
 * pad every other page wants and this one must not have — the split runs to
 * all four edges — and `.cr-container` is absent for the same reason.
 *
 * The wordmark is the way back to the marketing site now that the header is
 * gone: `<Wordmark />` links to `/` on both panels of the page.
 */
export default function AuthPublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="cr-shell" data-couranr-surface="public" data-couranr-chrome="auth">
      <SkipLink />
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="cr-shell__main">
        {children}
      </main>
    </div>
  );
}

import * as React from "react";

/**
 * The public parent layout owns NO chrome.
 *
 * It used to wrap every route in this group in one `PublicShell`, which was
 * right while the public surface was one brand. MKT-004 made Couranr one master
 * brand with two entry paths, so `/`, `/business` and `/sameday` need three
 * different headers — and a single unconditional wrapper cannot provide them.
 *
 * The alternative was a client boundary reading `usePathname()` to pick chrome
 * at render time. That would pull the public header and footer into the client
 * bundle to answer a question the filesystem answers for free. Instead each
 * nested route GROUP carries its own server layout and states its variant
 * explicitly. Route groups are organizational: `(business-public)/business`
 * still serves `/business`, and no URL changes because of this file.
 *
 * NO SERVICE-AREA BAR anywhere below this. Both PUB-001 artboards show a
 * full-bleed notice above the header and this layout once filled it with
 * MKT-001's markets sentence; the owner removed it on 2026-08-29 at both widths
 * and the screen authority was amended to match. The sentence is not orphaned —
 * PUB-001 renders it in its service-areas card and PUB-010 renders it twice.
 */
export default function PublicGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

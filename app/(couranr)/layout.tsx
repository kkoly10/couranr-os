import * as React from "react";
import "./couranr.css";

/**
 * Canonical Couranr route group.
 *
 * A route group `(couranr)` does not appear in the URL, so canonical routes
 * live at their registry paths (`/business`, `/operations`, `/track/[token]`)
 * while sharing this layout.
 *
 * ADDITIVE: this layout adds a `.cr-root` wrapper and imports the canonical
 * stylesheet. Every token is `--couranr-*` and every rule is scoped under
 * `.cr-root`, so legacy auto/docs pages are unaffected even though
 * app/globals.css is still loaded by the root layout above this one.
 */
export default function CouranrLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="cr-root cr-surface-canvas">{children}</div>;
}

import * as React from "react";
import "./couranr.css";
import "./shell.css";

/**
 * Canonical Couranr route group.
 *
 * A route group `(couranr)` does not appear in the URL, so canonical routes
 * live at their registry paths (`/app/business`, `/operations`, `/track/[token]`)
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
  return (
    <>
      {/*
        Preload the display face only. It sets the hero — the LCP element on
        PUB-001 — and `font-display: swap` without a preload means that
        headline paints in a fallback and then reflows, which is the CLS the
        visual system's §10.1 asks to be checked for ("layout is stable after
        font load").

        Only this one: Inter is body copy, so a late swap there costs far less
        than a second render-blocking request, and Martian Mono renders
        identifiers that are usually below the fold. Preloading all three would
        make the cheap case pay for the expensive one.

        React hoists this into <head> and dedupes it across the route group.
      */}
      <link
        rel="preload"
        href="/fonts/MartianGrotesk-Variable.woff2"
        as="font"
        type="font/woff2"
        crossOrigin="anonymous"
      />
      <div className="cr-root cr-surface-canvas">{children}</div>
    </>
  );
}

// `"jsx": "preserve"` in tsconfig means the classic transform: React must be
// in scope explicitly, as every sibling component does.
import * as React from "react";
import Image from "next/image";

/**
 * The Couranr wordmark.
 *
 * Source: `Couranr_Canonical_Logo_System_v1.zip` → `CouranrLogo.tsx`, which
 * BRAND_GUIDE.md calls "the only approved source for the Couranr logo".
 *
 * The API is the supplied one, unchanged. ONE deviation from the file as
 * shipped, and it is load-bearing: `unoptimized`.
 *
 *   next/image routes every source through the image optimizer, which REFUSES
 *   SVG unless `images.dangerouslyAllowSVG` is set. That flag is off here and
 *   turning it on would relax SVG handling for the whole app to fix one
 *   component. `unoptimized` serves the file verbatim instead — scoped, and
 *   correct regardless: an outlined SVG gains nothing from raster optimization.
 *
 * Brand rules this component exists to enforce (BRAND_GUIDE.md, "Prohibited"):
 *   - never type `couranr` in a font as a substitute for the outlined SVG
 *   - never use the retired `C.` header logo or a map-pin mark
 *   - never recolor, rotate or redraw the gold accent
 *   - never stretch: the 900×250 aspect ratio is fixed below
 *
 * Use `primary` on light backgrounds and `reverse` on dark or photographic
 * ones. The guide is explicit that the navy logo must not sit on photography.
 */

type CouranrLogoProps = {
  variant?:
    | "primary"
    | "reverse"
    | "monochrome-navy"
    | "monochrome-white"
    /**
     * The approved app/favicon/social mark, added 2026-08-28 so a process
     * diagram can carry a Couranr node.
     *
     * It exists because the alternatives are all prohibited. BRAND_GUIDE.md
     * bans a map-pin/C symbol (:53) and bans placing the logo inside a pill or
     * badge (:57) — so the wordmark cannot be dropped into a circular node to
     * match the other markers in a flow, and the pin mark the concept board
     * used cannot be drawn at all. The app mark is the one approved asset whose
     * container is INTRINSIC: the navy squircle is the artwork's own first
     * path, not a chip added around a logo.
     *
     * Never wrap this in a ring, circle or chip. That re-creates :57.
     */
    | "app-icon";
  width?: number;
  priority?: boolean;
  className?: string;
};

const sourceByVariant = {
  primary: "/brand/couranr-logo-primary.svg",
  reverse: "/brand/couranr-logo-reverse.svg",
  "monochrome-navy": "/brand/couranr-logo-monochrome-navy.svg",
  "monochrome-white": "/brand/couranr-logo-monochrome-white.svg",
  "app-icon": "/brand/couranr-app-icon.svg",
} as const;

/** The wordmark SVGs are viewBox="0 0 900 250". Never diverge from this ratio. */
const WORDMARK_ASPECT = 250 / 900;
/** The app mark is viewBox="0 0 512 512" — square, so its own aspect is 1. */
const APP_ICON_ASPECT = 1;
/** The guide's floor for the app mark. Below it the gold accent is a sliver. */
const APP_ICON_MIN_WIDTH = 24;

export function CouranrLogo({
  variant = "primary",
  width = 168,
  priority = false,
  className,
}: CouranrLogoProps) {
  const isAppIcon = variant === "app-icon";
  const aspect = isAppIcon ? APP_ICON_ASPECT : WORDMARK_ASPECT;
  // The guide sets "App icon minimum: 24 px". Clamping rather than trusting the
  // caller, because the failure is silent: at 16px the gold motion accent
  // renders as a ~2px sliver and the mark reads as a plain navy square.
  const w = isAppIcon ? Math.max(width, APP_ICON_MIN_WIDTH) : width;
  return (
    <Image
      src={sourceByVariant[variant]}
      alt="Couranr"
      width={w}
      height={Math.round(w * aspect)}
      priority={priority}
      unoptimized
      className={className}
    />
  );
}

export default CouranrLogo;

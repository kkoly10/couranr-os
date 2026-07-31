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
  variant?: "primary" | "reverse" | "monochrome-navy" | "monochrome-white";
  width?: number;
  priority?: boolean;
  className?: string;
};

const sourceByVariant = {
  primary: "/brand/couranr-logo-primary.svg",
  reverse: "/brand/couranr-logo-reverse.svg",
  "monochrome-navy": "/brand/couranr-logo-monochrome-navy.svg",
  "monochrome-white": "/brand/couranr-logo-monochrome-white.svg",
} as const;

/** The supplied SVGs are viewBox="0 0 900 250". Never diverge from this ratio. */
const ASPECT = 250 / 900;

export function CouranrLogo({
  variant = "primary",
  width = 168,
  priority = false,
  className,
}: CouranrLogoProps) {
  return (
    <Image
      src={sourceByVariant[variant]}
      alt="Couranr"
      width={width}
      height={Math.round(width * ASPECT)}
      priority={priority}
      unoptimized
      className={className}
    />
  );
}

export default CouranrLogo;

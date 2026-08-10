import * as React from "react";

/**
 * Line icons for the PUB-001 marketing surface.
 *
 * The approved mock renders the order-channel list and the hero trust row as
 * icon cards, not as text chips — see docs/couranr-mvp/MOCK_TO_SCREEN_MAP.md.
 * These are drawn to the mock's weight (1.6px stroke on a 24px grid, round
 * caps) and inherit `currentColor`, so a card can recolour them without a
 * second asset.
 *
 * Inline SVG rather than files in public/: each is under 300 bytes, there are
 * ten of them, and shipping them in the RSC payload avoids ten render-blocking
 * requests on the one page that must paint fastest.
 *
 * No third-party brand marks. The mock shows Instagram and Facebook glyphs, but
 * MKT-002 §10.4 names the channel generically as "Social media" and the
 * authorities are the copy authority — so this renders the governed channel
 * name with a neutral glyph rather than someone else's trademark.
 *
 * Decorative by default: every icon is aria-hidden and the card's text label
 * carries the meaning.
 */

type IconProps = { className?: string };

function Svg({ children, className }: React.PropsWithChildren<IconProps>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  );
}

export function IconGlobe(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18-2.5-2.6-2.5-15.4 0-18Z" />
    </Svg>
  );
}

export function IconPhone(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8.4 3.6H6a2.4 2.4 0 0 0-2.4 2.6c.5 6.9 6.9 13.3 13.8 13.8a2.4 2.4 0 0 0 2.6-2.4v-2.4l-4.2-1.2-1.8 1.8a13.7 13.7 0 0 1-5.4-5.4l1.8-1.8Z" />
    </Svg>
  );
}

export function IconChat(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20 14.4a2.4 2.4 0 0 1-2.4 2.4H8L4 20.4V6a2.4 2.4 0 0 1 2.4-2.4h11.2A2.4 2.4 0 0 1 20 6Z" />
    </Svg>
  );
}

export function IconShare(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="18" cy="5.5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="18.5" r="2.5" />
      <path d="M8.2 10.8 15.8 6.7M8.2 13.2l7.6 4.1" />
    </Svg>
  );
}

export function IconTerminal(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M3 9h18M7 20h10" />
    </Svg>
  );
}

export function IconStore(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 9.5V20h16V9.5M3 9.5 4.8 4h14.4L21 9.5a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0Z" />
      <path d="M10 20v-5h4v5" />
    </Svg>
  );
}

export function IconPlusCircle(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8.5v7M8.5 12h7" />
    </Svg>
  );
}

export function IconTag(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.6 11.2V4.8a1.2 1.2 0 0 1 1.2-1.2h6.4l8.4 8.4a1.7 1.7 0 0 1 0 2.4l-5.2 5.2a1.7 1.7 0 0 1-2.4 0Z" />
      <circle cx="7.8" cy="7.8" r="1.2" />
    </Svg>
  );
}

export function IconPerson(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
    </Svg>
  );
}

export function IconNoFee(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M14.6 9.3c-.5-.8-1.5-1.3-2.6-1.3-1.6 0-2.8.9-2.8 2.1 0 3 5.6 1.5 5.6 4.2 0 1.2-1.2 2.1-2.8 2.1-1.2 0-2.2-.5-2.7-1.4" />
    </Svg>
  );
}

export function IconBox(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20.4 7.8v8.4L12 20.9l-8.4-4.7V7.8L12 3.1Z" />
      <path d="M3.6 7.8 12 12.5l8.4-4.7M12 12.5v8.4" />
    </Svg>
  );
}

export function IconTruck(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2.8 6.6h10.4v9.2H2.8ZM13.2 9.6h3.6l3.4 3.2v3H13.2Z" />
      <circle cx="7" cy="17.8" r="1.8" />
      <circle cx="17" cy="17.8" r="1.8" />
    </Svg>
  );
}

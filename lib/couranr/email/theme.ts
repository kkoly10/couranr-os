/**
 * Couranr transactional email — brand theme + configuration.
 *
 * Values are the CANONICAL brand tokens (app/(couranr)/couranr.css), NOT the
 * legacy :root in app/globals.css. Colours are literal hex because email
 * clients do not support CSS custom properties.
 *
 * This module has no imports from the rest of the app on purpose: the whole
 * `lib/couranr/email` subsystem is self-contained so it can be previewed,
 * unit-tested, and later wired to a sender without dragging app state in.
 */

export const COLORS = {
  navy: "#0D1525", // brand primary / headings / CTA text on gold
  gold: "#F4B740", // brand accent / primary CTA background
  routeBlue: "#2563EB", // links + product action (never in the logo)

  canvas: "#F7F8F5", // warm off-white — email body background
  surface: "#FFFFFF", // card
  surfaceSunken: "#F1F3F0", // sunken panels
  border: "#E3E7ED", // hairlines
  borderStrong: "#CBD2DC", // secondary button border

  text: "#0D1525",
  textSecondary: "#344054",
  textMuted: "#667085", // captions / fine print
  textSubtle: "#98A2B3",
  textInverse: "#FFFFFF",
  textInverseMuted: "#AEB7C4", // muted text on the navy footer band

  success: "#15803D",
  successBg: "#EEF7F1",
  warning: "#B45309",
  warningBg: "#FDF4E7",
  danger: "#B42318",
  dangerBg: "#FDF1F0",
  info: "#2563EB",
  infoBg: "#EEF3FD",
} as const;

/** Inter is on Google Fonts (email-friendly). Martian Grotesk is self-hosted
 * and does not load in email, so headings intentionally fall back to the
 * system stack — kept tight + navy so the brand still reads. */
export const FONTS = {
  body: `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`,
  heading: `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', Roboto, Helvetica, Arial, sans-serif`,
  mono: `'SFMono-Regular', 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace`,
} as const;

export const RADII = { sm: "8px", md: "12px", lg: "20px", pill: "999px" } as const;

export type EmailTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface EmailAssets {
  /** Wordmark for a LIGHT background (navy ink). Hosted PNG in production. */
  logoLightUrl: string;
  /** Wordmark for a DARK/navy background (white ink). Hosted PNG in production. */
  logoDarkUrl: string;
  /** Square app icon, e.g. for a small footer mark. */
  iconUrl: string;
}

export interface EmailCompany {
  /** Postal line shown in the footer (required for bulk-mail hygiene). */
  addressLine: string;
  /** Service-area sentence, kept exactly to the approved markets. */
  serviceArea: string;
}

export interface EmailConfig {
  brandName: string; // "Couranr"
  tagline: string; // "Delivery made simple."
  /** Verified sending address — must stay on the DKIM-verified subdomain. */
  fromEmail: string; // no-reply@mail.couranr.com
  fromName: string; // default display name for platform mail
  replyToEmail: string; // support@couranr.com — routes to the iCloud inbox
  supportEmail: string; // support@couranr.com
  /** Canonical product origin used to build track/pay/help/app links. */
  baseUrl: string; // https://couranr.com  (no trailing slash)
  assets: EmailAssets;
  company: EmailCompany;
}

/** Production-intent defaults. The preview overrides `assets` with inlined
 * data-URIs (email clients block data-URI images, so shipped mail uses the
 * hosted URLs below). */
export const defaultEmailConfig: EmailConfig = {
  brandName: "Couranr",
  tagline: "Delivery made simple.",
  fromEmail: "no-reply@mail.couranr.com",
  fromName: "Couranr",
  replyToEmail: "support@couranr.com",
  supportEmail: "support@couranr.com",
  baseUrl: "https://couranr.com",
  assets: {
    logoLightUrl: "https://couranr.com/brand/couranr-logo-primary@800.png",
    logoDarkUrl: "https://couranr.com/brand/couranr-logo-reverse@800.png",
    iconUrl: "https://couranr.com/brand/couranr-app-icon-256.png",
  },
  company: {
    addressLine: "Couranr · Stafford, VA",
    serviceArea:
      "Local delivery across Washington, DC, Stafford, Woodbridge, Fredericksburg, and surrounding areas.",
  },
};

/** Build an absolute product URL from a path, tolerating a trailing slash on
 * the base or a leading slash on the path. */
export function url(config: EmailConfig, path: string): string {
  const base = config.baseUrl.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

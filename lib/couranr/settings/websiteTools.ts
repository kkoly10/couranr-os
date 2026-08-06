/**
 * MER-013 website tools — the pure derivations.
 *
 * Everything here is a function of the slug and the merchant's config. No
 * network, no database, no browser API, so the URL shape and the embed
 * validation are unit-testable without either.
 *
 * THE CONSTRAINT THAT SHAPES THIS SCREEN (UI_SCREEN_REGISTRY.md:407): "Do not
 * turn Couranr into the merchant's product checkout. Customer request still
 * requires merchant validation." Nothing here generates a checkout, a price or
 * a payment link. The embed is a LINK to a request form, and that form's
 * output is a request Couranr reviews.
 */

/** The publish states a merchant's link can be in. */
export const WEBSITE_TOOL_STATUSES = ["draft", "published", "disabled"] as const;
export type WebsiteToolStatus = (typeof WEBSITE_TOOL_STATUSES)[number];

/**
 * Whether the hosted-request route exists yet.
 *
 * It does NOT: `/request/[merchantSlug]` is PUB-004's contract and no such
 * route is in the tree. This constant is the single place that fact is
 * recorded, so when PUB-004 ships, one edit flips every piece of copy that
 * currently says the link is not live — and until then nothing can claim a
 * merchant's link works. `tests/couranr-website-tools.test.ts` asserts the
 * constant agrees with the filesystem, so it cannot rot into a lie.
 */
export const HOSTED_REQUEST_ROUTE_EXISTS = false;

/** The canonical hosted-request path for a slug. */
export function hostedRequestPath(slug: string): string {
  return `/request/${encodeURIComponent(slug)}`;
}

/** The full URL a merchant would share. `origin` comes from the browser. */
export function hostedRequestUrl(origin: string, slug: string): string {
  const trimmed = origin.replace(/\/+$/, "");
  return `${trimmed}${hostedRequestPath(slug)}`;
}

export type EmbedConfig = {
  /** Button label shown to the merchant's own customers. */
  label: string;
  /** Hex colour, `#rgb` or `#rrggbb`. */
  color: string;
  /** Rendered width in CSS pixels. */
  width: number;
  variant: "button" | "link";
};

export const DEFAULT_EMBED: EmbedConfig = {
  label: "Request a delivery",
  color: "#1f6feb",
  width: 240,
  variant: "button",
};

export const EMBED_MIN_WIDTH = 120;
export const EMBED_MAX_WIDTH = 640;
export const EMBED_MAX_LABEL = 40;

export type EmbedProblem = {
  field: "label" | "color" | "width" | "variant";
  message: string;
};

/**
 * Validate an embed config.
 *
 * Returns EVERY problem rather than the first, so a merchant fixing two bad
 * values does not have to submit twice to discover the second one. This is the
 * registry's "invalid embed settings" state, and it is entirely client-side —
 * no request is fired for a config that cannot render.
 */
export function validateEmbed(config: Partial<EmbedConfig>): EmbedProblem[] {
  const problems: EmbedProblem[] = [];

  const label = typeof config.label === "string" ? config.label.trim() : "";
  if (label === "") {
    problems.push({ field: "label", message: "Enter the text for your button." });
  } else if (label.length > EMBED_MAX_LABEL) {
    problems.push({
      field: "label",
      message: `Keep the button text to ${EMBED_MAX_LABEL} characters or fewer.`,
    });
  }

  const color = typeof config.color === "string" ? config.color.trim() : "";
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) {
    problems.push({ field: "color", message: "Enter a colour like #1f6feb." });
  }

  const width = Number(config.width);
  if (!Number.isFinite(width) || !Number.isInteger(width)) {
    problems.push({ field: "width", message: "Enter a whole number of pixels." });
  } else if (width < EMBED_MIN_WIDTH || width > EMBED_MAX_WIDTH) {
    problems.push({
      field: "width",
      message: `Width must be between ${EMBED_MIN_WIDTH} and ${EMBED_MAX_WIDTH} pixels.`,
    });
  }

  if (config.variant !== "button" && config.variant !== "link") {
    problems.push({ field: "variant", message: "Choose a button or a text link." });
  }

  return problems;
}

/** Escapes a value for safe interpolation into the generated HTML snippet. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The snippet a merchant pastes into their own site.
 *
 * A plain anchor, deliberately. Not an iframe and not a script:
 *
 *  - An iframe would put a Couranr form inside the merchant's page, which is
 *    the shape of an embedded checkout — the exact thing the registry
 *    constraint forbids Couranr from becoming.
 *  - A script tag would let a future Couranr deploy execute arbitrary code on
 *    a merchant's site. An anchor cannot, and it degrades to a normal link
 *    with styling disabled.
 *
 * Every interpolated value is escaped, so a label containing a quote produces
 * broken-looking text rather than an attribute break.
 */
export function embedSnippet(url: string, config: EmbedConfig): string {
  const href = escapeHtml(url);
  const label = escapeHtml(config.label.trim());

  if (config.variant === "link") {
    return `<a href="${href}" target="_blank" rel="noopener">${label}</a>`;
  }

  const style = [
    "display:inline-block",
    `background:${escapeHtml(config.color)}`,
    "color:#ffffff",
    "padding:12px 20px",
    "border-radius:8px",
    "font-family:inherit",
    "font-weight:600",
    "text-decoration:none",
    "text-align:center",
    `width:${config.width}px`,
  ].join(";");

  return `<a href="${href}" target="_blank" rel="noopener" style="${style}">${label}</a>`;
}

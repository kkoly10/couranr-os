import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_EMBED,
  EMBED_MAX_LABEL,
  EMBED_MAX_WIDTH,
  EMBED_MIN_WIDTH,
  HOSTED_REQUEST_ROUTE_EXISTS,
  embedSnippet,
  hostedRequestPath,
  hostedRequestUrl,
  validateEmbed,
  type EmbedConfig,
} from "@/lib/couranr/settings/websiteTools";

const ROOT = path.resolve(__dirname, "..");

describe("hosted-request URL derivation", () => {
  it("builds the canonical path", () => {
    expect(hostedRequestPath("acme-florist")).toBe("/request/acme-florist");
  });

  it("encodes a slug that would otherwise change the path", () => {
    // Slugs are minted normalized, but this function takes whatever it is
    // handed and must never let a stored value alter the URL's shape.
    expect(hostedRequestPath("a/b")).toBe("/request/a%2Fb");
    expect(hostedRequestPath("a?b")).toBe("/request/a%3Fb");
  });

  it("joins an origin without doubling the slash", () => {
    expect(hostedRequestUrl("https://couranr.com", "acme")).toBe(
      "https://couranr.com/request/acme"
    );
    expect(hostedRequestUrl("https://couranr.com/", "acme")).toBe(
      "https://couranr.com/request/acme"
    );
  });
});

describe("HOSTED_REQUEST_ROUTE_EXISTS tells the truth about the filesystem", () => {
  /**
   * The whole screen's honesty rests on this flag: every "not live yet" badge
   * is derived from it. If PUB-004 ships and nobody flips the constant, the
   * screen keeps telling merchants their working link does not work — and if
   * someone flips it early, the screen promises a link that 404s. Either way
   * this test fails first.
   */
  it("matches whether a /request/[merchantSlug] route is actually in the tree", () => {
    const candidates = [
      "app/(couranr)/(public)/request/[merchantSlug]/page.tsx",
      "app/(couranr)/request/[merchantSlug]/page.tsx",
      "app/request/[merchantSlug]/page.tsx",
    ];
    const routeExists = candidates.some((c) => existsSync(path.join(ROOT, c)));
    expect(
      HOSTED_REQUEST_ROUTE_EXISTS,
      routeExists
        ? "the hosted-request route now EXISTS — flip HOSTED_REQUEST_ROUTE_EXISTS to true"
        : "the hosted-request route does NOT exist — HOSTED_REQUEST_ROUTE_EXISTS must stay false"
    ).toBe(routeExists);
  });
});

describe("embed validation — the registry's 'invalid embed settings' state", () => {
  it("accepts the default config", () => {
    expect(validateEmbed(DEFAULT_EMBED)).toEqual([]);
  });

  it("reports EVERY problem at once, not just the first", () => {
    const problems = validateEmbed({
      label: "",
      color: "blue",
      width: 5000,
      variant: "iframe" as any,
    });
    expect(problems.map((p) => p.field).sort()).toEqual([
      "color",
      "label",
      "variant",
      "width",
    ]);
  });

  it("rejects a label that is empty or only whitespace", () => {
    expect(validateEmbed({ ...DEFAULT_EMBED, label: "   " }).map((p) => p.field)).toEqual([
      "label",
    ]);
  });

  it("rejects a label over the limit but accepts one exactly at it", () => {
    expect(validateEmbed({ ...DEFAULT_EMBED, label: "x".repeat(EMBED_MAX_LABEL) })).toEqual([]);
    expect(
      validateEmbed({ ...DEFAULT_EMBED, label: "x".repeat(EMBED_MAX_LABEL + 1) }).map(
        (p) => p.field
      )
    ).toEqual(["label"]);
  });

  it("accepts #rgb and #rrggbb, rejects anything else", () => {
    for (const color of ["#fff", "#FFF", "#1f6feb", "#1F6FEB"]) {
      expect(validateEmbed({ ...DEFAULT_EMBED, color }), color).toEqual([]);
    }
    for (const color of ["red", "#12345", "rgb(0,0,0)", "#1f6feb;", "", "javascript:1"]) {
      expect(
        validateEmbed({ ...DEFAULT_EMBED, color }).map((p) => p.field),
        color
      ).toEqual(["color"]);
    }
  });

  it("holds the width to its stated bounds, inclusive", () => {
    expect(validateEmbed({ ...DEFAULT_EMBED, width: EMBED_MIN_WIDTH })).toEqual([]);
    expect(validateEmbed({ ...DEFAULT_EMBED, width: EMBED_MAX_WIDTH })).toEqual([]);
    for (const width of [EMBED_MIN_WIDTH - 1, EMBED_MAX_WIDTH + 1, 12.5, NaN]) {
      expect(
        validateEmbed({ ...DEFAULT_EMBED, width }).map((p) => p.field),
        String(width)
      ).toEqual(["width"]);
    }
  });
});

describe("the generated snippet is a link, and cannot be broken out of", () => {
  const url = "https://couranr.com/request/acme";

  it("renders an anchor — never an iframe or a script", () => {
    const html = embedSnippet(url, DEFAULT_EMBED);
    expect(html.startsWith("<a ")).toBe(true);
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<script");
  });

  it("carries rel=noopener on a new-tab link", () => {
    expect(embedSnippet(url, DEFAULT_EMBED)).toContain('rel="noopener"');
  });

  it("ESCAPES a label that tries to close the attribute or inject markup", () => {
    const hostile: EmbedConfig = {
      ...DEFAULT_EMBED,
      label: `" onclick="alert(1)" x="`,
    };
    const html = embedSnippet(url, hostile);
    // The quote must have become an entity; no new attribute can appear.
    expect(html).not.toContain('onclick="alert(1)"');
    expect(html).toContain("&quot;");
  });

  it("escapes a hostile URL rather than emitting it raw", () => {
    const html = embedSnippet('https://x.test/"><script>alert(1)</script>', DEFAULT_EMBED);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot;");
  });

  it("the link variant carries no inline style at all", () => {
    const html = embedSnippet(url, { ...DEFAULT_EMBED, variant: "link" });
    expect(html).not.toContain("style=");
    expect(html).toContain(">Request a delivery<");
  });

  it("the button variant applies the chosen colour and width", () => {
    const html = embedSnippet(url, { ...DEFAULT_EMBED, color: "#abc", width: 300 });
    expect(html).toContain("background:#abc");
    expect(html).toContain("width:300px");
  });
});

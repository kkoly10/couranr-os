import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  LEGAL_DOCUMENT_LIST,
  legalDocumentHref,
} from "@/lib/couranr/legal/registry";
import {
  CANONICAL_SITE_URL,
  INDEXABLE_PUBLIC_PATHS,
  SEARCH_ENGINE_VERIFICATION,
  createIndexablePublicMetadata,
  createNoIndexPublicMetadata,
  couranrSearchStructuredData,
} from "@/lib/couranr/public/seo";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";

const require = createRequire(import.meta.url);
const nextConfig = require("../next.config.js") as {
  headers: () => Promise<Array<{
    source: string;
    headers: Array<{ key: string; value: string }>;
  }>>;
};

describe("Couranr public SEO authority", () => {
  it("uses canonical www HTTPS URLs and page-specific social metadata", () => {
    const metadata = createIndexablePublicMetadata({
      title: "Couranr Same Day — local delivery, today",
      description: "Send something you have.",
      path: "/sameday",
      image: "/images/sameday.webp",
      imageAlt: "A local delivery handoff.",
    });

    expect(CANONICAL_SITE_URL).toBe("https://www.couranr.com");
    expect(metadata.alternates?.canonical).toBe("/sameday");
    expect(metadata.openGraph).toMatchObject({
      type: "website",
      siteName: "Couranr",
      title: "Couranr Same Day — local delivery, today",
      url: "/sameday",
      images: [{ url: "/images/sameday.webp", alt: "A local delivery handoff." }],
    });
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      title: "Couranr Same Day — local delivery, today",
    });
    expect(metadata.robots).toMatchObject({ index: true, follow: true });
  });

  it("marks conversion pages noindex without canonicalizing them into marketing pages", () => {
    const metadata = createNoIndexPublicMetadata({
      title: "Send something — Couranr Same Day",
      description: "Start a delivery request.",
    });

    expect(metadata.robots).toMatchObject({ index: false, follow: false });
    expect(metadata.alternates?.canonical).toBeUndefined();
  });

  it("does not invent a social-preview photo for pages without an approved image", () => {
    const metadata = createIndexablePublicMetadata({
      title: "Service areas — Couranr",
      description: "Couranr service areas.",
      path: "/service-areas",
    });

    expect(metadata.openGraph?.images).toBeUndefined();
    expect(metadata.twitter?.images).toBeUndefined();
  });

  it("advertises only canonical public marketing and legal documents", () => {
    const entries = sitemap();
    const expectedPaths = [
      ...INDEXABLE_PUBLIC_PATHS,
      ...LEGAL_DOCUMENT_LIST.map((document) => legalDocumentHref(document.id)),
    ];
    const expectedUrls = expectedPaths.map((path) =>
      new URL(path, `${CANONICAL_SITE_URL}/`).toString(),
    );

    expect(entries.map((entry) => entry.url)).toEqual(expectedUrls);
    expect(new Set(entries.map((entry) => entry.url)).size).toBe(entries.length);
    expect(expectedUrls).not.toContain(`${CANONICAL_SITE_URL}/send`);
    expect(expectedUrls).not.toContain(`${CANONICAL_SITE_URL}/track/example`);
    expect(expectedUrls).not.toContain(`${CANONICAL_SITE_URL}/operations`);
  });

  it("publishes a crawlable robots policy with the canonical sitemap", () => {
    expect(robots()).toEqual({
      rules: { userAgent: "*", allow: "/", disallow: "/api/" },
      sitemap: `${CANONICAL_SITE_URL}/sitemap.xml`,
    });
  });

  it("keeps the Bing ownership token in global metadata for verification persistence", () => {
    expect(SEARCH_ENGINE_VERIFICATION.other["msvalidate.01"]).toMatch(/^[A-F0-9]{32}$/);
  });

  it("sets noindex response headers on private, token, funnel, and retired surfaces", async () => {
    const headers = await nextConfig.headers();
    const noIndexSources = new Set(
      headers
        .filter((entry) => entry.headers.some((header) => header.key === "X-Robots-Tag"))
        .map((entry) => entry.source),
    );

    for (const source of [
      "/admin/:path*",
      "/app/:path*",
      "/operations/:path*",
      "/driver/:path*",
      "/send",
      "/request/:path*",
      "/track/:path*",
      "/help/:path*",
      "/pay/:path*",
      "/delivery/:path*",
      "/auto/:path*",
      "/docs/:path*",
    ]) {
      expect(noIndexSources.has(source)).toBe(true);
    }

    const capabilityHeaders = headers.find((entry) => entry.source === "/track/:token");
    expect(capabilityHeaders?.headers).toContainEqual({
      key: "Referrer-Policy",
      value: "no-referrer",
    });
  });

  it("declares Couranr and its logo without inventing a storefront or review claims", () => {
    const data = couranrSearchStructuredData();
    const organization = data["@graph"].find((node) => node["@type"] === "Organization");
    const website = data["@graph"].find((node) => node["@type"] === "WebSite");

    expect(organization).toMatchObject({
      name: "Couranr",
      url: `${CANONICAL_SITE_URL}/`,
      logo: `${CANONICAL_SITE_URL}/brand/couranr-app-icon-512.png`,
    });
    expect(website).toMatchObject({
      name: "Couranr",
      url: `${CANONICAL_SITE_URL}/`,
    });
    expect(organization).not.toHaveProperty("address");
    expect(organization).not.toHaveProperty("telephone");
    expect(organization).not.toHaveProperty("aggregateRating");
  });
});

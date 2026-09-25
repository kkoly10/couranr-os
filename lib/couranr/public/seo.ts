import type { Metadata } from "next";
import { MASTER_COPY } from "@/lib/couranr/public/masterSameDayCopy";

/**
 * Public search identity. The live host redirects non-www traffic to www, so
 * every canonical URL and sitemap entry points at the final HTTPS host.
 */
export const CANONICAL_SITE_URL = "https://www.couranr.com";

/** Bing Webmaster Tools verification token for the canonical www property. */
export const SEARCH_ENGINE_VERIFICATION = {
  other: { "msvalidate.01": "FB2D86ADCDAAAA3DD0EF888A2991C024" },
} as const;

export const INDEXABLE_PUBLIC_PATHS = [
  "/",
  "/sameday",
  "/business",
  "/businesses",
  "/service-areas",
  "/pricing",
  "/how-it-works",
  "/legal",
] as const;

type ShareFields = {
  title: string;
  description: string;
  image?: string;
  imageAlt?: string;
};

/** Complete metadata for a page intended to appear in search results. */
export function createIndexablePublicMetadata(
  input: ShareFields & { path: string },
): Metadata {
  const socialImages = input.image
    ? [{ url: input.image, ...(input.imageAlt ? { alt: input.imageAlt } : {}) }]
    : undefined;

  return {
    title: input.title,
    description: input.description,
    alternates: { canonical: input.path },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
    openGraph: {
      type: "website",
      siteName: "Couranr",
      title: input.title,
      description: input.description,
      url: input.path,
      ...(socialImages ? { images: socialImages } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: input.title,
      description: input.description,
      ...(socialImages ? { images: socialImages.map(({ url }) => url) } : {}),
    },
  };
}

/** Metadata for public conversion/token routes that should remain crawlable but not indexed. */
export function createNoIndexPublicMetadata(input: ShareFields): Metadata {
  return {
    title: input.title,
    description: input.description,
    robots: {
      index: false,
      follow: false,
      googleBot: { index: false, follow: false },
    },
  };
}

/**
 * Search identity markup belongs on the home page only. Do not add a physical
 * address, phone number, reviews, or storefront claims: Couranr operates as a
 * service-area delivery business without a customer-facing public location.
 */
export function couranrSearchStructuredData() {
  const home = `${CANONICAL_SITE_URL}/`;
  const organizationId = `${home}#organization`;

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": organizationId,
        name: "Couranr",
        url: home,
        logo: `${CANONICAL_SITE_URL}/brand/couranr-app-icon-512.png`,
        description: MASTER_COPY.hero_support,
      },
      {
        "@type": "WebSite",
        "@id": `${home}#website`,
        url: home,
        name: "Couranr",
        publisher: { "@id": organizationId },
      },
    ],
  };
}

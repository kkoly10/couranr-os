import type { MetadataRoute } from "next";
import { CANONICAL_SITE_URL } from "@/lib/couranr/public/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // The page routes that need removal use noindex headers/meta. The API is
      // not public search content and is excluded from crawling altogether.
      disallow: "/api/",
    },
    sitemap: `${CANONICAL_SITE_URL}/sitemap.xml`,
  };
}

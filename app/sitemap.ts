import type { MetadataRoute } from "next";
import {
  LEGAL_DOCUMENT_LIST,
  legalDocumentHref,
} from "@/lib/couranr/legal/registry";
import {
  CANONICAL_SITE_URL,
  INDEXABLE_PUBLIC_PATHS,
} from "@/lib/couranr/public/seo";

/** Only canonical, indexable marketing and public policy pages belong here. */
export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [
    ...INDEXABLE_PUBLIC_PATHS,
    ...LEGAL_DOCUMENT_LIST.map((document) => legalDocumentHref(document.id)),
  ];

  return paths.map((path) => ({
    url: new URL(path, `${CANONICAL_SITE_URL}/`).toString(),
  }));
}

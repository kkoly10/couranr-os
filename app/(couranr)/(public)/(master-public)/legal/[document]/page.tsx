import * as React from "react";
import { notFound } from "next/navigation";
import { LegalDocumentView } from "../LegalDocumentView";
import {
  LEGAL_DOCUMENT_LIST,
  legalDocumentBySlug,
} from "@/lib/couranr/legal/registry";

/**
 * One route, five documents.
 *
 * `generateStaticParams` enumerates the registry, so a document added there
 * gets a route without anybody remembering to add a directory — and, more to
 * the point, a document CANNOT exist in the registry with no page to read it
 * on. That gap is the whole reason this route was written: a version string was
 * being recorded against production rows with no rendered document behind it.
 *
 * An unknown slug is a 404 rather than a redirect to the index. A link to a
 * document that does not exist is a broken link, and quietly landing the reader
 * somewhere else hides that from whoever wrote it.
 */
export function generateStaticParams() {
  return LEGAL_DOCUMENT_LIST.map((doc) => ({ document: doc.slug }));
}

export async function generateMetadata(props: { params: Promise<{ document: string }> }) {
  const params = await props.params;
  const doc = legalDocumentBySlug(params.document);
  if (!doc) return { title: "Couranr legal documents" };
  return { title: `${doc.title} — Couranr`, description: doc.summary };
}

export default async function LegalDocumentPage(props: {
  params: Promise<{ document: string }>;
}) {
  const params = await props.params;
  const doc = legalDocumentBySlug(params.document);
  if (!doc) notFound();

  // A <div>, NOT a <main>: the public shell already renders the page's
  // `<main id="cr-main">` landmark.
  return (
    <div>
      <LegalDocumentView id={doc.id} />
    </div>
  );
}

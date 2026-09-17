import * as React from "react";
import Link from "next/link";
import {
  Card,
  Divider,
  Heading,
  Stack,
  Text,
} from "@/components/couranr/primitives";
import {
  COUNSEL_REVIEW_HEADING,
  COUNSEL_REVIEW_NOTICE,
  LEGAL_DRAFTED_ON,
  LEGAL_INDEX_HREF,
  OPEN_FOR_LEGAL_REVIEW,
  OPEN_FOR_LEGAL_REVIEW_HEADING,
  OPEN_FOR_LEGAL_REVIEW_INTRO,
  getLegalDocument,
  type LegalDocumentId,
} from "@/lib/couranr/legal/registry";
import { legalSections } from "@/lib/couranr/legal/documents";

/**
 * ONE renderer for all five documents.
 *
 * Not five pages with five layouts: the version line, the counsel-review
 * notice and the open-items list are the parts that must never be missing, and
 * a per-document layout is exactly how one of them goes missing from one
 * document. There is no prop that turns any of the three off.
 *
 * NO COPY LIVES HERE. Every rendered string comes from
 * `lib/couranr/legal/registry.ts` or `lib/couranr/legal/documents.ts`, which is
 * what lets a test assert the words without rendering React, and what keeps the
 * derived money figures out of this tree entirely.
 *
 * A `<div>`, not a `<main>` — the public shell already owns the page's `main`
 * landmark, and a second one leaves assistive technology with no single target.
 */
export function LegalDocumentView({ id }: { id: LegalDocumentId }) {
  const doc = getLegalDocument(id);
  const sections = legalSections(id);

  return (
    <Stack gap={6}>
      <Stack gap={2}>
        <Heading level={1}>{doc.title}</Heading>
        <Text>{doc.summary}</Text>
      </Stack>

      {/* The version the SERVER uses, printed where the reader is. The whole
          reason this route group exists: before it, a version string was
          recorded against production rows and no page showed it to anyone. */}
      <Card padding="default">
        <Stack gap={2}>
          <Text size="sm" muted>
            Version
          </Text>
          <Text numeric data-couranr-legal-version={doc.version}>
            {doc.version}
          </Text>
          <Text size="sm" muted>
            Drafted {LEGAL_DRAFTED_ON}
          </Text>
          <Text size="sm" muted>
            {doc.acceptanceIsRecorded
              ? "Couranr records this version against your shipment when you accept it."
              : "Couranr does not record an acceptance of this document."}
          </Text>
        </Stack>
      </Card>

      <Card padding="default">
        <Stack gap={2}>
          <Heading level={2}>{COUNSEL_REVIEW_HEADING}</Heading>
          <Text>{COUNSEL_REVIEW_NOTICE}</Text>
        </Stack>
      </Card>

      <Divider />

      {sections.map((section) => (
        <section key={section.id} id={section.id}>
          <Stack gap={3}>
            <Heading level={2}>{section.heading}</Heading>
            {section.blocks.map((block, i) =>
              block.kind === "text" ? (
                <Text key={i}>{block.text}</Text>
              ) : (
                <ul key={i} className="cr-list">
                  {block.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )
            )}
          </Stack>
        </section>
      ))}

      <Divider />

      <section id="open-for-legal-review">
        <Stack gap={3}>
          <Heading level={2}>{OPEN_FOR_LEGAL_REVIEW_HEADING}</Heading>
          <Text>{OPEN_FOR_LEGAL_REVIEW_INTRO}</Text>
          <ul className="cr-list">
            {OPEN_FOR_LEGAL_REVIEW.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Stack>
      </section>

      <Text size="sm">
        <Link href={LEGAL_INDEX_HREF}>All Couranr documents</Link>
      </Text>
    </Stack>
  );
}

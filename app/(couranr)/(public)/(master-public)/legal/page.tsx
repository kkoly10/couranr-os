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
  LEGAL_DOCUMENT_LIST,
  LEGAL_DRAFTED_ON,
  legalDocumentHref,
} from "@/lib/couranr/legal/registry";
import { createIndexablePublicMetadata } from "@/lib/couranr/public/seo";

export const metadata = createIndexablePublicMetadata({
  title: "Couranr legal documents",
  description:
    "The Couranr terms, policies and shipment documents, each with the version Couranr records.",
  path: "/legal",
});

/**
 * The index of every Couranr legal and policy document.
 *
 * It lives in the MASTER public route group deliberately. These documents are
 * Couranr-wide, not the business path's and not the consumer path's, and giving
 * them one home means a sender and a merchant read the same text under the same
 * version rather than two brand-scoped copies drifting apart.
 *
 * Every version shown here is read from `lib/couranr/legal/registry.ts`, which
 * imports the Same Day one from the constant the server already records. There
 * is no version literal on this page.
 */
export default function LegalIndexPage() {
  return (
    <Stack gap={6}>
      <Stack gap={2}>
        <Heading level={1}>Couranr legal documents</Heading>
        <Text>
          Each document below carries the version Couranr uses for it. Where Couranr records
          that you accepted something, it records the version you were shown.
        </Text>
      </Stack>

      <Card padding="default">
        <Stack gap={2}>
          <Heading level={2}>{COUNSEL_REVIEW_HEADING}</Heading>
          <Text>{COUNSEL_REVIEW_NOTICE}</Text>
          <Text size="sm" muted>
            Drafted {LEGAL_DRAFTED_ON}
          </Text>
        </Stack>
      </Card>

      <Divider />

      <Stack gap={4}>
        {LEGAL_DOCUMENT_LIST.map((doc) => (
          <Card key={doc.id} padding="default">
            <Stack gap={2}>
              <Heading level={2}>
                <Link href={legalDocumentHref(doc.id)}>{doc.title}</Link>
              </Heading>
              <Text>{doc.summary}</Text>
              <Text size="sm" muted numeric>
                {doc.version}
              </Text>
            </Stack>
          </Card>
        ))}
      </Stack>
    </Stack>
  );
}

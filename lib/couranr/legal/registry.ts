/**
 * The versioned legal/policy document registry.
 *
 * ONE PLACE OWNS A DOCUMENT VERSION. Before this module a route could render a
 * policy and the server could record a different version of it, with nothing
 * connecting the two: `CONSUMER_SENDER_TERMS_VERSION` was written onto every
 * consumer request while no page existed that a sender could read, and the four
 * `ACKNOWLEDGEMENT_VERSIONS` merchants accept point at documents that have never
 * been rendered either. A version string that nobody can read is a consent
 * record with no document behind it.
 *
 * So the rule here is narrow and absolute: a page NEVER states its own version.
 * It asks this module, and this module either owns the string or imports the
 * constant the server already records. `SAME_DAY_SHIPMENT_TERMS` does the
 * second — its version IS `CONSUMER_SENDER_TERMS_VERSION`, imported, never
 * retyped — so a sender who is shown the document and a request row that stores
 * a version are provably talking about the same text.
 *
 * DEPENDENCY-FREE, for the same reason `lib/couranr/consumer/protection.ts` is:
 * a clickwrap in a client component and a server page both need the citation,
 * and a module that dragged `supabaseAdmin` into the browser bundle could only
 * serve one of them.
 *
 * THESE ARE DRAFTS. Nothing in this module or in `documents.ts` has been
 * reviewed by a lawyer. `COUNSEL_REVIEW_NOTICE` says so on every rendered
 * document, and `OPEN_FOR_LEGAL_REVIEW` lists what is deliberately unwritten.
 */

import {
  CONSUMER_SENDER_TERMS_VERSION,
} from "@/lib/couranr/consumer/protection";

/* ------------------------------------------------------------- the set -- */

export const LEGAL_DOCUMENT_IDS = [
  "terms-of-use",
  "same-day-shipment-terms",
  "prohibited-items",
  "privacy",
  "claims-and-loss",
] as const;
export type LegalDocumentId = (typeof LEGAL_DOCUMENT_IDS)[number];

export function isLegalDocumentId(v: unknown): v is LegalDocumentId {
  return typeof v === "string" && (LEGAL_DOCUMENT_IDS as readonly string[]).includes(v);
}

/** The Same Day sender terms, named once so no caller retypes the id. */
export const SAME_DAY_SHIPMENT_TERMS_ID: LegalDocumentId = "same-day-shipment-terms";

export type LegalDocumentMeta = {
  id: LegalDocumentId;
  /** Last path segment. Equal to the id — kept separate so one can move. */
  slug: string;
  title: string;
  /**
   * The short label a footer or menu uses. Separate from `title` because the
   * full names are sentence-length, and a footer column of sentences is how a
   * destination stops being read at all.
   */
  navLabel: string;
  /** One customer-readable line, used on the index and as page description. */
  summary: string;
  /**
   * THE version. For the Same Day terms this is the constant the server writes
   * to `couranr_delivery_requests.sender_terms_version`; for the rest it is a
   * draft version this registry owns until counsel review replaces it.
   */
  version: string;
  /**
   * Whether a server command records a customer's acceptance of this exact
   * version today. Rendered, because "we wrote down that you accepted this" is
   * a materially different statement from "please read this".
   */
  acceptanceIsRecorded: boolean;
};

/**
 * The draft date. ONE date for the whole set, because they were drafted in one
 * pass and a per-document date would imply a review history that has not
 * happened. Not an effective date: none of these is in effect.
 */
export const LEGAL_DRAFTED_ON = "2026-09-17";

/**
 * Deliberately NOT suffixed `-draft` for the Same Day terms, and suffixed for
 * everything else.
 *
 * The Same Day string is not this module's to choose: it is already stored on
 * production request rows. Renaming it to look like a draft would orphan every
 * acceptance already recorded against it — the exact failure versioning exists
 * to prevent. The document says in its own text that it is an unreviewed draft;
 * the identifier stays stable.
 */
export const LEGAL_DOCUMENTS: Readonly<Record<LegalDocumentId, LegalDocumentMeta>> = {
  "terms-of-use": {
    id: "terms-of-use",
    slug: "terms-of-use",
    title: "Couranr Terms of Use",
    navLabel: "Terms of Use",
    summary: "The general terms for using Couranr and asking Couranr to carry something.",
    version: "couranr-terms-of-use-draft-2026-09",
    acceptanceIsRecorded: false,
  },
  "same-day-shipment-terms": {
    id: "same-day-shipment-terms",
    slug: "same-day-shipment-terms",
    title: "Same Day Shipment Terms",
    navLabel: "Same Day shipment terms",
    summary:
      "What you are telling Couranr when you send a Same Day shipment, and what Couranr does with it.",
    // THE constant the server records. Never a copy of it.
    version: CONSUMER_SENDER_TERMS_VERSION,
    acceptanceIsRecorded: true,
  },
  "prohibited-items": {
    id: "prohibited-items",
    slug: "prohibited-items",
    title: "Prohibited and Restricted Items Policy",
    navLabel: "Prohibited items",
    summary: "What Couranr will not carry, and how Couranr decides.",
    version: "couranr-prohibited-items-policy-draft-2026-09",
    /* The shipment certification names this document by name, so accepting it
       accepts both. 20260917170000 adds sender_prohibited_items_version and
       couranr_record_consumer_trust stamps it — the claim on the page is only
       honest because that column exists. */
    acceptanceIsRecorded: true,
  },
  privacy: {
    id: "privacy",
    slug: "privacy",
    title: "Privacy Policy",
    navLabel: "Privacy",
    summary: "What Couranr collects to move a shipment, and who can see it.",
    version: "couranr-privacy-policy-draft-2026-09",
    acceptanceIsRecorded: false,
  },
  "claims-and-loss": {
    id: "claims-and-loss",
    slug: "claims-and-loss",
    title: "Claims and Loss",
    navLabel: "Claims and loss",
    summary: "How to report a problem with a delivery, and what evidence Couranr holds.",
    version: "couranr-claims-and-loss-draft-2026-09",
    acceptanceIsRecorded: false,
  },
};

/** Registry order, for the index page and for tests that walk every document. */
export const LEGAL_DOCUMENT_LIST: readonly LegalDocumentMeta[] =
  LEGAL_DOCUMENT_IDS.map((id) => LEGAL_DOCUMENTS[id]);

export function getLegalDocument(id: LegalDocumentId): LegalDocumentMeta {
  return LEGAL_DOCUMENTS[id];
}

/** The slug a route segment carries, resolved back to a document. */
export function legalDocumentBySlug(slug: string): LegalDocumentMeta | null {
  const found = LEGAL_DOCUMENT_LIST.find((d) => d.slug === slug);
  return found ?? null;
}

/* ------------------------------------------------------------ the links -- */

export const LEGAL_INDEX_HREF = "/legal";

export function legalDocumentHref(id: LegalDocumentId): string {
  return `${LEGAL_INDEX_HREF}/${LEGAL_DOCUMENTS[id].slug}`;
}

/* --------------------------------------------------------- the citation -- */

/**
 * What a clickwrap cites.
 *
 * A consent checkbox has to name the document, link to it, and record a
 * version, and those three must be the same document. Returning them together
 * is the whole point: a caller cannot take the version from here and the link
 * from somewhere else.
 */
export type LegalCitation = {
  documentId: LegalDocumentId;
  title: string;
  version: string;
  href: string;
};

export function legalCitation(id: LegalDocumentId): LegalCitation {
  const doc = LEGAL_DOCUMENTS[id];
  return {
    documentId: doc.id,
    title: doc.title,
    version: doc.version,
    href: legalDocumentHref(doc.id),
  };
}

/**
 * The citation a Consumer Same Day clickwrap must use.
 *
 * `version` here is `CONSUMER_SENDER_TERMS_VERSION` by construction, so a
 * clickwrap that cites this cannot show one version and have the server record
 * another.
 */
export function senderShipmentTermsCitation(): LegalCitation {
  return legalCitation(SAME_DAY_SHIPMENT_TERMS_ID);
}

/* ----------------------------------------------------- the draft notice -- */

export const COUNSEL_REVIEW_HEADING = "Draft. Not reviewed by a lawyer.";

export const COUNSEL_REVIEW_NOTICE =
  "This document is a draft written by Couranr to describe how the service actually "
  + "works today. No lawyer has reviewed it. Read it as a plain description of what "
  + "Couranr does, not as a settled legal agreement. It will change.";

/**
 * What these drafts deliberately do NOT say.
 *
 * Every item here is a term a reviewed agreement would carry and this one does
 * not. Writing a placeholder version of any of them would be worse than the
 * gap: a customer would read a limitation of liability that no lawyer wrote and
 * reasonably believe it applied to them.
 */
export const OPEN_FOR_LEGAL_REVIEW = [
  "Limitation of liability",
  "Deadlines for making a claim, and how notice must be given",
  "What a declared value does and does not do to Couranr's liability",
  "Indemnification",
  "Consequential and indirect damages",
  "Arbitration, and any waiver of class claims",
  "Governing law and venue",
  "How these terms interact with any insurance you or your recipient hold",
] as const;

export const OPEN_FOR_LEGAL_REVIEW_HEADING = "Still open for legal review";

export const OPEN_FOR_LEGAL_REVIEW_INTRO =
  "These points are not written into this draft on purpose. Couranr will not state "
  + "a term it has not had reviewed, so until then there is no term here to rely on.";

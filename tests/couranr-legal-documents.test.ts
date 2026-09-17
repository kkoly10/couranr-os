import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CONSUMER_MAX_DECLARED_VALUE_CENTS,
  CONSUMER_SENDER_TERMS_VERSION,
  PROTECTION_THRESHOLDS,
  declaredValueDollars,
} from "@/lib/couranr/consumer/protection";
import { PROHIBITED_CLASSES } from "@/lib/couranr/shipment/facts";
import { ACKNOWLEDGEMENT_VERSIONS } from "@/lib/couranr/activation/states";
import { isRecipientIdentityCapabilityAvailable } from "@/lib/couranr/identity/recipientIdentity";
import {
  CUSTOMER_PROBLEM_TYPES,
  MAX_CUSTOMER_PROBLEM_PHOTOS,
  MAX_CUSTOMER_PROBLEM_BYTES,
} from "@/lib/couranr/conversations/problemReports";
import {
  COUNSEL_REVIEW_HEADING,
  COUNSEL_REVIEW_NOTICE,
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_IDS,
  LEGAL_DOCUMENT_LIST,
  OPEN_FOR_LEGAL_REVIEW,
  SAME_DAY_SHIPMENT_TERMS_ID,
  isLegalDocumentId,
  legalCitation,
  legalDocumentBySlug,
  legalDocumentHref,
  senderShipmentTermsCitation,
} from "@/lib/couranr/legal/registry";
import {
  PROHIBITED_ITEM_LINES,
  allLegalDocumentText,
  legalDocumentText,
  legalSections,
} from "@/lib/couranr/legal/documents";

/**
 * Closure F — the V1 legal/policy drafts.
 *
 * WHAT THIS FILE IS FOR. Before it there was no route anywhere that rendered a
 * document AND showed the version the server records against it: the consumer
 * flow wrote `CONSUMER_SENDER_TERMS_VERSION` onto production request rows while
 * the text behind that string existed nowhere a sender could read. Every
 * assertion below is aimed at one of the two failure modes that gap creates —
 * a document with no version, or a version with no document.
 *
 * It also holds the line on the thing that is easiest to undo by accident: the
 * declared-value ceiling is DERIVED. A future editor writing the figure into a
 * sentence would be correct today and silently wrong the day the constant
 * moves, which is exactly how the delivery policy page came to publish a limit
 * that contradicted the consumer flow for months. The source scan below is the
 * gate, and it carries its own mutation control.
 */

const ROOT = path.resolve(__dirname, "..");
const LEGAL_LIB = path.join(ROOT, "lib/couranr/legal");
const LEGAL_ROUTE = path.join(ROOT, "app/(couranr)/(public)/(master-public)/legal");
const DELIVERY_POLICY = path.join(ROOT, "app/policy/delivery/page.tsx");

const MAX_DECLARED = declaredValueDollars(CONSUMER_MAX_DECLARED_VALUE_CENTS);
const STANDARD_TOP = declaredValueDollars(PROTECTION_THRESHOLDS.standardMaxCents);
const SECURE_TOP = declaredValueDollars(PROTECTION_THRESHOLDS.securePickupMaxCents);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

/**
 * Comments are stripped before every source scan. This repository's comments
 * quote the values they explain constantly — including, in `documents.ts`, the
 * rule being enforced here — and a scanner that cannot tell a comment from a
 * rendered string flags its own documentation.
 */
function stripComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/* ------------------------------------------------------- the registry --- */

describe("the registry is the only place a version lives", () => {
  it("registers exactly the five V1 documents", () => {
    expect(LEGAL_DOCUMENT_IDS).toEqual([
      "terms-of-use",
      "same-day-shipment-terms",
      "prohibited-items",
      "privacy",
      "claims-and-loss",
    ]);
    expect(LEGAL_DOCUMENT_LIST).toHaveLength(LEGAL_DOCUMENT_IDS.length);
  });

  it("the Same Day version IS the constant the server records", () => {
    // THE assertion this whole slice exists for. Not "looks like", not "starts
    // with" — identical to the string written to
    // couranr_delivery_requests.sender_terms_version.
    expect(LEGAL_DOCUMENTS[SAME_DAY_SHIPMENT_TERMS_ID].version).toBe(
      CONSUMER_SENDER_TERMS_VERSION,
    );
    expect(senderShipmentTermsCitation().version).toBe(CONSUMER_SENDER_TERMS_VERSION);
  });

  it("the Same Day version string is not duplicated anywhere in the legal tree", () => {
    /* A copy that happens to match today is the failure being prevented: it
       matches until somebody edits one of them. The literal must appear in
       protection.ts and nowhere under lib/couranr/legal or the legal routes. */
    const offenders: string[] = [];
    for (const f of [...walk(LEGAL_LIB), ...walk(LEGAL_ROUTE)]) {
      if (stripComments(readFileSync(f, "utf8")).includes(CONSUMER_SENDER_TERMS_VERSION)) {
        offenders.push(path.relative(ROOT, f));
      }
    }
    expect(offenders, `version literal copied into: ${offenders.join(", ")}`).toEqual([]);
  });

  it("every document has a distinct version, slug, title and nav label", () => {
    const fields = ["version", "slug", "title", "navLabel"] as const;
    for (const field of fields) {
      const values = LEGAL_DOCUMENT_LIST.map((d) => d[field]);
      expect(new Set(values).size, `${field} collides`).toBe(values.length);
      for (const v of values) expect(v.trim()).not.toBe("");
    }
  });

  it("resolves a document by slug, and refuses an unknown one", () => {
    for (const doc of LEGAL_DOCUMENT_LIST) {
      expect(legalDocumentBySlug(doc.slug)).toEqual(doc);
      expect(isLegalDocumentId(doc.id)).toBe(true);
    }
    expect(legalDocumentBySlug("not-a-document")).toBeNull();
    expect(isLegalDocumentId("not-a-document")).toBe(false);
    expect(isLegalDocumentId(undefined)).toBe(false);
  });

  it("a citation carries the title, the version and the link together", () => {
    // A clickwrap that took the version from here and the link from elsewhere
    // is the defect this shape prevents.
    for (const doc of LEGAL_DOCUMENT_LIST) {
      expect(legalCitation(doc.id)).toEqual({
        documentId: doc.id,
        title: doc.title,
        version: doc.version,
        href: `/legal/${doc.slug}`,
      });
    }
    expect(senderShipmentTermsCitation()).toEqual(legalCitation(SAME_DAY_SHIPMENT_TERMS_ID));
  });

  it("only the Same Day terms claim an acceptance is recorded", () => {
    // Saying "we recorded that you accepted this" about a document no command
    // writes would be a false statement on a legal page.
    const recording = LEGAL_DOCUMENT_LIST.filter((d) => d.acceptanceIsRecorded).map((d) => d.id);
    expect(recording).toEqual([SAME_DAY_SHIPMENT_TERMS_ID]);
  });
});

/* ------------------------------------------- the counsel-review notice --- */

describe("every document says it is an unreviewed draft", () => {
  it.each(LEGAL_DOCUMENT_LIST.map((d) => [d.id] as const))(
    "%s carries the notice and every open item",
    (id) => {
      // The notice and the open list are rendered by the shared view for all
      // five, so this asserts the constants are honest and non-empty; the DOM
      // suite asserts they actually reach the page.
      expect(COUNSEL_REVIEW_HEADING.toLowerCase()).toContain("draft");
      expect(COUNSEL_REVIEW_NOTICE.toLowerCase()).toContain("no lawyer has reviewed it");
      expect(legalSections(id).length).toBeGreaterThan(0);
    },
  );

  it("names every term the drafts deliberately do not write", () => {
    const list = OPEN_FOR_LEGAL_REVIEW.join(" | ").toLowerCase();
    for (const subject of [
      "limitation of liability",
      "claim",
      "declared value",
      "indemnification",
      "consequential",
      "arbitration",
      "class",
      "governing law",
      "venue",
      "insurance",
    ]) {
      expect(list, `open-items list never mentions ${subject}`).toContain(subject);
    }
    expect(OPEN_FOR_LEGAL_REVIEW).toHaveLength(8);
  });

  it("no draft writes a substantive term for an item it says is open", () => {
    /* The failure this guards is a placeholder limitation of liability: a
       customer would read a cap no lawyer wrote and reasonably rely on it.
       Phrases that only appear inside a real term, never in a statement that
       the term is missing. */
    const text = allLegalDocumentText().toLowerCase();
    for (const banned of [
      "in no event shall",
      "aggregate liability",
      "liability is limited to",
      "you agree to indemnify",
      "binding arbitration",
      "waive any right to a jury",
      "governed by the laws of",
      "exclusive jurisdiction",
    ]) {
      expect(text, `a draft states a reviewed-only term: ${banned}`).not.toContain(banned);
    }
  });
});

/* -------------------------------------------- derived, never hardcoded --- */

describe("the declared-value ceiling is derived", () => {
  const sources = [...walk(LEGAL_LIB), ...walk(LEGAL_ROUTE)];

  it("scans a real file set", () => {
    // A scan over zero files passes silently, which is worse than no scan.
    expect(sources.length).toBeGreaterThanOrEqual(4);
  });

  it.each(sources.map((f) => [path.relative(ROOT, f), f] as const))(
    "%s contains no dollar literal",
    (_rel, file) => {
      const text = stripComments(readFileSync(file, "utf8"));
      expect(text.match(/\$\s?\d/g) ?? []).toEqual([]);
    },
  );

  it("the shipment terms render the ceiling composed from the constant", () => {
    const text = legalDocumentText(SAME_DAY_SHIPMENT_TERMS_ID);
    expect(text).toContain(MAX_DECLARED);
    expect(text).toContain(STANDARD_TOP);
    expect(text).toContain(SECURE_TOP);
    // And the value is what the authority says, not a coincidence.
    expect(MAX_DECLARED).toBe(declaredValueDollars(50_000));
  });

  it("the prohibited-items policy states the same ceiling, from the same constant", () => {
    expect(legalDocumentText("prohibited-items")).toContain(MAX_DECLARED);
  });

  it("MUTATION CONTROL — the dollar-literal scan can reject", () => {
    // Without this the scan above could be matching nothing at all.
    expect(stripComments('const s = "up to $500.00 per shipment";').match(/\$\s?\d/g)).toEqual([
      "$5",
    ]);
    // And a comment quoting the figure is correctly ignored.
    expect(stripComments("// never write $500 here\n").match(/\$\s?\d/g)).toBeNull();
  });
});

/* -------------------------------------- the shipment terms' obligations -- */

describe("the Same Day Shipment Terms cover what a sender must be told", () => {
  const text = legalDocumentText(SAME_DAY_SHIPMENT_TERMS_ID);

  /* One row per required subject, so a failure names the subject rather than a
     line number. Each matcher is a phrase that carries the MEANING, not a
     keyword that a nearby sentence could satisfy by accident. */
  const REQUIRED: [subject: string, matcher: RegExp][] = [
    ["sender is 18 or older", /You must be 18 or older to send a shipment\./],
    ["recipient is 18 or older", /person receiving it must also be 18 or older/i],
    ["sender owns or is authorised to send", /must own what you are sending, or have the owner's permission/i],
    ["declared value is a total, per shipment", /total for everything in the shipment, not the\s+price of one item/i],
    ["declared value is the sender's own statement", /your own statement about your own property/i],
    ["declared value is not insurance", /It is not insurance\./],
    ["declared value does not guarantee payment", /not a guarantee that Couranr will pay you that amount/i],
    ["Couranr does not authenticate, appraise or test", /does not authenticate, appraise or test anything it carries/i],
    ["secure pickup begins above the standard band", /More than \S+: Secure Pickup/],
    ["prepack photograph before packing", /photographs the item before it goes into its outer packaging/i],
    ["factory packaging need not be opened", /do not have to open packaging the item came in from its manufacturer/i],
    ["sender packs in the driver's presence", /You pack it, in front of the driver/i],
    ["a serialised tamper-evident seal is applied and photographed", /numbered tamper-evident seal on the package and photographs the\s+sealed package/i],
    ["what the pickup credential means", /the package that was documented and sealed in front of you is the package you are\s+handing over/i],
    ["recipient identity verification at protected handoff", /recipient verifies their identity/i],
    ["the recipient's PIN is read to the driver", /gets a PIN and reads it to the driver/i],
    ["the PIN does not waive a damage or loss claim", /does not end your right to report damage or loss/i],
    ["fraud, collusion, false declarations and altered evidence", /agreeing with your recipient to report a problem that\s+did not happen, or changing a photograph or a record/i],
    ["the fraud rule is bounded by law", /as far as the law allows/i],
    ["legitimate claims stay reviewable", /report a genuine problem and have\s+Couranr look at it/i],
  ];

  it.each(REQUIRED)("covers: %s", (_subject, matcher) => {
    expect(text).toMatch(matcher);
  });

  it("states the seal is checked, photographed and recorded once at the door", () => {
    expect(text).toMatch(/looks at it at the door, photographs it, and\s+records whether it is intact, damaged or missing/i);
    expect(text).toMatch(/cannot be revised\s+afterwards/i);
    expect(text).toMatch(/opens an incident/i);
  });
});

/* ------------------------------- the documents match production behaviour - */

describe("the drafts describe the system that exists", () => {
  it("protected handoff is described as unavailable while the capability is off", () => {
    /* The pairing is the point: activating recipient identity verification
       makes this assertion fail, which forces the copy to change with the
       capability instead of drifting away from it. */
    const text = legalDocumentText(SAME_DAY_SHIPMENT_TERMS_ID);
    if (isRecipientIdentityCapabilityAvailable()) {
      expect(text).not.toMatch(/Couranr cannot take a Protected Handoff shipment today/i);
    } else {
      expect(text).toMatch(/Couranr cannot take a Protected Handoff shipment today/i);
      expect(legalDocumentText("privacy")).toMatch(/This check is not switched on today\./);
    }
  });

  it("the prohibited list is the shipment authority's list, exactly", () => {
    // Both directions. A class added to the authority with no customer-readable
    // line, or a line for a class that is not prohibited, both fail here.
    expect(PROHIBITED_ITEM_LINES).toHaveLength(PROHIBITED_CLASSES.length);
    expect(new Set(PROHIBITED_ITEM_LINES).size).toBe(PROHIBITED_CLASSES.length);
    for (const line of PROHIBITED_ITEM_LINES) {
      expect(legalDocumentText("prohibited-items")).toContain(line);
    }
  });

  it("the prohibited-items policy describes the three-answer declaration", () => {
    const text = legalDocumentText("prohibited-items");
    expect(text).toMatch(/Not sure, or not answered/i);
    expect(text).toMatch(/Nothing Couranr's software thinks\s+can prohibit a shipment on its own/i);
  });

  it("it cites the merchant acknowledgement version rather than restating one", () => {
    expect(legalDocumentText("prohibited-items")).toContain(
      ACKNOWLEDGEMENT_VERSIONS.prohibited_items,
    );
  });

  it("the claims document matches the problem-report vocabulary in the server module", () => {
    const text = legalDocumentText("claims-and-loss");
    expect([...CUSTOMER_PROBLEM_TYPES].sort()).toEqual(
      ["damaged", "missing", "undelivered", "wrong_item"].sort(),
    );
    for (const phrase of [
      "arrived damaged",
      "Something is missing",
      "wrong item arrived",
      "never arrived",
    ]) {
      expect(text).toContain(phrase);
    }
    for (const state of ["Reported", "Awaiting evidence", "Under review", "Resolved"]) {
      expect(text).toContain(state);
    }
  });

  it("the claims document's evidence limits match the server's", () => {
    const text = legalDocumentText("claims-and-loss");
    expect(MAX_CUSTOMER_PROBLEM_PHOTOS).toBe(5);
    expect(MAX_CUSTOMER_PROBLEM_BYTES).toBe(10 * 1024 * 1024);
    expect(text).toContain("up to five photographs");
    expect(text).toContain("10 MB");
  });

  it("the claims document refuses to state what Couranr pays", () => {
    expect(legalDocumentText("claims-and-loss")).toMatch(
      /not\s+written in this draft/i,
    );
  });
});

/* --------------------------------------------------- customer-copy rules - */

describe("customer copy rules", () => {
  const text = allLegalDocumentText();

  it("contains no emoji", () => {
    expect(text.match(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{2BFF}\u{FE0F}]/gu) ?? []).toEqual([]);
  });

  it("uses the word guarantee only to deny one", () => {
    /* Mirrors the public-claims allowlist: a negation is legal, a promise is
       not, and the allowance is judged on a window around THIS match so a
       denial elsewhere cannot excuse a promise here. */
    const offenders: string[] = [];
    for (const m of text.matchAll(/guarante\w*/gi)) {
      const window = text.slice(Math.max(0, m.index - 80), m.index + m[0].length + 80);
      if (!/not a guarantee|never|no guarantee/i.test(window)) offenders.push(window.trim());
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("never says a Couranr person or founder is behind the service", () => {
    expect(text).not.toMatch(/\bfounder\b/i);
  });

  it("every section has a stable anchor id and a heading", () => {
    for (const id of LEGAL_DOCUMENT_IDS) {
      const sections = legalSections(id);
      expect(sections.length).toBeGreaterThan(0);
      const ids = sections.map((s) => s.id);
      expect(new Set(ids).size, `${id} repeats a section id`).toBe(ids.length);
      for (const s of sections) {
        expect(s.id).toMatch(/^[a-z0-9-]+$/);
        expect(s.heading.trim()).not.toBe("");
        expect(s.blocks.length).toBeGreaterThan(0);
      }
    }
  });
});

/* --------------------------------------- the $300 / 80 lb reconciliation - */

describe("the delivery policy page no longer contradicts the consumer flow", () => {
  const src = readFileSync(DELIVERY_POLICY, "utf8");
  const rendered = stripComments(src);

  it("publishes no unsourced weight or value figure", () => {
    // Neither number has a decision record behind it, and the value one
    // contradicted CONSUMER_MAX_DECLARED_VALUE_CENTS on a live page.
    expect(rendered).not.toMatch(/80\s?lbs?/i);
    expect(rendered.match(/\$\s?\d/g) ?? []).toEqual([]);
  });

  it("derives the declared-value ceiling from the same constant the server uses", () => {
    expect(rendered).toContain("CONSUMER_MAX_DECLARED_VALUE_CENTS");
    expect(rendered).toContain("declaredValueDollars");
  });

  it("derives the weight bands from the governed module", () => {
    expect(rendered).toContain("WEIGHT_INCLUDED_THROUGH_LB");
    expect(rendered).toContain("WEIGHT_SURCHARGE_THROUGH_LB");
  });

  it("scopes itself to the Same Day terms rather than competing with them", () => {
    expect(rendered).toContain("SAME_DAY_SHIPMENT_TERMS_ID");
    expect(rendered).toMatch(/that document is the one that applies/i);
  });

  it("renders no date computed at request time", () => {
    // `new Date().toLocaleDateString()` claimed the page was updated today,
    // every day, in whatever locale the server happened to have.
    expect(rendered).not.toContain("new Date()");
  });
});

/* ------------------------------------------------------- reachability ---- */

describe("the documents are reachable", () => {
  const shells = readFileSync(
    path.join(ROOT, "components/couranr/shell/shells.tsx"),
    "utf8",
  );

  it("all three public footers render the legal column", () => {
    // One shared column, used three times. Counting the USES is what catches a
    // footer that was left out; counting the definition would not.
    expect(stripComments(shells).match(/<LegalFooterColumn \/>/g) ?? []).toHaveLength(3);
  });

  it("the footer derives its links from the registry", () => {
    expect(shells).toContain("LEGAL_DOCUMENT_LIST");
    expect(shells).toContain("legalDocumentHref");
    // No hand-typed legal path may appear in the shell.
    expect(stripComments(shells)).not.toMatch(/href="\/legal/);
  });

  it("every document has a page route the registry can build", () => {
    for (const doc of LEGAL_DOCUMENT_LIST) {
      expect(legalDocumentHref(doc.id)).toBe(`/legal/${doc.slug}`);
    }
    // The dynamic segment is the only page file; an index page sits beside it.
    expect(statSync(path.join(LEGAL_ROUTE, "page.tsx")).isFile()).toBe(true);
    expect(statSync(path.join(LEGAL_ROUTE, "[document]/page.tsx")).isFile()).toBe(true);
  });
});

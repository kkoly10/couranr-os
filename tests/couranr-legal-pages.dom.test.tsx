import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

/**
 * The legal routes, rendered.
 *
 * `tests/couranr-legal-documents.test.ts` proves the registry and the prose are
 * correct. This file proves a reader actually SEES them — which is the whole
 * defect being closed, because the version string was already correct in the
 * code and simply had no rendered home. A content test that never renders would
 * have passed just as happily before this slice as after it.
 *
 * The REAL route components are awaited and rendered here, not a stand-in view:
 * the `[document]` page is where slug resolution, the 404 and the shared view
 * are wired together, and wiring is what this is for.
 */

vi.mock("next/navigation", () => ({
  // Next's own `notFound()` throws a framework error object. A plain throw with
  // a recognisable message keeps the assertion about the route's behaviour
  // rather than about Next's internals.
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  usePathname: () => "/legal",
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

// The shell module imports SignOutButton, which reaches the browser Supabase
// client at module scope.
vi.mock("@/lib/supabaseClient", () => ({
  supabase: { auth: { signOut: async () => ({ error: null }) } },
}));

const {
  CONSUMER_MAX_DECLARED_VALUE_CENTS,
  CONSUMER_SENDER_TERMS_VERSION,
  declaredValueDollars,
} = await import("@/lib/couranr/consumer/protection");
const {
  COUNSEL_REVIEW_HEADING,
  LEGAL_DOCUMENT_LIST,
  OPEN_FOR_LEGAL_REVIEW,
  SAME_DAY_SHIPMENT_TERMS_ID,
  legalDocumentHref,
} = await import("@/lib/couranr/legal/registry");
const LegalDocumentRoute = await import(
  "@/app/(couranr)/(public)/(master-public)/legal/[document]/page"
);
const LegalIndexRoute = await import("@/app/(couranr)/(public)/(master-public)/legal/page");
const { PublicShell } = await import("@/components/couranr/shell/shells");

async function renderDocument(slug: string) {
  const element = await LegalDocumentRoute.default({
    params: Promise.resolve({ document: slug }),
  });
  render(element as React.ReactElement);
}

describe("every document renders, and shows its version", () => {
  it("the route enumerates every registered document", () => {
    expect(LegalDocumentRoute.generateStaticParams()).toEqual(
      LEGAL_DOCUMENT_LIST.map((d) => ({ document: d.slug })),
    );
  });

  it.each(LEGAL_DOCUMENT_LIST.map((d) => [d.slug, d.title, d.version] as const))(
    "/legal/%s renders and exposes its version",
    async (slug, title, version) => {
      await renderDocument(slug);

      expect(screen.getByRole("heading", { level: 1, name: title })).toBeTruthy();
      // The version is RENDERED, not merely exported. Asserted through the DOM
      // hook so a layout change that drops the line fails here.
      const stamped = document.querySelector(`[data-couranr-legal-version="${version}"]`);
      expect(stamped, `no rendered version for ${slug}`).not.toBeNull();
      expect(stamped!.textContent).toBe(version);
    },
  );

  it.each(LEGAL_DOCUMENT_LIST.map((d) => [d.slug] as const))(
    "/legal/%s carries the counsel-review notice and every open item",
    async (slug) => {
      await renderDocument(slug);

      expect(screen.getByRole("heading", { level: 2, name: COUNSEL_REVIEW_HEADING })).toBeTruthy();
      expect(screen.getByText(/no lawyer has reviewed it/i)).toBeTruthy();

      const open = document.getElementById("open-for-legal-review")!;
      expect(open).not.toBeNull();
      for (const item of OPEN_FOR_LEGAL_REVIEW) {
        expect(within(open).getByText(item), `missing open item: ${item}`).toBeTruthy();
      }
    },
  );

  it("the Same Day terms render the server's exact version and the derived ceiling", async () => {
    const doc = LEGAL_DOCUMENT_LIST.find((d) => d.id === SAME_DAY_SHIPMENT_TERMS_ID)!;
    await renderDocument(doc.slug);

    const stamped = document.querySelector(
      `[data-couranr-legal-version="${CONSUMER_SENDER_TERMS_VERSION}"]`,
    );
    expect(stamped).not.toBeNull();

    // The ceiling reaches the page composed, so this is the end-to-end proof
    // that a constant change moves the rendered text.
    const ceiling = declaredValueDollars(CONSUMER_MAX_DECLARED_VALUE_CENTS);
    expect(document.body.textContent).toContain(ceiling);
    expect(document.body.textContent).toMatch(/Couranr records this version against your shipment/i);
  });

  it("an unknown slug is a 404, not a redirect", async () => {
    await expect(
      LegalDocumentRoute.default({ params: Promise.resolve({ document: "made-up" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("each document's metadata names the document", async () => {
    for (const doc of LEGAL_DOCUMENT_LIST) {
      const meta = await LegalDocumentRoute.generateMetadata({
        params: Promise.resolve({ document: doc.slug }),
      });
      expect(meta.title).toContain(doc.title);
    }
  });
});

describe("the index lists every document", () => {
  it("links each one at its registry href", () => {
    render(<LegalIndexRoute.default />);
    for (const doc of LEGAL_DOCUMENT_LIST) {
      const link = screen.getByRole("link", { name: doc.title });
      expect(link.getAttribute("href")).toBe(legalDocumentHref(doc.id));
    }
    expect(screen.getByRole("heading", { level: 2, name: COUNSEL_REVIEW_HEADING })).toBeTruthy();
  });
});

describe("the public footers reach the documents", () => {
  it.each(["master", "consumer", "business"] as const)(
    "the %s public shell footer carries the legal column",
    (variant) => {
      render(
        <PublicShell variant={variant}>
          <p>content</p>
        </PublicShell>,
      );

      const legal = screen.getByRole("navigation", { name: "Legal" });
      for (const doc of LEGAL_DOCUMENT_LIST) {
        const link = within(legal).getByRole("link", { name: doc.navLabel });
        expect(link.getAttribute("href")).toBe(legalDocumentHref(doc.id));
      }
    },
  );
});

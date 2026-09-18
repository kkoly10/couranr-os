import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * PUB-004 /send — the sender's clickwrap, and the one thing it must never be.
 *
 * THE DEFECT THIS FILE EXISTS FOR. `couranr_record_consumer_trust` writes
 * `sender_terms_version` and `sender_terms_accepted_at` onto every submitted
 * consumer request, so the row asserts that a named, versioned document was
 * accepted at a named moment. The sentence the sender actually ticked named no
 * document at all. The RECORDED EVIDENCE WAS STRONGER THAN THE UI THAT
 * GENERATED IT — the worst direction for that gap to run, because the row is
 * what a claim is decided on and the screen is what the sender saw.
 *
 * Nothing already in the suite could see it. The parity test proves the copy
 * matches MKT-005 byte for byte, and it did; the legal-document tests prove the
 * registry's version IS the constant the server records, and it was; the funnel
 * test proves both boxes gate the submit, and they do. Every one of those stays
 * green while the sentence between them says nothing. So the assertions here
 * are about CORRESPONDENCE: that the words name the documents, that the
 * documents are reachable before the box can be ticked, and that the version on
 * screen is the exact string the server is going to store.
 *
 * Why the links are not in the copy string: MKT-005 stores words and not
 * destinations (`routes_excluded`), and the parity test refuses a path or a URL
 * inside any locked string. The citation — title, version and href as one
 * object — comes from `lib/couranr/legal/registry.ts`, which is the module that
 * owns a version, and `SendFlow` renders it as JSX beside the copy.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@stripe/stripe-js", () => ({ loadStripe: vi.fn(async () => ({ __stripe: true })) }));
vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: any) => <div>{children}</div>,
  PaymentElement: () => <div />,
  useStripe: () => ({ confirmPayment: vi.fn() }),
  useElements: () => ({}),
}));

import { SendFlow } from "@/components/couranr/sameday/SendFlow";
import { GUEST_STORAGE_KEY } from "@/lib/couranr/sameday/liveAdapters";
import { SEND_COPY } from "@/lib/couranr/public/masterSameDayCopy";
import { CONSUMER_SENDER_TERMS_VERSION } from "@/lib/couranr/consumer/protection";
import {
  LEGAL_DOCUMENTS,
  legalCitation,
  legalDocumentHref,
  SAME_DAY_SHIPMENT_TERMS_ID,
  senderShipmentTermsCitation,
} from "@/lib/couranr/legal/registry";
import { LEGAL_SECTIONS } from "@/lib/couranr/legal/documents";

const ROOT = path.join(__dirname, "..");
const TERMS = senderShipmentTermsCitation();
const PROHIBITED = legalCitation("prohibited-items");

/* ------------------------------------------------- the words, on their own -- */

describe("the shipment certification says what the server records", () => {
  const ack = SEND_COPY.acknowledgement;

  /* Each of these is a separate representation the row implies the sender
     made. A single "covers the requirement" assertion would go green on a
     string that dropped four of the five. */
  const REQUIRED: ReadonlyArray<readonly [string, RegExp]> = [
    ["the sender is an adult", /\bI am 18 or older\b/],
    ["the sender is authorized to send", /\bauthorized to send\b/],
    ["the recipient is an adult", /\brecipient is 18 or older\b/],
    ["the description is accurate", /\bdescription\b/],
    ["the quantity is accurate", /\bquantity\b/],
    ["the declared value is accurate", /\bdeclared value\b/],
    ["…and says those are ACCURATE, not merely listed", /\baccurate\b/],
    ["agreement is expressed, not implied", /\bI agree to\b/],
  ];

  it.each(REQUIRED)("states: %s", (_label, pattern) => {
    expect(ack, `missing from: ${ack}`).toMatch(pattern);
  });

  it("names BOTH documents by the exact titles the legal registry owns", () => {
    /* Not "contains the word prohibited". The clickwrap has to name the
       document it links, so the title in the sentence and the title on the
       page are the same string or this fails. That is what stops the copy and
       the registry drifting into two differently-named documents. */
    expect(ack).toContain(LEGAL_DOCUMENTS[SAME_DAY_SHIPMENT_TERMS_ID].title);
    expect(ack).toContain(LEGAL_DOCUMENTS["prohibited-items"].title);
  });

  it("POSITIVE CONTROL: the coverage matchers reject the copy this replaced", () => {
    /* The string that shipped before this slice. If the assertions above can
       pass against it, they are decorative. */
    const old =
      "I confirm this item is eligible for delivery, that the value I declared is honest, "
      + "that I am 18 or older, and that I have authority to send or collect it.";
    const missed = REQUIRED.filter(([, pattern]) => !pattern.test(old));
    expect(missed.length).toBeGreaterThan(0);
    expect(old).not.toContain(LEGAL_DOCUMENTS[SAME_DAY_SHIPMENT_TERMS_ID].title);
  });

  it("the electronic-transactions consent covers the act AND the channel", () => {
    const ec = SEND_COPY.electronic_consent;
    expect(ec).toMatch(/conduct this transaction electronically/i);
    expect(ec).toMatch(/receive Couranr records and notices by email/i);
  });

  it("carries no href, path or URL — the links are JSX, not copy", () => {
    /* The narrow restatement of what the MKT-005 parity test enforces over
       every locked string, kept here so the reason is attached to the strings
       it constrains: a destination inside locked copy is a second authority
       for where a document lives. */
    for (const s of [ack, SEND_COPY.electronic_consent, SEND_COPY.legal_read_first]) {
      expect(s, s).not.toMatch(/https?:\/\//);
      expect(s, s).not.toMatch(/(^|\s)\/[a-z[]/);
      expect(s, s).not.toContain("href");
    }
  });

  it("uses no emoji anywhere in customer copy", () => {
    for (const s of [ack, SEND_COPY.electronic_consent, SEND_COPY.legal_read_first]) {
      expect(s, s).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});

/* ------------------------------------ the version, against the server's own -- */

describe("the cited version IS the version the server records", () => {
  it("the citation the clickwrap uses resolves to CONSUMER_SENDER_TERMS_VERSION", () => {
    expect(TERMS.version).toBe(CONSUMER_SENDER_TERMS_VERSION);
    expect(TERMS.href).toBe(legalDocumentHref(SAME_DAY_SHIPMENT_TERMS_ID));
  });

  it("and that constant is what send.ts hands the trust command", () => {
    /* The other end of the correspondence, read from the file rather than
       remembered. `p_terms_version` is SERVER-STATED — the browser never puts
       a version on the wire — so this is the line that decides what lands in
       `couranr_delivery_requests.sender_terms_version`. If someone replaces it
       with a literal or with a body field, the UI would still cite the registry
       and the row would store something else: exactly the split this slice
       closed, reopened from the other side. */
    const send = readFileSync(path.join(ROOT, "lib/couranr/consumer/send.ts"), "utf8");
    expect(send).toMatch(/p_terms_version:\s*CONSUMER_SENDER_TERMS_VERSION\s*,/);
    expect(send).not.toMatch(/p_terms_version:\s*["'`]/);
  });

  it("SendFlow states no version of its own", () => {
    const flow = readFileSync(
      path.join(ROOT, "components/couranr/sameday/SendFlow.tsx"),
      "utf8",
    );
    expect(flow).not.toContain(CONSUMER_SENDER_TERMS_VERSION);
    expect(flow).not.toContain(PROHIBITED.version);
  });

  it("the DOCUMENT at that version really contains what the checkbox summarizes", () => {
    /* The third side of the triangle, and the one that decides whether the
       version may stay put.
       A checkbox saying "I agree to the Same Day Shipment Terms" is only honest
       if those terms carry the representations the sentence attributes to them.
       If they did not, this slice would have had to bump
       CONSUMER_SENDER_TERMS_VERSION — and `lib/couranr/legal/registry.ts` says
       in its own header why that is the expensive option: the string is already
       stored on production rows, and renaming it orphans every acceptance
       recorded against it.
       It did not have to. The document already states all four, so the
       clickwrap became a faithful summary of unchanged text at an unchanged
       version. This test is what keeps that true in the other direction — an
       edit that drops the recipient-age sentence from the document leaves the
       checkbox claiming it, which is the original defect wearing different
       clothes. */
    const prose = LEGAL_SECTIONS[SAME_DAY_SHIPMENT_TERMS_ID]
      .flatMap((s) => s.blocks)
      .flatMap((b) => (b.kind === "text" ? [b.text] : b.items))
      .join("\n");

    expect(prose, "sender age").toMatch(/You must be 18 or older to send a shipment/i);
    expect(prose, "recipient age").toMatch(/receiving it must also be 18 or older/i);
    expect(prose, "right to send").toMatch(/own what you are sending, or have the owner/i);
    expect(prose, "accuracy of what is declared").toMatch(/Deliberately declaring/i);
  });
});

/* ------------------------------------------------ the clickwrap, rendered -- */

const API = "/api/couranr/consumer";
const PLACES = `${API}/places`;
const MANIFEST = `${API}/pickup-manifest`;
const READINESS = `${API}/readiness`;
const GUEST_TOKEN = "guest-clickwrap-token";
const originalFetch = globalThis.fetch;

function installFetch() {
  globalThis.fetch = vi.fn(async (input: any) => {
    const url: string = typeof input === "string" ? input : String(input?.url ?? input);
    const body = {
      [PLACES]: { suggestions: [{ placeId: "pl-1", text: "100 Main Street, Town, VA" }] },
      [MANIFEST]: { pickupManifest: { manifestVersion: 1, manifest: {} } },
      [READINESS]: { readiness: { state: "ready" } },
    }[url.split("?")[0]];
    if (!body) return { ok: false, status: 404, json: async () => ({ error: "unhandled" }) };
    return { ok: true, status: 200, json: async () => body };
  }) as unknown as typeof fetch;
}

const btn = (name: string | RegExp) =>
  screen.getByRole("button", { name }) as HTMLButtonElement;

async function selectAddress(inputId: string) {
  const input = document.getElementById(inputId) as HTMLInputElement;
  await userEvent.type(input, "100 Main");
  await userEvent.click(await screen.findByText("100 Main Street, Town, VA"));
}

async function driveToReviewStep() {
  render(<SendFlow mode="live" />);
  await userEvent.click(btn(/Send something I have/));
  await selectAddress("send-pickup");
  await selectAddress("send-destination");
  await userEvent.click(btn("Continue")); // trip -> item
  await userEvent.type(screen.getByLabelText(SEND_COPY.item_question), "a birthday cake");
  await userEvent.type(screen.getByLabelText("Weight (lb)"), "8");
  await userEvent.selectOptions(screen.getByLabelText("Restricted items"), "none");
  await userEvent.click(screen.getByLabelText(/ready to hand over/i));
  await userEvent.type(screen.getByLabelText(SEND_COPY.declared_value_label), "20");
  await userEvent.click(btn("Continue")); // item -> timing
  await userEvent.click(screen.getByLabelText(SEND_COPY.timing_asap));
  await userEvent.click(btn("Continue")); // timing -> review
}

describe("the documents are readable BEFORE the sender can accept", () => {
  beforeEach(() => {
    window.sessionStorage.setItem(
      GUEST_STORAGE_KEY,
      JSON.stringify({ token: GUEST_TOKEN, expiresAt: new Date(Date.now() + 3600_000).toISOString() }),
    );
    installFetch();
  });
  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    window.sessionStorage.clear();
  });

  it("renders both documents as real links, versioned, with nothing yet accepted", async () => {
    await driveToReviewStep();

    const block = document.querySelector('[data-couranr-clickwrap="documents"]');
    expect(block, "the clickwrap block itself carries the links").not.toBeNull();

    for (const cite of [TERMS, PROHIBITED]) {
      const link = block!.querySelector(
        `a[data-couranr-legal-link="${cite.documentId}"]`,
      ) as HTMLAnchorElement | null;
      expect(link, `no link for ${cite.documentId}`).not.toBeNull();
      // getAttribute, not `.href`: jsdom resolves the property against
      // about:blank and would report an absolute URL for a relative path.
      expect(link!.getAttribute("href")).toBe(cite.href);
      expect(link!.textContent).toBe(cite.title);
      expect(
        block!.querySelector(`[data-couranr-legal-version="${cite.version}"]`),
        `no rendered version for ${cite.documentId}`,
      ).not.toBeNull();
      expect(block!.textContent).toContain(cite.version);
    }

    /* THE ASSERTION THE SLICE EXISTS FOR, stated against the server's constant
       rather than against the registry a second time: what is on screen is the
       string that will be stored. */
    expect(block!.textContent).toContain(CONSUMER_SENDER_TERMS_VERSION);

    // BEFORE: neither box is ticked and the flow cannot advance, so the
    // documents were available to read at a point where nothing was accepted.
    const cert = screen.getByLabelText(SEND_COPY.acknowledgement) as HTMLInputElement;
    const electronic = screen.getByLabelText(SEND_COPY.electronic_consent) as HTMLInputElement;
    expect(cert.checked).toBe(false);
    expect(electronic.checked).toBe(false);
    expect(btn("Continue to payment").disabled).toBe(true);
  });

  it("reading a document cannot tick a box: no link sits inside a consent label", async () => {
    await driveToReviewStep();

    /* Not cosmetic. A link inside a <label> toggles that label's control when
       clicked, so a sender who opens the terms would silently accept them —
       consent recorded for a document they were in the act of going to read.
       It would also fold the link text into the label's accessible text and
       break every `getByLabelText(SEND_COPY.acknowledgement)` in the suite. */
    for (const copy of [SEND_COPY.acknowledgement, SEND_COPY.electronic_consent]) {
      const box = screen.getByLabelText(copy);
      const label = box.closest("label");
      expect(label, `no wrapping label for: ${copy}`).not.toBeNull();
      expect(label!.querySelectorAll("a")).toHaveLength(0);
    }

    const link = document.querySelector(
      `a[data-couranr-legal-link="${TERMS.documentId}"]`,
    ) as HTMLAnchorElement;
    // A new tab, because /send is a five-step form held in component state:
    // navigating away in place loses the trip, the item and the recipient.
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");

    await userEvent.click(link);
    const cert = screen.getByLabelText(SEND_COPY.acknowledgement) as HTMLInputElement;
    await waitFor(() => expect(cert.checked).toBe(false));
    expect(btn("Continue to payment").disabled).toBe(true);
  });
});

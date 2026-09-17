import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * OPS-012, driven.
 *
 * Browser verification is deferred to MVP completion by owner decision
 * (2026-09-03), and a jsdom test that drives the real component against a
 * recorded response is the accepted stand-in. It is here for one specific
 * defect class this repo has already shipped: **every canonical route nests
 * its payload under a named key, and a client that reads it flat gets
 * `undefined` with a green typecheck**, because the routes return untyped
 * JSON. Proof upload was dead for its entire life that way.
 *
 * The second thing it proves is the one that matters for a claim: a section
 * Couranr could not READ must not render as a section with nothing in it.
 */

const { call } = vi.hoisted(() => ({ call: vi.fn() }));
const { fetchOperationsProofUrl } = vi.hoisted(() => ({
  fetchOperationsProofUrl: vi.fn(),
}));

vi.mock("@/components/couranr/requests/client", () => ({
  call,
  isApiFailure: (r: any) => r?.ok === false,
  withReference: (f: any) =>
    f?.correlationId ? `${f.error} Reference ${f.correlationId}.` : f?.error,
}));

vi.mock("@/components/couranr/dispatch/client", () => ({ fetchOperationsProofUrl }));

import { CustodyBundlePanel } from "@/components/couranr/operations/CustodyBundlePanel";

const DELIVERY_ID = "11111111-1111-4111-8111-111111111111";
const PREPACK_ID = "33333333-3333-4333-8333-333333333333";

function bundle(over: Record<string, any> = {}) {
  return {
    deliveryId: DELIVERY_ID,
    requestId: "22222222-2222-4222-8222-222222222222",
    reference: "CR-7Q2M-4KDX",
    fulfillmentState: "delivered",
    declaration: {
      description: "Two sealed bottles in a padded carton",
      packageCount: 1,
      orderReference: "SO-4417",
      handlingNotes: null,
      manifestSource: "consumer_statement",
      manifestPolicyVersion: "pickup-handoff-v2",
      declaredValueCents: 24000,
      protectionLevel: "protected_handoff",
      protectionPolicyVersion: "couranr-protection-v1-2026-09-01",
      restrictedClass: "alcohol",
      protectionGoverned: true,
    },
    senderTerms: {
      termsVersion: "couranr-terms-v3",
      termsAcceptedAt: "2026-09-10T14:00:00.000Z",
      electronicConsentAt: "2026-09-10T14:00:01.000Z",
      adultAttestedAt: "2026-09-10T14:00:02.000Z",
    },
    pickup: {
      credential: {
        state: "consumed",
        verifiedAt: "2026-09-10T15:04:00.000Z",
        issuedAt: "2026-09-10T14:30:00.000Z",
        expiresAt: "2026-09-10T20:30:00.000Z",
        failedAttempts: 0,
        generation: 1,
      },
      place: {
        recordedAt: "2026-09-10T15:05:00.000Z",
        latitude: 38.4,
        longitude: -77.38,
        accuracyMeters: 9,
      },
      observedPackageCount: 1,
      prepackPhoto: {
        proofId: PREPACK_ID,
        proofStage: "pickup",
        proofType: "item_prepack_photo",
        finalizedAt: "2026-09-10T15:00:00.000Z",
        capturedAt: "2026-09-10T14:59:30.000Z",
        hasMedia: true,
      },
      sealedPackagePhoto: null,
      documentationRequired: true,
      credentialAfterDocumentation: true,
    },
    seal: {
      sealIdentifier: "CRS-88231",
      appliedAt: "2026-09-10T15:03:00.000Z",
      dropoffCondition: "damaged",
      dropoffRecordedAt: "2026-09-10T18:29:30.000Z",
      sealedPackagePhoto: null,
      dropoffSealPhoto: null,
    },
    dropoff: {
      place: {
        recordedAt: "2026-09-10T18:32:00.000Z",
        latitude: 38.42111,
        longitude: -77.40222,
        accuracyMeters: 6,
      },
      proofMethodUsed: "direct_handoff",
      recipientCredential: {
        state: "consumed",
        verifiedAt: "2026-09-10T18:31:30.000Z",
        issuedAt: "2026-09-10T18:00:00.000Z",
        expiresAt: "2026-09-11T02:00:00.000Z",
        failedAttempts: 1,
        generation: 2,
      },
      recipientAdultAttestation: {
        version: "couranr-recipient-attestation-v1",
        attestedAt: "2026-09-10T18:30:00.000Z",
        required: true,
      },
      identity: {
        required: true,
        recorded: true,
        provider: "stripe_identity",
        state: "verified",
        identityVerified: true,
        adultVerified: true,
        authorizedRecipientMatch: true,
        verifiedAt: "2026-09-10T18:31:00.000Z",
        policyVersion: "couranr-identity-v1",
      },
      sealConditionRequired: true,
    },
    evidence: [
      {
        proofId: PREPACK_ID,
        proofStage: "pickup",
        proofType: "item_prepack_photo",
        finalizedAt: "2026-09-10T15:00:00.000Z",
        capturedAt: "2026-09-10T14:59:30.000Z",
        hasMedia: true,
      },
    ],
    claims: [
      {
        claimId: "66666666-6666-4666-8666-666666666666",
        problemType: "damaged",
        details: "One bottle arrived cracked.",
        state: "under_review",
        submittedAt: "2026-09-11T09:00:00.000Z",
        resolvedAt: null,
        version: 2,
        evidence: [
          { evidenceId: "88888888-8888-4888-8888-888888888888", finalizedAt: null },
        ],
      },
    ],
    incidents: [
      {
        incidentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        incidentType: "damage",
        incidentState: "under_review",
        severity: "urgent",
        summary: "Customer reports a cracked bottle.",
        openedAt: "2026-09-11T09:05:00.000Z",
        resolvedAt: null,
        closedAt: null,
        version: 1,
      },
    ],
    unavailable: [],
    ...over,
  };
}

describe("the Operations custody panel", () => {
  beforeEach(() => {
    call.mockReset();
    fetchOperationsProofUrl.mockReset();
  });

  it("reads the payload under its named key and shows the whole chain", async () => {
    call.mockResolvedValueOnce({ ok: true, value: { custody: bundle() } });

    render(<CustodyBundlePanel deliveryId={DELIVERY_ID} />);

    await waitFor(() => expect(call).toHaveBeenCalledTimes(1));
    expect(call.mock.calls[0][0]).toBe(
      `/api/couranr/operations/deliveries/${DELIVERY_ID}/custody`
    );

    // The sender's own words, and what they said it was worth.
    await screen.findByText("Two sealed bottles in a padded carton");
    expect(screen.getByText("$240.00")).toBeTruthy();
    expect(screen.getByText("protected handoff")).toBeTruthy();
    expect(screen.getByText("couranr-protection-v1-2026-09-01")).toBeTruthy();
    expect(screen.getByText("couranr-terms-v3")).toBeTruthy();

    // The seal, its identifier and the condition it arrived in. Two nodes say
    // "damaged" — the seal's condition and the claim's type — and that is the
    // point: the investigator sees both halves without leaving the screen.
    expect(screen.getByText("CRS-88231")).toBeTruthy();
    expect(screen.getAllByText("damaged").length).toBe(2);

    // The recipient side.
    expect(screen.getByText(/couranr-recipient-attestation-v1/)).toBeTruthy();
    expect(screen.getByText("Matched")).toBeTruthy();
    expect(screen.getByText("verified")).toBeTruthy();

    // The claim and the incident, together, on the same screen.
    expect(screen.getByText(/One bottle arrived cracked/)).toBeTruthy();
    expect(screen.getByText(/Customer reports a cracked bottle/)).toBeTruthy();

    // The two rules that must be on the screen the investigator is reading.
    expect(screen.getByText(/never issues product-value compensation/i)).toBeTruthy();
    expect(screen.getByText(/issues no refund, no credit and no capture/i)).toBeTruthy();
  });

  /**
   * The bug class this test exists for. A client that read the payload flat
   * would get `undefined` here and render as though the delivery had no
   * custody record at all — with a green typecheck, because the route returns
   * untyped JSON.
   */
  it("does not render a flat payload as a custody record", async () => {
    call.mockResolvedValueOnce({ ok: true, value: bundle() });
    render(<CustodyBundlePanel deliveryId={DELIVERY_ID} />);
    await screen.findByText(/could not load the custody record/i);
    expect(screen.queryByText("CRS-88231")).toBeNull();
  });

  it("names a section it could not read instead of calling it empty", async () => {
    call.mockResolvedValueOnce({
      ok: true,
      value: { custody: bundle({ seal: null, unavailable: ["seal", "identity"] }) },
    });

    render(<CustodyBundlePanel deliveryId={DELIVERY_ID} />);

    await screen.findByText(/Part of this custody record could not be read/i);
    expect(screen.getByText(/the security seal/)).toBeTruthy();
    expect(screen.getByText(/the recipient identity check/)).toBeTruthy();
    // The load-bearing negative: an unreadable seal must NOT read as "no seal
    // was applied". An investigator deciding a damage claim on that sentence
    // would be deciding it on a database fault.
    expect(screen.queryByText(/No security seal was recorded/i)).toBeNull();
    expect(screen.getByText(/could not read the seal record/i)).toBeTruthy();
  });

  it("says 'none was recorded' only when the read actually succeeded", async () => {
    call.mockResolvedValueOnce({
      ok: true,
      value: { custody: bundle({ seal: null, unavailable: [] }) },
    });
    render(<CustodyBundlePanel deliveryId={DELIVERY_ID} />);
    await screen.findByText(/No security seal was recorded/i);
    expect(screen.queryByText(/could not read the seal record/i)).toBeNull();
  });

  it("opens a photograph by id and writes no URL into the page", async () => {
    call.mockResolvedValueOnce({ ok: true, value: { custody: bundle() } });
    fetchOperationsProofUrl.mockResolvedValueOnce({
      ok: true,
      value: { url: "https://storage.example.test/signed-abc?token=xyz", expiresInSeconds: 900 },
    });
    const opened = { opener: {} as any };
    const open = vi.fn(() => opened);
    Object.defineProperty(window, "open", { configurable: true, value: open });

    render(<CustodyBundlePanel deliveryId={DELIVERY_ID} />);
    const buttons = await screen.findAllByRole("button", { name: /open image in a new tab/i });
    await userEvent.click(buttons[0]);

    await waitFor(() => expect(fetchOperationsProofUrl).toHaveBeenCalledTimes(1));
    // The PROOF ID is the whole handle the panel holds. The TTL is decided
    // server-side by viewer role; the panel only reads it back.
    expect(fetchOperationsProofUrl).toHaveBeenCalledWith(PREPACK_ID);
    expect(open).toHaveBeenCalledWith(
      "https://storage.example.test/signed-abc?token=xyz",
      "_blank"
    );

    // A signed URL is a bearer capability for a private object. It must never
    // reach the DOM, where it survives in the page, in a screenshot and in
    // anything that scrapes the markup.
    expect(document.body.innerHTML).not.toContain("signed-abc");
    expect(document.body.innerHTML).not.toContain("token=xyz");
    expect(document.querySelectorAll("a[href]").length).toBe(0);
    await screen.findByText(/works for about 15 minutes/i);
  });

  it("fails closed when the bundle cannot be loaded at all", async () => {
    call.mockResolvedValueOnce({
      ok: false,
      status: 500,
      error: "Something went wrong.",
      correlationId: "cr_abcdefghjkmn",
    });

    render(<CustodyBundlePanel deliveryId={DELIVERY_ID} />);

    await screen.findByText(/could not load the custody record/i);
    // The reference a person reads back to support, and the sentence that
    // stops a reader concluding the driver recorded nothing.
    expect(screen.getByText(/cr_abcdefghjkmn/)).toBeTruthy();
    expect(
      screen.getByText(/does not mean no custody evidence was captured/i)
    ).toBeTruthy();
  });

  it("offers no control that would settle, pay or resolve anything", async () => {
    call.mockResolvedValueOnce({ ok: true, value: { custody: bundle() } });
    render(<CustodyBundlePanel deliveryId={DELIVERY_ID} />);
    await screen.findByText("CRS-88231");

    const labels = screen
      .getAllByRole("button")
      .map((b) => (b.textContent ?? "").toLowerCase());
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(/resolve|refund|credit|pay|compensat|settle|close/.test(label), label).toBe(false);
    }
  });
});

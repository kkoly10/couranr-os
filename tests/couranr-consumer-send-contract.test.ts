import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildEstimateBody,
  isEstimateBodyFailure,
} from "@/lib/couranr/sameday/liveAdapters";
import {
  isAcceptanceFailure,
  isConsumerSendBodyFailure,
  requireAcceptance,
  validateConsumerSendBody,
} from "@/lib/couranr/consumer/send";
import {
  CONSUMER_MAX_DECLARED_VALUE_CENTS,
  PROTECTION_THRESHOLDS,
} from "@/lib/couranr/consumer/protection";

/**
 * THE SEAM. Two validators stand between the sender and the database:
 *
 *   SendFlow -> buildEstimateBody   (client-side, free, refuses locally)
 *            -> validateConsumerSendBody (server-side, authoritative)
 *
 * They are separate on purpose — the local one refuses before any network call
 * or paid provider lookup happens, which is a cost requirement here, not a
 * nicety. Separate is fine. DIVERGENT is a live outage: the browser builds a
 * body it believes is complete, the server refuses it, and the sender sees a
 * generic failure on a form that told them nothing was missing.
 *
 * This file exists because that divergence was REAL, not hypothetical. Adding
 * the V1 trust fields to the server contract broke `/send` outright — every
 * estimate would have been refused `recipient_name_required` — and nothing in
 * 92 passing tests, a clean typecheck or a green build noticed, because each
 * side is internally consistent and no test had ever fed one into the other.
 *
 * So: build a body the way the UI builds it, and hand it to the server
 * validator that actually decides. Nothing is mocked; both are pure functions.
 */

/** The complete, honest input a finished /send form produces. */
const completeInput = {
  pickup: "100 Garrisonville Rd, Stafford, VA",
  destination: "1400 Central Park Blvd, Fredericksburg, VA",
  timingIntent: "asap" as const,
  pickupPlaceId: "place_pickup",
  dropoffPlaceId: "place_dropoff",
  contact: { name: "Alex Chen", mobile: "+15715550100", email: "alex@example.test" },
  recipient: { name: "Dana Reyes", email: "dana@example.test", mobile: "+15715550101" },
  // Re-entered by the sender; compared normalized and never persisted (M).
  recipientEmailConfirm: "dana@example.test",
  declaredValueCents: 2_000,
  acceptance: { shipmentCertification: true, electronicTransactions: true },
  shipment: {
    description: "One sealed shoebox, left of the front desk",
    weightLb: 12,
    restrictedClass: "none",
  },
};

/** Build like the UI, then judge like the server. */
function throughBothGates(input: unknown) {
  const built = buildEstimateBody(input as never);
  if (isEstimateBodyFailure(built)) {
    return { stage: "client" as const, reason: built.note };
  }
  const checked = validateConsumerSendBody(built.body);
  if (isConsumerSendBodyFailure(checked)) {
    return { stage: "server" as const, reason: checked.reason };
  }
  return { stage: "accepted" as const, value: checked.value };
}

describe("the body the UI builds is a body the server accepts", () => {
  it("passes a complete send all the way through both gates", () => {
    const r = throughBothGates(completeInput);
    expect(r.stage, `refused at the ${r.stage} gate: ${"reason" in r ? r.reason : ""}`).toBe(
      "accepted"
    );
  });

  it("carries every V1 trust field across the seam without loss", () => {
    /* The failure this catches is quieter than a refusal: the client builds the
       field, the server accepts the body, and the value silently does not
       arrive — which is exactly how the consumer recipient was null for the
       entire life of the flow while every test stayed green. */
    const r = throughBothGates(completeInput);
    expect(r.stage).toBe("accepted");
    if (r.stage !== "accepted") return;
    expect(r.value.contact.email).toBe("alex@example.test");
    expect(r.value.contact.phone).toBe("+15715550100"); // UI `mobile` -> API `phone`
    expect(r.value.recipient.name).toBe("Dana Reyes");
    expect(r.value.recipient.email).toBe("dana@example.test");
    expect(r.value.recipient.phone).toBe("+15715550101");
    expect(r.value.declaredValueCents).toBe(2_000);
    expect(r.value.acceptance.shipmentCertification).toBe(true);
    expect(r.value.acceptance.electronicTransactions).toBe(true);
  });

  it("refuses an incomplete send at the CLIENT gate, before any network call", () => {
    /* Which gate refuses is not cosmetic. The client gate is free; the server
       gate costs a round trip and, on the estimate path, provider lookups the
       owner pays for. Every field the sender can be told about locally must be
       refused locally — a field that reaches the server to be refused is a
       field the sender was not warned about in time. */
    const cases: Array<[string, unknown]> = [
      ["no recipient at all", { ...completeInput, recipient: undefined }],
      ["recipient with no email", { ...completeInput, recipient: { name: "Dana Reyes" } }],
      ["recipient with no name", { ...completeInput, recipient: { email: "dana@example.test" } }],
      ["no declared value", { ...completeInput, declaredValueCents: undefined }],
      [
        "declared value over the ceiling",
        { ...completeInput, declaredValueCents: CONSUMER_MAX_DECLARED_VALUE_CENTS + 1 },
      ],
      ["no sender email", { ...completeInput, contact: { name: "Alex Chen", mobile: "+15715550100" } }],
    ];
    for (const [label, input] of cases) {
      const r = throughBothGates(input);
      expect(r.stage, `"${label}" was not refused locally`).toBe("client");
      // And the refusal must be a sentence a sender can act on, not a code.
      if (r.stage === "client") {
        expect(r.reason, `"${label}" has no readable note`).toMatch(/[a-z]{3}.*[a-z]{3}/);
      }
    }
  });

  it("prices WITHOUT the acknowledgements — they gate the submit, not the quote", () => {
    /* The order matters and it is easy to get backwards. An estimate creates a
       DRAFT; asking the sender to accept terms before Couranr has told them the
       cost is the wrong order, and the database draws the same line —
       couranr_dr_consumer_acceptance_chk exempts `request_state = 'draft'` and
       begins to require the evidence only once the row leaves it.

       So both gates must PRICE an unaccepted body, and `requireAcceptance` must
       refuse to submit it. A single validator that required acceptance up front
       would pass every refusal-shaped test here while making /send ask for a
       signature before a price. */
    for (const acceptance of [
      undefined,
      { shipmentCertification: false, electronicTransactions: false },
      { shipmentCertification: true, electronicTransactions: false },
    ]) {
      const r = throughBothGates({ ...completeInput, acceptance });
      expect(r.stage, `pricing was blocked by acceptance ${JSON.stringify(acceptance)}`).toBe(
        "accepted"
      );
    }

    // And the submit gate refuses every one of them, naming which is missing.
    const reason = (a: unknown) => {
      const r = requireAcceptance(a);
      return isAcceptanceFailure(r) ? r.reason : "<accepted>";
    };
    expect(reason(undefined)).toBe("shipment_certification_required");
    expect(reason({ shipmentCertification: false, electronicTransactions: true })).toBe(
      "shipment_certification_required"
    );
    expect(reason({ shipmentCertification: true, electronicTransactions: false })).toBe(
      "electronic_consent_required"
    );
    expect(requireAcceptance(completeInput.acceptance).ok).toBe(true);

    // Truthiness is not consent, on the submit gate too.
    for (const truthy of ["true", 1, "2026-09-14T00:00:00Z", {}]) {
      expect(
        reason({ shipmentCertification: truthy, electronicTransactions: true }),
        `${JSON.stringify(truthy)} was accepted as consent`
      ).toBe("shipment_certification_required");
    }
  });

  it("blocks a MISTYPED recipient email before it can be used", () => {
    /* The recipient email is not a contact detail here — it is where a private
       bearer capability is delivered. One wrong character sends the adult
       attestation, identity verification and handoff PIN to a stranger, and
       unlike a wrong phone number nothing bounces back to say so. */
    const r = throughBothGates({ ...completeInput, recipientEmailConfirm: "dana@exampel.test" });
    expect(r.stage).toBe("client");

    // Absent entirely is a mismatch, not a skip.
    const missing = throughBothGates({ ...completeInput, recipientEmailConfirm: undefined });
    expect(missing.stage).toBe("client");
  });

  it("does not manufacture a mismatch out of case or spacing", () => {
    // Refusing "  Dana@Example.test " against "dana@example.test" would train
    // senders to distrust the field, which is worse than not having it.
    const r = throughBothGates({
      ...completeInput,
      recipientEmailConfirm: "  Dana@Example.TEST  ",
    });
    expect(r.stage, "a normalized-equal confirmation was refused").toBe("accepted");
  });

  it("never persists the confirmation — it is a gate, not evidence", () => {
    const r = throughBothGates(completeInput);
    expect(r.stage).toBe("accepted");
    if (r.stage !== "accepted") return;
    expect(JSON.stringify(r.value)).not.toContain("recipientEmailConfirm");
  });

  it("never lets the client gate pass something the SERVER then refuses", () => {
    /* The asymmetry that matters. Client-refuses/server-would-accept is merely
       conservative. Client-accepts/server-refuses is the outage. */
    const probes: unknown[] = [
      completeInput,
      { ...completeInput, declaredValueCents: 0 },
      /* THE TOP OF THE ACCEPTED BAND, not the policy ceiling. This probe used
         to carry CONSUMER_MAX_DECLARED_VALUE_CENTS ($500), which now passes
         vacuously: the client gate refuses it, so the stage is "client" and
         the assertion holds without ever exercising the server. $150 is the
         highest value that must actually reach the server and be accepted,
         which is what this list is for. $500's refusal is asserted explicitly
         in the submit-seam block below. */
      { ...completeInput, declaredValueCents: PROTECTION_THRESHOLDS.securePickupMaxCents },
      { ...completeInput, recipient: { ...completeInput.recipient, mobile: "" } },
      { ...completeInput, contact: { ...completeInput.contact, mobile: "" } },
      {
        ...completeInput,
        timingIntent: "scheduled" as const,
        requestedPickupLocal: "2026-09-20T14:30",
      },
      { ...completeInput, shipment: { ...completeInput.shipment, weightLb: null, weightBand: "0_25_lb" } },
    ];
    for (const input of probes) {
      const r = throughBothGates(input);
      expect(r.stage, `server refused a body the client built: ${"reason" in r ? r.reason : ""}`)
        .not.toBe("server");
    }
  });
});

/* ══════════════════════════ the SUBMIT seam ══════════════════════════════ */

describe("the submit seam cannot bypass availability", () => {
  /*
   * THE GAP AN INDEPENDENT REVIEWER FOUND. `throughBothGates` above covers the
   * ESTIMATE seam only. `liveAdapters.submitRequest` checks three local things
   * — a stated value, and the two acknowledgements — and then POSTs. It has no
   * availability gate of its own and deliberately should not have one: a second
   * copy of that rule in the adapter is exactly the duplication that let the
   * funnel and the server disagree in the first place.
   *
   * What must be true instead is that the ENDPOINT it posts to refuses. Today
   * the sender cannot reach this seam with an unavailable value — the item
   * step's Continue is disabled and editing the value stales the quote — but
   * "the UI won't let you" is not a security property. This test deliberately
   * goes around the step machine and drives the adapter contract directly, so a
   * future UI regression cannot quietly open the path.
   */
  const ADAPTER_ENDPOINT = "/api/couranr/consumer/submit";

  it("submitRequest posts to the endpoint that enforces the shared authority", () => {
    const src = readFileSync(
      path.join(__dirname, "..", "lib/couranr/sameday/liveAdapters.ts"),
      "utf8"
    );
    const seam = src.slice(src.indexOf("async submitRequest("), src.indexOf("async submitRequest(") + 1400);
    expect(seam, "the submit seam no longer calls the submit endpoint").toMatch(
      /guestCall\(API\.submit/
    );
    expect(src, "the submit endpoint constant moved").toContain(ADAPTER_ENDPOINT);
    /* And it must NOT have grown its own copy of the availability rule. */
    expect(seam, "the adapter grew a duplicate availability rule").not.toMatch(
      /evaluateConsumerProtectionAvailability|protection_level_unavailable/
    );
  });

  it("the endpoint behind that seam refuses an unavailable value", () => {
    /* Driven at the server contract the adapter posts INTO, with a body shaped
       exactly as the seam builds it, for every value in the unavailable band.
       This is the assertion the UI cannot make on the server's behalf. */
    for (const cents of [15_001, 20_000, 49_999, 50_000]) {
      const checked = validateConsumerSendBody({
        ...completeInput,
        declaredValueCents: cents,
      } as never);
      expect(
        isConsumerSendBodyFailure(checked),
        `$${(cents / 100).toFixed(2)} was accepted by the server the seam posts to`
      ).toBe(true);
      if (isConsumerSendBodyFailure(checked)) {
        expect(checked.reason).toBe("protection_level_unavailable");
      }
    }
  });

  it("and still accepts the top of the AVAILABLE band, so it is not refusing everything", () => {
    // POSITIVE CONTROL. Without it a validator that refused every body would
    // pass the assertion above and look like a working gate.
    const ok = validateConsumerSendBody({
      ...completeInput,
      declaredValueCents: 15_000,
    } as never);
    expect(isConsumerSendBodyFailure(ok), "the top of the accepted band was refused").toBe(false);
  });
});

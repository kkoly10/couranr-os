import { describe, expect, it } from "vitest";
import {
  buildEstimateBody,
  isEstimateBodyFailure,
} from "@/lib/couranr/sameday/liveAdapters";
import {
  isConsumerSendBodyFailure,
  validateConsumerSendBody,
} from "@/lib/couranr/consumer/send";
import { CONSUMER_MAX_DECLARED_VALUE_CENTS } from "@/lib/couranr/consumer/protection";

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
      [
        "certification unchecked",
        { ...completeInput, acceptance: { ...completeInput.acceptance, shipmentCertification: false } },
      ],
      [
        "electronic consent unchecked",
        { ...completeInput, acceptance: { ...completeInput.acceptance, electronicTransactions: false } },
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

  it("never lets the client gate pass something the SERVER then refuses", () => {
    /* The asymmetry that matters. Client-refuses/server-would-accept is merely
       conservative. Client-accepts/server-refuses is the outage. */
    const probes: unknown[] = [
      completeInput,
      { ...completeInput, declaredValueCents: 0 },
      { ...completeInput, declaredValueCents: CONSUMER_MAX_DECLARED_VALUE_CENTS },
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

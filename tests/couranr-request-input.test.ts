import { describe, expect, it } from "vitest";
import {
  isNormalizeFailure,
  normalizeDeliveryRequestInput,
} from "@/lib/couranr/requests/input";

const VALID = {
  pickupAddress: {
    line1: "10 Market St",
    city: "Stafford",
    region: "VA",
    postalCode: "22554",
  },
  dropoffAddress: {
    line1: "9 Elm Ave",
    city: "Fredericksburg",
    region: "VA",
    postalCode: "22401",
  },
  loadedMiles: "4.2",
  weightLb: "12.5",
};

function codes(raw: unknown): string[] {
  const r = normalizeDeliveryRequestInput(raw);
  return isNormalizeFailure(r) ? r.errors.map((e) => e.code) : [];
}

describe("delivery-request input normalization", () => {
  it("accepts a minimal valid shipment and applies canonical defaults", () => {
    const r = normalizeDeliveryRequestInput(VALID);
    expect(isNormalizeFailure(r)).toBe(false);
    if (isNormalizeFailure(r)) return;
    expect(r.value.loadedMiles).toBe(4.2);
    expect(r.value.weightLb).toBe(12.5);
    expect(r.value.additionalStops).toBe(0);
    expect(r.value.serviceLevel).toBe("standard");
    expect(r.value.payerType).toBe("merchant");
    expect(r.value.readinessState).toBe("not_confirmed");
    expect(r.value.overnightRequested).toBe(false);
  });

  /**
   * The reason this module exists. `/api/create-checkout-session:10` trusts a
   * client-supplied amount and that is a live P0. A silently ignored amount is
   * indistinguishable from a respected one at the call site, so the payload is
   * REJECTED, not sanitised.
   */
  describe("refuses any client-supplied amount", () => {
    for (const key of [
      "totalCents",
      "total_cents",
      "TOTAL-CENTS",
      "amountCents",
      "price",
      "subtotal",
      "deliverySubtotalCents",
      "payment_due_cents",
      "quoteLineItems",
    ]) {
      it(`rejects a top-level "${key}"`, () => {
        expect(codes({ ...VALID, [key]: 1 })).toEqual(["client_supplied_amount"]);
      });
    }

    it("rejects an amount nested inside an address", () => {
      expect(
        codes({ ...VALID, pickupAddress: { ...VALID.pickupAddress, priceCents: 5 } })
      ).toEqual(["client_supplied_amount"]);
    });

    it("rejects an amount nested inside an array", () => {
      expect(codes({ ...VALID, extras: [{ label: "x", amount: 500 }] })).toEqual([
        "client_supplied_amount",
      ]);
    });

    it("names the offending key so the failure is diagnosable", () => {
      const r = normalizeDeliveryRequestInput({ ...VALID, total_cents: 999 });
      expect(isNormalizeFailure(r)).toBe(true);
      if (!isNormalizeFailure(r)) return;
      expect(r.errors[0].field).toBe("total_cents");
    });

    it("reports ONLY the amount error, so nothing is partially accepted", () => {
      // Every other field is also invalid here. The amount short-circuits.
      expect(codes({ totalCents: 1, loadedMiles: -1, weightLb: "x" })).toEqual([
        "client_supplied_amount",
      ]);
    });

    it("does not flag a legitimate shipment field", () => {
      expect(codes(VALID)).toEqual([]);
    });
  });

  describe("does not coerce unknown values into canonical vocabularies", () => {
    it("rejects an unknown service level rather than defaulting to standard", () => {
      expect(codes({ ...VALID, serviceLevel: "overnight" })).toContain("unknown_service_level");
    });
    it("rejects an unknown proof method", () => {
      expect(codes({ ...VALID, proofMethod: "handshake" })).toContain("unknown_proof_method");
    });
    it("rejects an unknown readiness state", () => {
      expect(codes({ ...VALID, readinessState: "submitted" })).toContain(
        "unknown_readiness_state"
      );
    });
    it("rejects an unknown payer type", () => {
      expect(codes({ ...VALID, payerType: "couranr" })).toContain("unknown_payer_type");
    });
    it("rejects an unknown source", () => {
      expect(codes({ ...VALID, source: "curl" })).toContain("unknown_source");
    });
  });

  describe("shipment validation", () => {
    it("requires both addresses", () => {
      expect(codes({ loadedMiles: 1, weightLb: 1 })).toEqual(
        expect.arrayContaining(["missing_pickup_address", "missing_dropoff_address"])
      );
    });
    it("requires a complete address", () => {
      expect(codes({ ...VALID, dropoffAddress: { line1: "9 Elm Ave" } })).toContain(
        "invalid_address"
      );
    });
    it("requires distance and weight", () => {
      expect(codes({ ...VALID, loadedMiles: "", weightLb: "" })).toEqual(
        expect.arrayContaining(["loaded_miles_required", "weight_required"])
      );
    });
    it("rejects negative distance and weight", () => {
      expect(codes({ ...VALID, loadedMiles: -1, weightLb: -2 })).toEqual(
        expect.arrayContaining(["loaded_miles_invalid", "weight_invalid"])
      );
    });
    it("rejects a fractional stop count", () => {
      expect(codes({ ...VALID, additionalStops: "1.5" })).toContain(
        "additional_stops_invalid"
      );
    });
    it("rejects a non-object payload", () => {
      expect(codes("nope")).toEqual(["not_an_object"]);
      expect(codes([VALID])).toEqual(["not_an_object"]);
      expect(codes(null)).toEqual(["not_an_object"]);
    });
    it("rejects a malformed recipient email but allows none at all", () => {
      expect(codes({ ...VALID, recipientEmail: "nope" })).toContain("recipient_email_invalid");
      expect(codes({ ...VALID, recipientEmail: "" })).toEqual([]);
    });
  });

  it("carries overnight through without inventing a service level for it", () => {
    const r = normalizeDeliveryRequestInput({ ...VALID, overnightRequested: true });
    expect(isNormalizeFailure(r)).toBe(false);
    if (isNormalizeFailure(r)) return;
    expect(r.value.overnightRequested).toBe(true);
    // Overnight is NOT a service level: the database CHECK allows only three.
    expect(r.value.serviceLevel).toBe("standard");
  });

  it("trims whitespace and treats a blank optional string as absent", () => {
    const r = normalizeDeliveryRequestInput({
      ...VALID,
      recipientName: "  Dana  ",
      recipientPhone: "   ",
    });
    expect(isNormalizeFailure(r)).toBe(false);
    if (isNormalizeFailure(r)) return;
    expect(r.value.recipientName).toBe("Dana");
    expect(r.value.recipientPhone).toBe(null);
  });
});

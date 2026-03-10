import { describe, expect, it } from "vitest";
import { computeDeliveryPrice } from "@/lib/delivery/pricing";
import {
  DELIVERY_BASE_FEE,
  DELIVERY_HEAVY_ITEM_SURCHARGE,
  DELIVERY_HEAVY_ITEM_THRESHOLD_LBS,
  DELIVERY_INCLUDED_MILES,
  DELIVERY_MAX_WEIGHT_LBS,
  DELIVERY_PER_MILE_RATE,
  DELIVERY_RUSH_FEE,
  DELIVERY_SIGNATURE_FEE,
  DELIVERY_STOP_FEE,
} from "@/lib/delivery/policy";

describe("computeDeliveryPrice", () => {
  it("calculates a normal local delivery correctly", () => {
    const result = computeDeliveryPrice({
      miles: 10,
      weightLbs: 10,
      stops: 1,
      rush: false,
      signature: false,
    });

    const extraMiles = 10 - DELIVERY_INCLUDED_MILES;
    const expectedTotal =
      DELIVERY_BASE_FEE +
      extraMiles * DELIVERY_PER_MILE_RATE +
      DELIVERY_STOP_FEE;

    expect(result.breakdown.base).toBe(DELIVERY_BASE_FEE);
    expect(result.breakdown.includedMiles).toBe(DELIVERY_INCLUDED_MILES);
    expect(result.breakdown.extraMiles).toBe(extraMiles);
    expect(result.breakdown.extraMilesFee).toBe(
      Math.round(extraMiles * DELIVERY_PER_MILE_RATE * 100) / 100
    );
    expect(result.breakdown.stopsFee).toBe(DELIVERY_STOP_FEE);
    expect(result.breakdown.weightSurcharge).toBe(0);
    expect(result.breakdown.rushFee).toBe(0);
    expect(result.breakdown.signatureFee).toBe(0);
    expect(result.breakdown.total).toBe(expectedTotal);
    expect(result.amountCents).toBe(Math.round(expectedTotal * 100));
  });

  it("applies heavy item, rush, and signature fees correctly", () => {
    const miles = 12;
    const weight = DELIVERY_HEAVY_ITEM_THRESHOLD_LBS + 10;
    const stops = 2;

    const result = computeDeliveryPrice({
      miles,
      weightLbs: weight,
      stops,
      rush: true,
      signature: true,
    });

    const extraMiles = miles - DELIVERY_INCLUDED_MILES;
    const expectedTotal =
      DELIVERY_BASE_FEE +
      extraMiles * DELIVERY_PER_MILE_RATE +
      DELIVERY_HEAVY_ITEM_SURCHARGE +
      stops * DELIVERY_STOP_FEE +
      DELIVERY_RUSH_FEE +
      DELIVERY_SIGNATURE_FEE;

    expect(result.flags.heavyItem).toBe(true);
    expect(result.breakdown.weightSurcharge).toBe(
      DELIVERY_HEAVY_ITEM_SURCHARGE
    );
    expect(result.breakdown.stopsFee).toBe(stops * DELIVERY_STOP_FEE);
    expect(result.breakdown.rushFee).toBe(DELIVERY_RUSH_FEE);
    expect(result.breakdown.signatureFee).toBe(DELIVERY_SIGNATURE_FEE);
    expect(result.breakdown.total).toBe(
      Math.round(expectedTotal * 100) / 100
    );
    expect(result.amountCents).toBe(
      Math.round((Math.round(expectedTotal * 100) / 100) * 100)
    );
  });

  it("throws when weight exceeds the max", () => {
    expect(() =>
      computeDeliveryPrice({
        miles: 5,
        weightLbs: DELIVERY_MAX_WEIGHT_LBS + 1,
        stops: 0,
        rush: false,
        signature: false,
      })
    ).toThrow(`Items over ${DELIVERY_MAX_WEIGHT_LBS} lbs require special handling.`);
  });

  it("throws when miles are invalid", () => {
    expect(() =>
      computeDeliveryPrice({
        miles: 0,
        weightLbs: 5,
        stops: 0,
        rush: false,
        signature: false,
      })
    ).toThrow("Miles must be greater than 0.");
  });
});
// lib/delivery/pricing.ts

export type PricingInput = {
  miles: number;
  weightLbs: number;
  stops: number;
  rush: boolean;
  signature: boolean;
};

export type PricingFlags = {
  longDistance: boolean;
  heavyItem: boolean;
};

export type PricingResult = {
  amountCents: number;
  flags: PricingFlags;
  breakdown: {
    base: number;
    includedMiles: number;
    extraMiles: number;
    extraMilesFee: number;
    weightSurcharge: number;
    stopsFee: number;
    rushFee: number;
    signatureFee: number;
    total: number;
  };
};

/**
 * Couranr Delivery — FINALIZED PRICING LOGIC
 *
 * Base fee: $15 (includes first 4 miles)
 * Extra miles: $1.75 / mile
 * Max weight: 100 lbs
 * Heavy item (51–100 lbs): +$15
 * Stops: $6 each
 * Rush: +$10
 * Signature: +$5
 *
 * Flags:
 * - longDistance: miles > 25
 * - heavyItem: weight > 50
 *
 * ⚠️ Server-side source of truth
 */
export function computeDeliveryPrice(input: PricingInput): PricingResult {
  const miles = toNumber(input.miles);
  const weight = toNumber(input.weightLbs);
  const stops = Math.max(0, Math.floor(toNumber(input.stops)));

  if (miles <= 0) {
    throw new Error("Miles must be greater than 0.");
  }

  if (weight <= 0) {
    throw new Error("Weight must be greater than 0.");
  }

  if (weight > 100) {
    throw new Error("Items over 100 lbs require special handling.");
  }

  // --- Constants
  const BASE_FEE = 15;
  const INCLUDED_MILES = 4;
  const PER_MILE = 1.75;

  const HEAVY_ITEM_SURCHARGE = 15;
  const STOP_FEE = 6;
  const RUSH_FEE = 10;
  const SIGNATURE_FEE = 5;

  // --- Flags
  const flags: PricingFlags = {
    longDistance: miles > 25,
    heavyItem: weight > 50,
  };

  // --- Calculations
  const extraMiles = Math.max(0, miles - INCLUDED_MILES);
  const extraMilesFee = round2(extraMiles * PER_MILE);

  const weightSurcharge = weight > 50 ? HEAVY_ITEM_SURCHARGE : 0;
  const stopsFee = stops * STOP_FEE;
  const rushFee = input.rush ? RUSH_FEE : 0;
  const signatureFee = input.signature ? SIGNATURE_FEE : 0;

  const total = round2(
    BASE_FEE +
      extraMilesFee +
      weightSurcharge +
      stopsFee +
      rushFee +
      signatureFee
  );

  const amountCents = Math.max(50, Math.round(total * 100));

  return {
    amountCents,
    flags,
    breakdown: {
      base: BASE_FEE,
      includedMiles: INCLUDED_MILES,
      extraMiles,
      extraMilesFee,
      weightSurcharge,
      stopsFee,
      rushFee,
      signatureFee,
      total,
    },
  };
}

/* ---------------- helpers ---------------- */

function toNumber(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
// lib/delivery/pricing.ts

export type PricingInput = {
  miles: number;
  weightLbs: number;
  stops: number;
  rush: boolean;
  signature: boolean;

  /**
   * Required ONLY if weight > 70 lbs
   * Customer must acknowledge heavy item handling
   */
  heavyItemAcknowledged?: boolean;
};

export type PricingResult = {
  amountCents: number;
  flags: {
    longDistance: boolean;
    heavyItem: boolean;
  };
  breakdown: {
    base: number;
    extraMiles: number;
    weightSurcharge: number;
    longDistance: number;
    stops: number;
    rush: number;
    signature: number;
    total: number;
  };
};

/**
 * Couranr Delivery — FINAL MVP PRICING ENGINE
 *
 * This is the SINGLE source of truth for delivery pricing.
 * Client UI must never compute totals.
 */
export function computeDeliveryPrice(input: PricingInput): PricingResult {
  const miles = finite(input.miles);
  const weight = finite(input.weightLbs);
  const stops = Math.max(0, Math.floor(finite(input.stops)));
  const rush = !!input.rush;
  const signature = !!input.signature;
  const heavyAck = !!input.heavyItemAcknowledged;

  /* ---------------- HARD VALIDATION ---------------- */

  if (miles <= 0) throw new Error("Miles must be greater than 0.");
  if (weight <= 0) throw new Error("Weight must be greater than 0.");

  // Distance rules
  if (miles > 60) {
    throw new Error("Deliveries over 60 miles require a Special Request.");
  }

  // Weight rules
  if (weight > 100) {
    throw new Error("Items over 100 lbs require a Special Request.");
  }

  if (weight > 70 && !heavyAck) {
    throw new Error(
      "Heavy item acknowledgment is required for items over 70 lbs."
    );
  }

  /* ---------------- PRICING CONSTANTS ---------------- */

  const BASE_FEE = 15;
  const INCLUDED_MILES = 4;
  const PER_MILE_AFTER = 1.75;

  const LONG_DISTANCE_FEE = 15; // 41–60 miles

  /* ---------------- DISTANCE ---------------- */

  const extraMiles = Math.max(0, miles - INCLUDED_MILES);
  const extraMilesFee = round2(extraMiles * PER_MILE_AFTER);

  const longDistance = miles > 40;

  /* ---------------- WEIGHT ---------------- */

  let weightSurcharge = 0;
  let heavyItem = false;

  if (weight > 70) {
    weightSurcharge = 20;
    heavyItem = true;
  } else if (weight > 40) {
    weightSurcharge = 10;
  }

  /* ---------------- OPTIONS ---------------- */

  const stopsFee = stops * 6;
  const rushFee = rush ? 10 : 0;
  const signatureFee = signature ? 5 : 0;
  const longDistanceFee = longDistance ? LONG_DISTANCE_FEE : 0;

  /* ---------------- TOTAL ---------------- */

  const total = round2(
    BASE_FEE +
      extraMilesFee +
      weightSurcharge +
      longDistanceFee +
      stopsFee +
      rushFee +
      signatureFee
  );

  // Stripe minimum safeguard
  const amountCents = Math.max(50, Math.round(total * 100));

  return {
    amountCents,
    flags: {
      longDistance,
      heavyItem,
    },
    breakdown: {
      base: BASE_FEE,
      extraMiles: extraMilesFee,
      weightSurcharge,
      longDistance: longDistanceFee,
      stops: stopsFee,
      rush: rushFee,
      signature: signatureFee,
      total,
    },
  };
}

/* ---------------- HELPERS ---------------- */

function finite(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
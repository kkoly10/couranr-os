// lib/delivery/pricing.ts

export type PricingInput = {
  miles: number;
  weightLbs: number;
  stops: number;
  rush: boolean;
  signature: boolean;
};

export type PricingResult = {
  amountCents: number;
  breakdown: {
    base: number;
    extraMiles: number;
    weightSurcharge: number;
    stops: number;
    rush: number;
    signature: number;
    total: number;
  };
};

/**
 * Couranr Delivery (MVP) Pricing Rules
 * - Base fee includes first 3 miles
 * - Max weight: 80 lbs
 * - Stops: $6 each
 * - Rush: optional fee
 * - Signature: optional fee
 *
 * IMPORTANT: This is the server source of truth for payment amount.
 */
export function computeDeliveryPrice(input: PricingInput): PricingResult {
  const miles = finiteNumber(input.miles);
  const weight = finiteNumber(input.weightLbs);
  const stops = Math.max(0, Math.floor(finiteNumber(input.stops)));
  const rush = !!input.rush;
  const signature = !!input.signature;

  // Hard rules
  if (miles <= 0) throw new Error("Miles must be greater than 0.");
  if (weight <= 0) throw new Error("Weight must be greater than 0.");
  if (weight > 80) throw new Error("Max weight is 80 lbs.");

  // ---- Pricing (safe startup pricing)
  const BASE_FEE = 15.0; // includes first 3 miles
  const INCLUDED_MILES = 3.0;
  const PER_MILE_AFTER = 1.75; // per mile after included miles

  // Weight surcharge
  // 0–40 lbs: $0
  // 40–80 lbs: $10
  const weightSurcharge =
    weight <= 40 ? 0 : 10;

  // Stops
  const stopsFee = stops * 6;

  // Rush + signature
  const rushFee = rush ? 10 : 0;
  const signatureFee = signature ? 5 : 0;

  // Miles portion
  const extraMiles = Math.max(0, miles - INCLUDED_MILES);
  const extraMilesFee = round2(extraMiles * PER_MILE_AFTER);

  const total =
    round2(BASE_FEE + extraMilesFee + weightSurcharge + stopsFee + rushFee + signatureFee);

  const amountCents = Math.max(50, Math.round(total * 100)); // Stripe minimum safety

  return {
    amountCents,
    breakdown: {
      base: BASE_FEE,
      extraMiles: extraMilesFee,
      weightSurcharge,
      stops: stopsFee,
      rush: rushFee,
      signature: signatureFee,
      total,
    },
  };
}

function finiteNumber(v: any): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return n;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

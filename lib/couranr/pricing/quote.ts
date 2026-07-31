import {
  ADDITIONAL_STOP_CENTS,
  BASE_PRICE_CENTS,
  COURANR_PRICING_POLICY_VERSION,
  INCLUDED_LOADED_MILES,
  MAX_AUTOMATIC_LOADED_MILES,
  MAX_AUTOMATIC_WEIGHT_LB,
  MILEAGE_TIERS,
  PROOF_CENTS,
  SERVICE_LEVEL_CENTS,
  SIGNATURE_CENTS,
  WEIGHT_BANDS,
  type ServiceLevel,
} from "./policy";
import type {
  LineItemCode,
  QuoteInput,
  QuoteLineItem,
  QuoteResult,
  ReviewReasonCode,
  ValidationErrorCode,
} from "./types";

/**
 * Canonical Couranr delivery quote engine.
 *
 * INTEGER CENTS ONLY. No money value is ever held in a floating-point
 * intermediate. Distance and weight arrive as decimals (a route is 4.2 miles,
 * a parcel is 12.5 lb), so distance is converted once to integer thousandths of
 * a mile and every subsequent operation is integer arithmetic.
 *
 * Dependency-free by design: no React, Next.js, Supabase or Stripe import.
 */

/** Thousandths of a mile. Lets tier maths stay in integers. */
const MILLI = 1000;

/** Half-up division of a non-negative integer by MILLI, without floats. */
function divideMilliToCents(numerator: number): number {
  return Math.floor((numerator + MILLI / 2) / MILLI);
}

function toMilliMiles(miles: number): number {
  // One rounding of a DISTANCE (not money) to the nearest thousandth of a mile.
  return Math.round(miles * MILLI);
}

const TIER_CODE: Record<number, LineItemCode> = {
  4: "mileage_tier_4_10",
  11: "mileage_tier_11_25",
  26: "mileage_tier_26_50",
  51: "mileage_tier_51_75",
  76: "mileage_tier_76_100",
};

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function validate(input: QuoteInput): ValidationErrorCode[] {
  const errors: ValidationErrorCode[] = [];

  if (!isFiniteNumber(input.loadedMiles)) errors.push("loaded_miles_not_finite");
  else if (input.loadedMiles < 0) errors.push("loaded_miles_negative");

  if (!isFiniteNumber(input.weightLb)) errors.push("weight_not_finite");
  else if (input.weightLb < 0) errors.push("weight_negative");

  const stops = input.additionalStops ?? 0;
  if (!isFiniteNumber(stops)) errors.push("additional_stops_not_finite");
  else if (stops < 0) errors.push("additional_stops_negative");
  else if (!Number.isInteger(stops)) errors.push("additional_stops_not_whole");

  const level = input.serviceLevel ?? "standard";
  if (!Object.prototype.hasOwnProperty.call(SERVICE_LEVEL_CENTS, level)) {
    errors.push("unknown_service_level");
  }

  // SUR-001: rush and overnight never stack.
  if (input.overnightRequested === true && level === "rush") {
    errors.push("rush_and_overnight_conflict");
  }

  return errors;
}

function emptyResult(
  quoteStatus: QuoteResult["quoteStatus"],
  reviewReasons: ReviewReasonCode[],
  validationErrors: ValidationErrorCode[],
  billableLoadedMiles = 0
): QuoteResult {
  return {
    policyVersion: COURANR_PRICING_POLICY_VERSION,
    quoteStatus,
    deliverySubtotalCents: 0,
    lineItems: [],
    includedLoadedMiles: INCLUDED_LOADED_MILES,
    billableLoadedMiles,
    reviewReasons,
    roundingApplied: false,
    taxIncluded: false,
    paymentDueCents: null,
    validationErrors,
  };
}

/**
 * Produces a delivery estimate.
 *
 * The result is a SUBTOTAL. It is not a final payable amount: PRC-004 (the
 * $0.25 rounding trigger) and TAX-001 (tax treatment) are both unresolved, so
 * `roundingApplied` and `taxIncluded` are false and `paymentDueCents` is null.
 */
export function quoteDelivery(input: QuoteInput): QuoteResult {
  const validationErrors = validate(input);
  if (validationErrors.length > 0) {
    return emptyResult("invalid", [], validationErrors);
  }

  const level: ServiceLevel = input.serviceLevel ?? "standard";
  const additionalStops = input.additionalStops ?? 0;

  /* ---------------------------------------------------- manual review ---- */

  const reviewReasons: ReviewReasonCode[] = [];

  if (input.loadedMiles > MAX_AUTOMATIC_LOADED_MILES) {
    reviewReasons.push("over_max_automatic_miles");
  }
  if (input.weightLb > MAX_AUTOMATIC_WEIGHT_LB) {
    reviewReasons.push("over_max_automatic_weight");
  }
  if (input.overnightRequested === true) {
    // Overnight is a decided product but is not offered by this release. The
    // request is preserved for review rather than rejected.
    reviewReasons.push("overnight_not_offered_in_this_release");
  }

  const totalMilli = toMilliMiles(input.loadedMiles);
  const includedMilli = INCLUDED_LOADED_MILES * MILLI;
  const billableMilli = Math.max(0, totalMilli - includedMilli);

  if (reviewReasons.length > 0) {
    // No automatic estimate. Report billable miles for context, but no money.
    return emptyResult(
      "manual_review_required",
      reviewReasons,
      [],
      billableMilli / MILLI
    );
  }

  /* ---------------------------------------------------------- line items - */

  const lineItems: QuoteLineItem[] = [];

  lineItems.push({
    code: "base_delivery",
    label: `Base delivery (first ${INCLUDED_LOADED_MILES} loaded miles)`,
    quantity: 1,
    unitAmountCents: BASE_PRICE_CENTS,
    amountCents: BASE_PRICE_CENTS,
  });

  // Mileage: one line per tier the route actually reaches.
  for (const tier of MILEAGE_TIERS) {
    // Tier `fromMile` = 4 means the interval (3, 10] for a 4-10 tier.
    const tierStartMilli = (tier.fromMile - 1) * MILLI;
    const tierEndMilli = tier.toMile * MILLI;

    const overlapStart = Math.max(tierStartMilli, includedMilli);
    const overlapEnd = Math.min(tierEndMilli, totalMilli);
    const overlapMilli = Math.max(0, overlapEnd - overlapStart);
    if (overlapMilli === 0) continue;

    const amountCents = divideMilliToCents(overlapMilli * tier.perMileCents);

    lineItems.push({
      code: TIER_CODE[tier.fromMile],
      label: `Loaded miles ${tier.fromMile}–${tier.toMile}`,
      quantity: overlapMilli / MILLI,
      unitAmountCents: tier.perMileCents,
      amountCents,
    });
  }

  if (level !== "standard") {
    lineItems.push({
      code: level === "rush" ? "service_level_rush" : "service_level_priority",
      label: level === "rush" ? "Rush" : "Priority",
      quantity: 1,
      unitAmountCents: SERVICE_LEVEL_CENTS[level],
      amountCents: SERVICE_LEVEL_CENTS[level],
    });
  }

  if (additionalStops > 0) {
    lineItems.push({
      code: "additional_stops",
      label: "Additional stops",
      quantity: additionalStops,
      unitAmountCents: ADDITIONAL_STOP_CENTS,
      amountCents: additionalStops * ADDITIONAL_STOP_CENTS,
    });
  }

  if (input.signatureRequired === true) {
    lineItems.push({
      code: "signature",
      label: "Signature required",
      quantity: 1,
      unitAmountCents: SIGNATURE_CENTS,
      amountCents: SIGNATURE_CENTS,
    });
  }

  const weightCents = weightBandCents(input.weightLb);
  if (weightCents > 0) {
    lineItems.push({
      code: "weight_band",
      label: "Weight handling",
      quantity: 1,
      unitAmountCents: weightCents,
      amountCents: weightCents,
    });
  }

  // Always present, always zero: proof is included, and showing it as a line
  // stops anyone assuming it is billable later.
  lineItems.push({
    code: "proof",
    label: "Photo and PIN proof (included)",
    quantity: 1,
    unitAmountCents: PROOF_CENTS,
    amountCents: PROOF_CENTS,
  });

  const deliverySubtotalCents = lineItems.reduce(
    (sum, li) => sum + li.amountCents,
    0
  );

  return {
    policyVersion: COURANR_PRICING_POLICY_VERSION,
    quoteStatus: "estimated",
    deliverySubtotalCents,
    lineItems,
    includedLoadedMiles: INCLUDED_LOADED_MILES,
    billableLoadedMiles: billableMilli / MILLI,
    reviewReasons: [],
    roundingApplied: false,
    taxIncluded: false,
    paymentDueCents: null,
    validationErrors: [],
  };
}

/** SUR-001 weight bands. Continuous: each band runs up to and including maxLb. */
export function weightBandCents(weightLb: number): number {
  for (const band of WEIGHT_BANDS) {
    if (weightLb <= band.maxLb) return band.cents;
  }
  // Above the last band the caller must already have flagged manual review.
  return 0;
}

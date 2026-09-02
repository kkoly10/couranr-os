import {
  BASE_PRICE_CENTS,
  COURANR_PRICING_POLICY_VERSION,
  INCLUDED_LOADED_MILES,
  MAX_AUTOMATIC_LOADED_MILES,
  MAX_AUTOMATIC_TRAFFIC_DELAY_SECONDS,
  MAX_AUTOMATIC_WEIGHT_LB,
  MILEAGE_TIERS,
  PROOF_CENTS,
  SERVICE_LEVEL_CENTS,
  SIGNATURE_CENTS,
  TRAFFIC_DELAY_CENTS_PER_MINUTE,
  TRAFFIC_DELAY_INCLUDED_SECONDS,
  WEIGHT_INCLUDED_THROUGH_LB,
  WEIGHT_SURCHARGE_CENTS,
  type MileageTier,
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
 * Canonical Couranr delivery quote engine — Pricing V2.
 *
 * INTEGER CENTS ONLY. No money value is ever held in a floating-point
 * intermediate. Distance arrives as a decimal (a route is 4.2 miles), so it is
 * converted ONCE to integer thousandths of a mile and every subsequent
 * operation is integer arithmetic. The only rounding applied to money is an
 * explicit deterministic half-up at the two places where a rate produces a
 * fractional cent: per-mile and per-minute.
 *
 * Dependency-free by design: no React, Next.js, Supabase or Stripe import.
 */

/** Thousandths of a mile. Lets tier maths stay in integers. */
const MILLI = 1000;
const SECONDS_PER_MINUTE = 60;

/**
 * Deterministic half-up division of a non-negative integer, without floats.
 *
 * Half-up rather than banker's rounding because the authority says half-up,
 * and because a quote must be reproducible from its inputs by anyone checking
 * it — including a merchant with a calculator.
 */
function divideHalfUp(numerator: number, denominator: number): number {
  return Math.floor((numerator + denominator / 2) / denominator);
}

function toMilliMiles(miles: number): number {
  // One rounding of a DISTANCE (not money) to the nearest thousandth of a
  // mile. Mileage is never rounded UP to a whole mile.
  return Math.round(miles * MILLI);
}

const TIER_CODE: Record<number, LineItemCode> = {
  2: "mileage_tier_2_10",
  10: "mileage_tier_10_25",
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
  else if (stops > 0) errors.push("additional_stops_unsupported");

  const level = input.serviceLevel ?? "standard";
  if (!Object.prototype.hasOwnProperty.call(SERVICE_LEVEL_CENTS, level)) {
    errors.push("unknown_service_level");
  }

  // SUR-001: rush and overnight never stack.
  if (input.overnightRequested === true && level === "rush") {
    errors.push("rush_and_overnight_conflict");
  }

  // `undefined`/`null` is "no evidence", handled as a review reason rather
  // than a validation error. A PRESENT delay must still be a sane number.
  const delay = input.trafficDelaySeconds;
  if (delay !== undefined && delay !== null) {
    if (!isFiniteNumber(delay)) errors.push("traffic_delay_not_finite");
    else if (delay < 0) errors.push("traffic_delay_negative");
  }

  return errors;
}

function emptyResult(
  quoteStatus: QuoteResult["quoteStatus"],
  reviewReasons: ReviewReasonCode[],
  validationErrors: ValidationErrorCode[],
  billableLoadedMiles = 0,
  trafficDelaySeconds: number | null = null
): QuoteResult {
  return {
    policyVersion: COURANR_PRICING_POLICY_VERSION,
    quoteStatus,
    deliverySubtotalCents: 0,
    lineItems: [],
    includedLoadedMiles: INCLUDED_LOADED_MILES,
    billableLoadedMiles,
    trafficDelaySeconds,
    reviewReasons,
    roundingApplied: false,
    taxIncluded: false,
    paymentDueCents: null,
    validationErrors,
  };
}

/** Cents for one mileage tier over the interval it actually covers. */
function tierAmountCents(
  tier: MileageTier,
  totalMilli: number,
  includedMilli: number
): { overlapMilli: number; amountCents: number } {
  const overlapStart = Math.max(tier.overMiles * MILLI, includedMilli);
  const overlapEnd = Math.min(tier.throughMiles * MILLI, totalMilli);
  const overlapMilli = Math.max(0, overlapEnd - overlapStart);
  return {
    overlapMilli,
    amountCents: divideHalfUp(overlapMilli * tier.perMileCents, MILLI),
  };
}

/**
 * Chargeable traffic cents for a predicted delay.
 *
 * The first `TRAFFIC_DELAY_INCLUDED_SECONDS` are free. Beyond that the rate is
 * per MINUTE but is applied to actual SECONDS, so a 6m30s delay costs 90s of
 * traffic rather than being rounded up to two minutes.
 */
export function trafficDelayCents(delaySeconds: number): number {
  const chargeable = Math.max(0, delaySeconds - TRAFFIC_DELAY_INCLUDED_SECONDS);
  if (chargeable === 0) return 0;
  return divideHalfUp(
    chargeable * TRAFFIC_DELAY_CENTS_PER_MINUTE,
    SECONDS_PER_MINUTE
  );
}

/** SUR-001 V2 weight handling. A band is a charge, never a claimed weight. */
export function weightBandCents(weightLb: number): number {
  if (weightLb <= WEIGHT_INCLUDED_THROUGH_LB) return 0;
  if (weightLb <= MAX_AUTOMATIC_WEIGHT_LB) return WEIGHT_SURCHARGE_CENTS;
  // Above the automatic ceiling the caller must already have flagged review.
  return 0;
}

/**
 * Produces a delivery estimate under Pricing V2.
 *
 * The result is a SUBTOTAL. Tax, tip, tolls, parking and promotional credit
 * are all separate concerns and are never folded into it, so `paymentDueCents`
 * stays null: this engine does not decide what is payable.
 */
export function quoteDelivery(input: QuoteInput): QuoteResult {
  const validationErrors = validate(input);
  if (validationErrors.length > 0) {
    return emptyResult("invalid", [], validationErrors);
  }

  const level: ServiceLevel = input.serviceLevel ?? "standard";
  const rawDelay = input.trafficDelaySeconds;
  const hasTrafficEvidence = rawDelay !== undefined && rawDelay !== null;
  const delaySeconds = hasTrafficEvidence ? rawDelay : null;

  /* ---------------------------------------------------- manual review ---- */

  const reviewReasons: ReviewReasonCode[] = [];

  if (input.loadedMiles > MAX_AUTOMATIC_LOADED_MILES) {
    reviewReasons.push("over_max_automatic_miles");
  }
  if (input.weightLb > MAX_AUTOMATIC_WEIGHT_LB) {
    reviewReasons.push("large_item_review");
  }
  if (input.overnightRequested === true) {
    // Overnight is decided and governed, but request-only: Couranr confirms it
    // rather than the engine charging it automatically.
    reviewReasons.push("overnight_requires_couranr_confirmation");
  }
  if (!hasTrafficEvidence) {
    // Fail safe. An automatic quote must be able to state its traffic fact;
    // absent evidence is review, never an assumed zero delay.
    reviewReasons.push("traffic_evidence_unavailable");
  } else if (delaySeconds! > MAX_AUTOMATIC_TRAFFIC_DELAY_SECONDS) {
    reviewReasons.push("over_max_automatic_traffic_delay");
  }

  const totalMilli = toMilliMiles(input.loadedMiles);
  const includedMilli = INCLUDED_LOADED_MILES * MILLI;
  const billableMilli = Math.max(0, totalMilli - includedMilli);

  if (reviewReasons.length > 0) {
    // No automatic price. Report billable miles and the delay for context, but
    // no money — a review must never carry a fabricated subtotal.
    return emptyResult(
      "manual_review_required",
      reviewReasons,
      [],
      billableMilli / MILLI,
      delaySeconds
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
    const { overlapMilli, amountCents } = tierAmountCents(
      tier,
      totalMilli,
      includedMilli
    );
    if (overlapMilli === 0) continue;

    lineItems.push({
      code: TIER_CODE[tier.overMiles],
      label: `Loaded miles over ${tier.overMiles} through ${tier.throughMiles}`,
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
      label: "Weight handling (over 25 lb through 50 lb)",
      quantity: 1,
      unitAmountCents: weightCents,
      amountCents: weightCents,
    });
  }

  // Priced from the quote's own traffic evidence, up front. An accepted quote
  // is never repriced by later real-world traffic.
  const trafficCents = trafficDelayCents(delaySeconds!);
  if (trafficCents > 0) {
    lineItems.push({
      code: "traffic_delay",
      label: "Predicted traffic delay",
      // Quantity is in MINUTES because the unit rate is per minute: a stored
      // line item has to be able to explain its own amount, and a seconds
      // quantity against a per-minute rate reads as 60x the charge. The
      // CHARGE is still computed from whole seconds by trafficDelayCents, so
      // a 6m30s delay costs 90s of traffic and is not rounded up to 2 minutes
      // - this quantity is the fractional minutes that produced it.
      quantity:
        (delaySeconds! - TRAFFIC_DELAY_INCLUDED_SECONDS) / SECONDS_PER_MINUTE,
      unitAmountCents: TRAFFIC_DELAY_CENTS_PER_MINUTE,
      amountCents: trafficCents,
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
    trafficDelaySeconds: delaySeconds,
    reviewReasons: [],
    roundingApplied: false,
    taxIncluded: false,
    paymentDueCents: null,
    validationErrors: [],
  };
}

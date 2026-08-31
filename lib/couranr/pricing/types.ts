import type { ServiceLevel } from "./policy";

/**
 * Quote input. Every field describes the SHIPMENT, never a price: there is no
 * `total`, `amount`, `subtotal` or `price` field anywhere in this type, so a
 * caller structurally cannot supply an amount for the server to trust.
 */
export type QuoteInput = {
  /** Loaded miles for the route. May be fractional. */
  loadedMiles: number;
  /** Package weight in pounds. May be fractional. */
  weightLb: number;
  /** Compatibility input. Gate A accepts only 0: one quote/delivery has one destination. */
  additionalStops?: number;
  serviceLevel?: ServiceLevel;
  signatureRequired?: boolean;
  /**
   * Overnight is a decided product (SUR-001) but is not offered by this
   * release. Requesting it yields `manual_review_required`, and requesting it
   * together with rush is invalid — the two never stack.
   */
  overnightRequested?: boolean;
};

export type QuoteStatus = "estimated" | "manual_review_required" | "invalid";

/** Stable machine codes. Safe to persist and to key UI copy from. */
export type LineItemCode =
  | "base_delivery"
  | "mileage_tier_4_10"
  | "mileage_tier_11_25"
  | "mileage_tier_26_50"
  | "mileage_tier_51_75"
  | "mileage_tier_76_100"
  | "service_level_priority"
  | "service_level_rush"
  | "additional_stops"
  | "signature"
  | "weight_band"
  | "proof";

export type QuoteLineItem = {
  code: LineItemCode;
  label: string;
  quantity: number;
  unitAmountCents: number;
  amountCents: number;
};

/** Stable machine codes for why a quote could not be produced automatically. */
export type ReviewReasonCode =
  | "over_max_automatic_miles"
  | "over_max_automatic_weight"
  | "overnight_not_offered_in_this_release";

/** Stable machine codes for a rejected input. */
export type ValidationErrorCode =
  | "loaded_miles_not_finite"
  | "loaded_miles_negative"
  | "weight_not_finite"
  | "weight_negative"
  | "additional_stops_not_finite"
  | "additional_stops_negative"
  | "additional_stops_not_whole"
  | "additional_stops_unsupported"
  | "unknown_service_level"
  | "rush_and_overnight_conflict";

export type QuoteResult = {
  policyVersion: string;
  quoteStatus: QuoteStatus;
  /**
   * Exact integer-cent sum of `lineItems`. Zero when the quote is not
   * `estimated`. This is a delivery SUBTOTAL, not a final payable total:
   * PRC-004 rounding is unresolved and TAX-001 tax is unresolved.
   */
  deliverySubtotalCents: number;
  lineItems: QuoteLineItem[];
  includedLoadedMiles: number;
  /** Loaded miles billed above the included allowance. May be fractional. */
  billableLoadedMiles: number;
  reviewReasons: ReviewReasonCode[];
  /** Always false — PRC-004 is unresolved. */
  roundingApplied: false;
  /** Always false — TAX-001 is unresolved. */
  taxIncluded: false;
  /** Always null — this engine never determines what is payable. */
  paymentDueCents: null;
  /** Present only when `quoteStatus` is `invalid`. */
  validationErrors: ValidationErrorCode[];
};

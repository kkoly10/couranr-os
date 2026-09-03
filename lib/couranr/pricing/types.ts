import type { WeightBand } from "@/lib/couranr/shipment/facts";

import type { ServiceLevel } from "./policy";

/**
 * Quote input. Every field describes the SHIPMENT or the server-established
 * ROUTE EVIDENCE, never a price: there is no `total`, `amount`, `subtotal` or
 * `price` field anywhere in this type, so a caller structurally cannot supply
 * an amount for the server to trust.
 *
 * There is also deliberately no merchant vertical/category field. The core
 * fare is identical across verticals by decision, and the absence of the input
 * is what makes that unfalsifiable rather than merely intended.
 */
export type QuoteInput = {
  /**
   * Loaded miles for the route, from server-side Google Routes evidence only.
   * May be fractional; canonical precision is thousandths of a mile. A
   * browser-supplied distance never reaches here — see
   * `lib/couranr/routing/googleRoutes.ts`.
   */
  loadedMiles: number;
  /**
   * EXACT package weight in pounds, when it is genuinely known. May be
   * fractional. `null` means the exact weight is NOT known — which is a
   * legitimate state, never to be papered over with a midpoint, a bound, a
   * zero or any other invented number. When null, `weightBand` is what the
   * engine prices from.
   */
  weightLb: number | null;
  /**
   * Governed weight band (SUR-001 V2), used ONLY when `weightLb` is null: a
   * confirmed band is enough to price without manufacturing pounds.
   * `over_50_lb` and `unknown` both leave the automatic lane — the former as
   * a Large Item, the latter as an unresolved weight. When BOTH weight inputs
   * are absent the quote goes to review as unresolved.
   */
  weightBand?: WeightBand | null;
  /** Compatibility input. Gate A accepts only 0: one quote/delivery has one destination. */
  additionalStops?: number;
  serviceLevel?: ServiceLevel;
  signatureRequired?: boolean;
  /**
   * Overnight is a decided, governed product (SUR-001) that is REQUEST-ONLY
   * and Couranr-confirmed. Requesting it yields `manual_review_required`, and
   * requesting it together with rush is invalid — the two never stack.
   */
  overnightRequested?: boolean;
  /**
   * Predicted traffic delay in seconds, derived server-side as
   * `max(traffic_aware_duration - static_duration, 0)` from ONE canonical
   * Google Routes response.
   *
   * `null`/absent means "no traffic evidence was established". The engine then
   * charges no traffic and says so, rather than inventing a delay of zero.
   */
  trafficDelaySeconds?: number | null;
};

export type QuoteStatus = "estimated" | "manual_review_required" | "invalid";

/** Stable machine codes minted by Pricing V2. Safe to persist and to key UI copy from. */
export type LineItemCode =
  | "base_delivery"
  | "mileage_tier_2_10"
  | "mileage_tier_10_25"
  | "service_level_priority"
  | "service_level_rush"
  | "signature"
  | "weight_band"
  | "traffic_delay"
  | "proof";

/**
 * Codes minted by the SUPERSEDED V1 engine. Retained for exactly one reason:
 * a historical quote row still carries them, and the product must be able to
 * read and display that row. Nothing mints these any more.
 */
export type HistoricalLineItemCode =
  | "mileage_tier_4_10"
  | "mileage_tier_11_25"
  | "mileage_tier_26_50"
  | "mileage_tier_51_75"
  | "mileage_tier_76_100"
  | "additional_stops";

/** What a stored line item's code may be, across every policy version. */
export type StoredLineItemCode = LineItemCode | HistoricalLineItemCode;

export type QuoteLineItem = {
  code: LineItemCode;
  label: string;
  quantity: number;
  unitAmountCents: number;
  amountCents: number;
};

/**
 * A line item as READ BACK from an immutable quote row, which may have been
 * minted by any policy version. Rendering uses the stored label and amount;
 * the engine is never re-run to reconstruct a historical price.
 */
export type StoredQuoteLineItem = Omit<QuoteLineItem, "code"> & {
  code: StoredLineItemCode;
};

/** Stable machine codes for why a quote could not be produced automatically. */
export type ReviewReasonCode =
  | "over_max_automatic_miles"
  /** Above 50 lb: Large Item, manual quote. */
  | "large_item_review"
  | "overnight_requires_couranr_confirmation"
  /** Predicted traffic delay above the automatic ceiling. */
  | "over_max_automatic_traffic_delay"
  /** Routing evidence could not be established; no distance or money is invented. */
  | "route_needs_review"
  /**
   * Neither an exact weight nor a usable governed band is known. Review — the
   * engine will not invent pounds to produce a number.
   */
  | "weight_unresolved"
  /** Requested timing needs Couranr review (past time, non-business day, …). */
  | "timing_needs_review"
  /** Deterministic shipment policy demanded review; see the policy reasons. */
  | "shipment_policy_review"
  /**
   * No trusted shipment-safety declaration (restricted_class = none) exists.
   * Without it there is no automatic `estimated` quote, AI or not.
   */
  | "safety_declaration_required"
  /** Confirmed prohibited shipment class — the quote is invalid, never priced. */
  | "shipment_prohibited"
  /**
   * Traffic evidence was required for an automatic quote and could not be
   * obtained or validated. Failing safe into review beats fabricating a
   * traffic fact.
   */
  | "traffic_evidence_unavailable";

/** Stable machine codes for a rejected input. */
export type ValidationErrorCode =
  | "loaded_miles_not_finite"
  | "loaded_miles_negative"
  | "weight_not_finite"
  | "weight_negative"
  /** 0 lb is refused: unknown weight is a band, never a zero. */
  | "weight_not_positive"
  /** A weightBand value outside the governed vocabulary. */
  | "weight_band_invalid"
  | "additional_stops_not_finite"
  | "additional_stops_negative"
  | "additional_stops_not_whole"
  | "additional_stops_unsupported"
  | "unknown_service_level"
  | "rush_and_overnight_conflict"
  | "traffic_delay_not_finite"
  | "traffic_delay_negative";

export type QuoteResult = {
  policyVersion: string;
  quoteStatus: QuoteStatus;
  /**
   * Exact integer-cent sum of `lineItems`. Zero when the quote is not
   * `estimated`. This is a delivery SUBTOTAL, not a final payable total: tax,
   * tip, tolls, parking and promotional credit are all separate and never
   * folded in here.
   */
  deliverySubtotalCents: number;
  lineItems: QuoteLineItem[];
  includedLoadedMiles: number;
  /** Loaded miles billed above the included allowance. May be fractional. */
  billableLoadedMiles: number;
  /** The delay this quote was priced on, echoed for evidence. */
  trafficDelaySeconds: number | null;
  reviewReasons: ReviewReasonCode[];
  /** Always false — the $0.25 rounding rule is retired. */
  roundingApplied: false;
  /** Always false — tax is separate from the delivery subtotal. */
  taxIncluded: false;
  /** Always null — this engine never determines what is payable. */
  paymentDueCents: null;
  /** Present only when `quoteStatus` is `invalid`. */
  validationErrors: ValidationErrorCode[];
};

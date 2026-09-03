/**
 * §14 — the CLOSED shipment-policy → quote-status mapping. Nothing else may
 * decide how a policy disposition lands on a Quote Version:
 *
 *   allowed     + sufficient everything → `estimated`
 *   needs_review                        → `manual_review_required`
 *   prohibited                          → `invalid`
 *
 * A `manual_review_required` or `invalid` quote NEVER carries an
 * automatically payable subtotal — Couranr does not display a final price for
 * a delivery it has not determined it can perform. Quote N is never mutated;
 * a later Operations resolution mints Quote N+1 through the existing
 * supersession path.
 */

import type { QuoteResult, ReviewReasonCode } from "@/lib/couranr/pricing/types";
import type { ShipmentPolicyResult } from "./policy";

export function applyShipmentPolicyToQuote(
  quote: QuoteResult,
  policy: ShipmentPolicyResult
): QuoteResult {
  if (policy.disposition === "allowed") return quote;

  const codes: ReviewReasonCode[] =
    policy.disposition === "prohibited"
      ? ["shipment_prohibited"]
      : policy.reasons.includes("safety_declaration_required")
        ? ["safety_declaration_required", "shipment_policy_review"]
        : ["shipment_policy_review"];
  const reviewReasons = [...quote.reviewReasons];
  for (const code of codes) if (!reviewReasons.includes(code)) reviewReasons.push(code);

  return {
    ...quote,
    quoteStatus: policy.disposition === "prohibited" ? "invalid" : "manual_review_required",
    // No payable price for a shipment Couranr cannot (yet) carry.
    deliverySubtotalCents: 0,
    lineItems: [],
    reviewReasons,
  };
}

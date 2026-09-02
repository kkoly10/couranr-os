import type { QuoteLineItem, ReviewReasonCode } from "@/lib/couranr/pricing";
import type {
  ReadinessState,
  RequestState,
  ReviewState,
  ServiceAreaReviewState,
} from "./states";
import { requesterIdentityFromRow } from "@/lib/couranr/foundation/requester";

/**
 * Database row → client view model.
 *
 * Pure, so it is unit-testable without a database.
 *
 * The point of this module is that it is an ALLOW-LIST. Anything not named here
 * never reaches a browser, so adding a column to the table cannot accidentally
 * publish it. `created_by`, `idempotency_key` and `normalized_request_payload`
 * are deliberately absent.
 */

export type DeliveryRequestView = {
  id: string;
  requesterKind: "business" | "consumer";
  businessAccountId: string | null;
  currentQuoteVersionId: string | null;
  singleDestinationContract: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;

  requestState: RequestState;
  readinessState: ReadinessState;
  reviewState: ReviewState;
  serviceAreaReviewState: ServiceAreaReviewState;
  payerType: string;
  source: string;

  recipientName: string | null;
  recipientPhone: string | null;
  recipientEmail: string | null;

  loadedMiles: number | null;
  weightLb: number | null;
  additionalStops: number;
  serviceLevel: string;
  signatureRequired: boolean;
  proofMethod: string;

  pickupAddress: unknown;
  dropoffAddress: unknown;

  quote: {
    status: string;
    policyVersion: string | null;
    /** Delivery subtotal in integer cents. Not a payable total. */
    deliverySubtotalCents: number | null;
    includedLoadedMiles: number | null;
    billableLoadedMiles: number | null;
    lineItems: QuoteLineItem[];
    reviewReasons: ReviewReasonCode[];
    roundingApplied: boolean;
    taxIncluded: boolean;
    /** Always null: this release makes no payment decision (PAY-001). */
    paymentDueCents: null;
  };
};

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function stringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

export function toDeliveryRequestView(row: Record<string, any>): DeliveryRequestView {
  const requester = requesterIdentityFromRow(row);
  return {
    id: String(row.id),
    requesterKind: requester.kind,
    businessAccountId: requester.businessAccountId,
    currentQuoteVersionId: stringOrNull(row.current_quote_version_id),
    singleDestinationContract: row.single_destination_contract === true,
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    submittedAt: row.submitted_at ? String(row.submitted_at) : null,

    requestState: row.request_state,
    readinessState: row.readiness_state,
    reviewState: row.review_state,
    serviceAreaReviewState: row.service_area_review_state,
    payerType: row.payer_type,
    source: row.source,

    recipientName: row.recipient_name ?? null,
    recipientPhone: row.recipient_phone ?? null,
    recipientEmail: row.recipient_email ?? null,

    loadedMiles: numOrNull(row.loaded_miles),
    weightLb: numOrNull(row.weight_lb),
    additionalStops: Number(row.additional_stops ?? 0),
    serviceLevel: row.service_level,
    signatureRequired: row.signature_required === true,
    proofMethod: row.proof_method,

    pickupAddress: row.pickup_address ?? null,
    dropoffAddress: row.dropoff_address ?? null,

    quote: {
      status: row.quote_status,
      policyVersion: row.pricing_policy_version ?? null,
      deliverySubtotalCents: numOrNull(row.delivery_subtotal_cents),
      includedLoadedMiles: numOrNull(row.included_loaded_miles),
      billableLoadedMiles: numOrNull(row.billable_loaded_miles),
      lineItems: Array.isArray(row.quote_line_items) ? row.quote_line_items : [],
      reviewReasons: Array.isArray(row.review_reasons) ? row.review_reasons : [],
      roundingApplied: row.rounding_applied === true,
      taxIncluded: row.tax_included === true,
      // Read from the row rather than hard-coded, so if a future migration ever
      // lets an amount through, this reports it instead of hiding it.
      paymentDueCents: (numOrNull(row.payment_due_cents) as null) ?? null,
    },
  };
}

/** Integer cents → display string. Never used to compute anything. */
export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export const REQUEST_STATE_LABELS: Record<string, string> = {
  draft: "Draft",
  awaiting_merchant_confirmation: "Awaiting your confirmation",
  awaiting_quote_acceptance: "Awaiting quote acceptance",
  pending_couranr_review: "Pending Couranr review",
  quote_revision_required: "Quote revision required",
  confirmed: "Confirmed",
  declined: "Declined",
  cancelled: "Cancelled",
  closed: "Closed",
};

/**
 * Merchant-facing text for every ReviewReasonCode the engine can emit.
 *
 * QuoteSummary and OperationsQueue both render `LABELS[code] ?? code`, so a
 * missing key does not fail loudly - it shows the raw snake_case machine code
 * to a merchant on the quote screen. `tests/couranr-pricing.test.ts` asserts
 * this map covers the union exhaustively for exactly that reason.
 *
 * The first two V1 codes are retained: a request that went to review under the
 * old vocabulary still stores them, and dropping the key would turn a historical
 * row into a raw code.
 */
export const REVIEW_REASON_LABELS: Record<string, string> = {
  over_max_automatic_miles: "Distance is beyond the automatic estimate range",
  large_item_review: "Large Item — Couranr will quote this by hand",
  overnight_requires_couranr_confirmation: "Overnight needs Couranr confirmation",
  over_max_automatic_traffic_delay: "Predicted traffic delay is beyond the automatic estimate range",
  route_needs_review: "Driving route needs Couranr review",
  traffic_evidence_unavailable: "Traffic conditions could not be confirmed for this route",
  /* Retired V1 vocabulary, kept so historical requests still read. */
  over_max_automatic_weight: "Weight is beyond the automatic estimate range",
  overnight_not_offered_in_this_release: "Overnight is not offered in this release",
};

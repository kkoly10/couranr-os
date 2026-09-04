"use client";

import { call, type ApiResult } from "@/components/couranr/requests/client";

/** The lifecycle view MER-007 and OPS-003 both render from. */
export type FulfillmentView = {
  readinessState: string;
  requestState: string;
  payment: {
    id: string;
    amountCents: number;
    currency: string;
    paymentState: string;
    payerType: string;
    /* Batch 3 §A/§B evidence (see the fulfillment route). */
    authorizedAt: string | null;
    authorizedAtSource: "provider_event" | "processing_fallback" | null;
    authorizationProcessedAt: string | null;
    capturedAmountCents: number | null;
    refundedAmountCents: number | null;
    refundedAt: string | null;
    staleProviderHold: boolean;
    /** Newest refund attempt, or null when none exists (review item 6).
        `settled_no_refund_due` (final closure §3) is a COMPLETED settlement:
        the governed retention consumed the capture, zero provider refunds. */
    refundAttempt: {
      state: "requested" | "pending_unknown" | "succeeded" | "failed" | "settled_no_refund_due";
      amountCents: number;
      retainedCents: number;
      reason: string;
    } | null;
  } | null;
  promotionalCredit: {
    id: string;
    quoteVersionId: string;
    standardQuoteCents: number;
    amountPaidCents: number;
    promotionalCreditCents: number;
    currency: string;
    reason: string;
    campaign: string;
    market: string;
    category: string;
    approvedAt: string;
    status: string;
  } | null;
  servicePlan: {
    id: string;
    planState: string;
    scheduledPickupStart: string;
    scheduledPickupEnd: string;
    timezone: string;
    vehicleRequirement: { vehicleClass?: string; maxPayloadLb?: number };
  } | null;
  delivery: {
    id: string;
    fulfillmentState: string;
    capturedAmountCents: number;
    standardQuoteCents: number | null;
    amountPaidCents: number | null;
    promotionalCreditCents: number | null;
    promotionalCreditId: string | null;
    scheduledPickupStart: string;
    scheduledPickupEnd: string;
    timezone: string;
    driverAssigned: boolean;
  } | null;
};

export function fetchFulfillment(input: {
  id: string;
  businessAccountId?: string | null;
}): Promise<ApiResult<FulfillmentView>> {
  const qs = input.businessAccountId
    ? `?businessAccountId=${encodeURIComponent(input.businessAccountId)}`
    : "";
  return call<FulfillmentView>(`/api/couranr/delivery-requests/${input.id}/fulfillment${qs}`);
}

/** Readiness names a destination; the server maps it to a named command. */
export function setReadinessFromBrowser(input: {
  id: string;
  businessAccountId: string;
  expectedVersion: number;
  readiness: string;
}) {
  return call<{ request: any }>(`/api/couranr/delivery-requests/${input.id}/readiness`, {
    method: "POST",
    body: {
      businessAccountId: input.businessAccountId,
      expectedVersion: input.expectedVersion,
      readiness: input.readiness,
    },
  });
}

export function confirmServicePlanFromBrowser(input: {
  id: string;
  expectedVersion: number;
  pickupStart: string;
  pickupEnd: string;
  timezone: string;
  vehicleClass: string;
  maxPayloadLb: number;
}) {
  return call<{ plan: any }>(
    `/api/couranr/operations/delivery-requests/${input.id}/service-plan`,
    { method: "POST", body: { ...input, id: undefined } }
  );
}

/** Carries no amount: the server captures the authorized hold. */
export function captureFromBrowser(input: { id: string }) {
  return call<{ paymentState: string; deliveryId: string; fulfillmentState: string }>(
    `/api/couranr/operations/delivery-requests/${input.id}/capture`,
    { method: "POST", body: {} }
  );
}


/** Finalize a delivery whose exact quote is fully covered by a Couranr credit. */
export function finalizePromotionalCreditDeliveryFromBrowser(input: { id: string }) {
  return call<{ deliveryId: string; fulfillmentState: string; settlement: string }>(
    `/api/couranr/operations/delivery-requests/${input.id}/promotional-credit-delivery`,
    { method: "POST", body: {} }
  );
}

/**
 * Asks the provider what happened to a capture whose outcome is unknown.
 *
 * NOT a second capture. The server reads the PaymentIntent and either finishes
 * the capture or releases the hold; this call cannot move money on its own.
 */
export function reconcileCaptureFromBrowser(input: { id: string }) {
  return call<{ outcome: string; paymentState: string | null; deliveryId: string | null }>(
    `/api/couranr/operations/delivery-requests/${input.id}/reconcile-capture`,
    { method: "POST", body: {} }
  );
}

/**
 * Issue a customer payment link for the current obligation.
 *
 * The raw token comes back EXACTLY ONCE and is never stored — the caller shows
 * it to the merchant, who sends it. Issuing revokes every older live link for
 * the request, so the previous one stops working immediately.
 */
export function issuePaymentLinkFromBrowser(input: {
  id: string;
  businessAccountId: string;
}) {
  return call<{ token: string; expiresAt: string; amountCents: number; paymentState: string }>(
    `/api/couranr/delivery-requests/${input.id}/payment-link`,
    { method: "POST", body: { businessAccountId: input.businessAccountId } }
  );
}

/**
 * Batch 3 §E — the recovery actions. Reasons are CLOSED vocabularies; there
 * is no amount anywhere on any of these calls.
 *
 * `call()` JSON-encodes `init.body` itself, so every body here is a PLAIN
 * OBJECT. Passing a pre-stringified body double-encodes it — the server then
 * reads a string, every field is undefined, and the button can never work.
 * That exact defect shipped once; do not reintroduce it.
 */
export async function releaseHoldFromBrowser(input: { id: string; reason: string }) {
  return call<{ release: { obligationId: string; paymentState: string } }>(
    `/api/couranr/operations/delivery-requests/${input.id}/release`,
    { method: "POST", body: { reason: input.reason } }
  );
}

/**
 * The STANDALONE refund is FULL REFUND only (review item 6). Cancellation
 * retentions are derived server-side from the delivery's stored stage on the
 * cancel-delivery path — the browser cannot pick a retention reason here.
 */
export async function refundFromBrowser(input: { id: string }) {
  return call<{ refund: { refundId: string; attemptState: string; amountCents: number; retainedCents: number; reason: string } }>(
    `/api/couranr/operations/delivery-requests/${input.id}/refund`,
    { method: "POST", body: { reason: "full_refund" } }
  );
}

export async function reconcileRefundFromBrowser(input: { id: string }) {
  return call<{ refund: { refundId: string; attemptState: string; amountCents: number; retainedCents: number; reason: string } }>(
    `/api/couranr/operations/delivery-requests/${input.id}/reconcile-refund`,
    { method: "POST", body: {} }
  );
}

export async function cancelDeliveryFromBrowser(input: {
  id: string;
  reason: string;
  note: string;
}) {
  return call<{ cancellation: Record<string, unknown> }>(
    `/api/couranr/operations/delivery-requests/${input.id}/cancel-delivery`,
    { method: "POST", body: { reason: input.reason, note: input.note } }
  );
}

/**
 * Resume a terminal delivery's cancellation settlement (final closure §2).
 * No reason travels: the governed reason lives in the immutable closure
 * evidence, and nothing posted after closure can change the fee.
 */
export async function resumeCancellationSettlementFromBrowser(input: {
  id: string;
  note: string;
}) {
  return call<{ cancellation: Record<string, unknown> }>(
    `/api/couranr/operations/delivery-requests/${input.id}/cancel-delivery`,
    { method: "POST", body: { resume: true, note: input.note } }
  );
}

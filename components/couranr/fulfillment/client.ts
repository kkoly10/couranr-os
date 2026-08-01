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

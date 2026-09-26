"use client";

import { call, type ApiResult } from "@/components/couranr/requests/client";

/**
 * The OPS-011 browser surface. Every response is read under its NAMED KEY —
 * typing one flat is invisible to `tsc`, because the routes return untyped
 * JSON, and the failure is silent rather than loud.
 *
 * Bodies here are PLAIN OBJECTS. `call()` JSON-encodes them exactly once; a
 * pre-stringified body reaches the server as a quoted string and every field
 * reads undefined, which is how the Refund, Release and Cancel buttons were
 * once all dead at the same time.
 */

export type RefundRequestRow = {
  id: string;
  requestId: string;
  reference: string | null;
  obligationId: string;
  incidentId: string | null;
  problemReportId: string | null;
  requestedBy: "merchant" | "customer" | "operations";
  reasonCode: string;
  detail: string;
  state:
    | "pending"
    | "approved"
    | "processing"
    | "partially_refunded"
    | "refunded"
    | "denied"
    | "failed";
  refundableBaseCents: number | null;
  approvedAmountCents: number | null;
  denialReason: string | null;
  decidedAt: string | null;
  version: number;
  createdAt: string;
  capturedAmountCents: number | null;
  refundedAmountCents: number;
  remainingRefundableCents: number;
  attempt: {
    state: string;
    amountCents: number;
    retainedCents: number;
    providerSettled: boolean;
  } | null;
};

export function loadRefundRequests(): Promise<ApiResult<{ refundRequests: RefundRequestRow[] }>> {
  return call<{ refundRequests: RefundRequestRow[] }>("/api/couranr/operations/refunds");
}

/**
 * Opens an Operations review only. No amount travels on this request and no
 * refund is issued by this action; OPS-011 still owns the later decision.
 */
export function openRefundReview(input: {
  deliveryRequestId: string;
  detail: string;
  incidentId?: string | null;
  problemReportId?: string | null;
}): Promise<ApiResult<{ refundRequest: RefundRequestRow }>> {
  return call<{ refundRequest: RefundRequestRow }>("/api/couranr/operations/refunds", {
    method: "POST",
    body: {
      deliveryRequestId: input.deliveryRequestId,
      requestedBy: "operations",
      reasonCode: "operations_adjustment",
      detail: input.detail,
      incidentId: input.incidentId ?? null,
      problemReportId: input.problemReportId ?? null,
    },
  });
}

/**
 * Approve, in full or in part.
 *
 * `approvedCents` is a REQUEST. The server recomputes the refundable ceiling
 * from the captured delivery charge under a row lock and refuses anything
 * above it — it never quietly reduces the figure — so nothing this file sends
 * can decide what leaves the account.
 */
export function approveRefundRequest(input: {
  id: string;
  expectedVersion: number;
  approvedCents: number;
}): Promise<ApiResult<{ refundRequest: RefundRequestRow }>> {
  return call<{ refundRequest: RefundRequestRow }>(
    `/api/couranr/operations/refunds/${input.id}/approve`,
    {
      method: "POST",
      body: { expectedVersion: input.expectedVersion, approvedCents: input.approvedCents },
    }
  );
}

export function denyRefundRequest(input: {
  id: string;
  expectedVersion: number;
  denialReason: string;
}): Promise<ApiResult<{ refundRequest: RefundRequestRow }>> {
  return call<{ refundRequest: RefundRequestRow }>(
    `/api/couranr/operations/refunds/${input.id}/deny`,
    {
      method: "POST",
      body: { expectedVersion: input.expectedVersion, denialReason: input.denialReason },
    }
  );
}

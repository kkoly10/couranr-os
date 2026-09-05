"use client";

import { supabase } from "@/lib/supabaseClient";
import type { DeliveryRequestView } from "@/lib/couranr/requests/view";

/**
 * Browser data access for the delivery-request screens.
 *
 * Every screen goes through an authenticated API route rather than querying
 * Supabase directly: the canonical tables are deny-all for `anon` and
 * `authenticated` (zero policies, zero grants), so a direct browser query
 * returns nothing by design. The route re-scopes each query server-side.
 *
 * The token comes from `getSession()` only because that is where the browser
 * keeps it. The SERVER revalidates it with `auth.getUser(token)` — no
 * authorization decision is made from this value on the client.
 */

export type ApiFailure = {
  ok: false;
  status: number;
  error: string;
  code?: string;
  /** Server-generated. Shown to the merchant so support can find the log line. */
  correlationId?: string;
  details?: unknown;
};
export type ApiSuccess<T> = { ok: true; value: T };
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

/**
 * `tsconfig` sets `"strict": false`; without `strictNullChecks` a bare
 * `if (!r.ok)` does not narrow this union. An explicit predicate does.
 */
export function isApiFailure<T>(r: ApiResult<T>): r is ApiFailure {
  return r.ok === false;
}

async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * Exported so the payment components use this exact path rather than a raw
 * `fetch`. A hand-rolled fetch carries no Bearer token, and every canonical
 * route resolves its actor from one — which is precisely how the merchant
 * authorize call came back 401 the first time it was driven in a browser.
 */
export async function call<T>(
  path: string,
  init: { method?: string; body?: unknown; idempotencyKey?: string } = {}
): Promise<ApiResult<T>> {
  const token = await accessToken();
  if (!token) {
    return { ok: false, status: 401, error: "Sign in to continue." };
  }

  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.idempotencyKey) headers["idempotency-key"] = init.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    return { ok: false, status: 0, error: "You appear to be offline." };
  }

  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: payload?.error || "Something went wrong.",
      code: payload?.code,
      correlationId: payload?.correlationId,
      details: payload?.details,
    };
  }
  return { ok: true, value: payload as T };
}

/**
 * A stable key for one submission attempt, so a double-click or a retry after a
 * dropped response cannot create two requests. Generated once per form, not per
 * click.
 */
export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function createDeliveryRequest(input: {
  businessAccountId: string;
  request: unknown;
  idempotencyKey: string;
  /** Smart Intake session backing this shipment, when there is one. */
  intakeSessionId?: string | null;
}) {
  return call<{ request: DeliveryRequestView }>("/api/couranr/delivery-requests", {
    method: "POST",
    idempotencyKey: input.idempotencyKey,
    body: {
      businessAccountId: input.businessAccountId,
      request: input.request,
      intakeSessionId: input.intakeSessionId ?? null,
    },
  });
}

export function estimateDeliveryRequest(input: {
  id: string;
  businessAccountId: string;
  expectedVersion: number;
  /** The edited shipment. Omit to re-price what the server already holds. */
  request?: unknown;
  intakeSessionId?: string | null;
}) {
  return call<{ request: DeliveryRequestView }>(
    `/api/couranr/delivery-requests/${input.id}/estimate`,
    {
      method: "POST",
      body: {
        businessAccountId: input.businessAccountId,
        expectedVersion: input.expectedVersion,
        request: input.request,
        intakeSessionId: input.intakeSessionId ?? null,
      },
    }
  );
}

export function submitDeliveryRequestFromBrowser(input: {
  id: string;
  businessAccountId: string;
  expectedVersion: number;
  /**
   * MER-006's approval. Sent as a plain flag, never with an amount — the
   * server records the acknowledgment against the quote IT holds, so what the
   * browser thinks the price is cannot enter the record.
   */
  merchantAcknowledged?: boolean;
}) {
  return call<{ request: DeliveryRequestView }>(
    `/api/couranr/delivery-requests/${input.id}/submit`,
    {
      method: "POST",
      body: {
        businessAccountId: input.businessAccountId,
        expectedVersion: input.expectedVersion,
        merchantAcknowledged: input.merchantAcknowledged === true,
      },
    }
  );
}

/* ------------------------------------------------ Smart Intake (P5-001) -- */

export type IntakeSessionView = {
  session: Record<string, any>;
  facts: Array<Record<string, any>>;
  revisions: Array<Record<string, any>>;
};

export type HostedIntakeView = {
  requestId: string;
  hostBusinessAccountId: string;
  orderReference: string;
  dropoffPlaceId: string;
  dropoffDisplayText: string;
  shipmentDescription: string;
  requestedPayerType: "merchant" | "customer";
  intakeState: "awaiting_merchant_confirmation" | "validated" | "declined";
  declineReason: string | null;
  createdAt: string;
  validatedAt: string | null;
  declinedAt: string | null;
};

export function startIntake(input: {
  businessAccountId: string;
  description: string;
  requestId?: string | null;
}) {
  return call<{ session: Record<string, any>; run: Record<string, any> | null }>(
    "/api/couranr/intake",
    {
      method: "POST",
      body: {
        businessAccountId: input.businessAccountId,
        description: input.description,
        requestId: input.requestId ?? null,
      },
    }
  );
}

export function fetchIntake(input: { sessionId: string; businessAccountId: string }) {
  return call<{ intake: IntakeSessionView }>(
    `/api/couranr/intake/${input.sessionId}?businessAccountId=${encodeURIComponent(input.businessAccountId)}`
  );
}

export function describeIntake(input: {
  sessionId: string;
  businessAccountId: string;
  description: string;
  expectedRevision: number;
  isClarificationResponse?: boolean;
}) {
  return call<{ session: Record<string, any>; run: Record<string, any> | null }>(
    `/api/couranr/intake/${input.sessionId}`,
    {
      method: "POST",
      body: {
        action: "describe",
        businessAccountId: input.businessAccountId,
        description: input.description,
        expectedRevision: input.expectedRevision,
        isClarificationResponse: input.isClarificationResponse === true,
      },
    }
  );
}

export function confirmIntakeFactFromBrowser(input: {
  sessionId: string;
  businessAccountId: string;
  factKey: string;
  value: unknown;
  authority?: "confirmed" | "overridden";
}) {
  return call<{ fact: Record<string, any>; session: Record<string, any> | null }>(
    `/api/couranr/intake/${input.sessionId}`,
    {
      method: "POST",
      body: {
        action: "confirm",
        businessAccountId: input.businessAccountId,
        factKey: input.factKey,
        value: input.value,
        authority: input.authority ?? "confirmed",
      },
    }
  );
}

export function fetchDeliveryRequest(input: { id: string; businessAccountId?: string }) {
  const qs = input.businessAccountId
    ? `?businessAccountId=${encodeURIComponent(input.businessAccountId)}`
    : "";
  return call<{
    request: DeliveryRequestView;
    events: any[];
    intake?: IntakeSessionView | null;
    hosted?: HostedIntakeView | null;
  }>(`/api/couranr/delivery-requests/${input.id}${qs}`);
}

export function validateHostedRequestFromBrowser(input: {
  id: string;
  businessAccountId: string;
  expectedVersion: number;
  validation: {
    pickupPlaceId: string;
    dropoffPlaceId: string;
    payerType: "merchant" | "customer";
    weightLb: number | null;
    weightBand: string | null;
    restrictedClass: string;
    signatureRequired: boolean;
  };
}) {
  return call<{ request: DeliveryRequestView }>(
    `/api/couranr/delivery-requests/${input.id}/hosted-validation`,
    {
      method: "POST",
      body: {
        action: "validate",
        businessAccountId: input.businessAccountId,
        expectedVersion: input.expectedVersion,
        validation: input.validation,
      },
    }
  );
}

export function declineHostedRequestFromBrowser(input: {
  id: string;
  businessAccountId: string;
  expectedVersion: number;
  reason: "order_not_found" | "details_do_not_match" | "merchant_cannot_fulfill";
}) {
  return call<{ request: DeliveryRequestView }>(
    `/api/couranr/delivery-requests/${input.id}/hosted-validation`,
    {
      method: "POST",
      body: {
        action: "decline",
        businessAccountId: input.businessAccountId,
        expectedVersion: input.expectedVersion,
        reason: input.reason,
      },
    }
  );
}


export type BusinessAccountOption = {
  businessAccountId: string;
  name: string;
  role: string;
  /** MER-013's hosted-request link name. Null until a business has one. */
  slug: string | null;
};

export function fetchMyBusinessAccounts() {
  return call<{ businessAccounts: BusinessAccountOption[] }>(
    "/api/couranr/me/business-accounts"
  );
}

/** MER-004's list read. Newest first; the route's command caps the page. */
export function fetchDeliveryRequests(input: { businessAccountId: string }) {
  return call<{ requests: DeliveryRequestView[] }>(
    `/api/couranr/delivery-requests?businessAccountId=${encodeURIComponent(input.businessAccountId)}`
  );
}

/** One row of OPS-002, with the stage the server derived for it. */
export type QueueEntry = {
  stage: string;
  request: DeliveryRequestView;
  payment: {
    paymentState: string;
    payerType: string;
    amountCents: number;
    currency: string;
  } | null;
  promotionalCredit: {
    standardQuoteCents: number;
    amountPaidCents: number;
    promotionalCreditCents: number;
    currency: string;
  } | null;
  servicePlan: {
    scheduledPickupStart: string;
    scheduledPickupEnd: string;
    timezone: string;
    planSource: "operations" | "automatic";
    plannerVersion: string | null;
    dispatchNotBefore: string | null;
    dispatchDeadline: string | null;
    expectedServiceEnd: string | null;
  } | null;
  automationException: {
    stage: "review" | "planning" | "dispatch" | "commercial";
    reason: string;
    attempts: number;
    lastSeenAt: string;
  } | null;
  delivery: {
    id: string;
    fulfillmentState: string;
    capturedAmountCents: number;
    scheduledPickupStart: string;
    scheduledPickupEnd: string;
    timezone: string;
    planSource: "operations" | "automatic";
    plannerVersion: string | null;
    dispatchNotBefore: string | null;
    dispatchDeadline: string | null;
    expectedServiceEnd: string | null;
    driverAssigned: boolean;
  } | null;
};

export function fetchReviewQueue() {
  return call<{ entries: QueueEntry[]; total: number; truncated: boolean }>(
    "/api/couranr/operations/queue"
  );
}

export function beginReview(input: { id: string; expectedVersion: number }) {
  return call<{ request: DeliveryRequestView }>(
    `/api/couranr/operations/delivery-requests/${input.id}/begin-review`,
    { method: "POST", body: { expectedVersion: input.expectedVersion } }
  );
}

/* ------------------------------------------------- review outcomes (REV-001)
 *
 * None of these sends an amount or a target state. The command name is the
 * decision; the server owns both the price and where the request lands.
 */

export function acceptAsQuoted(input: { id: string; expectedVersion: number }) {
  return call<{ request: DeliveryRequestView }>(
    `/api/couranr/operations/delivery-requests/${input.id}/accept-as-quoted`,
    { method: "POST", body: { expectedVersion: input.expectedVersion } }
  );
}

export function requoteRequest(input: { id: string; expectedVersion: number; reason: string }) {
  return call<{ request: DeliveryRequestView }>(
    `/api/couranr/operations/delivery-requests/${input.id}/requote`,
    { method: "POST", body: { expectedVersion: input.expectedVersion, reason: input.reason } }
  );
}

export function declineRequest(input: {
  id: string;
  expectedVersion: number;
  reason: string;
  internalNote?: string;
}) {
  return call<{ request: DeliveryRequestView }>(
    `/api/couranr/operations/delivery-requests/${input.id}/decline`,
    {
      method: "POST",
      body: {
        expectedVersion: input.expectedVersion,
        reason: input.reason,
        internalNote: input.internalNote ?? "",
      },
    }
  );
}

/** Appends the correlation id so a merchant can quote it to Couranr Support. */
export function withReference(failure: { error: string; correlationId?: string }) {
  return failure.correlationId
    ? `${failure.error} Reference ${failure.correlationId}.`
    : failure.error;
}


export type BusinessPlaceSuggestion = {
  placeId: string;
  text: string;
};

export function searchBusinessPlaces(input: {
  businessAccountId: string;
  query: string;
}) {
  const qs = new URLSearchParams({
    businessAccountId: input.businessAccountId,
    query: input.query,
  });
  return call<{ suggestions: BusinessPlaceSuggestion[] }>(
    `/api/couranr/merchant/places?${qs.toString()}`
  );
}

export function resolveBusinessPlace(input: {
  businessAccountId: string;
  placeId: string;
  line2?: string | null;
  instructions?: string | null;
}) {
  return call<{ address: import("@/lib/couranr/routing/address").GoogleAddressSnapshot }>(
    "/api/couranr/merchant/places",
    {
      method: "POST",
      body: {
        businessAccountId: input.businessAccountId,
        placeId: input.placeId,
        line2: input.line2 ?? null,
        instructions: input.instructions ?? null,
      },
    }
  );
}


export function fetchOperationsBusinesses() {
  return call<{ businessAccounts: BusinessAccountOption[] }>(
    "/api/couranr/operations/businesses"
  );
}

export function createOperationsDeliveryRequest(input: {
  businessAccountId: string;
  request: unknown;
  idempotencyKey: string;
}) {
  return call<{ request: DeliveryRequestView }>(
    "/api/couranr/operations/delivery-requests",
    {
      method: "POST",
      idempotencyKey: input.idempotencyKey,
      body: {
        businessAccountId: input.businessAccountId,
        request: input.request,
      },
    }
  );
}

export function estimateOperationsDeliveryRequest(input: {
  id: string;
  businessAccountId: string;
  expectedVersion: number;
  request?: unknown;
}) {
  return call<{ request: DeliveryRequestView }>(
    `/api/couranr/operations/delivery-requests/${input.id}/estimate`,
    {
      method: "POST",
      body: {
        businessAccountId: input.businessAccountId,
        expectedVersion: input.expectedVersion,
        request: input.request,
      },
    }
  );
}

export function submitOperationsDeliveryRequest(input: {
  id: string;
  businessAccountId: string;
  expectedVersion: number;
}) {
  return call<{ request: DeliveryRequestView }>(
    `/api/couranr/operations/delivery-requests/${input.id}/submit`,
    {
      method: "POST",
      body: {
        businessAccountId: input.businessAccountId,
        expectedVersion: input.expectedVersion,
      },
    }
  );
}

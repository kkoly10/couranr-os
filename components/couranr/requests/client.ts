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

async function call<T>(
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
}) {
  return call<{ request: DeliveryRequestView }>("/api/couranr/delivery-requests", {
    method: "POST",
    idempotencyKey: input.idempotencyKey,
    body: { businessAccountId: input.businessAccountId, request: input.request },
  });
}

export function estimateDeliveryRequest(input: {
  id: string;
  businessAccountId: string;
  expectedVersion: number;
  /** The edited shipment. Omit to re-price what the server already holds. */
  request?: unknown;
}) {
  return call<{ request: DeliveryRequestView }>(
    `/api/couranr/delivery-requests/${input.id}/estimate`,
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

export function submitDeliveryRequestFromBrowser(input: {
  id: string;
  businessAccountId: string;
  expectedVersion: number;
}) {
  return call<{ request: DeliveryRequestView }>(
    `/api/couranr/delivery-requests/${input.id}/submit`,
    {
      method: "POST",
      body: {
        businessAccountId: input.businessAccountId,
        expectedVersion: input.expectedVersion,
      },
    }
  );
}

export function fetchDeliveryRequest(input: { id: string; businessAccountId?: string }) {
  const qs = input.businessAccountId
    ? `?businessAccountId=${encodeURIComponent(input.businessAccountId)}`
    : "";
  return call<{ request: DeliveryRequestView; events: any[] }>(
    `/api/couranr/delivery-requests/${input.id}${qs}`
  );
}

export type BusinessAccountOption = {
  businessAccountId: string;
  name: string;
  role: string;
};

export function fetchMyBusinessAccounts() {
  return call<{ businessAccounts: BusinessAccountOption[] }>(
    "/api/couranr/me/business-accounts"
  );
}

export function fetchReviewQueue() {
  return call<{ requests: DeliveryRequestView[] }>("/api/couranr/operations/queue");
}

export function beginReview(input: { id: string; expectedVersion: number }) {
  return call<{ request: DeliveryRequestView }>(
    `/api/couranr/operations/delivery-requests/${input.id}/begin-review`,
    { method: "POST", body: { expectedVersion: input.expectedVersion } }
  );
}

import { call, type ApiResult } from "@/components/couranr/requests/client";
import type { BusinessDeclaredValueView, RouteProgress, RouteRunView } from "@/lib/couranr/routeRuns/types";

const CHECKOUT_PATH = "/api/couranr/merchant/route-runs/checkout";
export function fetchRouteProgress(input: { businessAccountId: string; routeRunId: string }):
  Promise<ApiResult<{ progress: RouteProgress | null; checkoutAvailable: boolean }>> {
  return call(`${CHECKOUT_PATH}?businessAccountId=${encodeURIComponent(input.businessAccountId)}` +
    `&routeRunId=${encodeURIComponent(input.routeRunId)}`);
}
export function routeCheckoutAction(input: {
  businessAccountId: string; routeRunId: string;
  action: "begin" | "advance" | "confirm_pickup_ready";
  expectedVersion?: number; idempotencyKey?: string;
}): Promise<ApiResult<{ progress: RouteProgress }>> {
  return call(CHECKOUT_PATH, { method: "POST", body: input });
}

export function fetchRouteRuns(businessAccountId: string): Promise<ApiResult<{ routeRuns: RouteRunView[] }>> {
  return call<{ routeRuns: RouteRunView[] }>(
    `/api/couranr/merchant/route-runs?businessAccountId=${encodeURIComponent(businessAccountId)}`,
  );
}

export function fetchRouteRun(input: {
  businessAccountId: string;
  routeRunId: string;
}): Promise<ApiResult<{ routeRun: RouteRunView }>> {
  return call<{ routeRun: RouteRunView }>(
    `/api/couranr/merchant/route-runs?businessAccountId=${encodeURIComponent(input.businessAccountId)}&routeRunId=${encodeURIComponent(input.routeRunId)}`,
  );
}

export function saveRouteRunDraft(input: {
  businessAccountId: string;
  routeRunId: string;
  expectedVersion: number;
  idempotencyKey: string;
  title: string;
  requestIds: string[];
}): Promise<ApiResult<{ routeRun: RouteRunView }>> {
  return call<{ routeRun: RouteRunView }>(
    `/api/couranr/merchant/route-runs?businessAccountId=${encodeURIComponent(input.businessAccountId)}`,
    {
      method: "POST",
      body: {
        routeRunId: input.routeRunId,
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
        title: input.title,
        requestIds: input.requestIds,
      },
    },
  );
}

export function acceptRouteRun(input: {
  businessAccountId: string;
  routeRunId: string;
  expectedVersion: number;
  idempotencyKey: string;
}): Promise<ApiResult<{ routeRun: RouteRunView }>> {
  return call<{ routeRun: RouteRunView }>("/api/couranr/merchant/route-runs", {
    method: "PATCH",
    body: { ...input, action: "accept" },
  });
}

export function abandonRouteRun(input: {
  businessAccountId: string;
  routeRunId: string;
  expectedVersion: number;
  idempotencyKey: string;
}): Promise<ApiResult<{ routeRun: RouteRunView }>> {
  return call<{ routeRun: RouteRunView }>("/api/couranr/merchant/route-runs", {
    method: "PATCH",
    body: { ...input, action: "abandon" },
  });
}

export function cancelAcceptedRouteRun(input: {
  businessAccountId: string;
  routeRunId: string;
  expectedVersion: number;
  idempotencyKey: string;
}): Promise<ApiResult<{ routeRun: RouteRunView }>> {
  return call<{ routeRun: RouteRunView }>("/api/couranr/merchant/route-runs", {
    method: "PATCH",
    body: { ...input, action: "cancel" },
  });
}

export function recordBusinessDeclaredValue(input: {
  businessAccountId: string;
  requestId: string;
  expectedVersion: number;
  declaredValueCents: number;
}): Promise<ApiResult<BusinessDeclaredValueView>> {
  return call<BusinessDeclaredValueView>(
    "/api/couranr/merchant/route-runs/declared-value",
    { method: "POST", body: input },
  );
}

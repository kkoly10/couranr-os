/** Business multi-stop foundation. A saved draft is NOT a booking or a quote.
 * All commercial/custody facts are read again by the server; the client sends
 * only an ordered set of existing single-destination draft request IDs. */
export const ROUTE_RUN_DRAFT_CONTRACT = "couranr-route-draft-v1" as const;
export const MIN_ROUTE_STOPS = 2;
export const MAX_ROUTE_STOPS = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RouteDraftInput = {
  routeRunId: string;
  expectedVersion: number;
  idempotencyKey: string;
  title: string;
  requestIds: string[];
};
export type RouteDraftFailure =
  | "invalid_body" | "unknown_field" | "invalid_id" | "invalid_version"
  | "invalid_title" | "invalid_stop_count" | "duplicate_request";
export type RouteDraftValidation =
  | { ok: true; value: RouteDraftInput }
  | { ok: false; reason: RouteDraftFailure };

export function isRouteRunId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function validateRouteDraft(raw: unknown): RouteDraftValidation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "invalid_body" };
  }
  const r = raw as Record<string, unknown>;
  const keys = new Set(["routeRunId", "expectedVersion", "idempotencyKey", "title", "requestIds"]);
  if (Object.keys(r).some((key) => !keys.has(key))) return { ok: false, reason: "unknown_field" };
  if (!isRouteRunId(r.routeRunId) || !isRouteRunId(r.idempotencyKey)) {
    return { ok: false, reason: "invalid_id" };
  }
  if (typeof r.expectedVersion !== "number" || !Number.isSafeInteger(r.expectedVersion) ||
      r.expectedVersion < 0 || r.expectedVersion > 2147483646) {
    return { ok: false, reason: "invalid_version" };
  }
  if (typeof r.title !== "string" || r.title.trim().length < 1 ||
      r.title.trim().length > 100 || Array.from(r.title).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) {
    return { ok: false, reason: "invalid_title" };
  }
  if (!Array.isArray(r.requestIds) || r.requestIds.length < MIN_ROUTE_STOPS ||
      r.requestIds.length > MAX_ROUTE_STOPS) return { ok: false, reason: "invalid_stop_count" };
  if (!r.requestIds.every(isRouteRunId)) return { ok: false, reason: "invalid_id" };
  const requestIds = r.requestIds.map((id) => id.toLowerCase());
  if (new Set(requestIds).size !== requestIds.length) return { ok: false, reason: "duplicate_request" };
  return { ok: true, value: {
    routeRunId: r.routeRunId.toLowerCase(), expectedVersion: r.expectedVersion,
    idempotencyKey: r.idempotencyKey.toLowerCase(), title: r.title.trim(), requestIds,
  } };
}

import { assertServerOnly } from "@/lib/couranr/serverOnly";
import { claimPaidApiCall } from "@/lib/couranr/providers/paidApiGuard";

assertServerOnly("lib/couranr/routing/mapboxDirections.ts");

const MAPBOX_DIRECTIONS_BASE =
  "https://api.mapbox.com/directions/v5/mapbox/driving-traffic";
const METERS_PER_MILE = 1609.344;

export type RouteServiceabilityOutcome = "available_for_request" | "needs_review";

export type MapboxRouteReviewReason =
  | "mapbox_directions_not_configured"
  | "mapbox_directions_unavailable"
  | "mapbox_directions_cost_guard"
  | "mapbox_directions_no_route"
  | "mapbox_directions_invalid_response"
  | "market_needs_review";

export type CanonicalRouteEvidence = {
  serviceabilityOutcome: RouteServiceabilityOutcome;
  distanceSource: "mapbox_directions_v5";
  distanceMeters: number | null;
  loadedMiles: number | null;
  /** Traffic-aware duration returned by the driving-traffic profile. */
  durationSeconds: number | null;
  /**
   * Typical-conditions duration returned as duration_typical. This is the
   * baseline used by Couranr's existing traffic-delay pricing doctrine.
   */
  staticDurationSeconds: number | null;
  /** max(duration - duration_typical, 0). */
  trafficDelaySeconds: number | null;
  reviewReason: MapboxRouteReviewReason | null;
};

export type MapboxProviderFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Pick<Response, "ok" | "status" | "json">>;

function needsReview(
  reason: Exclude<MapboxRouteReviewReason, "market_needs_review">
): CanonicalRouteEvidence {
  return {
    serviceabilityOutcome: "needs_review",
    distanceSource: "mapbox_directions_v5",
    distanceMeters: null,
    loadedMiles: null,
    durationSeconds: null,
    staticDurationSeconds: null,
    trafficDelaySeconds: null,
    reviewReason: reason,
  };
}

/** Three decimals is Couranr's canonical loaded-mile precision. */
export function loadedMilesFromDistanceMeters(distanceMeters: number): number {
  return Math.round((distanceMeters / METERS_PER_MILE) * 1000) / 1000;
}

function finiteCoordinate(value: number): boolean {
  return Number.isFinite(value);
}

function validLatitude(value: number): boolean {
  return finiteCoordinate(value) && value >= -90 && value <= 90;
}

function validLongitude(value: number): boolean {
  return finiteCoordinate(value) && value >= -180 && value <= 180;
}

/**
 * Server-authoritative Mapbox Directions v5 route.
 *
 * Inputs are coordinates from canonical Google Place Details snapshots, never
 * browser-supplied mileage/duration/traffic values. Google remains address
 * identity; Mapbox owns route/distance/traffic.
 */
export async function computeCanonicalMapboxRoute(
  input: {
    pickupLatitude: number;
    pickupLongitude: number;
    dropoffLatitude: number;
    dropoffLongitude: number;
    /** Canonical future instant derived server-side from TMZ-001 timing. */
    departureAt?: Date | null;
  },
  fetchImpl: MapboxProviderFetch = fetch
): Promise<CanonicalRouteEvidence> {
  const token = process.env.MAPBOX_ACCESS_TOKEN;
  if (!token) return needsReview("mapbox_directions_not_configured");

  if (
    !validLatitude(input.pickupLatitude) ||
    !validLongitude(input.pickupLongitude) ||
    !validLatitude(input.dropoffLatitude) ||
    !validLongitude(input.dropoffLongitude)
  ) {
    return needsReview("mapbox_directions_invalid_response");
  }

  const spend = await claimPaidApiCall("mapbox_directions", fetchImpl);
  if (!spend.allowed) return needsReview("mapbox_directions_cost_guard");

  const coordinates =
    `${input.pickupLongitude},${input.pickupLatitude};` +
    `${input.dropoffLongitude},${input.dropoffLatitude}`;

  const url = new URL(`${MAPBOX_DIRECTIONS_BASE}/${coordinates}`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("alternatives", "false");
  url.searchParams.set("overview", "false");
  url.searchParams.set("steps", "false");

  // Mapbox driving-traffic accepts depart_at. For immediate work, omitting it
  // asks for current conditions. Past instants are never sent.
  if (input.departureAt && input.departureAt.getTime() > Date.now()) {
    url.searchParams.set("depart_at", input.departureAt.toISOString());
  }

  let response: Pick<Response, "ok" | "status" | "json">;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return needsReview("mapbox_directions_unavailable");
  }

  if (!response.ok) return needsReview("mapbox_directions_unavailable");

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return needsReview("mapbox_directions_invalid_response");
  }

  const body =
    payload && typeof payload === "object"
      ? (payload as { code?: unknown; routes?: unknown })
      : null;
  if (!body || body.code !== "Ok" || !Array.isArray(body.routes) || body.routes.length === 0) {
    return needsReview(
      body?.code === "NoRoute" ? "mapbox_directions_no_route" : "mapbox_directions_invalid_response"
    );
  }

  const first = body.routes[0] as {
    distance?: unknown;
    duration?: unknown;
    duration_typical?: unknown;
  };

  const distance = first.distance;
  const duration = first.duration;
  const typical = first.duration_typical;

  if (
    typeof distance !== "number" ||
    !Number.isFinite(distance) ||
    distance < 0 ||
    typeof duration !== "number" ||
    !Number.isFinite(duration) ||
    duration < 0 ||
    typeof typical !== "number" ||
    !Number.isFinite(typical) ||
    typical < 0
  ) {
    return needsReview("mapbox_directions_invalid_response");
  }

  const distanceMeters = Math.round(distance);
  const durationSeconds = Math.round(duration);
  const staticDurationSeconds = Math.round(typical);

  return {
    serviceabilityOutcome: "available_for_request",
    distanceSource: "mapbox_directions_v5",
    distanceMeters,
    loadedMiles: loadedMilesFromDistanceMeters(distanceMeters),
    durationSeconds,
    staticDurationSeconds,
    trafficDelaySeconds: Math.max(durationSeconds - staticDurationSeconds, 0),
    reviewReason: null,
  };
}

import { assertServerOnly } from "@/lib/couranr/serverOnly";
import { claimPaidApiCall } from "@/lib/couranr/providers/paidApiGuard";

assertServerOnly("lib/couranr/routing/googleRoutes.ts");

/**
 * LEGACY / DISABLED FALLBACK ONLY.
 *
 * Couranr's canonical routing authority is now:
 *   canonicalRoute.ts -> mapboxDirections.ts
 *
 * Nothing in production application code imports this module. The paid API
 * budget row for google_routes_compute_routes is also disabled in production.
 * This provider is intentionally retained only as rollback/reference code
 * during the Mapbox transition. It MUST NOT own quote derivation, timing,
 * address resolution, or dispatch orchestration.
 */
const COMPUTE_ROUTES_URL =
  "https://routes.googleapis.com/directions/v2:computeRoutes";
const METERS_PER_MILE = 1609.344;

export type LegacyGoogleRouteEvidence = {
  serviceabilityOutcome: "available_for_request" | "needs_review";
  distanceSource: "google_routes_v2";
  distanceMeters: number | null;
  loadedMiles: number | null;
  durationSeconds: number | null;
  staticDurationSeconds: number | null;
  trafficDelaySeconds: number | null;
  reviewReason:
    | "google_routes_not_configured"
    | "google_routes_unavailable"
    | "google_routes_cost_guard"
    | "google_routes_no_route"
    | "google_routes_invalid_response"
    | null;
};

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Pick<Response, "ok" | "status" | "json">>;

function needsReview(
  reviewReason: Exclude<LegacyGoogleRouteEvidence["reviewReason"], null>
): LegacyGoogleRouteEvidence {
  return {
    serviceabilityOutcome: "needs_review",
    distanceSource: "google_routes_v2",
    distanceMeters: null,
    loadedMiles: null,
    durationSeconds: null,
    staticDurationSeconds: null,
    trafficDelaySeconds: null,
    reviewReason,
  };
}

function loadedMilesFromDistanceMeters(distanceMeters: number): number {
  return Math.round((distanceMeters / METERS_PER_MILE) * 1000) / 1000;
}

function durationSeconds(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^\d+(?:\.\d+)?s$/.test(raw)) return null;
  const seconds = Number(raw.slice(0, -1));
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds) : null;
}

/**
 * Legacy provider-only call. The server-side spend guard currently denies real
 * Google Routes calls because its production budget row is inactive.
 *
 * This function deliberately accepts only already-canonical Google Place IDs
 * and returns route evidence. It cannot create quotes or change request state.
 */
export async function computeLegacyGoogleRoute(
  input: {
    pickupPlaceId: string;
    dropoffPlaceId: string;
    departureAt?: Date | null;
  },
  fetchImpl: FetchLike = fetch
): Promise<LegacyGoogleRouteEvidence> {
  const apiKey = process.env.GOOGLE_MAPS_SERVER_API_KEY;
  if (!apiKey) return needsReview("google_routes_not_configured");

  const spend = await claimPaidApiCall("google_routes_compute_routes", fetchImpl);
  if (!spend.allowed) return needsReview("google_routes_cost_guard");

  let response: Pick<Response, "ok" | "status" | "json">;
  try {
    response = await fetchImpl(COMPUTE_ROUTES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "routes.distanceMeters,routes.duration,routes.staticDuration",
      },
      body: JSON.stringify({
        origin: { placeId: input.pickupPlaceId },
        destination: { placeId: input.dropoffPlaceId },
        travelMode: "DRIVE",
        ...(input.departureAt && input.departureAt.getTime() > Date.now()
          ? { departureTime: input.departureAt.toISOString() }
          : {}),
        routingPreference: "TRAFFIC_AWARE",
        computeAlternativeRoutes: false,
        units: "IMPERIAL",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return needsReview("google_routes_unavailable");
  }

  if (!response.ok) return needsReview("google_routes_unavailable");

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return needsReview("google_routes_invalid_response");
  }

  const routes =
    payload && typeof payload === "object"
      ? (payload as { routes?: unknown }).routes
      : null;
  if (!Array.isArray(routes) || routes.length === 0) {
    return needsReview("google_routes_no_route");
  }

  const first = routes[0] as {
    distanceMeters?: unknown;
    duration?: unknown;
    staticDuration?: unknown;
  };
  const distanceMeters = first.distanceMeters;
  const parsedDuration = durationSeconds(first.duration);
  const parsedStaticDuration = durationSeconds(first.staticDuration);

  if (
    typeof distanceMeters !== "number" ||
    !Number.isSafeInteger(distanceMeters) ||
    distanceMeters < 0 ||
    parsedDuration === null ||
    parsedStaticDuration === null
  ) {
    return needsReview("google_routes_invalid_response");
  }

  return {
    serviceabilityOutcome: "available_for_request",
    distanceSource: "google_routes_v2",
    distanceMeters,
    loadedMiles: loadedMilesFromDistanceMeters(distanceMeters),
    durationSeconds: parsedDuration,
    staticDurationSeconds: parsedStaticDuration,
    trafficDelaySeconds: Math.max(parsedDuration - parsedStaticDuration, 0),
    reviewReason: null,
  };
}

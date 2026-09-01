import { assertServerOnly } from "@/lib/couranr/serverOnly";
import { quoteDelivery, type QuoteResult } from "@/lib/couranr/pricing";
import type { ServiceLevel } from "@/lib/couranr/pricing";
import {
  googlePlaceSelectionFromAddress,
  type GoogleAddressSnapshot,
  type GooglePlaceSelection,
} from "./address";
import {
  isGooglePlaceResolutionError,
  resolveCanonicalGooglePlace,
  type GooglePlaceResolutionReason,
  type GoogleProviderFetch,
} from "./googlePlaces";
import { isCouranrAutoApprovedRouteMarket } from "./market";

assertServerOnly("lib/couranr/routing/googleRoutes.ts");

const COMPUTE_ROUTES_URL =
  "https://routes.googleapis.com/directions/v2:computeRoutes";
const METERS_PER_MILE = 1609.344;

export type RouteServiceabilityOutcome = "available_for_request" | "needs_review";
export type RouteReviewReason =
  | "google_routes_not_configured"
  | "google_routes_unavailable"
  | "google_routes_no_route"
  | "google_routes_invalid_response"
  | "market_needs_review";

export type CanonicalRouteEvidence = {
  serviceabilityOutcome: RouteServiceabilityOutcome;
  distanceSource: "google_routes_v2";
  distanceMeters: number | null;
  loadedMiles: number | null;
  durationSeconds: number | null;
  reviewReason: RouteReviewReason | null;
};

export type RoutableQuoteShipment = {
  pickupAddress: unknown;
  dropoffAddress: unknown;
  weightLb: number;
  additionalStops: number;
  serviceLevel: ServiceLevel;
  signatureRequired: boolean;
  overnightRequested: boolean;
};

type FetchLike = GoogleProviderFetch;

export type CanonicalAddressField = "pickupAddress" | "dropoffAddress";

export class CanonicalAddressResolutionError extends Error {
  constructor(
    readonly field: CanonicalAddressField,
    readonly reason: GooglePlaceResolutionReason
  ) {
    super(`${field}:${reason}`);
    this.name = "CanonicalAddressResolutionError";
  }
}

export function isCanonicalAddressResolutionError(
  error: unknown
): error is CanonicalAddressResolutionError {
  return error instanceof CanonicalAddressResolutionError;
}

function needsReview(reviewReason: RouteReviewReason): CanonicalRouteEvidence {
  return {
    serviceabilityOutcome: "needs_review",
    distanceSource: "google_routes_v2",
    distanceMeters: null,
    loadedMiles: null,
    durationSeconds: null,
    reviewReason,
  };
}

/** Three decimals is the canonical precision used by request and quote rows. */
export function loadedMilesFromDistanceMeters(distanceMeters: number): number {
  return Math.round((distanceMeters / METERS_PER_MILE) * 1000) / 1000;
}

function durationSeconds(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^\d+(?:\.\d+)?s$/.test(raw)) return null;
  const seconds = Number(raw.slice(0, -1));
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds) : null;
}

/**
 * Canonical Routes API authority. Waypoints are Google Place IDs, never a
 * merchant-entered distance or an unverified address string.
 */
export async function computeCanonicalGoogleRoute(
  input: { pickupPlaceId: string; dropoffPlaceId: string },
  fetchImpl: FetchLike = fetch
): Promise<CanonicalRouteEvidence> {
  const apiKey = process.env.GOOGLE_MAPS_SERVER_API_KEY;
  if (!apiKey) return needsReview("google_routes_not_configured");

  let response: Pick<Response, "ok" | "status" | "json">;
  try {
    response = await fetchImpl(COMPUTE_ROUTES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
      },
      body: JSON.stringify({
        origin: { placeId: input.pickupPlaceId },
        destination: { placeId: input.dropoffPlaceId },
        travelMode: "DRIVE",
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

  const first = routes[0] as { distanceMeters?: unknown; duration?: unknown };
  const distanceMeters = first.distanceMeters;
  const parsedDuration = durationSeconds(first.duration);
  if (
    typeof distanceMeters !== "number" ||
    !Number.isSafeInteger(distanceMeters) ||
    distanceMeters < 0 ||
    parsedDuration === null
  ) {
    return needsReview("google_routes_invalid_response");
  }

  return {
    serviceabilityOutcome: "available_for_request",
    distanceSource: "google_routes_v2",
    distanceMeters,
    loadedMiles: loadedMilesFromDistanceMeters(distanceMeters),
    durationSeconds: parsedDuration,
    reviewReason: null,
  };
}

function routeReviewQuote(): QuoteResult {
  const basis = quoteDelivery({ loadedMiles: 0, weightLb: 0, additionalStops: 0 });
  return {
    ...basis,
    quoteStatus: "manual_review_required",
    deliverySubtotalCents: 0,
    lineItems: [],
    billableLoadedMiles: 0,
    reviewReasons: ["route_needs_review"],
  };
}

export async function deriveCanonicalRouteAndQuote(
  shipment: RoutableQuoteShipment,
  fetchImpl: FetchLike = fetch
): Promise<{
  pickupAddress: GoogleAddressSnapshot;
  dropoffAddress: GoogleAddressSnapshot;
  route: CanonicalRouteEvidence;
  quote: QuoteResult;
}> {
  const pickupSelection = googlePlaceSelectionFromAddress(shipment.pickupAddress);
  const dropoffSelection = googlePlaceSelectionFromAddress(shipment.dropoffAddress);

  const resolve = async (
    field: CanonicalAddressField,
    selection: GooglePlaceSelection | null
  ) => {
    if (!selection) {
      throw new CanonicalAddressResolutionError(field, "google_places_invalid_response");
    }
    try {
      return await resolveCanonicalGooglePlace(selection, fetchImpl);
    } catch (error) {
      if (isGooglePlaceResolutionError(error)) {
        throw new CanonicalAddressResolutionError(field, error.reason);
      }
      throw error;
    }
  };

  // The two independent Place Details reads start together. Routes waits for
  // both because its waypoints must be the exact identities just verified.
  const [pickupAddress, dropoffAddress] = await Promise.all([
    resolve("pickupAddress", pickupSelection),
    resolve("dropoffAddress", dropoffSelection),
  ]);
  const route = await computeCanonicalGoogleRoute(
    {
      pickupPlaceId: pickupAddress.googlePlaceId,
      dropoffPlaceId: dropoffAddress.googlePlaceId,
    },
    fetchImpl
  );

  if (route.loadedMiles === null) {
    return { pickupAddress, dropoffAddress, route, quote: routeReviewQuote() };
  }

  if (!isCouranrAutoApprovedRouteMarket(pickupAddress, dropoffAddress)) {
    return {
      pickupAddress,
      dropoffAddress,
      route: {
        ...route,
        serviceabilityOutcome: "needs_review",
        reviewReason: "market_needs_review",
      },
      quote: routeReviewQuote(),
    };
  }

  return {
    pickupAddress,
    dropoffAddress,
    route,
    quote: quoteDelivery({
      loadedMiles: route.loadedMiles,
      weightLb: shipment.weightLb,
      additionalStops: shipment.additionalStops,
      serviceLevel: shipment.serviceLevel,
      signatureRequired: shipment.signatureRequired,
      overnightRequested: shipment.overnightRequested,
    }),
  };
}

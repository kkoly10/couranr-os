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
  /**
   * TRAFFIC-AWARE duration. The request pins `routingPreference:
   * "TRAFFIC_AWARE"`, which is what makes Google compute this with live
   * conditions; under TRAFFIC_UNAWARE it would equal `staticDurationSeconds`
   * and every delay would be zero.
   */
  durationSeconds: number | null;
  /**
   * BASELINE duration for the same route, excluding traffic. Google returns it
   * as `routes.staticDuration`.
   */
  staticDurationSeconds: number | null;
  /**
   * `max(durationSeconds - staticDurationSeconds, 0)`, derived here so the
   * pricing engine is handed one server-established number and never two
   * durations it could be tricked into subtracting the wrong way round.
   *
   * `null` means no traffic evidence — which prices as review, never as zero.
   */
  trafficDelaySeconds: number | null;
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
    staticDurationSeconds: null,
    trafficDelaySeconds: null,
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
        // `routes.staticDuration` is the BASELINE duration excluding traffic;
        // `routes.duration` is traffic-aware because routingPreference below is
        // TRAFFIC_AWARE. Both are required: the delay is their difference, and
        // a quote may not invent one.
        "X-Goog-FieldMask":
          "routes.distanceMeters,routes.duration,routes.staticDuration",
      },
      body: JSON.stringify({
        origin: { placeId: input.pickupPlaceId },
        destination: { placeId: input.dropoffPlaceId },
        travelMode: "DRIVE",
        /*
         * IMMEDIATE traffic only, and that is a deliberate limit rather than
         * an oversight. No `departureTime` is sent, so Google prices the
         * conditions for NOW - which is the only timing the Business
         * create-delivery flow can currently express, because it has no
         * canonical requested departure-time input (TRF-001).
         *
         * Future/scheduled departure traffic is NOT implemented. When the
         * Business timing / Smart Intake batch introduces a governed
         * departure-time input, it becomes an extra field on this request
         * object and the derivation below is unchanged - the seam is here and
         * needs no restructuring. Do not invent that schema from this file.
         */
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
    // A missing or malformed baseline is an INVALID response, not a zero
    // delay. Treating it as zero would silently under-price every route whose
    // baseline Google declined to return.
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
    // Clamped at zero: a route that is FASTER than its baseline is a discount
    // nobody decided, so it prices as no delay rather than as a credit.
    trafficDelaySeconds: Math.max(parsedDuration - parsedStaticDuration, 0),
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
    trafficDelaySeconds: null,
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
      // Server-derived from ONE canonical Google response. The shipment type
      // carries no duration field at all, so a browser cannot reach this.
      trafficDelaySeconds: route.trafficDelaySeconds,
    }),
  };
}

import { assertServerOnly } from "@/lib/couranr/serverOnly";
import { quoteDelivery, type QuoteResult } from "@/lib/couranr/pricing";
import type { ServiceLevel } from "@/lib/couranr/pricing";
import type { ReviewReasonCode } from "@/lib/couranr/pricing/types";
import type { WeightBand } from "@/lib/couranr/shipment/facts";
import {
  evaluateRequestTiming,
  type TimingEvaluation,
  type TimingIntent,
} from "@/lib/couranr/timing/policy";
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
import {
  computeCanonicalMapboxRoute,
  type CanonicalRouteEvidence,
  type MapboxProviderFetch,
} from "./mapboxDirections";
import { isCouranrAutoApprovedRouteMarket } from "./market";

assertServerOnly("lib/couranr/routing/canonicalRoute.ts");

export type { CanonicalRouteEvidence } from "./mapboxDirections";

export type RoutableQuoteShipment = {
  pickupAddress: unknown;
  dropoffAddress: unknown;
  weightLb: number | null;
  weightBand: WeightBand | null;
  additionalStops: number;
  serviceLevel: ServiceLevel;
  signatureRequired: boolean;
  overnightRequested: boolean;
  timingIntent: TimingIntent;
  requestedPickupLocal: string | null;
};

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

type ProviderFetch = GoogleProviderFetch & MapboxProviderFetch;

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

function timingQuoteReviewReasons(t: TimingEvaluation): ReviewReasonCode[] {
  const out: ReviewReasonCode[] = [];
  for (const reason of t.reviewReasons) {
    if (reason === "same_day_after_cutoff" && t.intent === "asap") continue;
    if (reason === "overnight_requires_couranr_confirmation") {
      out.push("overnight_requires_couranr_confirmation");
    } else if (!out.includes("timing_needs_review")) {
      out.push("timing_needs_review");
    }
  }
  return out;
}

/**
 * Provider-neutral canonical routing pipeline.
 *
 * Google Places verifies address identity and produces canonical coordinates.
 * Mapbox Directions v5 / driving-traffic owns distance, route duration and
 * traffic evidence. Pricing consumes only this server-owned evidence.
 */
export async function deriveCanonicalRouteAndQuote(
  shipment: RoutableQuoteShipment,
  fetchImpl: ProviderFetch = fetch,
  now: Date = new Date()
): Promise<{
  pickupAddress: GoogleAddressSnapshot;
  dropoffAddress: GoogleAddressSnapshot;
  route: CanonicalRouteEvidence;
  quote: QuoteResult;
  timing: TimingEvaluation;
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

  const [pickupAddress, dropoffAddress] = await Promise.all([
    resolve("pickupAddress", pickupSelection),
    resolve("dropoffAddress", dropoffSelection),
  ]);

  const timing = evaluateRequestTiming(
    {
      intent: shipment.timingIntent,
      requestedPickupLocal: shipment.requestedPickupLocal,
    },
    now
  );

  const route = await computeCanonicalMapboxRoute(
    {
      pickupLatitude: pickupAddress.latitude,
      pickupLongitude: pickupAddress.longitude,
      dropoffLatitude: dropoffAddress.latitude,
      dropoffLongitude: dropoffAddress.longitude,
      departureAt: timing.requestedDepartureAt,
    },
    fetchImpl
  );

  if (route.loadedMiles === null) {
    return { pickupAddress, dropoffAddress, route, quote: routeReviewQuote(), timing };
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
      timing,
    };
  }

  const quote = quoteDelivery({
    loadedMiles: route.loadedMiles,
    weightLb: shipment.weightLb,
    weightBand: shipment.weightBand,
    additionalStops: shipment.additionalStops,
    serviceLevel: shipment.serviceLevel,
    signatureRequired: shipment.signatureRequired,
    overnightRequested: shipment.overnightRequested,
    trafficDelaySeconds: route.trafficDelaySeconds,
  });

  const timingReasons = timingQuoteReviewReasons(timing).filter(
    (r) => !quote.reviewReasons.includes(r)
  );
  if (timingReasons.length > 0 && quote.quoteStatus !== "invalid") {
    return {
      pickupAddress,
      dropoffAddress,
      route,
      quote: {
        ...quote,
        quoteStatus: "manual_review_required",
        deliverySubtotalCents: 0,
        lineItems: [],
        reviewReasons: [...quote.reviewReasons, ...timingReasons],
      },
      timing,
    };
  }

  return { pickupAddress, dropoffAddress, route, quote, timing };
}

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeDeliveryRequestInput, isNormalizeFailure } from "@/lib/couranr/requests/input";
import { normalizeGooglePlaceSelection } from "@/lib/couranr/routing/address";
import {
  computeCanonicalGoogleRoute,
  deriveCanonicalRouteAndQuote,
  loadedMilesFromDistanceMeters,
} from "@/lib/couranr/routing/googleRoutes";

const ROOT = path.resolve(__dirname, "..");
const ORIGINAL_SERVER_KEY = process.env.GOOGLE_MAPS_SERVER_API_KEY;

afterEach(() => {
  vi.restoreAllMocks();
  if (ORIGINAL_SERVER_KEY === undefined) delete process.env.GOOGLE_MAPS_SERVER_API_KEY;
  else process.env.GOOGLE_MAPS_SERVER_API_KEY = ORIGINAL_SERVER_KEY;
});

function address(id: string, line1 = "10 Market St") {
  return {
    googlePlaceId: id,
    formattedAddress: `${line1}, Stafford, VA 22554, USA`,
    line1,
    line2: null,
    city: "Stafford",
    region: "VA",
    postalCode: "22554",
    countryCode: "US",
    latitude: 38.422,
    longitude: -77.408,
    addressSource: "google_places_new" as const,
    instructions: null,
  };
}

function draft(overrides: Record<string, unknown> = {}) {
  const normalized = normalizeDeliveryRequestInput({
    pickupAddress: address("place-pickup"),
    dropoffAddress: address("place-dropoff", "20 Main St"),
    weightLb: 10,
    ...overrides,
  });
  if (isNormalizeFailure(normalized)) throw new Error(JSON.stringify(normalized.errors));
  return normalized.value;
}

function routeResponse(distanceMeters: number, duration = "600s") {
  return {
    ok: true,
    status: 200,
    json: async () => ({ routes: [{ distanceMeters, duration }] }),
  };
}

describe("Places-selected address snapshots", () => {
  it("persists Place ID, normalized components and coordinates", () => {
    const selected = normalizeGooglePlaceSelection({
      id: "ChIJ-selected",
      formattedAddress: "100 King St, Alexandria, VA 22314, USA",
      displayName: "100 King Street",
      location: { lat: () => 38.8048, lng: () => -77.0431 },
      addressComponents: [
        { types: ["street_number"], longText: "100", shortText: "100" },
        { types: ["route"], longText: "King Street", shortText: "King St" },
        { types: ["locality"], longText: "Alexandria" },
        { types: ["administrative_area_level_1"], longText: "Virginia", shortText: "VA" },
        { types: ["postal_code"], longText: "22314", shortText: "22314" },
        { types: ["country"], longText: "United States", shortText: "US" },
      ],
    });

    expect(selected).toMatchObject({
      googlePlaceId: "ChIJ-selected",
      line1: "100 King Street",
      city: "Alexandria",
      region: "VA",
      postalCode: "22314",
      countryCode: "US",
      latitude: 38.8048,
      longitude: -77.0431,
      addressSource: "google_places_new",
    });
  });
});

describe("server Routes authority", () => {
  it("uses only the server key and derives loaded miles from distanceMeters", async () => {
    process.env.GOOGLE_MAPS_SERVER_API_KEY = "server-secret-test-key";
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      routeResponse(8047, "721.4s")
    );

    const result = await computeCanonicalGoogleRoute(
      { pickupPlaceId: "place-a", dropoffPlaceId: "place-b" },
      fetcher
    );

    expect(result).toEqual({
      serviceabilityOutcome: "available_for_request",
      distanceSource: "google_routes_v2",
      distanceMeters: 8047,
      loadedMiles: loadedMilesFromDistanceMeters(8047),
      durationSeconds: 721,
      reviewReason: null,
    });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://routes.googleapis.com/directions/v2:computeRoutes");
    expect(init?.headers).toMatchObject({
      "X-Goog-Api-Key": "server-secret-test-key",
      "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      origin: { placeId: "place-a" },
      destination: { placeId: "place-b" },
      travelMode: "DRIVE",
    });
  });

  it("re-estimates from a changed Place ID and produces a different trusted quote", async () => {
    process.env.GOOGLE_MAPS_SERVER_API_KEY = "server-secret-test-key";
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return routeResponse(body.destination.placeId === "place-farther" ? 32187 : 8047);
    });

    const first = await deriveCanonicalRouteAndQuote(draft(), fetcher);
    const changed = await deriveCanonicalRouteAndQuote(
      draft({ dropoffAddress: address("place-farther", "900 Far St") }),
      fetcher
    );

    expect(first.route.distanceMeters).toBe(8047);
    expect(changed.route.distanceMeters).toBe(32187);
    expect(changed.quote.deliverySubtotalCents).toBeGreaterThan(
      first.quote.deliverySubtotalCents
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("falls back to needs_review without inventing route or money", async () => {
    process.env.GOOGLE_MAPS_SERVER_API_KEY = "server-secret-test-key";
    const fetcher = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: { message: "not persisted" } }),
    }));

    const result = await deriveCanonicalRouteAndQuote(draft(), fetcher);
    expect(result.route).toMatchObject({
      serviceabilityOutcome: "needs_review",
      distanceMeters: null,
      loadedMiles: null,
      durationSeconds: null,
      reviewReason: "google_routes_unavailable",
    });
    expect(result.quote).toMatchObject({
      quoteStatus: "manual_review_required",
      deliverySubtotalCents: 0,
      lineItems: [],
      reviewReasons: ["route_needs_review"],
    });
  });

  it("ignores malicious client mileage and prices the Google route", async () => {
    process.env.GOOGLE_MAPS_SERVER_API_KEY = "server-secret-test-key";
    const tampered = draft({ loadedMiles: 9999, distanceMeters: 1 });
    expect(tampered).not.toHaveProperty("loadedMiles");
    expect(tampered).not.toHaveProperty("distanceMeters");

    const result = await deriveCanonicalRouteAndQuote(
      tampered,
      vi.fn(async () => routeResponse(8047))
    );
    expect(result.route.loadedMiles).toBe(loadedMilesFromDistanceMeters(8047));
    expect(result.quote.quoteStatus).toBe("estimated");
    expect(result.quote.deliverySubtotalCents).toBeLessThan(100_000);
  });
});

describe("browser/server key boundary", () => {
  it("uses the public key only in the Places loader and the server key only in Routes", () => {
    const browser = readFileSync(
      path.join(ROOT, "components/couranr/requests/NewDeliveryFlow.tsx"),
      "utf8"
    );
    const server = readFileSync(path.join(ROOT, "lib/couranr/routing/googleRoutes.ts"), "utf8");
    expect(browser).toContain("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY");
    expect(browser).not.toContain("GOOGLE_MAPS_SERVER_API_KEY");
    expect(browser).toContain("onInvalidSelection={() => onChange(null)}");
    expect(server).toContain("GOOGLE_MAPS_SERVER_API_KEY");
    expect(server).not.toContain("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY");
  });
});

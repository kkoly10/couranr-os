import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeDeliveryRequestInput, isNormalizeFailure } from "@/lib/couranr/requests/input";
import { shipmentArgs } from "@/lib/couranr/requests/commands";
import { normalizeGooglePlaceSelection } from "@/lib/couranr/routing/address";
import {
  GOOGLE_PLACE_DETAILS_FIELD_MASK,
  GooglePlaceResolutionError,
  resolveCanonicalGooglePlace,
} from "@/lib/couranr/routing/googlePlaces";
import { deriveCanonicalRouteAndQuote } from "@/lib/couranr/routing/canonicalRoute";
import {
  computeCanonicalMapboxRoute,
  loadedMilesFromDistanceMeters,
} from "@/lib/couranr/routing/mapboxDirections";
import {
  COURANR_AUTO_APPROVED_MARKETS,
  isCouranrAutoApprovedMarket,
} from "@/lib/couranr/routing/market";

const ROOT = path.resolve(__dirname, "..");
const ORIGINAL_SERVER_KEY = process.env.GOOGLE_MAPS_SERVER_API_KEY;
const ORIGINAL_MAPBOX_TOKEN = process.env.MAPBOX_ACCESS_TOKEN;

beforeEach(() => {
  process.env.MAPBOX_ACCESS_TOKEN = "test-mapbox-token";
});

afterEach(() => {
  vi.restoreAllMocks();
  if (ORIGINAL_SERVER_KEY === undefined) delete process.env.GOOGLE_MAPS_SERVER_API_KEY;
  else process.env.GOOGLE_MAPS_SERVER_API_KEY = ORIGINAL_SERVER_KEY;
  if (ORIGINAL_MAPBOX_TOKEN === undefined) delete process.env.MAPBOX_ACCESS_TOKEN;
  else process.env.MAPBOX_ACCESS_TOKEN = ORIGINAL_MAPBOX_TOKEN;
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

type PlaceSpec = {
  line1?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  countryCode?: string;
  latitude?: number;
  longitude?: number;
};

function placePayload(id: string, spec: PlaceSpec = {}) {
  const line1 = spec.line1 ?? "10 Market Street";
  const [streetNumber = "10", ...routeParts] = line1.split(" ");
  const route = routeParts.join(" ") || "Market Street";
  const city = spec.city ?? "Stafford";
  const region = spec.region ?? "VA";
  const postalCode = spec.postalCode ?? "22554";
  const countryCode = spec.countryCode ?? "US";
  return {
    id,
    formattedAddress: `${line1}, ${city}, ${region} ${postalCode}, USA`,
    location: {
      latitude: spec.latitude ?? 38.422,
      longitude: spec.longitude ?? -77.408,
    },
    addressComponents: [
      { types: ["street_number"], longText: streetNumber, shortText: streetNumber },
      { types: ["route"], longText: route, shortText: route },
      { types: ["locality"], longText: city, shortText: city },
      {
        types: ["administrative_area_level_1"],
        longText: region === "VA" ? "Virginia" : region,
        shortText: region,
      },
      { types: ["postal_code"], longText: postalCode, shortText: postalCode },
      { types: ["country"], longText: "United States", shortText: countryCode },
    ],
  };
}

function routeResponse(
  distanceMeters: number,
  duration = 600,
  typicalDuration = duration,
) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      code: "Ok",
      routes: [{ distance: distanceMeters, duration, duration_typical: typicalDuration }],
    }),
  };
}

function providerFetcher(
  places: Record<string, ReturnType<typeof placePayload>>,
  route:
    | ReturnType<typeof routeResponse>
    | ((url: URL) => ReturnType<typeof routeResponse>) = routeResponse(8047)
) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith("https://places.googleapis.com/v1/places/")) {
      const placeId = decodeURIComponent(url.slice(url.lastIndexOf("/") + 1));
      const payload = places[placeId];
      return payload
        ? { ok: true, status: 200, json: async () => payload }
        : { ok: false, status: 404, json: async () => ({}) };
    }
    if (url.startsWith("https://api.mapbox.com/directions/v5/mapbox/driving-traffic/")) {
      return typeof route === "function" ? route(new URL(url)) : route;
    }
    throw new Error(`unexpected provider URL: ${url}`);
  });
}

describe("Places-selected address authority", () => {
  it("normalizes browser Places output for display", () => {
    const selected = normalizeGooglePlaceSelection({
      ...placePayload("ChIJ-selected", {
        line1: "100 King Street",
        city: "Alexandria",
        postalCode: "22314",
        latitude: 38.8048,
        longitude: -77.0431,
      }),
      location: { lat: () => 38.8048, lng: () => -77.0431 },
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
    });
  });

  it("resolves canonical fields with the server key and an explicit minimal field mask", async () => {
    process.env.GOOGLE_MAPS_SERVER_API_KEY = "server-secret-test-key";
    const fetcher = providerFetcher({
      "ChIJ-selected": placePayload("ChIJ-selected", { line1: "100 King Street" }),
    });
    const resolved = await resolveCanonicalGooglePlace(
      { googlePlaceId: "ChIJ-selected", line2: "Suite 7", instructions: "Side door" },
      fetcher
    );

    expect(resolved).toMatchObject({
      googlePlaceId: "ChIJ-selected",
      line1: "100 King Street",
      city: "Stafford",
      line2: "Suite 7",
      instructions: "Side door",
    });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://places.googleapis.com/v1/places/ChIJ-selected");
    expect(init?.headers).toMatchObject({
      "X-Goog-Api-Key": "server-secret-test-key",
      "X-Goog-FieldMask": GOOGLE_PLACE_DETAILS_FIELD_MASK,
    });
    expect(GOOGLE_PLACE_DETAILS_FIELD_MASK).toBe(
      "id,formattedAddress,addressComponents,location"
    );
  });

  it("refuses a Place Details response whose identity differs from the requested ID", async () => {
    process.env.GOOGLE_MAPS_SERVER_API_KEY = "server-secret-test-key";
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => placePayload("different-place"),
    }));
    await expect(
      resolveCanonicalGooglePlace(
        { googlePlaceId: "requested-place", line2: null, instructions: null },
        fetcher
      )
    ).rejects.toEqual(
      expect.objectContaining<Partial<GooglePlaceResolutionError>>({
        reason: "google_places_identity_mismatch",
      })
    );
  });

  it("uses server address facts and only preserves browser suite/instructions", async () => {
    process.env.GOOGLE_MAPS_SERVER_API_KEY = "server-secret-test-key";
    const forgedPickup = {
      ...address("place-pickup", "999 Forged Faraway Rd"),
      formattedAddress: "999 Forged Faraway Rd, Seattle, WA 98101, USA",
      city: "Seattle",
      region: "WA",
      postalCode: "98101",
      latitude: 47.6062,
      longitude: -122.3321,
      line2: "Suite 12",
      instructions: "Use loading dock",
    };
    const tampered = draft({ pickupAddress: forgedPickup });
    expect(tampered.pickupAddress).toEqual({
      googlePlaceId: "place-pickup",
      line2: "Suite 12",
      instructions: "Use loading dock",
    });

    const routed = await deriveCanonicalRouteAndQuote(
      tampered,
      providerFetcher({
        "place-pickup": placePayload("place-pickup", { line1: "10 Market Street" }),
        "place-dropoff": placePayload("place-dropoff", {
          line1: "20 Main Street",
          city: "Fredericksburg",
          postalCode: "22401",
        }),
      })
    );
    const rpcShipment = shipmentArgs(tampered, routed);

    expect(rpcShipment.p_pickup_address).toMatchObject({
      googlePlaceId: "place-pickup",
      formattedAddress: "10 Market Street, Stafford, VA 22554, USA",
      line1: "10 Market Street",
      city: "Stafford",
      region: "VA",
      postalCode: "22554",
      latitude: 38.422,
      longitude: -77.408,
      line2: "Suite 12",
      instructions: "Use loading dock",
    });
    expect(rpcShipment.p_pickup_address.formattedAddress).not.toContain("Forged");
    expect(routed.quote.quoteStatus).toBe("estimated");
  });
});

describe("conservative named-market serviceability", () => {
  it("contains exactly the four V0 auto-approved markets", () => {
    expect(COURANR_AUTO_APPROVED_MARKETS).toEqual([
      { city: "Washington", region: "DC", countryCode: "US" },
      { city: "Stafford", region: "VA", countryCode: "US" },
      { city: "Woodbridge", region: "VA", countryCode: "US" },
      { city: "Fredericksburg", region: "VA", countryCode: "US" },
    ]);
    for (const market of COURANR_AUTO_APPROVED_MARKETS) {
      expect(isCouranrAutoApprovedMarket(market)).toBe(true);
    }
  });

  it.each([
    ["surrounding Virginia", { city: "Alexandria", region: "VA", countryCode: "US" }],
    ["Maryland", { city: "Bethesda", region: "MD", countryCode: "US" }],
    ["out of region", { city: "Seattle", region: "WA", countryCode: "US" }],
  ])("keeps %s outside automatic serviceability", (_label, market) => {
    expect(isCouranrAutoApprovedMarket(market)).toBe(false);
  });

  it.each([
    ["surrounding-area", { city: "Alexandria", region: "VA", postalCode: "22314" }],
    ["Maryland", { city: "Bethesda", region: "MD", postalCode: "20814" }],
    ["out-of-region", { city: "Seattle", region: "WA", postalCode: "98101" }],
  ])("keeps a successful %s route and evidence as needs_review", async (_label, place) => {
    process.env.GOOGLE_MAPS_SERVER_API_KEY = "server-secret-test-key";
    const result = await deriveCanonicalRouteAndQuote(
      draft(),
      providerFetcher({
        "place-pickup": placePayload("place-pickup"),
        "place-dropoff": placePayload("place-dropoff", {
          line1: "100 King Street",
          ...place,
        }),
      })
    );

    expect(result.route).toMatchObject({
      serviceabilityOutcome: "needs_review",
      reviewReason: "market_needs_review",
      distanceMeters: 8047,
      loadedMiles: loadedMilesFromDistanceMeters(8047),
      durationSeconds: 600,
      staticDurationSeconds: 600,
      trafficDelaySeconds: 0,
    });
    expect(result.quote).toMatchObject({
      quoteStatus: "manual_review_required",
      deliverySubtotalCents: 0,
      lineItems: [],
      reviewReasons: ["route_needs_review"],
    });
  });
});

describe("server Routes authority", () => {
  it("uses only the server Mapbox token and derives loaded miles from distance", async () => {
    const fetcher = vi.fn(
      async (_input: string | URL | Request) => routeResponse(8047, 721.4)
    );
    const result = await computeCanonicalMapboxRoute(
      {
        pickupLatitude: 38.422,
        pickupLongitude: -77.408,
        dropoffLatitude: 38.3032,
        dropoffLongitude: -77.4605,
      },
      fetcher
    );

    expect(result).toEqual({
      serviceabilityOutcome: "available_for_request",
      distanceSource: "mapbox_directions_v5",
      distanceMeters: 8047,
      loadedMiles: loadedMilesFromDistanceMeters(8047),
      durationSeconds: 721,
      staticDurationSeconds: 721,
      trafficDelaySeconds: 0,
      reviewReason: null,
    });
    const [rawUrl] = fetcher.mock.calls[0]!;
    const url = new URL(String(rawUrl));
    expect(url.pathname).toContain("/directions/v5/mapbox/driving-traffic/");
    expect(url.searchParams.get("access_token")).toBe("test-mapbox-token");
  });

  it("re-estimates from a changed verified Place ID", async () => {
    process.env.GOOGLE_MAPS_SERVER_API_KEY = "server-secret-test-key";
    const fetcher = providerFetcher(
      {
        "place-pickup": placePayload("place-pickup"),
        "place-dropoff": placePayload("place-dropoff", { city: "Fredericksburg" }),
        "place-farther": placePayload("place-farther", {
          city: "Woodbridge",
          latitude: 38.9,
          longitude: -77.1,
        }),
      },
      (url) => routeResponse(url.pathname.includes("-77.1,38.9") ? 32187 : 8047)
    );
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
  });

  it("falls back to needs_review when Routes fails", async () => {
    process.env.GOOGLE_MAPS_SERVER_API_KEY = "server-secret-test-key";
    const fetcher = providerFetcher({
      "place-pickup": placePayload("place-pickup"),
      "place-dropoff": placePayload("place-dropoff", { city: "Fredericksburg" }),
    });
    fetcher.mockImplementation(async (input) => {
      if (String(input).includes("api.mapbox.com/directions/v5/mapbox/driving-traffic")) {
        return { ok: false, status: 503, json: async () => ({}) };
      }
      const placeId = decodeURIComponent(String(input).slice(String(input).lastIndexOf("/") + 1));
      const payload =
        placeId === "place-pickup"
          ? placePayload(placeId)
          : placePayload(placeId, { city: "Fredericksburg" });
      return { ok: true, status: 200, json: async () => payload };
    });

    const result = await deriveCanonicalRouteAndQuote(draft(), fetcher);
    expect(result.route).toMatchObject({
      serviceabilityOutcome: "needs_review",
      distanceMeters: null,
      loadedMiles: null,
      reviewReason: "mapbox_directions_unavailable",
    });
    expect(result.quote.quoteStatus).toBe("manual_review_required");
  });

  it("ignores malicious client mileage and prices the verified Mapbox route", async () => {
    process.env.GOOGLE_MAPS_SERVER_API_KEY = "server-secret-test-key";
    const tampered = draft({ loadedMiles: 9999, distanceMeters: 1 });
    const result = await deriveCanonicalRouteAndQuote(
      tampered,
      providerFetcher({
        "place-pickup": placePayload("place-pickup"),
        "place-dropoff": placePayload("place-dropoff", { city: "Fredericksburg" }),
      })
    );
    expect(result.route.loadedMiles).toBe(loadedMilesFromDistanceMeters(8047));
    expect(result.quote.quoteStatus).toBe("estimated");
    expect(result.quote.deliverySubtotalCents).toBeLessThan(100_000);
  });
});

describe("browser/server key boundary", () => {
  it("uses the public key only in the browser and the server key only in providers", () => {
    const browser = readFileSync(
      path.join(ROOT, "components/couranr/requests/BusinessPlaceAutocomplete.tsx"),
      "utf8"
    );
    const client = readFileSync(
      path.join(ROOT, "components/couranr/requests/client.ts"),
      "utf8"
    );
    const places = readFileSync(path.join(ROOT, "lib/couranr/routing/googlePlaces.ts"), "utf8");
    const routes = readFileSync(path.join(ROOT, "lib/couranr/routing/mapboxDirections.ts"), "utf8");
    const canonical = readFileSync(path.join(ROOT, "lib/couranr/routing/canonicalRoute.ts"), "utf8");
    // Browser code owns neither provider's server credential. Google verifies
    // address identity; Mapbox owns distance/traffic on the server.
    expect(browser + client).not.toContain("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY");
    expect(browser + client).not.toContain("GOOGLE_MAPS_SERVER_API_KEY");
    expect(browser + client).not.toContain("MAPBOX_ACCESS_TOKEN");
    expect(browser).toContain("searchBusinessPlaces");
    expect(browser).toContain("resolveBusinessPlace");
    expect(places).toContain("GOOGLE_MAPS_SERVER_API_KEY");
    expect(routes).toContain("MAPBOX_ACCESS_TOKEN");
    expect(routes).not.toContain("GOOGLE_MAPS_SERVER_API_KEY");
    expect(canonical).toContain("resolveCanonicalGooglePlace");
    expect(canonical).toContain("computeCanonicalMapboxRoute");
  });
});

/**
 * TRF-002 scheduled traffic — the canonical future departure instant reaches
 * Mapbox as depart_at, while route distance/duration remain server-owned.
 */
import { describe, expect, it } from "vitest";
import { computeCanonicalMapboxRoute } from "@/lib/couranr/routing/mapboxDirections";

function fakeDirectionsFetch(captured: { url?: string }) {
  return async (input: string | URL | Request) => {
    captured.url = String(input);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        code: "Ok",
        routes: [{ distance: 8047, duration: 900, duration_typical: 600 }],
      }),
    } as unknown as Response;
  };
}

const COORDS = {
  pickupLatitude: 38.422,
  pickupLongitude: -77.408,
  dropoffLatitude: 38.3032,
  dropoffLongitude: -77.4605,
};

describe("scheduled Mapbox depart_at", () => {
  it("an immediate route sends no depart_at and uses current traffic", async () => {
    process.env.MAPBOX_ACCESS_TOKEN = "test-token";
    const captured: { url?: string } = {};
    const r = await computeCanonicalMapboxRoute(
      COORDS,
      fakeDirectionsFetch(captured) as never
    );
    const url = new URL(captured.url!);
    expect(url.searchParams.get("depart_at")).toBeNull();
    expect(url.pathname).toContain("/directions/v5/mapbox/driving-traffic/");
    expect(r.trafficDelaySeconds).toBe(300);
    expect(r.distanceSource).toBe("mapbox_directions_v5");
  });

  it("a future canonical instant is sent verbatim as depart_at", async () => {
    process.env.MAPBOX_ACCESS_TOKEN = "test-token";
    const captured: { url?: string } = {};
    const departureAt = new Date(Date.now() + 24 * 3600 * 1000);
    await computeCanonicalMapboxRoute(
      { ...COORDS, departureAt },
      fakeDirectionsFetch(captured) as never
    );
    const url = new URL(captured.url!);
    expect(url.searchParams.get("depart_at")).toBe(departureAt.toISOString());
  });

  it("a past instant is never sent", async () => {
    process.env.MAPBOX_ACCESS_TOKEN = "test-token";
    const captured: { url?: string } = {};
    await computeCanonicalMapboxRoute(
      { ...COORDS, departureAt: new Date(Date.now() - 3600_000) },
      fakeDirectionsFetch(captured) as never
    );
    expect(new URL(captured.url!).searchParams.get("depart_at")).toBeNull();
  });

  it("traffic delay remains duration minus typical duration", async () => {
    process.env.MAPBOX_ACCESS_TOKEN = "test-token";
    const r = await computeCanonicalMapboxRoute(
      COORDS,
      fakeDirectionsFetch({}) as never
    );
    expect(r.durationSeconds).toBe(900);
    expect(r.staticDurationSeconds).toBe(600);
    expect(r.trafficDelaySeconds).toBe(300);
  });

  it("the route input accepts coordinates and canonical time, never browser mileage", async () => {
    process.env.MAPBOX_ACCESS_TOKEN = "test-token";
    const captured: { url?: string } = {};
    await computeCanonicalMapboxRoute(
      {
        ...COORDS,
        durationSeconds: 1,
        staticDurationSeconds: 1,
        trafficDelaySeconds: 0,
        loadedMiles: 0.1,
      } as never,
      fakeDirectionsFetch(captured) as never
    );
    const url = new URL(captured.url!);
    for (const k of [
      "durationSeconds",
      "staticDurationSeconds",
      "trafficDelaySeconds",
      "loadedMiles",
    ]) {
      expect(url.searchParams.get(k)).toBeNull();
    }
  });
});

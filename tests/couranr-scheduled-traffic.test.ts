/**
 * TRF-001 scheduled traffic — the canonical FUTURE departure instant reaches
 * Google's request as `departureTime`, DST-correct via America/New_York, and
 * no browser field exists that could supply any of it.
 */
import { describe, expect, it } from "vitest";
import { computeCanonicalGoogleRoute } from "@/lib/couranr/routing/googleRoutes";

function fakeRoutesFetch(captured: { body?: Record<string, unknown> }) {
  return async (_url: string | URL | Request, init?: RequestInit) => {
    captured.body = JSON.parse(String(init?.body));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        routes: [{ distanceMeters: 8047, duration: "900s", staticDuration: "600s" }],
      }),
    } as unknown as Response;
  };
}

const PLACES = { pickupPlaceId: "ChIJ-a", dropoffPlaceId: "ChIJ-b" };

describe("scheduled Google departureTime", () => {
  it("an immediate route sends NO departureTime — current conditions price it", async () => {
    process.env.GOOGLE_MAPS_SERVER_API_KEY = "test-key";
    const captured: { body?: Record<string, unknown> } = {};
    const r = await computeCanonicalGoogleRoute(PLACES, fakeRoutesFetch(captured) as never);
    expect(captured.body?.departureTime).toBeUndefined();
    expect(r.trafficDelaySeconds).toBe(300);
  });

  it("a FUTURE canonical instant is sent verbatim as RFC3339 departureTime", async () => {
    process.env.GOOGLE_MAPS_SERVER_API_KEY = "test-key";
    const captured: { body?: Record<string, unknown> } = {};
    const departureAt = new Date(Date.now() + 24 * 3600 * 1000);
    await computeCanonicalGoogleRoute(
      { ...PLACES, departureAt },
      fakeRoutesFetch(captured) as never
    );
    expect(captured.body?.departureTime).toBe(departureAt.toISOString());
    // The rest of the canonical request is unchanged by scheduling.
    expect(captured.body?.routingPreference).toBe("TRAFFIC_AWARE");
  });

  it("a PAST instant is never sent — a past request is a timing review, not a Google error", async () => {
    process.env.GOOGLE_MAPS_SERVER_API_KEY = "test-key";
    const captured: { body?: Record<string, unknown> } = {};
    await computeCanonicalGoogleRoute(
      { ...PLACES, departureAt: new Date(Date.now() - 3600 * 1000) },
      fakeRoutesFetch(captured) as never
    );
    expect(captured.body?.departureTime).toBeUndefined();
  });

  it("the traffic derivation is IDENTICAL for scheduled routes — duration minus staticDuration", async () => {
    process.env.GOOGLE_MAPS_SERVER_API_KEY = "test-key";
    const captured: { body?: Record<string, unknown> } = {};
    const r = await computeCanonicalGoogleRoute(
      { ...PLACES, departureAt: new Date(Date.now() + 3600 * 1000) },
      fakeRoutesFetch(captured) as never
    );
    expect(r.durationSeconds).toBe(900);
    expect(r.staticDurationSeconds).toBe(600);
    expect(r.trafficDelaySeconds).toBe(300);
  });

  it("the route input type has no duration, staticDuration, delay or mileage field a browser could fill", async () => {
    // Structural: the only accepted keys are the two Place IDs and the
    // server-derived instant. A payload smuggling browser traffic evidence has
    // nowhere to land.
    process.env.GOOGLE_MAPS_SERVER_API_KEY = "test-key";
    const captured: { body?: Record<string, unknown> } = {};
    await computeCanonicalGoogleRoute(
      {
        ...PLACES,
        durationSeconds: 1,
        staticDurationSeconds: 1,
        trafficDelaySeconds: 0,
        loadedMiles: 0.1,
      } as never,
      fakeRoutesFetch(captured) as never
    );
    expect(captured.body?.departureTime).toBeUndefined();
    for (const k of ["durationSeconds", "staticDurationSeconds", "trafficDelaySeconds", "loadedMiles"]) {
      expect(captured.body?.[k]).toBeUndefined();
    }
  });
});

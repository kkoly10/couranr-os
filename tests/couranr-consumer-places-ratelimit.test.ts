import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The consumer Places route claims the per-guest rate limit BEFORE any paid
 * provider call, returns a sanitized 429 when limited, and passes the
 * autocomplete `degraded` flag through. The guest gate stays first.
 */

const send = vi.hoisted(() => ({
  redeemGuestSessionToken: vi.fn(),
  claimConsumerPlaceSearch: vi.fn(),
  autocompleteConsumerPlaces: vi.fn(),
  isConsumerFailure: (r: { ok: boolean }) => r.ok === false,
}));
vi.mock("@/lib/couranr/consumer/send", () => send);

import { GET } from "@/app/api/couranr/consumer/places/route";

const req = (q = "main street") =>
  new NextRequest(`http://localhost/api/couranr/consumer/places?query=${encodeURIComponent(q)}`, {
    headers: { "x-couranr-guest": "tok" },
  });

const okSession = { ok: true, value: { id: "sess-1", requestId: null, expiresAt: "" } };

afterEach(() => vi.clearAllMocks());

describe("consumer Places route — rate limit before the paid provider", () => {
  it("a rate-limited session gets 429 and NO provider call is made", async () => {
    send.redeemGuestSessionToken.mockResolvedValue(okSession);
    send.claimConsumerPlaceSearch.mockResolvedValue({
      ok: false,
      code: "rate_limited",
      correlationId: "cid",
      message: "Too many address searches. Wait a little and try again.",
    });

    const res = await GET(req());
    expect(res.status).toBe(429);
    // THE INVARIANT: the paid autocomplete was never reached.
    expect(send.autocompleteConsumerPlaces).not.toHaveBeenCalled();
  });

  it("an allowed session reaches the provider and passes `degraded` through", async () => {
    send.redeemGuestSessionToken.mockResolvedValue(okSession);
    send.claimConsumerPlaceSearch.mockResolvedValue({ ok: true, value: { allowed: true } });
    send.autocompleteConsumerPlaces.mockResolvedValue({
      ok: true,
      value: { suggestions: [{ placeId: "p", text: "t" }], degraded: false },
    });

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ suggestions: [{ placeId: "p", text: "t" }], degraded: false });
    // Ordering: the throttle was claimed before the provider call.
    const throttleOrder = send.claimConsumerPlaceSearch.mock.invocationCallOrder[0];
    const providerOrder = send.autocompleteConsumerPlaces.mock.invocationCallOrder[0];
    expect(throttleOrder).toBeLessThan(providerOrder);
  });

  it("a provider outage surfaces as degraded=true with an empty list, not a 500", async () => {
    send.redeemGuestSessionToken.mockResolvedValue(okSession);
    send.claimConsumerPlaceSearch.mockResolvedValue({ ok: true, value: { allowed: true } });
    send.autocompleteConsumerPlaces.mockResolvedValue({
      ok: true,
      value: { suggestions: [], degraded: true },
    });

    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ suggestions: [], degraded: true });
  });

  it("a bad guest token is a uniform 404 and never claims the limit or calls the provider", async () => {
    send.redeemGuestSessionToken.mockResolvedValue({ ok: false, code: "not_found", correlationId: "c" });

    const res = await GET(req());
    expect(res.status).toBe(404);
    expect(send.claimConsumerPlaceSearch).not.toHaveBeenCalled();
    expect(send.autocompleteConsumerPlaces).not.toHaveBeenCalled();
  });
});

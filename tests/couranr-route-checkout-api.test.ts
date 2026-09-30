import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  actor: vi.fn(), member: vi.fn(), may: vi.fn(), read: vi.fn(), begin: vi.fn(),
  advance: vi.fn(), ready: vi.fn(),
}));
vi.mock("@/lib/couranr/requests/actor", () => ({
  resolveRequestActor: mocks.actor,
  isActorDenied: (value: { ok: boolean }) => value.ok === false,
}));
vi.mock("@/lib/couranr/settings/commands", () => ({ settingsActorFrom: mocks.member }));
vi.mock("@/lib/couranr/settings/permissions", () => ({ memberMay: mocks.may }));
vi.mock("@/lib/couranr/routeRuns/settlement", () => ({ beginRouteCheckout: mocks.begin }));
vi.mock("@/lib/couranr/routeRuns/progress", () => ({
  readRouteProgress: mocks.read, advanceRouteRun: mocks.advance,
  confirmRoutePickupReady: mocks.ready,
}));

import { GET, POST } from "@/app/api/couranr/merchant/route-runs/checkout/route";

const businessAccountId = "11111111-1111-4111-8111-111111111111";
const routeRunId = "22222222-2222-4222-8222-222222222222";
const actorUserId = "33333333-3333-4333-8333-333333333333";
const idempotencyKey = "44444444-4444-4444-8444-444444444444";
const endpoint = "http://localhost/api/couranr/merchant/route-runs/checkout";
const body = (input: Record<string, unknown>) => new NextRequest(endpoint, {
  method: "POST", body: JSON.stringify({ businessAccountId, routeRunId, ...input }),
});

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "development");
  vi.clearAllMocks();
  mocks.actor.mockResolvedValue({ ok: true, userId: actorUserId });
  mocks.member.mockReturnValue({ role: "owner" });
  mocks.may.mockReturnValue(true);
  mocks.read.mockResolvedValue({ ok: true, value: null });
  mocks.begin.mockResolvedValue({ ok: true, value: {} });
  mocks.advance.mockResolvedValue({ ok: true, value: { next: "continue" } });
  mocks.ready.mockResolvedValue({ ok: true, value: { next: "continue" } });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("RR-003 checkout HTTP authority", () => {
  it("reads a private server projection without starting checkout", async () => {
    const response = await GET(new NextRequest(`${endpoint}?businessAccountId=${businessAccountId}&routeRunId=${routeRunId}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.read).toHaveBeenCalledWith({ businessAccountId, routeRunId, actorUserId });
    expect(mocks.begin).not.toHaveBeenCalled();
  });

  it("never starts production money while physical Route execution is absent", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const read = await GET(new NextRequest(`${endpoint}?businessAccountId=${businessAccountId}&routeRunId=${routeRunId}`));
    expect((await read.json()).checkoutAvailable).toBe(false);
    const response = await POST(body({ action: "begin", expectedVersion: 1, idempotencyKey }));
    expect(response.status).toBe(409);
    expect(mocks.begin).not.toHaveBeenCalled();
    expect(mocks.advance).not.toHaveBeenCalled();
  });

  it("requires owner/manager authority for the explicit checkout confirmation", async () => {
    mocks.may.mockReturnValue(false);
    const response = await POST(body({ action: "begin", expectedVersion: 1, idempotencyKey }));
    expect(response.status).toBe(403);
    expect(mocks.begin).not.toHaveBeenCalled();
    expect(mocks.advance).not.toHaveBeenCalled();
  });

  it("binds checkout to the displayed accepted generation and retry key", async () => {
    const response = await POST(body({ action: "begin", expectedVersion: 2, idempotencyKey }));
    expect(response.status).toBe(200);
    expect(mocks.begin).toHaveBeenCalledWith({ businessAccountId, routeRunId,
      actorUserId, expectedVersion: 2, idempotencyKey });
  });

  it("advances without accepting a browser child, price, card, or provider result", async () => {
    for (const extra of [{ amountCents: 1 }, { obligationId: actorUserId },
      { paymentIntentId: "pi_forged" }, { driverId: actorUserId }, { cardLast4: "1234" }]) {
      const response = await POST(body({ action: "advance", ...extra }));
      expect(response.status).toBe(400);
    }
    expect(mocks.advance).not.toHaveBeenCalled();
    expect((await POST(body({ action: "advance" }))).status).toBe(200);
    expect(mocks.advance).toHaveBeenCalledWith({ businessAccountId, routeRunId, actorUserId });
  });

  it("requires an exact accepted generation for pickup readiness", async () => {
    expect((await POST(body({ action: "confirm_pickup_ready" }))).status).toBe(400);
    expect((await POST(body({ action: "confirm_pickup_ready", expectedVersion: 1 }))).status).toBe(200);
    expect(mocks.ready).toHaveBeenCalledWith({ businessAccountId, routeRunId,
      actorUserId, expectedVersion: 1 });
  });

  it("refuses unauthenticated access before reading or calling a provider seam", async () => {
    mocks.actor.mockResolvedValue({ ok: false, code: "unauthenticated", error: "Sign in." });
    expect((await POST(body({ action: "advance" }))).status).toBe(401);
    expect(mocks.advance).not.toHaveBeenCalled();
  });
});

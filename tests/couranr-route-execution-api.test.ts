import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  user: vi.fn(), actor: vi.fn(), readDriver: vi.fn(), commandDriver: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@/lib/couranr/requests/actor", () => ({
  resolveUserId: mocks.user,
  resolveRequestActor: mocks.actor,
  isActorDenied: (value: { ok: boolean }) => value.ok === false,
}));
vi.mock("@/lib/couranr/routeRuns/execution", () => ({
  readDriverRouteTask: mocks.readDriver,
  commandDriverRouteTask: mocks.commandDriver,
}));
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: { rpc: mocks.rpc } }));

import { GET as driverGet, POST as driverPost } from
  "@/app/api/couranr/driver/route-run/route";
import { GET as operationsGet, POST as operationsPost } from
  "@/app/api/couranr/operations/route-execution/route";

const routeRunId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const driverUrl = "http://localhost/api/couranr/driver/route-run";
const operationsUrl = "http://localhost/api/couranr/operations/route-execution";
const post = (url: string, body: Record<string, unknown>) => new NextRequest(url, {
  method: "POST", body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ ok: true, userId });
  mocks.actor.mockResolvedValue({ ok: true, userId,
    actor: { kind: "operations", userId } });
  mocks.readDriver.mockResolvedValue({ ok: true, value: null });
  mocks.commandDriver.mockResolvedValue({ ok: true, value: { routeRunId } });
  mocks.rpc.mockResolvedValue({ data: { outcome: "return_now" }, error: null });
});

describe("RR-004 driver and Operations HTTP authority", () => {
  it("reads a driver task privately and never offers another driver's Route", async () => {
    const response = await driverGet(new NextRequest(driverUrl));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ task: null });
    expect(mocks.readDriver).toHaveBeenCalledWith(userId, undefined);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a forged state, driver, child, or money field before any Route command", async () => {
    for (const extra of [{ driverId: userId }, { deliveryId: routeRunId },
      { amountCents: 1 }, { state: "completed" }]) {
      const response = await driverPost(post(driverUrl, {
        routeRunId, action: "depart_pickup", ...extra,
      }));
      expect(response.status).toBe(400);
    }
    expect(mocks.commandDriver).not.toHaveBeenCalled();
  });

  it("requires bounded GPS only for common pickup arrival", async () => {
    expect((await driverPost(post(driverUrl, {
      routeRunId, action: "arrive_pickup", latitude: 100, longitude: -77,
    }))).status).toBe(400);
    expect((await driverPost(post(driverUrl, {
      routeRunId, action: "depart_pickup", latitude: 38.3,
    }))).status).toBe(400);
    const response = await driverPost(post(driverUrl, {
      routeRunId, action: "arrive_pickup", latitude: 38.3,
      longitude: -77.4, accuracyM: 9,
    }));
    expect(response.status).toBe(200);
    expect(mocks.commandDriver).toHaveBeenCalledWith({
      userId, routeRunId, action: "arrive_pickup",
      location: { latitude: 38.3, longitude: -77.4, accuracyM: 9 },
    });
  });

  it("denies an unauthenticated Route driver command", async () => {
    mocks.user.mockResolvedValue({ ok: false, code: "unauthenticated", error: "Sign in." });
    expect((await driverPost(post(driverUrl, {
      routeRunId, action: "advance_stop",
    }))).status).toBe(401);
    expect(mocks.commandDriver).not.toHaveBeenCalled();
  });

  it("does not give a non-Operations actor Route exception authority", async () => {
    mocks.actor.mockResolvedValue({ ok: true, userId,
      actor: { kind: "member", userId } });
    expect((await operationsPost(post(operationsUrl, {
      routeRunId, resolution: "return_now",
    }))).status).toBe(403);
    expect((await operationsGet(new NextRequest(`${operationsUrl}?requestId=${routeRunId}`))).status)
      .toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("lets Operations choose only a governed physical decision, never money or custody", async () => {
    for (const extra of [{ refundCents: 1 }, { driverId: userId },
      { childState: "delivered" }]) {
      expect((await operationsPost(post(operationsUrl, {
        routeRunId, resolution: "return_now", ...extra,
      }))).status).toBe(400);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect((await operationsPost(post(operationsUrl, {
      routeRunId, resolution: "continue_later_stops",
    }))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("couranr_resolve_route_run_exception", {
      p_route_run_id: routeRunId, p_actor_user_id: userId,
      p_resolution: "continue_later_stops",
    });
  });

  it("turns a changed exception into a generic conflict, not a database leak", async () => {
    mocks.rpc.mockResolvedValue({ data: null,
      error: { message: "secret SQL constraint detail" } });
    const response = await operationsPost(post(operationsUrl, {
      routeRunId, resolution: "return_now",
    }));
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).not.toContain("secret SQL constraint detail");
  });
});

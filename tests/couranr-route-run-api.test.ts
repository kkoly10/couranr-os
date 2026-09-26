import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const { rpc, resolveActor } = vi.hoisted(() => ({ rpc: vi.fn(), resolveActor: vi.fn() }));
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: { rpc } }));
vi.mock("@/lib/couranr/requests/actor", () => ({ resolveRequestActor: resolveActor, isActorDenied: (r: { ok: boolean }) => r.ok === false }));
import { GET, POST } from "@/app/api/couranr/merchant/route-runs/route";
const BIZ = "11111111-1111-4111-8111-111111111111";
const ROUTE = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";
const IDS = ["44444444-4444-4444-8444-444444444444", "55555555-5555-4555-8555-555555555555"];
const endpoint = `http://localhost/api/couranr/merchant/route-runs?businessAccountId=${BIZ}&routeRunId=${ROUTE}`;
const draft = () => ({ routeRunId: ROUTE, businessAccountId: BIZ, state: "draft", title: "Afternoon route", version: 1, currentVersion: 1,
  draftOnly: true, bookingAvailable: false, stopCount: 2, referenceQuoteTotalCents: 3000,
  quoteBasis: "independent_delivery_quotes_not_a_route_offer",
  stops: IDS.map((requestId, index) => ({ sequence: index + 1, requestId, quoteVersionId: requestId, requestVersion: 1, pickupManifestVersion: 0, stale: false })) });
const saveRequest = (patch: Record<string, unknown> = {}) => new NextRequest(endpoint, { method: "POST", body: JSON.stringify({
  routeRunId: ROUTE, expectedVersion: 0, idempotencyKey: ACTOR, title: "Afternoon route", requestIds: IDS, ...patch,
}) });
beforeEach(() => {
  vi.clearAllMocks();
  resolveActor.mockResolvedValue({ ok: true, userId: ACTOR, actor: { kind: "member", userId: ACTOR } });
  rpc.mockResolvedValue({ data: draft(), error: null });
});
describe("Route Run HTTP safety and exact command identity", () => {
  it("runs the named SQL read with the authenticated identity and disables caching", async () => {
    const response = await GET(new NextRequest(endpoint));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(rpc).toHaveBeenCalledWith("couranr_read_route_run_draft", { p_business_account_id: BIZ, p_actor_user_id: ACTOR, p_route_run_id: ROUTE });
  });
  it("sends validated, ordered, price-free data to the named write", async () => {
    expect((await POST(saveRequest())).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("couranr_save_route_run_draft", expect.objectContaining({
      p_actor_user_id: ACTOR, p_request_ids: IDS, p_expected_version: 0,
    }));
  });
  it("refuses a posted driver, price or target state before storage", async () => {
    for (const extra of [{ driverId: ACTOR }, { price: 1 }, { state: "assigned" }]) {
      expect((await POST(saveRequest(extra))).status).toBe(400);
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses an unauthenticated caller before any query", async () => {
    resolveActor.mockResolvedValue({ ok: false, code: "unauthenticated", error: "Sign in." });
    expect((await GET(new NextRequest(endpoint))).status).toBe(401);
    expect((await POST(saveRequest())).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("SQL tenant rejection remains 403, not empty success", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "CR403", message: "route_business_access_denied" } });
    expect((await GET(new NextRequest(endpoint))).status).toBe(403);
  });
  it.each(["foreign PII secret token", "toString", "constructor", "__proto__"])("never forwards unknown database text %s", async (message) => {
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message, details: "private value" } });
    const response = await POST(saveRequest());
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.correlationId).toMatch(/^cr_/);
    expect(JSON.stringify(body)).not.toContain(message);
    expect(JSON.stringify(body)).not.toContain("private value");
  });
  it("catches storage transport throws without leaking their message", async () => {
    rpc.mockRejectedValue(new Error("private storage connection details"));
    const response = await GET(new NextRequest(endpoint));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("connection details");
  });
  it.each([null, [], {}, { ...draft(), bookingAvailable: true }, { ...draft(), businessAccountId: ACTOR }, { ...draft(), stops: [] }])(
    "fails closed on malformed/wrong-tenant success %#", async (data) => {
      rpc.mockResolvedValue({ data, error: null });
      expect((await GET(new NextRequest(endpoint))).status).toBe(500);
    }
  );
  it("drops unrecognized success fields instead of spreading raw RPC data", async () => {
    const data = draft();
    rpc.mockResolvedValue({ data: { ...data, trackingToken: "DO-NOT-EXPOSE", stops: data.stops.map((s) => ({ ...s, pin: "PRIVATE" })) }, error: null });
    const response = await GET(new NextRequest(endpoint));
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toContain("DO-NOT-EXPOSE");
    expect(body).not.toContain("PRIVATE");
  });
  it("rejects oversized and malformed input before storage", async () => {
    for (const body of ["{" , "x".repeat(4097)]) {
      expect((await POST(new NextRequest(endpoint, { method: "POST", body }))).status).toBe(400);
    }
    expect(rpc).not.toHaveBeenCalled();
  });
});

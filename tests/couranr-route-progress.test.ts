import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RouteSettlementView } from "@/lib/couranr/routeRuns/types";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(), read: vi.fn(), authorize: vi.fn(), release: vi.fn(),
  route: vi.fn(), capture: vi.fn(), reconcileCapture: vi.fn(),
}));
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: { rpc: mocks.rpc, from: mocks.from } }));
vi.mock("@/lib/couranr/routeRuns/settlement", () => ({
  readRouteSettlement: mocks.read,
  authorizeNextRouteChild: mocks.authorize,
  releaseKnownRouteHolds: mocks.release,
}));
vi.mock("@/lib/couranr/routeRuns/commands", () => ({ readRouteDraft: mocks.route }));
vi.mock("@/lib/couranr/fulfillment/commands", () => ({
  capturePaymentForRoute: mocks.capture,
  reconcileRouteChildCapture: mocks.reconcileCapture,
  isFulfillmentFailure: (value: { ok: boolean }) => value.ok === false,
}));

import {
  advanceRouteRun, confirmRoutePickupReady, runRouteCheckoutMaintenance,
} from "@/lib/couranr/routeRuns/progress";

const businessAccountId = "11111111-1111-4111-8111-111111111111";
const actorUserId = "22222222-2222-4222-8222-222222222222";
const routeRunId = "33333333-3333-4333-8333-333333333333";
const params = { businessAccountId, actorUserId, routeRunId };
const item = (sequence: number, paymentState = "authorized", deliveryId: string | null = null) => ({
  sequence,
  requestId: `44444444-4444-4444-8444-44444444444${sequence}`,
  quoteVersionId: `55555555-5555-4555-8555-55555555555${sequence}`,
  obligationId: `66666666-6666-4666-8666-66666666666${sequence}`,
  amountCents: 2000, paymentState, deliveryId, obligationVersion: 2,
});
const settlement = (state: string, pickupReadyConfirmed = false,
  items = [item(1), item(2)]): RouteSettlementView => ({
  settlementId: "77777777-7777-4777-8777-777777777777",
  routeRunId, state, version: 1, referenceTotalCents: 4000,
  currency: "usd", card: { brand: "visa", last4: "4242" },
  pickupReadyConfirmed, uncertainObligationId: null, items,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: {}, error: null });
  mocks.route.mockResolvedValue({ ok: true, value: { state: "accepted", acceptedVersion: 1 } });
  mocks.capture.mockResolvedValue({ ok: true, value: { outcome: "captured" } });
  mocks.reconcileCapture.mockResolvedValue({ ok: true, value: { outcome: "pending" } });
});

describe("RR-003 server-owned checkout progression", () => {
  it("does not reserve a resource or capture before explicit pickup readiness", async () => {
    mocks.read.mockResolvedValue({ ok: true, value: settlement("authorized") });
    const result = await advanceRouteRun(params);
    expect(result.ok && result.value.next).toBe("confirm_pickup_ready");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("couranr_expire_route_run_checkout",
      { p_route_run_id: routeRunId });
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("reserves only after the server sees the durable pickup attestation", async () => {
    mocks.read.mockResolvedValueOnce({ ok: true, value: settlement("authorized", true) })
      .mockResolvedValueOnce({ ok: true, value: settlement("authorized", true) })
      .mockResolvedValueOnce({ ok: true, value: settlement("resource_reserved", true) });
    const result = await advanceRouteRun(params);
    expect(result.ok && result.value.settlement.state).toBe("resource_reserved");
    expect(mocks.rpc).toHaveBeenCalledWith("couranr_reserve_route_run_resource", {
      p_business_account_id: businessAccountId, p_actor_user_id: actorUserId,
      p_route_run_id: routeRunId,
    });
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("releases known holds when no compatible Route resource is available", async () => {
    mocks.read.mockResolvedValueOnce({ ok: true, value: settlement("authorized", true) })
      .mockResolvedValueOnce({ ok: true, value: settlement("authorized", true) })
      .mockResolvedValueOnce({ ok: true, value: settlement("recovery_required", true) });
    mocks.release.mockResolvedValue({ ok: true, value: settlement("authorization_failed", true) });
    const result = await advanceRouteRun(params);
    expect(result.ok && result.value.next).toBe("operations_review");
    expect(mocks.release).toHaveBeenCalledWith(params);
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("can resume planning and the capture gate after a lost reservation response", async () => {
    mocks.read.mockResolvedValueOnce({ ok: true, value: settlement("resource_reserved", true) })
      .mockResolvedValueOnce({ ok: true, value: settlement("resource_reserved", true) })
      .mockResolvedValueOnce({ ok: true, value: settlement("capture_pending", true) });
    const result = await advanceRouteRun(params);
    expect(result.ok && result.value.settlement.state).toBe("capture_pending");
    expect(mocks.rpc.mock.calls.map((call) => call[0])).toEqual([
      "couranr_expire_route_run_checkout", "couranr_confirm_route_service_plans",
      "couranr_begin_route_run_capture",
    ]);
    expect(mocks.rpc.mock.calls[2][1].p_expected_version).toBe(1);
  });

  it("expires an abandoned authorized checkout then releases only verified holds", async () => {
    mocks.read.mockResolvedValueOnce({ ok: true, value: settlement("authorized") })
      .mockResolvedValueOnce({ ok: true, value: settlement("recovery_required") });
    mocks.release.mockResolvedValue({ ok: true, value: settlement("authorization_failed") });
    const result = await advanceRouteRun(params);
    expect(result.ok && result.value.next).toBe("operations_review");
    expect(mocks.release).toHaveBeenCalledWith(params);
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("re-reads the provider instead of recapturing an in-flight child", async () => {
    mocks.read.mockResolvedValue({ ok: true,
      value: settlement("capture_pending", true, [item(1, "capture_pending"), item(2)]) });
    const result = await advanceRouteRun(params);
    expect(result.ok && result.value.next).toBe("operations_review");
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.reconcileCapture).toHaveBeenCalledWith(expect.objectContaining({
      requestId: item(1).requestId, obligationId: item(1).obligationId,
    }));
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("retries conversion of captured money without authorizing or capturing again", async () => {
    mocks.read.mockResolvedValueOnce({ ok: true,
      value: settlement("capture_pending", true, [item(1, "captured"), item(2)]) })
      .mockResolvedValueOnce({ ok: true,
        value: settlement("capture_pending", true, [
          item(1, "captured", "88888888-8888-4888-8888-888888888888"), item(2),
        ]) });
    const result = await advanceRouteRun(params);
    expect(result.ok).toBe(true);
    expect(mocks.capture).toHaveBeenCalledWith(expect.objectContaining({
      requestId: item(1).requestId, obligationId: item(1).obligationId,
    }));
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("declares readiness only through the exact-child funding command", async () => {
    const delivered = [item(1, "captured", "88888888-8888-4888-8888-888888888881"),
      item(2, "captured", "88888888-8888-4888-8888-888888888882")];
    mocks.read.mockResolvedValueOnce({ ok: true, value: settlement("capture_pending", true, delivered) })
      .mockResolvedValueOnce({ ok: true, value: settlement("ready_for_execution", true, delivered) });
    const result = await advanceRouteRun(params);
    expect(result.ok && result.value.next).toBe("ready");
    expect(mocks.rpc).toHaveBeenCalledWith("couranr_complete_route_run_funding", {
      p_business_account_id: businessAccountId, p_actor_user_id: actorUserId,
      p_route_run_id: routeRunId,
    });
  });

  it("returns only the existing child action secret for SCA", async () => {
    const current = settlement("authorization_required");
    mocks.read.mockResolvedValue({ ok: true, value: current });
    mocks.authorize.mockResolvedValue({ ok: true,
      value: { settlement: current, actionClientSecret: "pi_existing_secret_action" } });
    const result = await advanceRouteRun(params);
    expect(result.ok && result.value.next).toBe("authenticate_card");
    expect(result.ok && result.value.actionClientSecret).toBe("pi_existing_secret_action");
    expect(mocks.rpc).toHaveBeenCalledWith("couranr_expire_route_run_checkout",
      { p_route_run_id: routeRunId });
  });

  it("requires an explicit acknowledgement and exact accepted Route generation", async () => {
    mocks.read.mockResolvedValueOnce({ ok: true, value: settlement("authorized") })
      .mockResolvedValueOnce({ ok: true, value: settlement("authorized", true) });
    const result = await confirmRoutePickupReady({ ...params, expectedVersion: 3 });
    expect(result.ok).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("couranr_confirm_route_pickup_ready", {
      p_business_account_id: businessAccountId, p_actor_user_id: actorUserId,
      p_route_run_id: routeRunId, p_expected_version: 3, p_acknowledged: true,
    });
  });

  it("cron resumes only existing checkout under an active owner, without inventing an amount", async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === "couranr_claim_route_checkout_maintenance"
      ? { data: [{ route_run_id: routeRunId, business_account_id: businessAccountId }], error: null }
      : { data: {}, error: null });
    mocks.from.mockImplementation((table: string) => {
      const query: any = {
        select: () => query, in: () => query, order: () => query,
        eq: () => query,
        limit: () => query,
        maybeSingle: async () => ({ data: { user_id: actorUserId }, error: null }),
      };
      expect(table).toBe("business_members");
      return query;
    });
    mocks.read.mockResolvedValue({ ok: true, value: settlement("authorized") });
    const result = await runRouteCheckoutMaintenance();
    expect(result).toEqual({ considered: 1, advanced: 1, attention: 0 });
    expect(mocks.authorize).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("couranr_expire_route_run_checkout",
      { p_route_run_id: routeRunId });
    expect(mocks.rpc).toHaveBeenCalledWith("couranr_claim_route_checkout_maintenance", { p_limit: 2 });
  });
});

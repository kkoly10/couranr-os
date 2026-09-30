import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  capture: vi.fn(),
  retrieve: vi.fn(),
}));
vi.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: { rpc: mocks.rpc, from: mocks.from },
}));
vi.mock("@/lib/stripeClient", () => ({
  getStripeClient: () => ({ paymentIntents: { capture: mocks.capture, retrieve: mocks.retrieve } }),
}));

import { capturePaymentForRoute, reconcileRouteChildCapture } from "@/lib/couranr/fulfillment/commands";
import { captureIdempotencyKey } from "@/lib/couranr/payments/states";

const routeRunId = "11111111-1111-4111-8111-111111111111";
const businessAccountId = "22222222-2222-4222-8222-222222222222";
const actorUserId = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";
const obligationId = "55555555-5555-4555-8555-555555555555";
const quoteVersionId = "77777777-7777-4777-8777-777777777777";
const deliveryId = "66666666-6666-4666-8666-666666666666";
const params = { routeRunId, businessAccountId, actorUserId, requestId, obligationId };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.from.mockImplementation((table: string) => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      neq: () => chain,
      maybeSingle: async () => ({ data: null, error: null }),
      limit: async () => ({
        data: table === "couranr_delivery_requests" ? [{ proof_method: "photo_or_pin" }] : [],
        error: null,
      }),
    };
    return chain;
  });
  mocks.rpc.mockImplementation(async (fn: string) => {
    if (fn === "couranr_read_route_run_settlement") return {
      data: { items: [{ requestId, obligationId }] }, error: null,
    };
    if (fn === "couranr_begin_route_child_capture") return {
      data: { id: obligationId, request_id: requestId, payment_state: "capture_pending",
        version: 2, provider_payment_intent_id: "pi_RouteChild" }, error: null,
    };
    if (fn === "couranr_complete_payment_capture") return {
      data: { outcome: "applied", payment_state: "captured" }, error: null,
    };
    if (fn === "couranr_create_delivery_from_capture") return {
      data: { id: deliveryId }, error: null,
    };
    return { data: null, error: { code: "XX000", message: "unexpected RPC" } };
  });
  mocks.capture.mockResolvedValue({
    id: "pi_RouteChild", status: "succeeded", amount_received: 2000, currency: "usd",
  });
  mocks.retrieve.mockResolvedValue({
    id: "pi_RouteChild", status: "succeeded", amount_received: 2000, currency: "usd",
  });
});

describe("RR-003 Route child capture provider seam", () => {
  it("uses Route SQL admission then the existing canonical provider capture and conversion", async () => {
    const result = await capturePaymentForRoute(params);
    expect(result).toEqual({ ok: true, value: {
      outcome: "captured", obligationId, paymentState: "captured", deliveryId,
    } });
    expect(mocks.rpc).toHaveBeenCalledWith("couranr_begin_route_child_capture", {
      p_business_account_id: businessAccountId,
      p_actor_user_id: actorUserId,
      p_route_run_id: routeRunId,
      p_obligation_id: obligationId,
    });
    expect(mocks.capture).toHaveBeenCalledWith("pi_RouteChild", undefined, {
      idempotencyKey: captureIdempotencyKey(obligationId, 2),
    });
    expect(mocks.rpc).toHaveBeenCalledWith("couranr_complete_payment_capture",
      expect.objectContaining({ p_obligation_id: obligationId, p_intent_status: "succeeded" }));
    expect(mocks.rpc).toHaveBeenCalledWith("couranr_create_delivery_from_capture",
      { p_request_id: requestId });
  });

  it("leaves the obligation capture_pending after ambiguous provider failure", async () => {
    mocks.capture.mockRejectedValue(new Error("provider timeout"));
    const result = await capturePaymentForRoute(params);
    expect(result.ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalledWith("couranr_complete_payment_capture", expect.anything());
    expect(mocks.rpc).not.toHaveBeenCalledWith("couranr_create_delivery_from_capture", expect.anything());
  });

  it("converts a captured Route child after a lost response without capturing twice", async () => {
    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn === "couranr_read_route_run_settlement") return {
        data: { items: [{ requestId, obligationId, paymentState: "captured" }] }, error: null,
      };
      if (fn === "couranr_create_delivery_from_capture") return {
        data: { id: deliveryId }, error: null,
      };
      return { data: null, error: { code: "XX000", message: "unexpected RPC" } };
    });
    const result = await capturePaymentForRoute(params);
    expect(result).toEqual({ ok: true, value: {
      outcome: "captured", obligationId, paymentState: "captured", deliveryId,
    } });
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalledWith("couranr_begin_route_child_capture", expect.anything());
  });

  it("never calls Stripe for a request outside the accepted Route settlement", async () => {
    const result = await capturePaymentForRoute({ ...params,
      requestId: "77777777-7777-4777-8777-777777777777" });
    expect(result.ok).toBe(false);
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalledWith("couranr_begin_route_child_capture", expect.anything());
  });

  it("reconciles a lost capture response by provider READ, never a second capture", async () => {
    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn === "couranr_read_route_run_settlement") return {
        data: { state: "capture_pending", items: [{
          requestId, obligationId, quoteVersionId, paymentState: "capture_pending",
        }] }, error: null,
      };
      if (fn === "couranr_complete_payment_capture") return {
        data: { outcome: "applied", payment_state: "captured" }, error: null,
      };
      if (fn === "couranr_create_delivery_from_capture") return {
        data: { id: deliveryId }, error: null,
      };
      return { data: null, error: { code: "XX000", message: "unexpected RPC" } };
    });
    mocks.from.mockImplementation((table: string) => {
      const chain: any = {
        select: () => chain, eq: () => chain, neq: () => chain,
        maybeSingle: async () => ({
          data: table === "couranr_payment_obligations" ? {
            id: obligationId, request_id: requestId, quote_version_id: quoteVersionId,
            payment_state: "capture_pending", provider_payment_intent_id: "pi_RouteChild",
            version: 2,
          } : null,
          error: null,
        }),
        limit: async () => ({ data: [], error: null }),
      };
      return chain;
    });
    const result = await reconcileRouteChildCapture(params);
    expect(result.ok).toBe(true);
    expect(mocks.retrieve).toHaveBeenCalledWith("pi_RouteChild");
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("couranr_complete_payment_capture",
      expect.objectContaining({ p_obligation_id: obligationId, p_intent_status: "succeeded" }));
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  methodRetrieve: vi.fn(),
  intentCreate: vi.fn(),
  intentRetrieve: vi.fn(),
  intentCancel: vi.fn(),
  from: vi.fn(),
  apply: vi.fn(),
}));
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: { rpc: mocks.rpc, from: mocks.from } }));
vi.mock("@/lib/stripeClient", () => ({ stripe: {
  paymentMethods: { retrieve: mocks.methodRetrieve },
  paymentIntents: { create: mocks.intentCreate, retrieve: mocks.intentRetrieve,
    cancel: mocks.intentCancel },
} }));
vi.mock("@/lib/couranr/payments/commands", () => ({
  applyVerifiedIntentState: mocks.apply,
  isPaymentFailure: (r: { ok: boolean }) => r.ok === false,
}));

import { authorizeNextRouteChild, beginRouteCheckout, releaseKnownRouteHolds } from "@/lib/couranr/routeRuns/settlement";

const business = "11111111-1111-4111-8111-111111111111";
const actor = "22222222-2222-4222-8222-222222222222";
const route = "33333333-3333-4333-8333-333333333333";
const settlementId = "44444444-4444-4444-8444-444444444444";
const requestA = "55555555-5555-4555-8555-555555555555";
const requestB = "66666666-6666-4666-8666-666666666666";
const quoteA = "77777777-7777-4777-8777-777777777777";
const quoteB = "88888888-8888-4888-8888-888888888888";
const obligationA = "99999999-9999-4999-8999-999999999999";
const obligationB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const params = { businessAccountId: business, actorUserId: actor, routeRunId: route };
const itemA = { sequence: 1, requestId: requestA, quoteVersionId: quoteA,
  obligationId: obligationA, amountCents: 1800, currency: "usd", paymentState: "not_started",
  deliveryId: null,
  obligationVersion: 1 };
const itemB = { sequence: 2, requestId: requestB, quoteVersionId: quoteB,
  obligationId: obligationB, amountCents: 2200, currency: "usd", paymentState: "not_started",
  deliveryId: null,
  obligationVersion: 1 };
const baseView = {
  settlementId, routeRunId: route, businessAccountId: business,
  state: "pending_authorization", version: 1, confirmedAt: new Date().toISOString(),
  referenceTotalCents: 4000, currency: "usd",
  card: { brand: "visa", last4: "4242" },
  pickupReadyConfirmed: false,
  uncertainObligationId: null,
  items: [itemA, itemB],
};
const attempt = {
  outcome: "attempt_ready", reconcilingUnknown: false, settlementId,
  obligationId: obligationA, requestId: requestA, quoteVersionId: quoteA,
  sequence: 1, amountCents: 1800, currency: "usd", payerType: "merchant",
  pricingPolicyVersion: "couranr-pricing-v2-2026-09-01",
  requestVersion: 2, obligationVersion: 1,
  paymentState: "not_started", providerPaymentIntentId: null,
  idempotencyKey: `couranr:route:${settlementId}:obligation:${obligationA}:g1`,
  stripeCustomerId: "cus_RouteFixture", stripePaymentMethodId: "pm_RouteFixture",
  stripeLivemode: false,
};
const metadata = {
  couranrRequestId: requestA, paymentObligationId: obligationA,
  quoteVersionId: quoteA, payerType: "merchant",
  pricingPolicyVersion: attempt.pricingPolicyVersion,
  requestVersion: "2", businessAccountId: business,
};
const intent = {
  id: "pi_RouteFixture", amount: 1800, currency: "usd",
  amount_capturable: 1800, capture_method: "manual", status: "requires_capture",
  livemode: false, customer: "cus_RouteFixture", payment_method: "pm_RouteFixture",
  metadata, client_secret: "pi_RouteFixture_secret_test",
};
const ok = (data: unknown) => ({ data, error: null });
const synced = (state: string, paymentState: string) => ({
  ...baseView, state, version: 2,
  items: [{ ...itemA, paymentState }, itemB],
});

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.VERCEL_ENV;
  mocks.rpc.mockImplementation(async (fn: string) => {
    if (fn === "couranr_read_route_run_settlement") return ok(baseView);
    if (fn === "couranr_begin_route_child_authorization") return ok(attempt);
    if (fn === "couranr_attach_payment_intent") return ok({
      provider_payment_intent_id: intent.id, version: 2,
    });
    if (fn === "couranr_sync_route_run_settlement") return ok(synced("pending_authorization","authorized"));
    if (fn === "couranr_mark_route_settlement_provider_unknown") return ok({
      ...baseView, state: "authorization_unknown",
    });
    if (fn === "couranr_begin_route_run_checkout") return ok(baseView);
    throw new Error(`unexpected RPC ${fn}`);
  });
  mocks.methodRetrieve.mockResolvedValue({
    id: "pm_RouteFixture", customer: "cus_RouteFixture",
    livemode: false, type: "card",
  });
  mocks.intentCreate.mockResolvedValue(intent);
  mocks.intentRetrieve.mockResolvedValue(intent);
  mocks.intentCancel.mockResolvedValue({ ...intent, status: "canceled", amount_capturable: 0 });
  mocks.apply.mockResolvedValue({ ok: true, value: { outcome: "applied" } });
});

describe("RR-003b saved-card child authorization", () => {
  it("checkout confirmation creates no provider call and shows no provider IDs", async () => {
    const r = await beginRouteCheckout({ ...params, expectedVersion: 1,
      idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
    expect(r.ok).toBe(true);
    expect(mocks.intentCreate).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toContain("pm_RouteFixture");
  });

  it("authorizes one canonical child at its own amount with a durable key", async () => {
    const result = await authorizeNextRouteChild(params);
    expect(result.ok).toBe(true);
    expect(mocks.intentCreate).toHaveBeenCalledOnce();
    expect(mocks.intentCreate).toHaveBeenCalledWith(expect.objectContaining({
      amount: 1800, currency: "usd", customer: "cus_RouteFixture",
      payment_method: "pm_RouteFixture", confirm: true, off_session: true,
      capture_method: "manual", metadata,
    }), { idempotencyKey: attempt.idempotencyKey });
    expect(mocks.rpc).toHaveBeenCalledWith("couranr_attach_payment_intent", {
      p_obligation_id: obligationA, p_expected_version: 1,
      p_payment_intent_id: intent.id,
    });
    expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({
      intentId: intent.id, amount: 1800, amountCapturable: 1800,
      eventType: "payment_intent.amount_capturable_updated",
    }));
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "couranr_mark_route_settlement_provider_unknown", expect.anything());
  });

  it("a lost provider response is durable uncertainty, not a second child charge", async () => {
    mocks.intentCreate.mockRejectedValueOnce(new Error("timeout"));
    const result = await authorizeNextRouteChild(params);
    expect(result.ok).toBe(false);
    expect(mocks.rpc).toHaveBeenCalledWith("couranr_mark_route_settlement_provider_unknown",
      expect.objectContaining({ p_obligation_id: obligationA,
        p_reason: "provider_authorization_outcome_unknown" }));
    expect(mocks.rpc).not.toHaveBeenCalledWith("couranr_attach_payment_intent", expect.anything());
    expect(mocks.intentCreate).toHaveBeenCalledTimes(1);
  });

  it("a mismatched provider amount cannot become canonical authorization", async () => {
    mocks.intentCreate.mockResolvedValueOnce({ ...intent, amount: 1 });
    const result = await authorizeNextRouteChild(params);
    expect(result.ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalledWith("couranr_attach_payment_intent", expect.anything());
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("couranr_mark_route_settlement_provider_unknown",
      expect.objectContaining({ p_reason: "provider_identity_or_state_mismatch" }));
  });

  it("requires_action exposes only that intent secret and never claims authorized", async () => {
    mocks.intentCreate.mockResolvedValueOnce({
      ...intent, status: "requires_action", amount_capturable: 0,
    });
    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn === "couranr_read_route_run_settlement") return ok(baseView);
      if (fn === "couranr_begin_route_child_authorization") return ok(attempt);
      if (fn === "couranr_attach_payment_intent") return ok({ provider_payment_intent_id: intent.id, version: 2 });
      if (fn === "couranr_sync_route_run_settlement") return ok(synced("authorization_required","requires_action"));
      throw new Error(`unexpected RPC ${fn}`);
    });
    const result = await authorizeNextRouteChild(params);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.settlement.state).toBe("authorization_required");
      expect(result.value.actionClientSecret).toBe(intent.client_secret);
    }
    expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "payment_intent.requires_action",
    }));
  });

  it("off-session authentication_required retrieves the ORIGINAL intent for customer action", async () => {
    mocks.intentCreate.mockRejectedValueOnce({
      type: "StripeCardError", code: "authentication_required",
      raw: { payment_intent: { id: intent.id } },
    });
    mocks.intentRetrieve.mockResolvedValueOnce({
      ...intent, status: "requires_action", amount_capturable: 0,
    });
    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn === "couranr_read_route_run_settlement") return ok(baseView);
      if (fn === "couranr_begin_route_child_authorization") return ok(attempt);
      if (fn === "couranr_attach_payment_intent") return ok({ provider_payment_intent_id: intent.id, version: 2 });
      if (fn === "couranr_sync_route_run_settlement") return ok(synced("authorization_required","requires_action"));
      throw new Error(`unexpected RPC ${fn}`);
    });
    const result = await authorizeNextRouteChild(params);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.actionClientSecret).toBe(intent.client_secret);
    expect(mocks.intentCreate).toHaveBeenCalledOnce();
    expect(mocks.intentRetrieve).toHaveBeenCalledWith(intent.id);
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "couranr_mark_route_settlement_provider_unknown", expect.anything());
  });

  it("a confirmed provider intent after a lost response reuses its existing ID", async () => {
    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn === "couranr_read_route_run_settlement") return ok({
        ...baseView, state: "authorization_unknown",
        uncertainObligationId: obligationA,
      });
      if (fn === "couranr_begin_route_child_authorization") return ok({
        ...attempt, reconcilingUnknown: true, providerPaymentIntentId: intent.id,
        paymentState: "requires_action", obligationVersion: 2,
      });
      if (fn === "couranr_sync_route_run_settlement") return ok(synced("pending_authorization","authorized"));
      throw new Error(`unexpected RPC ${fn}`);
    });
    const result = await authorizeNextRouteChild(params);
    expect(result.ok).toBe(true);
    expect(mocks.intentCreate).not.toHaveBeenCalled();
    expect(mocks.intentRetrieve).toHaveBeenCalledWith(intent.id);
    expect(mocks.rpc).toHaveBeenCalledWith("couranr_sync_route_run_settlement",
      expect.objectContaining({ p_provider_reconciled: true }));
  });
});

describe("RR-003b canonical compensation of known holds", () => {
  const failedView = { ...baseView, state: "recovery_required",
    items: [{ ...itemA, paymentState: "authorized", obligationVersion: 2 },
      { ...itemB, paymentState: "failed", obligationVersion: 2 }] };
  beforeEach(() => {
    const query = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: {
        id: obligationA, request_id: requestA, quote_version_id: quoteA,
        business_account_id: business, provider_payment_intent_id: intent.id,
        payment_state: "authorized", version: 2,
      }, error: null }),
    };
    mocks.from.mockReturnValue(query);
    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn === "couranr_read_route_run_settlement") return ok(failedView);
      if (fn === "couranr_begin_payment_release") return ok({ outcome: "applied" });
      if (fn === "couranr_complete_payment_release") return ok({ outcome: "applied" });
      if (fn === "couranr_sync_route_run_settlement") return ok({ ...failedView,
        state: "authorization_failed", items: [
          { ...failedView.items[0], paymentState: "cancelled", obligationVersion: 4 },
          failedView.items[1],
        ] });
      throw new Error(`unexpected RPC ${fn}`);
    });
  });

  it("releases a known hold through canonical begin/provider/complete, then syncs", async () => {
    const result = await releaseKnownRouteHolds(params);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.state).toBe("authorization_failed");
    expect(mocks.rpc).toHaveBeenCalledWith("couranr_begin_payment_release",
      expect.objectContaining({ p_obligation_id: obligationA, p_expected_version: 2 }));
    expect(mocks.intentCancel).toHaveBeenCalledOnce();
    expect(mocks.intentCancel).toHaveBeenCalledWith(intent.id);
    expect(mocks.rpc).toHaveBeenCalledWith("couranr_complete_payment_release",
      { p_obligation_id: obligationA, p_payment_intent_id: intent.id,
        p_intent_status: "canceled" });
  });

  it("retrieves a cancelled intent after an ambiguous cancel response", async () => {
    mocks.intentCancel.mockRejectedValueOnce(new Error("response lost"));
    mocks.intentRetrieve.mockResolvedValueOnce({ ...intent, status: "canceled" });
    const result = await releaseKnownRouteHolds(params);
    expect(result.ok).toBe(true);
    expect(mocks.intentRetrieve).toHaveBeenCalledWith(intent.id);
  });

  it("cancels an abandoned requires-action intent instead of leaving card action open", async () => {
    const actionView = { ...failedView, items: [
      { ...failedView.items[0], paymentState: "requires_action" }, failedView.items[1],
    ] };
    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn === "couranr_read_route_run_settlement") return ok(actionView);
      if (fn === "couranr_begin_payment_release") return ok({ outcome: "applied" });
      if (fn === "couranr_complete_payment_release") return ok({ outcome: "applied" });
      if (fn === "couranr_sync_route_run_settlement") return ok({ ...actionView,
        state: "authorization_failed", items: [
          { ...actionView.items[0], paymentState: "cancelled" }, actionView.items[1],
        ] });
      throw new Error(`unexpected RPC ${fn}`);
    });
    mocks.from.mockReturnValue({
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: {
        id: obligationA, request_id: requestA, quote_version_id: quoteA,
        business_account_id: business, provider_payment_intent_id: intent.id,
        payment_state: "requires_action", version: 2,
      }, error: null }),
    });
    const result = await releaseKnownRouteHolds(params);
    expect(result.ok).toBe(true);
    expect(mocks.intentCancel).toHaveBeenCalledWith(intent.id);
  });

  it("never releases an unknown outcome or a captured child", async () => {
    mocks.rpc.mockResolvedValueOnce(ok({ ...failedView, state: "authorization_unknown",
      uncertainObligationId: obligationA }));
    expect((await releaseKnownRouteHolds(params)).ok).toBe(false);
    mocks.rpc.mockResolvedValueOnce(ok({ ...failedView,
      items: [{ ...failedView.items[0], paymentState: "captured" }, failedView.items[1]] }));
    await releaseKnownRouteHolds(params);
    expect(mocks.intentCancel).not.toHaveBeenCalled();
  });
});

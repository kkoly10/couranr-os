import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The standalone refund surface (correction pass, review item 6).
 *
 * V0 truth: the browser's standalone refund action is FULL REFUND only.
 * Cancellation retentions are derived from the delivery's STORED stage by
 * cancelDeliveryWithRecovery on the cancel-delivery path; a dropdown must
 * never substitute a reason for that stage. And once a refund chain settled,
 * the screen must not imply a second one can be created.
 */

const h = vi.hoisted(() => ({
  refundPayment: vi.fn<any>(),
}));

vi.mock("@/lib/couranr/requests/actor", () => ({
  resolveRequestActor: vi.fn(async () => ({
    actor: { kind: "operations", userId: "00000000-0000-4000-8000-000000000001" },
  })),
  isActorDenied: (r: any) => Boolean(r?.code),
}));

vi.mock("@/lib/couranr/requests/commands", () => ({
  getDeliveryRequest: vi.fn(async () => ({
    ok: true,
    value: { request: { business_account_id: null } },
  })),
  isCommandFailure: (r: any) => r?.ok === false,
}));

vi.mock("@/lib/couranr/fulfillment/commands", () => ({
  refundPayment: h.refundPayment,
  isFulfillmentFailure: (r: any) => r?.ok === false,
}));

import { POST as refundRoutePost } from "@/app/api/couranr/operations/delivery-requests/[id]/refund/route";
import { refundControlsFor } from "@/components/couranr/fulfillment/OperationsPaymentRecoveryPanel";

const REQUEST_ID = "9a8b7c6d-1234-4abc-8def-0123456789ab";

function post(body: unknown) {
  const req = { json: async () => body } as any;
  return refundRoutePost(req, { params: Promise.resolve({ id: REQUEST_ID }) });
}

beforeEach(() => {
  h.refundPayment.mockReset();
  h.refundPayment.mockResolvedValue({
    ok: true,
    value: {
      refundId: "f",
      attemptState: "succeeded",
      amountCents: 799,
      retainedCents: 0,
      reason: "full_refund",
    },
  });
});

describe("the standalone /refund route is full_refund only", () => {
  it("accepts full_refund and passes it through verbatim", async () => {
    const res = await post({ reason: "full_refund" });
    expect(res.status).toBe(200);
    expect(h.refundPayment).toHaveBeenCalledTimes(1);
    expect(h.refundPayment.mock.calls[0][0]).toMatchObject({ reason: "full_refund" });
  });

  for (const retention of [
    "cancel_before_confirmation",
    "cancel_after_confirmation_before_arrival",
    "failed_pickup_after_arrival",
    "couranr_caused_failure",
  ]) {
    it(`refuses the retention reason '${retention}' outright`, async () => {
      const res = await post({ reason: retention });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(h.refundPayment).toHaveBeenCalledTimes(0);
      const body = await res.json();
      expect(JSON.stringify(body)).toContain("Cancel delivery");
    });
  }

  it("refuses a missing reason and a non-string reason", async () => {
    for (const bad of [{}, { reason: 5 }, { reason: null }]) {
      const res = await post(bad);
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
    expect(h.refundPayment).toHaveBeenCalledTimes(0);
  });
});

describe("refundControlsFor — the V0 panel truth table", () => {
  const base = {
    id: "ob",
    amountCents: 799,
    currency: "usd",
    paymentState: "captured",
    payerType: "customer",
    authorizedAt: null,
    authorizedAtSource: null,
    authorizationProcessedAt: null,
    capturedAmountCents: 799,
    refundedAmountCents: 0,
    refundedAt: null,
    staleProviderHold: false,
    refundAttempt: null,
  } as any;

  it("captured with no attempt → the Full refund button only", () => {
    expect(refundControlsFor(base)).toEqual({
      showFullRefund: true,
      showReconcile: false,
      settled: null,
    });
  });

  it("a failed attempt frees the slot again → Full refund only", () => {
    const c = refundControlsFor({
      ...base,
      refundAttempt: { state: "failed", amountCents: 799, retainedCents: 0, reason: "full_refund" },
    });
    expect(c.showFullRefund).toBe(true);
    expect(c.showReconcile).toBe(false);
  });

  for (const state of ["requested", "pending_unknown"] as const) {
    it(`an attempt at '${state}' → Reconcile only, never a second Refund`, () => {
      const c = refundControlsFor({
        ...base,
        refundAttempt: { state, amountCents: 799, retainedCents: 0, reason: "full_refund" },
      });
      expect(c).toEqual({ showFullRefund: false, showReconcile: true, settled: null });
    });
  }

  it("a succeeded attempt → neither button; the figures are shown truthfully", () => {
    const c = refundControlsFor({
      ...base,
      paymentState: "captured", // partial refund: obligation not yet 'refunded'
      refundedAmountCents: 799,
      refundAttempt: { state: "succeeded", amountCents: 799, retainedCents: 800, reason: "cancel_after_confirmation_before_arrival" },
    });
    expect(c.showFullRefund).toBe(false);
    expect(c.showReconcile).toBe(false);
    expect(c.settled).toEqual({ refundedCents: 799, retainedCents: 800 });
  });

  it("paymentState 'refunded' → settled even if the attempt row was not projected", () => {
    const c = refundControlsFor({ ...base, paymentState: "refunded", refundedAmountCents: 799 });
    expect(c.showFullRefund).toBe(false);
    expect(c.showReconcile).toBe(false);
    expect(c.settled).toEqual({ refundedCents: 799, retainedCents: 0 });
  });
});

describe("the browser surface stays narrow", () => {
  const client = readFileSync("components/couranr/fulfillment/client.ts", "utf8");
  const panel = readFileSync("components/couranr/fulfillment/OperationsPaymentRecoveryPanel.tsx", "utf8");

  it("client bodies are plain objects — call() encodes them exactly once", () => {
    // The double-stringify defect made every recovery button dead: call()
    // JSON-encodes init.body, so a pre-stringified body reaches the server as
    // a quoted string and every field reads undefined.
    expect(client).not.toMatch(/JSON\.stringify/);
  });

  it("the panel cannot post a retention reason through the standalone refund", () => {
    for (const retention of [
      "cancel_before_confirmation",
      "cancel_after_confirmation_before_arrival",
      "failed_pickup_after_arrival",
      "couranr_caused_failure",
    ]) {
      expect(panel).not.toContain(retention);
    }
    // The client hardcodes the one allowed reason server-side anyway.
    expect(client).toContain('reason: "full_refund"');
  });

  it("the cancel action collects the mandatory note the route requires", () => {
    expect(panel).toMatch(/cancelNote/);
    expect(panel).toMatch(/note:\s*cancelNote\.trim\(\)/);
  });
});

import { describe, expect, it } from "vitest";
import {
  dashboardAttention,
  fulfillmentToLifecycleInput,
} from "@/lib/couranr/dashboard/attention";
import { lifecycleStage, type LifecycleInput } from "@/lib/couranr/fulfillment/lifecycle";

/**
 * MER-001 — the dashboard's attention buckets must be the lifecycle's own
 * derivation, never a second hand-written mapping (`lifecycle.ts:9-13`). Every
 * case here asserts BOTH the bucket and that the stage equals what
 * `lifecycleStage` says for the same input, so a future edit that forks the
 * two fails loudly.
 */

function input(overrides: Partial<LifecycleInput>): LifecycleInput {
  return {
    requestState: "confirmed",
    readinessState: "not_confirmed",
    paymentState: null,
    servicePlanConfirmed: false,
    canonicalDeliveryExists: false,
    assignmentActive: false,
    ...overrides,
  };
}

describe("dashboardAttention derives from lifecycleStage", () => {
  const CASES: {
    name: string;
    in: LifecycleInput;
    degraded: boolean;
    preparing: boolean;
  }[] = [
    // The three real payment states behind the registry's "degraded payments".
    { name: "failed", in: input({ paymentState: "failed" }), degraded: true, preparing: false },
    {
      name: "capture_pending",
      in: input({ paymentState: "capture_pending" }),
      degraded: true,
      preparing: false,
    },
    {
      name: "requires_action",
      in: input({ paymentState: "requires_action" }),
      degraded: true,
      preparing: false,
    },
    // Healthy states must NOT land in the degraded tile.
    {
      name: "authorized, not ready → preparation, not degraded",
      in: input({ paymentState: "authorized" }),
      degraded: false,
      preparing: true,
    },
    {
      name: "authorized and ready → planning work, neither bucket",
      in: input({ paymentState: "authorized", readinessState: "ready" }),
      degraded: false,
      preparing: false,
    },
    {
      name: "no obligation yet → neither bucket",
      in: input({ paymentState: null }),
      degraded: false,
      preparing: false,
    },
    {
      name: "captured with a scheduled delivery → neither bucket",
      in: input({ paymentState: "captured", canonicalDeliveryExists: true }),
      degraded: false,
      preparing: false,
    },
    {
      name: "draft → not actionable, neither bucket",
      in: input({ requestState: "draft" }),
      degraded: false,
      preparing: false,
    },
  ];

  for (const c of CASES) {
    it(c.name, () => {
      const a = dashboardAttention(c.in);
      expect(a.stage).toBe(lifecycleStage(c.in));
      expect(a.degradedPayment).toBe(c.degraded);
      expect(a.awaitingPreparation).toBe(c.preparing);
    });
  }
});

describe("fulfillmentToLifecycleInput", () => {
  it("maps the route's view shape onto the lifecycle's input", () => {
    expect(
      fulfillmentToLifecycleInput({
        requestState: "confirmed",
        readinessState: "ready",
        payment: { paymentState: "authorized" },
        servicePlan: { planState: "confirmed" },
        delivery: null,
      })
    ).toEqual({
      requestState: "confirmed",
      readinessState: "ready",
      paymentState: "authorized",
      servicePlanConfirmed: true,
      canonicalDeliveryExists: false,
      assignmentActive: false,
    });
  });

  it("a cancelled plan is not a plan, and no payment row means null", () => {
    const mapped = fulfillmentToLifecycleInput({
      requestState: "confirmed",
      readinessState: "preparing",
      payment: null,
      servicePlan: { planState: "cancelled" },
      delivery: { driverAssigned: true },
    });
    expect(mapped.paymentState).toBeNull();
    expect(mapped.servicePlanConfirmed).toBe(false);
    expect(mapped.canonicalDeliveryExists).toBe(true);
    expect(mapped.assignmentActive).toBe(true);
  });
});

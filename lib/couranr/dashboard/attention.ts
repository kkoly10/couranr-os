import {
  lifecycleStage,
  type LifecycleInput,
  type LifecycleStage,
} from "@/lib/couranr/fulfillment/lifecycle";

/**
 * MER-001 attention buckets.
 *
 * The dashboard's "needs attention" and "preparation" groupings are DERIVED
 * from `lifecycleStage` — the same derivation OPS-002 and MER-007 use — never
 * from a second hand-written reading of the row. `lifecycle.ts:9-13` prohibits
 * a stored or duplicated stage, and a dashboard that re-derived its own would
 * be the copy that drifts.
 *
 * "Degraded payments" (a registry-required state, UI_SCREEN_REGISTRY.md:272)
 * maps to the real payment states `requires_action`, `failed` and
 * `capture_pending` — nothing broader, so the tile can never cry wolf about a
 * delivery whose payment is merely not started yet.
 */

export type DashboardAttention = {
  stage: LifecycleStage;
  /** requires_action / failed / capture_pending — the degraded-payments tile. */
  degradedPayment: boolean;
  /** Money held, merchant has not said ready — the preparation tile. */
  awaitingPreparation: boolean;
};

/** Adapts the fulfillment view a route returns into the lifecycle's input. */
export function fulfillmentToLifecycleInput(f: {
  requestState: string;
  readinessState: string;
  payment: { paymentState: string } | null;
  servicePlan: { planState: string } | null;
  delivery: { driverAssigned: boolean } | null;
}): LifecycleInput {
  return {
    requestState: f.requestState,
    readinessState: f.readinessState,
    paymentState: f.payment ? f.payment.paymentState : null,
    servicePlanConfirmed: f.servicePlan?.planState === "confirmed",
    canonicalDeliveryExists: Boolean(f.delivery),
    assignmentActive: Boolean(f.delivery?.driverAssigned),
  };
}

export function dashboardAttention(input: LifecycleInput): DashboardAttention {
  const stage = lifecycleStage(input);
  return {
    stage,
    degradedPayment:
      stage === "payment_reauthorization_required" ||
      stage === "capture_pending" ||
      // `requires_action` has no stage of its own — the lifecycle files it
      // under awaiting-authorization — but an authorization attempt EXISTS and
      // is stuck, which is exactly what the merchant needs to see.
      (stage === "awaiting_payment_authorization" && input.paymentState === "requires_action"),
    awaitingPreparation: stage === "merchant_preparing",
  };
}

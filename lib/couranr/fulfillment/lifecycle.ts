import type { RequestState } from "@/lib/couranr/requests/states";

/**
 * OPS-002 lifecycle stages.
 *
 * Pure and dependency-free so it is unit-testable without a database, and so
 * the queue and the request detail screen derive the SAME stage from the same
 * inputs rather than each inventing its own reading of the row.
 *
 * A stage is DERIVED, never stored. There is no `lifecycle_stage` column and
 * there must not be one: it would be a fifth thing to keep in step with
 * `request_state`, `readiness_state`, `payment_state` and `plan_state`, and
 * the one that drifted would be the one a person was looking at.
 */
export const LIFECYCLE_STAGES = [
  /** Submitted, waiting for a Couranr reviewer to pick it up. */
  "pending_review",
  /** Reviewed and priced; the payer has not put a hold on the money yet. */
  "awaiting_payment_authorization",
  /** Money is held. The merchant has not said the shipment is ready. */
  "merchant_preparing",
  /** Merchant says ready and money is held — Operations can plan it. */
  "ready_for_planning",
  /** A pickup window and vehicle requirement are confirmed; capture is next. */
  "service_plan_confirmed",
  /** A capture was started and its outcome is not yet known. Do not retry. */
  "capture_pending",
  /** Money taken and a canonical delivery exists. Dispatch is later work. */
  "captured_scheduled",
  /** Declined, cancelled, closed or not yet submitted. Not queue work. */
  "not_actionable",
] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

/** Request states a payer may still act on. Mirrors the SQL redeem guard. */
export const PAYABLE_REQUEST_STATES: readonly RequestState[] = [
  "confirmed",
  "awaiting_quote_acceptance",
  "quote_revision_required",
];

/**
 * The fields are plain strings on purpose. They arrive from the database, and
 * a value this build has never heard of must fall through to a stage rather
 * than throw on a screen an operator is trying to work from.
 */
export type LifecycleInput = {
  requestState: string;
  readinessState: string;
  paymentState: string | null;
  /** True only for a plan in `confirmed`; a cancelled plan is not a plan. */
  servicePlanConfirmed: boolean;
  canonicalDeliveryExists: boolean;
};

/**
 * Most-advanced-first. The order is the point:
 *
 * - A canonical delivery outranks everything, because it only exists after
 *   money was taken and is the thing dispatch will act on.
 * - `capture_pending` outranks the request state, because it is the one stage
 *   where a person must NOT act — an operator who sees "ready for planning"
 *   on a row whose capture is in flight is being invited to double-capture.
 * - Only then does the request state decide.
 */
export function lifecycleStage(input: LifecycleInput): LifecycleStage {
  if (input.canonicalDeliveryExists) return "captured_scheduled";
  if (input.paymentState === "capture_pending") return "capture_pending";

  /*
   * Captured with no delivery yet: the capture succeeded and conversion has
   * not run (or has not been observed). It is still "money taken", so it must
   * not fall through to a stage that offers Capture again.
   */
  if (input.paymentState === "captured") return "captured_scheduled";

  if (input.requestState === "pending_couranr_review") return "pending_review";
  if (!(PAYABLE_REQUEST_STATES as readonly string[]).includes(input.requestState)) {
    return "not_actionable";
  }

  if (input.paymentState !== "authorized") return "awaiting_payment_authorization";
  if (input.servicePlanConfirmed) return "service_plan_confirmed";
  if (input.readinessState === "ready") return "ready_for_planning";
  return "merchant_preparing";
}

/** Queue ordering. Lower sorts first — the oldest blocked work at the top. */
export const LIFECYCLE_STAGE_ORDER: Readonly<Record<LifecycleStage, number>> = {
  pending_review: 0,
  ready_for_planning: 1,
  service_plan_confirmed: 2,
  capture_pending: 3,
  merchant_preparing: 4,
  awaiting_payment_authorization: 5,
  captured_scheduled: 6,
  not_actionable: 7,
};

export const LIFECYCLE_STAGE_LABELS: Readonly<Record<LifecycleStage, string>> = {
  pending_review: "Pending Couranr review",
  awaiting_payment_authorization: "Awaiting payment authorization",
  merchant_preparing: "Merchant preparing",
  ready_for_planning: "Ready for planning",
  service_plan_confirmed: "Service plan confirmed",
  capture_pending: "Capture pending",
  captured_scheduled: "Captured — scheduled",
  not_actionable: "No action available",
};

/** What Operations is waiting on, in the queue's own voice. */
export const LIFECYCLE_STAGE_DESCRIPTIONS: Readonly<Record<LifecycleStage, string>> = {
  pending_review: "Open each request to confirm, requote or decline it.",
  awaiting_payment_authorization:
    "Couranr confirmed the quote. Nothing can be planned until the payer authorizes the hold.",
  merchant_preparing: "The hold is in place. Waiting for the merchant to mark the shipment ready.",
  ready_for_planning: "Ready to schedule. Confirm a pickup window and vehicle requirement.",
  service_plan_confirmed: "Planned and ready to capture the authorized amount.",
  capture_pending:
    "A capture is in flight and its outcome is not yet confirmed. Do not retry — Couranr will resolve it.",
  captured_scheduled: "Payment captured and the delivery is scheduled.",
  not_actionable: "Closed, declined or cancelled.",
};

/**
 * Which stages the OPS-002 queue shows, in the order it shows them.
 * `not_actionable` is never queue work.
 *
 * DERIVED from `LIFECYCLE_STAGE_ORDER` rather than listed again. A second
 * hand-written order is a second thing to keep in step, and the one that
 * drifted would silently reorder the screen an operator works top-down.
 */
export const QUEUE_STAGES: readonly LifecycleStage[] = LIFECYCLE_STAGES.filter(
  (s) => s !== "not_actionable"
).sort((a, b) => LIFECYCLE_STAGE_ORDER[a] - LIFECYCLE_STAGE_ORDER[b]);

/**
 * The tone each stage renders with. `capture_pending` is deliberately a
 * warning rather than a success: it is the stage that means "unknown".
 */
export const LIFECYCLE_STAGE_TONE: Readonly<
  Record<LifecycleStage, "neutral" | "info" | "success" | "warning">
> = {
  pending_review: "info",
  awaiting_payment_authorization: "neutral",
  merchant_preparing: "neutral",
  ready_for_planning: "info",
  service_plan_confirmed: "info",
  capture_pending: "warning",
  captured_scheduled: "success",
  not_actionable: "neutral",
};

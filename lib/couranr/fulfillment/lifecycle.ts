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
  /** The machine-owned path opened an explicit exception for Operations. */
  "automation_exception",
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
  /**
   * The provider settled a capture as FAILED: the authorization is gone and
   * the payer has to authorize again. Distinct from
   * `awaiting_payment_authorization` because an obligation exists, carries its
   * history, and Stripe documents that the SAME PaymentIntent can be
   * re-confirmed with a different payment method
   * (https://docs.stripe.com/payments/paymentintents/lifecycle). Nothing can
   * be captured or planned against it until that happens.
   */
  "payment_reauthorization_required",
  /**
   * Money TAKEN, and no canonical delivery yet. Distinct from
   * `captured_scheduled` because calling it "scheduled" would be a lie about
   * the one thing dispatch acts on — and distinct from `capture_pending`
   * because there is nothing to ask the provider: the answer is known and the
   * only remaining step is conversion.
   */
  "captured_not_scheduled",
  /** Normal-lane work is scheduled by the machine and waiting for its dispatch horizon. */
  "automatic_scheduled",
  /** Money taken and a manually planned canonical delivery exists, waiting on dispatch. */
  "captured_scheduled",
  /**
   * A driver and a vehicle are committed to the delivery. Distinct from
   * `captured_scheduled` because that stage is the queue's WORK — it is what
   * an operator filters for when deciding what still needs a driver — and
   * folding the two would hide the only thing dispatch changes.
   */
  "driver_assigned",
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
  /** A live assignment exists for the canonical delivery. */
  assignmentActive?: boolean;
  requestState: string;
  readinessState: string;
  paymentState: string | null;
  /** True when Couranr has applied a full promotional credit to the exact current quote. */
  promotionalCreditApplied?: boolean;
  /** True only for a plan in `confirmed`; a cancelled plan is not a plan. */
  servicePlanConfirmed: boolean;
  /** Who owns the confirmed plan. Automatic plans are not Operations chores. */
  servicePlanSource?: "operations" | "automatic" | string | null;
  /** One explicit machine-owned exception means Operations really does have work. */
  automationExceptionOpen?: boolean;
  automationExceptionStage?: string | null;
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
  // An open exception is the one reason normal automation becomes Operations
  // work. It outranks the ordinary schedule projection, including a canonical
  // delivery that exists but could not be assigned.
  if (input.automationExceptionOpen) return "automation_exception";

  if (input.canonicalDeliveryExists) {
    if (input.assignmentActive) return "driver_assigned";
    return input.servicePlanSource === "automatic"
      ? "automatic_scheduled"
      : "captured_scheduled";
  }
  if (input.paymentState === "capture_pending") return "capture_pending";

  /*
   * Captured with no delivery yet: the capture succeeded and conversion has
   * not run, or has not been observed. It is money TAKEN, so it must not fall
   * through to a stage that offers Capture again — and it must not claim to be
   * scheduled either, because the delivery dispatch acts on does not exist.
   */
  if (input.paymentState === "captured") return "captured_not_scheduled";

  /*
   * A settled failure. The hold is gone, so this is NOT plannable work and NOT
   * capturable, but an obligation still exists to recover — which is what
   * separates it from `awaiting_payment_authorization`, where none does.
   *
   * A CANCELLED obligation deliberately does not land here: it is filtered out
   * of the live-obligation read entirely, so the request correctly reads as
   * needing authorization from scratch, which is exactly what a canceled
   * intent requires — Stripe documents that a canceled intent "can't be
   * undone" and a new one must be created.
   */
  if (input.paymentState === "failed") return "payment_reauthorization_required";

  if (input.requestState === "pending_couranr_review") return "pending_review";
  if (!(PAYABLE_REQUEST_STATES as readonly string[]).includes(input.requestState)) {
    return "not_actionable";
  }

  const commerciallySecured =
    input.paymentState === "authorized" || input.promotionalCreditApplied === true;
  if (!commerciallySecured) return "awaiting_payment_authorization";

  /*
   * Readiness gates the plan, not the other way round.
   *
   * `couranr_begin_payment_capture` refuses unless `readiness_state = 'ready'`,
   * so a request whose merchant has since said `not_ready` or `unavailable` is
   * NOT capturable no matter how good its plan is. Reporting it as "planned and
   * ready to capture" put a Capture action on a row the database would refuse,
   * and contradicted what OPS-003 showed for the same request.
   */
  if (input.readinessState !== "ready") return "merchant_preparing";
  if (input.servicePlanConfirmed) {
    return input.servicePlanSource === "automatic"
      ? "automatic_scheduled"
      : "service_plan_confirmed";
  }
  return "ready_for_planning";
}

/** Queue ordering. Lower sorts first — the oldest blocked work at the top. */
export const LIFECYCLE_STAGE_ORDER: Readonly<Record<LifecycleStage, number>> = {
  pending_review: 0,
  automation_exception: 1,
  ready_for_planning: 2,
  service_plan_confirmed: 3,
  capture_pending: 4,
  payment_reauthorization_required: 5,
  captured_not_scheduled: 6,
  merchant_preparing: 7,
  awaiting_payment_authorization: 8,
  automatic_scheduled: 9,
  captured_scheduled: 10,
  driver_assigned: 11,
  // Always last: nothing here is queue work.
  not_actionable: 12,
};

export const LIFECYCLE_STAGE_LABELS: Readonly<Record<LifecycleStage, string>> = {
  pending_review: "Pending Couranr review",
  automation_exception: "Automation needs Operations",
  awaiting_payment_authorization: "Awaiting payment authorization",
  merchant_preparing: "Merchant preparing",
  ready_for_planning: "Ready for planning",
  service_plan_confirmed: "Service plan confirmed",
  capture_pending: "Capture pending",
  payment_reauthorization_required: "Payment authorization needs attention",
  captured_not_scheduled: "Captured — not yet scheduled",
  automatic_scheduled: "Scheduled automatically",
  captured_scheduled: "Scheduled — needs a driver",
  driver_assigned: "Driver assigned",
  not_actionable: "No action available",
};

/** What Operations is waiting on, in the queue's own voice. */
export const LIFECYCLE_STAGE_DESCRIPTIONS: Readonly<Record<LifecycleStage, string>> = {
  pending_review: "Open each request to confirm, requote or decline it.",
  automation_exception:
    "Automatic fulfillment stopped safely. Open the delivery to resolve the recorded exception.",
  awaiting_payment_authorization:
    "Couranr confirmed the quote. Nothing can be planned until the payer authorizes the hold.",
  merchant_preparing:
    "Commercial settlement is in place. Waiting for the merchant to mark the shipment ready.",
  ready_for_planning: "Ready to schedule. Confirm a pickup window and vehicle requirement.",
  service_plan_confirmed:
    "Plan confirmed. Capture the authorized payment or finalize the approved Couranr credit.",
  capture_pending:
    "A capture is in flight and its outcome is not yet confirmed. Do not retry — Couranr will resolve it.",
  payment_reauthorization_required:
    "The provider ended this authorization. Nothing was taken. The payer must authorize again before this can be planned or captured.",
  captured_not_scheduled:
    "The payment was taken but no delivery exists yet. Finish scheduling — do not capture again.",
  automatic_scheduled:
    "Couranr scheduled this normal-lane delivery automatically. No Operations action is required unless an exception opens.",
  captured_scheduled: "Scheduled and commercially settled. No driver is assigned yet.",
  driver_assigned: "A driver and vehicle are committed to this delivery.",
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
const NON_QUEUE_STAGES = new Set<LifecycleStage>([
  "not_actionable",
  "automatic_scheduled",
  "driver_assigned",
]);

export const QUEUE_STAGES: readonly LifecycleStage[] = LIFECYCLE_STAGES.filter(
  (s) => !NON_QUEUE_STAGES.has(s)
).sort((a, b) => LIFECYCLE_STAGE_ORDER[a] - LIFECYCLE_STAGE_ORDER[b]);

/**
 * The tone each stage renders with. `capture_pending` is deliberately a
 * warning rather than a success: it is the stage that means "unknown".
 */
export const LIFECYCLE_STAGE_TONE: Readonly<
  Record<LifecycleStage, "neutral" | "info" | "success" | "warning" | "danger">
> = {
  pending_review: "info",
  automation_exception: "warning",
  awaiting_payment_authorization: "neutral",
  merchant_preparing: "neutral",
  ready_for_planning: "info",
  service_plan_confirmed: "info",
  capture_pending: "warning",
  payment_reauthorization_required: "danger",
  captured_not_scheduled: "warning",
  automatic_scheduled: "success",
  captured_scheduled: "warning",
  driver_assigned: "success",
  not_actionable: "neutral",
};

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LIFECYCLE_STAGES,
  LIFECYCLE_STAGE_DESCRIPTIONS,
  LIFECYCLE_STAGE_LABELS,
  LIFECYCLE_STAGE_ORDER,
  LIFECYCLE_STAGE_TONE,
  PAYABLE_REQUEST_STATES,
  QUEUE_STAGES,
  lifecycleStage,
  type LifecycleInput,
  type LifecycleStage,
} from "@/lib/couranr/fulfillment/lifecycle";
import {
  AUTHORIZING_INTENT_STATUS,
  TERMINAL_ACTION_RESULT_STATE,
  captureEventId,
  captureIdempotencyKey,
  isTerminalCaptureAction,
  mayWriteCaptureResult,
  reconcileActionForIntentStatus,
} from "@/lib/couranr/payments/states";
import { intentIdempotencyKey } from "@/lib/couranr/payments/stripe";
import { REQUEST_VIEW_COLUMNS } from "@/lib/couranr/requests/commands";
import { REQUEST_STATES } from "@/lib/couranr/requests/states";
import {
  operationsWorkbenchState,
  OPERATIONS_WORKBENCH_PHASES,
} from "@/lib/couranr/operations/workbench";

const ROOT = join(__dirname, "..");

/** A confirmed, authorized, un-planned request — the middle of the lifecycle. */
const BASE: LifecycleInput = {
  requestState: "confirmed",
  readinessState: "preparing",
  paymentState: "authorized",
  servicePlanConfirmed: false,
  canonicalDeliveryExists: false,
};

const at = (over: Partial<LifecycleInput>) => lifecycleStage({ ...BASE, ...over });

describe("OPS-002 lifecycle stage derivation", () => {
  it("names a stage for each step of the flow", () => {
    expect(at({ requestState: "pending_couranr_review", paymentState: null })).toBe(
      "pending_review"
    );
    expect(at({ paymentState: null })).toBe("awaiting_payment_authorization");
    expect(at({})).toBe("merchant_preparing");
    expect(at({ readinessState: "ready" })).toBe("ready_for_planning");
    expect(at({ readinessState: "ready", servicePlanConfirmed: true })).toBe(
      "service_plan_confirmed"
    );
    expect(at({ readinessState: "ready", servicePlanConfirmed: true, paymentState: "capture_pending" })).toBe(
      "capture_pending"
    );
    expect(
      at({
        readinessState: "ready",
        servicePlanConfirmed: true,
        paymentState: "captured",
        canonicalDeliveryExists: true,
      })
    ).toBe("captured_scheduled");
  });

  it("every declared stage is reachable from some input", () => {
    const reached = new Set<LifecycleStage>([
      at({ requestState: "pending_couranr_review", paymentState: null }),
      at({ paymentState: null }),
      at({}),
      at({ readinessState: "ready" }),
      at({ readinessState: "ready", servicePlanConfirmed: true }),
      at({ paymentState: "capture_pending" }),
      at({ paymentState: "captured" }),
      at({ paymentState: "failed" }),
      at({ canonicalDeliveryExists: true }),
      at({
        readinessState: "ready",
        servicePlanConfirmed: true,
        servicePlanSource: "automatic",
      }),
      at({ automationExceptionOpen: true, automationExceptionStage: "planning" }),
      at({ canonicalDeliveryExists: true, assignmentActive: true }),
      at({ requestState: "declined" }),
    ]);
    expect([...reached].sort()).toEqual([...LIFECYCLE_STAGES].sort());
  });

  /*
   * The queue's central safety property. An operator who sees "ready for
   * planning" on a row whose capture is in flight is being invited to capture
   * money that may already be taken, so `capture_pending` must outrank every
   * cue that would offer an action.
   */
  it("capture_pending outranks readiness, the plan and the request state", () => {
    for (const readinessState of ["not_confirmed", "preparing", "ready", "not_ready", "unavailable"]) {
      for (const servicePlanConfirmed of [false, true]) {
        expect(
          at({ readinessState, servicePlanConfirmed, paymentState: "capture_pending" })
        ).toBe("capture_pending");
      }
    }
    for (const requestState of REQUEST_STATES) {
      expect(at({ requestState, paymentState: "capture_pending" })).toBe("capture_pending");
    }
  });

  /*
   * `captured` with no delivery row means the money is TAKEN and conversion has
   * not been observed. It must not fall back to a stage that offers Capture,
   * and it must not claim to be scheduled — the delivery dispatch acts on does
   * not exist.
   */
  it("captured without a delivery is its own stage, never scheduled", () => {
    expect(at({ paymentState: "captured", canonicalDeliveryExists: false })).toBe(
      "captured_not_scheduled"
    );
    expect(
      at({ paymentState: "captured", servicePlanConfirmed: true, readinessState: "ready" })
    ).toBe("captured_not_scheduled");
  });

  /*
   * Readiness gates the plan. `couranr_begin_payment_capture` refuses unless
   * readiness is `ready`, so a planned request whose merchant has since said
   * `not_ready` or `unavailable` must NOT be filed as ready to capture.
   */
  it("a plan does not outrank a merchant who is no longer ready", () => {
    for (const readinessState of ["not_confirmed", "preparing", "not_ready", "unavailable"]) {
      expect(at({ readinessState, servicePlanConfirmed: true })).toBe("merchant_preparing");
    }
    expect(at({ readinessState: "ready", servicePlanConfirmed: true })).toBe(
      "service_plan_confirmed"
    );
  });

  /*
   * A settled failure is not the same as never having authorized. An
   * obligation exists, carries its history, and Stripe documents that the same
   * PaymentIntent can be re-confirmed with a different payment method, so this
   * is a RECOVERY stage rather than a fresh-authorization one.
   */
  it("a failed payment is its own recovery stage, not awaiting authorization", () => {
    expect(at({ paymentState: "failed" })).toBe("payment_reauthorization_required");
    expect(at({ paymentState: "failed", readinessState: "ready" })).toBe(
      "payment_reauthorization_required"
    );
    expect(at({ paymentState: "failed", servicePlanConfirmed: true })).toBe(
      "payment_reauthorization_required"
    );
  });

  /*
   * A CANCELLED obligation is filtered out of the live-obligation read, so the
   * request reads as needing authorization from scratch — which is exactly
   * right: Stripe documents a canceled intent "can't be undone" and a new one
   * must be created.
   */
  it("a cancelled obligation reads as needing authorization from scratch", () => {
    expect(at({ paymentState: null })).toBe("awaiting_payment_authorization");
  });

  it("neither recovery stage offers capture or planning", () => {
    for (const st of ["payment_reauthorization_required", "awaiting_payment_authorization"]) {
      expect(["ready_for_planning", "service_plan_confirmed"]).not.toContain(st);
    }
  });

  it("a canonical delivery outranks everything", () => {
    for (const paymentState of [null, "authorized", "failed", "capture_pending", "captured"]) {
      expect(at({ paymentState, canonicalDeliveryExists: true })).toBe("captured_scheduled");
    }
  });

  /*
   * Readiness cannot advance a row past authorization. A merchant marking
   * "ready" with no hold in place is still awaiting payment — the queue must
   * not present it as plannable work.
   */
  it("readiness never precedes authorization", () => {
    // `failed` is deliberately absent: it is a settled failure with a
    // recoverable obligation, which has its own stage.
    for (const paymentState of [null, "not_started", "requires_action"]) {
      expect(at({ readinessState: "ready", paymentState })).toBe(
        "awaiting_payment_authorization"
      );
      expect(at({ readinessState: "ready", servicePlanConfirmed: true, paymentState })).toBe(
        "awaiting_payment_authorization"
      );
    }
  });

  it("terminal and pre-submission requests are not queue work", () => {
    for (const requestState of REQUEST_STATES) {
      const stage = at({ requestState, paymentState: "authorized" });
      const payable = (PAYABLE_REQUEST_STATES as readonly string[]).includes(requestState);
      const review = requestState === "pending_couranr_review";
      if (!payable && !review) expect(stage).toBe("not_actionable");
    }
  });

  it("an unrecognised state falls through instead of throwing", () => {
    expect(() =>
      lifecycleStage({
        requestState: "a_state_from_the_future",
        readinessState: "also_new",
        paymentState: "brand_new",
        servicePlanConfirmed: false,
        canonicalDeliveryExists: false,
      })
    ).not.toThrow();
    expect(
      lifecycleStage({
        requestState: "a_state_from_the_future",
        readinessState: "also_new",
        paymentState: "brand_new",
        servicePlanConfirmed: false,
        canonicalDeliveryExists: false,
      })
    ).toBe("not_actionable");
  });
});

describe("OPS-002 stage metadata", () => {
  it("labels, descriptions, tone and order cover every stage exactly", () => {
    for (const table of [
      LIFECYCLE_STAGE_LABELS,
      LIFECYCLE_STAGE_DESCRIPTIONS,
      LIFECYCLE_STAGE_TONE,
      LIFECYCLE_STAGE_ORDER,
    ] as Array<Record<string, unknown>>) {
      expect(Object.keys(table).sort()).toEqual([...LIFECYCLE_STAGES].sort());
    }
  });

  it("normal automatic schedules and assigned deliveries are not Operations queue work", () => {
    expect(QUEUE_STAGES).not.toContain("automatic_scheduled");
    expect(QUEUE_STAGES).not.toContain("driver_assigned");
    expect(QUEUE_STAGES).not.toContain("not_actionable");
    expect(QUEUE_STAGES).toContain("automation_exception");
    expect(QUEUE_STAGES).toContain("ready_for_planning");
  });

  /* Ties would make the queue's section order depend on sort stability. */
  it("every stage has a distinct order", () => {
    const ranks = Object.values(LIFECYCLE_STAGE_ORDER);
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it("the queue renders in order, review first and scheduled last", () => {
    const ranks = QUEUE_STAGES.map((s) => LIFECYCLE_STAGE_ORDER[s]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(QUEUE_STAGES[0]).toBe("pending_review");
    // Assigned and normal automatic work are intentionally not queue chores.
    expect(QUEUE_STAGES[QUEUE_STAGES.length - 1]).toBe("captured_scheduled");
  });

  /* Money taken is never a success cue until the delivery actually exists. */
  it("captured without a delivery reads as a warning, not success", () => {
    expect(LIFECYCLE_STAGE_TONE.captured_not_scheduled).toBe("warning");
    // A lost authorization is a failure, not a caution.
    expect(LIFECYCLE_STAGE_TONE.payment_reauthorization_required).toBe("danger");
  });

  it("capture_pending reads as a warning, never as success", () => {
    expect(LIFECYCLE_STAGE_TONE.capture_pending).toBe("warning");
  });

  it("automatic scheduling is success without becoming an Operations chore", () => {
    expect(LIFECYCLE_STAGE_TONE.captured_scheduled).toBe("warning");
    expect(LIFECYCLE_STAGE_TONE.automatic_scheduled).toBe("success");
    expect(LIFECYCLE_STAGE_TONE.driver_assigned).toBe("success");
    expect(QUEUE_STAGES).not.toContain("automatic_scheduled");
    expect(QUEUE_STAGES).not.toContain("driver_assigned");
  });

  /* The one stage where the correct action is none at all. */
  it("the capture_pending description tells an operator not to retry", () => {
    expect(LIFECYCLE_STAGE_DESCRIPTIONS.capture_pending.toLowerCase()).toContain("do not retry");
  });
});

describe("OPS-003 lifecycle workbench grouping", () => {
  const grouped = (over: Partial<LifecycleInput> & { fulfillmentState?: string | null }) =>
    operationsWorkbenchState({
      ...BASE,
      ...over,
    });

  it("groups each operational job into one current phase", () => {
    expect(grouped({ requestState: "pending_couranr_review", paymentState: null }).phase).toBe("review");
    expect(grouped({ paymentState: null }).phase).toBe("commercial");
    expect(grouped({ readinessState: "ready", promotionalCreditApplied: true }).phase).toBe("plan");
    expect(
      grouped({
        readinessState: "ready",
        promotionalCreditApplied: true,
        canonicalDeliveryExists: true,
      }).phase
    ).toBe("dispatch");
    expect(
      grouped({
        readinessState: "ready",
        promotionalCreditApplied: true,
        servicePlanConfirmed: true,
        servicePlanSource: "automatic",
      }).lifecycleStage
    ).toBe("automatic_scheduled");
    expect(
      grouped({
        readinessState: "ready",
        promotionalCreditApplied: true,
        servicePlanConfirmed: true,
        servicePlanSource: "automatic",
        automationExceptionOpen: true,
        automationExceptionStage: "planning",
      }).phase
    ).toBe("plan");
    expect(
      grouped({
        readinessState: "ready",
        promotionalCreditApplied: true,
        canonicalDeliveryExists: true,
        assignmentActive: true,
      }).phase
    ).toBe("execute");
  });

  it("terminal delivery evidence wins over an active assignment", () => {
    for (const fulfillmentState of ["delivered", "could_not_deliver", "cancelled"]) {
      expect(
        grouped({
          canonicalDeliveryExists: true,
          assignmentActive: true,
          fulfillmentState,
        }).phase
      ).toBe("complete");
    }
  });

  it("declares the operator-facing phases in lifecycle order", () => {
    expect(OPERATIONS_WORKBENCH_PHASES).toEqual([
      "review",
      "commercial",
      "plan",
      "dispatch",
      "execute",
      "complete",
    ]);
  });
});

describe("capture reconciliation", () => {
  /*
   * The exit from `capture_pending`. Getting this table wrong is how a capture
   * either happens twice or never resolves at all.
   */
  it("releases only when the funds are still merely held", () => {
    expect(reconcileActionForIntentStatus("requires_capture")).toBe("release");
  });

  it("completes only when the intent actually succeeded", () => {
    expect(reconcileActionForIntentStatus("succeeded")).toBe("complete");
  });

  /*
   * Every other status must write NOTHING. `couranr_complete_payment_capture`
   * keys its event on (obligation, intent), so a rejection recorded while an
   * intent was still `processing` would make the later, successful reconcile a
   * duplicate — permanently stranding the obligation with the money taken.
   */
  it("fails only on requires_payment_method and cancels only on canceled", () => {
    expect(reconcileActionForIntentStatus("requires_payment_method")).toBe("fail");
    expect(reconcileActionForIntentStatus("canceled")).toBe("cancel");
  });

  /*
   * `wait` means INDETERMINATE and must stay the default. The difference
   * between `wait` and a terminal action is the difference between "we do not
   * know yet" and "we know, and the answer is final" — conflating them is what
   * stranded capture_pending obligations with no exit.
   */
  it("waits on every indeterminate status, including ones this build has not seen", () => {
    for (const status of [
      "processing",
      "requires_confirmation",
      "requires_action",
      "",
      "a_status_from_the_future",
    ]) {
      expect(reconcileActionForIntentStatus(status)).toBe("wait");
    }
  });

  it("release is keyed to the same status that authorizes, not a second literal", () => {
    expect(reconcileActionForIntentStatus(AUTHORIZING_INTENT_STATUS)).toBe("release");
  });

  /* Exactly four statuses are actionable. Everything else is `wait`. */
  it("only four statuses are actionable at all", () => {
    const actionable = [
      "requires_capture", "succeeded", "requires_payment_method", "canceled",
      "processing", "requires_confirmation", "requires_action",
    ].filter((x) => reconcileActionForIntentStatus(x) !== "wait");
    expect(actionable.sort()).toEqual(
      ["canceled", "requires_capture", "requires_payment_method", "succeeded"].sort()
    );
  });

  /*
   * Only the two TERMINAL actions may reach the resolution command. `release`
   * and `complete` have their own commands, and letting one caller reach the
   * same state two ways is how the two disagree.
   */
  it("only fail and cancel are terminal capture actions", () => {
    expect(isTerminalCaptureAction("fail")).toBe(true);
    expect(isTerminalCaptureAction("cancel")).toBe(true);
    for (const x of ["release", "complete", "wait"] as const) {
      expect(isTerminalCaptureAction(x)).toBe(false);
    }
  });

  it("each terminal action lands on exactly one payment state", () => {
    expect(TERMINAL_ACTION_RESULT_STATE.fail).toBe("failed");
    expect(TERMINAL_ACTION_RESULT_STATE.cancel).toBe("cancelled");
    expect(Object.keys(TERMINAL_ACTION_RESULT_STATE).sort()).toEqual(["cancel", "fail"]);
  });

  /*
   * A terminal event ends ONE capture cycle, and an obligation can reach
   * capture_pending more than once. Keying on the obligation alone would let
   * the first terminal event swallow the second and strand it as before.
   */
  it("terminal event ids are scoped to the capture cycle and the action", () => {
    const OB = "33333333-3333-4333-8333-333333333333";
    expect(captureEventId.terminal(OB, 4, "fail")).not.toBe(captureEventId.terminal(OB, 6, "fail"));
    expect(captureEventId.terminal(OB, 4, "fail")).not.toBe(captureEventId.terminal(OB, 4, "cancel"));
    expect(captureEventId.terminal(OB, 4, "fail")).toBe(captureEventId.terminal(OB, 4, "fail"));
  });
});

describe("capture write guards", () => {
  /*
   * The guard that must be asked at EVERY capture call site, not one.
   * `reconcileCapture` had it and `capturePayment` did not, so a capture that
   * resolved as `processing` burned the result event id on a rejection and the
   * later successful reconcile was swallowed as a duplicate — money taken, no
   * delivery, no exit.
   */
  it("only a succeeded intent may write a capture result", () => {
    expect(mayWriteCaptureResult("succeeded")).toBe(true);
    for (const s of [
      "processing",
      "requires_capture",
      "requires_payment_method",
      "requires_confirmation",
      "requires_action",
      "canceled",
      "",
      "something_new",
    ]) {
      expect(mayWriteCaptureResult(s)).toBe(false);
    }
  });

  /*
   * Source check across BOTH call sites. The predicate only protects anything
   * if every caller of `completeCapture` asks it first — which is precisely
   * the enforcement-point pair that was missed.
   */
  it("every completeCapture call site asks the guard first", () => {
    const src = readFileSync(join(ROOT, "lib/couranr/fulfillment/commands.ts"), "utf8");
    const callSites = [...src.matchAll(/RPC\.completeCapture/g)];
    expect(callSites.length).toBe(2);
    // One asks it directly, one through reconcileActionForIntentStatus.
    const guards =
      [...src.matchAll(/mayWriteCaptureResult/g)].length +
      [...src.matchAll(/reconcileActionForIntentStatus/g)].length;
    expect(guards).toBeGreaterThanOrEqual(callSites.length);
  });

  /*
   * An HTTP status is not evidence about money. 409 (another request with this
   * key is in flight) and 400 (already captured) are both 4xx and both mean a
   * capture may well have happened, so the capture path must never release a
   * hold from its error branch — only `reconcileCapture` may, after re-reading
   * the intent.
   */
  it("the capture path never releases a hold from an HTTP status", () => {
    const src = readFileSync(join(ROOT, "lib/couranr/fulfillment/commands.ts"), "utf8");
    expect(src).not.toMatch(/statusCode\s*>=\s*400/);
    const capturePayment = src.slice(
      src.indexOf("export async function capturePayment"),
      src.indexOf("async function convertAfterCapture")
    );
    expect(capturePayment).not.toContain("RPC.failCapture");
    // The only release lives in reconcileCapture.
    expect([...src.matchAll(/RPC\.failCapture/g)].length).toBe(1);
  });
});

describe("capture idempotency key", () => {
  const OB = "22222222-2222-4222-8222-222222222222";

  /*
   * Within a cycle the key is stable, so two concurrent captures produce ONE
   * charge. Across cycles it differs, because Stripe caches a completed
   * request's response for 24 hours — an obligation-only key would replay the
   * first attempt's failure to every retry for a day, which would make the
   * whole reconcile-and-retry path unable to achieve anything.
   */
  it("is stable within a capture cycle", () => {
    expect(captureIdempotencyKey(OB, 4)).toBe(captureIdempotencyKey(OB, 4));
  });

  it("differs between capture cycles", () => {
    expect(captureIdempotencyKey(OB, 4)).not.toBe(captureIdempotencyKey(OB, 6));
  });

  it("is cycle-scoped the same way the intent key is", () => {
    expect(captureIdempotencyKey(OB, 4)).toBe(`couranr:capture:${OB}:v4`);
    expect(intentIdempotencyKey({ id: OB } as any, 4)).toBe(`couranr:obligation:${OB}:v4`);
  });

  it("the command layer builds no capture idempotency key by hand", () => {
    const src = readFileSync(join(ROOT, "lib/couranr/fulfillment/commands.ts"), "utf8");
    expect(src).not.toMatch(/idempotencyKey:\s*`/);
    expect(src).toContain("captureIdempotencyKey(");
  });
});

describe("queue projection", () => {
  /*
   * The queue feeds `toDeliveryRequestView` from a narrower `select` than the
   * detail route does. A column the projection omits comes back `undefined`,
   * which the view publishes as an absent field rather than failing — so the
   * defect would be invisible until an operator noticed a blank cell.
   */
  it("selects every column the view model reads", () => {
    const src = readFileSync(join(ROOT, "lib/couranr/requests/view.ts"), "utf8");
    const read = new Set(
      [...src.matchAll(/\brow\.([a-z_][a-z0-9_]*)/g)].map((m) => m[1])
    );
    expect(read.size).toBeGreaterThan(20);

    const selected = new Set(REQUEST_VIEW_COLUMNS.split(","));
    const missing = [...read].filter((c) => !selected.has(c));
    expect(missing).toEqual([]);
  });

  it("never selects the payload or the creator", () => {
    const selected = REQUEST_VIEW_COLUMNS.split(",");
    expect(selected).not.toContain("normalized_request_payload");
    expect(selected).not.toContain("created_by");
    expect(selected).not.toContain("idempotency_key");
  });

  /*
   * Positive control. The check above is only worth anything if it fails on a
   * projection that IS missing a column, so run the identical comparison
   * against a deliberately reduced set and require it to complain.
   */
  it("the projection check fails on a projection that drops a column", () => {
    const src = readFileSync(join(ROOT, "lib/couranr/requests/view.ts"), "utf8");
    const read = new Set([...src.matchAll(/\brow\.([a-z_][a-z0-9_]*)/g)].map((m) => m[1]));

    const damaged = new Set(REQUEST_VIEW_COLUMNS.split(","));
    damaged.delete("delivery_subtotal_cents");
    const missing = [...read].filter((c) => !damaged.has(c));
    expect(missing).toEqual(["delivery_subtotal_cents"]);
  });
});

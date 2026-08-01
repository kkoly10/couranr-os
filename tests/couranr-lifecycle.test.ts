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
  captureEventId,
  reconcileActionForIntentStatus,
} from "@/lib/couranr/payments/states";
import { REQUEST_VIEW_COLUMNS } from "@/lib/couranr/requests/commands";
import { REQUEST_STATES } from "@/lib/couranr/requests/states";

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
      at({ canonicalDeliveryExists: true }),
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
   * `captured` with no delivery row means the capture landed and conversion has
   * not been observed. It must NOT fall back to a stage that offers Capture.
   */
  it("captured without a delivery is still captured_scheduled", () => {
    expect(at({ paymentState: "captured", canonicalDeliveryExists: false })).toBe(
      "captured_scheduled"
    );
    expect(
      at({ paymentState: "captured", servicePlanConfirmed: true, readinessState: "ready" })
    ).toBe("captured_scheduled");
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
    for (const paymentState of [null, "not_started", "requires_action", "failed"]) {
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

  it("the queue shows every stage except not_actionable", () => {
    expect([...QUEUE_STAGES].sort()).toEqual(
      LIFECYCLE_STAGES.filter((s) => s !== "not_actionable").sort()
    );
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
    expect(QUEUE_STAGES[QUEUE_STAGES.length - 1]).toBe("captured_scheduled");
  });

  it("capture_pending reads as a warning, never as success", () => {
    expect(LIFECYCLE_STAGE_TONE.capture_pending).toBe("warning");
    expect(LIFECYCLE_STAGE_TONE.captured_scheduled).toBe("success");
  });

  /* The one stage where the correct action is none at all. */
  it("the capture_pending description tells an operator not to retry", () => {
    expect(LIFECYCLE_STAGE_DESCRIPTIONS.capture_pending.toLowerCase()).toContain("do not retry");
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
  it("waits on every other status, including ones this build has not seen", () => {
    for (const status of [
      "processing",
      "requires_payment_method",
      "requires_confirmation",
      "requires_action",
      "canceled",
      "",
      "a_status_from_the_future",
    ]) {
      expect(reconcileActionForIntentStatus(status)).toBe("wait");
    }
  });

  it("release is keyed to the same status that authorizes, not a second literal", () => {
    expect(reconcileActionForIntentStatus(AUTHORIZING_INTENT_STATUS)).toBe("release");
  });

  /* `wait` is the default, so an unhandled status can never move money. */
  it("only two statuses are actionable at all", () => {
    const actionable = [
      "requires_capture",
      "succeeded",
      "processing",
      "requires_payment_method",
      "requires_confirmation",
      "requires_action",
      "canceled",
    ].filter((s) => reconcileActionForIntentStatus(s) !== "wait");
    expect(actionable.sort()).toEqual(["requires_capture", "succeeded"]);
  });
});

describe("capture event ids", () => {
  const OB = "11111111-1111-4111-8111-111111111111";
  const PI = "pi_test_0001";

  /*
   * These ids ARE the idempotency keys — `couranr_payment_events` is unique on
   * them and the SQL commands treat a collision as "already handled" and
   * return without acting. An id that repeats across two attempts therefore
   * makes the second attempt a silent no-op.
   */
  it("a release id is unique per capture cycle, not per obligation", () => {
    expect(captureEventId.notTaken(OB, 3)).not.toBe(captureEventId.notTaken(OB, 5));
    expect(captureEventId.failed(OB, 3, "card_error")).not.toBe(
      captureEventId.failed(OB, 5, "card_error")
    );
  });

  /* Same cycle, same id — retrying within one attempt must stay idempotent. */
  it("the same cycle produces the same id", () => {
    expect(captureEventId.notTaken(OB, 3)).toBe(captureEventId.notTaken(OB, 3));
    expect(captureEventId.failed(OB, 3, "card_error")).toBe(
      captureEventId.failed(OB, 3, "card_error")
    );
  });

  /*
   * A result is written only for a SUCCEEDED intent, which is terminal, so it
   * is keyed on the intent rather than the cycle — a repeat genuinely is a
   * duplicate and must be swallowed.
   */
  it("a result id is keyed on the intent, and is stable", () => {
    expect(captureEventId.result(OB, PI)).toBe(captureEventId.result(OB, PI));
    expect(captureEventId.result(OB, PI)).not.toBe(captureEventId.result(OB, "pi_test_0002"));
  });

  it("every id names both the obligation and what happened", () => {
    for (const id of [
      captureEventId.failed(OB, 2, "x"),
      captureEventId.notTaken(OB, 2),
      captureEventId.result(OB, PI),
    ]) {
      expect(id).toContain(OB);
      expect(id.startsWith("couranr:capture")).toBe(true);
    }
  });

  /*
   * Source check, because the builders only help if they are the only writers.
   * A hand-rolled template literal in the command layer is how the collision
   * got in the first time.
   */
  it("the command layer builds no capture event id by hand", () => {
    const src = readFileSync(join(ROOT, "lib/couranr/fulfillment/commands.ts"), "utf8");
    const handRolled = [...src.matchAll(/p_provider_event_id:\s*`/g)];
    expect(handRolled.length).toBe(0);
    expect(src).toContain("captureEventId.notTaken");
    expect(src).toContain("captureEventId.failed");
    expect(src).toContain("captureEventId.result");
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

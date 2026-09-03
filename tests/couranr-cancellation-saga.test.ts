import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The durable cancellation saga (final closure pass §2/§4).
 *
 * SQL truths (closure evidence, zero-due settlement, the receivable, request
 * termination) are executed in the disposable suites. These tests own the TS
 * COMPOSITION under fault injection:
 *
 *   - closure persisted, refund failed BEFORE any attempt row existed → a
 *     retry on the now-terminal delivery resumes the ORIGINAL governed
 *     settlement from the closure evidence, and the reason a browser posts
 *     on the retry is IGNORED — nothing after closure can change the fee.
 *   - terminal + already-settled money → idempotent success.
 *   - no delivery: the stage comes from STORED request/payment facts, never
 *     from delivery existence alone — confirmed+authorized carries the $8
 *     receivable, unconfirmed releases at $0, couranr_caused is always $0.
 */

const h = vi.hoisted(() => ({
  rpc: vi.fn<any>(),
  db: {
    request: null as any,
    obligation: null as any,
    closureEvent: null as any,
    /** The couranr:cancellation_receivable:<ob> event, when it already stands. */
    settlementEvent: null as any,
  },
  /** Records the composition order so a test can prove settlement-before-release. */
  order: [] as string[],
  getCanonicalDelivery: vi.fn<any>(),
  refundPayment: vi.fn<any>(),
  releaseAuthorization: vi.fn<any>(),
}));

vi.mock("@/lib/supabaseAdmin", () => {
  const chain = (table: string) => {
    const c: any = {};
    for (const m of ["select", "eq", "is", "in", "order", "limit"]) c[m] = () => c;
    c.maybeSingle = async () => {
      if (table === "couranr_delivery_requests") return { data: h.db.request, error: null };
      if (table === "couranr_payment_obligations") return { data: h.db.obligation, error: null };
      if (table === "couranr_delivery_events") return { data: h.db.closureEvent, error: null };
      if (table === "couranr_payment_events") return { data: h.db.settlementEvent, error: null };
      return { data: null, error: null };
    };
    return c;
  };
  return { supabaseAdmin: { from: (t: string) => chain(t), rpc: h.rpc } };
});

vi.mock("@/lib/couranr/fulfillment/commands", () => ({
  getCanonicalDelivery: h.getCanonicalDelivery,
  refundPayment: h.refundPayment,
  releaseAuthorization: h.releaseAuthorization,
  isFulfillmentFailure: (r: any) => r?.ok === false,
}));

import { cancelDeliveryWithRecovery } from "@/lib/couranr/fulfillment/cancellation";

const OPS = { kind: "operations", userId: "00000000-0000-4000-8000-000000000001" } as const;
const REQUEST_ID = "0r000000-0000-4000-8000-00000000000r";

const baseArgs = {
  actor: OPS,
  requestId: REQUEST_ID,
  businessAccountId: null as string | null,
  deliveryId: null as string | null,
  note: "operator note",
};

function rpcAnswers() {
  h.rpc.mockImplementation(async (fn: string, args: any) => {
    if (fn === "couranr_cancel_delivery" || fn === "couranr_close_delivery_undeliverable") {
      return { data: { fulfillment_state: fn === "couranr_cancel_delivery" ? "cancelled" : "could_not_deliver" }, error: null };
    }
    if (fn === "couranr_cancel_delivery_request") {
      return { data: { request_state: "cancelled" }, error: null };
    }
    if (fn === "couranr_record_cancellation_settlement") {
      h.order.push("record_settlement");
      return { data: { detail: { retainedDueCents: args?.p_retained_due_cents } }, error: null };
    }
    return { data: null, error: { code: "XX000", message: `unexpected rpc ${fn}` } };
  });
}

function callsTo(fn: string) {
  return h.rpc.mock.calls.filter((c: any[]) => c[0] === fn);
}

beforeEach(() => {
  h.rpc.mockReset();
  h.getCanonicalDelivery.mockReset();
  h.refundPayment.mockReset();
  h.releaseAuthorization.mockReset();
  h.db.request = { id: REQUEST_ID, request_state: "confirmed" };
  h.db.obligation = null;
  h.db.closureEvent = null;
  h.db.settlementEvent = null;
  h.order = [];
  h.getCanonicalDelivery.mockResolvedValue({ ok: true, value: { delivery: null } });
  h.refundPayment.mockResolvedValue({
    ok: true,
    value: { refundId: "f", attemptState: "succeeded", amountCents: 100, retainedCents: 800, reason: "cancel_after_confirmation_before_arrival" },
  });
  h.releaseAuthorization.mockImplementation(async () => {
    h.order.push("release");
    return { ok: true, value: { obligationId: "ob-1", paymentState: "cancelled" } };
  });
  rpcAnswers();
});

describe("saga resume from closure evidence (§2)", () => {
  it("a retry on a terminal delivery resumes the RECORDED settlement and ignores the posted reason", async () => {
    h.getCanonicalDelivery.mockResolvedValue({
      ok: true,
      value: { delivery: { id: "dlv-1", fulfillment_state: "cancelled", version: 3 } },
    });
    h.db.closureEvent = {
      command: "cancel_delivery",
      metadata: { governedReason: "merchant_request", stageNote: null },
    };

    // The retry posts couranr_caused — which would be a $0 settlement. It
    // must NOT be honored: the recorded merchant_request ($8) governs.
    const r = await cancelDeliveryWithRecovery({ ...baseArgs, reason: "couranr_caused" });

    expect(r.ok).toBe(true);
    expect(h.refundPayment).toHaveBeenCalledTimes(1);
    expect(h.refundPayment.mock.calls[0][0].reason).toBe("cancel_after_confirmation_before_arrival");
    expect(callsTo("couranr_cancel_delivery")).toHaveLength(0); // no re-closure
    expect(callsTo("couranr_cancel_delivery_request")).toHaveLength(1);
    if (r.ok) expect(r.value.outcome).toBe("resumed_settlement");
  });

  it("the resume works with NO reason at all (resume: true route shape)", async () => {
    h.getCanonicalDelivery.mockResolvedValue({
      ok: true,
      value: { delivery: { id: "dlv-1", fulfillment_state: "could_not_deliver", version: 4 } },
    });
    h.db.closureEvent = {
      command: "close_delivery_undeliverable",
      metadata: { governedReason: "failed_pickup", stageNote: "at_pickup" },
    };

    const r = await cancelDeliveryWithRecovery({ ...baseArgs, reason: null });

    expect(r.ok).toBe(true);
    expect(h.refundPayment.mock.calls[0][0].reason).toBe("failed_pickup_after_arrival");
  });

  it("terminal + already-settled money replays idempotently through refundPayment", async () => {
    h.getCanonicalDelivery.mockResolvedValue({
      ok: true,
      value: { delivery: { id: "dlv-1", fulfillment_state: "cancelled", version: 3 } },
    });
    h.db.closureEvent = {
      command: "cancel_delivery",
      metadata: { governedReason: "customer_request" },
    };
    h.refundPayment.mockResolvedValue({
      ok: true,
      value: { refundId: "f", attemptState: "settled_no_refund_due", amountCents: 0, retainedCents: 799, reason: "cancel_after_confirmation_before_arrival" },
    });

    const r = await cancelDeliveryWithRecovery({ ...baseArgs, reason: null });
    expect(r.ok).toBe(true);
    if (r.ok && r.value.payment.kind === "refund") {
      expect(r.value.payment.refund.attemptState).toBe("settled_no_refund_due");
    }
  });

  it("a closure recorded without a governed reason refuses — the fee is never guessed", async () => {
    h.getCanonicalDelivery.mockResolvedValue({
      ok: true,
      value: { delivery: { id: "dlv-1", fulfillment_state: "cancelled", version: 3 } },
    });
    h.db.closureEvent = { command: "cancel_delivery", metadata: {} };

    const r = await cancelDeliveryWithRecovery({ ...baseArgs, reason: "merchant_request" });
    expect(r.ok).toBe(false);
    expect(h.refundPayment).toHaveBeenCalledTimes(0);
    expect(callsTo("couranr_cancel_delivery_request")).toHaveLength(0);
  });

  it("a stage recorded in custody refuses a failed_pickup settlement even on resume", async () => {
    h.getCanonicalDelivery.mockResolvedValue({
      ok: true,
      value: { delivery: { id: "dlv-1", fulfillment_state: "could_not_deliver", version: 4 } },
    });
    h.db.closureEvent = {
      command: "close_delivery_undeliverable",
      metadata: { governedReason: "failed_pickup", stageNote: "in_transit" },
    };
    const r = await cancelDeliveryWithRecovery({ ...baseArgs, reason: null });
    expect(r.ok).toBe(false);
    expect(h.refundPayment).toHaveBeenCalledTimes(0);
  });
});

describe("no-delivery cancellation stages from STORED facts (§4)", () => {
  it("confirmed + authorized: full release + the $8 receivable + request cancelled", async () => {
    h.db.request = { id: REQUEST_ID, request_state: "confirmed" };
    h.db.obligation = { id: "ob-1", payment_state: "authorized", provider_payment_intent_id: "pi_1" };

    const r = await cancelDeliveryWithRecovery({ ...baseArgs, reason: "merchant_request" });

    expect(r.ok).toBe(true);
    expect(h.releaseAuthorization).toHaveBeenCalledTimes(1);
    const rec = callsTo("couranr_record_cancellation_settlement");
    expect(rec).toHaveLength(1);
    expect(rec[0][1]).toMatchObject({ p_retained_due_cents: 800 });
    expect(callsTo("couranr_cancel_delivery_request")).toHaveLength(1);
    if (r.ok) {
      expect(r.value.payment.kind).toBe("released_with_receivable");
      expect(r.value.requestState).toBe("cancelled");
      if (r.value.payment.kind === "released_with_receivable") {
        expect(r.value.payment.retainedDueCents).toBe(800);
      }
    }
  });

  it("authorized but NOT confirmed: release at $0, NO receivable, request cancelled", async () => {
    h.db.request = { id: REQUEST_ID, request_state: "awaiting_quote_acceptance" };
    h.db.obligation = { id: "ob-1", payment_state: "authorized", provider_payment_intent_id: "pi_1" };

    const r = await cancelDeliveryWithRecovery({ ...baseArgs, reason: "customer_request" });

    expect(r.ok).toBe(true);
    expect(h.releaseAuthorization).toHaveBeenCalledTimes(1);
    expect(callsTo("couranr_record_cancellation_settlement")).toHaveLength(0);
    if (r.ok) {
      expect(r.value.payment.kind).toBe("released");
      expect(r.value.requestState).toBe("cancelled");
    }
  });

  it("couranr_caused stays $0 even when confirmed + authorized", async () => {
    h.db.request = { id: REQUEST_ID, request_state: "confirmed" };
    h.db.obligation = { id: "ob-1", payment_state: "authorized", provider_payment_intent_id: "pi_1" };

    const r = await cancelDeliveryWithRecovery({ ...baseArgs, reason: "couranr_caused" });

    expect(r.ok).toBe(true);
    expect(callsTo("couranr_record_cancellation_settlement")).toHaveLength(0);
    if (r.ok) expect(r.value.payment.kind).toBe("released");
  });

  it("no obligation at all: nothing at the provider, the request still terminates", async () => {
    h.db.request = { id: REQUEST_ID, request_state: "pending_couranr_review" };
    h.db.obligation = null;

    const r = await cancelDeliveryWithRecovery({ ...baseArgs, reason: "customer_request" });

    expect(r.ok).toBe(true);
    expect(h.releaseAuthorization).toHaveBeenCalledTimes(0);
    expect(callsTo("couranr_cancel_delivery_request")).toHaveLength(1);
    if (r.ok) {
      expect(r.value.payment.kind).toBe("none");
      expect(r.value.outcome).toBe("cancelled_request");
    }
  });

  it("captured with no delivery stays the stranded-shape refusal", async () => {
    h.db.request = { id: REQUEST_ID, request_state: "confirmed" };
    h.db.obligation = { id: "ob-1", payment_state: "captured", provider_payment_intent_id: "pi_1" };

    const r = await cancelDeliveryWithRecovery({ ...baseArgs, reason: "merchant_request" });
    expect(r.ok).toBe(false);
    expect(h.releaseAuthorization).toHaveBeenCalledTimes(0);
  });
});

describe("confirmed-before-delivery settlement is DURABLE across the release (B3-I §2)", () => {
  it("records the $8 settlement BEFORE the provider release", async () => {
    h.db.request = { id: REQUEST_ID, request_state: "confirmed" };
    h.db.obligation = { id: "ob-1", payment_state: "authorized", provider_payment_intent_id: "pi_1" };

    const r = await cancelDeliveryWithRecovery({ ...baseArgs, reason: "merchant_request" });
    expect(r.ok).toBe(true);
    // The durable settlement identity is established BEFORE any provider call.
    expect(h.order.indexOf("record_settlement")).toBe(0);
    expect(h.order.indexOf("release")).toBeGreaterThan(h.order.indexOf("record_settlement"));
  });

  it("§2A: retry after release succeeded but before request termination — the $8 is rediscovered from the receivable, not lost", async () => {
    // THE WORLD THE RETRY SEES: the settlement was recorded, the hold was
    // already released (so the obligation now reads `cancelled`), and the
    // request was never terminated. The OLD code keyed the $8 stage on
    // payment_state === 'authorized' and would DROP the receivable here.
    h.db.request = { id: REQUEST_ID, request_state: "confirmed" };
    h.db.obligation = { id: "ob-1", payment_state: "cancelled", provider_payment_intent_id: "pi_1" };
    h.db.settlementEvent = { id: "evt-receivable" };

    const r = await cancelDeliveryWithRecovery({ ...baseArgs, reason: "merchant_request" });

    expect(r.ok).toBe(true);
    // The $8 is re-established idempotently — never dropped because provider
    // state is now cancelled.
    const rec = callsTo("couranr_record_cancellation_settlement");
    expect(rec).toHaveLength(1);
    expect(rec[0][1]).toMatchObject({ p_retained_due_cents: 800, p_obligation_id: "ob-1" });
    // Release is idempotent (already cancelled) — exactly one call, no
    // duplicate provider mutation.
    expect(h.releaseAuthorization).toHaveBeenCalledTimes(1);
    // The request terminates.
    expect(callsTo("couranr_cancel_delivery_request")).toHaveLength(1);
    if (r.ok) {
      expect(r.value.payment.kind).toBe("released_with_receivable");
      expect(r.value.requestState).toBe("cancelled");
      if (r.value.payment.kind === "released_with_receivable") {
        expect(r.value.payment.retainedDueCents).toBe(800);
      }
    }
  });

  it("§2B: a provider release failure AFTER the settlement leaves the $8 durable and returns a retryable failure", async () => {
    h.db.request = { id: REQUEST_ID, request_state: "confirmed" };
    h.db.obligation = { id: "ob-1", payment_state: "authorized", provider_payment_intent_id: "pi_1" };
    h.releaseAuthorization.mockImplementation(async () => {
      h.order.push("release");
      return { ok: false, code: "internal", correlationId: "cr_x" };
    });

    const r = await cancelDeliveryWithRecovery({ ...baseArgs, reason: "merchant_request" });

    // The settlement was recorded BEFORE the release attempt, so it is durable.
    expect(h.order[0]).toBe("record_settlement");
    expect(callsTo("couranr_record_cancellation_settlement")).toHaveLength(1);
    // The release failed, so the op returns a failure to retry and does NOT
    // terminate the request — provider recovery continues safely next time.
    expect(r.ok).toBe(false);
    expect(callsTo("couranr_cancel_delivery_request")).toHaveLength(0);
  });

  it("§2C: provider already released on a previous attempt — the retry re-finds the SAME settlement, no second receivable, no second provider mutation", async () => {
    // Same shape as §2A (settlement stands, hold cancelled). This asserts the
    // no-duplicate property specifically: the record command is invoked exactly
    // once per attempt with the SAME obligation, and the SQL idempotency on
    // couranr:cancellation_receivable:<ob> (proven in paymentRecovery PR-29b)
    // guarantees a single receivable across all retries.
    h.db.request = { id: REQUEST_ID, request_state: "confirmed" };
    h.db.obligation = { id: "ob-1", payment_state: "cancelled", provider_payment_intent_id: "pi_1" };
    h.db.settlementEvent = { id: "evt-receivable" };

    const first = await cancelDeliveryWithRecovery({ ...baseArgs, reason: "merchant_request" });
    const second = await cancelDeliveryWithRecovery({ ...baseArgs, reason: "merchant_request" });

    expect(first.ok && second.ok).toBe(true);
    const rec = callsTo("couranr_record_cancellation_settlement");
    expect(rec).toHaveLength(2); // one per attempt — each idempotent at the DB
    expect(rec.every((c: any[]) => c[1].p_obligation_id === "ob-1")).toBe(true);
    // No refund path is taken (this is a released-hold receivable, not captured money).
    expect(h.refundPayment).toHaveBeenCalledTimes(0);
  });
});

describe("first-cancellation closure carries the saga evidence (§2)", () => {
  it("closure passes the governed reason, and a refund failure after closure names the resume", async () => {
    h.getCanonicalDelivery.mockResolvedValue({
      ok: true,
      value: { delivery: { id: "dlv-1", fulfillment_state: "assigned", version: 2 } },
    });
    h.refundPayment.mockResolvedValue({ ok: false, code: "internal", correlationId: "x" });

    const r = await cancelDeliveryWithRecovery({ ...baseArgs, reason: "merchant_request" });

    const closes = callsTo("couranr_cancel_delivery");
    expect(closes).toHaveLength(1);
    expect(closes[0][1]).toMatchObject({ p_governed_reason: "merchant_request" });
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.message).toContain("resumes this exact settlement");
    // The request is NOT cancelled while its money is unsettled.
    expect(callsTo("couranr_cancel_delivery_request")).toHaveLength(0);
  });
});

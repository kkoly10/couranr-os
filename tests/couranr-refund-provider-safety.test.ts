import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Provider-call safety for the TS refund layer (correction pass, review item 3).
 *
 * The SQL layer's duplicate protection is executed in
 * e2e/disposable/paymentRecovery.mjs (PR-15..17, PR-25) — these tests own the
 * OTHER half: the exact sequence of provider calls reconcileRefund and
 * refundPayment are allowed to make. The rule under test is absolute:
 *
 *   A provider READ failure — or a read that does not PROVE absence — ends the
 *   reconcile with ZERO provider write calls. Stripe idempotency keys expire
 *   after 24 hours, so an expired key is never duplicate protection; only a
 *   fully-read list with no match may reach refunds.create.
 */

const h = vi.hoisted(() => {
  const stripe = {
    refunds: {
      list: vi.fn<any>(),
      create: vi.fn<any>(),
    },
  };
  const rpc = vi.fn<any>();
  const db: { obligation: any; attempt: any } = { obligation: null, attempt: null };
  return { stripe, rpc, db };
});

vi.mock("@/lib/stripeClient", () => ({
  getStripeClient: () => h.stripe,
}));

vi.mock("@/lib/supabaseAdmin", () => {
  const chain = (table: string) => {
    const c: any = {};
    for (const m of ["select", "eq", "is", "in", "order", "limit"]) {
      c[m] = () => c;
    }
    c.maybeSingle = async () =>
      table === "couranr_payment_obligations"
        ? { data: h.db.obligation, error: null }
        : { data: h.db.attempt, error: null };
    return c;
  };
  return { supabaseAdmin: { from: (t: string) => chain(t), rpc: h.rpc } };
});

import { reconcileRefund } from "@/lib/couranr/fulfillment/commands";

const OPS = { kind: "operations", userId: "00000000-0000-4000-8000-000000000001" } as const;

const OBLIGATION = {
  id: "0b000000-0000-4000-8000-00000000000b",
  request_id: "0r000000-0000-4000-8000-00000000000r",
  business_account_id: null,
  payment_state: "captured",
  provider_payment_intent_id: "pi_test_1",
  version: 4,
  captured_amount_cents: 799,
  refunded_amount_cents: 0,
};

// An attempt persisted long ago — well outside any idempotency-key window.
const ATTEMPT = {
  id: "0f000000-0000-4000-8000-00000000000f",
  obligation_id: OBLIGATION.id,
  request_id: OBLIGATION.request_id,
  provider_payment_intent_id: "pi_test_1",
  provider_refund_id: null,
  amount_cents: 799,
  retained_cents: 0,
  reason: "full_refund",
  refund_key: "couranr:refund:11111111-1111-4111-8111-111111111111",
  attempt_state: "pending_unknown",
};

function rpcAnswers() {
  h.rpc.mockImplementation(async (fn: string) => {
    if (fn === "couranr_mark_payment_refund_unknown") {
      return { data: { ...ATTEMPT, attempt_state: "pending_unknown" }, error: null };
    }
    if (fn === "couranr_complete_payment_refund") {
      return {
        data: { ...ATTEMPT, attempt_state: "succeeded", provider_refund_id: "re_done" },
        error: null,
      };
    }
    return { data: null, error: { code: "XX000", message: `unexpected rpc ${fn}` } };
  });
}

function callsTo(fn: string) {
  return h.rpc.mock.calls.filter((c: any[]) => c[0] === fn);
}

beforeEach(() => {
  h.stripe.refunds.list.mockReset();
  h.stripe.refunds.create.mockReset();
  h.rpc.mockReset();
  h.db.obligation = { ...OBLIGATION };
  h.db.attempt = { ...ATTEMPT };
  rpcAnswers();
});

const args = {
  actor: OPS,
  requestId: OBLIGATION.request_id,
  businessAccountId: null as string | null,
};

describe("reconcileRefund never writes after an unknown read", () => {
  it("a provider LIST failure makes ZERO refunds.create calls and parks the attempt unknown", async () => {
    h.stripe.refunds.list.mockRejectedValue(
      Object.assign(new Error("ETIMEDOUT"), { type: "StripeConnectionError" })
    );

    const r = await reconcileRefund(args);

    expect(h.stripe.refunds.create).toHaveBeenCalledTimes(0);
    const marks = callsTo("couranr_mark_payment_refund_unknown");
    expect(marks).toHaveLength(1);
    expect(marks[0][1]).toMatchObject({ p_refund_id: ATTEMPT.id });
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.code).toBe("internal");
      expect(r.message).toContain("nothing was submitted");
      expect(r.message).toContain("Reconcile");
    }
    // The outcome remains unknown: no completion, no failure was recorded.
    expect(callsTo("couranr_complete_payment_refund")).toHaveLength(0);
  });

  it("a successful list with a metadata match converges on it — no create", async () => {
    h.stripe.refunds.list.mockResolvedValue({
      data: [
        { id: "re_other", amount: 100, status: "succeeded", metadata: { couranrRefundId: "not-us" } },
        { id: "re_ours", amount: 799, status: "succeeded", metadata: { couranrRefundId: ATTEMPT.id } },
      ],
      has_more: false,
    });

    const r = await reconcileRefund(args);

    expect(h.stripe.refunds.create).toHaveBeenCalledTimes(0);
    const completes = callsTo("couranr_complete_payment_refund");
    expect(completes).toHaveLength(1);
    expect(completes[0][1]).toMatchObject({
      p_refund_id: ATTEMPT.id,
      p_provider_refund_id: "re_ours",
      p_refund_status: "succeeded",
      p_amount_cents: 799,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.attemptState).toBe("succeeded");
  });

  it("a fully-read list with definitive absence submits exactly ONE create under the attempt's key", async () => {
    h.stripe.refunds.list.mockResolvedValue({ data: [], has_more: false });
    h.stripe.refunds.create.mockResolvedValue({ id: "re_new", amount: 799, status: "succeeded" });

    const r = await reconcileRefund(args);

    expect(h.stripe.refunds.create).toHaveBeenCalledTimes(1);
    const [createBody, createOpts] = h.stripe.refunds.create.mock.calls[0];
    expect(createBody).toMatchObject({
      payment_intent: ATTEMPT.provider_payment_intent_id,
      amount: ATTEMPT.amount_cents,
      metadata: { couranrRefundId: ATTEMPT.id, reason: ATTEMPT.reason },
    });
    expect(createOpts).toEqual({ idempotencyKey: ATTEMPT.refund_key });
    expect(callsTo("couranr_complete_payment_refund")).toHaveLength(1);
    expect(r.ok).toBe(true);
  });

  it("a list that cannot be read to the end (has_more at the page cap) makes zero creates", async () => {
    let n = 0;
    h.stripe.refunds.list.mockImplementation(async () => {
      n += 1;
      return {
        data: [{ id: `re_page_${n}`, amount: 1, status: "succeeded", metadata: {} }],
        has_more: true,
      };
    });

    const r = await reconcileRefund(args);

    expect(h.stripe.refunds.list.mock.calls.length).toBeGreaterThan(1);
    expect(h.stripe.refunds.create).toHaveBeenCalledTimes(0);
    expect(callsTo("couranr_mark_payment_refund_unknown")).toHaveLength(1);
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.message).toContain("absence is not proven");
  });

  it("pagination passes starting_after from the last row of each page", async () => {
    h.stripe.refunds.list
      .mockResolvedValueOnce({
        data: [{ id: "re_a", amount: 1, status: "succeeded", metadata: {} }],
        has_more: true,
      })
      .mockResolvedValueOnce({
        data: [{ id: "re_b", amount: 799, status: "succeeded", metadata: { couranrRefundId: ATTEMPT.id } }],
        has_more: true,
      });

    const r = await reconcileRefund(args);

    expect(h.stripe.refunds.list.mock.calls[1][0]).toMatchObject({ starting_after: "re_a" });
    expect(h.stripe.refunds.create).toHaveBeenCalledTimes(0);
    expect(r.ok).toBe(true);
  });

  it("a succeeded attempt short-circuits with zero provider calls", async () => {
    h.db.attempt = { ...ATTEMPT, attempt_state: "succeeded", provider_refund_id: "re_done" };

    const r = await reconcileRefund(args);

    expect(h.stripe.refunds.list).toHaveBeenCalledTimes(0);
    expect(h.stripe.refunds.create).toHaveBeenCalledTimes(0);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.attemptState).toBe("succeeded");
  });

  it("a completion failure after a MATCH returns — it never falls through to create", async () => {
    h.stripe.refunds.list.mockResolvedValue({
      data: [{ id: "re_ours", amount: 100, status: "succeeded", metadata: { couranrRefundId: ATTEMPT.id } }],
      has_more: false,
    });
    h.rpc.mockImplementation(async (fn: string) => {
      if (fn === "couranr_complete_payment_refund") {
        return { data: null, error: { code: "CR422", message: "refund_amount_mismatch" } };
      }
      return { data: null, error: { code: "XX000", message: `unexpected rpc ${fn}` } };
    });

    const r = await reconcileRefund(args);

    expect(h.stripe.refunds.create).toHaveBeenCalledTimes(0);
    expect(r.ok).toBe(false);
  });
});

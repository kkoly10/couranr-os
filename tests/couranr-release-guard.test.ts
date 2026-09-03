import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * B3-I §5 — the CAN-001 escape guard on `releaseAuthorization`.
 *
 * A generic hold release must NOT be usable on a normal authorized hold
 * attached to an ACTIVE CONFIRMED request: that hold's governed action is a
 * cancellation with the $8 receivable, not a technical release that walks away
 * from the settlement. The guard is server-side and reads the request state
 * itself (a route cannot bypass it by omitting a param). The governed
 * cancellation path opts out with `governedCancellation: true`, having already
 * recorded the settlement first.
 *
 * Only the database client and Stripe are mocked; the real releaseAuthorization
 * decides, so the guard — and its Stripe-never-called consequence — is proven.
 */

const h = vi.hoisted(() => ({
  rpc: vi.fn<any>(),
  stripeCancel: vi.fn<any>(),
  db: { obligation: null as any, request: null as any },
}));

vi.mock("@/lib/stripeClient", () => ({
  getStripeClient: () => ({
    paymentIntents: {
      cancel: h.stripeCancel,
      retrieve: h.stripeCancel,
    },
  }),
}));

vi.mock("@/lib/supabaseAdmin", () => {
  const chain = (table: string) => {
    const c: any = {};
    for (const m of ["select", "eq", "is", "in", "order", "limit"]) c[m] = () => c;
    c.maybeSingle = async () =>
      table === "couranr_payment_obligations"
        ? { data: h.db.obligation, error: null }
        : table === "couranr_delivery_requests"
          ? { data: h.db.request, error: null }
          : { data: null, error: null };
    return c;
  };
  return { supabaseAdmin: { from: (t: string) => chain(t), rpc: h.rpc } };
});

import { releaseAuthorization } from "@/lib/couranr/fulfillment/commands";

const OPS = { kind: "operations", userId: "00000000-0000-4000-8000-000000000001" } as const;
const REQUEST_ID = "0r000000-0000-4000-8000-00000000000r";

const base = {
  actor: OPS as any,
  requestId: REQUEST_ID,
  businessAccountId: null as string | null,
  reason: "operator release",
};

beforeEach(() => {
  h.rpc.mockReset();
  h.stripeCancel.mockReset();
  h.db.obligation = {
    id: "ob-1",
    request_id: REQUEST_ID,
    business_account_id: null,
    payment_state: "authorized",
    provider_payment_intent_id: "pi_1",
    version: 1,
  };
  h.db.request = { request_state: "confirmed" };
  // begin -> release proceeds; complete -> cancelled. Only reached when the
  // guard lets the release through.
  h.rpc.mockImplementation(async (fn: string) => {
    if (fn === "couranr_begin_payment_release") return { data: { outcome: "released" }, error: null };
    if (fn === "couranr_complete_payment_release") return { data: { outcome: "released" }, error: null };
    return { data: null, error: { code: "XX000", message: `unexpected ${fn}` } };
  });
  h.stripeCancel.mockResolvedValue({ status: "canceled" });
});

describe("release is refused on a confirmed + authorized hold (§5)", () => {
  it("refuses, names the CAN-001 remedy, and NEVER calls Stripe", async () => {
    const r = await releaseAuthorization({ ...base });
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.code).toBe("conflict");
      expect(r.message).toMatch(/governed Cancel action/i);
    }
    expect(h.stripeCancel).not.toHaveBeenCalled();
    // The guard fires BEFORE couranr_begin_payment_release — nothing is written.
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("the governed cancellation path IS allowed to release a confirmed hold", async () => {
    const r = await releaseAuthorization({ ...base, governedCancellation: true });
    expect(r.ok).toBe(true);
    expect(h.stripeCancel).toHaveBeenCalledTimes(1);
  });
});

describe("technical release stays available (§5)", () => {
  it("authorized but NOT confirmed releases normally (the $0 / stale-hold path)", async () => {
    h.db.request = { request_state: "awaiting_quote_acceptance" };
    const r = await releaseAuthorization({ ...base });
    expect(r.ok).toBe(true);
    expect(h.stripeCancel).toHaveBeenCalledTimes(1);
  });

  it("pending_couranr_review (a real recovery state) still releases", async () => {
    h.db.request = { request_state: "pending_couranr_review" };
    const r = await releaseAuthorization({ ...base });
    expect(r.ok).toBe(true);
    expect(h.stripeCancel).toHaveBeenCalledTimes(1);
  });

  it("an already-cancelled hold is idempotent success without reading the request or calling Stripe", async () => {
    h.db.obligation = { ...h.db.obligation, payment_state: "cancelled" };
    // Even for a confirmed request: a released hold is already released.
    const r = await releaseAuthorization({ ...base });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.paymentState).toBe("cancelled");
    expect(h.stripeCancel).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

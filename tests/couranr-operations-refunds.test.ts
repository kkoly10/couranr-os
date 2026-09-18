import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * OPS-011 refund review — the TypeScript half.
 *
 * `e2e/disposable/refundReview.mjs` owns the SQL half and CALLS every command
 * against a real PostgreSQL: the over-refund refusal, the idempotency, the
 * concurrency race, the ledger balance. This file owns what that suite cannot
 * see — the exact sequence of PROVIDER calls this path is allowed to make, and
 * the registry constraints that live in text rather than in a table.
 *
 * NO TEST HERE MAY REACH A REAL PROVIDER. Every provider operation runs
 * through an INJECTED gateway; the seam has no default value, so a test that
 * forgot to pass one would not compile rather than quietly dialling Stripe.
 */

const h = vi.hoisted(() => {
  const rpc = vi.fn<any>();
  const db: { review: any; obligation: any; attempt: any; request: any } = {
    review: null,
    obligation: null,
    attempt: null,
    request: null,
  };
  return { rpc, db };
});

vi.mock("@/lib/supabaseAdmin", () => {
  const chain = (table: string) => {
    const c: any = {};
    for (const m of ["select", "eq", "is", "in", "order", "limit"]) c[m] = () => c;
    c.maybeSingle = async () => {
      if (table === "couranr_refund_requests") return { data: h.db.review, error: null };
      if (table === "couranr_payment_obligations") return { data: h.db.obligation, error: null };
      if (table === "couranr_payment_refunds") return { data: h.db.attempt, error: null };
      return { data: h.db.request, error: null };
    };
    return c;
  };
  return { supabaseAdmin: { from: (t: string) => chain(t), rpc: h.rpc } };
});

import {
  REFUND_REQUEST_REASONS,
  REFUND_REQUEST_STATES,
  approveRefundRequest,
  denyRefundRequest,
  isRefundReviewFailure,
  parseRefundApproval,
  refundRequestIdempotencyKey,
} from "@/lib/couranr/operations/refunds";
import type { RefundGateway } from "@/lib/couranr/fulfillment/commands";

const OPS = { kind: "operations", userId: "00000000-0000-4000-8000-000000000001" } as const;
const MERCHANT = { kind: "member", userId: "00000000-0000-4000-8000-000000000002", membership: null } as const;
const RR_ID = "9130c8fc-dae2-4510-a401-48abae0d2dde";
const OB_ID = "11111111-1111-4111-8111-111111111111";
const REQ_ID = "22222222-2222-4222-8222-222222222222";
const ATTEMPT_ID = "33333333-3333-4333-8333-333333333333";

/** A gateway that records what it was asked to do and answers as told. */
function recordingGateway(over: Partial<RefundGateway> = {}) {
  const list = vi.fn<any>().mockResolvedValue({ data: [], has_more: false });
  const create = vi
    .fn<any>()
    .mockResolvedValue({ id: "re_probe", status: "succeeded", amount: 500 });
  return { list, create, ...over } as RefundGateway & { list: any; create: any };
}

/** A gateway that must never be touched. Using it is the failure. */
const forbiddenGateway: RefundGateway = {
  list: () => {
    throw new Error("the provider must not be contacted on this path");
  },
  create: () => {
    throw new Error("the provider must not be contacted on this path");
  },
};

function rpcAnswers(map: Record<string, any>) {
  h.rpc.mockImplementation(async (fn: string) => {
    if (fn in map) {
      const v = map[fn];
      if (v instanceof Error) return { data: null, error: { code: "CR409", message: v.message } };
      return { data: v, error: null };
    }
    return { data: null, error: { code: "CR404", message: `unexpected rpc ${fn}` } };
  });
}

const callsTo = (fn: string) => h.rpc.mock.calls.filter((c: any[]) => c[0] === fn);

beforeEach(() => {
  h.rpc.mockReset();
  h.db.review = {
    id: RR_ID,
    request_id: REQ_ID,
    obligation_id: OB_ID,
    incident_id: null,
    problem_report_id: null,
    requested_by: "customer",
    reason_code: "service_not_performed",
    detail: "",
    request_state: "processing",
    refundable_base_cents: 1000,
    approved_amount_cents: 500,
    denial_reason: null,
    decided_at: "2026-09-17T00:00:00Z",
    version: 3,
    created_at: "2026-09-17T00:00:00Z",
    refund_attempt_id: ATTEMPT_ID,
  };
  h.db.obligation = {
    id: OB_ID,
    captured_amount_cents: 1000,
    refunded_amount_cents: 0,
    payment_state: "captured",
    version: 4,
  };
  h.db.attempt = { id: ATTEMPT_ID, attempt_state: "succeeded", amount_cents: 500, retained_cents: 500 };
  h.db.request = { id: REQ_ID, reference: "CR-ABCD-1234" };
});

/* ------------------------------------------------------ the authority --- */

describe("REF-001 — only Couranr Operations can decide a refund", () => {
  it("a merchant cannot approve, and the provider is never contacted", async () => {
    const r = await approveRefundRequest({
      actor: MERCHANT as any,
      refundRequestId: RR_ID,
      expectedVersion: 1,
      requestedAmountCents: 500,
      gateway: forbiddenGateway,
    });
    expect(isRefundReviewFailure(r)).toBe(true);
    expect((r as any).code).toBe("not_permitted");
    expect(h.rpc).toHaveBeenCalledTimes(0);
  });

  it("a merchant cannot deny either", async () => {
    const r = await denyRefundRequest({
      actor: MERCHANT as any,
      refundRequestId: RR_ID,
      expectedVersion: 1,
      denialReason: "no",
    });
    expect(isRefundReviewFailure(r)).toBe(true);
    expect(h.rpc).toHaveBeenCalledTimes(0);
  });
});

/* -------------------------------------------- the amount never travels -- */

describe("the approved figure is a request, never an authority", () => {
  it("refuses a float, a string, a NaN and an Infinity before anything runs", () => {
    for (const bad of [12.5, "500", null, undefined, NaN, Infinity, -Infinity, {}]) {
      const p = parseRefundApproval({ expectedVersion: 1, approvedCents: bad }, RR_ID);
      expect(p.ok, String(bad)).toBe(false);
    }
  });

  it("refuses zero and negative figures", () => {
    for (const bad of [0, -1, -100000]) {
      expect(parseRefundApproval({ expectedVersion: 1, approvedCents: bad }, RR_ID).ok).toBe(false);
    }
  });

  it("refuses a missing or malformed version", () => {
    for (const bad of [undefined, 0, -1, 1.5, "3"]) {
      expect(parseRefundApproval({ expectedVersion: bad, approvedCents: 500 }, RR_ID).ok).toBe(false);
    }
  });

  it("accepts a whole number of cents and carries it through unchanged", () => {
    const p = parseRefundApproval({ expectedVersion: 2, approvedCents: 799 }, RR_ID);
    expect(p).toEqual({
      ok: true,
      refundRequestId: RR_ID,
      expectedVersion: 2,
      requestedAmountCents: 799,
    });
  });

  it("an obviously malformed figure never reaches the database", async () => {
    rpcAnswers({});
    const r = await approveRefundRequest({
      actor: OPS,
      refundRequestId: RR_ID,
      expectedVersion: 1,
      requestedAmountCents: 10.5,
      gateway: forbiddenGateway,
    });
    expect(isRefundReviewFailure(r)).toBe(true);
    expect(h.rpc).toHaveBeenCalledTimes(0);
  });
});

/* --------------------------------------------- the provider call order -- */

describe("the provider is reached only through the shared convergence path", () => {
  it("a settled attempt makes ZERO provider calls", async () => {
    rpcAnswers({
      couranr_approve_refund_request: { id: RR_ID, request_state: "approved" },
      couranr_begin_approved_refund: {
        id: ATTEMPT_ID,
        obligation_id: OB_ID,
        request_id: REQ_ID,
        provider_payment_intent_id: "pi_x",
        amount_cents: 500,
        retained_cents: 500,
        reason: "operations_reviewed_refund",
        refund_key: refundRequestIdempotencyKey(RR_ID, 1),
        attempt_state: "succeeded",
      },
    });
    const gateway = recordingGateway();
    const r = await approveRefundRequest({
      actor: OPS,
      refundRequestId: RR_ID,
      expectedVersion: 1,
      requestedAmountCents: 500,
      gateway,
    });
    expect(gateway.list).toHaveBeenCalledTimes(0);
    expect(gateway.create).toHaveBeenCalledTimes(0);
    expect(isRefundReviewFailure(r)).toBe(false);
  });

  it("a fresh attempt LISTS first, then creates exactly once, under the event-derived key", async () => {
    const key = refundRequestIdempotencyKey(RR_ID, 1);
    rpcAnswers({
      couranr_approve_refund_request: { id: RR_ID, request_state: "approved" },
      couranr_begin_approved_refund: {
        id: ATTEMPT_ID,
        obligation_id: OB_ID,
        request_id: REQ_ID,
        provider_payment_intent_id: "pi_x",
        amount_cents: 500,
        retained_cents: 500,
        reason: "operations_reviewed_refund",
        refund_key: key,
        attempt_state: "requested",
      },
      couranr_complete_payment_refund: { id: ATTEMPT_ID, attempt_state: "succeeded", amount_cents: 500, retained_cents: 500, reason: "operations_reviewed_refund" },
    });
    const gateway = recordingGateway();

    await approveRefundRequest({
      actor: OPS,
      refundRequestId: RR_ID,
      expectedVersion: 1,
      requestedAmountCents: 500,
      gateway,
    });

    expect(gateway.list).toHaveBeenCalledTimes(1);
    expect(gateway.create).toHaveBeenCalledTimes(1);
    // The key is the attempt's own, minted from the review's identity and the
    // version it was approved at — never from the clock.
    expect(gateway.create.mock.calls[0][1]).toEqual({ idempotencyKey: key });
    expect(gateway.create.mock.calls[0][0].amount).toBe(500);
  });

  it("a provider LIST failure makes ZERO create calls", async () => {
    rpcAnswers({
      couranr_approve_refund_request: { id: RR_ID, request_state: "approved" },
      couranr_begin_approved_refund: {
        id: ATTEMPT_ID,
        obligation_id: OB_ID,
        request_id: REQ_ID,
        provider_payment_intent_id: "pi_x",
        amount_cents: 500,
        retained_cents: 500,
        reason: "operations_reviewed_refund",
        refund_key: refundRequestIdempotencyKey(RR_ID, 1),
        attempt_state: "requested",
      },
      couranr_mark_payment_refund_unknown: { id: ATTEMPT_ID, attempt_state: "pending_unknown" },
    });
    const gateway = recordingGateway({
      list: vi.fn<any>().mockRejectedValue(Object.assign(new Error("ETIMEDOUT"), { type: "StripeConnectionError" })),
    } as any);

    const r = await approveRefundRequest({
      actor: OPS,
      refundRequestId: RR_ID,
      expectedVersion: 1,
      requestedAmountCents: 500,
      gateway,
    });

    expect((gateway as any).create).toHaveBeenCalledTimes(0);
    expect(callsTo("couranr_mark_payment_refund_unknown")).toHaveLength(1);
    expect(isRefundReviewFailure(r)).toBe(true);
  });

  it("an existing provider refund for this attempt converges WITHOUT a create", async () => {
    rpcAnswers({
      couranr_approve_refund_request: { id: RR_ID, request_state: "approved" },
      couranr_begin_approved_refund: {
        id: ATTEMPT_ID,
        obligation_id: OB_ID,
        request_id: REQ_ID,
        provider_payment_intent_id: "pi_x",
        amount_cents: 500,
        retained_cents: 500,
        reason: "operations_reviewed_refund",
        refund_key: refundRequestIdempotencyKey(RR_ID, 1),
        attempt_state: "requested",
      },
      couranr_complete_payment_refund: { id: ATTEMPT_ID, attempt_state: "succeeded", amount_cents: 500, retained_cents: 500, reason: "operations_reviewed_refund" },
    });
    const gateway = recordingGateway({
      list: vi.fn<any>().mockResolvedValue({
        data: [{ id: "re_already", amount: 500, status: "succeeded", metadata: { couranrRefundId: ATTEMPT_ID } }],
        has_more: false,
      }),
    } as any);

    await approveRefundRequest({
      actor: OPS,
      refundRequestId: RR_ID,
      expectedVersion: 1,
      requestedAmountCents: 500,
      gateway,
    });

    expect((gateway as any).create).toHaveBeenCalledTimes(0);
    expect(callsTo("couranr_complete_payment_refund")).toHaveLength(1);
  });

  it("an approval refused by the database never begins and never contacts the provider", async () => {
    rpcAnswers({ couranr_approve_refund_request: new Error("refund_amount_exceeds_refundable") });
    const gateway = recordingGateway();

    const r = await approveRefundRequest({
      actor: OPS,
      refundRequestId: RR_ID,
      expectedVersion: 1,
      requestedAmountCents: 999_999,
      gateway,
    });

    expect(isRefundReviewFailure(r)).toBe(true);
    expect(callsTo("couranr_begin_approved_refund")).toHaveLength(0);
    expect(gateway.list).toHaveBeenCalledTimes(0);
    expect(gateway.create).toHaveBeenCalledTimes(0);
  });

  it("a denial contacts no provider at all", async () => {
    rpcAnswers({ couranr_deny_refund_request: { id: RR_ID, request_state: "denied" } });
    const r = await denyRefundRequest({
      actor: OPS,
      refundRequestId: RR_ID,
      expectedVersion: 1,
      denialReason: "The delivery was completed and proven.",
    });
    expect(isRefundReviewFailure(r)).toBe(false);
    expect(callsTo("couranr_deny_refund_request")).toHaveLength(1);
  });

  it("a denial with no written reason never reaches the database", async () => {
    rpcAnswers({});
    const r = await denyRefundRequest({
      actor: OPS,
      refundRequestId: RR_ID,
      expectedVersion: 1,
      denialReason: "   ",
    });
    expect(isRefundReviewFailure(r)).toBe(true);
    expect(h.rpc).toHaveBeenCalledTimes(0);
  });
});

/* ---------------------------------------- the key minter and its twin --- */

describe("the idempotency key is event-derived and minted in one place", () => {
  it("is stable for the same review and version, and differs across versions", () => {
    expect(refundRequestIdempotencyKey(RR_ID, 1)).toBe(refundRequestIdempotencyKey(RR_ID, 1));
    expect(refundRequestIdempotencyKey(RR_ID, 1)).not.toBe(refundRequestIdempotencyKey(RR_ID, 2));
    expect(refundRequestIdempotencyKey(RR_ID, 1)).toBe(`couranr:refund-request:${RR_ID}:v1`);
  });

  it("carries nothing clock-derived", () => {
    const key = refundRequestIdempotencyKey(RR_ID, 7);
    expect(key).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(key).not.toMatch(/T\d{2}:\d{2}/);
  });

  it("the TypeScript minter and the SQL minter produce the SAME string", () => {
    // Drift between two independently-written minters is how a replay stops
    // converging. The SQL expression is read here rather than retyped.
    const sql = readFileSync(
      "supabase/migrations/20260917200000_couranr_refund_requests_ops011.sql",
      "utf8"
    );
    expect(sql).toContain(
      "'couranr:refund-request:' || v_rr.id::text || ':v' || (v_rr.version - 1)::text"
    );
    // The TypeScript side builds the identical shape.
    expect(refundRequestIdempotencyKey("ID", 9)).toBe("couranr:refund-request:ID:v9");
  });

  it("the command layer builds no refund idempotency key by hand", () => {
    const src = readFileSync("lib/couranr/operations/refunds.ts", "utf8");
    expect(src).not.toMatch(/idempotencyKey:\s*`/);
  });
});

/* ------------------------------------------------- the registry lines --- */

describe("the OPS-011 registry constraints hold in the code", () => {
  const migration = readFileSync(
    "supabase/migrations/20260917200000_couranr_refund_requests_ops011.sql",
    "utf8"
  );

  it("the seven states are EXACTLY the ones ui_screen_registry.json lists for OPS-011", () => {
    const registry = JSON.parse(readFileSync("ui_screen_registry.json", "utf8"));
    const screens: any[] = [];
    const walk = (o: any) => {
      if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === "object") {
        if (o.id === "OPS-011") screens.push(o);
        Object.values(o).forEach(walk);
      }
    };
    walk(registry);
    expect(screens).toHaveLength(1);

    const declared = String(screens[0].states)
      .split(";")
      .map((s) => s.trim().replace(/\.$/, "").toLowerCase().replace(/\s+/g, "_"))
      .filter(Boolean)
      .sort();
    expect([...REFUND_REQUEST_STATES].sort()).toEqual(declared);
  });

  it("the TypeScript reason vocabulary and the SQL CHECK cannot drift", () => {
    for (const reason of REFUND_REQUEST_REASONS) {
      expect(migration, reason).toContain(`'${reason}'`);
    }
    const checkBlock = migration.slice(
      migration.indexOf("couranr_rr_reason_chk"),
      migration.indexOf("couranr_rr_detail_chk")
    );
    const inSql = (checkBlock.match(/'([a-z_]+)'/g) ?? []).map((s) => s.replace(/'/g, ""));
    expect(inSql.sort()).toEqual([...REFUND_REQUEST_REASONS].sort());
  });

  it("REF-002 — no reason names merchandise; Couranr refunds the delivery charge only", () => {
    for (const reason of REFUND_REQUEST_REASONS) {
      expect(reason).not.toMatch(/product|merchandise|goods|item_price|damage/i);
    }
  });

  it("TRM-001 — no reason names lateness, an ETA or a delivery window", () => {
    for (const reason of REFUND_REQUEST_REASONS) {
      expect(reason).not.toMatch(/late|delay|eta|on_time|window|slow|miss/i);
    }
  });

  it("no surface on this slice claims a delivery-time guarantee", () => {
    /*
     * COMMENTS ARE STRIPPED FIRST. Several of these files quote TRM-001's
     * never_claim list verbatim to explain why the rule exists, and a naive
     * grep flags exactly those — which is the false positive that teaches
     * people to ignore a gate. `checkMigrationsDestructive.mjs` learned the
     * same lesson; this uses the same technique. What ships to a person is
     * the CODE, so the code is what is scanned.
     */
    const stripComments = (sql: string) =>
      sql
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .split("\n")
        .map((line) => {
          const i = line.indexOf("//");
          return i === -1 ? line : line.slice(0, i);
        })
        .join("\n");

    const files = [
      "app/(couranr)/operations/refunds/page.tsx",
      "components/couranr/operations/refunds/RefundsWorkspace.tsx",
      "components/couranr/operations/refunds/client.ts",
      "lib/couranr/operations/refunds.ts",
    ];

    for (const f of files) {
      const src = stripComments(readFileSync(f, "utf8"));
      // TRM-001 never_claim, plus the family of phrasings that imply it.
      expect(src, f).not.toMatch(/guarantee/i);
      expect(src, f).not.toMatch(/on-?time|by \d+ ?(am|pm)|within \d+ (minutes|hours)/i);
      expect(src, f).not.toMatch(/24\/7 support|buyer protection|trusted by thousands/i);
    }
  });

  it("POSITIVE CONTROL: that scan really can go red", () => {
    const stripComments = (sql: string) =>
      sql.replace(/\/\*[\s\S]*?\*\//g, " ");
    // A comment is invisible to it...
    expect(stripComments("/* on-time guarantee */ const a = 1;")).not.toMatch(/guarantee/i);
    // ...and real copy is not.
    expect(stripComments('const c = "our on-time guarantee";')).toMatch(/guarantee/i);
  });

  it("the screen offers no control that would refund merchandise", () => {
    const panel = readFileSync(
      "components/couranr/operations/refunds/RefundsWorkspace.tsx",
      "utf8"
    );
    expect(panel).not.toMatch(/refund the product|product refund amount|merchandise refund/i);
    // and it says whose job that is
    expect(panel).toMatch(/merchant controls/i);
  });

  it("the migration widens the reason CHECK rather than replacing the old vocabulary", () => {
    for (const legacy of [
      "full_refund",
      "cancel_before_confirmation",
      "cancel_after_confirmation_before_arrival",
      "failed_pickup_after_arrival",
      "couranr_caused_failure",
    ]) {
      expect(migration).toContain(`'${legacy}'`);
    }
    expect(migration).toContain("'operations_reviewed_refund'");
  });

  it("the migration never clamps — it refuses", () => {
    expect(migration).toContain("refund_amount_exceeds_refundable");
    // The structural twin: an over-base figure is unwritable.
    expect(migration).toContain("couranr_rr_amount_within_base_chk");
    // No clamp anywhere on the approval path.
    const approveBlock = migration.slice(
      migration.indexOf("function public.couranr_approve_refund_request"),
      migration.indexOf("function public.couranr_begin_approved_refund")
    );
    expect(approveBlock).not.toMatch(/\bleast\s*\(/i);
    expect(approveBlock).not.toMatch(/\bgreatest\s*\(/i);
  });
});

/* ------------------------------------------------- the provider seam ---- */

describe("the provider seam has no default", () => {
  it("no refund function reaches a provider client by omission", () => {
    const src = readFileSync("lib/couranr/fulfillment/commands.ts", "utf8");
    // The gateway parameter is never given a default value.
    expect(src).not.toMatch(/gateway:\s*RefundGateway\s*=/);
    expect(src).not.toMatch(/gateway\s*\?\?\s*/);
    // The convergence path uses the injected gateway, never the module client.
    const converge = src.slice(
      src.indexOf("export async function convergeRefundAttemptWithProvider"),
      src.indexOf("async function submitAndCompleteRefund")
    );
    expect(converge).toContain("gateway.list(");
    expect(converge).not.toContain("getStripeClient()");
  });

  it("only the named factory constructs the real client", () => {
    const src = readFileSync("lib/couranr/fulfillment/commands.ts", "utf8");
    const refundsSection = src.slice(src.indexOf("/* ------------------------------------------------- the provider seam ---- */"));
    const hits = (refundsSection.match(/getStripeClient\(\)\.refunds/g) ?? []).length;
    expect(hits).toBe(2); // exactly list and create, inside stripeRefundGateway
  });

  it("the OPS-011 server module never builds a provider client of its own", () => {
    const src = readFileSync("lib/couranr/operations/refunds.ts", "utf8");
    expect(src).not.toContain("getStripeClient");
    expect(src).not.toContain("stripeRefundGateway");
    expect(src).not.toContain("from \"stripe\"");
  });
});

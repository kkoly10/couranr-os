import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: db }));

import { readHelpResolutionPolicy } from "@/lib/couranr/conversations/helpResolution";

function row(value: Record<string, unknown>) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: value, error: null })) })),
    })),
  };
}

describe("delivered Delivery Help requester projection", () => {
  beforeEach(() => db.from.mockReset());

  it.each(["business", "consumer"] as const)("reads %s requester from the bound request", async (kind) => {
    db.from
      .mockReturnValueOnce(row({ fulfillment_state: "delivered", request_id: "request-1" }))
      .mockReturnValueOnce(row({ requester_kind: kind }));

    const policy = await readHelpResolutionPolicy("delivery-1");
    expect(policy.available).toBe(true);
    if (!policy.available) return;
    if (kind === "consumer") {
      expect(policy.policySummary).toContain("ask the seller");
      expect(policy.policySummary).not.toContain("selling business's responsibility");
    } else {
      expect(policy.policySummary).toContain("selling business's responsibility");
    }
    expect(db.from.mock.calls.map(([table]) => table)).toEqual([
      "couranr_deliveries",
      "couranr_delivery_requests",
    ]);
  });

  it("does not add a requester read to an active custody review", async () => {
    db.from.mockReturnValueOnce(row({ fulfillment_state: "in_transit", request_id: "request-1" }));
    const policy = await readHelpResolutionPolicy("delivery-1");
    expect(policy.available && policy.requestKind).toBe("return_review");
    expect(db.from).toHaveBeenCalledTimes(1);
    expect(db.from).toHaveBeenCalledWith("couranr_deliveries");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * OPS-012 — the IO half of the custody read, and the only behaviour that
 * cannot be tested through the pure builder: what happens when a query FAILS.
 *
 * This is the defect class the repo has already shipped twice — a failed
 * lookup rendered as an empty result. A returning merchant was told they had
 * no business; a merchant would have been told their driver photographed
 * nothing. Here it would be worse: an investigator deciding a damage claim
 * would be told no security seal was applied, when in truth the seal table
 * could not be read.
 *
 * So the invariant is not "the read succeeds". It is: **a section that errored
 * is NAMED, and the bundle still carries everything that did read.**
 */

const h = vi.hoisted(() => ({
  /** table -> { data, error } */
  responses: new Map<string, { data: any; error: any }>(),
  /** tables actually queried, in order */
  queried: [] as string[],
}));

vi.mock("@/lib/supabaseAdmin", () => {
  function builder(table: string) {
    const b: any = {
      select: () => b,
      eq: () => b,
      neq: () => b,
      in: () => b,
      order: () => b,
      limit: () => b,
      maybeSingle: () => Promise.resolve(answer(table)),
      then: (f: any, r: any) => Promise.resolve(answer(table)).then(f, r),
    };
    return b;
  }
  function answer(table: string) {
    h.queried.push(table);
    return h.responses.get(table) ?? { data: null, error: null };
  }
  return { supabaseAdmin: { from: (t: string) => builder(t) } };
});

import { isCustodyFailure, readCustodyBundle } from "@/lib/couranr/operations/custodyBundle";

const OPS: any = { kind: "operations", userId: "00000000-0000-4000-8000-0000000000a1" };
const DELIVERY_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";

function seedHappyPath() {
  h.responses.set("couranr_deliveries", {
    data: { id: DELIVERY_ID, request_id: REQUEST_ID, fulfillment_state: "delivered" },
    error: null,
  });
  h.responses.set("couranr_delivery_requests", {
    data: {
      id: REQUEST_ID,
      reference: "CR-7Q2M-4KDX",
      requester_kind: "consumer",
      declared_value_cents: 24000,
      protection_level: "protected_handoff",
      protection_policy_version: "couranr-protection-v1-2026-09-01",
      pickup_manifest: { description: "Two sealed bottles", source: "consumer_statement" },
    },
    error: null,
  });
  h.responses.set("couranr_delivery_proofs", { data: [], error: null });
  h.responses.set("couranr_delivery_security_seals", { data: null, error: null });
  h.responses.set("couranr_recipient_identity_verifications", { data: null, error: null });
  h.responses.set("couranr_handoff_records", { data: [], error: null });
  h.responses.set("couranr_handoff_codes", { data: [], error: null });
  h.responses.set("couranr_customer_problem_reports", { data: [], error: null });
  h.responses.set("couranr_customer_problem_evidence", { data: [], error: null });
  h.responses.set("couranr_delivery_incidents", { data: [], error: null });
}

beforeEach(() => {
  h.responses.clear();
  h.queried = [];
  seedHappyPath();
});

describe("readCustodyBundle fails closed, section by section", () => {
  it("reads the whole chain when every query succeeds", async () => {
    const r = await readCustodyBundle({ actor: OPS, deliveryId: DELIVERY_ID });
    expect(isCustodyFailure(r)).toBe(false);
    const b = (r as any).value;
    expect(b.deliveryId).toBe(DELIVERY_ID);
    expect(b.declaration.declaredValueCents).toBe(24000);
    // Nothing errored, so nothing is named — and the empty seal is a REAL
    // absence that the screen may state as such.
    expect(b.unavailable).toEqual([]);
    expect(b.seal).toBeNull();
  });

  /**
   * The load-bearing test. A seal table that cannot be read must not become
   * "no seal was applied" on the screen an investigator decides a claim on.
   */
  it("names a failed section instead of returning it as empty", async () => {
    h.responses.set("couranr_delivery_security_seals", {
      data: null,
      error: { code: "42P01", message: 'relation "couranr_delivery_security_seals" does not exist' },
    });

    const r = await readCustodyBundle({ actor: OPS, deliveryId: DELIVERY_ID });
    expect(isCustodyFailure(r)).toBe(false);
    const b = (r as any).value;
    expect(b.unavailable).toContain("seal");
    expect(b.seal).toBeNull();
    // Everything that DID read still comes back. A single unreadable table
    // must not cost the investigator the other twelve facts.
    expect(b.declaration.declaredValueCents).toBe(24000);
    expect(b.declaration.description).toBe("Two sealed bottles");
  });

  it("names every failed section, not just the first", async () => {
    for (const t of [
      "couranr_delivery_security_seals",
      "couranr_recipient_identity_verifications",
      "couranr_delivery_incidents",
    ]) {
      h.responses.set(t, { data: null, error: { code: "42501", message: "permission denied" } });
    }
    const b = (await readCustodyBundle({ actor: OPS, deliveryId: DELIVERY_ID })) as any;
    expect(b.value.unavailable.sort()).toEqual(["identity", "incidents", "seal"]);
  });

  it("never leaks the driver message into the bundle", async () => {
    h.responses.set("couranr_delivery_security_seals", {
      data: null,
      error: { code: "42P01", message: 'relation "couranr_delivery_security_seals" does not exist' },
    });
    const b = (await readCustodyBundle({ actor: OPS, deliveryId: DELIVERY_ID })) as any;
    const json = JSON.stringify(b.value);
    expect(json).not.toContain("does not exist");
    expect(json).not.toContain("42P01");
    expect(json).not.toContain("relation");
  });

  /**
   * `couranr_deliveries.request_id` is NOT NULL behind an ON DELETE RESTRICT
   * foreign key, so a null request row is a surprise — and a surprise that
   * would otherwise render as "no protection policy applied to this shipment"
   * rather than "the declaration could not be read".
   */
  it("treats a missing request row as unreadable, not as an ungoverned shipment", async () => {
    h.responses.set("couranr_delivery_requests", { data: null, error: null });
    const b = (await readCustodyBundle({ actor: OPS, deliveryId: DELIVERY_ID })) as any;
    expect(b.value.unavailable).toContain("request");
    expect(b.value.declaration.protectionGoverned).toBe(false);
  });

  it("refuses rather than inventing a bundle when the delivery cannot be read", async () => {
    h.responses.set("couranr_deliveries", {
      data: null,
      error: { code: "40001", message: "could not serialize access" },
    });
    const r = await readCustodyBundle({ actor: OPS, deliveryId: DELIVERY_ID });
    expect(isCustodyFailure(r)).toBe(true);
    expect((r as any).code).toBe("internal");
    expect((r as any).correlationId).toMatch(/^cr_/);
  });

  it("answers not_found for a delivery that does not exist", async () => {
    h.responses.set("couranr_deliveries", { data: null, error: null });
    const r = await readCustodyBundle({ actor: OPS, deliveryId: DELIVERY_ID });
    expect(isCustodyFailure(r)).toBe(true);
    expect((r as any).code).toBe("not_found");
  });

  it("does not query claim evidence when there are no claims", async () => {
    await readCustodyBundle({ actor: OPS, deliveryId: DELIVERY_ID });
    expect(h.queried).not.toContain("couranr_customer_problem_evidence");
    // …and does query it when there is one.
    h.queried = [];
    h.responses.set("couranr_customer_problem_reports", {
      data: [
        {
          id: "66666666-6666-4666-8666-666666666666",
          problem_type: "damaged",
          details: "cracked",
          report_state: "under_review",
          submitted_at: null,
          resolved_at: null,
          version: 1,
        },
      ],
      error: null,
    });
    await readCustodyBundle({ actor: OPS, deliveryId: DELIVERY_ID });
    expect(h.queried).toContain("couranr_customer_problem_evidence");
  });

  it("reads exactly the ten tables the bundle is made of, and no others", async () => {
    h.queried = [];
    await readCustodyBundle({ actor: OPS, deliveryId: DELIVERY_ID });
    // Nine on the empty-claims path; the tenth only when a claim exists.
    expect([...new Set(h.queried)].sort()).toEqual([
      "couranr_customer_problem_reports",
      "couranr_deliveries",
      "couranr_delivery_incidents",
      "couranr_delivery_proofs",
      "couranr_delivery_requests",
      "couranr_delivery_security_seals",
      "couranr_handoff_codes",
      "couranr_handoff_records",
      "couranr_recipient_identity_verifications",
    ]);
  });

  it("refuses a caller who is not Couranr Operations before it reads anything", async () => {
    h.queried = [];
    const r = await readCustodyBundle({
      actor: { kind: "member", userId: "u", membership: null } as any,
      deliveryId: DELIVERY_ID,
    });
    expect(isCustodyFailure(r)).toBe(true);
    expect((r as any).code).toBe("not_permitted");
    // The gate is BEFORE the read, not a filter applied after it.
    expect(h.queried).toEqual([]);
  });
});

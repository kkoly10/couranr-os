import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PROOF_METHODS,
  SELECTABLE_PROOF_METHODS,
  isNormalizeFailure,
  isSelectableProofMethod,
  normalizeDeliveryRequestInput,
} from "@/lib/couranr/requests/input";
import { VALID } from "./fixtures/validDeliveryRequest";

/**
 * P10-015 — leave-at-door is withdrawn from NEW requests, and only from new ones.
 *
 * PRF-001 requires a recorded CUSTOMER AUTHORIZATION before anything is left at
 * a door. No such fact exists anywhere in the schema —
 * `couranr_complete_leave_at_door_delivery` admits it in its own header — so
 * Couranr was offering a method it could not honour. Production carried two
 * business requests using it and one delivery already at pickup.
 *
 * THE SHAPE OF THE FIX IS THE POINT. Two vocabularies, not one:
 * PROOF_METHODS stays complete because live rows carry `leave_at_door` and the
 * driver still has to complete that delivery; SELECTABLE_PROOF_METHODS is what
 * a NEW request may choose. Collapsing them would force a choice between
 * offering a method Couranr cannot keep and stranding a delivery in flight.
 */
const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const codes = (raw: unknown) => {
  const r = normalizeDeliveryRequestInput(raw);
  return isNormalizeFailure(r) ? r.errors.map((e) => e.code) : [];
};

describe("the two vocabularies are distinct and neither is collapsed", () => {
  it("keeps every historical method, so nothing in flight is orphaned", () => {
    expect([...PROOF_METHODS].sort()).toEqual(["leave_at_door", "photo_or_pin", "signature"]);
  });

  it("offers a strict subset for new requests", () => {
    expect([...SELECTABLE_PROOF_METHODS].sort()).toEqual(["photo_or_pin", "signature"]);
    for (const m of SELECTABLE_PROOF_METHODS) {
      expect(PROOF_METHODS).toContain(m);
    }
    expect(isSelectableProofMethod("leave_at_door")).toBe(false);
    expect(isSelectableProofMethod("photo_or_pin")).toBe(true);
  });
});

describe("a NEW request cannot choose leave-at-door", () => {
  it("accepts photo_or_pin", () => {
    expect(codes({ ...VALID, proofMethod: "photo_or_pin" })).toEqual([]);
  });

  it("accepts signature", () => {
    expect(codes({ ...VALID, proofMethod: "signature" })).toEqual([]);
  });

  it("refuses leave_at_door as CURRENTLY UNAVAILABLE, not as unknown", () => {
    /* The distinction step 3 requires. `leave_at_door` is a real method that
       live rows carry; calling it unknown would tell a merchant their input was
       malformed and would make a temporary withdrawal indistinguishable from a
       client bug in a log. */
    const c = codes({ ...VALID, proofMethod: "leave_at_door" });
    expect(c).toContain("proof_method_currently_unavailable");
    expect(c).not.toContain("unknown_proof_method");
  });

  it("still calls a genuinely unknown method unknown", () => {
    // POSITIVE CONTROL for the distinction above.
    const c = codes({ ...VALID, proofMethod: "carrier_pigeon" });
    expect(c).toContain("unknown_proof_method");
    expect(c).not.toContain("proof_method_currently_unavailable");
  });

  it("refuses it however the value arrives — stale client, direct API, any caller", () => {
    /* There is ONE gate and every new-request path reaches it, so these are the
       same assertion from different doors: a stale browser tab still holding the
       old option, a direct POST that never rendered a form, a duplicate
       prefilled from an older delivery, and a saved preset. */
    for (const raw of [
      { ...VALID, proofMethod: "leave_at_door" },
      { ...VALID, proofMethod: " leave_at_door " },
      { ...VALID, proofMethod: "leave_at_door", __stale_client: true },
    ]) {
      expect(codes(raw), JSON.stringify(raw.proofMethod)).toContain(
        "proof_method_currently_unavailable"
      );
    }
  });
});

describe("every creation path shares the one gate", () => {
  const COMMANDS = read("lib/couranr/requests/commands.ts");

  it("merchant create, estimate and submit all normalize", () => {
    const uses = [...COMMANDS.matchAll(/normalizeDeliveryRequestInput\(/g)];
    expect(uses.length, "a creation path stopped normalizing").toBeGreaterThanOrEqual(3);
  });

  it("OPERATIONS cannot bypass it by holding broader write authority", () => {
    /* Operations-assisted creation goes through createDeliveryRequestDraft, the
       same function and the same normalizer. Broader access lets Operations act
       for a merchant; it does not let them manufacture a customer authorization
       that does not exist. */
    const draft = COMMANDS.slice(COMMANDS.indexOf("createDeliveryRequestDraft"));
    expect(draft).toMatch(/writeAuthority === "operations"/);
    const normalizeAt = draft.indexOf("normalizeDeliveryRequestInput(");
    expect(normalizeAt, "the operations path no longer normalizes").toBeGreaterThan(-1);
    expect(read("app/api/couranr/operations/delivery-requests/route.ts")).toMatch(
      /createDeliveryRequestDraft\(/
    );
  });

  it("the hosted path can never produce it at all", () => {
    /* Hosted derives proof_method from a boolean, so `leave_at_door` is not in
       its range — a different shape of the same guarantee. */
    const sql = read("supabase/migrations/20260905040000_couranr_hosted_request_v1.sql");
    expect(sql).toMatch(/proof_method=case when coalesce\(p_signature_required,false\)/);
    expect(sql).not.toMatch(/proof_method\s*=\s*'leave_at_door'/);
  });
});

describe("the merchant form", () => {
  const FLOW = read("components/couranr/requests/NewDeliveryFlow.tsx");
  const code = FLOW.replace(/\{\/\*[\s\S]*?\*\/\}/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");

  it("no longer offers leave at door", () => {
    expect(code, "the merchant form still offers leave at door").not.toMatch(
      /<option value="leave_at_door"/
    );
    expect(code, "the options are typed rather than derived").toMatch(
      /SELECTABLE_PROOF_METHODS\.map/
    );
  });

  it("normalizes a duplicate or preset carrying it, and says so rather than silently", () => {
    /* Step 5's rule: a safe default is acceptable only if the merchant is shown
       the substitution. Silently switching someone's chosen proof method is its
       own defect. */
    expect(code).toMatch(/isSelectableProofMethod\(seed\.proofMethod\)/);
    expect(code).toMatch(/setWithdrawnProofMethod\(seed\.proofMethod\)/);
    expect(code).toMatch(/data-couranr-proof-withdrawn/);
    expect(FLOW).toMatch(/no longer available/i);
  });

  it("never rewrites the saved preset itself", () => {
    /* The preset keeps its history; only the new request is normalized.
       ASSIGNMENT, not comparison: the first version of this regex was
       `seed\.proofMethod\s*=` and matched `seed.proofMethod === "string"`,
       reading an equality test as a write. A single `=` not followed by another
       is the actual assignment. */
    expect(code).not.toMatch(/seed\.proofMethod\s*=(?!=)/);
  });
});

describe("what must NOT have changed", () => {
  it("the existing completion command is untouched, so the in-flight delivery completes", () => {
    /* A delivery already frozen as leave_at_door must remain completable. The
       command is not modified by this batch, and nothing added here reads or
       rewrites a stored proof_method. */
    const sql = read("supabase/migrations/20260802060000_couranr_dispatch_driver_completion_commands.sql");
    expect(sql).toContain("function public.couranr_complete_leave_at_door_delivery");
    const later = read("lib/couranr/driver/states.ts");
    expect(later, "driver execution stopped recognising the historical method").toContain(
      "leave_at_door"
    );
  });

  it("no migration in this batch narrows the stored proof-method vocabulary", () => {
    const dir = path.join(ROOT, "supabase/migrations");
    const { readdirSync } = require("node:fs");
    const offenders = readdirSync(dir)
      .filter((f: string) => f.endsWith(".sql"))
      .filter((f: string) => {
        const sql = readFileSync(path.join(dir, f), "utf8");
        return /proof_method\s+in\s*\(/i.test(sql) && !/leave_at_door/.test(sql);
      });
    expect(offenders, "a migration dropped leave_at_door from a stored vocabulary").toEqual([]);
  });

  it("Consumer Same Day is unchanged and was never exposed", () => {
    const send = read("lib/couranr/consumer/send.ts");
    expect(send).toMatch(/p_proof_method:\s*"photo_or_pin"/);
    expect(send).not.toMatch(/leave_at_door/);
  });
});

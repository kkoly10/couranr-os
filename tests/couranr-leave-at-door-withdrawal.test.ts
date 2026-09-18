import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
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

/* ════════════ the HISTORICAL CONVERSION gap (P10-015, second half) ═══════ */

describe("a historical request cannot MATERIALIZE a withdrawn-method delivery", () => {
  /*
   * Withdrawing leave_at_door from INTAKE did not close the whole gap. A request
   * stored before the withdrawal keeps its frozen proof method, and both
   * settlement paths copy it onto a brand new delivery. Production carries
   * exactly such a row: confirmed, ready, leave_at_door, no delivery.
   *
   * BEHAVIOUR is proved by execution against real PostgreSQL in
   * e2e/disposable/withdrawnProofConversion.mjs — including that the
   * grandfathered delivery is still returned idempotently and that moving the
   * guard one step earlier breaks it. What THIS file proves is that every entry
   * point is wired to the shared guard, which a SQL probe cannot see.
   */
  const FULFILLMENT = read("lib/couranr/fulfillment/commands.ts");
  const code = FULFILLMENT.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

  it("there is ONE shared guard, not a copy per path", () => {
    const defs = [...code.matchAll(/async function refuseUnavailableProofMethodConversion\(/g)];
    expect(defs.length, "the guard was duplicated").toBe(1);
  });

  it("it checks for an EXISTING delivery before it looks at the proof method", () => {
    /* The grandfather clause. Reversing these two reads would refuse the
       delivery already at pickup — proved red by a negative control in the
       disposable probe. */
    const body = code.slice(code.indexOf("async function refuseUnavailableProofMethodConversion("));
    const existing = body.indexOf('.from("couranr_deliveries")');
    const method = body.indexOf('.from("couranr_delivery_requests")');
    expect(existing).toBeGreaterThan(-1);
    expect(method).toBeGreaterThan(-1);
    expect(existing, "the guard reads the proof method before checking for a delivery")
      .toBeLessThan(method);
    expect(body).toMatch(/isSelectableProofMethod\(method\)/);
    expect(body).toMatch(/proof_method_currently_unavailable/);
  });

  it("ALL THREE entry points call it — capture, operations credit, automatic worker", () => {
    /* Three call sites plus one definition. The automatic worker is the one
       that matters most: it runs unattended on a cron tick, so a path it could
       take alone is a path nobody watches. */
    const calls = [...code.matchAll(/await refuseUnavailableProofMethodConversion\(/g)];
    expect(calls.length, "an entry point is not guarded").toBe(3);

    for (const fn of [
      "convertAfterCapture",
      "createDeliveryFromPromotionalCredit",
      "createDeliveryFromPromotionalCreditForAutomation",
    ]) {
      const at = code.indexOf(fn === "createDeliveryFromPromotionalCredit"
        ? "export async function createDeliveryFromPromotionalCredit(params"
        : fn === "createDeliveryFromPromotionalCreditForAutomation"
          ? "export async function createDeliveryFromPromotionalCreditForAutomation("
          : "async function convertAfterCapture(");
      expect(at, `${fn} not found`).toBeGreaterThan(-1);
      const body = code.slice(at, at + 1600);
      const guard = body.indexOf("refuseUnavailableProofMethodConversion(");
      const rpc = body.indexOf("callRpc(");
      const rpcAlt = body.indexOf("callRpc<");
      const firstRpc = [rpc, rpcAlt].filter((i) => i > -1).sort((a, b) => a - b)[0];
      expect(guard, `${fn} does not call the guard`).toBeGreaterThan(-1);
      expect(guard, `${fn} calls the RPC before the guard`).toBeLessThan(firstRpc);
    }
  });

  it("the database backstop exists and is UNAPPLIED", () => {
    const m = read("supabase/migrations/20260918010000_couranr_withdrawn_proof_method_conversion.sql");
    // Both settlement functions replaced by name, each with the refusal.
    expect(m).toContain("function public.couranr_create_delivery_from_capture(");
    expect(m).toContain("function public.couranr_create_delivery_from_promotional_credit(");
    expect([...m.matchAll(/proof_method_currently_unavailable/g)].length).toBe(2);
    /* The ordering that grandfathers the in-flight delivery: the existing
       delivery is returned before the refusal is reached, in BOTH functions. */
    for (const part of m.split("create or replace function").slice(1)) {
      const ret = part.indexOf("if found then return v_d; end if;");
      const refuse = part.indexOf("proof_method_currently_unavailable");
      expect(ret, "a function lost its idempotent return").toBeGreaterThan(-1);
      expect(ret, "the refusal precedes the existing-delivery return").toBeLessThan(refuse);
    }
    expect(
      existsSync(path.join(ROOT, "supabase/rollbacks/20260918010000_couranr_withdrawn_proof_method_conversion.rollback.sql"))
    ).toBe(true);
  });

  it("does not touch the driver's completion command", () => {
    /* EXECUTABLE SQL ONLY. The migration's header says in prose that the
       completion command is deliberately untouched, so a raw scan matches the
       promise instead of checking it — the fourth time this repo has caught
       that shape. Comments stripped, then asserted. */
    const m = read("supabase/migrations/20260918010000_couranr_withdrawn_proof_method_conversion.sql")
      .replace(/^\s*--.*$/gm, " ")
      .replace(/\/\*[\s\S]*?\*\//g, " ");
    expect(m).not.toContain("couranr_complete_leave_at_door_delivery");
    // Non-vacuous: the stripper left the executable statements intact.
    expect(m).toContain("function public.couranr_create_delivery_from_capture(");
  });
});

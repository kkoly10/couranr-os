import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { validateRouteDraft } from "../lib/couranr/routeRuns/draft";
import { ROUTE_RUN_V1_AGGREGATE_DECLARED_VALUE_LIMIT_CENTS, inspectRouteAdmission, routeSettlementRecovery, type RouteAdmissionInput } from "../lib/couranr/routeRuns/admission";
const id = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const draft = { routeRunId: id(1), idempotencyKey: id(2), expectedVersion: 0,
  title: "Stafford route", requestIds: [id(3), id(4)] };
const makeAdmission = (): RouteAdmissionInput => ({
  businessAccountId: id(10), pickupKey: "canonical-pickup", serviceDay: "2026-10-01",
  children: [1, 2, 3].map((n) => ({ deliveryId: id(n), businessAccountId: id(10), payerType: "merchant",
    pickupKey: "canonical-pickup", serviceDay: "2026-10-01", payloadUpperBoundMilliLb: 40000,
    declaredValueCents: 10000, fundingState: "authorized", vehicleCompatible: true })),
  vehicleCapacityMilliLb: 200000, aggregateValueLimitCents: 50000, hasUnresolvedException: false,
});

describe("Business Route Run draft boundary", () => {
  it("preserves explicit stop order, normalizes identifiers and trims the title", () => {
    const result = validateRouteDraft({ ...draft, title: "  Stafford route  ", requestIds: [id(4).toUpperCase(), id(3)] });
    expect(result).toEqual({ ok: true, value: { ...draft, requestIds: [id(4), id(3)] } });
  });
  it.each([null, [], 123, "draft"])("refuses a non-object body: %j", (raw) => {
    expect(validateRouteDraft(raw).ok).toBe(false);
  });
  it.each(["amount", "subtotal", "driverId", "state", "payerType", "businessAccountId", "pickupProof", "__proto__"])(
    "refuses injected authority field %s", (key) => {
      const body = JSON.parse(JSON.stringify(draft));
      Object.defineProperty(body, key, { value: "forged", enumerable: true });
      expect(validateRouteDraft(body)).toEqual({ ok: false, reason: "unknown_field" });
    });
  it.each([0, 1, 6, 10])("rejects %i stops", (count) => {
    expect(validateRouteDraft({ ...draft, requestIds: Array.from({ length: count }, (_, i) => id(i)) }).ok).toBe(false);
  });
  it.each([2, 3, 4, 5])("accepts %i distinct draft references", (count) => {
    expect(validateRouteDraft({ ...draft, requestIds: Array.from({ length: count }, (_, i) => id(i)) }).ok).toBe(true);
  });
  it("rejects duplicate IDs regardless of UUID case", () => {
    expect(validateRouteDraft({ ...draft, requestIds: [id(3), id(3).toUpperCase()] })).toEqual({ ok: false, reason: "duplicate_request" });
  });
  it.each([-1, 1.2, "0", null, 2147483647, Infinity, NaN])("refuses invalid expected version %j", (expectedVersion) => {
    expect(validateRouteDraft({ ...draft, expectedVersion }).ok).toBe(false);
  });
  it.each(["", "   ", "a".repeat(101), "hidden\ntext", "bad\u0000text"])("refuses invalid title", (title) => {
    expect(validateRouteDraft({ ...draft, title }).ok).toBe(false);
  });
  it("does not coerce invalid IDs to strings", () => {
    expect(validateRouteDraft({ ...draft, requestIds: [id(3), { toString: () => id(4) }] }).ok).toBe(false);
  });
});

describe("Route aggregate safety contract", () => {
  it("cannot dispatch merely because all draft checks pass", () => {
    const result = inspectRouteAdmission(makeAdmission());
    expect(result.blockers).toEqual(["route_execution_not_released"]);
    expect(result.executionAvailable).toBe(false);
  });
  it("catches aggregate payload overflow although each child fits", () => {
    const input = makeAdmission(); input.vehicleCapacityMilliLb = 100000;
    expect(inspectRouteAdmission(input).blockers).toContain("payload_exceeded");
  });
  it("never turns an unknown child weight into zero", () => {
    const base = makeAdmission();
    const input = { ...base, children: base.children.map((child, i) =>
      i === 1 ? { ...child, payloadUpperBoundMilliLb: null } : child) };
    const result = inspectRouteAdmission(input);
    expect(result.payloadUpperBoundMilliLb).toBeNull();
    expect(result.blockers).toContain("cargo_unknown");
  });
  it("refuses unsafe arithmetic instead of overflowing", () => {
    const base = makeAdmission();
    const input = { ...base, children: base.children.map((child, i) =>
      i === 0 ? { ...child, payloadUpperBoundMilliLb: Number.MAX_SAFE_INTEGER } : child) };
    expect(inspectRouteAdmission(input).payloadUpperBoundMilliLb).toBeNull();
  });
  it("locks the owner-approved V1 aggregate declared-value ceiling at $500", () => {
    expect(ROUTE_RUN_V1_AGGREGATE_DECLARED_VALUE_LIMIT_CENTS).toBe(50_000);
  });
  it("still requires the caller to pass the policy explicitly; no hidden default", () => {
    const input = makeAdmission(); input.aggregateValueLimitCents = null;
    expect(inspectRouteAdmission(input).blockers).toContain("route_value_policy_unconfigured");
  });
  it("retains both item and aggregate declared-value checks", () => {
    const base = makeAdmission();
    const input = { ...base, children: base.children.map((child, i) =>
      i === 0 ? { ...child, declaredValueCents: 50001 } : child) };
    expect(inspectRouteAdmission(input).blockers).toEqual(expect.arrayContaining(["item_value_exceeded", "route_value_exceeded"]));
  });
  it("refuses mixed businesses, payers, pickups, service days and unknown payment", () => {
    const base = makeAdmission();
    const input: RouteAdmissionInput = { ...base, children: base.children.map((child, i) =>
      i === 0 ? { ...child, businessAccountId: id(90), payerType: "customer",
        pickupKey: "other", serviceDay: "2026-10-02", fundingState: "unknown", vehicleCompatible: false } : child) };
    expect(inspectRouteAdmission(input).blockers).toEqual(expect.arrayContaining([
      "foreign_business", "not_merchant_paid", "pickup_mismatch", "wrong_service_day", "funding_not_secured", "vehicle_incompatible",
    ]));
  });
  it("blocks route progression for an unresolved custody exception", () => {
    const input = makeAdmission(); input.hasUnresolvedException = true;
    expect(inspectRouteAdmission(input).blockers).toContain("unresolved_route_exception");
  });
  it.each([NaN, -1, 1.1, Infinity])("refuses malformed capacity %j", (capacity) => {
    const input = makeAdmission(); input.vehicleCapacityMilliLb = capacity;
    expect(inspectRouteAdmission(input).blockers).toContain("capacity_unknown");
  });
});

describe("Multi-child settlement recovery intent", () => {
  it("reconciles unknown provider outcomes before refunding or retrying", () => {
    expect(routeSettlementRecovery(["captured", "failed", "unknown"])).toBe("reconcile_only");
  });
  it("compensates definite partial failure, rather than dispatching paid siblings", () => {
    expect(routeSettlementRecovery(["captured", "failed", "authorized"])).toBe("compensate");
  });
  it("recognizes all captured without recapture", () => {
    expect(routeSettlementRecovery(["captured", "captured"])).toBe("ready_for_assignment");
  });
  it("distinguishes an incomplete capture batch", () => {
    expect(routeSettlementRecovery(["captured", "authorized"])).toBe("continue_capture");
  });
  it("does not mark an empty set funded", () => { expect(routeSettlementRecovery([])).toBe("no_funding"); });
});

describe("Draft-only integration guard", () => {
  const root = path.resolve(__dirname, "..");
  const sql = readFileSync(path.join(root, "supabase/migrations/20260923200000_couranr_route_run_draft_foundation.sql"), "utf8");
  const rollback = readFileSync(path.join(root, "supabase/rollbacks/20260923200000_couranr_route_run_draft_foundation.rollback.sql"), "utf8");
  it("creates no payment, driver or custody writer", () => {
    expect(sql).not.toMatch(/(?:insert into|update|delete from)\s+public\.couranr_(?:deliveries|delivery_requests|payment_obligations|service_plans|handoff_codes|delivery_proofs|drivers|delivery_assignments)\b/i);
    expect(sql).toMatch(/check\s*\(\s*route_state\s*=\s*'draft'\s*\)/i);
    expect(sql).toMatch(/'bookingAvailable'\s*,\s*false/);
  });
  it("limits writes to tenant-validated RPCs and preserves draft history on rollback", () => {
    expect(sql).toMatch(/security\s+definer\s+set\s+search_path\s*=\s*''/i);
    expect(sql).toMatch(/status\s*=\s*'active'/i);
    expect(sql).toMatch(/role\s+in\s*\(\s*'owner'\s*,\s*'manager'\s*,\s*'dispatcher'\s*\)/i);
    // Grant semantics must survive SQL formatting. The disposable DB suite
    // independently proves that even service_role cannot rewrite history.
    expect(sql).toMatch(/revoke\s+all\s+on\s+public\.couranr_route_runs\s*,[^;]*from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role\s*;/i);
    expect(sql).toMatch(/grant\s+select\s+on\s+public\.couranr_route_runs\s*,[^;]*to\s+service_role\s*;/i);
    expect(sql).not.toMatch(/grant\s+(?:all|insert|update|delete|truncate)\b[^;]*to\s+service_role\s*;/i);
    expect(rollback).toContain("route_draft_rollback_refuses_semantic_use");
  });
});

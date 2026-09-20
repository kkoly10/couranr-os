import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const MIGRATION = readFileSync(
  path.join(ROOT, "supabase/migrations/20260920230000_operations_dispatch_settlement_parity.sql"),
  "utf8"
);
const ROLLBACK = readFileSync(
  path.join(ROOT, "supabase/rollbacks/20260920230000_operations_dispatch_settlement_parity.rollback.sql"),
  "utf8"
);
const CAPTURE_ROUTE = readFileSync(
  path.join(ROOT, "app/api/couranr/operations/delivery-requests/[id]/capture/route.ts"),
  "utf8"
);
const CREDIT_ROUTE = readFileSync(
  path.join(ROOT, "app/api/couranr/operations/delivery-requests/[id]/promotional-credit-delivery/route.ts"),
  "utf8"
);
const PLAN_UI = readFileSync(
  path.join(ROOT, "components/couranr/fulfillment/OperationsPlanPanel.tsx"),
  "utf8"
);
const AUTO = readFileSync(path.join(ROOT, "lib/couranr/automation/engine.ts"), "utf8");

describe("Operations settlement -> dispatch parity", () => {
  it("reserves a compatible resource before card capture and commits only after delivery creation", () => {
    const reserve = CAPTURE_ROUTE.indexOf("reserveOperationsDispatchCandidate");
    const capture = CAPTURE_ROUTE.indexOf("capturePayment({");
    const commit = CAPTURE_ROUTE.indexOf("commitOperationsDispatchAssignment");
    expect(reserve).toBeGreaterThan(-1);
    expect(capture).toBeGreaterThan(reserve);
    expect(commit).toBeGreaterThan(capture);
  });

  it("uses the same reserve-before-settle shape for credited manual deliveries", () => {
    const reserve = CREDIT_ROUTE.indexOf("reserveOperationsDispatchCandidate");
    const settle = CREDIT_ROUTE.indexOf("createDeliveryFromPromotionalCredit");
    const commit = CREDIT_ROUTE.indexOf("commitOperationsDispatchAssignment");
    expect(reserve).toBeGreaterThan(-1);
    expect(settle).toBeGreaterThan(reserve);
    expect(commit).toBeGreaterThan(settle);
  });

  it("keeps automatic dispatch on its existing safe choreography", () => {
    const reserve = AUTO.indexOf("couranr_reserve_automatic_dispatch_candidate");
    const capture = AUTO.indexOf("capturePaymentForAutomation", reserve);
    const commit = AUTO.indexOf("couranr_commit_automatic_assignment", capture);
    expect(reserve).toBeGreaterThan(-1);
    expect(capture).toBeGreaterThan(reserve);
    expect(commit).toBeGreaterThan(capture);
  });

  it("never exposes capture as the normal manual action", () => {
    expect(PLAN_UI).toContain("Dispatch delivery");
    expect(PLAN_UI).not.toContain("Capture {payment ? formatCents(payment.amountCents) : \"\"} and schedule");
  });

  it("pins reservation uniqueness and operations-only plan scope in SQL", () => {
    expect(MIGRATION).toContain("plan_source='operations'");
    expect(MIGRATION).toContain("couranr_vehicle_incompatibility");
    expect(MIGRATION).toContain("reservation_state='active'");
    expect(MIGRATION).toContain("assignment_source,dispatch_reservation_id");
    expect(MIGRATION).toContain("'operations',v_res.id");
  });

  it("keeps both new functions service-role-only and rollbackable", () => {
    expect(MIGRATION).toMatch(/revoke all on function public\.couranr_reserve_operations_dispatch_candidate[\s\S]*from public, anon, authenticated/i);
    expect(MIGRATION).toMatch(/grant execute on function public\.couranr_reserve_operations_dispatch_candidate[\s\S]*to service_role/i);
    expect(MIGRATION).toMatch(/revoke all on function public\.couranr_commit_operations_dispatch_assignment[\s\S]*from public, anon, authenticated/i);
    expect(ROLLBACK).toContain("drop function if exists public.couranr_commit_operations_dispatch_assignment");
    expect(ROLLBACK).toContain("drop function if exists public.couranr_reserve_operations_dispatch_candidate");
  });
});

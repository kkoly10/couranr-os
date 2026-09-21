import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const SQL = readFileSync(
  path.join(ROOT, "supabase/migrations/20260921023000_dispatch_reservation_manifest_guards.sql"),
  "utf8"
);
const ROLLBACK = readFileSync(
  path.join(ROOT, "supabase/rollbacks/20260921023000_dispatch_reservation_manifest_guards.rollback.sql"),
  "utf8"
);

describe("dispatch reservation + pickup manifest guard repair", () => {
  it("allows Operations to own a validated reservation", () => {
    expect(SQL).toContain("new.assignment_source='operations'");
    expect(SQL).toContain("new.dispatch_reservation_id is null");
    expect(SQL).toContain("id=new.dispatch_reservation_id");
    expect(SQL).toContain("service_plan_id=v_service_plan_id");
    expect(SQL).toContain("driver_id=new.driver_id");
    expect(SQL).toContain("vehicle_id=new.vehicle_id");
    expect(SQL).toContain("operations_dispatch_reservation_invalid");
  });

  it("keeps legacy Operations assignment from stealing an active reservation", () => {
    expect(SQL).toContain("delivery_reserved_for_automatic_dispatch");
    expect(SQL).toMatch(/new\.dispatch_reservation_id is null[\s\S]*reservation_state='active'/);
  });

  it("relaxes only the source/actor constraint needed for Operations reservations", () => {
    expect(SQL).toContain("(assignment_source='operations' and assigned_by is not null)");
    expect(SQL).toContain("(assignment_source='automatic' and assigned_by is null and dispatch_reservation_id is not null)");
  });

  it("treats pickupManifest as request-owned custody evidence, not quoted pricing payload", () => {
    expect(SQL).toContain("(new.shipment - 'pickupManifest')");
    expect(SQL).toContain("(v_q.shipment_snapshot - 'pickupManifest')");
    expect(SQL).toContain("(new.shipment->'pickupManifest') is distinct from v_r.pickup_manifest");
  });

  it("continues to freeze every commercial shipment field on UPDATE", () => {
    expect(SQL).toContain("delivery_commercial_snapshot_is_immutable");
    expect(SQL).toContain("(new.request_id,new.business_account_id,new.payment_obligation_id");
  });

  it("has an exact rollback for the two pre-repair guards", () => {
    expect(ROLLBACK).toContain("dispatch_reservation_id is null");
    expect(ROLLBACK).toContain("new.shipment is distinct from v_q.shipment_snapshot");
    expect(ROLLBACK).toContain("delivery_reserved_for_automatic_dispatch");
  });
});

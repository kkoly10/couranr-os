import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { navigationFor } from "@/lib/couranr/navigation";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const MIGRATION = read("supabase/migrations/20260904213000_couranr_driver_pilot_d1_self_service.sql");
const PROFILE_ROUTE = read("app/api/couranr/driver/profile/route.ts");
const AVAIL_ROUTE = read("app/api/couranr/driver/availability/route.ts");
const VEHICLE_ROUTE = read("app/api/couranr/driver/vehicles/[id]/route.ts");
const PROFILE_COMMANDS = read("lib/couranr/driver/profile.ts");
const DASHBOARD = read("app/(couranr)/driver/page.tsx");
const AVAIL_PAGE = read("app/(couranr)/driver/availability/page.tsx");
const VEHICLE_PAGE = read("app/(couranr)/driver/vehicle/page.tsx");

describe("Driver Pilot D1 self-scoping", () => {
  it("the browser never supplies a driver id to Driver account routes", () => {
    for (const source of [PROFILE_ROUTE, AVAIL_ROUTE, VEHICLE_ROUTE]) {
      expect(source).toContain("resolveUserId");
      expect(source).not.toMatch(/body\?\.driverId|body\.driverId|searchParams\.get\(["']driverId/);
    }
    expect(PROFILE_COMMANDS).toContain('.eq("user_id", userId)');
    expect(MIGRATION).toContain("where user_id=p_actor_user_id");
  });

  it("on_delivery remains system-owned while next-idle preference is mutable", () => {
    expect(MIGRATION).toContain("p_preference not in ('available','unavailable')");
    expect(MIGRATION).toContain("when availability_state='on_delivery' then 'on_delivery'");
    expect(MIGRATION).not.toContain("p_preference='on_delivery'");
    expect(AVAIL_ROUTE).toContain('preference !== "available" && preference !== "unavailable"');
  });

  it("vehicle self-service can only touch a vehicle associated with the caller", () => {
    const occurrences = MIGRATION.match(/assigned_driver_id=v_driver\.id/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
    expect(MIGRATION).toContain("vehicle_is_on_delivery");
    expect(MIGRATION).toContain("and version=p_expected_version");
  });

  it("vehicle identity/class and assignment stay outside Driver mutation inputs", () => {
    expect(VEHICLE_ROUTE).not.toMatch(/vehicleClass|assignedDriverId|name\s*:/);
    expect(MIGRATION).not.toContain("p_vehicle_class");
    expect(MIGRATION).not.toContain("p_assigned_driver_id");
    expect(MIGRATION).not.toContain("p_name text");
  });
});

describe("Driver Pilot D1 UI topology", () => {
  it("retires the legacy dashboard feed and renders canonical current work only", () => {
    expect(DASHBOARD).toContain("<DriverHome");
    expect(DASHBOARD).not.toContain("fetchMyDeliveries");
    expect(DASHBOARD).not.toContain("/api/driver/my-deliveries");
    expect(DASHBOARD).not.toContain("Active Delivery");
    expect(DASHBOARD).not.toContain("Completed Today");
  });

  it("Availability and Vehicle no longer render placeholders", () => {
    expect(AVAIL_PAGE).toContain("<DriverAvailability");
    expect(VEHICLE_PAGE).toContain("<DriverVehicleProfile");
    expect(AVAIL_PAGE).not.toContain("ScreenPlaceholder");
    expect(VEHICLE_PAGE).not.toContain("ScreenPlaceholder");
  });

  it("Driver bottom navigation has an explicit Home destination", () => {
    const items = navigationFor("driver");
    expect(items.map((i) => i.screenId)).toEqual([
      "DRV-001",
      "DRV-008",
      "DRV-009",
      "DRV-010",
    ]);
    expect(items[0]).toMatchObject({ label: "Home", href: "/driver", exact: true });
  });

  it("does not smuggle deferred marketplace or scheduling product into D1", () => {
    const all = [
      read("components/couranr/driver/DriverAvailability.tsx"),
      read("components/couranr/driver/DriverVehicleProfile.tsx"),
      MIGRATION,
    ].join("\n");
    expect(all).not.toMatch(/shift bid|gig marketplace|available jobs|earnings|surge|incentive/i);
    expect(MIGRATION).not.toMatch(/weekly|schedule|shift/);
  });
});

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { navigationFor } from "@/lib/couranr/navigation";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const MIGRATION = read("supabase/migrations/20260904213000_couranr_driver_pilot_d1_self_service.sql");
const PROFILE_ROUTE = read("app/api/couranr/driver/profile/route.ts");
const AVAIL_ROUTE = read("app/api/couranr/driver/availability/route.ts");
const PROFILE_COMMANDS = read("lib/couranr/driver/profile.ts");
const DRIVER_CLIENT = read("components/couranr/driver/client.ts");
const DASHBOARD = read("app/(couranr)/driver/page.tsx");
const AVAIL_PAGE = read("app/(couranr)/driver/availability/page.tsx");
const VEHICLE_PAGE = read("app/(couranr)/driver/vehicle/page.tsx");
const VEHICLE_UI = read("components/couranr/driver/DriverVehicleProfile.tsx");

describe("Driver Pilot D1 self-scoping", () => {
  it("the browser never supplies a driver id to Driver account routes", () => {
    for (const source of [PROFILE_ROUTE, AVAIL_ROUTE]) {
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

  it("Driver self-service exposes exactly one write authority: personal availability intent", () => {
    expect(MIGRATION).toContain("couranr_set_my_driver_availability");
    expect(MIGRATION).not.toContain("couranr_set_my_vehicle_availability");
    expect(MIGRATION).not.toContain("couranr_update_my_vehicle_capabilities");
    expect(PROFILE_COMMANDS).not.toContain("setMyVehicleAvailability");
    expect(PROFILE_COMMANDS).not.toContain("updateMyVehicleCapabilities");
    expect(DRIVER_CLIENT).not.toContain("setMyVehicleAvailability");
    expect(DRIVER_CLIENT).not.toContain("updateMyVehicleCapabilities");
    expect(
      existsSync(path.join(ROOT, "app/api/couranr/driver/vehicles/[id]/route.ts"))
    ).toBe(false);
  });

  it("vehicle safety/matching facts remain read-only on the Driver surface", () => {
    expect(VEHICLE_UI).toContain("READ-ONLY by design");
    expect(VEHICLE_UI).toContain("Operations-controlled");
    expect(VEHICLE_UI).not.toMatch(/Save vehicle|Edit capacity|Mark unavailable|Mark available/);
    expect(VEHICLE_UI).not.toMatch(/updateMyVehicleCapabilities|setMyVehicleAvailability/);
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
      VEHICLE_UI,
      MIGRATION,
    ].join("\n");
    expect(all).not.toMatch(/shift bid|gig marketplace|available jobs|earnings|surge|incentive/i);
    expect(MIGRATION).not.toMatch(/weekly|schedule|shift/);
  });
});

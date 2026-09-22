import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown> | null>,
  selected: [] as Array<{ table: string; columns: string }>,
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from(table: string) {
      const query = {
        select(columns: string) {
          fixture.selected.push({ table, columns });
          return query;
        },
        eq() { return query; },
        maybeSingle: async () => ({ data: fixture.rows[table] ?? null, error: null }),
      };
      return query;
    },
  },
}));

import { getAssignedDeliveryForDriver } from "@/lib/couranr/dispatch/commands";

beforeEach(() => {
  fixture.selected.length = 0;
  fixture.rows = {
    couranr_drivers: { id: "driver-1", user_id: "user-1" },
    couranr_delivery_assignments: {
      id: "assignment-1", delivery_id: "delivery-1", driver_id: "driver-1",
      vehicle_id: "vehicle-1", assignment_state: "active",
    },
    couranr_deliveries: {
      id: "delivery-1", request_id: "request-1", business_account_id: null,
      version: 4, fulfillment_state: "at_pickup", service_level: "same_day",
      pickup_address: { line1: "123 Pickup St" },
      dropoff_address: { line1: "456 Dropoff St" },
      recipient: { name: "Recipient", phone: "555-0102", email: "recipient@example.test" },
    },
    couranr_dispatch_vehicles: { id: "vehicle-1", name: "Vehicle", vehicle_class: "car" },
    couranr_delivery_requests: {
      id: "request-1", source: "consumer_send", requester_kind: "consumer",
      business_account_id: null, protection_level: "standard",
      protection_policy_version: "v1",
      consumer_contact_snapshot: {
        name: "Direct Sender", phone: "555-0101", email: "sender@example.test",
      },
    },
  };
});

describe("assigned driver contact boundary", () => {
  it("projects the direct Consumer sender name and phone without sender email or fake tenancy", async () => {
    const result = await getAssignedDeliveryForDriver({
      userId: "user-1", deliveryId: "delivery-1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.assigned?.merchant).toEqual({
      name: "Direct Sender", phone: "555-0101",
    });
    expect(result.value.assigned?.pickup.line1).toBe("123 Pickup St");
    expect(JSON.stringify(result.value.assigned)).not.toContain("sender@example.test");
    expect(JSON.stringify(result.value.assigned)).not.toContain("recipient@example.test");
    expect(fixture.selected.some(({ table, columns }) =>
      table === "couranr_delivery_requests" &&
      columns.includes("consumer_contact_snapshot") &&
      !columns.includes("declared_value_cents"))).toBe(true);
  });

  it("returns no delivery for another assignment identifier before reading its request", async () => {
    const result = await getAssignedDeliveryForDriver({
      userId: "user-1", deliveryId: "someone-elses-delivery",
    });
    expect(result).toEqual({ ok: true, value: { assigned: null } });
    expect(fixture.selected.some(({ table }) => table === "couranr_delivery_requests")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  resolveDeliveryAccess,
  signedUrlTtlSeconds,
  type DeliveryAccessRecord,
} from "@/lib/delivery/deliveryAccess";

const ADMIN = "00000000-0000-4000-8000-00000000ad11";
const DRIVER = "00000000-0000-4000-8000-000000000002";
const CUSTOMER = "00000000-0000-4000-8000-000000000001";
const STRANGER = "00000000-0000-4000-8000-00000000dead";

const delivery: DeliveryAccessRecord = {
  deliveryId: "11111111-2222-4333-8444-555555555555",
  driverId: DRIVER,
  customerId: CUSTOMER,
};

describe("resolveDeliveryAccess — who may see delivery proof photos", () => {
  it("allows a Couranr Operations admin", () => {
    const d = resolveDeliveryAccess({ userId: ADMIN, isAdmin: true }, delivery);
    expect(d.allowed).toBe(true);
    expect(d.role).toBe("admin");
  });

  it("allows the assigned driver", () => {
    const d = resolveDeliveryAccess({ userId: DRIVER, isAdmin: false }, delivery);
    expect(d.allowed).toBe(true);
    expect(d.role).toBe("driver");
  });

  it("allows the owning customer", () => {
    const d = resolveDeliveryAccess(
      { userId: CUSTOMER, isAdmin: false },
      delivery
    );
    expect(d.allowed).toBe(true);
    expect(d.role).toBe("customer");
  });

  it("denies an authenticated user who is neither driver nor customer", () => {
    const d = resolveDeliveryAccess(
      { userId: STRANGER, isAdmin: false },
      delivery
    );
    expect(d.allowed).toBe(false);
    expect(d.role).toBeNull();
    expect(d.reason).toBe("not_a_participant");
  });

  it("denies an anonymous caller", () => {
    expect(resolveDeliveryAccess(null, delivery).allowed).toBe(false);
    expect(resolveDeliveryAccess(undefined, delivery).allowed).toBe(false);
    expect(
      resolveDeliveryAccess({ userId: "", isAdmin: false }, delivery).allowed
    ).toBe(false);
    expect(
      resolveDeliveryAccess({ userId: "   ", isAdmin: false }, delivery).allowed
    ).toBe(false);
  });

  it("denies when the delivery does not exist", () => {
    const d = resolveDeliveryAccess({ userId: CUSTOMER, isAdmin: false }, null);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("delivery_not_found");
  });

  it("denies the driver of a DIFFERENT delivery", () => {
    const other: DeliveryAccessRecord = {
      deliveryId: "99999999-9999-4999-8999-999999999999",
      driverId: STRANGER,
      customerId: STRANGER,
    };
    expect(
      resolveDeliveryAccess({ userId: DRIVER, isAdmin: false }, other).allowed
    ).toBe(false);
  });

  /**
   * The bug this guards against: `null === null` is true, so a subject whose id
   * failed to resolve would match an unassigned delivery's null driver_id.
   * Production currently has 0 deliveries with a driver assigned, so every row
   * is exactly this shape.
   */
  it("does NOT grant access when both the subject id and the row id are absent", () => {
    const unassigned: DeliveryAccessRecord = {
      deliveryId: delivery.deliveryId,
      driverId: null,
      customerId: null,
    };

    expect(
      resolveDeliveryAccess({ userId: "", isAdmin: false }, unassigned).allowed
    ).toBe(false);

    // A non-empty id must still not match a null column.
    expect(
      resolveDeliveryAccess({ userId: DRIVER, isAdmin: false }, unassigned)
        .allowed
    ).toBe(false);
  });

  it("does not treat an empty-string driver_id as a match", () => {
    const blank: DeliveryAccessRecord = {
      deliveryId: delivery.deliveryId,
      driverId: "",
      customerId: "",
    };
    expect(
      resolveDeliveryAccess({ userId: "", isAdmin: false }, blank).allowed
    ).toBe(false);
  });

  it("admin wins even when they are not a participant", () => {
    const d = resolveDeliveryAccess({ userId: STRANGER, isAdmin: true }, delivery);
    expect(d.allowed).toBe(true);
    expect(d.role).toBe("admin");
  });
});

describe("signedUrlTtlSeconds", () => {
  it("gives Operations a longer window than driver or customer", () => {
    expect(signedUrlTtlSeconds("admin")).toBe(900);
    expect(signedUrlTtlSeconds("driver")).toBe(600);
    expect(signedUrlTtlSeconds("customer")).toBe(600);
  });

  it("never issues a long-lived credential", () => {
    for (const role of ["admin", "driver", "customer"] as const) {
      expect(signedUrlTtlSeconds(role)).toBeGreaterThan(0);
      expect(signedUrlTtlSeconds(role)).toBeLessThanOrEqual(900);
    }
  });
});

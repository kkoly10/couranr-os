import { describe, expect, it } from "vitest";
import {
  DELIVERY_STATUSES,
  allowedSourcesFor,
  canTransition,
  isDeliveryStatus,
} from "@/lib/delivery/transitions";

const ASSIGNED_DRIVER = { role: "driver" as const, isAssignedDriver: true };
const OTHER_DRIVER = { role: "driver" as const, isAssignedDriver: false };
const ADMIN = { role: "admin" as const, isAssignedDriver: false };

describe("canTransition — the assigned driver starting a run", () => {
  it("allows assigned -> in_transit for the assigned driver", () => {
    const d = canTransition("assigned", "in_transit", ASSIGNED_DRIVER);
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe("ok");
  });

  it("allows assigned -> in_transit for Operations", () => {
    expect(canTransition("assigned", "in_transit", ADMIN).allowed).toBe(true);
  });

  /**
   * The core of the fix. The route used to take a deliveryId from an
   * unauthenticated body and write in_transit onto ANY delivery — including one
   * assigned to a different driver.
   */
  it("DENIES assigned -> in_transit for a driver who is not assigned", () => {
    const d = canTransition("assigned", "in_transit", OTHER_DRIVER);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("driver_not_assigned");
  });

  it("denies an anonymous actor", () => {
    expect(canTransition("assigned", "in_transit", null).allowed).toBe(false);
    expect(canTransition("assigned", "in_transit", undefined).allowed).toBe(false);
  });
});

describe("canTransition — arbitrary target statuses are rejected", () => {
  it("denies pending -> in_transit (must be assigned first)", () => {
    const d = canTransition("pending", "in_transit", ADMIN);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("not_an_allowed_transition");
  });

  it("denies pending -> completed, skipping the whole lifecycle", () => {
    expect(canTransition("pending", "completed", ADMIN).allowed).toBe(false);
  });

  it("denies cancelled -> in_transit", () => {
    expect(canTransition("cancelled", "in_transit", ADMIN).allowed).toBe(false);
  });

  it("denies a status that is not in the vocabulary", () => {
    expect(canTransition("assigned", "delivered", ADMIN).reason).toBe(
      "unknown_status"
    );
    expect(canTransition("assigned", "", ADMIN).reason).toBe("unknown_status");
    expect(canTransition("assigned", null, ADMIN).reason).toBe("unknown_status");
    expect(canTransition("assigned", "'; drop table deliveries;--", ADMIN).reason).toBe(
      "unknown_status"
    );
  });

  it("treats completed as terminal for every actor and every target", () => {
    for (const to of DELIVERY_STATUSES) {
      for (const actor of [ADMIN, ASSIGNED_DRIVER, OTHER_DRIVER]) {
        const d = canTransition("completed", to, actor);
        expect(d.allowed).toBe(false);
        expect(d.reason).toBe("terminal_state");
      }
    }
  });
});

describe("canTransition — role separation", () => {
  it("a driver may not assign a delivery", () => {
    expect(canTransition("pending", "assigned", ASSIGNED_DRIVER).reason).toBe(
      "role_not_permitted"
    );
  });

  it("a driver may not cancel a delivery", () => {
    for (const from of ["pending", "assigned", "in_transit"] as const) {
      expect(canTransition(from, "cancelled", ASSIGNED_DRIVER).reason).toBe(
        "role_not_permitted"
      );
    }
  });

  it("a driver may not reinstate a cancelled delivery", () => {
    expect(canTransition("cancelled", "pending", ASSIGNED_DRIVER).reason).toBe(
      "role_not_permitted"
    );
  });

  it("Operations may cancel anything that is not terminal", () => {
    for (const from of ["pending", "assigned", "in_transit"] as const) {
      expect(canTransition(from, "cancelled", ADMIN).allowed).toBe(true);
    }
  });
});

describe("lifecycle shape", () => {
  it("in_transit is reachable only from assigned", () => {
    expect(allowedSourcesFor("in_transit")).toEqual(["assigned"]);
  });

  it("completed is reachable only from in_transit", () => {
    expect(allowedSourcesFor("completed")).toEqual(["in_transit"]);
  });

  it("no transition leaves a terminal state", () => {
    for (const to of DELIVERY_STATUSES) {
      expect(allowedSourcesFor(to)).not.toContain("completed");
    }
  });

  it("recognises exactly the courier vocabulary", () => {
    expect(isDeliveryStatus("in_transit")).toBe(true);
    expect(isDeliveryStatus("delivered")).toBe(false);
    expect(isDeliveryStatus("IN_TRANSIT")).toBe(false);
    expect(isDeliveryStatus(undefined)).toBe(false);
  });
});

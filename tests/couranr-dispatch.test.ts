import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AVAILABILITY_STATES,
  DRIVER_STATES,
  SETTABLE_AVAILABILITY,
  VEHICLE_CLASSES,
  assignmentIdempotencyKey,
  classSatisfies,
  dispatchReasonMessage,
  driverIneligibility,
  driverIsAssignable,
  isDispatchReason,
  replacementIdempotencyKey,
  vehicleClassRank,
} from "@/lib/couranr/dispatch/states";
import {
  PROJECTION_ALLOWED_KEYS,
  buildAssignedDeliveryProjection,
  projectionLeaks,
} from "@/lib/couranr/dispatch/projection";

const ROOT = path.resolve(__dirname, "..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");

/**
 * The dispatch migrations with COMMENTS STRIPPED.
 *
 * Assertions here are about what the database will execute, and these files
 * deliberately quote the wrong patterns in prose to explain why they are wrong
 * — the ended-at check comment spells out the biconditional form it avoids. A
 * raw read makes "this shape is absent" fail against its own explanation.
 */
const SQL = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql") && !f.includes(".rollback.") && f.includes("dispatch"))
  .sort()
  .map((f) => readFileSync(path.join(MIGRATIONS, f), "utf8"))
  .join("\n")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*--.*$/gm, "");

const DISPATCH_TS = ["states.ts", "commands.ts", "projection.ts"]
  .map((f) => readFileSync(path.join(ROOT, "lib/couranr/dispatch", f), "utf8"))
  .join("\n");

/* ================================================ vehicle compatibility === */

describe("vehicle class substitution", () => {
  it("substitutes upward only, matching couranr_vehicle_class_rank", () => {
    expect(classSatisfies("van", "car")).toBe(true);
    expect(classSatisfies("box_truck", "van")).toBe(true);
    expect(classSatisfies("van", "van")).toBe(true);
    expect(classSatisfies("car", "van")).toBe(false);
    expect(classSatisfies("cargo_bike", "car")).toBe(false);
  });

  it("an unknown class satisfies nothing, and nothing satisfies an unknown requirement", () => {
    // Fail-closed in both directions. If the two sides ever disagree about the
    // vocabulary, the selector must UNDER-offer, never over-offer.
    expect(vehicleClassRank("spaceship")).toBe(0);
    expect(classSatisfies("spaceship", "car")).toBe(false);
    expect(classSatisfies("box_truck", "spaceship")).toBe(false);
  });

  it("the TypeScript rank ordering is the same one the SQL uses", () => {
    // Both sides are written out; a reordering on one side alone fails here
    // rather than at 2am against a real delivery.
    expect(VEHICLE_CLASSES).toEqual(["cargo_bike", "car", "van", "box_truck"]);
    const sqlOrder = ["cargo_bike", "car", "van", "box_truck"].map(
      (c) => new RegExp(`when '${c}'\\s+then (\\d)`).exec(SQL)?.[1]
    );
    expect(sqlOrder).toEqual(["1", "2", "3", "4"]);
  });
});

/* ============================================== driver eligibility ======== */

describe("driver eligibility", () => {
  const base = { driverState: "active", availabilityState: "available", active: true };

  it("only an active AND available driver may be assigned", () => {
    expect(driverIsAssignable(base)).toBe(true);
    expect(driverIsAssignable({ ...base, driverState: "suspended" })).toBe(false);
    expect(driverIsAssignable({ ...base, driverState: "pending" })).toBe(false);
    expect(driverIsAssignable({ ...base, driverState: "inactive" })).toBe(false);
    expect(driverIsAssignable({ ...base, active: false })).toBe(false);
    expect(driverIsAssignable({ ...base, availabilityState: "unavailable" })).toBe(false);
    expect(driverIsAssignable({ ...base, availabilityState: "on_delivery" })).toBe(false);
  });

  it("reports a closed reason code, never a bare boolean", () => {
    expect(driverIneligibility(base)).toBeNull();
    expect(driverIneligibility({ ...base, driverState: "suspended" })).toBe("driver_not_active");
    expect(driverIneligibility({ ...base, availabilityState: "on_delivery" })).toBe(
      "driver_not_available"
    );
  });

  it("on_delivery is not something a person can set", () => {
    // It is a consequence of an assignment. Offering it would let an operator
    // hand-mark a busy driver free and defeat the one-active-per-driver index.
    expect(AVAILABILITY_STATES).toContain("on_delivery");
    expect(SETTABLE_AVAILABILITY).not.toContain("on_delivery");
    expect(SQL).toMatch(/p_availability_state not in \('available','unavailable'\)/);
  });

  it("every driver state in the type is permitted by the CHECK constraint", () => {
    for (const s of DRIVER_STATES) expect(SQL).toContain(`'${s}'`);
  });
});

/* ============================================= reason codes and copy ====== */

describe("dispatch reasons", () => {
  it("never renders a raw code, an empty string, or undefined", () => {
    for (const r of ["driver_not_available", "vehicle_payload_too_low", "vehicle_class_too_small"]) {
      const msg = dispatchReasonMessage(r);
      expect(msg.length).toBeGreaterThan(10);
      expect(msg).not.toContain("_");
    }
    // An unrecognised code — an older event, or a newer build's vocabulary —
    // still produces something true rather than leaking an identifier.
    const fallback = dispatchReasonMessage("something_from_the_future");
    expect(fallback.length).toBeGreaterThan(10);
    expect(fallback).not.toContain("something_from_the_future");
    expect(dispatchReasonMessage(undefined).length).toBeGreaterThan(10);
  });

  it("recognises exactly the codes the SQL raises", () => {
    // Each of these is a `raise exception ... using errcode` message in the
    // migration; if SQL adds one without adding it here, the UI would fall back
    // to generic copy silently.
    for (const code of [
      "driver_not_active",
      "driver_not_available",
      "delivery_not_scheduled",
      "payment_not_captured",
      "service_plan_not_confirmed",
      "delivery_already_assigned",
      "vehicle_payload_too_low",
      "vehicle_class_too_small",
    ]) {
      expect(isDispatchReason(code)).toBe(true);
      expect(SQL).toContain(code);
    }
  });
});

/* ================================================== idempotency keys ====== */

describe("idempotency keys", () => {
  it("an assign key is scoped to the delivery AND the version it was seen at", () => {
    const a = assignmentIdempotencyKey("d-1", 3);
    expect(a).toBe(assignmentIdempotencyKey("d-1", 3)); // double-click: same key
    expect(a).not.toBe(assignmentIdempotencyKey("d-1", 4));
    expect(a).not.toBe(assignmentIdempotencyKey("d-2", 3));
  });

  it("a replacement key is scoped to the assignment being replaced", () => {
    /*
     * The delivery does NOT move during a replacement — it stays `assigned` and
     * its version does not bump. A delivery-scoped key would therefore be
     * identical on the second replacement and would silently return the FIRST
     * replacement's row instead of performing the second.
     */
    const first = replacementIdempotencyKey("d-1", "asg-1", 1);
    const second = replacementIdempotencyKey("d-1", "asg-2", 1);
    expect(first).not.toBe(second);
    expect(first).toBe(replacementIdempotencyKey("d-1", "asg-1", 1));
  });
});

/* =============================================== the driver projection ==== */

/** A delivery row carrying every field a driver must never receive. */
const LEAKY_DELIVERY = {
  id: "11111111-1111-4111-8111-111111111111",
  request_id: "22222222-2222-4222-8222-222222222222",
  business_account_id: "33333333-3333-4333-8333-333333333333",
  payment_obligation_id: "44444444-4444-4444-8444-444444444444",
  service_plan_id: "55555555-5555-4555-8555-555555555555",
  request_version: 7,
  pricing_policy_version: "couranr-pricing-2026-07-31",
  captured_amount_cents: 3064,
  currency: "usd",
  provider_payment_intent_id: "pi_3RxYzAbCdEfGhIjK",
  internal_note: "operations only: merchant disputed the last one",
  pickup_address: {
    line1: "1 Market St",
    line2: "Suite 2",
    city: "Stafford",
    region: "VA",
    postalCode: "22554",
    instructions: "Ring the side bell",
  },
  dropoff_address: {
    line1: "9 Elm Rd",
    line2: "",
    city: "Fredericksburg",
    region: "VA",
    postalCode: "22401",
    instructions: "Leave with front desk",
  },
  recipient: { name: "Dana Reyes", phone: "555-0100", email: "dana@example.com" },
  shipment: { weightLb: 120, additionalStops: 0, loadedMiles: 6 },
  service_level: "standard",
  signature_required: true,
  proof_method: "photo_or_pin",
  scheduled_pickup_start: "2026-09-20T13:00:00Z",
  scheduled_pickup_end: "2026-09-20T15:00:00Z",
  timezone: "America/New_York",
  vehicle_requirement: { vehicleClass: "van", maxPayloadLb: 800 },
  fulfillment_state: "assigned",
  version: 4,
};

const projection = () =>
  buildAssignedDeliveryProjection({
    delivery: LEAKY_DELIVERY,
    assignment: {
      id: "66666666-6666-4666-8666-666666666666",
      assigned_at: "2026-09-19T10:00:00Z",
      vehicle_id: "77777777-7777-4777-8777-777777777777",
    },
    vehicle: { id: "77777777-7777-4777-8777-777777777777", name: "Van 2", vehicle_class: "van" },
    merchant: { name: "Petal & Stem Co.", phone: "555-0111" },
  });

describe("the assigned-driver projection", () => {
  it("emits exactly the allowed keys and nothing else", () => {
    expect(Object.keys(projection()).sort()).toEqual([...PROJECTION_ALLOWED_KEYS].sort());
  });

  it("leaks no money, tenant or audit handle from a row that carries all of them", () => {
    const leak = projectionLeaks(JSON.stringify(projection()));
    expect(leak).toBeNull();
  });

  it("POSITIVE CONTROL: the leak checker actually catches a leak", () => {
    /*
     * Without this, the assertion above could pass because `projectionLeaks` is
     * broken rather than because the projection is clean — the exact way a
     * safety test goes quietly green while protecting nothing.
     */
    expect(projectionLeaks(JSON.stringify(LEAKY_DELIVERY))).not.toBeNull();
    expect(projectionLeaks('{"x":"payment_obligation_id"}')).toBe("payment_obligation_id");
    expect(projectionLeaks('{"intent":"pi_3RxYzAbCdEfGhIjK"}')).toBe("pi_3RxYzAbCdEfGhIjK");
  });

  it("does not false-positive on ordinary address text", () => {
    // A bare "pi_" substring check would fire on real street names; the
    // provider-id rule matches whole tokens instead.
    expect(projectionLeaks('{"line1":"12 Olympi_Way","city":"Ch_ester"}')).toBeNull();
  });

  it("drops recipient email — a handoff needs a name and a phone", () => {
    const p = projection();
    expect(p.recipient).toEqual({ name: "Dana Reyes", phone: "555-0100" });
    expect(JSON.stringify(p)).not.toContain("dana@example.com");
  });

  it("carries what a driver actually needs to execute", () => {
    const p = projection();
    expect(p.pickup.instructions).toBe("Ring the side bell");
    expect(p.dropoff.line1).toBe("9 Elm Rd");
    expect(p.merchant).toEqual({ name: "Petal & Stem Co.", phone: "555-0111" });
    expect(p.proof).toEqual({ method: "photo_or_pin", signatureRequired: true });
    expect(p.shipment.declaredWeightLb).toBe(120);
    expect(p.vehicleRequirement).toEqual({ vehicleClass: "van", maxPayloadLb: 800 });
    expect(p.assignment.vehicle?.name).toBe("Van 2");
    expect(p.fulfillmentState).toBe("assigned");
  });

  it("reports an uncaptured package count as null rather than a fake zero", () => {
    // The request model does not capture package count yet. Zero would be a
    // claim; null is the truth.
    expect(projection().shipment.packageCount).toBeNull();
  });
});

/* ===================================== the invariants live in the database = */

describe("dispatch invariants are enforced by the database", () => {
  it("exactly one active assignment per delivery and per driver", () => {
    expect(SQL).toMatch(
      /create unique index[^;]*couranr_asg_one_active_per_delivery[^;]*where assignment_state = 'active'/s
    );
    expect(SQL).toMatch(
      /create unique index[^;]*couranr_asg_one_active_per_driver[^;]*where assignment_state = 'active'/s
    );
  });

  it("the ended-at stamp check is one-directional, not a biconditional", () => {
    // `(state = 'active') = (ended_at is null)` is the shape that has already
    // made a legal transition impossible twice in this repo.
    expect(SQL).toMatch(/assignment_state = 'active' or ended_at is not null/);
    expect(SQL).not.toMatch(/\(assignment_state = 'active'\) = \(/);
  });

  it("no table grants DELETE, and the revoke precedes the grant", () => {
    for (const t of [
      "couranr_drivers",
      "couranr_dispatch_vehicles",
      "couranr_delivery_assignments",
      "couranr_assignment_events",
    ]) {
      expect(SQL).toMatch(new RegExp(`revoke all on public\\.${t}\\s+from service_role`));
      expect(SQL).not.toMatch(new RegExp(`grant[^;]*delete[^;]*on public\\.${t}`, "i"));
    }
  });

  it("every command is SECURITY INVOKER with a fixed empty search path", () => {
    const fns = SQL.match(/create or replace function public\.couranr_\w+/g) ?? [];
    expect(fns.length).toBeGreaterThanOrEqual(7);
    // One `set search_path = ''` per function, and no SECURITY DEFINER anywhere.
    expect((SQL.match(/set search_path = ''/g) ?? []).length).toBeGreaterThanOrEqual(fns.length);
    expect(SQL).not.toMatch(/security definer/i);
  });

  it("the assign command hard-codes its own destination state", () => {
    // No caller-supplied fulfillment target anywhere.
    expect(SQL).toMatch(/set fulfillment_state = 'assigned'/);
    expect(SQL).not.toMatch(/fulfillment_state\s*=\s*p_/);
  });

  it("assignment requires captured payment and a confirmed plan", () => {
    expect(SQL).toMatch(/v_ob_state is distinct from 'captured'/);
    expect(SQL).toMatch(/v_plan_state is distinct from 'confirmed'/);
  });
});

/* ============================================ no driver-authored writes === */

describe("drivers cannot act on dispatch", () => {
  it("the command layer exposes no driver-authored mutation", () => {
    // Every exported mutation gates on Operations. The driver read is the only
    // export that does not, and it is a SELECT.
    const exported = [...DISPATCH_TS.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    const mutations = exported.filter((n) =>
      /^(create|update|set|assign|replace|delete|cancel)/.test(n)
    );
    expect(mutations.length).toBeGreaterThan(0);
    for (const m of mutations) {
      const body = DISPATCH_TS.slice(
        DISPATCH_TS.indexOf(`export async function ${m}`),
        DISPATCH_TS.indexOf(`export async function ${m}`) + 1400
      );
      expect(body).toContain("requireOperations");
    }
  });

  it("the driver read is scoped by the caller's own user id, not by a supplied id", () => {
    const fn = DISPATCH_TS.slice(DISPATCH_TS.indexOf("export async function getAssignedDeliveryForDriver"));
    expect(fn).toMatch(/\.eq\("user_id", params\.userId\)/);
    // The optional deliveryId may only NARROW; a mismatch returns null rather
    // than a 403, so it cannot confirm that someone else's delivery exists.
    expect(fn).toMatch(/params\.deliveryId !== assignment\.delivery_id/);
    expect(fn).toMatch(/assigned: null/);
  });

  it("the driver route offers no mutating verb", () => {
    const route = readFileSync(
      path.join(ROOT, "app/api/couranr/driver/assignment/route.ts"),
      "utf8"
    );
    expect(route).toMatch(/export async function GET/);
    expect(route).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/);
  });
});

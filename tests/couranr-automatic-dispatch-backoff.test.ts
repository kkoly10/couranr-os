import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Budget-drain regression for automatic dispatch.
 *
 * dispatchOne clears next_route_recheck_at after a successful revalidation, then
 * every early return that follows (no driver yet, a reservation blip, a
 * settlement/capture failure, a commit race) MUST schedule a recheck — otherwise
 * the cheap :234 backoff gate never fires and the paid Mapbox provider is
 * re-called on every 5-minute tick, draining the shared 50/day budget and
 * failing all customer quoting with cost_guard. These tests would go RED if any
 * of those returns forgot to schedule.
 */

const h = vi.hoisted(() => ({
  mapbox: vi.fn<any>(),
  reserve: null as any, // {data, error} returned by the reserve rpc
  fulfillment: null as any, // result of the credit/capture automation call
  scheduled: [] as any[], // recorded couranr_schedule_route_recheck args
  db: { request: null as any, existingDelivery: null as any },
}));

vi.mock("@/lib/couranr/routing/mapboxDirections", () => ({
  computeCanonicalMapboxRoute: (...a: any[]) => h.mapbox(...a),
}));

vi.mock("@/lib/couranr/fulfillment/commands", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual, // keep the real isFulfillmentFailure predicate
    createDeliveryFromPromotionalCreditForAutomation: async () => h.fulfillment,
    capturePaymentForAutomation: async () => h.fulfillment,
  };
});

vi.mock("@/lib/supabaseAdmin", () => {
  const chain = (table: string) => {
    const c: any = {};
    for (const m of ["select", "eq", "is", "in", "order", "limit"]) c[m] = () => c;
    c.maybeSingle = async () =>
      table === "couranr_delivery_requests"
        ? { data: h.db.request, error: null }
        : table === "couranr_deliveries"
          ? { data: h.db.existingDelivery, error: null }
          : { data: null, error: null };
    return c;
  };
  const rpc = async (fn: string, args: any) => {
    if (fn === "couranr_reserve_automatic_dispatch_candidate") return h.reserve;
    if (fn === "couranr_schedule_route_recheck") {
      h.scheduled.push(args);
      return { data: {}, error: null };
    }
    return { data: {}, error: null };
  };
  return { supabaseAdmin: { from: (t: string) => chain(t), rpc } };
});

import { dispatchOne } from "@/lib/couranr/automation/engine";

const REQ = "00000000-0000-4000-8000-0000000000r1";
const PLAN = "00000000-0000-4000-8000-0000000000d1";

const validRoute = {
  serviceabilityOutcome: "available_for_request",
  loadedMiles: 5,
  durationSeconds: 600,
  trafficDelaySeconds: 60,
  reviewReason: null,
};
const confirmedRequest = {
  id: REQ,
  request_state: "confirmed",
  readiness_state: "ready",
  current_quote_version_id: "q1",
  pickup_address: { latitude: 38.0, longitude: -77.0 },
  dropoff_address: { latitude: 38.1, longitude: -77.1 },
};

function plan(extra: Record<string, any> = {}) {
  return { id: PLAN, request_id: REQ, next_route_recheck_at: null, scheduled_pickup_start: null, ...extra };
}
const scheduledFor = (reason: string) => h.scheduled.find((a) => a.p_reason === reason);
const anyDispatchSchedule = () => h.scheduled.find((a) => String(a.p_reason).startsWith("dispatch_"));

beforeEach(() => {
  h.mapbox.mockReset();
  h.mapbox.mockResolvedValue(validRoute);
  h.scheduled.length = 0;
  h.db.request = confirmedRequest;
  h.db.existingDelivery = null;
  h.reserve = { data: { outcome: "waiting", reason: "no_candidate_yet" }, error: null };
  h.fulfillment = null;
});

describe("automatic dispatch backoff — no post-revalidation path drains the paid provider", () => {
  it("no_candidate_yet: schedules a recheck (15 min) so the next tick does not re-pay", async () => {
    const r1 = await dispatchOne(plan());
    expect(h.mapbox).toHaveBeenCalledTimes(1);
    expect(r1.outcome).toBe("waiting");
    const sched = anyDispatchSchedule();
    expect(sched, "no_candidate_yet must schedule a recheck").toBeTruthy();
    expect(sched.p_service_plan_id).toBe(PLAN);
    expect(sched.p_delay_minutes).toBe(15);

    // Next 5-min tick with the recheck now in the future → :234 gate short-circuits.
    const future = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const r2 = await dispatchOne(plan({ next_route_recheck_at: future }));
    expect(r2.reason).toBe("route_recheck_not_due");
    expect(h.mapbox, "paid provider must NOT be called again within the backoff").toHaveBeenCalledTimes(1);
  });

  it("reserve RPC failure schedules a recheck (was an uncovered drain return)", async () => {
    h.reserve = { data: null, error: { message: "reserve blew up" } };
    const r = await dispatchOne(plan());
    expect(r.outcome).toBe("candidate_reservation_failed");
    expect(scheduledFor("candidate_reservation_failed")?.p_delay_minutes).toBe(15);
  });

  it("a genuinely-stuck reserve exception backs off longer (60 min)", async () => {
    h.reserve = { data: { outcome: "exception", reason: "no_driver_before_deadline" }, error: null };
    await dispatchOne(plan());
    expect(anyDispatchSchedule()?.p_delay_minutes).toBe(60);
  });

  it("credit settlement failure schedules a 60-min recheck (money reconciliation path)", async () => {
    h.reserve = { data: { outcome: "reserved", reservationId: "resv-1" }, error: null };
    h.fulfillment = { ok: false, code: "internal", correlationId: "c1", message: "settle failed" };
    const r = await dispatchOne(plan({ promotional_credit_id: "credit-1" }));
    expect(r.outcome).toBe("dispatch_exception");
    expect(r.reason).toBe("commercial_settlement_failed");
    expect(scheduledFor("commercial_settlement_failed")?.p_delay_minutes).toBe(60);
  });

  it("payment capture reconciliation schedules a 60-min recheck", async () => {
    h.reserve = { data: { outcome: "reserved", reservationId: "resv-2" }, error: null };
    h.fulfillment = { ok: false, code: "internal", correlationId: "c2", message: "capture failed" };
    const r = await dispatchOne(plan()); // no promotional_credit_id → capture path
    expect(r.reason).toBe("payment_capture_requires_reconciliation");
    expect(scheduledFor("payment_capture_requires_reconciliation")?.p_delay_minutes).toBe(60);
  });
});

/**
 * P5-001 — the structured form is the merchant's LATER statement, and the
 * fact record must agree with it before policy runs and before the commit
 * command re-validates the arguments (§26). These are the planning rules;
 * the database half (retraction, commit after a weight-mode flip) runs in
 * e2e/disposable/smartIntake.mjs (SI-41..SI-46).
 */
import { describe, expect, it } from "vitest";
import { planIntakeFactSync, SYNCED_FACT_KEYS } from "@/lib/couranr/intake/sync";
import { validateFactValue } from "@/lib/couranr/shipment/facts";

const asap = {
  weightLb: null,
  weightBand: null,
  serviceLevel: "standard",
  timingIntent: "asap" as const,
  requestedPickupLocal: null,
};

describe("planIntakeFactSync", () => {
  it("exact weight in the form withdraws a confirmed band and states the exact", () => {
    const steps = planIntakeFactSync(
      [{ fact_key: "weight_band", value: "over_25_to_50_lb", authority: "confirmed" }],
      { ...asap, weightLb: 12 }
    );
    expect(steps).toEqual([
      { op: "confirm", factKey: "weight_lb_exact", value: 12, authority: "confirmed" },
      { op: "retract", factKey: "weight_band" },
      { op: "confirm", factKey: "service_level", value: "standard", authority: "confirmed" },
      { op: "confirm", factKey: "timing_intent", value: "asap", authority: "confirmed" },
    ]);
  });

  it("a band in the form withdraws a confirmed exact — the dead-end this exists for", () => {
    const steps = planIntakeFactSync(
      [
        { fact_key: "weight_lb_exact", value: 12, authority: "confirmed" },
        { fact_key: "service_level", value: "standard", authority: "confirmed" },
        { fact_key: "timing_intent", value: "asap", authority: "confirmed" },
      ],
      { ...asap, weightBand: "over_25_to_50_lb" }
    );
    expect(steps).toEqual([
      { op: "confirm", factKey: "weight_band", value: "over_25_to_50_lb", authority: "confirmed" },
      { op: "retract", factKey: "weight_lb_exact" },
    ]);
  });

  it("a trusted fact that already equals the form is left alone — no audit noise", () => {
    const steps = planIntakeFactSync(
      [
        { fact_key: "weight_band", value: "0_25_lb", authority: "overridden" },
        { fact_key: "service_level", value: "priority", authority: "confirmed" },
        { fact_key: "timing_intent", value: "asap", authority: "confirmed" },
      ],
      { ...asap, weightBand: "0_25_lb", serviceLevel: "priority" }
    );
    expect(steps).toEqual([]);
  });

  it("a trusted fact the form contradicts is OVERRIDDEN; a proposal is CONFIRMED", () => {
    const steps = planIntakeFactSync(
      [
        { fact_key: "weight_band", value: "0_25_lb", authority: "confirmed" },
        { fact_key: "service_level", value: "priority", authority: "proposed" },
      ],
      { ...asap, weightBand: "over_50_lb", serviceLevel: "priority" }
    );
    expect(steps).toEqual([
      { op: "confirm", factKey: "weight_band", value: "over_50_lb", authority: "overridden" },
      { op: "confirm", factKey: "service_level", value: "priority", authority: "confirmed" },
      { op: "confirm", factKey: "timing_intent", value: "asap", authority: "confirmed" },
    ]);
  });

  it("an already-withdrawn fact is not withdrawn twice", () => {
    const steps = planIntakeFactSync(
      [
        { fact_key: "weight_lb_exact", value: null, authority: "unknown" },
        { fact_key: "weight_band", value: "0_25_lb", authority: "confirmed" },
        { fact_key: "service_level", value: "standard", authority: "confirmed" },
        { fact_key: "timing_intent", value: "asap", authority: "confirmed" },
      ],
      { ...asap, weightBand: "0_25_lb" }
    );
    expect(steps).toEqual([]);
  });

  it("scheduling states the local time; going back to ASAP withdraws it", () => {
    const scheduled = planIntakeFactSync([], {
      ...asap,
      weightBand: "0_25_lb",
      timingIntent: "scheduled",
      requestedPickupLocal: "2026-09-03T09:30",
    });
    expect(scheduled).toContainEqual({
      op: "confirm",
      factKey: "requested_pickup_local",
      value: "2026-09-03T09:30",
      authority: "confirmed",
    });
    const backToAsap = planIntakeFactSync(
      [
        { fact_key: "timing_intent", value: "scheduled", authority: "confirmed" },
        { fact_key: "requested_pickup_local", value: "2026-09-03T09:30", authority: "confirmed" },
      ],
      { ...asap, weightBand: "0_25_lb" }
    );
    expect(backToAsap).toContainEqual({ op: "retract", factKey: "requested_pickup_local" });
    expect(backToAsap).toContainEqual({
      op: "confirm",
      factKey: "timing_intent",
      value: "asap",
      authority: "overridden",
    });
  });

  it("every value the plan emits is a legal value for its key", () => {
    const steps = planIntakeFactSync([], {
      weightLb: 37.5,
      weightBand: null,
      serviceLevel: "rush",
      timingIntent: "scheduled",
      requestedPickupLocal: "2026-09-04T14:00",
    });
    for (const step of steps) {
      if (step.op === "confirm") expect(validateFactValue(step.factKey, step.value)).toBe(true);
    }
    expect(steps.filter((s) => s.op === "confirm")).toHaveLength(4);
  });

  it("touches exactly the five keys the commit command compares, nothing else", () => {
    const steps = planIntakeFactSync(
      [
        { fact_key: "fragile", value: true, authority: "confirmed" },
        { fact_key: "restricted_class", value: "firearms", authority: "proposed" },
      ],
      { ...asap, weightLb: 3 }
    );
    for (const step of steps) {
      expect((SYNCED_FACT_KEYS as readonly string[]).includes(step.factKey)).toBe(true);
    }
    expect(steps.map((s) => s.factKey)).not.toContain("fragile");
    expect(steps.map((s) => s.factKey)).not.toContain("restricted_class");
  });
});

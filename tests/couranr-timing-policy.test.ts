/**
 * TMZ-001 / HRS — America/New_York request-timing doctrine.
 *
 * Every instant below is constructed in UTC and asserted against what the
 * OPERATING zone must make of it, so nothing in this file depends on the
 * machine's own timezone — which is precisely the property under test:
 * browser/device/process timezones have no authority.
 *
 * DST facts used (IANA America/New_York, 2026): EST = UTC-5 until
 * 2026-03-08 02:00, EDT = UTC-4 until 2026-11-01 02:00.
 */
import { describe, expect, it } from "vitest";
import {
  OPERATING_TIMEZONE,
  TIMING_POLICY_VERSION,
  evaluateRequestTiming,
  nextBusinessDay,
  operatingInstantFromLocal,
  operatingLocalParts,
  parseOperatingLocal,
} from "@/lib/couranr/timing/policy";

/** A Wednesday: 2026-09-02 (EDT, UTC-4). */
const wedAt = (hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 8, 2, hour + 4, minute)); // ET+4h = UTC during EDT

describe("zone conversion is IANA America/New_York, not a fixed offset", () => {
  it("winter noon ET is 17:00 UTC (EST, UTC-5)", () => {
    const instant = operatingInstantFromLocal({ year: 2026, month: 1, day: 15, hour: 12, minute: 0 });
    expect(instant.toISOString()).toBe("2026-01-15T17:00:00.000Z");
  });

  it("summer noon ET is 16:00 UTC (EDT, UTC-4) — a fixed offset fails one of these", () => {
    const instant = operatingInstantFromLocal({ year: 2026, month: 7, day: 15, hour: 12, minute: 0 });
    expect(instant.toISOString()).toBe("2026-07-15T16:00:00.000Z");
  });

  it("round-trips an instant through local parts", () => {
    const instant = new Date(Date.UTC(2026, 10, 20, 15, 45));
    const parts = operatingLocalParts(instant);
    expect(operatingInstantFromLocal(parts).getTime()).toBe(instant.getTime());
  });

  it("the spring-forward gap resolves to a defined instant, not NaN", () => {
    // 2026-03-08 02:30 ET does not exist (clocks jump 02:00 -> 03:00).
    const instant = operatingInstantFromLocal({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 });
    expect(Number.isFinite(instant.getTime())).toBe(true);
    const shown = operatingLocalParts(instant);
    expect(shown.year).toBe(2026);
    expect(shown.month).toBe(3);
    expect(shown.day).toBe(8);
  });

  it("refuses impossible and suffixed datetimes", () => {
    expect(parseOperatingLocal("2026-02-30T10:00")).toBeNull();
    expect(parseOperatingLocal("2026-09-02T10:00:00Z")).toBeNull();
    expect(parseOperatingLocal("2026-09-02 10:00")).toBeNull();
    expect(parseOperatingLocal("2026-09-02T24:00")).toBeNull();
  });
});

describe("HRS same-day cutoff — evaluated on the server against the operating zone", () => {
  it("ASAP at 3:59 PM ET on a weekday is same-day eligible", () => {
    const r = evaluateRequestTiming({ intent: "asap" }, wedAt(15, 59));
    expect(r.sameDayEligible).toBe(true);
    expect(r.expectedFulfillmentLocalDate).toBe("2026-09-02");
    expect(r.reviewReasons).toEqual([]);
  });

  it("ASAP at exactly 4:00 PM ET is NOT same-day — the boundary belongs to the cutoff", () => {
    const r = evaluateRequestTiming({ intent: "asap" }, wedAt(16, 0));
    expect(r.sameDayEligible).toBe(false);
    expect(r.expectedFulfillmentLocalDate).toBe("2026-09-03");
    expect(r.reviewReasons).toContain("same_day_after_cutoff");
  });

  it("Friday after cutoff lands on Monday, with no holiday calendar invented", () => {
    // 2026-09-04 is a Friday. 5 PM ET = 21:00 UTC (EDT).
    const r = evaluateRequestTiming({ intent: "asap" }, new Date(Date.UTC(2026, 8, 4, 21, 0)));
    expect(r.sameDayEligible).toBe(false);
    expect(r.expectedFulfillmentLocalDate).toBe("2026-09-07");
  });

  it("a Saturday ASAP request is never same-day", () => {
    const r = evaluateRequestTiming({ intent: "asap" }, new Date(Date.UTC(2026, 8, 5, 14, 0)));
    expect(r.sameDayEligible).toBe(false);
    expect(r.expectedFulfillmentLocalDate).toBe("2026-09-07");
  });

  it("the answer is a function of the OPERATING zone: 3:59 PM ET is 19:59 UTC, which a UTC or browser clock would misread", () => {
    // If the implementation consulted UTC wall-clock (19:59 > 16:00) it would
    // say after-cutoff. It must not.
    const r = evaluateRequestTiming({ intent: "asap" }, wedAt(15, 59));
    expect(r.sameDayEligible).toBe(true);
    expect(r.operatingTimezone).toBe(OPERATING_TIMEZONE);
    expect(r.timingPolicyVersion).toBe(TIMING_POLICY_VERSION);
  });
});

describe("scheduled timing", () => {
  const now = wedAt(10, 0); // Wed 10:00 AM ET

  it("persists BOTH the merchant's local words and the canonical instant", () => {
    const r = evaluateRequestTiming(
      { intent: "scheduled", requestedPickupLocal: "2026-09-03T09:30" },
      now
    );
    expect(r.requestedPickupLocal).toBe("2026-09-03T09:30");
    // 09:30 ET on 2026-09-03 (EDT) = 13:30 UTC.
    expect(r.requestedDepartureAt?.toISOString()).toBe("2026-09-03T13:30:00.000Z");
    expect(r.reviewReasons).toEqual([]);
    expect(r.expectedFulfillmentLocalDate).toBe("2026-09-03");
  });

  it("a requested time in the past goes to review, never silently moved", () => {
    const r = evaluateRequestTiming(
      { intent: "scheduled", requestedPickupLocal: "2026-09-01T10:00" },
      now
    );
    expect(r.reviewReasons).toContain("requested_time_in_past");
    expect(r.requestedPickupLocal).toBe("2026-09-01T10:00");
  });

  it("8 PM is the overnight window: request-only, Couranr must confirm — nothing here can", () => {
    const r = evaluateRequestTiming(
      { intent: "scheduled", requestedPickupLocal: "2026-09-03T20:00" },
      now
    );
    expect(r.reviewReasons).toContain("overnight_requires_couranr_confirmation");
  });

  it("5:30 AM is before earliest pickup and is the same overnight review", () => {
    const r = evaluateRequestTiming(
      { intent: "scheduled", requestedPickupLocal: "2026-09-03T05:30" },
      now
    );
    expect(r.reviewReasons).toContain("overnight_requires_couranr_confirmation");
  });

  it("a weekend request goes to review", () => {
    const r = evaluateRequestTiming(
      { intent: "scheduled", requestedPickupLocal: "2026-09-05T10:00" },
      now
    );
    expect(r.reviewReasons).toContain("requested_time_on_non_business_day");
  });

  it("scheduling TODAY after the cutoff has passed is flagged", () => {
    const r = evaluateRequestTiming(
      { intent: "scheduled", requestedPickupLocal: "2026-09-02T17:00" },
      wedAt(16, 30)
    );
    expect(r.reviewReasons).toContain("same_day_after_cutoff");
  });

  it("unparseable input reviews rather than guessing a date", () => {
    const r = evaluateRequestTiming(
      { intent: "scheduled", requestedPickupLocal: "tomorrow-ish" },
      now
    );
    expect(r.requestedDepartureAt).toBeNull();
    expect(r.reviewReasons).toContain("requested_time_unparseable");
  });
});

describe("next business day", () => {
  it("skips weekends", () => {
    const fri = operatingLocalParts(new Date(Date.UTC(2026, 8, 4, 12, 0)));
    expect(nextBusinessDay(fri).isoWeekday).toBe(1);
  });
});

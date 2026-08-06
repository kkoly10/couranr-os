import { describe, expect, it } from "vitest";
import {
  COURANR_TIMEZONE,
  OPERATING_START_HOUR,
  OPERATING_END_HOUR,
  addOperatingMinutes,
  formatInCouranrTime,
  fromZonedWallClock,
  isDaylightSaving,
  isOperatingDay,
  isWithinOperatingHours,
  isWithinOvernightWindow,
  nextOperatingPeriodStart,
  operatingMinutesBetween,
  toZonedParts,
  utcOffsetAt,
} from "@/lib/couranr/hours/operatingHours";

/**
 * HRS-002 — operating hours in America/New_York.
 *
 * EVERY UTC instant in this file was computed and checked with Python's
 * `zoneinfo` BEFORE being written here, independently of the `Intl`-based
 * implementation under test. Asserting an implementation against instants
 * derived from that same implementation proves only that it is
 * self-consistent, which is how a timezone bug survives a full green suite.
 *
 * The two transitions in 2026, for reference:
 *   spring forward  Sunday 2026-03-08, local 02:00 -> 03:00 (EST -> EDT)
 *   fall back       Sunday 2026-11-01, local 02:00 -> 01:00 (EDT -> EST)
 */

/** Reads as `Tue 2026-07-14 10:00 EDT`. */
const TUE_EDT_1000 = new Date("2026-07-14T14:00:00.000Z");
/** Reads as `Tue 2026-01-13 10:00 EST` — same wall clock, other side of DST. */
const TUE_EST_1000 = new Date("2026-01-13T15:00:00.000Z");
const FRI_EDT_1758 = new Date("2026-07-17T21:58:00.000Z");
const FRI_EDT_1800 = new Date("2026-07-17T22:00:00.000Z");
const SAT_EDT_1200 = new Date("2026-07-18T16:00:00.000Z");
const SUN_EDT_2300 = new Date("2026-07-20T03:00:00.000Z");
const MON_EDT_0559 = new Date("2026-07-20T09:59:00.000Z");
const MON_EDT_0600 = new Date("2026-07-20T10:00:00.000Z");

/** Friday before the spring-forward weekend, 17:50 EST. */
const FRI_BEFORE_SPRING_1750 = new Date("2026-03-06T22:50:00.000Z");
/** Friday before the fall-back weekend, 17:50 EDT. */
const FRI_BEFORE_FALL_1750 = new Date("2026-10-30T21:50:00.000Z");

const iso = (d: Date) => d.toISOString();

describe("HRS-002: the zone and its wall clock", () => {
  it("is America/New_York", () => {
    expect(COURANR_TIMEZONE).toBe("America/New_York");
  });

  it("reads an instant as the local wall clock, on both sides of DST", () => {
    const summer = toZonedParts(TUE_EDT_1000);
    expect([summer.year, summer.month, summer.day, summer.hour, summer.minute]).toEqual([
      2026, 7, 14, 10, 0,
    ]);
    expect(summer.isoWeekday).toBe(2); // Tuesday

    const winter = toZonedParts(TUE_EST_1000);
    expect([winter.year, winter.month, winter.day, winter.hour, winter.minute]).toEqual([
      2026, 1, 13, 10, 0,
    ]);
  });

  it("knows EDT from EST", () => {
    expect(isDaylightSaving(TUE_EDT_1000)).toBe(true);
    expect(isDaylightSaving(TUE_EST_1000)).toBe(false);
    expect(utcOffsetAt(TUE_EDT_1000)).toBe("-04:00");
    expect(utcOffsetAt(TUE_EST_1000)).toBe("-05:00");
  });

  it("round-trips wall clock -> instant -> wall clock in both offsets", () => {
    for (const src of [TUE_EDT_1000, TUE_EST_1000, FRI_EDT_1758, MON_EDT_0600]) {
      const p = toZonedParts(src);
      const back = fromZonedWallClock(p.year, p.month, p.day, p.hour, p.minute, p.second);
      expect(iso(back), `round trip of ${iso(src)}`).toBe(iso(src));
    }
  });

  it("formats an instant in Couranr time, not the server's zone", () => {
    expect(formatInCouranrTime(TUE_EDT_1000)).toBe("2026-07-14 10:00");
    // Same instant, formatted by the host, would read 14:00 under TZ=UTC.
    expect(formatInCouranrTime(TUE_EST_1000)).toBe("2026-01-13 10:00");
  });

  it("midnight reads as hour 0, never 24", () => {
    // hour12:false yields "24" for midnight in some ICU builds. Unnormalised,
    // that would compare as after 18:00 and be excluded for the wrong reason.
    const midnight = new Date("2026-07-15T04:00:00.000Z"); // 2026-07-15 00:00 EDT
    expect(toZonedParts(midnight).hour).toBe(0);
  });
});

describe("HRS-001 window: which instants are operating", () => {
  it("Monday to Friday are operating days; Saturday and Sunday are not", () => {
    expect(isOperatingDay(TUE_EDT_1000)).toBe(true);
    expect(isOperatingDay(FRI_EDT_1758)).toBe(true);
    expect(isOperatingDay(MON_EDT_0600)).toBe(true);
    expect(isOperatingDay(SAT_EDT_1200)).toBe(false);
    expect(isOperatingDay(SUN_EDT_2300)).toBe(false);
  });

  it("06:00 is INSIDE and 18:00 is OUTSIDE — the boundary HRS-002 fixes", () => {
    expect(isWithinOperatingHours(MON_EDT_0600)).toBe(true);
    expect(isWithinOperatingHours(MON_EDT_0559)).toBe(false);
    expect(isWithinOperatingHours(FRI_EDT_1758)).toBe(true);
    expect(isWithinOperatingHours(FRI_EDT_1800)).toBe(false);
  });

  it("a weekend instant inside 06:00-18:00 is still not operating", () => {
    // Saturday noon is inside the CLOCK window and outside the operating window.
    // A check that only compared hours would wrongly return true here.
    expect(toZonedParts(SAT_EDT_1200).hour).toBe(12);
    expect(isWithinOperatingHours(SAT_EDT_1200)).toBe(false);
  });

  it("the window constants match HRS-001", () => {
    expect(OPERATING_START_HOUR).toBe(6);
    expect(OPERATING_END_HOUR).toBe(18);
  });
});

describe("next-operating-period rollover", () => {
  it("is idempotent inside the window", () => {
    expect(iso(nextOperatingPeriodStart(TUE_EDT_1000))).toBe(iso(TUE_EDT_1000));
  });

  it("before opening on an operating day rolls to that day's 06:00", () => {
    expect(iso(nextOperatingPeriodStart(MON_EDT_0559))).toBe(iso(MON_EDT_0600));
  });

  it("after Friday close rolls across the weekend to Monday 06:00", () => {
    expect(iso(nextOperatingPeriodStart(FRI_EDT_1800))).toBe(iso(MON_EDT_0600));
  });

  it("Saturday and Sunday both roll to Monday 06:00", () => {
    expect(iso(nextOperatingPeriodStart(SAT_EDT_1200))).toBe(iso(MON_EDT_0600));
    expect(iso(nextOperatingPeriodStart(SUN_EDT_2300))).toBe(iso(MON_EDT_0600));
  });

  it("rolls across the SPRING-FORWARD weekend to the correct EDT instant", () => {
    // Friday 2026-03-06 18:00 EST -> Monday 2026-03-09 06:00 EDT. Adding 3x24h
    // to the instant would land at 05:00 local, because that weekend is 71
    // hours long, not 72.
    const friClose = new Date("2026-03-06T23:00:00.000Z"); // Fri 18:00 EST
    const monOpen = new Date("2026-03-09T10:00:00.000Z"); // Mon 06:00 EDT
    expect(iso(nextOperatingPeriodStart(friClose))).toBe(iso(monOpen));
    expect(isDaylightSaving(friClose)).toBe(false);
    expect(isDaylightSaving(monOpen)).toBe(true);
  });

  it("rolls across the FALL-BACK weekend to the correct EST instant", () => {
    const friClose = new Date("2026-10-30T22:00:00.000Z"); // Fri 18:00 EDT
    const monOpen = new Date("2026-11-02T11:00:00.000Z"); // Mon 06:00 EST
    expect(iso(nextOperatingPeriodStart(friClose))).toBe(iso(monOpen));
    expect(isDaylightSaving(friClose)).toBe(true);
    expect(isDaylightSaving(monOpen)).toBe(false);
  });
});

describe("the support clock runs in OPERATING minutes (TRM-001)", () => {
  /**
   * `support_target_applies: "during operating hours"`. These are the cases the
   * previous flat elapsed-time implementation got right and wrong.
   */
  it("UNCHANGED for an ordinary in-hours message — 10:00 + 15 = 10:15", () => {
    expect(iso(addOperatingMinutes(TUE_EDT_1000, 15))).toBe("2026-07-14T14:15:00.000Z");
    // and identically in standard time
    expect(iso(addOperatingMinutes(TUE_EST_1000, 15))).toBe("2026-01-13T15:15:00.000Z");
  });

  it("pauses overnight: Friday 17:58 + 15 operating minutes = Monday 06:13", () => {
    // Two minutes are spent before Friday close; thirteen resume Monday.
    // The flat rule said Friday 18:13, thirteen minutes into a closed office.
    const due = addOperatingMinutes(FRI_EDT_1758, 15);
    expect(iso(due)).toBe("2026-07-20T10:13:00.000Z");
    expect(formatInCouranrTime(due)).toBe("2026-07-20 06:13");
  });

  it("a weekend message starts its clock Monday: Saturday 12:00 + 15 = Monday 06:15", () => {
    const due = addOperatingMinutes(SAT_EDT_1200, 15);
    expect(iso(due)).toBe("2026-07-20T10:15:00.000Z");
    expect(formatInCouranrTime(due)).toBe("2026-07-20 06:15");
  });

  it("Sunday night and Monday pre-dawn both start Monday 06:00", () => {
    expect(iso(addOperatingMinutes(SUN_EDT_2300, 15))).toBe("2026-07-20T10:15:00.000Z");
    expect(iso(addOperatingMinutes(MON_EDT_0559, 15))).toBe("2026-07-20T10:15:00.000Z");
  });

  it("carries a deadline ACROSS the spring-forward transition", () => {
    // Friday 2026-03-06 17:50 EST. Ten minutes run before close, five remain.
    // 60.25 real hours pass; 15 operating minutes elapse.
    const due = addOperatingMinutes(FRI_BEFORE_SPRING_1750, 15);
    expect(iso(due)).toBe("2026-03-09T10:05:00.000Z");
    expect(formatInCouranrTime(due)).toBe("2026-03-09 06:05");
    expect(utcOffsetAt(FRI_BEFORE_SPRING_1750)).toBe("-05:00");
    expect(utcOffsetAt(due)).toBe("-04:00");
  });

  it("carries a deadline ACROSS the fall-back transition", () => {
    const due = addOperatingMinutes(FRI_BEFORE_FALL_1750, 15);
    expect(iso(due)).toBe("2026-11-02T11:05:00.000Z");
    expect(formatInCouranrTime(due)).toBe("2026-11-02 06:05");
    expect(utcOffsetAt(FRI_BEFORE_FALL_1750)).toBe("-04:00");
    expect(utcOffsetAt(due)).toBe("-05:00");
  });

  it("a deadline that exactly fills a period rolls forward, never landing on 18:00", () => {
    // 18:00 is OUTSIDE the window, so a deadline of exactly one full remaining
    // period must open the next one rather than sit on a closed boundary.
    const fri1700 = new Date("2026-07-17T21:00:00.000Z"); // Fri 17:00 EDT
    const due = addOperatingMinutes(fri1700, 60);
    expect(isWithinOperatingHours(due)).toBe(true);
    expect(formatInCouranrTime(due)).toBe("2026-07-20 06:00");
  });

  it("spans multiple whole days when the target is large", () => {
    // A 12-hour operating day. 25 hours = Tue 06:00 + 12 + 12 + 1 -> Thu 07:00.
    const tue0600 = new Date("2026-07-14T10:00:00.000Z");
    expect(formatInCouranrTime(addOperatingMinutes(tue0600, 25 * 60))).toBe("2026-07-16 07:00");
  });

  it("zero or negative minutes still land inside the window", () => {
    expect(iso(addOperatingMinutes(SAT_EDT_1200, 0))).toBe(iso(MON_EDT_0600));
    expect(iso(addOperatingMinutes(SAT_EDT_1200, -5))).toBe(iso(MON_EDT_0600));
  });
});

describe("operatingMinutesBetween is the inverse", () => {
  it("counts only operating time across a weekend, in all three weekend lengths", () => {
    /**
     * The strongest DST evidence in this file, and it emerged from getting the
     * arithmetic wrong first. The SAME 15 operating minutes span three
     * DIFFERENT absolute durations, because a weekend containing a transition
     * is not 72 hours long:
     *
     *   spring-forward weekend  59.25h   (one hour SHORTER — 02:00 -> 03:00)
     *   ordinary weekend        60.25h
     *   fall-back weekend       61.25h   (one hour LONGER  — 02:00 -> 01:00)
     *
     * Exactly +/- one hour either side of the ordinary case. Any implementation
     * that treated a day as a flat 24h would report 60.25 for all three, and
     * would put two of these deadlines an hour wrong.
     *
     * Verified with pure UTC arithmetic before being written here.
     */
    const cases: Array<[string, Date, Date, number]> = [
      ["spring", FRI_BEFORE_SPRING_1750, new Date("2026-03-09T10:05:00.000Z"), 59.25],
      ["ordinary", FRI_EDT_1758, new Date("2026-07-20T10:13:00.000Z"), 60.25],
      ["fall", FRI_BEFORE_FALL_1750, new Date("2026-11-02T11:05:00.000Z"), 61.25],
    ];
    for (const [name, start, end, absoluteHours] of cases) {
      expect(operatingMinutesBetween(start, end), `${name}: operating minutes`).toBe(15);
      expect(
        (end.getTime() - start.getTime()) / 3_600_000,
        `${name}: absolute hours`
      ).toBeCloseTo(absoluteHours, 2);
    }
  });

  it("agrees with addOperatingMinutes for a spread of inputs", () => {
    const starts = [
      TUE_EDT_1000, TUE_EST_1000, FRI_EDT_1758, SAT_EDT_1200,
      SUN_EDT_2300, MON_EDT_0559, FRI_BEFORE_SPRING_1750, FRI_BEFORE_FALL_1750,
    ];
    for (const start of starts) {
      for (const minutes of [1, 10, 15, 90, 600, 1500]) {
        const end = addOperatingMinutes(start, minutes);
        expect(
          operatingMinutesBetween(start, end),
          `${iso(start)} + ${minutes}min`
        ).toBeCloseTo(minutes, 6);
      }
    }
  });

  it("is zero for a fully-closed interval and for a reversed one", () => {
    expect(operatingMinutesBetween(SAT_EDT_1200, SUN_EDT_2300)).toBe(0);
    expect(operatingMinutesBetween(TUE_EDT_1000, TUE_EST_1000)).toBe(0);
  });
});

describe("OVN-001 overnight window — the clock only", () => {
  it("wraps midnight: 18:00 onward and before 06:00 are both inside", () => {
    expect(isWithinOvernightWindow(FRI_EDT_1800)).toBe(true);
    expect(isWithinOvernightWindow(SUN_EDT_2300)).toBe(true);
    expect(isWithinOvernightWindow(MON_EDT_0559)).toBe(true);
  });

  it("is false during the operating window", () => {
    expect(isWithinOvernightWindow(TUE_EDT_1000)).toBe(false);
    expect(isWithinOvernightWindow(MON_EDT_0600)).toBe(false);
    expect(isWithinOvernightWindow(FRI_EDT_1758)).toBe(false);
  });

  it("answers on a weekend too, because OVN-001 constrains hours not days", () => {
    const satNight = new Date("2026-07-19T00:00:00.000Z"); // Sat 20:00 EDT
    expect(toZonedParts(satNight).isoWeekday).toBe(6);
    expect(isWithinOvernightWindow(satNight)).toBe(true);
    // ...and it is emphatically NOT an operating period.
    expect(isWithinOperatingHours(satNight)).toBe(false);
  });

  it("the overnight window is exactly the complement of the clock window", () => {
    // Every hour of the day belongs to precisely one of the two, which is what
    // makes 18:00 end-exclusive on one side and start-inclusive on the other.
    for (let h = 0; h < 24; h++) {
      const at = fromZonedWallClock(2026, 7, 14, h, 30, 0); // a Tuesday
      const operating = isWithinOperatingHours(at);
      const overnight = isWithinOvernightWindow(at);
      expect(operating, `hour ${h}`).not.toBe(overnight);
    }
  });
});

describe("NEGATIVE CONTROLS: these assertions can actually fail", () => {
  /**
   * A timezone test that passes under any implementation is worthless. Each of
   * these pins the exact wrong answer a plausible bug would give.
   */
  it("would fail if the module used UTC instead of America/New_York", () => {
    // Under UTC, FRI_EDT_1758 reads 21:58 — outside 06:00-18:00 — so
    // isWithinOperatingHours would be false rather than true.
    const utcHour = FRI_EDT_1758.getUTCHours();
    expect(utcHour).toBe(21);
    expect(utcHour >= 6 && utcHour < 18).toBe(false);
    expect(isWithinOperatingHours(FRI_EDT_1758)).toBe(true);
  });

  it("would fail if the module used a fixed -5 offset year round", () => {
    // A hardcoded EST offset puts TUE_EDT_1000 at 09:00 local, not 10:00, and
    // the 10:15 deadline would come out as 09:15.
    const fixedMinus5 = new Date(TUE_EDT_1000.getTime() - 5 * 3_600_000).getUTCHours();
    expect(fixedMinus5).toBe(9);
    expect(toZonedParts(TUE_EDT_1000).hour).toBe(10);
  });

  it("would fail if the clock did NOT pause outside operating hours", () => {
    // The flat elapsed-time answer for Friday 17:58 + 15 minutes.
    const flat = new Date(FRI_EDT_1758.getTime() + 15 * 60_000);
    expect(formatInCouranrTime(flat)).toBe("2026-07-17 18:13");
    expect(isWithinOperatingHours(flat)).toBe(false);
    // The operating-time answer is a different instant entirely.
    expect(iso(addOperatingMinutes(FRI_EDT_1758, 15))).not.toBe(iso(flat));
  });

  it("would fail if weekend rollover added a flat 3 x 24h across a DST weekend", () => {
    // Friday 2026-03-06 18:00 EST. Wall-clock intuition says "+3 days = Monday
    // 18:00". Absolute arithmetic lands at Monday 19:00 EDT, an hour LATE,
    // because the spring-forward weekend is 71 hours long, not 72.
    const friClose = new Date("2026-03-06T23:00:00.000Z");
    const naive = new Date(friClose.getTime() + 3 * 86_400_000);
    expect(formatInCouranrTime(naive)).toBe("2026-03-09 19:00");
    expect(isWithinOperatingHours(naive)).toBe(false);
    // The rollover steps local calendar days instead, and lands on the window.
    expect(formatInCouranrTime(nextOperatingPeriodStart(friClose))).toBe("2026-03-09 06:00");
  });
});

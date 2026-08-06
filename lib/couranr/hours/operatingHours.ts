/**
 * Couranr operating hours. HRS-002.
 *
 * ---------------------------------------------------------------------------
 * THE AUTHORITY, AND EXACTLY WHAT IT DECIDES
 * ---------------------------------------------------------------------------
 *
 * `HRS-002` (root `02_DECISION_REGISTRY.json`, status `decided`, owner
 * decision 2026-08-06) names the zone: **America/New_York**, for every
 * operating hour and every support deadline, across every market.
 *
 * `HRS-001` sets the window: Monday-Friday, 06:00-18:00 local.
 *
 * `TRM-001` sets the target: `support_response_target_minutes = 15`, and —
 * this is the part that decides the whole shape of this module —
 * `support_target_applies: "during operating hours"`.
 *
 * `OVN-001` sets the overnight window: 18:00-06:00, request-only, surcharged,
 * never stacking with rush.
 *
 * WHAT NO AUTHORITY DECIDES, AND WHICH THIS MODULE THEREFORE DOES NOT DO:
 *
 *   `OVN-002` is still `unresolved`. It governs how a merchant REQUESTS
 *   overnight and how Couranr ENABLES and confirms it. Naming a timezone does
 *   not decide that. So `isWithinOvernightWindow` answers a question about the
 *   CLOCK and nothing else. It must not be read as "overnight is available",
 *   and nothing here decides availability, enablement, surcharge application
 *   or confirmation.
 *
 *   Holidays. `HRS-001` says "normally Monday unless closure or observed
 *   holiday" but no authority enumerates the holidays or the closure
 *   mechanism. `isOperatingDay` therefore answers weekday-vs-weekend only, and
 *   a holiday is treated as an ordinary operating day. That is wrong in the
 *   direction of marking a thread overdue too SOON rather than too late, which
 *   is the safe direction for a support deadline, and it is recorded rather
 *   than guessed.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CLOCK PAUSES, AND WHAT THAT CHANGES
 * ---------------------------------------------------------------------------
 *
 * `support_target_applies: "during operating hours"` means the 15 minutes are
 * OPERATING minutes, not wall-clock minutes. The clock runs while Couranr is
 * open and stops while it is closed.
 *
 * For the ordinary case this changes NOTHING. A message received Tuesday
 * 10:00 with more than 15 operating minutes left before 18:00 is still due at
 * 10:15 — identical to the previous flat-elapsed implementation, and the
 * existing tests of that case still pass unchanged.
 *
 * It changes only the cases the flat implementation got WRONG:
 *
 *   Friday 17:58  ->  the flat rule said Friday 18:13, two minutes before
 *                     close plus thirteen minutes of a closed office.
 *                     Now: Monday 06:13.
 *   Saturday 12:00 -> the flat rule said Saturday 12:15.
 *                     Now: Monday 06:15.
 *
 * Both previously marked a thread overdue during hours when nobody was meant
 * to be answering. That is the defect this module closes.
 *
 * ---------------------------------------------------------------------------
 * WHY Intl AND NOT A DATE LIBRARY
 * ---------------------------------------------------------------------------
 *
 * No new dependency. `Intl.DateTimeFormat` with a `timeZone` carries the full
 * IANA database including both DST transitions, and is available in Node 22
 * and Node 24 (this repo runs 22 locally and 24 in CI). A hand-rolled
 * "subtract 5 hours" would be wrong for seven months of the year.
 */

/** HRS-002. The single zone for every market. */
export const COURANR_TIMEZONE = "America/New_York";

/** HRS-001 standard window, local wall-clock. */
export const OPERATING_START_HOUR = 6;
export const OPERATING_END_HOUR = 18;

/** HRS-001 operating days. 1 = Monday … 7 = Sunday (ISO). */
export const OPERATING_ISO_WEEKDAYS = [1, 2, 3, 4, 5] as const;

/** OVN-001. The clock window only — availability is OVN-002 and unresolved. */
export const OVERNIGHT_START_HOUR = 18;
export const OVERNIGHT_END_HOUR = 6;

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  second: number;
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  isoWeekday: number;
}

const PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: COURANR_TIMEZONE,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  weekday: "short",
});

const ISO_WEEKDAY_BY_SHORT_NAME: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

/**
 * An instant, as it reads on a wall clock in America/New_York.
 *
 * `hour12: false` yields hour "24" for midnight in some ICU versions rather
 * than "00". That is normalised here rather than left to surprise a caller —
 * an unnormalised 24 would make a midnight instant compare as after 18:00 and
 * silently classify it as outside the window for the wrong reason.
 */
export function toZonedParts(instant: Date): ZonedParts {
  const parts = PARTS_FORMATTER.formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = Number(get("hour"));
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: hour === 24 ? 0 : hour,
    minute: Number(get("minute")),
    second: Number(get("second")),
    isoWeekday: ISO_WEEKDAY_BY_SHORT_NAME[get("weekday")],
  };
}

/** The zone's UTC offset in milliseconds at a given instant (EST -5h, EDT -4h). */
function offsetMsAt(instant: Date): number {
  const p = toZonedParts(instant);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Millisecond component is not carried by formatToParts, so compare on whole seconds.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Local wall-clock -> instant. The inverse of `toZonedParts`.
 *
 * Two-pass, because the offset depends on the instant we are trying to find.
 * Guess with the offset that applies at the naive UTC reading, then re-measure
 * at the guess and correct. One correction is enough for every real IANA zone;
 * a third pass would only matter for an offset change larger than the offset
 * itself, which does not occur.
 *
 * DST BEHAVIOUR, STATED RATHER THAN LEFT TO CHANCE:
 *
 *   SPRING FORWARD — 2026-03-08, local 02:00 jumps to 03:00, so 02:30 does not
 *   exist. A nonexistent wall-clock time resolves FORWARD, to the same instant
 *   03:30 EDT denotes. This is what the round-trip naturally produces and it is
 *   the safe direction for a deadline: it never lands earlier than asked.
 *
 *   FALL BACK — 2026-11-01, local 01:00-02:00 happens twice. An ambiguous
 *   wall-clock time resolves to the FIRST (still-EDT) occurrence, because the
 *   first pass reads the pre-transition offset. Stated so nobody has to
 *   rediscover it from a failing test.
 *
 * Neither case can affect an operating boundary: both transitions occur at
 * 02:00 local, which is outside 06:00-18:00 on a Sunday, which is not an
 * operating day. The window edges are therefore never ambiguous or
 * nonexistent. That is proven by test, not assumed.
 */
export function fromZonedWallClock(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0
): Date {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstGuess = new Date(naiveUtc - offsetMsAt(new Date(naiveUtc)));
  return new Date(naiveUtc - offsetMsAt(firstGuess));
}

/** HRS-001: Monday-Friday. Weekends are never operating days. */
export function isOperatingDay(instant: Date): boolean {
  return (OPERATING_ISO_WEEKDAYS as readonly number[]).includes(
    toZonedParts(instant).isoWeekday
  );
}

/**
 * Is this instant inside the operating window?
 *
 * HRS-002 fixes the boundary semantics: **start inclusive, end exclusive**.
 * 06:00:00 local is inside; 18:00:00 local is outside. Without that, a
 * deadline one second either side of 18:00 lands on a different day and the
 * ambiguity moves from the registry into the code.
 */
export function isWithinOperatingHours(instant: Date): boolean {
  const p = toZonedParts(instant);
  if (!(OPERATING_ISO_WEEKDAYS as readonly number[]).includes(p.isoWeekday)) return false;
  return p.hour >= OPERATING_START_HOUR && p.hour < OPERATING_END_HOUR;
}

/**
 * OVN-001's window, as a question about the clock ONLY.
 *
 * Wraps midnight: 18:00-23:59 and 00:00-05:59 are both inside. Returns true on
 * a Saturday at 20:00 as readily as on a Tuesday, because OVN-001 constrains
 * the hours and says nothing about days.
 *
 * THIS IS NOT AN AVAILABILITY ANSWER. Overnight is "request-only when Couranr
 * enables and confirms", and OVN-002 — the request-and-enable mechanism — is
 * `unresolved`. Nothing may treat a true here as permission to offer overnight.
 */
export function isWithinOvernightWindow(instant: Date): boolean {
  const { hour } = toZonedParts(instant);
  return hour >= OVERNIGHT_START_HOUR || hour < OVERNIGHT_END_HOUR;
}

/** The instant the operating window opens on the local calendar day of `instant`. */
function openingOn(instant: Date): Date {
  const p = toZonedParts(instant);
  return fromZonedWallClock(p.year, p.month, p.day, OPERATING_START_HOUR, 0, 0);
}

/** The instant the operating window closes on the local calendar day of `instant`. */
function closingOn(instant: Date): Date {
  const p = toZonedParts(instant);
  return fromZonedWallClock(p.year, p.month, p.day, OPERATING_END_HOUR, 0, 0);
}

/**
 * The start of the next operating period at or after `instant`.
 *
 * Returns `instant` unchanged when it is already inside the window, so this is
 * idempotent and safe to apply more than once.
 *
 * Steps a local calendar day at a time rather than adding 24h to the instant,
 * because a DST day is 23 or 25 hours long and adding 24h across a transition
 * lands on the wrong wall-clock time. The bound of 8 iterations covers the
 * longest possible gap (Friday evening to Monday morning is 3 steps) with room
 * to spare, and throws rather than looping forever if the zone data were ever
 * to make the assumption false.
 */
export function nextOperatingPeriodStart(instant: Date): Date {
  if (isWithinOperatingHours(instant)) return instant;

  // Before opening on an operating day: today's opening.
  if (isOperatingDay(instant)) {
    const open = openingOn(instant);
    if (instant.getTime() < open.getTime()) return open;
  }

  // Otherwise the next operating day's opening.
  let cursor = instant;
  for (let i = 0; i < 8; i++) {
    // Midday avoids landing in a DST gap while stepping.
    const p = toZonedParts(cursor);
    cursor = new Date(fromZonedWallClock(p.year, p.month, p.day, 12, 0, 0).getTime() + DAY_MS);
    if (isOperatingDay(cursor)) return openingOn(cursor);
  }
  throw new Error("nextOperatingPeriodStart: no operating day within 8 days");
}

/**
 * Add `minutes` of OPERATING time to `from`, skipping every closed period.
 *
 * This is what `support_target_applies: "during operating hours"` means
 * arithmetically. A message received two minutes before Friday close consumes
 * those two minutes on Friday and the remaining thirteen on Monday morning.
 *
 * `minutes <= 0` returns the operating-period start rather than `from`, so a
 * zero-minute deadline still lands inside the window rather than in a closed
 * period.
 */
export function addOperatingMinutes(from: Date, minutes: number): Date {
  let cursor = nextOperatingPeriodStart(from);
  let remainingMs = Math.max(0, minutes) * MINUTE_MS;

  for (let i = 0; i < 400; i++) {
    if (remainingMs === 0) return cursor;
    const close = closingOn(cursor);
    const availableMs = close.getTime() - cursor.getTime();

    if (remainingMs < availableMs) return new Date(cursor.getTime() + remainingMs);

    // Consume the rest of this period and continue from the next one. When the
    // remainder exactly fills the period the deadline is the close instant,
    // which is OUTSIDE the window (end-exclusive), so it must roll forward.
    remainingMs -= availableMs;
    cursor = nextOperatingPeriodStart(new Date(close.getTime() + MINUTE_MS));
    if (remainingMs === 0) return cursor;
  }
  throw new Error("addOperatingMinutes: did not converge");
}

/**
 * Operating minutes elapsed between two instants, ignoring closed time.
 *
 * The counterpart of `addOperatingMinutes`, and the reason a due state cannot
 * simply subtract two timestamps: a thread received Friday 17:50 and read
 * Monday 06:05 has had 15 operating minutes pass, not three days.
 */
export function operatingMinutesBetween(start: Date, end: Date): number {
  if (end.getTime() <= start.getTime()) return 0;

  let cursor = nextOperatingPeriodStart(start);
  if (cursor.getTime() >= end.getTime()) return 0;

  let totalMs = 0;
  for (let i = 0; i < 400; i++) {
    const close = closingOn(cursor);
    if (end.getTime() <= close.getTime()) {
      totalMs += end.getTime() - cursor.getTime();
      return totalMs / MINUTE_MS;
    }
    totalMs += close.getTime() - cursor.getTime();
    const next = nextOperatingPeriodStart(new Date(close.getTime() + MINUTE_MS));
    if (next.getTime() >= end.getTime()) return totalMs / MINUTE_MS;
    cursor = next;
  }
  throw new Error("operatingMinutesBetween: did not converge");
}

/** Formats an instant as local wall clock, for a screen or a report. */
export function formatInCouranrTime(instant: Date): string {
  const p = toZonedParts(instant);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** Diagnostic: is the zone in daylight saving at this instant? EDT vs EST. */
export function isDaylightSaving(instant: Date): boolean {
  // January is always standard time in this zone; a larger offset means DST.
  const january = Date.UTC(toZonedParts(instant).year, 0, 15, 12, 0, 0);
  return offsetMsAt(instant) > offsetMsAt(new Date(january));
}

/** The zone's offset at an instant, as "-05:00" / "-04:00". For reports. */
export function utcOffsetAt(instant: Date): string {
  const ms = offsetMsAt(instant);
  const sign = ms <= 0 ? "-" : "+";
  const abs = Math.abs(ms);
  const h = Math.floor(abs / HOUR_MS);
  const m = Math.floor((abs % HOUR_MS) / MINUTE_MS);
  return `${sign}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

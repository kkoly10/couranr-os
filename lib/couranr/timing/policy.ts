/**
 * TMZ-001 / HRS — Couranr MVP request-time operating doctrine.
 *
 * ---------------------------------------------------------------------------
 * AUTHORITY
 * ---------------------------------------------------------------------------
 *
 * The MVP operating timezone is the IANA zone `America/New_York`, by owner
 * decision (TMZ-001, 2026-09-02). NOT a fixed EST/EDT offset: DST follows the
 * zone automatically through the platform's tzdata via `Intl.DateTimeFormat`.
 * Browser and device timezones have no authority anywhere in this module —
 * every conversion here happens server-side against the named zone.
 *
 * Operating doctrine (HRS, PRODUCT_SPEC §4 "Operating hours"):
 *
 *   - Monday–Friday
 *   - standard fulfillment window: 6:00 AM – 6:00 PM
 *   - earliest pickup: 6:00 AM
 *   - same-day request cutoff: 4:00 PM
 *   - at/after 4:00 PM: normally next business day
 *   - Friday at/after 4:00 PM: normally Monday (closures/observed holidays
 *     stay Operations-governed — there is deliberately NO holiday calendar
 *     here, so nothing can silently promise a holiday delivery)
 *   - overnight (6:00 PM – 6:00 AM): REQUEST-ONLY, requires Couranr
 *     confirmation; nothing in this module can grant it
 *
 * Requested timing is ESTIMATED until Couranr confirms it. This module only
 * ever evaluates what was REQUESTED; the confirmed planning object remains the
 * downstream Service Plan.
 *
 * If Couranr later operates a second timezone, that is a future policy version
 * — this module is single-zone by design and says so in its version string.
 */

export const OPERATING_TIMEZONE = "America/New_York";

/** Versioned so a stored evaluation can name the doctrine it applied. */
export const TIMING_POLICY_VERSION = "couranr-timing-v1-2026-09-02";

export const EARLIEST_PICKUP_MINUTES = 6 * 60; // 6:00 AM
export const SAME_DAY_CUTOFF_MINUTES = 16 * 60; // 4:00 PM
export const STANDARD_END_MINUTES = 18 * 60; // 6:00 PM

export const TIMING_INTENTS = ["asap", "scheduled"] as const;
export type TimingIntent = (typeof TIMING_INTENTS)[number];

/**
 * Closed vocabulary. These are persisted, so additions are policy versions,
 * not edits. None of them is a lifecycle state — they are review REASONS.
 */
export type TimingReviewReason =
  | "requested_time_in_past"
  | "requested_time_unparseable"
  | "requested_time_on_non_business_day"
  | "overnight_requires_couranr_confirmation"
  | "same_day_after_cutoff";

export type LocalParts = {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  /** 1 = Monday … 7 = Sunday (ISO). */
  isoWeekday: number;
};

/* ------------------------------------------------------------------ zone */

const WEEKDAY_TO_ISO: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

/**
 * Wall-clock parts of an instant in the operating zone. `Intl` consults the
 * platform tzdata for `America/New_York`, which is what makes DST automatic
 * rather than an offset someone hardcoded.
 */
export function operatingLocalParts(instant: Date): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: OPERATING_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(instant)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    isoWeekday: WEEKDAY_TO_ISO[parts.weekday] ?? 0,
  };
}

/**
 * The instant a given `America/New_York` wall-clock time names.
 *
 * The standard two-pass technique: guess the instant as if the wall clock were
 * UTC, measure what wall clock that instant actually shows in the zone, and
 * correct by the difference — twice, because the first correction can cross a
 * DST transition. Behavior at the edges is DEFINED, not accidental:
 *
 *   - a nonexistent time (spring-forward gap, e.g. 02:30 on the second Sunday
 *     of March) resolves to the instant after the gap;
 *   - an ambiguous time (fall-back repeat) resolves to the EARLIER offset,
 *     i.e. the first occurrence.
 *
 * Both edges are inside the overnight window, which is request-only anyway,
 * so neither can move money.
 */
export function operatingInstantFromLocal(parts: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}): Date {
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    const shown = operatingLocalParts(new Date(guess));
    const shownAsUtc = Date.UTC(
      shown.year,
      shown.month - 1,
      shown.day,
      shown.hour,
      shown.minute
    );
    guess += asUtc - shownAsUtc;
  }
  return new Date(guess);
}

const LOCAL_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * Merchant-entered local time, `YYYY-MM-DDTHH:MM` (the shape a
 * `<input type="datetime-local">` produces). NO timezone suffix is accepted:
 * the zone is Couranr's operating decision, never the caller's claim.
 */
export function parseOperatingLocal(
  raw: string
): { year: number; month: number; day: number; hour: number; minute: number } | null {
  const m = LOCAL_DATETIME_RE.exec(raw);
  if (!m) return null;
  const [year, month, day, hour, minute] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59) return null;
  // Reject impossible dates (Feb 30) rather than letting Date.UTC roll them
  // over into a different day the merchant never typed.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return { year, month, day, hour, minute };
}

/* ------------------------------------------------------------- doctrine */

function isBusinessDay(isoWeekday: number): boolean {
  return isoWeekday >= 1 && isoWeekday <= 5;
}

function minutesOfDay(p: { hour: number; minute: number }): number {
  return p.hour * 60 + p.minute;
}

/** Local date `days` later, expressed as parts at a given wall-clock time. */
function addLocalDays(p: LocalParts, days: number): LocalParts {
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  const iso = ((d.getUTCDay() + 6) % 7) + 1;
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: p.hour,
    minute: p.minute,
    isoWeekday: iso,
  };
}

/** The next Monday–Friday strictly after the given local date. */
export function nextBusinessDay(p: LocalParts): LocalParts {
  let candidate = addLocalDays(p, 1);
  while (!isBusinessDay(candidate.isoWeekday)) candidate = addLocalDays(candidate, 1);
  return candidate;
}

export function formatLocalDate(p: LocalParts): string {
  const mm = String(p.month).padStart(2, "0");
  const dd = String(p.day).padStart(2, "0");
  return `${p.year}-${mm}-${dd}`;
}

export type TimingEvaluation = {
  intent: TimingIntent;
  operatingTimezone: typeof OPERATING_TIMEZONE;
  timingPolicyVersion: typeof TIMING_POLICY_VERSION;
  /**
   * Canonical instant of the requested departure. `null` for ASAP (departure
   * is "now", which is not a stored promise) and for unparseable input.
   */
  requestedDepartureAt: Date | null;
  /** The merchant's own words, preserved verbatim as evidence. */
  requestedPickupLocal: string | null;
  /** ASAP only: is same-day fulfillment still promisable right now? */
  sameDayEligible: boolean;
  /**
   * The local DATE Couranr currently expects fulfillment to start —
   * "understood as", never "confirmed for".
   */
  expectedFulfillmentLocalDate: string;
  reviewReasons: TimingReviewReason[];
};

/**
 * Evaluate requested timing under the operating doctrine.
 *
 * `now` is the SERVER's clock; there is deliberately no default so a caller
 * cannot accidentally evaluate against a stale captured instant, and tests
 * must say exactly which moment they mean.
 */
export function evaluateRequestTiming(
  input: { intent: TimingIntent; requestedPickupLocal?: string | null },
  now: Date
): TimingEvaluation {
  const nowLocal = operatingLocalParts(now);
  const reasons: TimingReviewReason[] = [];

  if (input.intent === "asap") {
    const beforeCutoff =
      isBusinessDay(nowLocal.isoWeekday) &&
      minutesOfDay(nowLocal) < SAME_DAY_CUTOFF_MINUTES;
    const expected = beforeCutoff ? nowLocal : nextBusinessDay(nowLocal);
    if (!beforeCutoff) reasons.push("same_day_after_cutoff");
    return {
      intent: "asap",
      operatingTimezone: OPERATING_TIMEZONE,
      timingPolicyVersion: TIMING_POLICY_VERSION,
      requestedDepartureAt: null,
      requestedPickupLocal: null,
      sameDayEligible: beforeCutoff,
      expectedFulfillmentLocalDate: formatLocalDate(expected),
      reviewReasons: reasons,
    };
  }

  // Scheduled.
  const raw = input.requestedPickupLocal ?? "";
  const parsed = parseOperatingLocal(raw);
  if (!parsed) {
    return {
      intent: "scheduled",
      operatingTimezone: OPERATING_TIMEZONE,
      timingPolicyVersion: TIMING_POLICY_VERSION,
      requestedDepartureAt: null,
      requestedPickupLocal: raw || null,
      sameDayEligible: false,
      expectedFulfillmentLocalDate: formatLocalDate(nextBusinessDay(nowLocal)),
      reviewReasons: ["requested_time_unparseable"],
    };
  }

  const instant = operatingInstantFromLocal(parsed);
  const requestedLocal = operatingLocalParts(instant);
  const requestedMinutes = minutesOfDay(parsed);

  if (instant.getTime() <= now.getTime()) reasons.push("requested_time_in_past");
  if (!isBusinessDay(requestedLocal.isoWeekday)) {
    reasons.push("requested_time_on_non_business_day");
  }
  if (
    requestedMinutes < EARLIEST_PICKUP_MINUTES ||
    requestedMinutes >= STANDARD_END_MINUTES
  ) {
    // The 6 PM – 6 AM window is the overnight product: request-only, and only
    // Couranr can confirm it. Nothing here approves it.
    reasons.push("overnight_requires_couranr_confirmation");
  }
  const sameLocalDay =
    requestedLocal.year === nowLocal.year &&
    requestedLocal.month === nowLocal.month &&
    requestedLocal.day === nowLocal.day;
  if (sameLocalDay && minutesOfDay(nowLocal) >= SAME_DAY_CUTOFF_MINUTES) {
    reasons.push("same_day_after_cutoff");
  }

  return {
    intent: "scheduled",
    operatingTimezone: OPERATING_TIMEZONE,
    timingPolicyVersion: TIMING_POLICY_VERSION,
    requestedDepartureAt: instant,
    requestedPickupLocal: raw,
    sameDayEligible: false,
    expectedFulfillmentLocalDate: formatLocalDate(requestedLocal),
    reviewReasons: reasons,
  };
}

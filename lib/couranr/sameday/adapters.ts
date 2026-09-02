/**
 * The six Same Day frontend adapters, and the disabled implementations that
 * are what production actually gets.
 *
 * V10 is FRONTEND ONLY. Each capability below has a real backend one day; none
 * of them has one today. Naming them as separate adapters rather than one
 * "isFixture" branch keeps the seam honest — when address search becomes real,
 * exactly one of these changes and nothing else on the page moves.
 *
 * Every adapter is asked for by `getSameDayAdapters()`, which asks
 * `resolveAdapterMode()`. A component never chooses.
 *
 * NOTHING HERE TALKS TO A SERVER. The fixture implementations are pure
 * functions over their inputs; the disabled implementations refuse. There is no
 * network call in this file, by design and not by omission.
 */
import { BASE_PRICE_CENTS } from "@/lib/couranr/pricing";
import { resolveAdapterMode, type AdapterEnv, type AdapterMode } from "./adapterMode";

export type AddressSuggestion = { id: string; label: string; detail: string };

export type AvailabilityVerdict =
  | { state: "eligible" }
  | { state: "review-needed"; note: string }
  | { state: "unavailable"; note: string };

export type IntakeReading =
  | { state: "interpreted"; summary: string; needsFollowUp?: string }
  | { state: "needs-follow-up"; question: string }
  | { state: "unavailable" };

export type QuoteReading =
  | { state: "fixture-available"; totalCents: number; note: string }
  | { state: "manual-review"; note: string }
  | { state: "unavailable"; note: string };

export type SubmitOutcome =
  | { state: "received-preview" }
  | { state: "unavailable"; note: string };

export type PaymentOutcome =
  | { state: "authorized-fixture" }
  | { state: "not-available"; note: string };

export type SameDayAdapters = {
  mode: AdapterMode;
  searchAddress(query: string): Promise<AddressSuggestion[]>;
  checkAvailability(pickup: string, destination: string): Promise<AvailabilityVerdict>;
  readIntake(text: string): Promise<IntakeReading>;
  quote(input: { pickup: string; destination: string; timing: string }): Promise<QuoteReading>;
  submitRequest(): Promise<SubmitOutcome>;
  authorizePayment(): Promise<PaymentOutcome>;
};

/** The production stop, verbatim from MKT-005. */
export const PRODUCTION_STOP_KEY = "production_stop" as const;

/* ------------------------------------------------------------- disabled */

/**
 * What production gets. Every capability refuses, and — the part that matters —
 * NONE of them can return a success shape. `submitRequest` cannot return
 * `received-preview`; `authorizePayment` cannot return `authorized-fixture`.
 * The types allow it; these implementations never construct it.
 */
const DISABLED: Omit<SameDayAdapters, "mode"> = {
  async searchAddress() {
    return [];
  },
  async checkAvailability() {
    return { state: "unavailable", note: "Same Day availability is not live yet." };
  },
  async readIntake() {
    return { state: "unavailable" };
  },
  async quote() {
    return { state: "unavailable", note: "Same Day pricing is not live yet." };
  },
  async submitRequest() {
    return { state: "unavailable", note: "Same Day ordering is not live yet." };
  },
  async authorizePayment() {
    return { state: "not-available", note: "Same Day payment is not live yet." };
  },
};

/* -------------------------------------------------------------- fixture */

/**
 * Deterministic, and deterministic on purpose: a browser gate asserts on these
 * exact strings, and a fixture that varied would make the gate flaky rather
 * than the product better. No randomness, no clock.
 */
const FIXTURE_PLACES: AddressSuggestion[] = [
  { id: "fx-1", label: "Main Street Bakery", detail: "112 Main Street" },
  { id: "fx-2", label: "Main Street Cleaners", detail: "140 Main Street" },
  { id: "fx-3", label: "Main Street Print Shop", detail: "166 Main Street" },
];

const FIXTURE: Omit<SameDayAdapters, "mode"> = {
  async searchAddress(query) {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    if (q.includes("nowhere")) return [];
    return FIXTURE_PLACES.filter((p) => p.label.toLowerCase().includes(q) || q.length >= 3);
  },
  async checkAvailability(pickup, destination) {
    if (!pickup || !destination) {
      return { state: "unavailable", note: "Enter both a pickup and a destination." };
    }
    if (`${pickup} ${destination}`.toLowerCase().includes("review")) {
      return { state: "review-needed", note: "Couranr will confirm this trip before scheduling." };
    }
    return { state: "eligible" };
  },
  async readIntake(text) {
    const t = text.trim();
    if (t.length < 8) return { state: "needs-follow-up", question: "What is being delivered?" };
    if (/\bcake|bakery|order\b/i.test(t)) {
      return { state: "interpreted", summary: "A collected order from a local business." };
    }
    return { state: "interpreted", summary: "A small item to be delivered locally." };
  },
  async quote(input) {
    if (!input.pickup || !input.destination) {
      return { state: "unavailable", note: "A quote needs both addresses." };
    }
    if (input.timing === "schedule") {
      return { state: "manual-review", note: "Couranr will confirm scheduled trips before pricing." };
    }
    /* A fixture amount, reachable ONLY in fixture mode and never a production
       claim. It READS the Pricing V2 base fare rather than restating it:
       consumer Same Day will use the SAME universal engine, so an example that
       drifted from it would teach the wrong price, and a literal here is
       exactly how that drift starts. Reading the constant is not computing a
       quote — no trip input reaches it, and nothing above the included
       allowance is priced. */
    return {
      state: "fixture-available",
      totalCents: BASE_PRICE_CENTS,
      note: "Example only — not a live quote.",
    };
  },
  async submitRequest() {
    return { state: "received-preview" };
  },
  async authorizePayment() {
    return { state: "authorized-fixture" };
  },
};

export function getSameDayAdapters(env?: AdapterEnv): SameDayAdapters {
  const { mode } = resolveAdapterMode(env);
  return { mode, ...(mode === "fixture" ? FIXTURE : DISABLED) };
}

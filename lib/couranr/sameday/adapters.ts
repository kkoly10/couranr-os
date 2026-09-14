/**
 * The Same Day frontend adapters, and the two implementations behind them:
 * `live` (the real consumer backend) and `fixture` (deterministic in-memory
 * data for tests and explicit local/preview demos).
 *
 * `live` is the DEFAULT for every real environment — production included. It is
 * built in `./liveAdapters.ts`, the ONE place Same Day talks to the consumer
 * API. `fixture` is pure functions over their inputs and never touches a
 * server. Which one a mount gets is decided by `resolveAdapterMode()` from
 * server/build-time environment only (adapterMode.ts); a component never
 * chooses.
 */
import { BASE_PRICE_CENTS } from "@/lib/couranr/pricing";
import type { TimingIntent } from "@/lib/couranr/timing/policy";
import { resolveAdapterMode, type AdapterEnv, type AdapterMode } from "./adapterMode";
import { createLiveSameDayAdapters } from "./liveAdapters";

export type AddressSuggestion = { id: string; label: string; detail: string };

/**
 * The result of an address search. A provider/service FAILURE is distinct from
 * a genuine empty result, so the UI can say "Address lookup is unavailable"
 * rather than "No matches" — and `rate-limited` is its own outcome, since the
 * remedy (wait) is specific.
 */
export type AddressSearchResult =
  | { status: "ok"; suggestions: AddressSuggestion[] }
  | { status: "rate-limited" }
  | { status: "error" };

export type AvailabilityVerdict =
  | { state: "eligible" }
  | { state: "review-needed"; note: string }
  | { state: "unavailable"; note: string };

/**
 * ADDITIVE (INT-002): a STRUCTURED proposal from Consumer Smart Intake. The
 * value is a closed-vocabulary fact (a weight band, a restricted class, a
 * category, a count) — never model prose. Material keys need the guest's
 * explicit "Use this"; nothing is prefilled silently.
 */
export type IntakeProposal = {
  key: string;
  value: unknown;
  confidence: number | null;
  requiresConfirmation: boolean;
};

export type IntakeReading =
  | { state: "interpreted"; summary: string; needsFollowUp?: string; proposals?: IntakeProposal[] }
  | { state: "needs-follow-up"; question: string; proposals?: IntakeProposal[] }
  | { state: "unavailable" };

export type QuoteReading =
  | { state: "fixture-available"; totalCents: number; note: string }
  /* ADDITIVE (batch 3 §D): the live sibling of `fixture-available`. Every
     number in it is server-derived — the browser sent place identities and a
     structured shipment statement, never an amount. `expiresAt` is QVL-001's
     15-minute display hint; the database owns the clock. */
  | {
      state: "live-available";
      totalCents: number;
      quoteVersionId: string | null;
      requestId: string;
      expiresAt: string | null;
      /* ADDITIVE: the server's echo of the timing it priced — the sender's own
         words, never a browser-picked zone or instant. */
      timing?: { intent: TimingIntent; requestedPickupLocal: string | null };
    }
  | { state: "manual-review"; note: string }
  | { state: "unavailable"; note: string };

export type SubmitOutcome =
  | { state: "received-preview" }
  /* ADDITIVE: the live submit — a real request now exists in Couranr review. */
  | { state: "received"; requestId: string | null }
  | { state: "unavailable"; note: string };

export type PaymentOutcome =
  | { state: "authorized-fixture" }
  /* ADDITIVE: live payment never authorizes here. The server minted a payment
     intent; the browser must confirm it through the one Stripe Payment Element
     and then the SERVER (reconcile) is the only voice on whether it authorized. */
  | { state: "authorization-required"; clientSecret: string; amountCents: number }
  /* ADDITIVE: the request was received but payment is not open — the manual-
     review path, or a request already authorized and under Couranr review. */
  | { state: "not-payable"; note: string }
  /* ADDITIVE (review item 2): QVL-001 expired the quote before authorization.
     The remedy is specific — re-estimate, which mints Quote N+1 — so the UI
     gets a distinct state instead of parsing a message. */
  | { state: "quote-expired"; note: string }
  | { state: "not-available"; note: string };

/**
 * The quote input. The three original fields are what the fixture reads; the
 * optional fields are ADDITIVE and live-only — fixtures ignore them, and the
 * live adapter refuses (with an instructive note, no network call) until the
 * ones the canonical estimate requires are present.
 */
export type QuoteInput = {
  pickup: string;
  destination: string;
  /** TMZ-001: ASAP, or a scheduled pickup at an Eastern wall-clock time. */
  timingIntent: TimingIntent;
  /** `YYYY-MM-DDTHH:MM` local words when scheduled; the SERVER owns the instant. */
  requestedPickupLocal?: string | null;
  pickupPlaceId?: string | null;
  dropoffPlaceId?: string | null;
  /** UI field names. The adapter maps `mobile` -> the API/DB key `phone`. */
  contact?: { name?: string; mobile?: string; email?: string };
  shipment?: {
    description?: string | null;
    packageCount?: number | null;
    orderReference?: string | null;
    weightLb?: number | null;
    weightBand?: string | null;
    restrictedClass?: string;
    signatureRequired?: boolean;
    overnightRequested?: boolean;
  };
};

/** What the server said after it re-read the PaymentIntent. Server words only. */
export type PaymentReconciliation = { outcome?: string; paymentState?: string | null };

/** Guest-declared pickup readiness, persisted on canonical readiness_state. */
export type ReadinessOutcome = {
  ok: boolean;
  state?: "ready" | "not_ready";
  note?: string;
};

/** The guest's own-request projection, verbatim from the consumer request GET. */
export type PickupCredentialReading = {
  ok: boolean;
  deliveryId?: string;
  code?: string;
  expiresAt?: string;
  warning?: string;
  note?: string;
};

export type ConsumerRequestReading = {
  state: string;
  quoteStatus: string;
  totalCents: number | null;
  paymentState: string | null;
  trackingToken?: string;
};

export type SameDayAdapters = {
  mode: AdapterMode;
  searchAddress(query: string): Promise<AddressSearchResult>;
  checkAvailability(pickup: string, destination: string): Promise<AvailabilityVerdict>;
  readIntake(text: string): Promise<IntakeReading>;
  quote(input: QuoteInput): Promise<QuoteReading>;
  submitRequest(): Promise<SubmitOutcome>;
  authorizePayment(): Promise<PaymentOutcome>;
  /* ADDITIVE, live-only, both OPTIONAL so the fixture and disabled objects
     stay byte-identical to what shipped. A component must feature-check. */
  reconcilePayment?(): Promise<PaymentReconciliation>;
  /** Live-only: persists the explicit guest declaration on shared readiness_state. */
  setPickupReadiness?(readiness: "ready" | "not_ready"): Promise<ReadinessOutcome>;
  issuePickupCredential?(): Promise<PickupCredentialReading>;
  readRequest?(): Promise<ConsumerRequestReading | null>;
  /* ADDITIVE, live-only (final closure §5): re-price the session's OWN bound
     request from its STORED canonical facts — the resume path's honest answer
     to a QVL-expired quote, since a reloaded page has no form state to
     re-post and must never mint a second request. */
  refreshQuote?(): Promise<QuoteReading>;
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
    // Min-3 mirrors the live provider and the client debounce gate.
    if (q.length < 3) return { status: "ok", suggestions: [] };
    if (q.includes("nowhere")) return { status: "ok", suggestions: [] };
    return {
      status: "ok",
      suggestions: FIXTURE_PLACES.filter((p) => p.label.toLowerCase().includes(q) || q.length >= 3),
    };
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
    if (input.timingIntent === "scheduled") {
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
  return getSameDayAdaptersForMode(resolveAdapterMode(env).mode);
}

/**
 * Construct the adapters for a mode already resolved on the server. `SendFlow`
 * receives the server's `mode` as a prop and asks for exactly that set, so the
 * client agrees with the server instead of re-deriving from an environment the
 * browser cannot see.
 */
export function getSameDayAdaptersForMode(mode: AdapterMode): SameDayAdapters {
  if (mode === "live") {
    /* A fresh closure per call: the live adapters carry per-flow state (the
       guest session handle, the last estimate). `SendFlow` memoizes one set
       per mount, so this is one flow's state, never shared across visitors. */
    return { mode, ...createLiveSameDayAdapters() };
  }
  return { mode: "fixture", ...FIXTURE };
}

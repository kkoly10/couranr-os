/**
 * Payment state vocabulary. Pure and dependency-free, like the request state
 * machine, so it is unit-testable and so both enforcement points — this file
 * and `couranr_po_payment_state_chk` — can be compared directly by a test.
 */

export const PAYMENT_STATES = [
  "not_started",
  "requires_action",
  "authorized",
  "failed",
  "cancelled",
  /*
   * Declared, and NOT reachable in this slice. They are in the database CHECK
   * so that shipping capture is a new transition rather than a constraint
   * rewrite on a table that by then holds money. Nothing here can produce
   * either: `REACHABLE_PAYMENT_STATES` is what this slice can actually reach,
   * and a test asserts the difference is exactly these two.
   */
  "captured",
  "refunded",
] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

/** What the authorization slice can actually produce. */
export const REACHABLE_PAYMENT_STATES: readonly PaymentState[] = [
  "not_started",
  "requires_action",
  "authorized",
  "failed",
  "cancelled",
];

/** States this slice must never write. Capture and refund are later work. */
export const UNREACHABLE_PAYMENT_STATES: readonly PaymentState[] = ["captured", "refunded"];

/**
 * The Stripe events the canonical webhook acts on, and what each one means for
 * the obligation. Everything else is recorded and ignored — including
 * `payment_intent.succeeded`, which under manual capture can only mean
 * something captured outside Couranr and which this slice has no semantics for.
 */
export const HANDLED_STRIPE_EVENTS = {
  "payment_intent.amount_capturable_updated": "authorized",
  "payment_intent.requires_action": "requires_action",
  "payment_intent.payment_failed": "failed",
  "payment_intent.canceled": "cancelled",
} as const satisfies Readonly<Record<string, PaymentState>>;

export type HandledStripeEvent = keyof typeof HANDLED_STRIPE_EVENTS;

export function isHandledStripeEvent(t: unknown): t is HandledStripeEvent {
  return typeof t === "string" && t in HANDLED_STRIPE_EVENTS;
}

/**
 * The ONLY PaymentIntent status that may authorize.
 *
 * With `capture_method: "manual"` a successful confirmation leaves the intent
 * at `requires_capture`: the funds are HELD, not taken. `succeeded` would mean
 * captured, which this slice never does.
 */
export const AUTHORIZING_INTENT_STATUS = "requires_capture" as const;

/** Terminal for this slice — no further payer action is possible. */
export function isTerminalPaymentState(s: PaymentState): boolean {
  return s === "authorized" || s === "cancelled";
}

/** May a payer still act on this obligation? */
export function isPayable(s: PaymentState): boolean {
  return s === "not_started" || s === "requires_action" || s === "failed";
}

/**
 * Why a payment link was refused. Mirrors the `reason` column
 * `couranr_redeem_payment_access_token` returns, so the UI has one closed set
 * to render rather than switching on free text.
 */
export const LINK_REFUSAL_REASONS = [
  "not_found",
  "revoked",
  "expired",
  "request_not_payable",
  "no_obligation",
  "already_authorized",
  "quote_changed",
] as const;
export type LinkRefusalReason = (typeof LINK_REFUSAL_REASONS)[number];

export function isLinkRefusalReason(v: unknown): v is LinkRefusalReason {
  return typeof v === "string" && (LINK_REFUSAL_REASONS as readonly string[]).includes(v);
}

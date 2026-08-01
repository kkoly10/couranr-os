/**
 * Payment state vocabulary. Pure and dependency-free, like the request state
 * machine, so it is unit-testable and so both enforcement points — this file
 * and `couranr_po_payment_state_chk` — can be compared directly by a test.
 */

export const PAYMENT_STATES = [
  "not_started",
  "requires_action",
  "authorized",
  /*
   * Written BEFORE Stripe is called, which is what makes capture recoverable:
   * a process that dies mid-capture leaves a row saying "the outcome is
   * unknown" rather than "authorized", which would invite a second capture of
   * money already taken.
   */
  "capture_pending",
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
  /*
   * Vocabulary preservation, added 2026-08-01. Saved payment methods and
   * partial refunds are NOT implemented: no command writes either, no route
   * reaches one, and `couranr-payment-vocabulary.test.ts` asserts they have
   * zero transition writers. They are declared so that shipping them later is
   * a new transition rather than a CHECK rewrite on a table holding money.
   */
  "partially_refunded",
  "payment_method_saved",
] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

/** What the authorization slice can actually produce. */
export const REACHABLE_PAYMENT_STATES: readonly PaymentState[] = [
  "not_started",
  "requires_action",
  "authorized",
  "capture_pending",
  "captured",
  "failed",
  "cancelled",
];

/** States this slice must never write. Capture and refund are later work. */
/**
 * Declared and unreachable.
 *
 * `captured` LEFT this list on 2026-08-01 when the capture command shipped —
 * it is now reachable, through exactly one writer. The rest have no writer at
 * all and a test proves it.
 */
export const UNREACHABLE_PAYMENT_STATES: readonly PaymentState[] = [
  "refunded",
  "partially_refunded",
  "payment_method_saved",
];

/** Reachable only through the capture command, never from a browser claim. */
export const CAPTURE_STATES: readonly PaymentState[] = ["capture_pending", "captured"];

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

/**
 * What a reconcile may do with a PaymentIntent whose capture outcome is
 * unknown. Pure, closed, and default-deny.
 *
 *   release   the funds are still only HELD, so the capture definitively did
 *             not happen — put the obligation back to `authorized` so it can
 *             be retried
 *   complete  the money was taken — finish the capture and convert
 *   wait      anything else, including `processing`. Write NOTHING: recording
 *             a rejection now would make the same (obligation, intent) pair a
 *             duplicate later and permanently strand the obligation
 *
 * The default is `wait`, so a status this build has never heard of can never
 * move money's state in either direction.
 */
export type ReconcileAction = "release" | "complete" | "wait";

export function reconcileActionForIntentStatus(status: string): ReconcileAction {
  if (status === AUTHORIZING_INTENT_STATUS) return "release";
  if (status === "succeeded") return "complete";
  return "wait";
}

/**
 * May a capture RESULT event be written for this intent status?
 *
 * The single predicate BOTH capture call sites must ask, because the event id
 * `captureEventId.result` is not cycle-scoped: it is legal exactly once per
 * (obligation, intent), on the assumption that it is only ever written for a
 * terminal `succeeded`. Writing it for a `processing` intent spends that id on
 * a rejection, and the reconcile that runs once the intent finally succeeds is
 * then swallowed as a duplicate — stranding the obligation with the money
 * taken and no delivery.
 *
 * This existed only inside `reconcileCapture` at first, and `capturePayment`
 * wrote the same event with no guard at all. One predicate, asked in both
 * places, is what stops that from happening again.
 */
export function mayWriteCaptureResult(intentStatus: string): boolean {
  return reconcileActionForIntentStatus(intentStatus) === "complete";
}

/**
 * The Stripe idempotency key for capturing an obligation's hold.
 *
 * Scoped to the capture CYCLE, matching `intentIdempotencyKey`. Within one
 * cycle two concurrent calls share the key, so Stripe performs one capture and
 * replays it — that is the double-charge guarantee. Across cycles the key
 * differs, which is what makes the release-and-retry path work at all: Stripe
 * caches a completed request's response for 24 hours, so an obligation-only
 * key would replay the FIRST attempt's failure to every retry for a day and
 * the reconcile route would be unable to achieve anything.
 */
export function captureIdempotencyKey(obligationId: string, obligationVersion: number): string {
  return `couranr:capture:${obligationId}:v${obligationVersion}`;
}

/**
 * The provider event ids the capture workflow writes.
 *
 * `couranr_payment_events` is unique on (provider, provider_event_id), and the
 * SQL commands treat a `unique_violation` as "already handled" and return
 * WITHOUT acting. That makes the id the idempotency key — and choosing it
 * badly is silent: a colliding id means the command quietly does nothing.
 *
 * So the rule is that an id must identify the ATTEMPT, not the obligation.
 * `notTaken` ends a capture cycle and can legitimately happen more than once
 * for one obligation, so it carries the obligation version — which
 * `couranr_begin_payment_capture` bumps on every cycle. Keying it on the
 * obligation alone stranded the second failed cycle in `capture_pending` with
 * no exit.
 *
 * `result` is deliberately NOT version-scoped: it is written only for a
 * SUCCEEDED intent, which is terminal, so a repeat genuinely is a duplicate
 * and swallowing it is correct. `mayWriteCaptureResult` is what holds that
 * assumption up, and BOTH capture call sites must ask it.
 *
 * There is no `failed` id. A release used to be written straight from a 4xx in
 * the capture path, which was wrong — a 409 idempotency conflict and a 400
 * "already captured" are both 4xx and both mean money may well have moved. The
 * only release now comes from `reconcileCapture`, after re-reading the intent,
 * and it uses `notTaken`.
 */
export const captureEventId = {
  notTaken: (obligationId: string, obligationVersion: number) =>
    `couranr:capture_not_taken:${obligationId}:v${obligationVersion}`,
  result: (obligationId: string, paymentIntentId: string) =>
    `couranr:capture_result:${obligationId}:${paymentIntentId}`,
} as const;

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

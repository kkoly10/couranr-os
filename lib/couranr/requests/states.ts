/**
 * Delivery-request state machine.
 *
 * Authority: 02_DECISION_REGISTRY.json STA-001, which derives from
 * Couranr_Claude_Code_Master_Package.md §8. The vocabularies here are the same
 * ones the database CHECK constraints enforce — if these drift, an insert
 * fails loudly rather than storing an invented state.
 *
 * Pure and dependency-free so the whole machine is unit-testable.
 *
 * No route accepts an arbitrary target status. A caller names a COMMAND; the
 * command owns the transition. That is the repo convention (see CLAUDE.md,
 * "Every state transition should be a named server command") and the reason
 * `/api/delivery/mark-in-transit` is a counter-example, not a model.
 */

export const REQUEST_STATES = [
  "draft",
  "awaiting_merchant_confirmation",
  "awaiting_quote_acceptance",
  "pending_couranr_review",
  "quote_revision_required",
  "confirmed",
  "declined",
  "cancelled",
  "closed",
] as const;
export type RequestState = (typeof REQUEST_STATES)[number];

export const READINESS_STATES = [
  "not_confirmed",
  "preparing",
  "ready",
  "not_ready",
  "unavailable",
] as const;
export type ReadinessState = (typeof READINESS_STATES)[number];

export const REVIEW_STATES = [
  "not_required",
  "pending",
  "accepted_as_quoted",
  "requoted",
  "declined",
] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

export const SERVICE_AREA_REVIEW_STATES = [
  "pending",
  "in_area",
  "out_of_area_review",
  "declined",
] as const;
export type ServiceAreaReviewState = (typeof SERVICE_AREA_REVIEW_STATES)[number];

export const PAYER_TYPES = ["merchant", "customer"] as const;
export type PayerType = (typeof PAYER_TYPES)[number];

/**
 * The commands this slice implements. Every value must also appear in the
 * `couranr_dre_command_chk` constraint on couranr_delivery_request_events, or
 * writing the audit row fails.
 */
export const REQUEST_COMMANDS = [
  "create_delivery_request_draft",
  "calculate_delivery_request_estimate",
  "submit_delivery_request",
  "begin_delivery_request_review",
  "accept_delivery_request_as_quoted",
  "requote_delivery_request",
  "decline_delivery_request",
] as const;
export type RequestCommand = (typeof REQUEST_COMMANDS)[number];

/**
 * Where a command leaves the request.
 *
 * A plain state, `"unchanged"` when the command only records, or — for
 * confirm-as-quoted alone — one state per payer type. REV-001 makes that one
 * transition payer-dependent, and a single `to` cannot express it without
 * either losing the distinction or reading the target off the request.
 */
type CommandTarget = RequestState | "unchanged" | Readonly<Record<PayerType, RequestState>>;

type CommandRule = {
  /** States the request may be in for this command to run. */
  from: readonly RequestState[];
  /** State the request ends in. Equal to `from` when the command only records. */
  to: CommandTarget;
  /** Which permission capability the actor needs (DRP-001). */
  capability: "create" | "submit" | "read" | "review";
  /** The review_state this command sets, when it decides a review outcome. */
  reviewState?: ReviewState;
};

export function isPayerDependent(
  to: CommandTarget
): to is Readonly<Record<PayerType, RequestState>> {
  return typeof to === "object" && to !== null;
}

/** Every request_state a command in this module can produce. */
export function targetStates(to: CommandTarget): readonly RequestState[] {
  if (to === "unchanged") return [];
  if (isPayerDependent(to)) return PAYER_TYPES.map((p) => to[p]);
  return [to];
}

/**
 * `cancelled`, `closed` and `awaiting_merchant_confirmation` are canonical
 * states that no command here can reach. They are declared above because the
 * database enforces the full vocabulary; leaving them unreachable is
 * deliberate. `cancelled` and `closed` belong to the payment and fulfillment
 * slices, which are not built yet.
 */
export const COMMAND_RULES: Readonly<Record<RequestCommand, CommandRule>> = {
  create_delivery_request_draft: {
    from: [],
    to: "draft",
    capability: "create",
  },
  calculate_delivery_request_estimate: {
    // Re-estimating an already-submitted request would change the numbers a
    // merchant was shown at submission time. Drafts only.
    from: ["draft"],
    to: "unchanged",
    capability: "create",
  },
  submit_delivery_request: {
    from: ["draft"],
    to: "pending_couranr_review",
    capability: "submit",
  },
  begin_delivery_request_review: {
    // Records that Couranr Operations opened the request. It does not decide
    // the outcome; the three commands below do.
    from: ["pending_couranr_review"],
    to: "unchanged",
    capability: "review",
  },

  /* --- review outcomes (REV-001, owner-approved 2026-07-31) ------------- */

  /**
   * Merchant-paid goes straight to `confirmed`: the merchant approved this
   * exact quote at submission and Operations did not change it, so asking the
   * same party to approve the same number twice adds nothing. That shortcut is
   * gated on the acknowledgment recorded in the submission event — the SQL
   * function refuses with a conflict when it is absent.
   *
   * Customer-paid waits at `awaiting_quote_acceptance`: a merchant cannot
   * approve a price on the customer's behalf.
   */
  accept_delivery_request_as_quoted: {
    from: ["pending_couranr_review"],
    to: { merchant: "confirmed", customer: "awaiting_quote_acceptance" },
    capability: "review",
    reviewState: "accepted_as_quoted",
  },
  requote_delivery_request: {
    from: ["pending_couranr_review"],
    to: "quote_revision_required",
    capability: "review",
    reviewState: "requoted",
  },
  decline_delivery_request: {
    from: ["pending_couranr_review"],
    to: "declined",
    capability: "review",
    reviewState: "declined",
  },
};

export type TransitionAllowed = { allowed: true; nextState: RequestState };
export type TransitionDenied = {
  allowed: false;
  reason: "unknown_command" | "wrong_state" | "payer_required";
};
export type TransitionDecision = TransitionAllowed | TransitionDenied;

/**
 * `tsconfig` sets `"strict": false`; without `strictNullChecks` a bare
 * `if (!d.allowed)` does not narrow this union. An explicit predicate does.
 */
export function isTransitionDenied(d: TransitionDecision): d is TransitionDenied {
  return d.allowed === false;
}

/**
 * May `command` run against a request currently in `current`?
 *
 * `create_delivery_request_draft` has no prior state, so it is not a
 * transition and is rejected here — call it through its own command.
 *
 * `payerType` is required only by the payer-dependent command. Omitting it
 * there is a denial rather than a guess: picking a default would silently
 * confirm a customer-paid request the customer has never seen.
 */
export function resolveTransition(
  command: RequestCommand,
  current: RequestState,
  payerType?: PayerType
): TransitionDecision {
  const rule = COMMAND_RULES[command];
  if (!rule) return { allowed: false, reason: "unknown_command" };
  if (!rule.from.includes(current)) return { allowed: false, reason: "wrong_state" };
  if (rule.to === "unchanged") return { allowed: true, nextState: current };
  if (isPayerDependent(rule.to)) {
    if (payerType !== "merchant" && payerType !== "customer") {
      return { allowed: false, reason: "payer_required" };
    }
    return { allowed: true, nextState: rule.to[payerType] };
  }
  return { allowed: true, nextState: rule.to };
}

/**
 * The review outcomes, in the order Couranr Operations sees them on OPS-003.
 * The UI labels live here so a route, a button and the audit log cannot drift
 * into describing the same command three different ways.
 */
export const REVIEW_OUTCOME_COMMANDS = [
  { command: "accept_delivery_request_as_quoted", label: "Confirm as quoted" },
  { command: "requote_delivery_request", label: "Send revised quote" },
  { command: "decline_delivery_request", label: "Could not confirm service" },
] as const satisfies ReadonlyArray<{ command: RequestCommand; label: string }>;

/**
 * Decline reasons. Every code here is one the codebase already establishes:
 * the three `ReviewReasonCode` values from the pricing engine, plus
 * `outside_service_area`, which `service_area_review_state` already models.
 *
 * `other` requires a note, and exists so Operations is never forced to
 * mislabel a decline. A fuller taxonomy is registry decision REV-002 and is
 * UNRESOLVED — these are not it, and must not be treated as canonical.
 */
export const DECLINE_REASONS = [
  "outside_service_area",
  "over_max_automatic_miles",
  "over_max_automatic_weight",
  "overnight_not_offered_in_this_release",
  "other",
] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];

export function isDeclineReason(v: unknown): v is DeclineReason {
  return typeof v === "string" && (DECLINE_REASONS as readonly string[]).includes(v);
}

/** States in which a merchant may still edit the shipment. */
export function isEditable(state: RequestState): boolean {
  return state === "draft";
}

/** States that put a request in the Couranr Operations queue. */
export const QUEUE_STATES: readonly RequestState[] = ["pending_couranr_review"];

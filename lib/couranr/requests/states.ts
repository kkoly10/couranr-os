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
  "create_quote_version",
  "submit_delivery_request",
  "begin_delivery_request_review",
  "accept_delivery_request_as_quoted",
  "requote_delivery_request",
  "decline_delivery_request",
  "record_payer_quote_approval",
  "begin_delivery_preparation",
  "mark_delivery_ready",
  "mark_delivery_not_ready",
  "mark_delivery_unavailable",
  "cancel_delivery_request",
] as const;
export type RequestCommand = (typeof REQUEST_COMMANDS)[number];

/**
 * Audit-event vocabulary is wider than the actor-invocable transition model.
 * These three names are written only by trusted server/database automation;
 * forcing them into COMMAND_RULES would falsely imply a browser/actor command
 * exists for planning or promotional settlement.
 */
export const REQUEST_EVENT_COMMANDS = [
  ...REQUEST_COMMANDS,
  "auto_accept_delivery_request",
  "auto_plan_delivery_request",
  "apply_promotional_credit",
] as const;
export type RequestEventCommand = (typeof REQUEST_EVENT_COMMANDS)[number];

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
  /**
   * Which permission capability the actor needs (DRP-001).
   *
   * `system` means there is no actor to check: the command is a consequence of
   * a fact the server verified for itself, and no route accepts it from a
   * caller. Exactly one command uses it.
   */
  capability: "create" | "submit" | "read" | "review" | "system";
  /** The review_state this command sets, when it decides a review outcome. */
  reviewState?: ReviewState;
  /** The pickup readiness_state this command sets. */
  readinessState?: ReadinessState;
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
 * `closed` and `awaiting_merchant_confirmation` are canonical states that no
 * command here can reach. They are declared above because the database
 * enforces the full vocabulary; leaving them unreachable is deliberate.
 * `cancelled` gained its governed writer in the batch 3 final closure pass —
 * couranr_cancel_delivery_request, Operations-only, reached through the
 * cancellation recovery composition so the money always settles first.
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
  create_quote_version: {
    // Draft quote creation is recorded as calculate_delivery_request_estimate.
    // Once submitted or accepted, appending a commercial successor requires
    // fresh payer approval.
    from: [
      "pending_couranr_review",
      "confirmed",
      "awaiting_quote_acceptance",
      "quote_revision_required",
    ],
    to: "quote_revision_required",
    capability: "review",
    reviewState: "requoted",
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
   * Merchant-paid self-service goes straight to `confirmed`: the merchant
   * approved this exact quote at submission and Operations did not change it.
   *
   * Merchant-paid Operations-assisted entry is different by construction:
   * Operations submitted with acknowledgment=false, so Couranr may confirm
   * service but the request must wait at `awaiting_quote_acceptance` for the
   * real Business payer. Customer-paid requests wait there for the same
   * authority reason: Couranr is not the payer.
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

  /* --- payment authorization (PAY-001/PAY-002) -------------------------- */

  /**
   * The payer approved the quote by authorizing the amount against it.
   *
   * NOT invocable. There is no route and no actor: the only writer is
   * `couranr_apply_payment_intent_state`, and only after it has checked a
   * PaymentIntent's status, amount, currency and metadata against the stored
   * obligation. A browser redirect or a Payment Element callback cannot reach
   * it, which is the whole point — those are claims, not verification.
   *
   * It moves the request to `confirmed` and touches NOTHING else. `confirmed`
   * still does not mean captured, ready, scheduled or dispatched: the money is
   * authorized, i.e. held and not taken.
   */
  record_payer_quote_approval: {
    from: ["awaiting_quote_acceptance", "quote_revision_required"],
    to: "confirmed",
    capability: "system",
  },

  /* --- pickup readiness (owner-approved business flow 2026-08-01) ------- */

  /**
   * Readiness is an INDEPENDENT state group (STA-001). These four commands
   * move `readiness_state` and leave `request_state` exactly where it is —
   * `to: "unchanged"` is the whole point, not an omission. A merchant saying
   * "ready" does not confirm, pay for or schedule anything.
   *
   * All four require `confirmed`, because readiness only means something once
   * Couranr has agreed to do the job, and all four are refused once capture
   * has started or a delivery exists — at that point a driver is being planned
   * around the answer, and changing it belongs to cancellation or incident
   * handling rather than to an ordinary merchant action.
   */
  begin_delivery_preparation: {
    from: ["confirmed"],
    to: "unchanged",
    capability: "submit",
    readinessState: "preparing",
  },
  mark_delivery_ready: {
    from: ["confirmed"],
    to: "unchanged",
    capability: "submit",
    readinessState: "ready",
  },
  mark_delivery_not_ready: {
    from: ["confirmed"],
    to: "unchanged",
    capability: "submit",
    readinessState: "not_ready",
  },
  mark_delivery_unavailable: {
    from: ["confirmed"],
    to: "unchanged",
    capability: "submit",
    readinessState: "unavailable",
  },

  /* Final closure pass §4: a user-visible cancellation must not leave a
     confirmed or pending request active. Operations-only; runs INSIDE the
     cancellation recovery composition (money settles first), never as a
     bare state edit or a standalone route. */
  cancel_delivery_request: {
    from: [
      "draft",
      "awaiting_quote_acceptance",
      "pending_couranr_review",
      "quote_revision_required",
      "confirmed",
    ],
    to: "cancelled",
    capability: "review",
  },
};

/**
 * The owner-approved readiness transition graph (2026-08-01).
 *
 * `ready` is deliberately absent from `mark_delivery_ready`'s sources:
 * re-marking a ready request is a conflict, not a no-op, so a stale tab cannot
 * silently re-assert readiness over a newer state. The database enforces the
 * same sets; `tests/couranr-readiness.test.ts` compares the two directly.
 */
export const READINESS_TRANSITIONS: Readonly<Record<ReadinessState, readonly ReadinessState[]>> = {
  not_confirmed: ["preparing", "ready", "not_ready", "unavailable"],
  preparing: ["ready", "not_ready", "unavailable"],
  not_ready: ["preparing", "ready", "unavailable"],
  unavailable: ["preparing", "ready"],
  ready: ["preparing", "not_ready", "unavailable"],
};

export const READINESS_COMMANDS = [
  { command: "begin_delivery_preparation", to: "preparing", label: "Preparing" },
  { command: "mark_delivery_ready", to: "ready", label: "Ready for Couranr" },
  { command: "mark_delivery_not_ready", to: "not_ready", label: "Not ready" },
  { command: "mark_delivery_unavailable", to: "unavailable", label: "Unavailable" },
] as const satisfies ReadonlyArray<{
  command: RequestCommand;
  to: ReadinessState;
  label: string;
}>;

/** May readiness move from `from` to `to`? */
export function canChangeReadiness(from: ReadinessState, to: ReadinessState): boolean {
  return (READINESS_TRANSITIONS[from] ?? []).includes(to);
}

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
  payerType?: PayerType,
  context: { operationsAssisted?: boolean } = {}
): TransitionDecision {
  const rule = COMMAND_RULES[command];
  if (!rule) return { allowed: false, reason: "unknown_command" };
  if (!rule.from.includes(current)) return { allowed: false, reason: "wrong_state" };
  if (rule.to === "unchanged") return { allowed: true, nextState: current };
  if (isPayerDependent(rule.to)) {
    if (payerType !== "merchant" && payerType !== "customer") {
      return { allowed: false, reason: "payer_required" };
    }
    if (
      command === "accept_delivery_request_as_quoted" &&
      payerType === "merchant" &&
      context.operationsAssisted === true
    ) {
      return { allowed: true, nextState: "awaiting_quote_acceptance" };
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
 * Decline reasons — REV-002, owner-approved 2026-07-31.
 *
 * The canonical vocabulary for "Couranr could not confirm service". This
 * replaces the placeholder set that shipped with the review outcomes, which
 * was assembled from codes already in the tree because no authority had
 * defined one.
 *
 * The version travels with every decline event, so a later taxonomy can be
 * told apart from this one without guessing from the code alone.
 */
export const DECLINE_REASON_VERSION = "couranr-decline-v1";

export const DECLINE_REASONS = [
  "outside_service_area",
  "requested_time_unavailable",
  "no_driver_available",
  "no_compatible_vehicle",
  "shipment_not_supported",
  "merchant_account_on_hold",
  "duplicate_or_superseded",
  "other",
] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];

/**
 * What the merchant is told. Owner-approved copy, reproduced verbatim.
 *
 * This map is for RENDERING. The authority at write time is the `case`
 * expression inside `couranr_decline_delivery_request`, which derives the
 * message from the code in the database so a caller cannot choose it.
 * `tests/couranr-request-commands.test.ts` asserts the two agree character
 * for character, so neither can drift.
 *
 * None of these names an internal cause, a driver, a policy threshold or a
 * release detail. A merchant reads them; they have to be true, useful and
 * safe to say out loud.
 */
export const DECLINE_MERCHANT_MESSAGE: Readonly<Record<DeclineReason, string>> = {
  outside_service_area: "Couranr could not confirm service for this route.",
  requested_time_unavailable: "Couranr could not confirm the requested delivery time.",
  no_driver_available: "Couranr does not have an available driver for this request.",
  no_compatible_vehicle: "Couranr could not confirm a compatible vehicle for this shipment.",
  shipment_not_supported: "This shipment cannot be handled through Couranr.",
  merchant_account_on_hold:
    "This business account needs attention before Couranr can confirm service.",
  duplicate_or_superseded: "This request was replaced by another request.",
  other: "Couranr could not confirm this request. Contact Couranr Support for details.",
};

/**
 * `other` names nothing, and `merchant_account_on_hold` is an assertion about
 * a business that somebody has to be able to justify weeks later. Neither is
 * honest without a note.
 */
export const DECLINE_REASONS_REQUIRING_NOTE: readonly DeclineReason[] = [
  "other",
  "merchant_account_on_hold",
];

/**
 * Codes that were never, or are no longer, decline reasons. Kept named so the
 * distinction survives the people who made it.
 *
 * The first two are review TRIGGERS (`ReviewReasonCode` in
 * `lib/couranr/pricing/types.ts`). They mean "this quote needs a human", not
 * "Couranr refused the work" — declining with one would tell a merchant they
 * cannot be served when the truth is that their price has to be worked out by
 * hand.
 *
 * `overnight_not_offered_in_this_release` is conceptually a
 * `requested_time_unavailable` and is deliberately not retained: a
 * release-internal detail is not something to say to a merchant, and it would
 * be false the moment overnight ships.
 *
 * Events written under the placeholder taxonomy still carry these codes. They
 * are never rewritten; `declineMessageFor` maps them onto the generic message.
 */
export const RETIRED_DECLINE_REASONS = [
  "over_max_automatic_miles",
  "over_max_automatic_weight",
  "overnight_not_offered_in_this_release",
] as const;

export function isDeclineReason(v: unknown): v is DeclineReason {
  return typeof v === "string" && (DECLINE_REASONS as readonly string[]).includes(v);
}

export function declineRequiresInternalNote(v: unknown): boolean {
  return isDeclineReason(v) && DECLINE_REASONS_REQUIRING_NOTE.includes(v);
}

/**
 * The one safe thing to say when the code means nothing to this build.
 *
 * The append-only log holds codes from the placeholder taxonomy and will one
 * day hold codes from a v2. Rendering a raw code, an empty string, or
 * "undefined" to a merchant are all worse than saying the true, general thing
 * — so an unrecognised code falls back here rather than being displayed.
 */
export const GENERIC_DECLINE_MESSAGE = DECLINE_MERCHANT_MESSAGE.other;

export function declineMessageFor(code: unknown): string {
  return isDeclineReason(code) ? DECLINE_MERCHANT_MESSAGE[code] : GENERIC_DECLINE_MESSAGE;
}

/** States in which a merchant may still edit the shipment. */
export function isEditable(state: RequestState): boolean {
  return state === "draft";
}

/** States that put a request in the Couranr Operations queue. */
export const QUEUE_STATES: readonly RequestState[] = ["pending_couranr_review"];

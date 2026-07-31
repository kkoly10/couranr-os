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
] as const;
export type RequestCommand = (typeof REQUEST_COMMANDS)[number];

type CommandRule = {
  /** States the request may be in for this command to run. */
  from: readonly RequestState[];
  /** State the request ends in. Equal to `from` when the command only records. */
  to: RequestState | "unchanged";
  /** Which permission capability the actor needs (DRP-001). */
  capability: "create" | "submit" | "read" | "review";
};

/**
 * `awaiting_quote_acceptance`, `quote_revision_required`, `confirmed`,
 * `declined`, `cancelled` and `closed` are canonical states that no command in
 * THIS slice can reach. They are declared above because the database enforces
 * the full vocabulary; leaving them unreachable is deliberate, not an omission.
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
    // the outcome: accept / requote / decline are not in this slice.
    from: ["pending_couranr_review"],
    to: "unchanged",
    capability: "review",
  },
};

export type TransitionAllowed = { allowed: true; nextState: RequestState };
export type TransitionDenied = {
  allowed: false;
  reason: "unknown_command" | "wrong_state";
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
 */
export function resolveTransition(
  command: RequestCommand,
  current: RequestState
): TransitionDecision {
  const rule = COMMAND_RULES[command];
  if (!rule) return { allowed: false, reason: "unknown_command" };
  if (!rule.from.includes(current)) return { allowed: false, reason: "wrong_state" };
  return { allowed: true, nextState: rule.to === "unchanged" ? current : rule.to };
}

/** States in which a merchant may still edit the shipment. */
export function isEditable(state: RequestState): boolean {
  return state === "draft";
}

/** States that put a request in the Couranr Operations queue. */
export const QUEUE_STATES: readonly RequestState[] = ["pending_couranr_review"];

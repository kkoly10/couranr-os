/**
 * MER-003 — the live-activation state machine.
 *
 * Pure and dependency-free, so the whole machine is testable without a
 * database, and so the screen and the SQL derive readiness from ONE rule.
 *
 * ---------------------------------------------------------------------------
 * WHAT ACTIVATION IS, AND WHY IT IS OPERATIONS-GRANTED
 * ---------------------------------------------------------------------------
 *
 * Onboarding (MER-002) creates a TEST workspace, which the Master Package says
 * "cannot dispatch live deliveries". Activation is the path from that to live
 * eligibility, and the registry's required states ARE the machine:
 *
 *     not_started → in_progress → pending_couranr_review → live | blocked
 *
 * A merchant can reach `pending_couranr_review` and no further. `live` and
 * `blocked` are Couranr Operations' to grant — activation is never
 * self-granted, which is the whole point of a review gate.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DELIBERATELY NOT REQUIRED
 * ---------------------------------------------------------------------------
 *
 * The specification is explicit that activation must NOT require a website,
 * an EIN, a storefront, or a business-registration upload unless a risk review
 * demands it — and the registry adds that website tools and any subscription
 * purchase must not be required either. No requirement below asks for any of
 * those, and no card is needed to finish.
 */

export const ACTIVATION_STATES = [
  "not_started",
  "in_progress",
  "pending_couranr_review",
  "live",
  "blocked",
] as const;
export type ActivationState = (typeof ACTIVATION_STATES)[number];

/**
 * The four acknowledgements, from Master Package §215-217 and spec 01:158-160.
 *
 * They are separate, versioned acts — NOT the single `policies_accepted_at`
 * that onboarding records. A merchant who accepted the general policies at
 * signup has not thereby accepted the prohibited-item policy, and conflating
 * the two would let an unread policy count as read.
 */
export const ACKNOWLEDGEMENT_KINDS = [
  "delivery_terms",
  "prohibited_items",
  "merchant_responsibility",
  "return_acceptance",
] as const;
export type AcknowledgementKind = (typeof ACKNOWLEDGEMENT_KINDS)[number];

/**
 * The version each acknowledgement is currently collected at.
 *
 * Server-stated, never accepted from a client: a merchant cannot claim to have
 * accepted a version they were not shown. When a document changes, its version
 * changes here and the previously-accepted version stops satisfying the gate —
 * which is the entire reason these are versioned rather than boolean.
 */
export const ACKNOWLEDGEMENT_VERSIONS: Readonly<Record<AcknowledgementKind, string>> = {
  delivery_terms: "couranr-delivery-terms-2026-07",
  prohibited_items: "couranr-prohibited-items-2026-07",
  merchant_responsibility: "couranr-merchant-responsibility-2026-07",
  return_acceptance: "couranr-return-acceptance-2026-07",
};

export const ACKNOWLEDGEMENT_LABELS: Readonly<Record<AcknowledgementKind, string>> = {
  delivery_terms: "Delivery terms",
  prohibited_items: "Prohibited items policy",
  merchant_responsibility: "Merchant responsibility",
  return_acceptance: "Returns and refused deliveries",
};

export const ACKNOWLEDGEMENT_DESCRIPTIONS: Readonly<Record<AcknowledgementKind, string>> = {
  delivery_terms:
    "How Couranr schedules, confirms and completes a delivery, and what each side is responsible for.",
  prohibited_items:
    "What Couranr will not carry. Couranr reviews every request and can decline one that falls under this policy.",
  merchant_responsibility:
    "Packaging, accurate contents and weight, and being ready at the pickup window you confirm.",
  return_acceptance:
    "What happens when a delivery cannot be completed, and your acceptance of an approved return.",
};

/** Everything the gate looks at. Plain values; they come from the database. */
export type ActivationFacts = {
  state: string;
  /** kind → the version the merchant accepted, if any. */
  acknowledgements: Partial<Record<string, string>>;
  contactVerifiedAt: string | null;
  testDeliveryRequestId: string | null;
};

export type ActivationRequirement = {
  id: string;
  label: string;
  met: boolean;
  /** Why it is not met, in the merchant's own terms. */
  detail: string;
};

/**
 * The requirement list, in the order the screen shows it.
 *
 * An acknowledgement counts only at the CURRENT version. An older accepted
 * version reads as unmet and says so, rather than silently passing a gate for
 * a document the merchant never saw.
 */
export function activationRequirements(facts: ActivationFacts): ActivationRequirement[] {
  const out: ActivationRequirement[] = ACKNOWLEDGEMENT_KINDS.map((kind) => {
    const accepted = facts.acknowledgements?.[kind];
    const current = ACKNOWLEDGEMENT_VERSIONS[kind];
    const met = accepted === current;
    return {
      id: `ack:${kind}`,
      label: ACKNOWLEDGEMENT_LABELS[kind],
      met,
      detail: met
        ? "Accepted."
        : accepted
          ? "This policy has been updated since you accepted it. Review and accept the current version."
          : "Not accepted yet.",
    };
  });

  out.push({
    id: "contact",
    label: "Operations contact verified",
    met: Boolean(facts.contactVerifiedAt),
    detail: facts.contactVerifiedAt
      ? "Verified."
      : "Confirm the phone number Couranr Operations should reach during a delivery.",
  });

  out.push({
    id: "test_delivery",
    label: "Test delivery completed",
    met: Boolean(facts.testDeliveryRequestId),
    detail: facts.testDeliveryRequestId
      ? "Recorded."
      : "Create one delivery in your test workspace. It is never charged and never dispatched.",
  });

  return out;
}

/** Can the merchant ask Couranr to review this workspace? */
export function canRequestActivation(facts: ActivationFacts): boolean {
  if (facts.state === "pending_couranr_review" || facts.state === "live") return false;
  return activationRequirements(facts).every((r) => r.met);
}

/**
 * The state the merchant's own progress implies, BEFORE Couranr acts.
 *
 * Deliberately never returns `live`, `blocked` or `pending_couranr_review`:
 * those three are the outcome of an act (a request, or an Operations
 * decision), not of a checklist filling up. A function that could return
 * `live` from progress alone would be self-granting activation.
 */
export function derivedProgressState(facts: ActivationFacts): "not_started" | "in_progress" {
  const requirements = activationRequirements(facts);
  return requirements.some((r) => r.met) ? "in_progress" : "not_started";
}

export const ACTIVATION_STATE_LABELS: Readonly<Record<ActivationState, string>> = {
  not_started: "Not started",
  in_progress: "In progress",
  pending_couranr_review: "With Couranr for review",
  live: "Live",
  blocked: "Needs attention",
};

export const ACTIVATION_STATE_TONE: Readonly<
  Record<ActivationState, "neutral" | "info" | "success" | "warning">
> = {
  not_started: "neutral",
  in_progress: "info",
  pending_couranr_review: "info",
  live: "success",
  blocked: "warning",
};

/**
 * What each state MEANS for the merchant, in the merchant's terms.
 *
 * Every one of these says plainly whether live deliveries are possible,
 * because that is the only question this screen exists to answer.
 */
export const ACTIVATION_STATE_DESCRIPTIONS: Readonly<Record<ActivationState, string>> = {
  not_started:
    "Your workspace is a test workspace. You can create deliveries to try Couranr out, and none of them are dispatched or charged.",
  in_progress:
    "You have started activation. This is still a test workspace, so deliveries are not dispatched or charged. Finish the remaining steps and Couranr will review it.",
  pending_couranr_review:
    "Couranr is reviewing your workspace. Until it is approved this is still a test workspace, so deliveries are not dispatched or charged.",
  live: "Your workspace is live. Deliveries you submit are reviewed by Couranr and dispatched.",
  blocked:
    "Couranr could not activate this workspace yet, so it is still a test workspace and deliveries are not dispatched or charged. The reason is below — Couranr Support can help you resolve it.",
};

/**
 * The merchant-safe reasons Operations can block on.
 *
 * A CODE is stored and the message is derived here, the same shape the review
 * outcomes use: an operator's internal note is never what a merchant reads.
 */
export const BLOCK_REASONS: Readonly<Record<string, string>> = {
  contact_unreachable:
    "Couranr could not reach the operations contact for this workspace. Check the number and ask Couranr Support to try again.",
  prohibited_items_risk:
    "Some of what this workspace plans to send may fall under the prohibited-items policy. Couranr Support will go through it with you.",
  incomplete_information:
    "Couranr needs more operating information before activating this workspace. Couranr Support will tell you what is missing.",
  additional_review_required:
    "This workspace needs an additional review before it can go live. Couranr Support will be in touch.",
};

/**
 * The closed list an operator may choose from, derived from `BLOCK_REASONS` so
 * the two cannot drift into a code with no message behind it.
 *
 * A block reason is a CODE, never free text: the merchant reads the sentence
 * above, so an operator's internal note can never reach them.
 */
export const BLOCK_REASON_CODES: readonly string[] = Object.keys(BLOCK_REASONS);

export function blockReasonMessage(code: string | null | undefined): string {
  if (!code) return BLOCK_REASONS.additional_review_required;
  return BLOCK_REASONS[code] ?? BLOCK_REASONS.additional_review_required;
}

import { assertServerOnly } from "@/lib/couranr/serverOnly";

assertServerOnly("lib/couranr/identity/recipientIdentity.ts");

/**
 * The recipient identity SEAM for protected handoff.
 *
 * STRIPE IDENTITY IS NOT ACTIVATED. That is an owner decision, and this module
 * is written so the decision is structural rather than a flag somebody flips by
 * accident: there is NO CODE PATH HERE THAT CALLS STRIPE. Not a disabled one,
 * not one behind an environment variable — none. `beginProviderSession` is the
 * single place a call would ever live and it currently returns a refusal.
 *
 * The reason for that shape rather than a `if (activated) { fetch(...) }` is
 * cost safety, which the owner has stated as a release requirement after losing
 * money to provider calls during development. A branch that can fire is a branch
 * that fires in a test somebody writes six weeks from now. A branch that does
 * not exist cannot.
 *
 * WHAT THE SEAM STILL DOES. It records the OUTCOME of the attempt, which for V1
 * is `unavailable`. That is deliberately not the same as recording nothing: a
 * protected handoff that proceeded on the recipient code and the driver is a
 * different fact from one that passed an identity check, and a claim months
 * later has to be able to tell them apart. The database agrees — `unavailable`
 * is in couranr_riv_state_chk's vocabulary, and the drop-off trigger accepts
 * exactly `verified` and `unavailable` and refuses everything else.
 */

/** Bumped when what a verification MEANS changes, not when the code changes. */
export const COURANR_IDENTITY_POLICY_VERSION = "couranr-recipient-identity-v1-2026-09-15";

export type IdentityOutcome = {
  /** One of couranr_riv_state_chk's values. */
  state: "pending" | "processing" | "verified" | "failed" | "unavailable" | "canceled";
  /** Stripe's own handle. Never a credential, and null on the unactivated path. */
  providerReference: string | null;
  identityVerified: boolean;
  adultVerified: boolean;
  authorizedRecipientMatch: boolean;
  policyVersion: string;
};

/**
 * Whether the provider is live.
 *
 * Two conditions, deliberately: Vercel production AND an explicit activation
 * flag. Either alone is not enough — a preview deployment carrying production
 * environment variables is a real way to bill an account by surprise, which is
 * the same reasoning `claimPaidApiCall` already applies to routing and places.
 */
export function isStripeIdentityActivated(): boolean {
  return (
    process.env.VERCEL_ENV === "production" &&
    process.env.COURANR_STRIPE_IDENTITY_ACTIVATED === "true"
  );
}

/**
 * The ONE place a provider call would live.
 *
 * It does not make one. When Stripe Identity is activated this is where the
 * session creation goes, and the shape it must return is already fixed by
 * `IdentityOutcome` — so activating it is a change to this function and nothing
 * else: not the command, not the trigger, not the driver flow.
 */
async function beginProviderSession(_deliveryId: string): Promise<IdentityOutcome | null> {
  // Intentionally unimplemented. See the module comment: the activated branch
  // does not exist rather than being switched off.
  return null;
}

/**
 * The outcome to record for a protected handoff.
 *
 * Returns `unavailable` while the provider is not activated, which is a
 * recorded fact and not an absence. If activation is ever set without the
 * provider call being implemented, this still returns `unavailable` rather than
 * inventing a verification — the flag alone must never be able to make a
 * shipment look verified.
 */
export async function resolveRecipientIdentity(deliveryId: string): Promise<IdentityOutcome> {
  const unavailable: IdentityOutcome = {
    state: "unavailable",
    providerReference: null,
    identityVerified: false,
    adultVerified: false,
    authorizedRecipientMatch: false,
    policyVersion: COURANR_IDENTITY_POLICY_VERSION,
  };

  if (!isStripeIdentityActivated()) return unavailable;

  const started = await beginProviderSession(deliveryId);
  return started ?? unavailable;
}

/**
 * What the recipient is told, and what Operations sees, for each outcome.
 *
 * `unavailable` does NOT say "verification failed" or apologise: nothing was
 * attempted and nothing went wrong. It says what actually governs the handoff
 * instead, because a recipient reading it is deciding whether to answer the
 * door, not auditing Couranr's provider integrations.
 */
export const IDENTITY_OUTCOME_COPY: Readonly<Record<IdentityOutcome["state"], string>> = {
  pending: "Identity check started. Couranr is waiting for the result.",
  processing: "Identity check in progress.",
  verified: "Identity confirmed.",
  failed: "The identity check did not pass. Couranr will contact the sender.",
  unavailable:
    "This delivery is handed to the named recipient in person, against the code they read to the driver.",
  canceled: "The identity check was not completed.",
};

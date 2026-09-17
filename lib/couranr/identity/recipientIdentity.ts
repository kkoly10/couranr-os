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
 * WHAT THE SEAM STILL DOES. It states whether the capability exists. It does
 * not manufacture an `unavailable` attempt at driver arrival and it never lets
 * absence masquerade as verification. The database blocks a protected request
 * before commercial acceptance while this capability is unavailable, and the
 * handoff gate accepts only coherent `verified` evidence.
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
 * The credential that can read a date of birth.
 *
 * NOT `STRIPE_SECRET_KEY`. Stripe's access table marks date of birth as
 * unreachable with a secret key — it requires a RESTRICTED key carrying the
 * Identity Verification Results and Recent Detailed Verification Results read
 * permissions, and its own `verified_outputs.dob` expand path. Since the
 * database will not record a `verified` row unless `adult_verified` is true,
 * a build without this key cannot complete a single protected handoff.
 *
 * It is named separately from every other Stripe credential in this repository
 * so it can be rolled on its own, which is the documented reason to scope a
 * restricted key to one product in the first place.
 */
export function hasIdentityRestrictedKey(): boolean {
  const k = process.env.COURANR_STRIPE_IDENTITY_RESTRICTED_KEY;
  return typeof k === "string" && k.trim() !== "";
}

/**
 * Whether this build can actually begin and resolve a recipient verification.
 *
 * THIS COMMENT USED TO SAY the answer was false unconditionally because no
 * provider implementation existed. That stopped being true when
 * `lib/couranr/identity/stripeIdentity.ts` landed, and a comment naming a
 * guarantee the code no longer makes is worse than no comment — it is the
 * reason nobody goes looking.
 *
 * What is true now: the implementation exists, it is exercised only through
 * explicitly injected transport and credentials, and it is live only when the
 * owner has BOTH activated the provider and supplied the restricted key. Both
 * conditions are configuration the owner controls; neither is a code change.
 */
export function isRecipientIdentityCapabilityAvailable(): boolean {
  return isStripeIdentityActivated() && hasIdentityRestrictedKey();
}

/**
 * What the recipient is told, and what Operations sees, for each outcome.
 *
 * `unavailable` is Operations evidence only. It never tells a recipient that a
 * protected handoff may proceed without the check the sender was promised.
 */
export const IDENTITY_OUTCOME_COPY: Readonly<Record<IdentityOutcome["state"], string>> = {
  pending: "Identity check started. Couranr is waiting for the result.",
  processing: "Identity check in progress.",
  verified: "Identity confirmed.",
  failed: "The identity check did not pass. Couranr will contact the sender.",
  unavailable: "Recipient identity verification is unavailable. Do not complete the handoff.",
  canceled: "The identity check was not completed.",
};

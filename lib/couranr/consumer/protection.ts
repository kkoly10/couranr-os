/**
 * Canonical Consumer Same Day custody-protection authority.
 *
 * ONE SERVER-SIDE FUNCTION DECIDES THE PROTECTION LEVEL. The client submits a
 * declared shipment value and nothing else about protection: it does not choose
 * its level, cannot weaken the required proof, and cannot remove the identity
 * requirement. Everything downstream — pickup sequence, proof requirements,
 * identity verification, leave-at-door eligibility — is derived from the value
 * by `deriveProtection`, on the server, and frozen onto the request.
 *
 * WHY A MODULE RATHER THAN A FEW CONSTANTS. The same derivation is needed in
 * four places that must never disagree: the `/send` UI's progressive
 * disclosure, the consumer create/estimate server path, the SQL that re-derives
 * it as a second enforcement point, and the Operations claims bundle reading a
 * historical row. A second copy of the thresholds is a second answer.
 *
 * This module is dependency-free: no React, Next.js, Supabase or Stripe. Pure
 * arithmetic over integer cents, so both the browser and the server can import
 * it and the SQL can be checked against it by test rather than by memory.
 *
 * DECLARED VALUE IS A SENDER REPRESENTATION. It is not Couranr's appraisal, not
 * authentication of an item, not guaranteed compensation, not insurance and not
 * proof of market value. A driver photographs what is physically presented; the
 * photograph proves what was tendered, never that the object is authentic, the
 * stated model, functional, or worth the stated amount. Nothing in this module
 * may be read as valuing goods.
 */

/**
 * Recorded on every consumer request this authority governs. Bumped whenever a
 * threshold or a requirement below changes, so a later version coexists with
 * V1 rows instead of reinterpreting them.
 *
 * HISTORICAL COMPATIBILITY. Rows written before this authority existed carry no
 * version and no declared value. They are NOT retroactively governed — see
 * `isGovernedByProtectionPolicy`.
 */
export const COURANR_PROTECTION_POLICY_VERSION = "couranr-consumer-protection-v1-2026-09-14";

/** The maximum TOTAL declared value of an entire shipment. Per shipment. */
export const CONSUMER_MAX_DECLARED_VALUE_CENTS = 50_000;

/**
 * The levels, in ascending order of custody ceremony.
 *
 * `declined` is a level rather than an error code because the derivation must
 * be total: every declared value maps to exactly one outcome, and the caller
 * cannot reach "no answer" by passing an awkward number.
 */
export const PROTECTION_LEVELS = [
  "standard",
  "secure_pickup",
  "protected_handoff",
  "declined",
] as const;
export type ProtectionLevel = (typeof PROTECTION_LEVELS)[number];

export function isProtectionLevel(v: unknown): v is ProtectionLevel {
  return typeof v === "string" && (PROTECTION_LEVELS as readonly string[]).includes(v);
}

/**
 * Inclusive upper bounds in integer cents.
 *
 * Stated as "the highest value still in this band" rather than as dollar
 * strings, because the owner's bands are written with cent precision:
 * $30.01 begins secure pickup, so standard ends at exactly 3_000.
 */
export const PROTECTION_THRESHOLDS = {
  /** $0.00–$30.00 */
  standardMaxCents: 3_000,
  /** $30.01–$150.00 */
  securePickupMaxCents: 15_000,
  /** $150.01–$500.00 */
  protectedHandoffMaxCents: CONSUMER_MAX_DECLARED_VALUE_CENTS,
} as const;

/** What the derived level actually requires. Read by server, SQL tests and UI. */
export type ProtectionRequirements = {
  level: ProtectionLevel;
  policyVersion: string;
  /** The item must be documented BEFORE the sender seals the outer package. */
  requiresPrepackPhoto: boolean;
  /** A serialized tamper-evident seal is applied and photographed. */
  requiresSealedPackagePhoto: boolean;
  requiresSecuritySeal: boolean;
  /**
   * The sender's pickup credential is confirmed AFTER documentation and
   * sealing, so consuming it means "the sender confirms that the documented and
   * sealed shipment is the shipment being tendered".
   */
  credentialAfterDocumentation: boolean;
  /** Recipient identity verified through the provider before physical handoff. */
  requiresRecipientIdentityVerification: boolean;
  /** Leave-at-door is never permitted at this level. */
  allowsLeaveAtDoor: boolean;
  /** Seal condition must be recorded at drop-off. */
  requiresSealCheckAtDropoff: boolean;
};

export type ProtectionDecision =
  | { ok: true; requirements: ProtectionRequirements }
  | { ok: false; reason: "declared_value_invalid" | "declared_value_above_maximum"; level: "declined" };

/**
 * `tsconfig` sets `"strict": false`; without `strictNullChecks` a bare
 * `if (!d.ok)` does not narrow this union, so reading `d.reason` on the failure
 * arm is a type error at the call site. An explicit predicate narrows it — the
 * same reason `isConsumerSendBodyFailure` exists in consumer/send.ts.
 */
export function isProtectionDeclined(
  d: ProtectionDecision
): d is { ok: false; reason: "declared_value_invalid" | "declared_value_above_maximum"; level: "declined" } {
  return d.ok === false;
}

/**
 * THE authority. Total over every input, including hostile ones.
 *
 * A non-integer, negative, NaN or non-number value is refused rather than
 * coerced: a shipment whose declared value cannot be read is not a $0 shipment,
 * and silently treating it as one would put a $500 item on the standard path.
 */
export function deriveProtection(declaredValueCents: unknown): ProtectionDecision {
  if (
    typeof declaredValueCents !== "number" ||
    !Number.isFinite(declaredValueCents) ||
    !Number.isInteger(declaredValueCents) ||
    declaredValueCents < 0
  ) {
    return { ok: false, reason: "declared_value_invalid", level: "declined" };
  }
  if (declaredValueCents > CONSUMER_MAX_DECLARED_VALUE_CENTS) {
    return { ok: false, reason: "declared_value_above_maximum", level: "declined" };
  }

  const level: Exclude<ProtectionLevel, "declined"> =
    declaredValueCents <= PROTECTION_THRESHOLDS.standardMaxCents
      ? "standard"
      : declaredValueCents <= PROTECTION_THRESHOLDS.securePickupMaxCents
        ? "secure_pickup"
        : "protected_handoff";

  return { ok: true, requirements: requirementsFor(level) };
}

/**
 * The requirement table, separated from the derivation so a historical row can
 * be read back at ITS level without re-deriving from a value that may since
 * have changed meaning.
 */
export function requirementsFor(level: Exclude<ProtectionLevel, "declined">): ProtectionRequirements {
  const secure = level === "secure_pickup" || level === "protected_handoff";
  const protectedHandoff = level === "protected_handoff";
  return {
    level,
    policyVersion: COURANR_PROTECTION_POLICY_VERSION,
    requiresPrepackPhoto: secure,
    requiresSealedPackagePhoto: secure,
    requiresSecuritySeal: secure,
    credentialAfterDocumentation: secure,
    requiresRecipientIdentityVerification: protectedHandoff,
    // Standard and secure pickup inherit whatever the existing proof method
    // allows; only protected handoff forbids it outright.
    allowsLeaveAtDoor: !protectedHandoff,
    requiresSealCheckAtDropoff: secure,
  };
}

/**
 * Whether a stored request is governed by THIS authority.
 *
 * Historical consumer and business rows carry no policy version. They must stay
 * readable and must not be retroactively presented as having gone through a
 * protection workflow that did not exist when they shipped.
 */
export function isGovernedByProtectionPolicy(policyVersion: unknown): boolean {
  return typeof policyVersion === "string" && policyVersion.trim() !== "";
}

/**
 * THE email rule, for BOTH sides of the /send seam.
 *
 * It lives here rather than in consumer/send.ts for a structural reason: send.ts
 * imports `supabaseAdmin`, so a client component that imported the regex from
 * there would drag the service-role module into the browser bundle. This module
 * is dependency-free by design and safe from either side — which is why the
 * shared authority belongs in it. (`tests/couranr-server-only.test.ts` caught
 * exactly that import; the guard is not theoretical.)
 *
 * Email-first is part of the V1 trust contract, not merely a contact detail:
 * email is the transactional channel for the confirmation, the tracking link
 * and any later claim, so a phone number cannot substitute for it.
 */
export const CONSUMER_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Exact dollars for customer-facing copy. Never rounds. */
export function declaredValueDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

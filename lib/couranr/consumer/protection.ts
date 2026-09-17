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

/**
 * The version of the sender-facing shipment terms this flow collects against.
 *
 * SERVER-STATED, never accepted from a request body — the same rule
 * ACKNOWLEDGEMENT_VERSIONS follows for merchant activation, and for the same
 * reason: a sender cannot claim to have accepted a version they were not shown.
 * When the document changes, this changes, and a previously-stored version stops
 * matching — which is the entire point of versioning consent instead of storing
 * a boolean.
 */
export const CONSUMER_SENDER_TERMS_VERSION = "couranr-consumer-shipment-terms-2026-09";

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

/**
 * WHICH PROTECTION LEVELS COURANR CAN ACTUALLY SELL TODAY.
 *
 * THIS IS THE ONE PLACE TO CHANGE WHEN STRIPE IDENTITY IS ACTIVATED. Remove
 * `protected_handoff` from this list and everything follows from it: the
 * accepted maximum below becomes $500, `/sameday` displays $500, `/send` stops
 * refusing the band, the Protected Handoff disclosure becomes reachable, and
 * the server begins accepting the tier. Nothing else needs editing, and in
 * particular no marketing number is maintained by hand.
 *
 * WHY AVAILABILITY IS A SEPARATE IDEA FROM POLICY. A $200 shipment genuinely
 * maps to `protected_handoff` — that is the policy answer and it is correct.
 * What is missing is whether that level can be BOUGHT. Protected Handoff
 * requires a verified recipient identity, Stripe Identity is not activated, and
 * `private.couranr_block_unavailable_protected_handoff` refuses the request at
 * the database. So the level is derivable and unsellable at the same time, and
 * conflating the two is what let a $200 shipment walk through the funnel while
 * the page said the maximum was $150.
 */
export const PROTECTION_LEVELS_CURRENTLY_UNAVAILABLE: readonly ProtectionLevel[] = [
  "protected_handoff",
];

export function isProtectionLevelCurrentlyAvailable(level: unknown): boolean {
  return isProtectionLevel(level) && !PROTECTION_LEVELS_CURRENTLY_UNAVAILABLE.includes(level);
}

/** The bands in ascending order, paired with the level each one derives to. */
const BAND_CEILINGS: ReadonlyArray<{ level: ProtectionLevel; maxCents: number }> = [
  { level: "standard", maxCents: PROTECTION_THRESHOLDS.standardMaxCents },
  { level: "secure_pickup", maxCents: PROTECTION_THRESHOLDS.securePickupMaxCents },
  { level: "protected_handoff", maxCents: PROTECTION_THRESHOLDS.protectedHandoffMaxCents },
];

/**
 * The highest declared value that is actually purchasable right now.
 *
 * DERIVED, never typed. It walks the bands from the bottom and stops at the
 * first unavailable one, so it is the highest CONTIGUOUS ceiling — if a middle
 * band were ever withdrawn, the maximum would correctly fall to the band below
 * it rather than skipping over a hole and accepting a value nothing can serve.
 */
function highestAvailableCeiling(): number {
  let ceiling = 0;
  for (const band of BAND_CEILINGS) {
    if (!isProtectionLevelCurrentlyAvailable(band.level)) break;
    ceiling = band.maxCents;
  }
  return ceiling;
}

/**
 * THE HIGHEST DECLARED VALUE A CONSUMER CAN ACTUALLY SEND TODAY.
 *
 * NOT the same number as `CONSUMER_MAX_DECLARED_VALUE_CENTS`, and the
 * difference is the whole point. That constant is the POLICY ceiling: the most
 * this authority will ever govern, enforced by
 * `couranr_dr_declared_value_range_chk`. This one is what a customer can buy.
 *
 * They differ because anything above `securePickupMaxCents` derives to
 * `protected_handoff`, and `private.couranr_block_unavailable_protected_handoff`
 * — an ENABLED trigger in production — raises `protected_handoff_identity_unavailable`
 * for any consumer request at that level the moment it leaves draft. There is
 * no flag and no escape: Stripe Identity is not activated, so the top band is
 * unreachable. A shipment declared above this cannot be submitted at all.
 *
 * WHY IT IS HERE RATHER THAN IN A PAGE. Two public surfaces state a maximum —
 * `/sameday` and `/send` — and they were stating different numbers: the
 * marketing page had been corrected to the truth while `/send` still promised
 * the policy ceiling, so a sender could fill in $400 and only be refused at
 * submit. One authority, one answer, both surfaces.
 *
 * WHEN IDENTITY IS ACTIVATED and the block is lifted, this becomes
 * `CONSUMER_MAX_DECLARED_VALUE_CENTS` and both surfaces move together.
 */
export const CONSUMER_ACCEPTED_DECLARED_VALUE_CENTS: number = highestAvailableCeiling();

/**
 * Whether a declared value can be accepted commercially RIGHT NOW.
 *
 * THE GATE THE FUNNEL WAS MISSING. `deriveProtection` answers the POLICY
 * question and must keep doing so — it is what the database re-derives and what
 * a stored row is checked against. This answers the COMMERCIAL one, and the two
 * genuinely differ today.
 *
 * `protection_level_unavailable` is deliberately NOT `declared_value_above_maximum`.
 * $200 is not above the $500 policy maximum; saying it was would be a false
 * statement to the customer and would make the refusal impossible to tell apart
 * from a real policy breach in a log. It carries the derived level so a caller
 * can say WHICH tier is unavailable without re-deriving it.
 */
export type ProtectionAvailability =
  | { ok: true; requirements: ProtectionRequirements }
  | {
      ok: false;
      reason: "declared_value_invalid" | "declared_value_above_maximum";
      level: "declined";
    }
  | {
      ok: false;
      reason: "protection_level_unavailable";
      level: Exclude<ProtectionLevel, "declined">;
    };

/** `strict: false`, so `.ok` does not narrow without an explicit predicate. */
export function isProtectionUnavailable(
  a: ProtectionAvailability
): a is Extract<ProtectionAvailability, { ok: false }> {
  return a.ok === false;
}

export function evaluateConsumerProtectionAvailability(
  declaredValueCents: unknown
): ProtectionAvailability {
  const decision = deriveProtection(declaredValueCents);
  if (isProtectionDeclined(decision)) {
    return { ok: false, reason: decision.reason, level: "declined" };
  }
  const level = decision.requirements.level;
  /* `ProtectionRequirements.level` is typed as the full union, so this narrows
     it. It is unreachable by construction — `deriveProtection` never returns a
     successful decision carrying 'declined' — and it is written as a real
     refusal rather than a cast so that if that ever stopped being true, the
     value would be refused instead of silently treated as purchasable. */
  if (level === "declined") {
    return { ok: false, reason: "declared_value_invalid", level: "declined" };
  }
  if (!isProtectionLevelCurrentlyAvailable(level)) {
    return { ok: false, reason: "protection_level_unavailable", level };
  }
  return { ok: true, requirements: decision.requirements };
}

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

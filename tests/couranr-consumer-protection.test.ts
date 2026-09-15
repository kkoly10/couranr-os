import { describe, expect, it } from "vitest";
import {
  CONSUMER_MAX_DECLARED_VALUE_CENTS,
  COURANR_PROTECTION_POLICY_VERSION,
  deriveProtection,
  declaredValueDollars,
  isGovernedByProtectionPolicy,
  isProtectionLevel,
  PROTECTION_THRESHOLDS,
  requirementsFor,
} from "@/lib/couranr/consumer/protection";

/**
 * The protection level is the one fact the client must never choose. These
 * assertions pin the bands at CENT precision, because the owner's bands are
 * written that way — $30.01 begins secure pickup — and an off-by-one at a
 * boundary is the difference between a $500 shipment taking the standard path
 * and taking protected handoff.
 */
const level = (cents: number) => {
  const d = deriveProtection(cents);
  return d.ok ? d.requirements.level : `declined:${d.reason}`;
};

describe("declared value → protection level", () => {
  it("puts the band edges exactly where the owner decision puts them", () => {
    expect(level(0)).toBe("standard");
    expect(level(3_000)).toBe("standard"); // $30.00 — still standard
    expect(level(3_001)).toBe("secure_pickup"); // $30.01 — the band begins
    expect(level(15_000)).toBe("secure_pickup"); // $150.00
    expect(level(15_001)).toBe("protected_handoff"); // $150.01
    expect(level(50_000)).toBe("protected_handoff"); // $500.00 — the ceiling
  });

  it("declines above the ceiling — $500.01 is not a rounding problem", () => {
    expect(level(50_001)).toBe("declined:declared_value_above_maximum");
    expect(level(100_000)).toBe("declined:declared_value_above_maximum");
    expect(CONSUMER_MAX_DECLARED_VALUE_CENTS).toBe(50_000);
  });

  it("refuses an unreadable value instead of treating it as $0", () => {
    /* The dangerous coercion: a shipment whose value cannot be read is NOT a
       zero-value shipment. Treating it as one would route a $500 item onto the
       standard path with no prepack photo and no seal. */
    for (const bad of [null, undefined, "500", NaN, Infinity, -1, 12.5, {}, [], true]) {
      const d = deriveProtection(bad as never);
      expect(d.ok, `${JSON.stringify(bad)} was accepted`).toBe(false);
      if (!d.ok) expect(d.level).toBe("declined");
    }
  });

  it("is total: every legal cent value in range yields a level", () => {
    for (let c = 0; c <= CONSUMER_MAX_DECLARED_VALUE_CENTS; c += 137) {
      const d = deriveProtection(c);
      expect(d.ok, `${c} produced no level`).toBe(true);
      if (d.ok) expect(isProtectionLevel(d.requirements.level)).toBe(true);
    }
  });
});

describe("what each level actually requires", () => {
  it("standard keeps the simple existing pickup — no seal, no prepack photo", () => {
    const r = requirementsFor("standard");
    expect(r.requiresPrepackPhoto).toBe(false);
    expect(r.requiresSealedPackagePhoto).toBe(false);
    expect(r.requiresSecuritySeal).toBe(false);
    expect(r.credentialAfterDocumentation).toBe(false);
    expect(r.requiresRecipientIdentityVerification).toBe(false);
    expect(r.requiresSealCheckAtDropoff).toBe(false);
  });

  it("secure pickup documents the item, seals it, and moves the credential last", () => {
    const r = requirementsFor("secure_pickup");
    expect(r.requiresPrepackPhoto).toBe(true);
    expect(r.requiresSealedPackagePhoto).toBe(true);
    expect(r.requiresSecuritySeal).toBe(true);
    // The credential now means "the documented and sealed shipment is what I am
    // tendering", which is only true if it is confirmed AFTER the sequence.
    expect(r.credentialAfterDocumentation).toBe(true);
    expect(r.requiresSealCheckAtDropoff).toBe(true);
    // Identity is NOT required merely because the value crossed $30.
    expect(r.requiresRecipientIdentityVerification).toBe(false);
  });

  it("protected handoff adds identity and forbids leave-at-door", () => {
    const r = requirementsFor("protected_handoff");
    expect(r.requiresRecipientIdentityVerification).toBe(true);
    expect(r.allowsLeaveAtDoor).toBe(false);
    // And keeps everything secure pickup established.
    expect(r.requiresPrepackPhoto).toBe(true);
    expect(r.requiresSecuritySeal).toBe(true);
    expect(r.requiresSealCheckAtDropoff).toBe(true);
  });

  it("only protected handoff forbids leave-at-door", () => {
    expect(requirementsFor("standard").allowsLeaveAtDoor).toBe(true);
    expect(requirementsFor("secure_pickup").allowsLeaveAtDoor).toBe(true);
  });

  it("requirements are monotonic — a higher band never requires less", () => {
    /* A future threshold edit that accidentally dropped a requirement from the
       top band would otherwise pass every test above. */
    const order = ["standard", "secure_pickup", "protected_handoff"] as const;
    const flags = [
      "requiresPrepackPhoto",
      "requiresSealedPackagePhoto",
      "requiresSecuritySeal",
      "requiresRecipientIdentityVerification",
      "requiresSealCheckAtDropoff",
    ] as const;
    for (const flag of flags) {
      let seenTrue = false;
      for (const l of order) {
        const v = requirementsFor(l)[flag];
        if (seenTrue) expect(v, `${l}.${flag} regressed`).toBe(true);
        if (v) seenTrue = true;
      }
    }
    // allowsLeaveAtDoor moves the other way and must only ever tighten.
    expect(requirementsFor("protected_handoff").allowsLeaveAtDoor).toBe(false);
  });

  it("stamps the policy version on every derivation", () => {
    const d = deriveProtection(20_000);
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.requirements.policyVersion).toBe(COURANR_PROTECTION_POLICY_VERSION);
  });
});

describe("historical compatibility", () => {
  it("does not retroactively govern rows written before this authority", () => {
    // A historical delivery has no policy version. It must read back as
    // ungoverned rather than be presented as having passed a workflow that did
    // not exist when it shipped.
    expect(isGovernedByProtectionPolicy(null)).toBe(false);
    expect(isGovernedByProtectionPolicy(undefined)).toBe(false);
    expect(isGovernedByProtectionPolicy("")).toBe(false);
    expect(isGovernedByProtectionPolicy("   ")).toBe(false);
    expect(isGovernedByProtectionPolicy(COURANR_PROTECTION_POLICY_VERSION)).toBe(true);
  });
});

describe("customer-facing formatting", () => {
  it("renders exact dollars and never rounds", () => {
    expect(declaredValueDollars(0)).toBe("$0.00");
    expect(declaredValueDollars(3_000)).toBe("$30.00");
    expect(declaredValueDollars(3_001)).toBe("$30.01");
    expect(declaredValueDollars(50_000)).toBe("$500.00");
    expect(declaredValueDollars(1)).toBe("$0.01");
  });

  it("the thresholds the UI discloses are the thresholds the server derives", () => {
    // The /send disclosure copy keys off these numbers. If a future edit moved a
    // threshold without moving the copy, the customer would be told one rule and
    // held to another.
    expect(PROTECTION_THRESHOLDS.standardMaxCents).toBe(3_000);
    expect(PROTECTION_THRESHOLDS.securePickupMaxCents).toBe(15_000);
    expect(PROTECTION_THRESHOLDS.protectedHandoffMaxCents).toBe(CONSUMER_MAX_DECLARED_VALUE_CENTS);
    expect(level(PROTECTION_THRESHOLDS.standardMaxCents)).toBe("standard");
    expect(level(PROTECTION_THRESHOLDS.standardMaxCents + 1)).toBe("secure_pickup");
    expect(level(PROTECTION_THRESHOLDS.securePickupMaxCents)).toBe("secure_pickup");
    expect(level(PROTECTION_THRESHOLDS.securePickupMaxCents + 1)).toBe("protected_handoff");
  });
});

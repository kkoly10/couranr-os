import { describe, expect, it } from "vitest";
import {
  CONSUMER_ACCEPTED_DECLARED_VALUE_CENTS,
  CONSUMER_MAX_DECLARED_VALUE_CENTS,
  NO_PROTECTION_CAPABILITIES,
  PROTECTION_THRESHOLDS,
  acceptedDeclaredValueCents,
  protectionLevelAvailability,
  deriveProtection,
  evaluateConsumerProtectionAvailability,
  isProtectionDeclined,
  isProtectionLevelCurrentlyAvailable,
  isProtectionUnavailable,
} from "@/lib/couranr/consumer/protection";
import {
  isConsumerSendBodyFailure,
  validateConsumerSendBody,
} from "@/lib/couranr/consumer/send";

/**
 * THE DEFECT THIS FILE EXISTS FOR.
 *
 * `/send` was corrected to DISPLAY $150 as the accepted maximum while its
 * eligibility logic still ran on `deriveProtection`, which only refuses above
 * the $500 POLICY ceiling. So a $200 shipment kept a live Continue button, was
 * shown the Protected Handoff disclosure as though it could be bought, passed
 * server body validation, and reached estimate and draft before anything
 * refused it. The page said one thing and the funnel did another.
 *
 * The earlier reconciliation test proved both surfaces RENDER the same
 * constant. That is not the same claim as the funnel ENFORCING it, and the gap
 * between those two sentences is exactly where this bug lived. These tests
 * assert behaviour at every band edge instead.
 */
const D = (dollars: number) => Math.round(dollars * 100);

describe("policy and availability are different questions", () => {
  it("a $200 shipment is a VALID protected handoff under policy", () => {
    /* The point of keeping them separate. deriveProtection must not start
       lying: $200 genuinely derives to protected_handoff, and the database
       re-derives the identical answer. What it cannot do is be sold. */
    const policy = deriveProtection(D(200));
    expect(isProtectionDeclined(policy)).toBe(false);
    if (!isProtectionDeclined(policy)) {
      expect(policy.requirements.level).toBe("protected_handoff");
    }
  });

  it("and is nonetheless refused as currently unavailable", () => {
    const a = evaluateConsumerProtectionAvailability(D(200));
    expect(isProtectionUnavailable(a)).toBe(true);
    if (isProtectionUnavailable(a)) {
      expect(a.reason).toBe("protection_level_unavailable");
      expect(a.reason).not.toBe("declared_value_above_maximum");
      expect((a as { level: string }).level).toBe("protected_handoff");
    }
  });

  it("availability is DERIVED from capabilities, never asserted as a list", () => {
    /* The structural fix. It used to be a hardcoded list of level names, which
       is why a code edit could get ahead of the provider configuration. */
    const off = protectionLevelAvailability(NO_PROTECTION_CAPABILITIES);
    expect(off).toEqual({ standard: true, secure_pickup: true, protected_handoff: false });
    const on = protectionLevelAvailability({ recipientIdentityVerification: true });
    expect(on).toEqual({ standard: true, secure_pickup: true, protected_handoff: true });
  });

  it("the accepted maximum follows the capability, in both directions", () => {
    expect(acceptedDeclaredValueCents(NO_PROTECTION_CAPABILITIES)).toBe(
      PROTECTION_THRESHOLDS.securePickupMaxCents
    );
    expect(acceptedDeclaredValueCents({ recipientIdentityVerification: true })).toBe(
      CONSUMER_MAX_DECLARED_VALUE_CENTS
    );
  });
});

describe("every band edge the funnel has to get right", () => {
  /** [dollars, outcome] — `outcome` is the level, or the refusal reason. */
  const CASES: ReadonlyArray<readonly [number, string]> = [
    [0, "standard"],
    [30, "standard"],
    [30.01, "secure_pickup"],
    [150, "secure_pickup"],
    [150.01, "protection_level_unavailable"],
    [200, "protection_level_unavailable"],
    [499.99, "protection_level_unavailable"],
    [500, "protection_level_unavailable"],
    [500.01, "declared_value_above_maximum"],
  ];

  it.each(CASES.map((c) => [`$${c[0].toFixed(2)}`, c[0], c[1]] as const))(
    "%s",
    (_label, dollars, expected) => {
      const a = evaluateConsumerProtectionAvailability(D(dollars));
      if (isProtectionUnavailable(a)) {
        expect(a.reason, `$${dollars}`).toBe(expected);
      } else {
        expect(a.requirements.level, `$${dollars}`).toBe(expected);
      }
    }
  );

  it("the boundary is the ACCEPTED maximum, not the policy ceiling", () => {
    expect(CONSUMER_ACCEPTED_DECLARED_VALUE_CENTS).toBe(
      PROTECTION_THRESHOLDS.securePickupMaxCents
    );
    expect(CONSUMER_ACCEPTED_DECLARED_VALUE_CENTS).toBeLessThan(CONSUMER_MAX_DECLARED_VALUE_CENTS);
    expect(isProtectionUnavailable(
      evaluateConsumerProtectionAvailability(CONSUMER_ACCEPTED_DECLARED_VALUE_CENTS)
    )).toBe(false);
    expect(isProtectionUnavailable(
      evaluateConsumerProtectionAvailability(CONSUMER_ACCEPTED_DECLARED_VALUE_CENTS + 1)
    )).toBe(true);
  });

  it("the accepted maximum is DERIVED from availability, not typed", () => {
    /* §5: activating identity must be a one-line change. If this constant were
       hand-written, removing protected_handoff from the unavailable list would
       leave $150 standing everywhere and the marketing number would go stale
       silently — which is the failure mode the whole reconciliation was about. */
    const src = readSource("lib/couranr/consumer/protection.ts");
    /* The fail-closed constant is now itself derived by calling the function
       with no capabilities, so activation cannot leave it behind. */
    expect(src).toMatch(
      /CONSUMER_ACCEPTED_DECLARED_VALUE_CENTS[^\n]*=\s*acceptedDeclaredValueCents\(\)/
    );
    expect(src).not.toMatch(/CONSUMER_ACCEPTED_DECLARED_VALUE_CENTS[^\n]*=\s*15_?000/);
  });
});

describe("the server refuses before any draft or quote work", () => {
  const body = (declaredValueCents: number) => ({
    pickupPlaceId: "p1",
    dropoffPlaceId: "p2",
    contact: { name: "Alex Chen", phone: "+15715550100", email: "sender@example.test" },
    recipient: { name: "Dana Reyes", email: "recipient@example.test" },
    declaredValueCents,
    acceptance: { shipmentCertification: true, electronicTransactions: true },
    shipment: { weightLb: 20, restrictedClass: "none" },
  });

  it("refuses $200 with the unavailability reason, not the policy one", () => {
    const r = validateConsumerSendBody(body(D(200)));
    /* `strict: false`, so `!r.ok` does not narrow — the same reason the module
       exports this predicate at all. */
    expect(isConsumerSendBodyFailure(r)).toBe(true);
    if (isConsumerSendBodyFailure(r)) {
      expect(r.reason).toBe("protection_level_unavailable");
      expect(r.reason).not.toBe("declared_value_above_maximum");
    }
  });

  it("still refuses $500.01 as ABOVE THE POLICY MAXIMUM", () => {
    const r = validateConsumerSendBody(body(D(500.01)));
    expect(isConsumerSendBodyFailure(r)).toBe(true);
    if (isConsumerSendBodyFailure(r)) expect(r.reason).toBe("declared_value_above_maximum");
  });

  it("accepts $150 and $30, so the gate is not simply refusing everything", () => {
    // POSITIVE CONTROL. Without it, a validator that rejected every body would
    // pass both assertions above and look like a working gate.
    expect(validateConsumerSendBody(body(D(150))).ok).toBe(true);
    expect(validateConsumerSendBody(body(D(30))).ok).toBe(true);
  });

  it("runs this check BEFORE routing, quoting or writing a draft", () => {
    /* Ordering is the whole point of moving the gate here — the submit path
       already refused a protected handoff, but only after a draft existed and a
       quote had been calculated, so the sender was walked the length of the
       funnel and turned away at the end. */
    const src = readSource("lib/couranr/consumer/send.ts");
    const fn = src.slice(src.indexOf("export async function estimateConsumerSend"));
    const validate = fn.indexOf("validateConsumerSendBody(params.body)");
    const route = fn.indexOf("deriveCanonicalRouteAndQuote");
    expect(validate).toBeGreaterThan(-1);
    expect(route).toBeGreaterThan(-1);
    expect(validate, "validation no longer precedes routing/quoting").toBeLessThan(route);
  });
});

describe("there is exactly ONE availability authority", () => {
  /*
   * WHAT THIS USED TO ASSERT, AND WHY IT CHANGED. The first fix left TWO
   * answers to "is protected handoff available": a hardcoded list of level
   * names, and isRecipientIdentityCapabilityAvailable(). These tests asserted
   * the two were consulted in the right ORDER and that the second survived as a
   * backstop — the best available property when the first answer knew nothing
   * about the provider.
   *
   * The authority now DERIVES availability from capabilities, and the
   * capability IS the provider predicate. There is no code switch separate from
   * the configuration to get ahead of it, so ordering and backstops are no
   * longer the question. The stronger property is asserted instead: the
   * predicate is read in exactly one place, and that place feeds the authority.
   */
  it("the provider predicate is consulted in exactly ONE place on the server", () => {
    const src = readSource("lib/couranr/consumer/send.ts");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
    const calls = [...code.matchAll(/isRecipientIdentityCapabilityAvailable\(\)/g)];
    expect(calls.length, "the provider predicate is read from more than one site").toBe(1);
    expect(code).toMatch(
      /function currentProtectionCapabilities\(\)[\s\S]{0,240}recipientIdentityVerification:\s*isRecipientIdentityCapabilityAvailable\(\)/
    );
  });

  it("estimate and submit both ask that same reader", () => {
    const src = readSource("lib/couranr/consumer/send.ts");
    const uses = [...src.matchAll(/evaluateConsumerProtectionAvailability\(/g)];
    expect(uses.length, "a gate stopped asking the authority").toBeGreaterThanOrEqual(2);
    const calls = [...src.matchAll(/currentProtectionCapabilities\(\)/g)];
    // one definition + one per gate + the message composer
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it("the accepted maximum is DERIVED, never typed", () => {
    const src = readSource("lib/couranr/consumer/protection.ts");
    expect(src).toMatch(/acceptedDeclaredValueCents\([\s\S]{0,400}for \(const band of BAND_CEILINGS\)/);
    expect(src).not.toMatch(/acceptedDeclaredValueCents[^\n]*=\s*15_?000/);
  });

  it("no customer-facing maximum is composed from the POLICY ceiling", () => {
    for (const f of [
      "lib/couranr/consumer/send.ts",
      "lib/couranr/sameday/liveAdapters.ts",
      "components/couranr/sameday/SendFlow.tsx",
    ]) {
      const src = readSource(f);
      expect(src, `${f} types a dollar literal into a customer message`).not.toMatch(
        /declared up to \$\d/
      );
      expect(
        src,
        `${f} composes a customer-facing maximum from the policy ceiling`
      ).not.toMatch(/up to \$\{declaredValueDollars\(\s*CONSUMER_MAX_DECLARED_VALUE_CENTS/);
    }
  });
});

describe("configuration fail-closed matrix", () => {
  /*
   * The asymmetry an independent reviewer found: a code-level switch could be
   * flipped while the provider stayed unconfigured, and estimate and submit
   * would then disagree. With availability derived from the capability there is
   * no such switch — but the MATRIX still has to hold, because the capability
   * itself is computed from two independent conditions.
   */
  const CASES = [
    ["A  feature off, provider absent", { recipientIdentityVerification: false }, false],
    ["B  feature on,  provider absent", { recipientIdentityVerification: false }, false],
    ["C  feature off, provider present", { recipientIdentityVerification: false }, false],
    ["D  feature on,  provider present", { recipientIdentityVerification: true }, true],
  ] as const;

  it.each(CASES.map((c) => [c[0], c[1], c[2]] as const))(
    "%s",
    (_label, caps, expected) => {
      expect(protectionLevelAvailability(caps).protected_handoff).toBe(expected);
      const a = evaluateConsumerProtectionAvailability(D(200), caps);
      expect(isProtectionUnavailable(a)).toBe(!expected);
      expect(acceptedDeclaredValueCents(caps)).toBe(
        expected ? CONSUMER_MAX_DECLARED_VALUE_CENTS : PROTECTION_THRESHOLDS.securePickupMaxCents
      );
    }
  );

  it("the capability itself requires BOTH conditions, not either", () => {
    /* A/B/C above all collapse to `recipientIdentityVerification: false`
       because that is what the server computes for each. This asserts the
       computation: isRecipientIdentityCapabilityAvailable() is an AND, so one
       condition alone can never open the tier. */
    const src = readSource("lib/couranr/identity/recipientIdentity.ts");
    expect(src).toMatch(
      /isRecipientIdentityCapabilityAvailable\(\)[\s\S]{0,160}isStripeIdentityActivated\(\)\s*&&\s*hasIdentityRestrictedKey\(\)/
    );
    expect(src, "the capability became an OR, so one condition could open the tier").not.toMatch(
      /isStripeIdentityActivated\(\)\s*\|\|\s*hasIdentityRestrictedKey\(\)/
    );
  });

  it("a caller that cannot see configuration gets the closed answer", () => {
    expect(NO_PROTECTION_CAPABILITIES.recipientIdentityVerification).toBe(false);
    expect(protectionLevelAvailability().protected_handoff).toBe(false);
    expect(acceptedDeclaredValueCents()).toBe(PROTECTION_THRESHOLDS.securePickupMaxCents);
    // and the default applies when a caller passes nothing at all
    expect(isProtectionUnavailable(evaluateConsumerProtectionAvailability(D(200)))).toBe(true);
  });
});

describe("the database backstop is untouched", () => {
  it("still refuses a protected handoff at the last line of defence", () => {
    /* Three gates that must agree: browser, server, database. This asserts the
       third still exists — it is applied in production and nothing here may
       weaken it, because the first two are code and code can be bypassed. */
    const sql = readSource(
      "supabase/migrations/20260915130000_couranr_recipient_identity_seam.sql"
    );
    expect(sql).toContain("protected_handoff_identity_unavailable");
    expect(sql).toContain("couranr_dr_block_unavailable_protected_handoff");
  });
});

function readSource(rel: string): string {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { readFileSync } = require("node:fs");
  const path = require("node:path");
  return readFileSync(path.resolve(__dirname, "..", rel), "utf8");
}

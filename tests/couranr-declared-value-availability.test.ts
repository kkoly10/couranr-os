import { describe, expect, it } from "vitest";
import {
  CONSUMER_ACCEPTED_DECLARED_VALUE_CENTS,
  CONSUMER_MAX_DECLARED_VALUE_CENTS,
  PROTECTION_LEVELS_CURRENTLY_UNAVAILABLE,
  PROTECTION_THRESHOLDS,
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

  it("names which tier is unavailable, so nobody re-derives it to find out", () => {
    expect(PROTECTION_LEVELS_CURRENTLY_UNAVAILABLE).toContain("protected_handoff");
    expect(isProtectionLevelCurrentlyAvailable("standard")).toBe(true);
    expect(isProtectionLevelCurrentlyAvailable("secure_pickup")).toBe(true);
    expect(isProtectionLevelCurrentlyAvailable("protected_handoff")).toBe(false);
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
    expect(src).toMatch(/CONSUMER_ACCEPTED_DECLARED_VALUE_CENTS[^\n]*=\s*highestAvailableCeiling\(\)/);
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

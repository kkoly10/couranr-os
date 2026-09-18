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

describe("there is exactly ONE availability authority", () => {
  /*
   * FOUND IN REVIEW, AFTER the first fix was already green. The submit path
   * answered "is protected handoff available" for itself, from
   * isRecipientIdentityCapabilityAvailable(), while the funnel answered it from
   * PROTECTION_LEVELS_CURRENTLY_UNAVAILABLE. Two answers to one question, and
   * they can disagree in both directions: flip the list without configuring the
   * provider and submit accepts what the funnel refused; configure the provider
   * without flipping the list and the reverse. The whole suite passed anyway,
   * which is why this test exists.
   */
  it("no path decides availability without consulting the shared authority", () => {
    const src = readSource("lib/couranr/consumer/send.ts");
    const gates = [...src.matchAll(/isRecipientIdentityCapabilityAvailable\(\)/g)];
    expect(gates.length, "the configuration backstop disappeared").toBeGreaterThan(0);
    for (const g of gates) {
      const before = src.slice(0, g.index ?? 0);
      expect(
        before.includes("evaluateConsumerProtectionAvailability("),
        "a path gates on provider configuration without first asking the availability authority"
      ).toBe(true);
    }
  });

  it("keeps the configuration backstop, so code-only activation still fails closed", () => {
    /* The list says what Couranr SELLS; the predicate says whether the provider
       is actually switched on. Removing protected_handoff from the list without
       configuring Stripe must still refuse. */
    const src = readSource("lib/couranr/consumer/send.ts");
    expect(src).toMatch(
      /level === "protected_handoff"[\s\S]{0,80}!isRecipientIdentityCapabilityAvailable\(\)/
    );
  });

  it("no customer-facing maximum is composed from the POLICY ceiling", () => {
    /* The same defect one layer down: the submit refusal and the adapter note
       both told the sender the limit was $500 while /send and /sameday said
       $150, so someone at $600 would lower to $400 and be refused again. */
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

describe("every reader of the adult-attestation rule agrees with the SQL", () => {
  /*
   * THIS RULE HAS NOW DRIFTED TWICE. 20260917130000 widened the database rule so
   * EVERY governed consumer recipient attests, not only a protected handoff.
   * tracking/projection.ts was corrected then; email/consumerLifecycle.ts was
   * not, and kept the narrow test for weeks. Because protected_handoff is the
   * one tier that cannot be sold, the narrow test is false for every shipment
   * Couranr can actually sell — so the recipient's only proactive notification
   * omitted the requirement that blocks their own delivery.
   *
   * A test on one reader would not have caught it. This asserts the SHAPE of
   * the rule everywhere it is read.
   */
  const READERS = [
    "lib/couranr/tracking/projection.ts",
    "lib/couranr/email/consumerLifecycle.ts",
  ];

  it.each(READERS)("%s derives it from GOVERNED, not from protected_handoff", (file) => {
    const src = readSource(file);
    /* The ASSIGNMENT, not the type declaration. `projection.ts` declares
       `recipientAdultAttestationRequired: boolean;` on its exported type before
       it assigns one, and an indexOf that lands on the declaration would read a
       type annotation and pass no matter what the code does. */
    const sites = [...src.matchAll(/recipientAdultAttestationRequired:\s*(?!boolean;)/g)];
    expect(sites.length, `${file} no longer assigns the flag`).toBeGreaterThan(0);
    const idx = sites[sites.length - 1].index ?? -1;
    const expr = src.slice(idx, idx + 320);
    expect(
      expr,
      `${file} gates the attestation on protected_handoff, which cannot be sold`
    ).not.toMatch(/===\s*"protected_handoff"/);
    expect(expr, `${file} does not test for a governed row`).toMatch(/protection_level/);
  });

  it("and the SQL really does require it at every level", () => {
    // Non-vacuous: if the migration ever narrows again, the readers should follow.
    const sql = readSource(
      "supabase/migrations/20260917130000_couranr_universal_recipient_adult.sql"
    );
    const guard = sql.slice(
      sql.indexOf("if v_request.requester_kind='consumer'"),
      sql.indexOf("recipient_adult_attestation_required' using errcode='CR409'")
    );
    expect(guard, "the SQL guard is scoped to a single protection level").not.toContain(
      "protected_handoff"
    );
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

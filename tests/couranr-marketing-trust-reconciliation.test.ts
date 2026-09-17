import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  CONSUMER_ACCEPTED_DECLARED_VALUE_CENTS,
  CONSUMER_MAX_DECLARED_VALUE_CENTS,
  PROTECTION_THRESHOLDS,
  declaredValueDollars,
} from "@/lib/couranr/consumer/protection";
import { LEGAL_DOCUMENTS, LEGAL_DOCUMENT_IDS } from "@/lib/couranr/legal/registry";
import { MASTER_COPY, SAME_DAY_COPY, SEND_COPY } from "@/lib/couranr/public/masterSameDayCopy";

/**
 * THE INTEGRATION MISTAKE THIS FILE EXISTS TO CATCH.
 *
 * The marketing architecture was built from `main` instead of on top of the
 * Trust/Custody branch. Both branches were healthy; the BASE was wrong. So the
 * marketing copy described a product that had already moved: it said
 * value-tiered custody was "not in this build", that Couranr had no channel to
 * reach a recipient, and that the sender receives the tracking link and may
 * pass it on. Every one of those had stopped being true.
 *
 * A wrong base produces copy that is internally consistent, reviews cleanly,
 * and is false. Nothing in a normal diff catches that — the marketing diff
 * looked perfect against the base it was written for. These tests tie the
 * public copy to the AUTHORITY and to the CODE, so the next time a branch is
 * cut from the wrong place the copy cannot quietly describe the old product.
 */
const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const SAMEDAY_PAGE = "app/(couranr)/(public)/(consumer-public)/sameday/page.tsx";
const BUSINESS_PAGE = "app/(couranr)/(public)/(business-public)/business/page.tsx";
const MASTER_PAGE = "app/(couranr)/(public)/(master-public)/page.tsx";
const COPY_MODULE = "lib/couranr/public/masterSameDayCopy.ts";

/** Marketing copy only. Comments explain intent and are not customer-facing. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const marketingStrings = (): string[] =>
  [...Object.values(MASTER_COPY), ...Object.values(SAME_DAY_COPY)]
    .flatMap((v) => (Array.isArray(v) ? v : [v]))
    .filter((v): v is string => typeof v === "string");

/* ─────────────────────── 1. the declared-value authority ─────────────── */

describe("Same Day reads its declared-value limit from authority", () => {
  it("never hardcodes a money figure in a copy string", () => {
    /* The figure belongs to protection.ts. A literal in copy is a second
       answer, and the one that goes stale silently because no test owns it. */
    for (const s of marketingStrings()) {
      expect(s, `copy string carries a price literal: ${s}`).not.toMatch(/\$\s?\d/);
    }
  });

  it("the page renders the limit from the protection module, not a literal", () => {
    const src = stripComments(read(SAMEDAY_PAGE));
    const importsAuthority =
      /from "@\/lib\/couranr\/consumer\/protection"/.test(src) ||
      /PROTECTION_THRESHOLDS|CONSUMER_MAX_DECLARED_VALUE_CENTS|declaredValueDollars/.test(src);
    expect(importsAuthority, "the Same Day page states a limit without reading authority").toBe(
      true
    );
  });

  it("/send and /sameday state the SAME maximum, from one authority", () => {
    /*
     * THE DEFECT THIS CATCHES, found during the reconciliation. `/sameday` had
     * been corrected to the value a customer can actually buy while `/send`
     * still rendered the POLICY ceiling, so the marketing page said one number
     * and the form said another — and a sender could fill in an amount the
     * database would refuse only at submit. Two surfaces stating a maximum must
     * read the same constant.
     */
    const send = read("components/couranr/sameday/SendFlow.tsx");
    const page = read(SAMEDAY_PAGE);
    for (const [name, src] of [["/send", send], ["/sameday", page]] as const) {
      expect(src, `${name} renders the policy ceiling instead of the accepted maximum`)
        .not.toMatch(/declaredValueDollars\(\s*CONSUMER_MAX_DECLARED_VALUE_CENTS/);
      expect(src, `${name} does not render the accepted maximum from authority`)
        .toMatch(/CONSUMER_ACCEPTED_DECLARED_VALUE_CENTS/);
    }
  });

  it("the accepted maximum is below the policy ceiling while the top tier is blocked", () => {
    expect(CONSUMER_ACCEPTED_DECLARED_VALUE_CENTS).toBe(
      PROTECTION_THRESHOLDS.securePickupMaxCents
    );
    expect(CONSUMER_ACCEPTED_DECLARED_VALUE_CENTS).toBeLessThan(
      CONSUMER_MAX_DECLARED_VALUE_CENTS
    );
    expect(declaredValueDollars(CONSUMER_ACCEPTED_DECLARED_VALUE_CENTS)).toBe("$150.00");
  });

  it("pins what the authority currently says, so a change is deliberate", () => {
    expect(PROTECTION_THRESHOLDS.standardMaxCents).toBe(3_000);
    expect(PROTECTION_THRESHOLDS.securePickupMaxCents).toBe(15_000);
    expect(CONSUMER_MAX_DECLARED_VALUE_CENTS).toBe(50_000);
    expect(declaredValueDollars(PROTECTION_THRESHOLDS.securePickupMaxCents)).toBe("$150.00");
  });
});

/* ──────────────── 2. Business must not inherit the consumer ceiling ──── */

describe("Business does not inherit the Consumer Same Day ceiling", () => {
  it("states no consumer declared-value maximum on a Business surface", () => {
    /* The $500 policy ceiling and the protection tiers govern CONSUMER Same Day.
       Business has its own commercial terms; presenting a consumer limit there
       would be a promise nothing implements. */
    const src = stripComments(read(BUSINESS_PAGE));
    expect(src).not.toMatch(/\$\s?500/);
    expect(src).not.toMatch(/CONSUMER_MAX_DECLARED_VALUE_CENTS/);
    expect(src, "Business imports the consumer protection authority").not.toMatch(
      /from "@\/lib\/couranr\/consumer\/protection"/
    );
  });

  it("does not apply consumer protection-tier names to Business", () => {
    const src = stripComments(read(BUSINESS_PAGE)).toLowerCase();
    for (const tier of ["secure pickup", "protected handoff"]) {
      expect(src, `Business copy claims the consumer tier "${tier}"`).not.toContain(tier);
    }
  });
});

/* ──────────── 3. a capability the server implements is not "absent" ──── */

describe("marketing cannot claim a capability is absent when the code implements it", () => {
  /**
   * Each row pairs a phrase the OLD base justified with a probe of the CURRENT
   * code. The probe is the point: the test fails when the capability exists AND
   * the copy still denies it, so it keeps working as capabilities land, instead
   * of freezing today's answer.
   */
  const CAPABILITIES = [
    {
      what: "value-tiered custody",
      implemented: () =>
        read("lib/couranr/consumer/protection.ts").includes("secure_pickup") &&
        read("lib/couranr/consumer/protection.ts").includes("protected_handoff"),
      deniedBy: [/value-tiered custody[\s\S]{0,80}not in this build/i, /not in this build/i],
    },
    {
      what: "tamper-evident seals",
      implemented: () =>
        existsSync(path.join(ROOT, "supabase/migrations")) &&
        read("lib/couranr/consumer/protection.ts").includes("requiresSecuritySeal"),
      deniedBy: [/no tamper[- ]evident/i, /seals? (are|is) not/i],
    },
    {
      what: "a recipient contact channel",
      implemented: () => read("lib/couranr/consumer/send.ts").includes("recipient_email_required"),
      deniedBy: [
        /no channel to reach the recipient/i,
        /holds NO recipient identity/i,
        /no recipient (identity|contact)/i,
      ],
    },
    {
      what: "recipient-private tracking, separate from the sender",
      implemented: () => !/view\.trackingToken\s*=/.test(read("lib/couranr/consumer/send.ts")),
      deniedBy: [
        /sender is who gets the link/i,
        /to keep or to pass to whoever is receiving it/i,
      ],
    },
    {
      what: "the Prohibited and Restricted Items Policy document",
      implemented: () => LEGAL_DOCUMENT_IDS.includes("prohibited-items" as never),
      deniedBy: [/prohibited[- ]items policy[\s\S]{0,60}does not exist/i],
    },
  ] as const;

  const SURFACES = [COPY_MODULE, SAMEDAY_PAGE, BUSINESS_PAGE, MASTER_PAGE];

  it.each(CAPABILITIES.map((c) => [c.what, c] as const))(
    "%s is implemented, so no public surface may deny it",
    (_what, cap) => {
      expect(cap.implemented(), `the probe for "${cap.what}" no longer finds it`).toBe(true);
      const offenders: string[] = [];

      /* CUSTOMER-FACING STRINGS: no exception. A visitor never sees a comment,
         so a denial in a copy string is simply false. */
      const customerFacing = marketingStrings().join("\n");
      for (const re of cap.deniedBy) {
        if (re.test(customerFacing)) offenders.push(`copy string :: ${re}`);
      }

      /* COMMENTS: a stale comment misleads the next author, so they are scanned
         too — but honest history is allowed. A comment MAY quote the old claim
         in order to record that it changed; what it may not do is assert it
         flatly. The test for that is whether the same comment block also states
         the correction. This distinction is the whole reason the reconciliation
         was needed: the old comments read as current fact, and the next author
         believed them. */
      const CORRECTION = /\b(used to|no longer|now|it is:|stopped being|was\b[\s\S]{0,40}\bis\b|changed)/i;
      for (const f of SURFACES) {
        if (!existsSync(path.join(ROOT, f))) continue;
        const comments = [
          ...read(f).matchAll(/\/\*[\s\S]*?\*\//g),
          ...read(f).matchAll(/^[ \t]*\/\/.*$/gm),
        ].map((m) => m[0]);
        for (const block of comments) {
          for (const re of cap.deniedBy) {
            if (re.test(block) && !CORRECTION.test(block)) {
              offenders.push(`${f} :: comment asserts "${re}" without recording the correction`);
            }
          }
        }
      }
      expect(offenders, `copy denies "${cap.what}" which the code implements`).toEqual([]);
    }
  );
});

/* ─────────────── 4. copy may not outrun what can be sold today ───────── */

describe("protection-tier copy cannot outrun the implementation", () => {
  it("Protected Handoff is still blocked, so Same Day must not offer it", () => {
    /*
     * private.couranr_block_unavailable_protected_handoff is an ENABLED trigger
     * in production and raises unconditionally for any consumer request at
     * protection_level='protected_handoff' that leaves draft. A declared value
     * above $150.00 derives to that level, so such a shipment cannot be
     * submitted at all today — $500 is the policy ceiling in code, not a number
     * a customer can buy.
     *
     * This asserts the BLOCK still exists. When Stripe Identity is activated
     * and the block is lifted, this test fails and the copy gets revisited —
     * which is the correct direction for the failure to point.
     */
    const blocker = readFileSync(
      path.join(ROOT, "supabase/migrations/20260915130000_couranr_recipient_identity_seam.sql"),
      "utf8"
    );
    expect(blocker).toContain("protected_handoff_identity_unavailable");
    const stillBlocked = /raise exception 'protected_handoff_identity_unavailable'/.test(blocker);
    expect(stillBlocked).toBe(true);

    if (stillBlocked) {
      const src = stripComments(read(SAMEDAY_PAGE)) + marketingStrings().join(" ");
      expect(src, "Same Day offers Protected Handoff while the database blocks it").not.toMatch(
        /protected handoff is available|we verify (the )?recipient'?s? (government )?id/i
      );
    }
  });

  it("does not present recipient identity verification as something buyable", () => {
    const identity = read("lib/couranr/identity/recipientIdentity.ts");
    // The capability predicate is the honest gate; it needs activation AND a key.
    expect(identity).toContain("isRecipientIdentityCapabilityAvailable");
    const strings = marketingStrings().join(" ").toLowerCase();
    expect(strings).not.toContain("we check the recipient’s id");
    expect(strings).not.toContain("identity verified at the door");
  });
});

/* ───────────────────────── 5. legal links resolve ─────────────────────── */

describe("legal links resolve from the registry", () => {
  it("every document the registry declares has a real page route", () => {
    for (const id of LEGAL_DOCUMENT_IDS) {
      const doc = LEGAL_DOCUMENTS[id];
      expect(doc.slug, `${id} has no slug`).toBeTruthy();
    }
    expect(
      existsSync(path.join(ROOT, "app/(couranr)/(public)/(master-public)/legal/[document]/page.tsx"))
    ).toBe(true);
  });

  it("no public surface hardcodes a duplicate legal route", () => {
    /* The registry owns these paths. A second hardcoded copy is the thing that
       silently points at a legacy terms page after a slug changes. */
    for (const f of [SAMEDAY_PAGE, BUSINESS_PAGE, MASTER_PAGE]) {
      if (!existsSync(path.join(ROOT, f))) continue;
      const src = stripComments(read(f));
      const hardcoded = [...src.matchAll(/["'`]\/legal\/([a-z-]+)["'`]/g)].map((m) => m[1]);
      expect(hardcoded, `${f} hardcodes a legal route instead of using the registry`).toEqual([]);
    }
  });
});

/* ─────────── 6. the /send clickwrap was not replaced by old copy ──────── */

describe("the Trust/Custody /send clickwrap did not regress", () => {
  it("keeps every element the newer acknowledgement carries", () => {
    /*
     * THE REGRESSION THIS BRANCH EXISTED TO PREVENT. The marketing branch
     * carried an older, weaker acknowledgement from before the legal work:
     * "I confirm this item is eligible for delivery and I have authority to
     * send or collect it." Transplanting its copy module wholesale would have
     * silently reverted the clickwrap that the database records evidence
     * against — and the recorded evidence would then be stronger than the
     * sentence the customer actually agreed to.
     */
    const ack = SEND_COPY.acknowledgement as string;
    expect(ack).toMatch(/18 or older/i);
    expect(ack).toMatch(/authorized to send/i);
    expect(ack).toMatch(/recipient is 18 or older/i);
    expect(ack).toMatch(/declared value/i);
    expect(ack).toMatch(/Same Day Shipment Terms/);
    expect(ack).toMatch(/Prohibited and Restricted Items Policy/);
    // The superseded sentence must not come back.
    expect(ack).not.toBe(
      "I confirm this item is eligible for delivery and I have authority to send or collect it."
    );
  });

  it("keeps the electronic-transactions consent as its own statement", () => {
    expect(SEND_COPY.electronic_consent as string).toMatch(/electronically/i);
    expect(SEND_COPY.electronic_consent as string).toMatch(/email/i);
  });

  it("keeps the declared-value and protection disclosure on /send", () => {
    for (const k of [
      "declared_value_label",
      "declared_value_help",
      "declared_value_max_note",
      "protection_standard",
      "protection_secure_pickup",
      "protection_protected_handoff",
    ] as const) {
      expect((SEND_COPY as Record<string, unknown>)[k], `${k} was lost`).toBeTruthy();
    }
  });
});

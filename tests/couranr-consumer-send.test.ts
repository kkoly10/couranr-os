import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONSUMER_SEND_IDEMPOTENCY_KEY,
  FORBIDDEN_CONSUMER_KEYS,
  GUEST_SESSION_TTL_MINUTES,
  findForbiddenConsumerKey,
  isConsumerSendBodyFailure,
  validateConsumerSendBody,
} from "@/lib/couranr/consumer/send";

/**
 * Static guard for the consumer /send backend (batch 3 §D).
 *
 * The load-bearing rule: a BROWSER NEVER CHOOSES amounts, states, targets,
 * policy versions or route evidence. The consumer routes accept only place
 * identities, contact and a structured shipment statement; everything
 * commercial is server-derived through the SAME canonical pipeline the
 * Business portal uses. These tests hold that shape so a refactor cannot
 * quietly re-open it. Execution truth lives in e2e/disposable/consumerSend.mjs.
 */

const ROOT = path.resolve(__dirname, "..");
const CONSUMER_ROUTES_DIR = path.join(ROOT, "app/api/couranr/consumer");
const LIB = readFileSync(path.join(ROOT, "lib/couranr/consumer/send.ts"), "utf8");
const MIGRATION = readFileSync(
  path.join(ROOT, "supabase/migrations/20260903030000_couranr_consumer_send.sql"),
  "utf8"
);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

const ROUTE_FILES = walk(CONSUMER_ROUTES_DIR).sort();
const rel = (f: string) => path.relative(ROOT, f);
const stripped = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* ------------------------------------------------- the route inventory --- */

describe("consumer route inventory", () => {
  it("holds exactly the twelve contracted routes", () => {
    expect(ROUTE_FILES.map(rel)).toEqual([
      "app/api/couranr/consumer/estimate/route.ts",
      "app/api/couranr/consumer/interpret/route.ts",
      "app/api/couranr/consumer/pay/route.ts",
      "app/api/couranr/consumer/pickup-code/route.ts",
      "app/api/couranr/consumer/pickup-manifest/route.ts",
      "app/api/couranr/consumer/places/route.ts",
      "app/api/couranr/consumer/readiness/route.ts",
      "app/api/couranr/consumer/reconcile-payment/route.ts",
      "app/api/couranr/consumer/refresh-quote/route.ts",
      "app/api/couranr/consumer/request/route.ts",
      "app/api/couranr/consumer/session/route.ts",
      "app/api/couranr/consumer/submit/route.ts",
    ]);
  });

  for (const file of ROUTE_FILES) {
    const src = readFileSync(file, "utf8");
    const code = stripped(src);

    it(`${rel(file)} opts out of the Data Cache`, () => {
      expect(src).toMatch(/export const dynamic = "force-dynamic"/);
    });

    it(`${rel(file)} builds failures only through the shared helpers`, () => {
      expect(/NextResponse\.json\(\s*\{\s*error:/.test(src)).toBe(false);
      expect(/failureResponse|routeFailure/.test(src)).toBe(true);
    });

    it(`${rel(file)} never reads an amount, state, target, policy or route field from the body`, () => {
      // Only the estimate route parses a body AT ALL, and it hands the raw
      // object verbatim to the server lib, whose forbidden-key scan refuses
      // any commercial field before anything else runs. Every other route
      // never calls req.json(), so there is nothing to read amounts from.
      if (rel(file) === "app/api/couranr/consumer/estimate/route.ts") {
        expect((code.match(/req\.json\(\)/g) || []).length).toBe(1);
        expect(code).toMatch(/estimateConsumerSend\(\{ session: session\.value, body \}\)/);
        // The route itself never dereferences the body.
        expect(/\bbody\s*\.\s*[a-zA-Z]/.test(code)).toBe(false);
      } else if (rel(file) === "app/api/couranr/consumer/interpret/route.ts") {
        // INT-002: the description body is handed to the guarded lib.
        expect((code.match(/req\.json\(\)/g) || []).length).toBe(1);
        expect(code).toMatch(/interpretConsumerDescription\(\{ session: session\.value, body \}\)/);
        expect(/\bbody\s*\.\s*[a-zA-Z]/.test(code)).toBe(false);
      } else if (rel(file) === "app/api/couranr/consumer/pickup-manifest/route.ts") {
        // PRF-002: expected pickup has its own narrow, non-commercial body.
        // The guest session supplies request identity; the browser may state
        // only the physical pickup facts plus the manifest CAS token.
        expect((code.match(/req\.json\(\)/g) || []).length).toBe(1);
        expect(code).toContain("normalizePickupManifestInput(body)");
        expect(code).toContain("setConsumerPickupManifest");
        for (const rx of [
          /body\??\.\s*(amount|total|price|subtotal|cents)/i,
          /body\??\.\s*(requestId|businessAccountId|target|policy|route|state|status)/i,
        ]) {
          expect(rx.test(code), `${rel(file)} reads forbidden pickup-manifest data`).toBe(false);
        }
      } else if (rel(file) === "app/api/couranr/consumer/submit/route.ts") {
        /* This route read NO body until the V1 trust contract. It now reads
           exactly two things, and neither is a commercial fact: the sender's own
           declared value, and their two acknowledgements.

           The distinction the original rule was protecting is intact. The server
           still holds every price, state and target; the protection LEVEL is
           derived by the database from the declared value rather than accepted;
           and FORBIDDEN_CONSUMER_KEYS refuses a body reaching for the level, the
           policy version or the consent timestamps.

           An acknowledgement is the one fact the server cannot hold on the
           sender's behalf — it exists only because a person ticked a box, at
           submission rather than at pricing. The route hands the raw object to
           the lib and never dereferences it, the same shape as the estimate
           route above. */
        expect((code.match(/req\.json\(\)/g) || []).length).toBe(1);
        expect(code).toMatch(/submitConsumerSend\(\{ session: session\.value, body \}\)/);
        expect(/\bbody\s*\.\s*[a-zA-Z]/.test(code)).toBe(false);
        for (const rx of [
          /body\??\.\s*(amount|total|price|subtotal|cents)/i,
          /body\??\.\s*(requestId|businessAccountId|target|policy|route|state|status)/i,
          /protectionLevel|protection_level|termsAcceptedAt/i,
        ]) {
          expect(rx.test(code), `${rel(file)} reads a server-owned field`).toBe(false);
        }
      } else if (rel(file) === "app/api/couranr/consumer/readiness/route.ts") {
        // FND-006: this route has one intentionally tiny body vocabulary:
        // { readiness: "ready" | "not_ready" }. It cannot name a request or
        // any commercial/routing fact; the guest session supplies identity.
        expect((code.match(/req\.json\(\)/g) || []).length).toBe(1);
        expect(code).toContain("setConsumerPickupReadiness");
        expect(code).toMatch(/\.readiness/);
        for (const rx of [
          /body\s*\.\s*(amount|total|price|subtotal|cents)/i,
          /body\s*\.\s*(requestId|businessAccountId|target|policy|route)/i,
        ]) {
          expect(rx.test(code), `${rel(file)} reads forbidden readiness payload data`).toBe(false);
        }
      } else {
        expect(/req\.json\(\)|req\.text\(\)|req\.formData\(\)/.test(code)).toBe(false);
      }
      // And no route mentions the funnel-fixed fields at all.
      for (const rx of [/servicelevel/i, /proofmethod/i, /payertype/i, /policyversion/i]) {
        expect(rx.test(code), `${rel(file)} mentions ${rx}`).toBe(false);
      }
    });

    it(`${rel(file)} is guest-gated or mints the session`, () => {
      expect(
        /redeemGuestSessionToken/.test(src) || /createGuestSession/.test(src),
        `${rel(file)} has no gate`
      ).toBe(true);
    });
  }
});

/* --------------------------------------- one engine, no AI for guests ---- */

describe("shipment authority is shared, not copied (PRC-005 / §24)", () => {
  it("the consumer lib prices through the canonical shared pipeline only", () => {
    expect(LIB).toMatch(/from "@\/lib\/couranr\/routing\/canonicalRoute"/);
    expect(LIB).toMatch(/deriveCanonicalRouteAndQuote\(/);
    expect(LIB).toMatch(/evaluateShipmentPolicy\(/);
    expect(LIB).toMatch(/applyShipmentPolicyToQuote\(/);
    // No second pricing engine, no legacy calculator.
    expect(LIB).not.toMatch(/lib\/delivery\/policy/);
    expect(LIB).not.toMatch(/quoteDelivery\(/);
  });

  it("Consumer Smart Intake rides the SHARED substrate through one lib and never a provider adapter (INT-002)", () => {
    // INT-002 superseded the batch-3 "no AI for guests" engineering decision.
    // The consumer send lib reaches intake ONLY through ./intake, and neither
    // consumer file names a provider adapter or vendor SDK directly.
    const code = stripped(LIB);
    expect(code).toMatch(/from "\.\/intake"/);
    expect(code).not.toMatch(/couranr\/intake\//);
    expect(code).not.toMatch(/anthropic/i);
    const intakeLib = stripped(readFileSync(path.join(ROOT, "lib/couranr/consumer/intake.ts"), "utf8"));
    expect(intakeLib).toMatch(/from "@\/lib\/couranr\/intake\/commands"/);
    expect(intakeLib).not.toMatch(/anthropicProvider|@anthropic-ai|resolveSmartIntakeProvider/);
    // The kill switch is the ONE arming key, READ by the lib and by no route
    // (a route may mention it in a comment; comments are stripped here).
    expect(intakeLib).toMatch(/COURANR_CONSUMER_INTAKE/);
    for (const file of ROUTE_FILES) {
      expect(stripped(readFileSync(file, "utf8"))).not.toMatch(/COURANR_CONSUMER_INTAKE/);
    }
  });

  it("service level and proof method are fixed by the funnel", () => {
    expect(LIB).toMatch(/p_service_level: "standard"/);
    expect(LIB).toMatch(/p_proof_method: "photo_or_pin"/);
  });

  it("the guest session TTL stays inside the SQL clamp", () => {
    expect(GUEST_SESSION_TTL_MINUTES).toBeGreaterThanOrEqual(5);
    expect(GUEST_SESSION_TTL_MINUTES).toBeLessThanOrEqual(4320);
    expect(CONSUMER_SEND_IDEMPOTENCY_KEY.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------ forbidden body keys ---- */

describe("findForbiddenConsumerKey", () => {
  it("refuses every amount key, however it is spelled", () => {
    expect(findForbiddenConsumerKey({ totalCents: 799 })).toBe("totalCents");
    expect(findForbiddenConsumerKey({ total_cents: 799 })).toBe("total_cents");
    expect(findForbiddenConsumerKey({ "TOTAL-CENTS": 799 })).toBe("TOTAL-CENTS");
    expect(findForbiddenConsumerKey({ shipment: { amountCents: 1 } })).toBe("amountCents");
    expect(findForbiddenConsumerKey({ deliverySubtotalCents: 0 })).toBe("deliverySubtotalCents");
    expect(findForbiddenConsumerKey({ quoteLineItems: [] })).toBe("quoteLineItems");
  });

  it("refuses state, target, policy and route-evidence keys", () => {
    expect(findForbiddenConsumerKey({ state: "confirmed" })).toBe("state");
    expect(findForbiddenConsumerKey({ requestState: "confirmed" })).toBe("requestState");
    expect(findForbiddenConsumerKey({ paymentState: "captured" })).toBe("paymentState");
    expect(findForbiddenConsumerKey({ quoteStatus: "estimated" })).toBe("quoteStatus");
    expect(findForbiddenConsumerKey({ pricingPolicyVersion: "x" })).toBe("pricingPolicyVersion");
    expect(findForbiddenConsumerKey({ loadedMiles: 1 })).toBe("loadedMiles");
    expect(findForbiddenConsumerKey({ routeDistanceMeters: 1 })).toBe("routeDistanceMeters");
    expect(findForbiddenConsumerKey({ payerType: "merchant" })).toBe("payerType");
    // Nested and inside arrays too.
    expect(findForbiddenConsumerKey({ a: [{ b: { targetState: "x" } }] })).toBe("targetState");
  });

  it("accepts the honest contract body", () => {
    expect(
      findForbiddenConsumerKey({
        pickupPlaceId: "p1",
        dropoffPlaceId: "p2",
        contact: { name: "A", phone: "+15715550100", email: "a@b.co" },
        shipment: {
          description: "books",
          weightLb: 20,
          restrictedClass: "none",
          signatureRequired: false,
          overnightRequested: false,
        },
        timing: { intent: "asap" },
      })
    ).toBeNull();
  });

  it("keeps every key list entry canonical (lower-case, no separators)", () => {
    for (const key of FORBIDDEN_CONSUMER_KEYS) {
      expect(key).toMatch(/^[a-z]+$/);
    }
  });
});

/* --------------------------------------------------- body validation ----- */

describe("validateConsumerSendBody", () => {
  /* The full contract body. Every assertion below spreads this and overrides
     ONE thing, so a test about weight is not silently answered by the email
     gate — the new trust fields are checked before the shipment fields, and an
     under-specified fixture would make each of these tests report the first
     missing field instead of its own subject. */
  const valid = {
    pickupPlaceId: "p1",
    dropoffPlaceId: "p2",
    // V1 requires the sender's NAME: the terms they accept say "I am authorized
    // to send these items", and an acceptance signed by nobody is weak evidence.
    contact: { name: "Alex Chen", phone: "+15715550100", email: "sender@example.test" },
    recipient: { name: "Dana Reyes", email: "recipient@example.test" },
    // $20.00 — inside the standard band on purpose, so these pre-existing
    // assertions keep testing what they were written to test.
    declaredValueCents: 2_000,
    acceptance: { shipmentCertification: true, electronicTransactions: true },
    shipment: { weightLb: 20, restrictedClass: "none" },
  };

  it("accepts the contract body and fixes nothing silently", () => {
    const r = validateConsumerSendBody(valid);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.shipment.weightLb).toBe(20);
      expect(r.value.shipment.restrictedClass).toBe("none");
      expect(r.value.contact.phone).toBe("+15715550100");
    }
  });

  it("refuses a body carrying any forbidden field outright", () => {
    const r = validateConsumerSendBody({ ...valid, totalCents: 1 });
    expect(r.ok).toBe(false);
    if (isConsumerSendBodyFailure(r)) expect(r.reason).toBe("forbidden_field");
  });

  it("SUR-001: refuses zero weight and a body that says nothing about weight", () => {
    expect(
      validateConsumerSendBody({ ...valid, shipment: { weightLb: 0, restrictedClass: "none" } }).ok
    ).toBe(false);
    expect(
      validateConsumerSendBody({ ...valid, shipment: { restrictedClass: "none" } }).ok
    ).toBe(false);
    // A governed band IS an honest statement.
    expect(
      validateConsumerSendBody({
        ...valid,
        shipment: { weightBand: "0_25_lb", restrictedClass: "none" },
      }).ok
    ).toBe(true);
  });

  it("DIRECT SAME DAY V1: requires the sender's prohibited-item declaration", () => {
    for (const shipment of [
      { weightLb: 5 },
      { weightLb: 5, restrictedClass: "unknown" },
      { weightLb: 5, restrictedClass: "" },
    ]) {
      const r = validateConsumerSendBody({ ...valid, shipment });
      expect(r.ok).toBe(false);
      if (isConsumerSendBodyFailure(r)) {
        expect(r.reason).toBe("safety_declaration_required");
      }
    }

    // The server accepts an explicit sender declaration, including a specific
    // governed restricted class. Policy — not this parser — decides whether a
    // declared class is carryable.
    expect(
      validateConsumerSendBody({
        ...valid,
        shipment: { weightLb: 5, restrictedClass: "none" },
      }).ok
    ).toBe(true);
    expect(
      validateConsumerSendBody({
        ...valid,
        shipment: { weightLb: 5, restrictedClass: "alcohol" },
      }).ok
    ).toBe(true);
  });

  it("an unrecognized declaration or band is an error, never coerced", () => {
    expect(
      validateConsumerSendBody({
        ...valid,
        shipment: { weightLb: 5, restrictedClass: "mystery" },
      }).ok
    ).toBe(false);
    expect(
      validateConsumerSendBody({
        ...valid,
        shipment: { weightBand: "about_a_horse", restrictedClass: "none" },
      }).ok
    ).toBe(false);
  });

  it("refuses a malformed contact email", () => {
    expect(
      validateConsumerSendBody({ ...valid, contact: { email: "not-an-email" } }).ok
    ).toBe(false);
  });

  it("requires both place identities", () => {
    expect(validateConsumerSendBody({ ...valid, pickupPlaceId: "" }).ok).toBe(false);
    expect(validateConsumerSendBody({ ...valid, dropoffPlaceId: undefined }).ok).toBe(false);
  });

  it("TMZ-001: timing defaults to ASAP; a scheduled pickup carries parseable Eastern local words", () => {
    const asap = validateConsumerSendBody(valid);
    expect(asap.ok).toBe(true);
    if (asap.ok) expect(asap.value.timing).toEqual({ intent: "asap", requestedPickupLocal: null });

    const sched = validateConsumerSendBody({
      ...valid,
      timing: { intent: "scheduled", requestedPickupLocal: "2027-03-10T10:30" },
    });
    expect(sched.ok).toBe(true);
    if (sched.ok) {
      expect(sched.value.timing).toEqual({ intent: "scheduled", requestedPickupLocal: "2027-03-10T10:30" });
    }
    // ASAP never carries a time, even if one is sent.
    const asapWithTime = validateConsumerSendBody({
      ...valid,
      timing: { intent: "asap", requestedPickupLocal: "2027-03-10T10:30" },
    });
    expect(asapWithTime.ok).toBe(true);
    if (asapWithTime.ok) expect(asapWithTime.value.timing.requestedPickupLocal).toBeNull();
  });

  it("refuses an unknown intent, and a scheduled pickup without valid local words", () => {
    const r1 = validateConsumerSendBody({ ...valid, timing: { intent: "whenever" } });
    expect(r1.ok).toBe(false);
    if (isConsumerSendBodyFailure(r1)) expect(r1.reason).toBe("timing_intent_invalid");
    for (const bad of [undefined, "", "soon", "2027-03-10T10:30Z", "2027-02-30T10:00"]) {
      const r = validateConsumerSendBody({ ...valid, timing: { intent: "scheduled", requestedPickupLocal: bad } });
      expect(r.ok, `local=${String(bad)}`).toBe(false);
      if (isConsumerSendBodyFailure(r)) expect(r.reason).toBe("requested_time_invalid");
    }
  });

  it("the consumer lib no longer hardcodes an ASAP intent anywhere on the estimate or refresh path", () => {
    expect(stripped(LIB)).not.toMatch(/timingIntent:\s*"asap"/);
    // Refresh re-prices the STORED statement, as the business refresh does.
    expect(LIB).toMatch(/row\.timing_intent === "scheduled" \? "scheduled" : "asap"/);
  });

  /* ---------------------------------------- V1 trust contract (new) ------ */

  /* Every refusal below is attempted ON PURPOSE. A validation reason nobody
     violates deliberately is a reason nobody knows fires — stage 2 shipped four
     CHECK constraints written and never once violated, and this is the same
     failure one layer up. Each case overrides exactly ONE field of `valid`, so
     the reason it asserts is the reason it caused. */
  const reasonFor = (body: unknown): string => {
    const r = validateConsumerSendBody(body);
    expect(r.ok, `expected a refusal, got acceptance`).toBe(false);
    return isConsumerSendBodyFailure(r) ? r.reason : "<accepted>";
  };

  it("EMAIL-FIRST: a sender phone cannot stand in for a sender email", () => {
    const { email, ...noEmail } = valid.contact as Record<string, unknown>;
    expect(reasonFor({ ...valid, contact: noEmail })).toBe("sender_email_required");
    expect(reasonFor({ ...valid, contact: { phone: "+15715550100" } })).toBe(
      "sender_email_required"
    );
    // A malformed one is refused as malformed, not as missing.
    expect(reasonFor({ ...valid, contact: { ...valid.contact, email: "dana@" } })).toBe(
      "contact_email_invalid"
    );
  });

  it("requires a recipient identity — the field every consumer send lacked", () => {
    expect(reasonFor({ ...valid, recipient: undefined })).toBe("recipient_name_required");
    expect(reasonFor({ ...valid, recipient: { email: "r@example.test" } })).toBe(
      "recipient_name_required"
    );
    expect(reasonFor({ ...valid, recipient: { name: "Dana Reyes" } })).toBe(
      "recipient_email_required"
    );
    // A recipient phone does not satisfy the recipient email rule either.
    expect(
      reasonFor({ ...valid, recipient: { name: "Dana Reyes", phone: "+15715550101" } })
    ).toBe("recipient_email_required");
    expect(
      reasonFor({ ...valid, recipient: { name: "Dana Reyes", email: "not-an-email" } })
    ).toBe("recipient_email_invalid");
  });

  it("refuses an unreadable declared value rather than treating it as $0", () => {
    /* The dangerous coercion: `Number(undefined)` is NaN and `Number(null)` is
       0. If this validator coerced, a body that simply omitted the value would
       be accepted as a $0.00 shipment and routed onto the standard path with no
       prepack photo and no seal — while carrying a $500 item. */
    for (const bad of [undefined, null, "2000", Number.NaN, 12.5, -1, {}, [], true]) {
      expect(reasonFor({ ...valid, declaredValueCents: bad }), `${JSON.stringify(bad)}`).toBe(
        "declared_value_invalid"
      );
    }
  });

  it("declines above the $500 ceiling with its own distinct reason", () => {
    // Distinct from `declared_value_invalid` because the sender must be told
    // the ceiling, not that their number was unreadable.
    expect(reasonFor({ ...valid, declaredValueCents: 50_001 })).toBe(
      "declared_value_above_maximum"
    );
    /* $500 IS NO LONGER ACCEPTED, and the reason is not the ceiling. It derives
       to protected_handoff, which cannot be sold while Stripe Identity is
       inactive, so it is refused as CURRENTLY UNAVAILABLE. Calling it "above
       the maximum" would be false — $500 is exactly the maximum — and would
       make a temporary commercial limit indistinguishable from a policy breach
       in a log. The policy ceiling itself is unchanged. */
    expect(reasonFor({ ...valid, declaredValueCents: 50_000 })).toBe(
      "protection_level_unavailable"
    );
    expect(validateConsumerSendBody({ ...valid, declaredValueCents: 15_000 }).ok).toBe(true);
    expect(validateConsumerSendBody({ ...valid, declaredValueCents: 0 }).ok).toBe(true);
  });

  it("parses the acknowledgements but does NOT require them to price", () => {
    /* This validator serves estimateConsumerSend, which creates a DRAFT. The
       database exempts drafts from couranr_dr_consumer_acceptance_chk for the
       same reason: a draft is a statement not yet made. requireAcceptance is
       the submit-time gate — see the block below. */
    for (const acceptance of [undefined, {}, { shipmentCertification: false }]) {
      const r = validateConsumerSendBody({ ...valid, acceptance });
      expect(r.ok, `acceptance ${JSON.stringify(acceptance)} blocked pricing`).toBe(true);
      if (r.ok) expect(r.value.acceptance.shipmentCertification).toBe(false);
    }
    const r = validateConsumerSendBody(valid);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.acceptance).toEqual({
        shipmentCertification: true,
        electronicTransactions: true,
      });
    }
  });

  it("refuses a body reaching for a SERVER-DERIVED protection field", () => {
    /* The client states a value. It never states the level, the policy version,
       or the moment it consented. These are refused outright rather than
       ignored: ignoring is silent, and a later refactor that spread the body
       into the RPC parameters would turn a silent ignore into a live hole. */
    for (const key of [
      "protectionLevel",
      "protectionPolicyVersion",
      "senderTermsVersion",
      "senderTermsAcceptedAt",
      "senderElectronicConsentAt",
      "senderAdultAttestedAt",
      "recipientAdultAttestedAt",
    ]) {
      expect(reasonFor({ ...valid, [key]: "x" }), `${key} was not refused`).toBe(
        "forbidden_field"
      );
      // And nested, because a real payload nests.
      expect(
        reasonFor({ ...valid, shipment: { ...valid.shipment, [key]: "x" } }),
        `nested ${key} was not refused`
      ).toBe("forbidden_field");
    }
  });

  it("requires the SENDER'S NAME, not just an address to reach them", () => {
    /* The certification the sender accepts says "I am authorized to send these
       items". An acceptance signed by nobody is weak evidence of precisely the
       thing a claim turns on, so V1 requires the name. Phone stays optional. */
    const { name, ...noName } = valid.contact as Record<string, unknown>;
    expect(reasonFor({ ...valid, contact: noName })).toBe("sender_name_required");
    expect(reasonFor({ ...valid, contact: { ...valid.contact, name: "   " } })).toBe(
      "sender_name_required"
    );
    // A phone still is not required.
    const { phone, ...noPhone } = valid.contact as Record<string, unknown>;
    expect(validateConsumerSendBody({ ...valid, contact: noPhone }).ok).toBe(true);
  });

  it("does NOT forbid declaredValueCents — it is the one input the sender states", () => {
    // The guard on the guard: if a future edit added `declaredvaluecents` to the
    // list, every legitimate send would fail closed with `forbidden_field` and
    // the tests above would still pass, because they all assert refusals.
    expect(findForbiddenConsumerKey({ declaredValueCents: 2_000 })).toBeNull();
    expect(validateConsumerSendBody(valid).ok).toBe(true);
  });

  it("carries the new fields through to the value, normalized and unchanged", () => {
    const r = validateConsumerSendBody({
      ...valid,
      recipient: { name: "  Dana Reyes  ", email: "recipient@example.test", phone: null },
      /* $150.00, not $150.01. This test is about RECIPIENT NORMALIZATION; a
         value one cent higher now derives to an unavailable tier and the body
         is refused, so the fixture would answer a question about declared value
         instead of the one it was written to ask. The file's own header warns
         about exactly this. */
      declaredValueCents: 15_000,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.recipient.name).toBe("Dana Reyes");
      expect(r.value.recipient.email).toBe("recipient@example.test");
      expect(r.value.recipient.phone).toBeNull();
      expect(r.value.contact.email).toBe("sender@example.test");
      // Passed through EXACTLY. The level is derived from it on the server and
      // re-derived by the database; the validator must not round or rescale it.
      expect(r.value.declaredValueCents).toBe(15_000);
      expect(r.value.acceptance).toEqual({
        shipmentCertification: true,
        electronicTransactions: true,
      });
    }
  });

});

/* -------------------------------------------------------- SQL posture ---- */

describe("the consumer migration keeps the security posture", () => {
  const sql = MIGRATION.replace(/^\s*--.*$/gm, "");

  it("every new command is revoked from the browser roles and granted to service_role only", () => {
    for (const fn of [
      "couranr_create_consumer_guest_session",
      "couranr_redeem_consumer_guest_session",
      "couranr_bind_consumer_guest_request",
      "couranr_create_consumer_delivery_request_draft",
      "couranr_calculate_consumer_delivery_request_estimate",
      "couranr_submit_consumer_delivery_request",
    ]) {
      expect(sql).toMatch(
        new RegExp(`revoke all on function public\\.${fn}\\([\\s\\S]*?from public, anon, authenticated, service_role`)
      );
      expect(sql).toMatch(
        new RegExp(`grant execute on function public\\.${fn}\\([\\s\\S]*?to service_role`)
      );
    }
  });

  it("the guest table gets RLS, zero policies, and revoke-then-grant", () => {
    expect(sql).toMatch(/couranr_consumer_guest_sessions enable row level security/);
    expect(sql).toMatch(
      /revoke all on public\.couranr_consumer_guest_sessions from public, anon, authenticated/
    );
    expect(sql).toMatch(/revoke all on public\.couranr_consumer_guest_sessions from service_role/);
    expect(sql).toMatch(
      /grant select, insert, update on public\.couranr_consumer_guest_sessions to service_role/
    );
    expect(sql).not.toMatch(/create policy[\s\S]*couranr_consumer_guest_sessions/i);
  });

  it("STRICT arity: the consumer commands declare no parameter defaults", () => {
    for (const fn of [
      "couranr_create_consumer_delivery_request_draft",
      "couranr_calculate_consumer_delivery_request_estimate",
      "couranr_submit_consumer_delivery_request",
    ]) {
      const m = sql.match(
        new RegExp(`create or replace function public\\.${fn}\\(([\\s\\S]*?)\\)\\s*returns`)
      );
      expect(m, `${fn} signature not found`).not.toBeNull();
      expect(m![1].toLowerCase()).not.toContain("default");
    }
  });

  it("every consumer command is SECURITY INVOKER with an empty search_path", () => {
    const bodies = sql.match(/security invoker/gi) || [];
    expect(bodies.length).toBeGreaterThanOrEqual(6);
    expect((sql.match(/set search_path\s*=\s*''/gi) || []).length).toBeGreaterThanOrEqual(6);
    expect(sql).not.toMatch(/security definer/i);
  });

  it("the consumer commands reuse the shared private guards, never fork them", () => {
    expect(sql).toMatch(/perform private\.couranr_assert_safety_declaration/);
    expect(sql).toMatch(/perform private\.couranr_assert_requested_timing/);
    expect(sql).toMatch(/private\.couranr_append_routed_quote_version\(/);
    // The guards are not re-defined here.
    expect(sql).not.toMatch(/create or replace function private\.couranr_assert_safety_declaration/);
    expect(sql).not.toMatch(/create or replace function private\.couranr_append_routed_quote_version/);
  });

  it("payer and source are hardcoded — no payer parameter exists (PAY-001)", () => {
    expect(sql).not.toMatch(/p_payer_type/);
    expect(sql).not.toMatch(/p_source/);
    expect(sql).toMatch(/'consumer_send','not_confirmed','customer'/);
  });

  it("the tracking relaxation is the additive DROP NOT NULL, nothing more", () => {
    expect(sql).toMatch(
      /alter table public\.couranr_delivery_access_tokens\s+alter column business_account_id drop not null/
    );
    expect(sql).not.toMatch(/drop\s+(table|column)\s/i);
  });
});

/* ------------------------ restricted-signal parity (review item 1) ------- */

import { scanRestrictedSignals } from "@/lib/couranr/shipment/restrictedSignals";
import { evaluateShipmentPolicy } from "@/lib/couranr/shipment/policy";
import { factsFromDraft } from "@/lib/couranr/shipment/draftFacts";
import { applyShipmentPolicyToQuote } from "@/lib/couranr/shipment/quoteStatus";
import type { QuoteResult } from "@/lib/couranr/pricing/types";

/**
 * The consumer's free-text item description runs through the SAME
 * deterministic scanner the Smart Intake path uses, as ESCALATION-ONLY
 * evidence into the SAME policy engine. These execute the real scanner and
 * the real engine — nothing is mocked — over exactly the path
 * estimateConsumerSend composes: scanRestrictedSignals(description) →
 * evaluateShipmentPolicy(factsFromDraft(structured), { textSignals }) →
 * applyShipmentPolicyToQuote.
 */
describe("consumer restricted-signal parity (review item 1)", () => {
  const PRICED: QuoteResult = {
    quoteStatus: "estimated",
    deliverySubtotalCents: 1234,
    lineItems: [{ code: "base", label: "Base", amountCents: 1234 }],
    reviewReasons: [],
    validationErrors: [],
  } as unknown as QuoteResult;

  function consumerPolicyFor(description: string, restrictedClass: string) {
    const textSignals = scanRestrictedSignals(description);
    return evaluateShipmentPolicy(
      factsFromDraft({
        weightLb: 10,
        weightBand: null,
        restrictedClass,
        serviceLevel: "standard",
        timingIntent: "asap",
        requestedPickupLocal: null,
      } as any),
      { textSignals }
    );
  }

  it("'12 bottles of beer' declared 'none' -> needs_review, no payable quote", () => {
    const policy = consumerPolicyFor("12 bottles of beer", "none");
    expect(policy.disposition).toBe("needs_review");
    expect(policy.riskSignals).toContain("restricted_signal_conflicts_declaration");
    const quote = applyShipmentPolicyToQuote(PRICED, policy);
    expect(quote.quoteStatus).toBe("manual_review_required");
    expect(quote.deliverySubtotalCents).toBe(0);
    expect(quote.lineItems).toEqual([]);
  });

  it("'box of 9mm ammunition' declared 'none' -> needs_review", () => {
    const policy = consumerPolicyFor("box of 9mm ammunition", "none");
    expect(policy.disposition).toBe("needs_review");
    expect(policy.riskSignals).toContain("restricted_signal_conflicts_declaration");
    expect(applyShipmentPolicyToQuote(PRICED, policy).quoteStatus).toBe("manual_review_required");
  });

  for (const benign of [
    "alcohol-free cleaning solution",
    "toy gun",
    "gunmetal lamp",
    "battery-powered drill",
    "ordinary laptop",
  ]) {
    it(`'${benign}' declared 'none' stays allowed — text can never hard-prohibit`, () => {
      const policy = consumerPolicyFor(benign, "none");
      expect(policy.disposition).toBe("allowed");
      expect(applyShipmentPolicyToQuote(PRICED, policy).quoteStatus).toBe("estimated");
    });
  }

  it("a consumer-confirmed prohibited class is deterministic prohibited regardless of text", () => {
    const policy = consumerPolicyFor("just some stuff", "firearms");
    expect(policy.disposition).toBe("prohibited");
    expect(applyShipmentPolicyToQuote(PRICED, policy).quoteStatus).toBe("invalid");
  });

  it("text signals ESCALATE only: even 'beer' plus a prohibited declaration never upgrades past the declaration's own verdict", () => {
    // The declaration alone already decides 'prohibited'; the signal adds
    // nothing and must not change the mechanism.
    const withText = consumerPolicyFor("12 bottles of beer", "alcohol");
    const withoutText = consumerPolicyFor("", "alcohol");
    expect(withText.disposition).toBe(withoutText.disposition);
  });

  it("estimateConsumerSend actually wires the scan into the policy call", () => {
    const code = stripped(LIB);
    expect(code).toMatch(/scanRestrictedSignals\(body\.shipment\.description \?\? ""\)/);
    expect(code).toMatch(/evaluateShipmentPolicy\([\s\S]{0,400}\{ textSignals \}/);
  });
});


/* =========================================================================
 * A — SENDER AND RECIPIENT ARE DIFFERENT CAPABILITIES
 * ====================================================================== */

describe("the sender is never handed the recipient's token", () => {
  const SEND_LIB = readFileSync(path.join(ROOT, "lib/couranr/consumer/send.ts"), "utf8");
  const code = stripped(SEND_LIB);

  it("assigns no raw token onto the sender's view", () => {
    /* The finding: `view.trackingToken = rawToken` returned the SAME token that
       had just been emailed to the recipient. Its audience is `recipient` and
       it authorizes the adult attestation, identity verification and the
       handoff PIN — so the sender held all three, and so did anyone they
       forwarded their screen to.

       Asserted against the source because the alternative is an integration
       test that has to stand up email, and the property is simple: nothing
       assigns a raw token into the object returned to the sender. */
    /* Matches ANY property assignment of the raw token, including through a
       cast. The first version of this test looked for `view.trackingToken =`
       and a negative control writing `(view as any).trackingToken = rawToken`
       walked straight past it — a guard narrow enough to name the old line is a
       guard the next regression is free to route around. */
    expect(/\.\w+\s*=\s*rawToken\b/.test(code), "a raw token is assigned onto an object").toBe(
      false
    );
    // And no object literal carries it as a property value either.
    expect(/\b\w*[Tt]oken\s*:\s*rawToken\b/.test(code)).toBe(false);
  });

  it("keeps no token field on the sender view type at all", () => {
    // A field that exists is a field something will eventually populate.
    const raw = SEND_LIB.slice(
      SEND_LIB.indexOf("export type ConsumerSendView = {"),
      SEND_LIB.indexOf("};", SEND_LIB.indexOf("export type ConsumerSendView = {"))
    );
    /* COMMENTS STRIPPED. The doc comment on this type explains that the sender
       is never given the recipient's TOKEN, so an un-stripped match fails on the
       explanation rather than on a field — the same way a migration test once
       "passed" by matching the sentence describing the rule instead of the
       rule. Only declarations can leak a value. */
    const type = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(type).not.toMatch(/token/i);
    // What the sender legitimately gets instead: the fact, and the address.
    expect(type).toContain("recipientNotifiedAt");
    expect(type).toContain("recipientNotifiedTo");
  });

  /*
   * The capability moved TWICE now. First the raw token stopped being returned
   * to the sender; then the send itself left this module entirely, because a
   * GET projection is the wrong owner for an irreversible side effect — a
   * provider blip surfaced as a failed status-page load, and a sender who
   * closed the tab meant the recipient was never emailed.
   *
   * So the assertion is no longer "this file still sends". It is: this file
   * sends NOTHING, and the module that does still puts the raw token in the
   * tracking URL rather than anywhere a sender can see.
   */
  it("still emails the recipient — the capability moved to the lifecycle, it did not vanish", () => {
    const lifecycle = stripped(
      readFileSync(path.join(ROOT, "lib/couranr/email/consumerLifecycle.ts"), "utf8")
    );
    expect(code).not.toContain("sendRenderedEmail");
    expect(lifecycle).toContain("sendRenderedEmail");
    expect(lifecycle).toMatch(/trackUrl[\s\S]{0,80}rawToken/);
  });
});

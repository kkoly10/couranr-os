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
  it("holds exactly the ten contracted routes", () => {
    expect(ROUTE_FILES.map(rel)).toEqual([
      "app/api/couranr/consumer/estimate/route.ts",
      "app/api/couranr/consumer/interpret/route.ts",
      "app/api/couranr/consumer/pay/route.ts",
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
  const valid = {
    pickupPlaceId: "p1",
    dropoffPlaceId: "p2",
    contact: { phone: "+15715550100" },
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

  it("an absent safety declaration means unknown — review, never a default 'none'", () => {
    const r = validateConsumerSendBody({ ...valid, shipment: { weightLb: 5 } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.shipment.restrictedClass).toBe("unknown");
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

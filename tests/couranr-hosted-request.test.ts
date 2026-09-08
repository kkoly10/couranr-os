import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  findForbiddenHostedKey,
  hostedRestrictedClassTransitionAllowed,
  isHostedBodyFailure,
  validateHostedSubmitBody,
  validateMerchantHostedConfirmation,
} from "@/lib/couranr/hosted/commands";
import { HOSTED_REQUEST_ROUTE_EXISTS } from "@/lib/couranr/settings/websiteTools";

const ROOT = path.resolve(__dirname, "..");
const HOSTED_SQL = readFileSync(
  path.join(ROOT, "supabase/migrations/20260905040000_couranr_hosted_request_v1.sql"),
  "utf8"
);
const MAPBOX_SQL = readFileSync(
  path.join(ROOT, "supabase/migrations/20260905030000_couranr_mapbox_quote_mint_authority_fix.sql"),
  "utf8"
);
const HOSTED_CLOSURE_SQL = readFileSync(
  path.join(ROOT, "supabase/migrations/20260905065000_couranr_hosted_adversarial_closure.sql"),
  "utf8"
);
const HOSTED_CHAT_SQL = readFileSync(
  path.join(ROOT, "supabase/migrations/20260905065500_couranr_hosted_delivery_chat_scope.sql"),
  "utf8"
);
const HOSTED_HELP_SQL = readFileSync(
  path.join(ROOT, "supabase/migrations/20260905070000_couranr_hosted_delivery_help_scope.sql"),
  "utf8"
);
const HOSTED_TRACKING_SQL = readFileSync(
  path.join(ROOT, "supabase/migrations/20260905070500_couranr_hosted_tracking_relationship_scope.sql"),
  "utf8"
);
const HOSTED_RATE_SQL = readFileSync(
  path.join(ROOT, "supabase/migrations/20260905071000_couranr_hosted_request_rate_limits.sql"),
  "utf8"
);
const HOSTED_TIMING_SQL = readFileSync(
  path.join(ROOT, "supabase/migrations/20260908220000_couranr_hosted_scheduled_timing.sql"),
  "utf8"
);
const HOSTED_TIMING_FENCE_SQL = readFileSync(
  path.join(ROOT, "supabase/migrations/20260908230000_couranr_hosted_legacy_arity_fence.sql"),
  "utf8"
);
const HOSTED_TIMING_GUARD_SQL = readFileSync(
  path.join(ROOT, "supabase/migrations/20260908220500_couranr_hosted_legacy_validate_guard.sql"),
  "utf8"
);
const HOSTED_FENCE_ROLLBACK_SQL = readFileSync(
  path.join(ROOT, "supabase/rollbacks/20260908230000_couranr_hosted_legacy_arity_fence.rollback.sql"),
  "utf8"
);
const HOSTED_TIMING_ROLLBACK_SQL = readFileSync(
  path.join(ROOT, "supabase/rollbacks/20260908220000_couranr_hosted_scheduled_timing.rollback.sql"),
  "utf8"
);
const HOSTED_SUBMIT_ROUTE = readFileSync(
  path.join(ROOT, "app/api/couranr/hosted/[merchantSlug]/submit/route.ts"),
  "utf8"
);
const VALIDATE_HOSTED_ROUTE = readFileSync(
  path.join(ROOT, "app/api/couranr/delivery-requests/[id]/validate-hosted/route.ts"),
  "utf8"
);
const HOSTED_PLACES_ROUTE = readFileSync(
  path.join(ROOT, "app/api/couranr/hosted/[merchantSlug]/places/route.ts"),
  "utf8"
);
const ERRORS = readFileSync(
  path.join(ROOT, "lib/couranr/errors.ts"),
  "utf8"
);
const HOSTED_COMMANDS = readFileSync(
  path.join(ROOT, "lib/couranr/hosted/commands.ts"),
  "utf8"
);
const AUTHORIZE_PAYMENT_ROUTE = readFileSync(
  path.join(ROOT, "app/api/couranr/delivery-requests/[id]/authorize-payment/route.ts"),
  "utf8"
);
const PAYMENT_LINK_ROUTE = readFileSync(
  path.join(ROOT, "app/api/couranr/delivery-requests/[id]/payment-link/route.ts"),
  "utf8"
);
const DISPATCH_COMMANDS = readFileSync(
  path.join(ROOT, "lib/couranr/dispatch/commands.ts"),
  "utf8"
);
const MERCHANT_PICKUP_ROUTE = readFileSync(
  path.join(ROOT, "app/api/couranr/merchant/deliveries/[id]/pickup-code/route.ts"),
  "utf8"
);
const MERCHANT_RECIPIENT_ROUTE = readFileSync(
  path.join(ROOT, "app/api/couranr/merchant/deliveries/[id]/recipient-code/route.ts"),
  "utf8"
);
const MERCHANT_PROOF_ROUTE = readFileSync(
  path.join(ROOT, "app/api/couranr/merchant/deliveries/[id]/proof/route.ts"),
  "utf8"
);
const HOSTED_ROUTE = path.join(
  ROOT,
  "app/(couranr)/(public)/(consumer-public)/request/[merchantSlug]/page.tsx"
);

function customerBody(overrides: Record<string, unknown> = {}) {
  return {
    orderReference: "ORDER-42",
    requestedPayer: "customer",
    destinationPlaceId: "place-customer-destination",
    destinationLabel: "100 Main St, Stafford, VA",
    recipient: {
      name: "Customer",
      phone: "555-555-0100",
      email: null,
    },
    shipment: {
      description: "One boxed lamp",
      weightBand: "0_25_lb",
      restrictedClass: "none",
      signatureRequired: false,
    },
    ...overrides,
  };
}

describe("merchant-hosted request public input", () => {
  it("keeps host, money, route and state authority out of the customer body", () => {
    for (const key of [
      "businessAccountId",
      "hostBusinessAccountId",
      "payerType",
      "price",
      "totalCents",
      "requestState",
      "pricingPolicyVersion",
      "routeDistanceMeters",
      "latitude",
      "pickupAddress",
    ]) {
      expect(findForbiddenHostedKey({ nested: { [key]: "attacker-value" } }), key).toBe(key);
    }
  });

  it("allows a requested payer preference but never a payerType authority field", () => {
    const requested = validateHostedSubmitBody(customerBody());
    expect(requested.ok).toBe(true);
    if (requested.ok) expect(requested.value.requestedPayer).toBe("customer");

    const authoritative = validateHostedSubmitBody(
      customerBody({ payerType: "merchant" })
    );
    expect(isHostedBodyFailure(authoritative)).toBe(true);
    if (isHostedBodyFailure(authoritative)) {
      expect(authoritative.reason).toBe("forbidden_field");
    }
  });

  it("requires a selected destination, contact and truthful weight knowledge", () => {
    for (const body of [
      customerBody({ destinationPlaceId: "" }),
      customerBody({ recipient: { name: "Customer", phone: "", email: "" } }),
      customerBody({ shipment: { description: "Box", restrictedClass: "none" } }),
    ]) {
      expect(validateHostedSubmitBody(body).ok).toBe(false);
    }
  });

  it("requires a concise physical pickup description without silently truncating it", () => {
    expect(
      validateHostedSubmitBody(
        customerBody({ shipment: { description: "", weightBand: "0_25_lb", restrictedClass: "none" } })
      ).ok
    ).toBe(false);
    const long = validateHostedSubmitBody(
      customerBody({
        shipment: {
          description: "x".repeat(1001),
          weightBand: "0_25_lb",
          restrictedClass: "none",
        },
      })
    );
    expect(long.ok).toBe(false);
    if (isHostedBodyFailure(long)) expect(long.reason).toBe("shipment_description_too_long");
  });

  it("merchant validation requires final payer, weight knowledge and safety declaration", () => {
    expect(
      validateMerchantHostedConfirmation({
        payerType: "customer",
        weightBand: "0_25_lb",
        restrictedClass: "none",
        signatureRequired: false,
        pickupDescription: "One boxed lamp",
        pickupPackageCount: 1,
        pickupOrderReference: "ORDER-7",
        pickupHandlingNotes: null,
      }).ok
    ).toBe(true);
    expect(
      validateMerchantHostedConfirmation({
        payerType: "customer",
        weightBand: "0_25_lb",
        restrictedClass: "alcohol",
        signatureRequired: false,
        pickupDescription: "One sealed case",
        pickupPackageCount: 1,
        pickupOrderReference: null,
        pickupHandlingNotes: null,
      }).ok
    ).toBe(true);

    for (const bad of [
      { payerType: "customer", weightBand: "0_25_lb", restrictedClass: "invented" },
      { payerType: "customer", restrictedClass: "none" },
      { payerType: "someone_else", weightBand: "0_25_lb", restrictedClass: "none" },
    ]) {
      expect(validateMerchantHostedConfirmation(bad).ok).toBe(false);
    }
  });
  it("never lets merchant validation downgrade specific customer safety evidence", () => {
    expect(hostedRestrictedClassTransitionAllowed("alcohol", "alcohol")).toBe(true);
    expect(hostedRestrictedClassTransitionAllowed("alcohol", "unknown")).toBe(true);
    expect(hostedRestrictedClassTransitionAllowed("alcohol", "none")).toBe(false);
    expect(hostedRestrictedClassTransitionAllowed("alcohol", "firearms")).toBe(false);

    // A non-specific customer declaration can still be truthfully validated by
    // the merchant in either direction.
    expect(hostedRestrictedClassTransitionAllowed("unknown", "none")).toBe(true);
    expect(hostedRestrictedClassTransitionAllowed("none", "alcohol")).toBe(true);
  });
});

describe("hosted request authority is separate from requester ownership", () => {
  it("creates the customer request as Consumer-owned with a NULL business tenant", () => {
    expect(HOSTED_SQL).toContain("'consumer',null,null");
    expect(HOSTED_SQL).toContain("'hosted_request','not_confirmed'");
    expect(HOSTED_SQL).toContain("'awaiting_merchant_confirmation'");
    expect(HOSTED_SQL).toContain("host_business_account_id");
    expect(HOSTED_SQL).toContain("hosted_intake_identity_is_immutable");
  });

  it("does not quote or create payment during customer submit", () => {
    const start = HOSTED_SQL.indexOf(
      "create function public.couranr_create_hosted_delivery_request("
    );
    const end = HOSTED_SQL.indexOf(
      "create function public.couranr_validate_hosted_delivery_request(",
      start
    );
    const submitFunction = HOSTED_SQL.slice(start, end);
    expect(submitFunction).not.toContain("couranr_append_routed_quote_version");
    expect(submitFunction).not.toContain("couranr_create_payment_obligation");
    expect(submitFunction).not.toContain("payment_intent");
    expect(submitFunction).toContain("'paymentAllowed',false");
    expect(submitFunction).toContain("'create_hosted_delivery_request'");
    expect(submitFunction).toContain("'awaiting_merchant_confirmation'");
    expect(submitFunction).not.toContain("'create_delivery_request_draft'");
  });

  it("merchant validation is CAS-bound and mints through the canonical immutable quote appender", () => {
    const start = HOSTED_SQL.indexOf(
      "create function public.couranr_validate_hosted_delivery_request("
    );
    const end = HOSTED_SQL.indexOf(
      "create function private.couranr_apply_hosted_merchant_readiness(",
      start
    );
    const validation = HOSTED_SQL.slice(start, end);
    expect(validation).toContain("p_expected_version integer");
    expect(validation).toContain("version is distinct from p_expected_version");
    expect(validation).toContain("current_quote_version_id is not null");
    expect(validation).toContain("private.couranr_append_routed_quote_version(");
    expect(validation).toContain("'merchantValidated',true");
    expect(validation).toContain("'validate_hosted_delivery_request'");
    expect(validation).toContain("'pending_couranr_review'");
    expect(validation).not.toContain("'merchant','submit_delivery_request'");
  });

  it("makes Consumer review ordering source-aware without changing Same Day CAP-001", () => {
    expect(HOSTED_SQL).toContain(
      "v_req.requester_kind='consumer' and v_req.source='consumer_send'"
    );
    expect(HOSTED_SQL).toContain(
      "v_req.requester_kind='consumer' and v_req.source='hosted_request'"
    );
    expect(HOSTED_SQL).toContain("v_target:='awaiting_quote_acceptance'");
  });

  it("records host readiness as a merchant action with the real actor", () => {
    const start = HOSTED_SQL.indexOf(
      "create function private.couranr_apply_hosted_merchant_readiness("
    );
    const readiness = HOSTED_SQL.slice(start);
    expect(readiness).toContain("p_actor_user_id,'merchant',p_command");
    expect(readiness).toContain("hostBusinessAccountId");
  });
});

describe("hosted abuse and provider-cost boundaries", () => {
  it("rate-limits public session creation per merchant host", () => {
    expect(HOSTED_RATE_SQL).toContain(
      "c_sessions_per_host_hour constant integer:=60"
    );
    expect(HOSTED_RATE_SQL).toContain("pg_advisory_xact_lock");
    expect(HOSTED_RATE_SQL).toContain("created_at > now()-interval '1 hour'");
    expect(HOSTED_RATE_SQL).toContain("'hosted_request_rate_limited'");
    expect(HOSTED_RATE_SQL).toContain("errcode='CR429'");
  });

  it("rate-limits paid address search per opaque intake before the Google seam", () => {
    expect(HOSTED_RATE_SQL).toContain(
      "c_places_per_intake_hour constant integer:=12"
    );
    expect(HOSTED_RATE_SQL).toContain(
      "c_places_per_host_hour constant integer:=60"
    );
    expect(HOSTED_RATE_SQL).toContain("couranr-hosted-places:");
    expect(HOSTED_RATE_SQL).toContain("sum(h.places_request_count)");
    expect(HOSTED_RATE_SQL).toContain("for update");
    expect(HOSTED_RATE_SQL).toContain("places_request_count");
    const claim = HOSTED_PLACES_ROUTE.indexOf("claimHostedPlaceSearch");
    const google = HOSTED_PLACES_ROUTE.indexOf("autocompleteConsumerPlaces(normalized)");
    expect(claim).toBeGreaterThanOrEqual(0);
    expect(google).toBeGreaterThanOrEqual(0);
    expect(claim).toBeLessThan(google);
  });

  it("maps the database throttle to a sanitized HTTP 429", () => {
    expect(ERRORS).toContain('| "rate_limited"');
    expect(ERRORS).toContain("rate_limited: 429");
    expect(ERRORS).toContain('case "CR429"');
  });

  it("keeps the rate-limit forward migration additive", () => {
    expect(HOSTED_RATE_SQL).not.toMatch(/\bdelete\s+from\b/i);
    expect(HOSTED_RATE_SQL).not.toMatch(/\bdrop\s+(table|column)\b/i);
    expect(HOSTED_RATE_SQL).not.toMatch(/\btruncate\b/i);
  });
});

describe("hosted adversarial closure", () => {
  it("rejects role/state conflicts before any paid validation provider call", () => {
    const start = HOSTED_COMMANDS.indexOf("export async function validateHostedRequestByMerchant");
    const end = HOSTED_COMMANDS.indexOf("/* ------------------------------------------------------- host readiness", start);
    const validation = HOSTED_COMMANDS.slice(start, end);
    const roleCheck = validation.indexOf('"business_members"');
    const stateCheck = validation.indexOf('requestRow.request_state !== "awaiting_merchant_confirmation"');
    const providerCall = validation.indexOf("routed = await deriveCanonicalRouteAndQuote");

    expect(roleCheck).toBeGreaterThanOrEqual(0);
    expect(stateCheck).toBeGreaterThanOrEqual(0);
    expect(providerCall).toBeGreaterThanOrEqual(0);
    expect(roleCheck).toBeLessThan(providerCall);
    expect(stateCheck).toBeLessThan(providerCall);
    expect(validation).toContain('"owner", "manager", "dispatcher"');
  });

  it("backs the customer safety rule with a database trigger", () => {
    expect(HOSTED_CLOSURE_SQL).toContain(
      "couranr_preserve_hosted_customer_safety_evidence"
    );
    expect(HOSTED_CLOSURE_SQL).toContain(
      "v_customer_class not in ('none','unknown')"
    );
    expect(HOSTED_CLOSURE_SQL).toContain(
      "new.restricted_class not in (v_customer_class,'unknown')"
    );
    expect(HOSTED_CLOSURE_SQL).toContain(
      "'hosted_customer_safety_evidence_conflict'"
    );
  });

  it("separates merchant and customer payer entrypoints before side effects", () => {
    const merchantPayerGuard = AUTHORIZE_PAYMENT_ROUTE.indexOf(
      'loaded.value.request.payer_type !== "merchant"'
    );
    const merchantObligation = AUTHORIZE_PAYMENT_ROUTE.indexOf(
      "const obligation = await ensurePaymentObligation"
    );
    expect(merchantPayerGuard).toBeGreaterThanOrEqual(0);
    expect(merchantPayerGuard).toBeLessThan(merchantObligation);

    const customerPayerGuard = PAYMENT_LINK_ROUTE.indexOf(
      'loaded.value.request.payer_type !== "customer"'
    );
    const linkObligation = PAYMENT_LINK_ROUTE.indexOf(
      "let ob = await getObligationForRequest"
    );
    expect(customerPayerGuard).toBeGreaterThanOrEqual(0);
    expect(customerPayerGuard).toBeLessThan(linkObligation);
  });

  it("carries hosted merchant scope into assignment messaging without changing Consumer tenancy", () => {
    expect(HOSTED_CHAT_SQL).toContain("couranr_hosted_request_intakes");
    expect(HOSTED_CHAT_SQL).toContain("h.host_business_account_id");
    expect(HOSTED_CHAT_SQL).toContain("r.source='hosted_request'");
    expect(HOSTED_CHAT_SQL).toContain("r.requester_kind='consumer'");
    expect(HOSTED_CHAT_SQL).toContain("r.business_account_id is null");
    expect(HOSTED_CHAT_SQL).toContain("if v_business_account_id is null then");
    expect(HOSTED_CHAT_SQL).toContain("return null;");
    expect(HOSTED_CHAT_SQL).toContain("couranr_join_assignment_delivery_chat");
  });

  it("carries hosted relationship scope into Delivery Help without forging tenancy", () => {
    expect(HOSTED_HELP_SQL).toContain("couranr_hosted_request_intakes");
    expect(HOSTED_HELP_SQL).toContain("h.host_business_account_id");
    expect(HOSTED_HELP_SQL).toContain("r.source='hosted_request'");
    expect(HOSTED_HELP_SQL).toContain("r.requester_kind='consumer'");
    expect(HOSTED_HELP_SQL).toContain("r.business_account_id is null");
    expect(HOSTED_HELP_SQL).toContain("couranr_help_access_tokens");
    // Direct Consumer Same Day still has no merchant relationship; this narrow
    // fix must not invent one merely to satisfy the legacy non-null help schema.
    expect(HOSTED_HELP_SQL).toContain("if v_business is null then");
    expect(HOSTED_HELP_SQL).toContain("'delivery_not_found'");
  });

  it("hands a confirmed hosted customer to a one-delivery tracking credential", () => {
    const start = HOSTED_COMMANDS.indexOf("export async function readHostedRequest");
    const end = HOSTED_COMMANDS.indexOf("/* ------------------------------------------------------ merchant context", start);
    const read = HOSTED_COMMANDS.slice(start, end);
    expect(read).toContain('state === "confirmed"');
    expect(read).toContain("RPC.issueTrackingIfAbsent");
    expect(read).toContain("generateTrackingToken");
    expect(read).toContain("hashTrackingToken");
    expect(read).toContain("value.trackingToken");

    // The token itself may carry the host relationship for sanitized sender
    // display, while the Consumer-owned request remains NULL-tenancy. Hosted
    // status reads use a database-serialized issue-if-absent command so two
    // concurrent tabs cannot revoke each other's freshly issued credential.
    expect(HOSTED_TRACKING_SQL).toContain("couranr_hosted_request_intakes");
    expect(HOSTED_TRACKING_SQL).toContain("h.host_business_account_id");
    expect(HOSTED_TRACKING_SQL).toContain("v_req.business_account_id");
    expect(HOSTED_TRACKING_SQL).toContain("v_relationship_business_id");
    expect(HOSTED_TRACKING_SQL).toContain("couranr_issue_hosted_tracking_if_absent");
    expect(HOSTED_TRACKING_SQL).toContain("pg_advisory_xact_lock");
    expect(HOSTED_TRACKING_SQL).toContain("return false;");
    expect(HOSTED_TRACKING_SQL).not.toContain(
      "update public.couranr_delivery_requests"
    );
  });

  it("keeps hosted merchant authority after Consumer-owned delivery creation", () => {
    expect(DISPATCH_COMMANDS).toContain("resolveMerchantBusinessForDelivery");
    expect(DISPATCH_COMMANDS).toContain('"couranr_hosted_request_intakes"');
    expect(DISPATCH_COMMANDS).toContain("merchantScope.value.businessAccountId");
    expect(DISPATCH_COMMANDS).toContain(
      "return { ok: true, value: { businessAccountId: null, requestId } };"
    );
    expect(HOSTED_COMMANDS).toContain("export type HostedOperationsContext");
    expect(HOSTED_COMMANDS).toContain("hostBusinessAccountId");
    expect(HOSTED_COMMANDS).toContain("hostBusinessName");

    for (const route of [
      MERCHANT_PICKUP_ROUTE,
      MERCHANT_RECIPIENT_ROUTE,
      MERCHANT_PROOF_ROUTE,
    ]) {
      expect(route).toContain("resolveUserId");
      expect(route).toContain("resolveMerchantBusinessForDelivery");
      expect(route).toContain('routeFailure("not_found", "Delivery not found.")');
      expect(route).not.toContain('.select("id,business_account_id")');
    }
    expect(MERCHANT_PICKUP_ROUTE).toContain(
      'canActOnDeliveryRequest(\n    actor.actor,\n    "submit"'
    );
    expect(MERCHANT_RECIPIENT_ROUTE).toContain(
      'canActOnDeliveryRequest(\n    actor.actor,\n    "submit"'
    );
    expect(MERCHANT_PROOF_ROUTE).toContain(
      'canActOnDeliveryRequest(\n    actor.actor,\n    "read"'
    );
  });
});

describe("routing and website-tool cutover", () => {
  it("aligns the runtime quote mint boundary with Mapbox while retaining Google Place identity", () => {
    expect(MAPBOX_SQL).toContain("p_distance_source is distinct from 'mapbox_directions_v5'");
    expect(MAPBOX_SQL).toContain("'mapbox_route_authority_required'");
    expect(MAPBOX_SQL).toContain("'routeAuthority',p_distance_source");
    expect(MAPBOX_SQL).toContain("google_place_identity_required");
  });

  it("marks the website-tools route live only because the route exists in this build", () => {
    expect(HOSTED_REQUEST_ROUTE_EXISTS).toBe(true);
    expect(readFileSync(HOSTED_ROUTE, "utf8")).toContain("<HostedRequestFlow");
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * TMZ-001 parity for the hosted flow. The customer states a timing intent and,
 * when scheduled, local America/New_York words; the merchant confirms (or
 * adjusts) it; the quote is minted against the confirmed timing. Same closed
 * vocabulary, same parser, same reasons as /send and the business normalizer.
 * The SQL side is EXECUTED by e2e/disposable/hostedScheduledTiming.mjs; these
 * are the TypeScript contract and the text guards on the migration files.
 * ──────────────────────────────────────────────────────────────────────────── */

const HOSTED_COMMANDS_CODE = HOSTED_COMMANDS.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

describe("hosted customer body — TMZ-001 timing", () => {
  it("defaults to ASAP when the body carries no timing (the pre-timing browser shape still validates)", () => {
    const r = validateHostedSubmitBody(customerBody());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.timing).toEqual({ intent: "asap", requestedPickupLocal: null });
  });

  it("accepts a scheduled pickup stated as local words", () => {
    const r = validateHostedSubmitBody(
      customerBody({ timing: { intent: "scheduled", requestedPickupLocal: "2027-03-10T10:30" } })
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.timing).toEqual({ intent: "scheduled", requestedPickupLocal: "2027-03-10T10:30" });
  });

  it("ASAP drops any supplied time — the words are meaningful only when scheduled", () => {
    const r = validateHostedSubmitBody(
      customerBody({ timing: { intent: "asap", requestedPickupLocal: "2027-03-10T10:30" } })
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.timing).toEqual({ intent: "asap", requestedPickupLocal: null });
  });

  it("refuses an intent outside the closed vocabulary with a NAMED reason", () => {
    const r = validateHostedSubmitBody(customerBody({ timing: { intent: "tomorrow" } }));
    expect(r.ok).toBe(false);
    if (isHostedBodyFailure(r)) expect(r.reason).toBe("timing_intent_invalid");
  });

  it("refuses a scheduled pickup without parseable local words — no zone suffix, no impossible date", () => {
    for (const bad of [undefined, "", "soon", "2027-03-10T10:30Z", "2027-03-10T10:30-05:00", "2027-02-30T10:00", "2027-03-10 10:30"]) {
      const r = validateHostedSubmitBody(
        customerBody({ timing: { intent: "scheduled", requestedPickupLocal: bad } })
      );
      expect(r.ok, `local=${String(bad)}`).toBe(false);
      if (isHostedBodyFailure(r)) expect(r.reason).toBe("requested_time_invalid");
    }
  });

  it("a browser-supplied instant, zone or review reasons is a forbidden field, even nested under timing", () => {
    for (const key of ["requestedDepartureAt", "operatingTimezone", "timingReviewReasons", "timing_policy_version"]) {
      const r = validateHostedSubmitBody(
        customerBody({ timing: { intent: "scheduled", requestedPickupLocal: "2027-03-10T10:30", [key]: "x" } })
      );
      expect(r.ok, key).toBe(false);
      if (isHostedBodyFailure(r)) expect(r.reason).toBe("forbidden_field");
    }
  });
});

describe("hosted merchant confirmation — TMZ-001 timing", () => {
  const base = {
    payerType: "customer",
    weightBand: "0_25_lb",
    restrictedClass: "none",
    signatureRequired: false,
    pickupDescription: "One boxed lamp",
    pickupPackageCount: 1,
    pickupOrderReference: null,
    pickupHandlingNotes: null,
  };

  it("omitted timing means CONFIRM THE CUSTOMER'S STORED STATEMENT (null), never ASAP by default", () => {
    const r = validateMerchantHostedConfirmation(base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.timing).toBeNull();
  });

  it("the merchant may confirm or adjust with the business flow's own validation", () => {
    const asap = validateMerchantHostedConfirmation({ ...base, timingIntent: "asap", requestedPickupLocal: "2027-03-10T10:30" });
    expect(asap.ok && asap.value.timing).toEqual({ intent: "asap", requestedPickupLocal: null });
    const sched = validateMerchantHostedConfirmation({ ...base, timingIntent: "scheduled", requestedPickupLocal: " 2027-03-10T11:00 " });
    expect(sched.ok && sched.value.timing).toEqual({ intent: "scheduled", requestedPickupLocal: "2027-03-10T11:00" });
  });

  it("refuses an unknown intent and a scheduled adjustment without parseable words, by name", () => {
    const bad = validateMerchantHostedConfirmation({ ...base, timingIntent: "whenever" });
    expect(bad.ok).toBe(false);
    if (bad.ok === false) expect(bad.reason).toBe("timing_intent_invalid");
    for (const local of [undefined, "", "noon", "2027-03-10T10:30Z"]) {
      const r = validateMerchantHostedConfirmation({ ...base, timingIntent: "scheduled", requestedPickupLocal: local });
      expect(r.ok, `local=${String(local)}`).toBe(false);
      if (r.ok === false) expect(r.reason).toBe("requested_time_invalid");
    }
  });
});

describe("hosted command layer — no fabricated ASAP survives", () => {
  it("the hosted commands no longer hardcode an ASAP intent anywhere", () => {
    expect(HOSTED_COMMANDS_CODE).not.toMatch(/timingIntent:\s*"asap"/);
    expect(HOSTED_COMMANDS_CODE).not.toMatch(/requestedPickupLocal:\s*null,\s*\n\s*\}\)/);
  });

  it("submit evaluates the customer's words server-side and sends the four timing args; validation sends them all too", () => {
    const submit = HOSTED_COMMANDS.slice(
      HOSTED_COMMANDS.indexOf("export async function submitHostedRequest"),
      HOSTED_COMMANDS.indexOf("export type HostedTimingView")
    );
    expect(submit).toContain("evaluateRequestTiming(");
    expect(submit).toContain("...timingArgs(timing)");
    const validation = HOSTED_COMMANDS.slice(
      HOSTED_COMMANDS.indexOf("export async function validateHostedRequestByMerchant"),
      HOSTED_COMMANDS.indexOf("/* ------------------------------------------------------- host readiness")
    );
    expect(validation).toContain("...timingArgs(routed.timing)");
    expect(validation).not.toContain("p_timing_review_reasons: timingArgs(routed.timing).p_timing_review_reasons");
    // The stored statement is the default; the merchant's adjustment wins only when stated.
    expect(validation).toContain("const timing = params.input.timing ?? storedTiming;");
    expect(validation).toContain('requestRow.timing_intent === "scheduled" ? "scheduled" : "asap"');
    // The provider-cost preflight ordering still holds: state check before the paid call.
    expect(validation.indexOf("version_or_state_conflict")).toBeLessThan(validation.indexOf("routed = await deriveCanonicalRouteAndQuote"));
  });

  it("the customer status view and both context reads expose the timing", () => {
    expect(HOSTED_COMMANDS).toContain("timing: hostedTimingFromRow(data as Record<string, any>)");
    expect(HOSTED_COMMANDS.match(/customer_timing_intent,customer_requested_pickup_local"/g)?.length).toBe(2);
    expect(HOSTED_COMMANDS.match(/\.\.\.customerTimingFromIntake\(row\)/g)?.length).toBe(2);
  });

  it("both routes name the timing failure instead of a generic sentence", () => {
    expect(HOSTED_SUBMIT_ROUTE).toContain('reason === "requested_time_invalid"');
    expect(VALIDATE_HOSTED_ROUTE).toContain('reason === "requested_time_invalid"');
  });
});

describe("hosted scheduled-timing migration (20260908220000) and its POSTDEPLOY fence", () => {
  const strictCreate = HOSTED_TIMING_SQL.slice(
    HOSTED_TIMING_SQL.indexOf("create or replace function public.couranr_create_hosted_delivery_request("),
    HOSTED_TIMING_SQL.indexOf("create or replace function public.couranr_validate_hosted_delivery_request(")
  );
  const strictValidate = HOSTED_TIMING_SQL.slice(
    HOSTED_TIMING_SQL.indexOf("create or replace function public.couranr_validate_hosted_delivery_request(")
  );

  it("both strict arities take the four timing parameters and call the SHARED two-sided assertion", () => {
    for (const [name, body] of [["create", strictCreate], ["validate", strictValidate]] as const) {
      expect(body, name).toContain("p_timing_intent text");
      expect(body, name).toContain("p_requested_pickup_local text");
      expect(body, name).toContain("p_requested_departure_at timestamptz");
      expect(body, name).toContain("p_timing_review_reasons jsonb");
      expect(body, name).toContain("perform private.couranr_assert_requested_timing(");
      expect(body, name).toContain("raise exception 'timing_intent_invalid' using errcode='CR422'");
      expect(body, name).not.toContain("'asap','America/New_York'");
      expect(body, name).not.toContain("timing_intent='asap'");
    }
    // The validate write of the timing happens BEFORE the quote snapshot is taken.
    expect(strictValidate.indexOf("timing_intent=p_timing_intent")).toBeLessThan(
      strictValidate.indexOf("private.couranr_append_routed_quote_version(")
    );
  });

  it("freezes the customer's own words on the intake and extends the immutability trigger", () => {
    expect(HOSTED_TIMING_SQL).toContain("add column if not exists customer_timing_intent text");
    expect(HOSTED_TIMING_SQL).toContain("add column if not exists customer_requested_pickup_local text");
    expect(HOSTED_TIMING_SQL).toContain("or new.customer_timing_intent is distinct from old.customer_timing_intent");
    expect(HOSTED_TIMING_SQL).toContain("or new.customer_requested_pickup_local is distinct from old.customer_requested_pickup_local");
    expect(strictCreate).toContain("customer_timing_intent=p_timing_intent");
    expect(strictCreate).toContain("customer_requested_pickup_local=p_requested_pickup_local");
  });

  it("retains the old arities (PREDEPLOY-safe) and closes both new arities to browser roles AND to the default service_role grant", () => {
    expect(HOSTED_TIMING_SQL).not.toMatch(/drop function/i);
    const newCreate = "public.couranr_create_hosted_delivery_request(uuid,text,text,text,text,text,text,text,numeric,text,text,boolean,text,text,text,timestamptz,jsonb)";
    const newValidate = "public.couranr_validate_hosted_delivery_request(uuid,uuid,integer,uuid,text,numeric,text,text,boolean,jsonb,jsonb,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,text,text,timestamptz,jsonb)";
    for (const sig of [newCreate, newValidate]) {
      expect(HOSTED_TIMING_SQL).toContain(`revoke all on function ${sig}\n  from public,anon,authenticated,service_role;`);
      expect(HOSTED_TIMING_SQL).toContain(`grant execute on function ${sig} to service_role;`);
    }
  });

  it("the fence is POSTDEPLOY-only, guards on the strict arities, and drops exactly the two old shapes", () => {
    expect(HOSTED_TIMING_FENCE_SQL).toContain("POSTDEPLOY ONLY");
    expect(HOSTED_TIMING_FENCE_SQL).toContain("hosted_legacy_arity_fence_requires_strict_commands");
    expect(HOSTED_TIMING_FENCE_SQL).toContain("drop function if exists public.couranr_create_hosted_delivery_request(\n  uuid,text,text,text,text,text,text,text,numeric,text,text,boolean,text\n);");
    expect(HOSTED_TIMING_FENCE_SQL).toContain("drop function if exists public.couranr_validate_hosted_delivery_request(\n  uuid,uuid,integer,uuid,text,numeric,text,text,boolean,jsonb,jsonb,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,jsonb\n);");
    expect(HOSTED_TIMING_FENCE_SQL.match(/drop function/g)?.length).toBe(2);
  });

  it("the deploy-gap guard (20260908220500) re-defines ONLY the legacy 26-arg validate, fails closed on a scheduled row, and is a no-op after the fence", () => {
    expect(HOSTED_TIMING_GUARD_SQL).toContain("create or replace function public.couranr_validate_hosted_delivery_request(");
    expect(HOSTED_TIMING_GUARD_SQL).not.toContain("p_timing_intent text");
    expect(HOSTED_TIMING_GUARD_SQL).not.toContain("couranr_create_hosted_delivery_request(");
    expect(HOSTED_TIMING_GUARD_SQL).toContain("if v_req.timing_intent='scheduled' then");
    expect(HOSTED_TIMING_GUARD_SQL).toContain("raise exception 'hosted_scheduled_timing_requires_current_application' using errcode='CR409'");
    // The guard sits AFTER the row is loaded and BEFORE the asap overwrite.
    const raiseAt = HOSTED_TIMING_GUARD_SQL.indexOf("raise exception 'hosted_scheduled_timing_requires_current_application'");
    expect(HOSTED_TIMING_GUARD_SQL.indexOf("version_or_state_conflict")).toBeLessThan(raiseAt);
    // ... and before the legacy body's asap overwrite (the header comment also names it; search from the raise).
    expect(raiseAt).toBeLessThan(HOSTED_TIMING_GUARD_SQL.indexOf("timing_intent='asap',", raiseAt));
    // Never resurrects a retired legacy shape.
    expect(HOSTED_TIMING_GUARD_SQL).toContain("is null then\n    raise notice 'legacy 26-argument hosted validate is absent (fence applied); no-op';");
    expect(HOSTED_TIMING_GUARD_SQL).not.toMatch(/drop function/i);
    // The fence rollback restores the GUARDED legacy body, not the unguarded v1 one.
    expect(HOSTED_FENCE_ROLLBACK_SQL).toContain("hosted_scheduled_timing_requires_current_application");
  });

  it("the forward rollback hard-refuses over evidence, is RE-RUNNABLE, and restores the v1 bodies verbatim", () => {
    expect(HOSTED_TIMING_ROLLBACK_SQL).toContain("hosted scheduled-timing evidence exists");
    expect(HOSTED_TIMING_ROLLBACK_SQL).toContain("exception when undefined_column then");
    // Verbatim restoration: the v1 create body's distinctive lines are present unchanged.
    expect(HOSTED_TIMING_ROLLBACK_SQL).toContain("'asap','America/New_York',");
    expect(HOSTED_TIMING_ROLLBACK_SQL).toContain("timing_intent='asap',");
    expect(HOSTED_TIMING_ROLLBACK_SQL).not.toMatch(/\bcascade\b/i);
  });
});

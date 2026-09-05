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

  it("merchant validation requires final payer, weight knowledge and safety declaration", () => {
    expect(
      validateMerchantHostedConfirmation({
        payerType: "customer",
        weightBand: "0_25_lb",
        restrictedClass: "none",
        signatureRequired: false,
      }).ok
    ).toBe(true);
    expect(
      validateMerchantHostedConfirmation({
        payerType: "customer",
        weightBand: "0_25_lb",
        restrictedClass: "alcohol",
        signatureRequired: false,
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
      expect(route).toContain("resolveMerchantBusinessForDelivery");
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

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolutionPolicyForFulfillmentState,
} from "@/lib/couranr/conversations/helpResolution";

const ROOT = path.resolve(__dirname, "..");
const SERVER = fs.readFileSync(
  path.join(ROOT, "lib/couranr/conversations/helpResolution.ts"),
  "utf8"
);
const ROUTE = fs.readFileSync(
  path.join(ROOT, "app/api/couranr/help/[token]/resolution-request/route.ts"),
  "utf8"
);
const HELP_ROUTE = fs.readFileSync(
  path.join(ROOT, "app/api/couranr/help/[token]/route.ts"),
  "utf8"
);
const PAGE = fs.readFileSync(
  path.join(ROOT, "components/couranr/help/DeliveryHelpPage.tsx"),
  "utf8"
);

describe("CUS-002 cancellation and return request", () => {
  it("maps pre-arrival delivery states to the locked CAN-001 $8 policy", () => {
    for (const state of ["not_scheduled", "scheduled", "assigned", "en_route_to_pickup"]) {
      const policy = resolutionPolicyForFulfillmentState(state);
      expect(policy?.available).toBe(true);
      if (!policy?.available) continue;
      expect(policy.stage).toBe("before_arrival");
      expect(policy.requestKind).toBe("cancellation_review");
      expect(policy.canSubmit).toBe(true);
      expect(policy.policySummary).toContain("$8");
      expect(policy.policySummary).toContain("Couranr-caused cancellation is $0");
    }
  });

  it("does not misapply the failed-pickup $15 rule to an arbitrary customer request at pickup", () => {
    const policy = resolutionPolicyForFulfillmentState("at_pickup");
    expect(policy?.available).toBe(true);
    if (!policy?.available) return;
    expect(policy.requestKind).toBe("operations_review");
    expect(policy.policySummary).toContain("$15 failed-pickup");
    expect(policy.policySummary).toContain("only when pickup cannot occur");
    expect(policy.policySummary).toContain("Operations must review");
  });

  it("maps custody to REF-003 new-route review without inventing a return amount", () => {
    for (const state of ["picked_up", "in_transit", "at_dropoff"]) {
      const policy = resolutionPolicyForFulfillmentState(state);
      expect(policy?.available).toBe(true);
      if (!policy?.available) continue;
      expect(policy.requestKind).toBe("return_review");
      expect(policy.policySummary).toContain("new Pricing V2 route");
      expect(policy.policySummary).toContain("payer owes $0");
      expect(policy.policySummary).not.toMatch(/70%|14\.99/);
    }
  });

  it("does not open duplicate requests once return/terminal custody is already settled", () => {
    for (const state of [
      "return_required",
      "returning",
      "returned",
      "delivered",
      "cancelled",
      "could_not_deliver",
    ]) {
      const policy = resolutionPolicyForFulfillmentState(state);
      expect(policy?.available, state).toBe(true);
      if (!policy?.available) continue;
      expect(policy.canSubmit, state).toBe(false);
      expect(policy.requestKind, state).toBe("none");
    }
  });

  it("keeps product returns and refunds with the selling business after delivery", () => {
    const policy = resolutionPolicyForFulfillmentState("delivered");
    expect(policy?.available).toBe(true);
    if (!policy?.available) return;
    expect(policy.policySummary).toContain("selling business's responsibility");
    expect(policy.policySummary).toContain("delivery-service issue");
  });

  it("derives stage/action/fee server-side from the redeemed delivery and accepts none from the browser", () => {
    expect(ROUTE).toContain("deliveryId: link.value.deliveryId");
    expect(ROUTE).toContain("tokenId: link.value.tokenId");

    const bodyObject = ROUTE.slice(
      ROUTE.indexOf("submitHelpResolutionRequest({"),
      ROUTE.indexOf("});", ROUTE.indexOf("submitHelpResolutionRequest({")) + 3
    );
    for (const forbidden of [
      "payload.stage",
      "payload.action",
      "payload.amount",
      "payload.fee",
      "payload.payer",
      "payload.destination",
      "payload.targetState",
    ]) {
      expect(bodyObject).not.toContain(forbidden);
    }
  });

  it("re-reads the current delivery state at submission and only appends a help message", () => {
    expect(SERVER).toContain("await readHelpResolutionPolicy(params.deliveryId)");
    expect(SERVER).toContain("await postHelpMessage({");
    for (const forbidden of [
      "cancelDeliveryWithRecovery",
      "requireReturn(",
      "refundPayment(",
      "releaseAuthorization(",
      "couranr_cancel_delivery",
      "couranr_require_return",
      "couranr_start_return",
    ]) {
      expect(SERVER, forbidden).not.toContain(forbidden);
    }
  });

  it("does not read or return payer identity, captured amount or return-route detail", () => {
    const executable = SERVER.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    for (const forbidden of [
      "payer_type",
      "captured_amount_cents",
      "amount_cents",
      "payment_obligation_id",
      "route_origin_snapshot",
      "return_destination_snapshot",
      "payer_owes_cents",
      "provider_payment_intent_id",
    ]) {
      expect(executable, forbidden).not.toContain(forbidden);
    }
  });

  it("keeps generic Delivery Help usable and mounts the registry fragment", () => {
    expect(HELP_ROUTE).toContain("readHelpResolutionPolicy(link.value.deliveryId)");
    expect(PAGE).toContain('id="cancellation-return"');
    expect(PAGE).toContain("cancel the delivery");
    expect(PAGE).toContain("approve a fee");
    expect(PAGE).toContain("issue a refund");
  });

  it("records the structural early-stage reachability limit instead of fabricating pre-capture coverage", () => {
    expect(SERVER).toContain("canonical delivery is created only after payment capture");
    expect(SERVER).toContain("pre-authorization and pre-confirmation CAN-001 stages cannot occur");
  });
});

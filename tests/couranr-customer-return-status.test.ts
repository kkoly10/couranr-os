import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  mapHelpRefundState,
  mapHelpReturnState,
} from "@/lib/couranr/conversations/helpStatusStates";

const ROOT = path.resolve(__dirname, "..");
const STATUS = fs.readFileSync(
  path.join(ROOT, "lib/couranr/conversations/helpStatus.ts"),
  "utf8"
);
const ROUTE = fs.readFileSync(
  path.join(ROOT, "app/api/couranr/help/[token]/route.ts"),
  "utf8"
);
const PAGE = fs.readFileSync(
  path.join(ROOT, "components/couranr/help/DeliveryHelpPage.tsx"),
  "utf8"
);

describe("CUS-007 return and refund status", () => {
  it("maps every governed return custody state without inventing another state", () => {
    expect(mapHelpReturnState({ returnState: "required" })).toBe("required");
    expect(mapHelpReturnState({ returnState: "returning" })).toBe("returning");
    expect(mapHelpReturnState({ returnState: "returned" })).toBe("returned");
    expect(mapHelpReturnState({ returnState: null, fulfillmentState: "return_required" })).toBe("required");
    expect(mapHelpReturnState({ returnState: null, fulfillmentState: "returning" })).toBe("returning");
    expect(mapHelpReturnState({ returnState: null, fulfillmentState: "returned" })).toBe("returned");
    expect(mapHelpReturnState({ returnState: null, fulfillmentState: "delivered" })).toBe("none");
    expect(mapHelpReturnState({ returnState: "invented" })).toBeNull();
  });

  it("maps refund persistence to pending, refunded, no-refund-due and review", () => {
    expect(mapHelpRefundState({ attemptState: "requested" })).toBe("pending");
    expect(mapHelpRefundState({ attemptState: "pending_unknown" })).toBe("pending");
    expect(mapHelpRefundState({ attemptState: "succeeded" })).toBe("refunded");
    expect(mapHelpRefundState({ attemptState: "settled_no_refund_due" })).toBe("not_due");
    expect(mapHelpRefundState({ attemptState: "failed" })).toBe("needs_review");
    expect(mapHelpRefundState({ attemptState: null, paymentState: "refunded" })).toBe("refunded");
    expect(mapHelpRefundState({ attemptState: "failed", paymentState: "partially_refunded" })).toBe("refunded");
    expect(mapHelpRefundState({ attemptState: null, paymentState: "captured" })).toBe("none");
    expect(mapHelpRefundState({ attemptState: "invented" })).toBeNull();
  });

  it("derives scope only from the redeemed one-delivery help credential", () => {
    expect(ROUTE).toContain("readHelpLifecycleStatus(link.value.deliveryId)");
    const getStart = ROUTE.indexOf("export async function GET");
    const postStart = ROUTE.indexOf("export async function POST");
    const getBody = ROUTE.slice(getStart, postStart);
    expect(getBody).not.toContain("searchParams");
    expect(getBody).not.toContain("req.json()");
  });

  it("scopes refund status to the delivery's own captured obligation", () => {
    expect(STATUS).toContain('.eq("request_id", requestId)');
    expect(STATUS).toContain('.eq("obligation_id", obligationId)');
    expect(STATUS).toContain('.eq("id", obligationId)');
    expect(STATUS).toContain('help.status.obligation_missing');
  });

  it("selects status only and never reads financial secrets or return-route detail", () => {
    const code = STATUS.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    for (const forbidden of [
      "amount_cents",
      "retained_cents",
      "provider_payment_intent_id",
      "provider_refund_id",
      "failure_detail",
      "payer_owes_cents",
      "route_origin_snapshot",
      "return_destination_snapshot",
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it("does not let a return-status read failure disable Delivery Help messaging", () => {
    expect(STATUS).toContain('return { available: false }');
    expect(ROUTE).toContain("const [thread, returnStatus] = await Promise.all");
    expect(ROUTE).toContain("if (isHelpFailure(thread)) return refuse()");
    expect(ROUTE).not.toContain("isHelpFailure(returnStatus)");
  });

  it("renders the registry fragment and all required user-facing states", () => {
    expect(PAGE).toContain('id="return-status"');
    for (const label of [
      "Return required",
      "Returning",
      "Returned",
      "Refund pending",
      "Refunded",
      "No refund due",
    ]) {
      expect(PAGE).toContain(label);
    }
  });

  it("states the merchandise boundary and does not show payment amounts", () => {
    expect(PAGE).toContain("delivery-service status only");
    expect(PAGE).toContain("handled by the business that sold");
    expect(PAGE).toContain("Payment amounts and payment-method details are not shown");
    expect(PAGE).not.toContain("refund amount");
  });
});

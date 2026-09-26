import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

describe("returned/failed delivery refund-review reachability", () => {
  it("mounts an Operations-only review entry on the terminal workbench", () => {
    const src = read("components/couranr/operations/OperationsDeliveryWorkbench.tsx");
    expect(src).toContain("OperationsRefundReviewEntry");
    expect(src).toContain("requestId={request.id}");
    expect(src).toContain("fulfillmentState={fulfillment.delivery.fulfillmentState}");
    expect(src).toContain("paymentState={fulfillment.payment?.paymentState ?? null}");
  });

  it("offers the entry only for terminal deliveries with captured delivery-charge money", () => {
    const src = read("components/couranr/operations/refunds/OperationsRefundReviewEntry.tsx");
    expect(src).toContain('fulfillmentState === "returned"');
    expect(src).toContain('fulfillmentState === "could_not_deliver"');
    expect(src).toContain('paymentState === "captured"');
    expect(src).not.toContain('paymentState === "refunded"');
    expect(src).toContain("creates a review only");
    expect(src).not.toMatch(/approvedCents|refundAmount|amountCents/);
  });

  it("opens the existing OPS-011 review path instead of introducing a second refund authority", () => {
    const client = read("components/couranr/operations/refunds/client.ts");
    expect(client).toContain('return call<{ refundRequest: RefundRequestRow }>("/api/couranr/operations/refunds"');
    expect(client).toContain('requestedBy: "operations"');
    expect(client).toContain('reasonCode: "operations_adjustment"');
  });
});

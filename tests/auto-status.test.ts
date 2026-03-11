import { describe, expect, it } from "vitest";
import { resolveRentalStatusAfterPayment } from "@/lib/auto/status";

describe("resolveRentalStatusAfterPayment", () => {
  it("returns paid_pending_review when requirements are incomplete", () => {
    expect(
      resolveRentalStatusAfterPayment({
        verification_status: "approved",
        agreement_signed: true,
        docs_complete: true,
        lockbox_code_released_at: null,
      })
    ).toBe("paid_pending_review");
  });

  it("returns paid_pending_review when verification is not approved", () => {
    expect(
      resolveRentalStatusAfterPayment({
        verification_status: "pending",
        agreement_signed: true,
        docs_complete: true,
        lockbox_code_released_at: "2026-03-10T12:00:00.000Z",
      })
    ).toBe("paid_pending_review");
  });

  it("returns pickup_ready when all requirements are complete", () => {
    expect(
      resolveRentalStatusAfterPayment({
        verification_status: "approved",
        agreement_signed: true,
        docs_complete: true,
        lockbox_code_released_at: "2026-03-10T12:00:00.000Z",
      })
    ).toBe("pickup_ready");
  });
});
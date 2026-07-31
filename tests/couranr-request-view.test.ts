import { describe, expect, it } from "vitest";
import {
  REQUEST_STATE_LABELS,
  formatCents,
  toDeliveryRequestView,
} from "@/lib/couranr/requests/view";
import { REQUEST_STATES } from "@/lib/couranr/requests/states";

/** A row shaped like the table, including columns that must never be published. */
const ROW = {
  id: "11111111-1111-4111-8111-111111111111",
  business_account_id: "22222222-2222-4222-8222-222222222222",
  created_by: "33333333-3333-4333-8333-333333333333",
  idempotency_key: "should-never-be-published",
  created_at: "2026-07-31T00:00:00.000Z",
  updated_at: "2026-07-31T00:00:00.000Z",
  submitted_at: null,
  version: 1,
  request_state: "draft",
  readiness_state: "not_confirmed",
  review_state: "not_required",
  service_area_review_state: "pending",
  payer_type: "merchant",
  quote_status: "estimated",
  source: "merchant_portal",
  recipient_name: "Dana",
  recipient_phone: null,
  recipient_email: null,
  loaded_miles: "4.200",
  weight_lb: "12.50",
  additional_stops: 0,
  service_level: "standard",
  signature_required: false,
  proof_method: "photo_or_pin",
  pricing_policy_version: "couranr-pricing-v1",
  delivery_subtotal_cents: 2569,
  included_loaded_miles: 3,
  billable_loaded_miles: "1.200",
  rounding_applied: false,
  tax_included: false,
  payment_due_cents: null,
  quote_line_items: [{ code: "base_delivery", label: "Base", quantity: 1, unitAmountCents: 2299, amountCents: 2299 }],
  review_reasons: [],
  pickup_address: { line1: "10 Market St" },
  dropoff_address: { line1: "9 Elm Ave" },
  normalized_request_payload: { overnightRequested: false, capturedBy: "internal" },
};

describe("delivery-request view model", () => {
  const view = toDeliveryRequestView(ROW);

  /**
   * The view is an ALLOW-LIST, so adding a column to the table cannot
   * accidentally publish it to a browser.
   */
  it("never publishes internal columns", () => {
    const serialized = JSON.stringify(view);
    for (const secret of [
      "should-never-be-published",
      ROW.created_by,
      "capturedBy",
      "idempotency",
    ]) {
      expect(serialized, `leaked ${secret}`).not.toContain(secret);
    }
    expect(Object.keys(view)).not.toContain("createdBy");
    expect(Object.keys(view)).not.toContain("idempotencyKey");
    expect(Object.keys(view)).not.toContain("normalizedRequestPayload");
  });

  it("converts numeric strings from Postgres into numbers", () => {
    // numeric(8,3) comes back as a string over PostgREST. A view that passed it
    // straight through would render "4.200" and break any comparison.
    expect(view.loadedMiles).toBe(4.2);
    expect(view.weightLb).toBe(12.5);
    expect(view.quote.billableLoadedMiles).toBe(1.2);
    expect(typeof view.version).toBe("number");
  });

  it("reports no payable amount", () => {
    expect(view.quote.paymentDueCents).toBe(null);
    expect(view.quote.roundingApplied).toBe(false);
    expect(view.quote.taxIncluded).toBe(false);
  });

  it("reports a payment amount if one were ever persisted, instead of hiding it", () => {
    const leaky = toDeliveryRequestView({ ...ROW, payment_due_cents: 2299 });
    expect(leaky.quote.paymentDueCents).toBe(2299);
  });

  it("defaults array columns to arrays when the row has nulls", () => {
    const sparse = toDeliveryRequestView({
      ...ROW,
      quote_line_items: null,
      review_reasons: null,
    });
    expect(sparse.quote.lineItems).toEqual([]);
    expect(sparse.quote.reviewReasons).toEqual([]);
  });

  it("labels every canonical request state", () => {
    for (const s of REQUEST_STATES) {
      expect(REQUEST_STATE_LABELS[s], s).toBeTruthy();
    }
  });
});

describe("formatCents", () => {
  it("formats integer cents without floating-point arithmetic", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(2299)).toBe("$22.99");
    expect(formatCents(100000)).toBe("$1000.00");
    // 1070 / 100 is 10.700000000000001 in binary floating point.
    expect(formatCents(1070)).toBe("$10.70");
  });

  it("renders an absent amount as a dash, never as zero", () => {
    expect(formatCents(null)).toBe("—");
    expect(formatCents(undefined)).toBe("—");
    expect(formatCents(NaN)).toBe("—");
  });

  it("handles a negative amount without mangling the cents", () => {
    expect(formatCents(-2299)).toBe("-$22.99");
  });
});

import { describe, expect, it } from "vitest";
import {
  EMPTY_FACETS,
  filterDeliveryRows,
  type DeliveriesFacets,
} from "@/lib/couranr/requests/listFilters";
import type { DeliveryRequestView } from "@/lib/couranr/requests/view";

/**
 * MER-004 — the facet semantics. Each facet filters its OWN state group
 * independently (STA-001), and the payment facet only ever matches rows whose
 * obligation facts were actually fetched — never a guess about an unchecked
 * row.
 */

function row(over: Partial<DeliveryRequestView>): DeliveryRequestView {
  return {
    id: "r1",
    businessAccountId: "b1",
    version: 1,
    createdAt: "2026-08-06T00:00:00Z",
    updatedAt: "2026-08-06T00:00:00Z",
    submittedAt: null,
    requestState: "draft",
    readinessState: "not_confirmed",
    reviewState: "not_required",
    serviceAreaReviewState: "pending",
    payerType: "merchant",
    source: "merchant_portal",
    recipientName: null,
    recipientPhone: null,
    recipientEmail: null,
    loadedMiles: null,
    weightLb: null,
    additionalStops: 0,
    serviceLevel: "standard",
    signatureRequired: false,
    proofMethod: "photo_or_pin",
    pickupAddress: null,
    dropoffAddress: null,
    quote: {
      status: "not_quoted",
      policyVersion: null,
      deliverySubtotalCents: null,
      includedLoadedMiles: null,
      billableLoadedMiles: null,
      lineItems: [],
      reviewReasons: [],
      roundingApplied: false,
      taxIncluded: false,
      paymentDueCents: null,
    },
    ...over,
  } as DeliveryRequestView;
}

const ROWS = [
  row({ id: "a", requestState: "draft", recipientName: "Ada Lovelace" }),
  row({
    id: "b",
    requestState: "confirmed",
    readinessState: "preparing",
    reviewState: "accepted_as_quoted",
    recipientName: "Grace Hopper",
  }),
  row({
    id: "c",
    requestState: "confirmed",
    readinessState: "ready",
    reviewState: "requoted",
    recipientName: "Katherine Johnson",
  }),
];

const PAYMENTS = new Map<string, string | null>([
  ["b", "authorized"],
  ["c", null], // checked: no live obligation
  // "a" deliberately absent: never checked
]);

const facets = (over: Partial<DeliveriesFacets>): DeliveriesFacets => ({
  ...EMPTY_FACETS,
  ...over,
});

describe("filterDeliveryRows", () => {
  it("no facets returns everything", () => {
    expect(filterDeliveryRows(ROWS, EMPTY_FACETS, PAYMENTS).map((r) => r.id)).toEqual([
      "a", "b", "c",
    ]);
  });

  it("each state-group facet filters independently", () => {
    expect(
      filterDeliveryRows(ROWS, facets({ requestState: "confirmed" }), PAYMENTS).map((r) => r.id)
    ).toEqual(["b", "c"]);
    expect(
      filterDeliveryRows(ROWS, facets({ readinessState: "ready" }), PAYMENTS).map((r) => r.id)
    ).toEqual(["c"]);
    expect(
      filterDeliveryRows(ROWS, facets({ reviewState: "requoted" }), PAYMENTS).map((r) => r.id)
    ).toEqual(["c"]);
  });

  it("facets compose as AND across groups", () => {
    expect(
      filterDeliveryRows(
        ROWS,
        facets({ requestState: "confirmed", readinessState: "preparing" }),
        PAYMENTS
      ).map((r) => r.id)
    ).toEqual(["b"]);
  });

  it("payment facet matches only fetched facts — an unchecked row never matches", () => {
    expect(
      filterDeliveryRows(ROWS, facets({ paymentState: "authorized" }), PAYMENTS).map((r) => r.id)
    ).toEqual(["b"]);
    // "none" is checked-and-empty, not "we don't know".
    expect(
      filterDeliveryRows(ROWS, facets({ paymentState: "none" }), PAYMENTS).map((r) => r.id)
    ).toEqual(["c"]);
    // Row "a" was never checked: it matches NO payment-specific facet.
    expect(
      filterDeliveryRows([ROWS[0]], facets({ paymentState: "none" }), PAYMENTS)
    ).toEqual([]);
  });

  it("search matches recipient fields and id, case-insensitively", () => {
    expect(
      filterDeliveryRows(ROWS, facets({ search: "grace" }), PAYMENTS).map((r) => r.id)
    ).toEqual(["b"]);
    expect(
      filterDeliveryRows(ROWS, facets({ search: "C" }), PAYMENTS).map((r) => r.id)
    ).toEqual(["a", "b", "c"]); // "c" the id, "Grace"/"Lovelace" substrings
  });
});

import type { DeliveryRequestView } from "./view";

/**
 * MER-004 list filtering. Pure, so the facet semantics are unit-testable
 * without a browser.
 *
 * One filter PER state group — request, readiness, review, payment — never a
 * merged "status" dropdown. STA-001 declares the groups independent and the
 * registry's MER-004 constraint says "Never collapse independent state groups
 * into one misleading status." The canonical mock draws a single Status
 * column; the written specification wins over the mock, so it is not built.
 */

/**
 * MER-004 "duplicate" — the sessionStorage handoff between the list and the
 * create flow. Client-side prefill ONLY: the new draft re-prices server-side
 * on calculate, so nothing about the old quote can carry over.
 */
export const DUPLICATE_STORAGE_KEY = "couranr:duplicate-delivery-request";

export type DeliveriesFacets = {
  /** Empty string means "all" for every facet. */
  requestState: string;
  readinessState: string;
  reviewState: string;
  /**
   * Payment is a facet over the SEPARATELY-FETCHED obligation facts:
   * a payment state value, or "none" for rows whose lifecycle view reported
   * no live obligation. Rows whose payment was never fetched (non-payable
   * states, or beyond the announced fan-out cap) match only the "all" value —
   * they are excluded from payment-specific facets rather than guessed at.
   */
  paymentState: string;
  search: string;
};

export const EMPTY_FACETS: DeliveriesFacets = {
  requestState: "",
  readinessState: "",
  reviewState: "",
  paymentState: "",
  search: "",
};

/** `paymentStates`: request id -> payment state, null = checked, no obligation. */
export function filterDeliveryRows(
  rows: readonly DeliveryRequestView[],
  facets: DeliveriesFacets,
  paymentStates: ReadonlyMap<string, string | null>
): DeliveryRequestView[] {
  const q = facets.search.trim().toLowerCase();
  return rows.filter((r) => {
    if (facets.requestState && r.requestState !== facets.requestState) return false;
    if (facets.readinessState && r.readinessState !== facets.readinessState) return false;
    if (facets.reviewState && r.reviewState !== facets.reviewState) return false;

    if (facets.paymentState) {
      if (!paymentStates.has(r.id)) return false;
      const p = paymentStates.get(r.id) ?? null;
      if (facets.paymentState === "none" ? p !== null : p !== facets.paymentState) {
        return false;
      }
    }

    if (q) {
      const hay = `${r.recipientName ?? ""} ${r.recipientPhone ?? ""} ${r.recipientEmail ?? ""} ${r.id}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

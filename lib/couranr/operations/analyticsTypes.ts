/**
 * OPS-013 / OPS-014 analytics — the shape of the measured output.
 *
 * Deliberately a SEPARATE module from `analytics.ts`, which calls
 * `assertServerOnly` at module scope. `tests/couranr-server-only.test.ts` walks
 * `import`/`export … from` regardless of `import type`, so a `"use client"`
 * dashboard importing its types from the server module would fail the build.
 * `lib/couranr/finance/types.ts` is the same split for the same reason.
 *
 * ── The privacy contract, expressed in the types ──────────────────────────
 * Every string that reaches a browser through these types is one of:
 *   - a UUID (a delivery request / delivery / driver id, for drill-down),
 *   - an ISO-8601 timestamp,
 *   - a member of a CLOSED vocabulary declared in this file.
 *
 * There is no field here that can carry a message body, a street address, a
 * gate code, a phone number, a proof URL or a card number, because there is no
 * free-text field at all. OPS-013's constraint is therefore a property of the
 * type, not of the author's care. `tests/couranr-operations-analytics.test.ts`
 * proves it by feeding poisoned rows through the real aggregation.
 */

/** Registry OPS-013 states: "Loading; partial data; empty; live." Loading is
 *  client-side, so it is not a value the server can return. */
export type PanelState = "live" | "partial" | "empty" | "not_measurable";

/** A dimension bucket. `key` is always from a closed vocabulary. */
export type CountBucket = {
  key: string;
  label: string;
  count: number;
};

/** A dimension bucket that also carries captured money, in integer cents. */
export type MoneyBucket = CountBucket & {
  capturedCents: number;
};

/**
 * One measured panel.
 *
 * `not_measurable` is a first-class state, not an error and not a zero: a panel
 * whose measure cannot be derived from what the database actually records says
 * so, and says why. An empty database renders `empty`; a measure with no source
 * column renders `not_measurable`. Neither is ever dressed up as a number.
 */
export type Panel<T = CountBucket> = {
  state: PanelState;
  rows: T[];
  /** Populated only for `not_measurable`. Plain words, no jargon. */
  reason?: string;
  /**
   * Populated for `partial`. The number of source rows this panel could not
   * attribute — surfaced, never folded into a bucket.
   */
  unattributed?: number;
  /**
   * True when a row may appear in more than one bucket (a request can carry
   * several review reasons), so the bucket counts must not be summed into a
   * total. The UI says so wherever this is set.
   */
  multiValued?: boolean;
};

/* ------------------------------------------------------------------ OPS-013 */

export type EconomicsSummary = {
  /** Captured, never authorized. An authorization is not revenue. */
  capturedCents: number;
  refundedCents: number;
  netCapturedCents: number;
  /** Promotional credit applied on deliveries, an expense, not revenue. */
  promotionalCreditCents: number;
  /** The quoted standard price before promotional credit, where recorded. */
  standardQuoteCents: number;
  paidDeliveryCount: number;
  /** null rather than 0 when there is nothing to average. */
  averageCapturedCents: number | null;
};

export type SupportSummary = {
  conversations: Panel;
  conversationsByDueState: Panel;
  problemReports: Panel;
  incidents: Panel;
  /**
   * Conversations whose recorded `due_state` is `overdue`.
   *
   * That word is the CHECK constraint's, not a description: an earlier draft
   * counted "breached", which the constraint does not permit, so the number
   * could only ever have been zero while looking like a measurement.
   */
  overdueConversations: number;
};

export type ProofSummary = {
  byStage: Panel;
  byType: Panel;
  /**
   * Deliveries in a terminal delivered state that carry at least one dropoff
   * proof row, against those that do not. Counts only; no object path, no
   * bucket name, no signed URL, no coordinates.
   */
  deliveredWithDropoffProof: number;
  deliveredWithoutDropoffProof: number;
};

export type DriverUtilizationSummary = {
  /** Drivers whose `driver_state` is active. */
  activeDrivers: number;
  /** Of those, the ones holding at least one assignment in the window. */
  driversWithAssignments: number;
  assignmentsByState: Panel;
  /** Per-driver assignment counts, keyed by driver id. No name, no phone. */
  perDriver: Panel<CountBucket>;
  /**
   * Utilization as a RATE — time on delivery against time available — which is
   * not derivable today and is therefore rendered `not_measurable` rather than
   * approximated. `couranr_drivers.availability_state` is a current-state flag
   * with no history table behind it, and nothing records a driver's scheduled
   * hours, so there is no denominator. Assignment counts (above) are the real
   * measure available now.
   */
  utilizationRate: Panel<never>;
};

export type OperationsAnalytics = {
  generatedAt: string;
  /** The window these measures cover, or null for "all recorded history". */
  windowDays: number | null;
  /** Registry state for the screen as a whole. */
  state: Exclude<PanelState, "not_measurable">;
  /** Requests created in the window, the denominator for everything below. */
  requestsInWindow: number;
  paidDeliveries: {
    /** Payment obligations that actually captured. */
    count: number;
    byFulfillmentState: Panel;
  };
  markets: Panel<MoneyBucket>;
  categories: Panel<MoneyBucket>;
  payerMix: Panel<MoneyBucket>;
  requesterMix: Panel<MoneyBucket>;
  economics: EconomicsSummary;
  support: SupportSummary;
  proof: ProofSummary;
  driverUtilization: DriverUtilizationSummary;
  /** Set when a source hit its row cap, so a count is a floor, not a total. */
  truncatedSources: string[];
};

/* ------------------------------------------------------------------ OPS-014 */

/**
 * The three-way split OPS-014's constraint exists to protect.
 *
 * "Requests Couranr could not confirm" is NOT "customers we lost", and it is
 * not "every request that is not confirmed" either. A draft nobody submitted
 * was never asked of Couranr; a request still in review has not been refused.
 * Each is counted and shown on its own, and only `couldNotConfirm` feeds the
 * cause attribution below.
 */
export type UnmetDemandUniverse = {
  confirmed: number;
  /** `draft` / `awaiting_merchant_confirmation`: submitted_at is null by CHECK. */
  neverSubmitted: number;
  /** Awaiting quote acceptance, pending review, or quote revision required. */
  stillOpen: number;
  /** `declined` / `cancelled` / `closed`. The unmet-demand universe. */
  couldNotConfirm: number;
};

export type UnmetDemandRequestRef = {
  requestId: string;
  /** Closed vocabulary: the request_state CHECK constraint. */
  requestState: string;
  cause: string;
  createdAt: string;
};

export type UnmetDemandAnalytics = {
  generatedAt: string;
  windowDays: number | null;
  state: Exclude<PanelState, "not_measurable">;
  universe: UnmetDemandUniverse;
  /**
   * Why Couranr could not confirm, from the RECORDED reason only.
   * `couranr-decline-v1` codes come from the decline event; a cancellation is
   * attributed to the recorded actor, never to an invented reason; anything
   * without a recorded cause lands in `unattributed` and is never folded into
   * a cause.
   */
  causes: Panel;
  /** Requests in the could-not-confirm set with no recorded cause at all. */
  unattributed: number;
  serviceArea: Panel;
  quoteDisposition: Panel;
  reviewTriggers: Panel;
  timingTriggers: Panel;
  categories: Panel;
  markets: Panel;
  distanceBands: Panel;
  weightBands: Panel;
  restrictedClasses: Panel;
  /** Could-not-confirm requests by the day they were created, ascending. */
  byDay: Panel;
  /** Ids only, for "open underlying requests". Never any request content. */
  recent: UnmetDemandRequestRef[];
  truncatedSources: string[];
};

/* --------------------------------------------------------- closed vocabulary */

/**
 * `couranr-decline-v1`, the ONLY governed could-not-confirm vocabulary.
 * Source of truth: `supabase/migrations/20260731210000_couranr_decline_reasons_v1.sql`,
 * which derives the merchant message from the code so the two cannot drift.
 * The merchant message and the internal note are deliberately NOT read here —
 * the note is free operator text and the migration states no merchant- or
 * customer-facing read path may select it.
 */
export const DECLINE_REASON_LABELS: Record<string, string> = {
  outside_service_area: "Outside service area",
  requested_time_unavailable: "Requested time unavailable",
  no_driver_available: "No driver available",
  no_compatible_vehicle: "No compatible vehicle",
  shipment_not_supported: "Shipment not supported",
  merchant_account_on_hold: "Merchant account on hold",
  duplicate_or_superseded: "Duplicate or superseded",
  other: "Other (recorded with an internal note)",
};

/**
 * Causes this surface adds beyond the governed decline codes. Every one names
 * a recorded FACT, never an inferred motive.
 */
export const DERIVED_CAUSE_LABELS: Record<string, string> = {
  cancelled_by_operations: "Cancelled by Couranr Operations",
  cancelled_by_merchant: "Cancelled by the merchant",
  cancelled_by_customer: "Cancelled by the customer",
  cancelled_by_system: "Cancelled by an automated process",
  cancelled_actor_not_recorded: "Cancelled — actor not recorded",
  declined_reason_not_recorded: "Declined — reason not recorded",
  closed_without_recorded_cause: "Closed — no recorded cause",
  unattributed: "Not attributed",
};

export const CAUSE_LABELS: Record<string, string> = {
  ...DECLINE_REASON_LABELS,
  ...DERIVED_CAUSE_LABELS,
};

/** `couranr_delivery_requests.service_area_review_state` CHECK constraint. */
export const SERVICE_AREA_LABELS: Record<string, string> = {
  pending: "Not yet assessed",
  in_area: "In service area",
  out_of_area_review: "Outside — sent to review",
  declined: "Outside — declined",
};

/** `couranr_delivery_requests.quote_status` CHECK constraint. */
export const QUOTE_STATUS_LABELS: Record<string, string> = {
  not_quoted: "Not quoted",
  estimated: "Automatically quoted",
  manual_review_required: "Manual quote required",
  invalid: "Quote invalid",
};

/** `couranr_delivery_requests.weight_band` CHECK constraint. */
export const WEIGHT_BAND_LABELS: Record<string, string> = {
  "0_25_lb": "Up to 25 lb",
  over_25_to_50_lb: "Over 25 to 50 lb",
  over_50_lb: "Over 50 lb",
  unknown: "Weight unknown",
  not_recorded: "Not recorded",
};

/**
 * Distance bands, matching the Couranr Pricing Authority V2 boundaries
 * (2.000 included miles, then through 10, then through 25, then review).
 */
export const DISTANCE_BAND_LABELS: Record<string, string> = {
  "0_2": "0 to 2 miles (included)",
  "2_10": "Over 2 to 10 miles",
  "10_25": "Over 10 to 25 miles",
  over_25: "Over 25 miles (review)",
  not_recorded: "Distance not recorded",
};

/**
 * The four exact launch markets, plus the one bucket everything else falls in.
 *
 * The bucket vocabulary is CLOSED on purpose. The market of an unconfirmed
 * request is only knowable from its pickup address, and an address is exactly
 * what OPS-013's constraint bars from this surface — so the classifier's
 * verdict crosses the boundary and the address never does. A city Couranr does
 * not serve cannot be named here, which is also why `outside_launch_markets`
 * is a single bucket rather than a long tail of place names.
 *
 * Source of truth: `lib/couranr/routing/market.ts` (the PR #38 classifier).
 */
export const MARKET_LABELS: Record<string, string> = {
  "US|DC|washington": "Washington, DC",
  "US|VA|stafford": "Stafford, VA",
  "US|VA|woodbridge": "Woodbridge, VA",
  "US|VA|fredericksburg": "Fredericksburg, VA",
  outside_launch_markets: "Outside the launch markets",
  market_not_recorded: "Market not recorded",
};

/** `couranr_merchant_workspaces.business_category` CHECK constraint. */
export const CATEGORY_LABELS: Record<string, string> = {
  dry_cleaning_laundry_tailoring: "Dry cleaning, laundry and tailoring",
  printing_signage_promotional: "Printing, signage and promotional",
  boutique_clothing_shoes_accessories: "Boutique clothing, shoes and accessories",
  florists_gifts_specialty_retail: "Florists, gifts and specialty retail",
  repair_and_electronics: "Repair and electronics",
  auto_parts_and_accessories: "Auto parts and accessories",
  furniture_and_home_goods: "Furniture and home goods",
  event_rentals_and_supplies: "Event rentals and supplies",
  bakeries_prepared_food_catering: "Bakeries, prepared food and catering",
  books_cards_collectibles_hobby: "Books, cards, collectibles and hobby",
  general_local_business: "General local business",
  category_not_recorded: "Category not recorded",
};

/** Fallback that keeps an unknown-but-governed key readable without inventing
 *  a meaning for it. Never applied to free text: nothing free-text gets here. */
export function humanizeKey(key: string): string {
  if (!key) return "Not recorded";
  const spaced = key.replace(/[_|]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function labelFor(map: Record<string, string>, key: string): string {
  return map[key] ?? humanizeKey(key);
}

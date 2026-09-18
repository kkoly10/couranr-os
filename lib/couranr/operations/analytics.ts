import { assertServerOnly } from "@/lib/couranr/serverOnly";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isCouranrAutoApprovedMarket } from "@/lib/couranr/routing/market";
import {
  CATEGORY_LABELS,
  CAUSE_LABELS,
  DECLINE_REASON_LABELS,
  DISTANCE_BAND_LABELS,
  MARKET_LABELS,
  QUOTE_STATUS_LABELS,
  SERVICE_AREA_LABELS,
  WEIGHT_BAND_LABELS,
  labelFor,
  type CountBucket,
  type MoneyBucket,
  type OperationsAnalytics,
  type Panel,
  type PanelState,
  type UnmetDemandAnalytics,
  type UnmetDemandRequestRef,
} from "./analyticsTypes";

assertServerOnly("lib/couranr/operations/analytics.ts");

/**
 * OPS-013 Operations analytics and OPS-014 Unmet demand analytics.
 *
 * ── Every figure traces to a query over a real table ─────────────────────
 * There is no telemetry pipeline behind this and it does not need one. P10-001
 * (analytics events) is not started and is NOT a prerequisite: the facts are
 * already in the canonical tables and their append-only event logs. Nothing
 * here is estimated, modelled, extrapolated or defaulted to zero — a measure
 * with no source column renders `not_measurable` with its reason, and an empty
 * database renders `empty`, never zeros dressed as measurements.
 *
 * ── The privacy constraint is STRUCTURAL, not editorial ──────────────────
 * OPS-013: "No message bodies, full addresses, gate codes, phone numbers,
 * proof URLs, or card data in analytics." Three independent mechanisms, so
 * that no single lapse is enough to breach it:
 *
 *  1. PROJECTION. Every `.select()` below names its columns explicitly and
 *     names no column that can hold free text, an address, a credential or a
 *     provider payload. The columns deliberately NOT selected anywhere in this
 *     file are the interesting ones: `pickup_address`/`dropoff_address` (whole),
 *     `recipient`, `recipient_phone`, `recipient_email`, `consumer_contact_snapshot`,
 *     `normalized_request_payload`, `pickup_manifest`, `quote_line_items`,
 *     `couranr_delivery_request_events.metadata` (whole — it carries
 *     `internalNote`, `merchantMessage` and a free-text cancellation `reason`),
 *     `couranr_payment_events.detail` (the provider payload — the card-data
 *     vector), `couranr_delivery_incident_events.note`,
 *     `couranr_delivery_incidents.summary`, `couranr_customer_problem_reports.details`,
 *     `couranr_delivery_proofs.storage_bucket`/`storage_object_path`/`metadata`
 *     and its capture coordinates. Address is read ONLY as
 *     `pickup_address->>city|region|countryCode`, and even those never leave
 *     this module — see 2.
 *
 *  2. CLOSED OUTPUT VOCABULARY. `bucketize` maps any key outside the declared
 *     allow-list for its dimension onto `unrecognised`. A value cannot escape
 *     into a bucket key by being unexpected, so poisoning even a CHECK-
 *     constrained column leaks nothing. The three verified pickup-address
 *     fields are consumed by the launch-market classifier and only its verdict
 *     — one of six closed keys — is emitted.
 *
 *  3. NO ROW-LEVEL EXPORT. The only per-row values that leave are UUIDs and
 *     ISO timestamps. "Drill down" and "open underlying requests" mean linking
 *     by id to `/operations/deliveries/{id}`, which already authorizes its own
 *     reader — not reproducing personal data here.
 *
 * `tests/couranr-operations-analytics.test.ts` drives poisoned rows through the
 * real aggregation and asserts none of the poison appears anywhere in the
 * output, and separately scans this file for a forbidden projection.
 */

/* ------------------------------------------------------------- source rows */

/**
 * The projected shape of each source. These describe what is SELECTED, which
 * is the first privacy control: a column absent from this type is a column no
 * aggregate can accidentally carry.
 */
export type RequestRow = {
  id: string;
  business_account_id: string | null;
  created_at: string;
  submitted_at: string | null;
  request_state: string;
  review_state: string;
  service_area_review_state: string;
  quote_status: string;
  payer_type: string;
  requester_kind: string;
  service_level: string;
  weight_band: string | null;
  restricted_class: string | null;
  loaded_miles: number | string | null;
  billable_loaded_miles: number | string | null;
  review_reasons: unknown;
  timing_review_reasons: unknown;
  /** `pickup_address->>city`. Consumed by the classifier; never emitted. */
  pickup_city: string | null;
  /** `pickup_address->>region`. Consumed by the classifier; never emitted. */
  pickup_region: string | null;
  /** `pickup_address->>countryCode`. Consumed by the classifier; never emitted. */
  pickup_country: string | null;
};

export type DeliveryRow = {
  id: string;
  request_id: string;
  business_account_id: string | null;
  created_at: string;
  fulfillment_state: string;
  service_level: string;
  proof_method: string;
  plan_source: string;
  promotional_credit_cents: number | null;
  standard_quote_cents: number | null;
};

export type ObligationRow = {
  id: string;
  request_id: string;
  created_at: string;
  payer_type: string;
  payment_state: string;
  amount_cents: number | null;
  captured_at: string | null;
  captured_amount_cents: number | null;
  refunded_at: string | null;
  refunded_amount_cents: number | null;
};

/**
 * Terminal request events, projected down to the ONE governed field that
 * matters. `metadata` as a whole is never selected: it carries `internalNote`
 * (free operator text the decline migration states no merchant- or customer-
 * facing read path may select), `merchantMessage`, and — for a cancellation —
 * an entirely ungoverned free-text `reason`.
 */
export type TerminalEventRow = {
  request_id: string;
  actor_type: string;
  command: string;
  created_at: string;
  /** `metadata->>reasonCode`. A `couranr-decline-v1` code, or null. */
  reason_code: string | null;
};

export type ProofRow = {
  delivery_id: string;
  proof_stage: string;
  proof_type: string;
  created_at: string;
};

export type AssignmentRow = {
  id: string;
  delivery_id: string;
  driver_id: string;
  assignment_state: string;
  created_at: string;
};

export type DriverRow = { id: string; driver_state: string; active: boolean };
export type IncidentRow = { id: string; incident_type: string; incident_state: string; created_at: string };
export type ProblemReportRow = { id: string; problem_type: string; report_state: string; created_at: string };
export type ConversationRow = { id: string; kind: string; status: string; due_state: string | null; created_at: string };
export type WorkspaceRow = { business_account_id: string; business_category: string };

export type AnalyticsSource = {
  requests: RequestRow[];
  deliveries: DeliveryRow[];
  obligations: ObligationRow[];
  proofs: ProofRow[];
  assignments: AssignmentRow[];
  drivers: DriverRow[];
  incidents: IncidentRow[];
  problemReports: ProblemReportRow[];
  conversations: ConversationRow[];
  workspaces: WorkspaceRow[];
  truncatedSources: string[];
};

export type UnmetDemandSource = {
  requests: RequestRow[];
  terminalEvents: TerminalEventRow[];
  workspaces: WorkspaceRow[];
  truncatedSources: string[];
};

export type AnalyticsFilters = {
  /** Trailing window in days, or null for all recorded history. */
  days: number | null;
  market: string | null;
  category: string | null;
  payer: string | null;
};

export const DEFAULT_FILTERS: AnalyticsFilters = {
  days: 30,
  market: null,
  category: null,
  payer: null,
};

/* ------------------------------------------------------- closed vocabularies
 *
 * Each list is the CHECK constraint on the column it buckets, read from the
 * live catalog rather than from memory. `bucketize` refuses anything else, so
 * these lists are the whole of what this surface can ever emit as a key.
 */

const REQUEST_STATES = [
  "draft", "awaiting_merchant_confirmation", "awaiting_quote_acceptance",
  "pending_couranr_review", "quote_revision_required", "confirmed",
  "declined", "cancelled", "closed",
] as const;

const FULFILLMENT_STATES = [
  "scheduled", "assigned", "en_route_to_pickup", "at_pickup", "picked_up",
  "in_transit", "at_dropoff", "delivered", "could_not_deliver", "cancelled",
  "return_required", "returning", "returned",
] as const;

const PAYER_TYPES = ["merchant", "customer"] as const;
const REQUESTER_KINDS = ["business", "consumer"] as const;
const SERVICE_AREA_STATES = ["pending", "in_area", "out_of_area_review", "declined"] as const;
const QUOTE_STATUSES = ["not_quoted", "estimated", "manual_review_required", "invalid"] as const;
const WEIGHT_BANDS = ["0_25_lb", "over_25_to_50_lb", "over_50_lb", "unknown", "not_recorded"] as const;
const DISTANCE_BANDS = ["0_2", "2_10", "10_25", "over_25", "not_recorded"] as const;
const PROOF_STAGES = ["pickup", "dropoff", "pickup_discrepancy", "return"] as const;
const PROOF_TYPES = [
  "shipment_photo", "condition_photo", "securement_photo", "discrepancy_evidence",
  "delivery_photo", "signature", "recipient_pin", "return_condition_photo",
  "item_prepack_photo", "sealed_package_photo", "dropoff_seal_photo",
] as const;
const ASSIGNMENT_STATES = ["active", "completed", "replaced", "cancelled"] as const;
const INCIDENT_TYPES = [
  "recipient_unavailable", "address_access", "weather_safety", "damage",
  "wrong_item", "missing_item", "unsafe_handling", "delivery_failure", "other",
  "seal_integrity",
] as const;
const PROBLEM_TYPES = ["damaged", "missing", "wrong_item", "undelivered"] as const;
const RESTRICTED_CLASSES = [
  "none", "unknown", "alcohol", "tobacco", "vaping_nicotine", "cannabis_thc",
  "firearms", "ammunition", "prescription_medication", "controlled_substances",
  "fuel", "compressed_gas", "corrosive_hazmat", "toxic_hazmat",
  "infectious_material", "regulated_dangerous_goods", "fireworks", "explosives",
  "illegal_goods", "stolen_goods", "cash", "negotiable_instruments",
  "biological_specimens", "live_animals", "people", "not_recorded",
] as const;
const CATEGORIES = Object.keys(CATEGORY_LABELS);
const MARKETS = Object.keys(MARKET_LABELS);
const CAUSES = Object.keys(CAUSE_LABELS);

/** `lib/couranr/pricing/types.ts` ReviewReasonCode. */
const REVIEW_REASONS = [
  "over_max_automatic_miles", "large_item_review",
  "overnight_requires_couranr_confirmation", "over_max_automatic_traffic_delay",
  "route_needs_review", "weight_unresolved", "timing_needs_review",
  "shipment_policy_review", "safety_declaration_required", "shipment_prohibited",
  "traffic_evidence_unavailable",
] as const;

/** `lib/couranr/timing/policy.ts` TimingReviewReason. */
const TIMING_REASONS = [
  "requested_time_in_past", "requested_time_unparseable",
  "requested_time_nonexistent", "requested_time_ambiguous",
  "requested_time_on_non_business_day",
  "overnight_requires_couranr_confirmation", "same_day_after_cutoff",
] as const;

/*
 * READ FROM THE CONSTRAINT, NOT FROM MEMORY.
 *
 * The first version of these two lists was reasoned out rather than looked up,
 * and both were wrong: the kinds were guessed as support/help/delivery, and
 * `overdueConversations` counted a `due_state` of "breached" — a value the
 * CHECK constraint does not permit, so the measure could only ever have been
 * zero. A live read caught it, because every real conversation landed in the
 * `unrecognised` bucket. `tests/couranr-operations-analytics.test.ts` now pins
 * every vocabulary in this file to the CHECK constraint in the migrations.
 */
const CONVERSATION_KINDS = ["merchant_support", "delivery_chat", "delivery_help"] as const;
const CONVERSATION_DUE_STATES = ["on_time", "due_soon", "overdue"] as const;
const CONVERSATION_KIND_LABELS: Record<string, string> = {
  merchant_support: "Merchant support",
  delivery_chat: "Delivery chat",
  delivery_help: "Delivery help",
};
const CONVERSATION_DUE_LABELS: Record<string, string> = {
  on_time: "On time",
  due_soon: "Due soon",
  overdue: "Overdue",
};

/**
 * The one key that is not a vocabulary member: everything the allow-list did
 * not recognise. It exists so an unrecognised value is COUNTED rather than
 * dropped (dropping would silently understate a total) and never PRINTED.
 */
export const UNRECOGNISED_KEY = "unrecognised";
const UNRECOGNISED_LABEL = "Unrecognised value (not shown)";

/* ---------------------------------------------------------------- utilities */

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNum(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** ISO-8601 only. A timestamp is the only non-id free string this surface emits. */
function isoOrEmpty(value: unknown): string {
  const s = typeof value === "string" ? value : "";
  return /^\d{4}-\d{2}-\d{2}[T ]/.test(s) ? s : "";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A UUID or nothing. An id that is not a UUID is not an id we will print. */
function uuidOrEmpty(value: unknown): string {
  const s = typeof value === "string" ? value : "";
  return UUID_RE.test(s) ? s : "";
}

/**
 * Counts rows into buckets, refusing any key the dimension does not declare.
 *
 * This is mechanism 2 of the privacy contract. A key outside `allowed` is
 * counted under `unrecognised` and its actual value is discarded here, so no
 * database value can reach a bucket key by being unexpected — including a
 * value written directly to a CHECK-constrained column by a future migration,
 * and including anything a caller could contrive to store.
 */
export function bucketize(
  keys: Array<string | null | undefined>,
  allowed: readonly string[],
  labels: Record<string, string>
): CountBucket[] {
  const allow = new Set(allowed);
  const counts = new Map<string, number>();
  for (const raw of keys) {
    const key = typeof raw === "string" && allow.has(raw) ? raw : UNRECOGNISED_KEY;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({
      key,
      label: key === UNRECOGNISED_KEY ? UNRECOGNISED_LABEL : labelFor(labels, key),
      count,
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** `bucketize`, plus captured money per bucket. Same closed-key guarantee. */
function moneyBucketize(
  entries: Array<{ key: string | null | undefined; capturedCents: number }>,
  allowed: readonly string[],
  labels: Record<string, string>
): MoneyBucket[] {
  const allow = new Set(allowed);
  const acc = new Map<string, { count: number; capturedCents: number }>();
  for (const entry of entries) {
    const key =
      typeof entry.key === "string" && allow.has(entry.key) ? entry.key : UNRECOGNISED_KEY;
    const current = acc.get(key) ?? { count: 0, capturedCents: 0 };
    current.count += 1;
    current.capturedCents += num(entry.capturedCents);
    acc.set(key, current);
  }
  return [...acc.entries()]
    .map(([key, v]) => ({
      key,
      label: key === UNRECOGNISED_KEY ? UNRECOGNISED_LABEL : labelFor(labels, key),
      count: v.count,
      capturedCents: v.capturedCents,
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/**
 * Wraps buckets in a panel state.
 *
 * `empty` when nothing was measured — never a row of zeros. `partial` when the
 * panel could not attribute every source row, with the shortfall surfaced
 * rather than folded into a bucket.
 */
function panel<T extends CountBucket>(
  rows: T[],
  opts: { unattributed?: number; multiValued?: boolean } = {}
): Panel<T> {
  const total = rows.reduce((a, b) => a + b.count, 0);
  const unattributed = opts.unattributed ?? 0;
  let state: PanelState = "live";
  if (total === 0 && unattributed === 0) state = "empty";
  else if (unattributed > 0) state = "partial";
  return {
    state,
    rows,
    ...(unattributed > 0 ? { unattributed } : {}),
    ...(opts.multiValued ? { multiValued: true } : {}),
  };
}

function notMeasurable(reason: string): Panel<never> {
  return { state: "not_measurable", rows: [], reason };
}

/** A jsonb text[] column, defended against every non-array shape. */
function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/**
 * The market of a request, as the launch-market classifier sees it.
 *
 * The three verified address fields go in; one of six closed keys comes out.
 * `lib/couranr/routing/market.ts` (PR #38) is the authority for what a Couranr
 * market IS — four exact cities — so a pickup anywhere else is not a market
 * with a different name, it is outside the launch markets. That is also why no
 * unserved city name can ever be printed by this surface.
 */
export function classifyMarket(row: {
  pickup_city: string | null;
  pickup_region: string | null;
  pickup_country: string | null;
}): string {
  const city = (row.pickup_city ?? "").trim();
  const region = (row.pickup_region ?? "").trim();
  const countryCode = (row.pickup_country ?? "").trim();
  if (!city || !region || !countryCode) return "market_not_recorded";
  if (!isCouranrAutoApprovedMarket({ city, region, countryCode })) {
    return "outside_launch_markets";
  }
  return `${countryCode.toUpperCase()}|${region.toUpperCase()}|${city.toLowerCase()}`;
}

/** Pricing Authority V2 boundaries: 2 included, then 10, then 25, then review. */
export function distanceBand(miles: number | null): string {
  if (miles === null) return "not_recorded";
  if (miles <= 2) return "0_2";
  if (miles <= 10) return "2_10";
  if (miles <= 25) return "10_25";
  return "over_25";
}

/* ------------------------------------------------------- OPS-013 aggregation */

/**
 * The OPS-013 aggregation. PURE: rows in, measures out, no clock of its own
 * beyond `generatedAt`, no I/O. That is what makes the privacy guarantee
 * testable — `tests/couranr-operations-analytics.test.ts` calls exactly this
 * function with poisoned rows.
 */
export function aggregateOperationsAnalytics(
  source: AnalyticsSource,
  filters: AnalyticsFilters,
  generatedAt: string
): OperationsAnalytics {
  const categoryOf = new Map(source.workspaces.map((w) => [w.business_account_id, w.business_category]));
  const marketOf = new Map(source.requests.map((r) => [r.id, classifyMarket(r)]));

  /* Dimension filters are applied to REQUESTS first, and every other source is
     then scoped through the request ids that survived — so a filter cannot
     leave a delivery counted whose request was filtered out. */
  const requests = source.requests.filter((r) => {
    if (filters.market && marketOf.get(r.id) !== filters.market) return false;
    if (filters.category && categoryOf.get(r.business_account_id ?? "") !== filters.category) return false;
    if (filters.payer && r.payer_type !== filters.payer) return false;
    return true;
  });
  const requestIds = new Set(requests.map((r) => r.id));

  const deliveries = source.deliveries.filter((d) => requestIds.has(d.request_id));
  const obligations = source.obligations.filter((o) => requestIds.has(o.request_id));
  const deliveryIds = new Set(deliveries.map((d) => d.id));
  const proofs = source.proofs.filter((p) => deliveryIds.has(p.delivery_id));
  const assignments = source.assignments.filter((a) => deliveryIds.has(a.delivery_id));

  /* Captured, never authorized: an authorization is a hold, not revenue. The
     Operations payments dashboard states the same rule for the same reason. */
  const captured = obligations.filter((o) => o.captured_at !== null);
  const capturedByRequest = new Map<string, number>();
  for (const o of captured) {
    /* `couranr_po_captured_amount_chk` constrains captured_amount_cents to
       equal amount_cents whenever it is set, so the fallback cannot disagree
       with the capture; it only covers a row that stamped the timestamp
       without the amount. */
    const cents = num(o.captured_amount_cents ?? o.amount_cents);
    capturedByRequest.set(o.request_id, (capturedByRequest.get(o.request_id) ?? 0) + cents);
  }

  const capturedCents = captured.reduce(
    (a, o) => a + num(o.captured_amount_cents ?? o.amount_cents),
    0
  );
  const refundedCents = obligations.reduce((a, o) => a + num(o.refunded_amount_cents), 0);
  /* DISTINCT REQUESTS, not obligations. Nothing in the schema limits a request
     to one obligation — supersession creates a second row — so counting
     obligations would report two paid deliveries for one delivery the day that
     happens. A request with a capture is one paid delivery. */
  const paidRequestIds = new Set(captured.map((o) => o.request_id));
  const paidDeliveryCount = paidRequestIds.size;

  const perDriver = new Map<string, number>();
  for (const a of assignments) {
    const id = uuidOrEmpty(a.driver_id);
    if (!id) continue;
    perDriver.set(id, (perDriver.get(id) ?? 0) + 1);
  }
  const driverIdsSeen = [...perDriver.keys()];

  const deliveredIds = new Set(
    deliveries.filter((d) => d.fulfillment_state === "delivered").map((d) => d.id)
  );
  const withDropoffProof = new Set(
    proofs.filter((p) => p.proof_stage === "dropoff" && deliveredIds.has(p.delivery_id))
      .map((p) => p.delivery_id)
  );

  const conversations = source.conversations;
  const overdueConversations = conversations.filter((c) => c.due_state === "overdue").length;

  const anyData =
    requests.length > 0 ||
    deliveries.length > 0 ||
    obligations.length > 0 ||
    conversations.length > 0 ||
    source.incidents.length > 0 ||
    source.problemReports.length > 0;

  return {
    generatedAt,
    windowDays: filters.days,
    state: !anyData ? "empty" : source.truncatedSources.length > 0 ? "partial" : "live",
    requestsInWindow: requests.length,

    paidDeliveries: {
      count: paidDeliveryCount,
      /* The SAME set the count above uses. Keying this off a positive captured
         amount instead would disagree with the count for a delivery captured
         at zero — fully covered by promotional credit — which is a real case:
         the one delivery in the live project today is exactly that shape. */
      byFulfillmentState: panel(
        bucketize(
          deliveries
            .filter((d) => paidRequestIds.has(d.request_id))
            .map((d) => d.fulfillment_state),
          FULFILLMENT_STATES,
          {}
        )
      ),
    },

    markets: panel(
      moneyBucketize(
        requests.map((r) => ({
          key: marketOf.get(r.id) ?? "market_not_recorded",
          capturedCents: capturedByRequest.get(r.id) ?? 0,
        })),
        MARKETS,
        MARKET_LABELS
      )
    ),

    categories: panel(
      moneyBucketize(
        requests.map((r) => ({
          key: categoryOf.get(r.business_account_id ?? "") ?? "category_not_recorded",
          capturedCents: capturedByRequest.get(r.id) ?? 0,
        })),
        CATEGORIES,
        CATEGORY_LABELS
      )
    ),

    payerMix: panel(
      moneyBucketize(
        obligations.map((o) => ({
          key: o.payer_type,
          capturedCents: o.captured_at ? num(o.captured_amount_cents ?? o.amount_cents) : 0,
        })),
        PAYER_TYPES,
        { merchant: "Merchant pays", customer: "Customer pays" }
      )
    ),

    requesterMix: panel(
      moneyBucketize(
        requests.map((r) => ({
          key: r.requester_kind,
          capturedCents: capturedByRequest.get(r.id) ?? 0,
        })),
        REQUESTER_KINDS,
        { business: "Business request", consumer: "Consumer request" }
      )
    ),

    economics: {
      capturedCents,
      refundedCents,
      netCapturedCents: capturedCents - refundedCents,
      promotionalCreditCents: deliveries.reduce((a, d) => a + num(d.promotional_credit_cents), 0),
      standardQuoteCents: deliveries.reduce((a, d) => a + num(d.standard_quote_cents), 0),
      paidDeliveryCount,
      /* null, not 0: "no paid delivery yet" is not "an average of nothing". */
      averageCapturedCents:
        paidDeliveryCount === 0 ? null : Math.round(capturedCents / paidDeliveryCount),
    },

    support: {
      conversations: panel(
        bucketize(conversations.map((c) => c.kind), CONVERSATION_KINDS, CONVERSATION_KIND_LABELS)
      ),
      conversationsByDueState: panel(
        bucketize(
          conversations.map((c) => c.due_state),
          CONVERSATION_DUE_STATES,
          CONVERSATION_DUE_LABELS
        )
      ),
      problemReports: panel(
        bucketize(source.problemReports.map((p) => p.problem_type), PROBLEM_TYPES, {
          damaged: "Damaged", missing: "Missing", wrong_item: "Wrong item",
          undelivered: "Undelivered",
        })
      ),
      incidents: panel(bucketize(source.incidents.map((i) => i.incident_type), INCIDENT_TYPES, {})),
      overdueConversations,
    },

    proof: {
      byStage: panel(bucketize(proofs.map((p) => p.proof_stage), PROOF_STAGES, {})),
      byType: panel(bucketize(proofs.map((p) => p.proof_type), PROOF_TYPES, {})),
      deliveredWithDropoffProof: withDropoffProof.size,
      deliveredWithoutDropoffProof: deliveredIds.size - withDropoffProof.size,
    },

    driverUtilization: {
      activeDrivers: source.drivers.filter((d) => d.driver_state === "active").length,
      driversWithAssignments: driverIdsSeen.length,
      assignmentsByState: panel(
        bucketize(assignments.map((a) => a.assignment_state), ASSIGNMENT_STATES, {})
      ),
      /* Keyed by driver id, never by name or contact. The id is what drills
         down; the identity lives on the Operations drivers surface, which
         authorizes its own reader. */
      perDriver: panel(
        driverIdsSeen
          .map((id) => ({ key: id, label: `Driver ${id.slice(0, 8)}`, count: perDriver.get(id) ?? 0 }))
          .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
      ),
      /* NOT DERIVABLE, and said so rather than approximated. A utilization
         RATE needs time on delivery over time available. `couranr_drivers`
         carries `availability_state` as a CURRENT flag with no history table,
         and no table records a driver's scheduled hours, so the denominator
         does not exist. Dividing assignments by active drivers and calling it
         utilization would be a fabricated measurement. */
      utilizationRate: notMeasurable(
        "Utilization as a percentage needs time on delivery against time available. " +
          "Couranr records a driver's availability as a current flag with no history, " +
          "and records no scheduled hours at all, so there is no denominator to divide by. " +
          "Assignment counts are the measure that exists today."
      ),
    },

    truncatedSources: source.truncatedSources,
  };
}

/* ------------------------------------------------------- OPS-014 aggregation */

/** Request states that were never put to Couranr at all (submitted_at is null). */
const NEVER_SUBMITTED = new Set(["draft", "awaiting_merchant_confirmation"]);
/** In flight. Not refused, not lost — still open. */
const STILL_OPEN = new Set([
  "awaiting_quote_acceptance", "pending_couranr_review", "quote_revision_required",
]);
/** The could-not-confirm universe, and nothing else. */
const COULD_NOT_CONFIRM = new Set(["declined", "cancelled", "closed"]);

/**
 * Attribute ONE could-not-confirm request to ONE cause, from recorded facts.
 *
 * This is the function OPS-014's constraint is about. "Use actual
 * could-not-confirm reasons; do not treat all unfulfilled requests as lost
 * customers." So:
 *
 *  - A DECLINE carries a governed `couranr-decline-v1` code in its event
 *    metadata, derived at write time from the same `case` that derives the
 *    merchant message, so the code and the message cannot disagree. That code
 *    is the cause. A decline with no such code is `declined_reason_not_recorded`
 *    — an honest gap, not a guess.
 *  - A CANCELLATION's reason is FREE TEXT (`couranr_cancel_delivery_request`
 *    stores `btrim(p_reason)` with no vocabulary at all), so it is not a cause
 *    and is never read. What IS recorded and constrained is the actor, so the
 *    cause names the actor: cancelled BY Operations is a different fact from
 *    declined BY Couranr and from outside-the-service-area, and the three are
 *    never summed.
 *  - Anything with no terminal event at all is `unattributed`. The registry's
 *    own OPS-014 state is "partial attribution"; unattributed is shown as
 *    itself and never folded into a cause.
 *
 * Precedence is decline-then-cancel-then-state because a request reaches at
 * most one terminal state, and the governed code is strictly more informative
 * than the actor.
 */
export function attributeCause(
  request: RequestRow,
  events: TerminalEventRow[]
): string {
  const decline = events.find((e) => e.command === "decline_delivery_request");
  if (decline) {
    const code = decline.reason_code;
    if (typeof code === "string" && code in DECLINE_REASON_LABELS) return code;
    return "declined_reason_not_recorded";
  }

  const cancel = events.find((e) => e.command === "cancel_delivery_request");
  if (cancel) {
    const byActor = `cancelled_by_${cancel.actor_type}`;
    return byActor in CAUSE_LABELS ? byActor : "cancelled_actor_not_recorded";
  }

  if (request.request_state === "declined") return "declined_reason_not_recorded";
  if (request.request_state === "cancelled") return "cancelled_actor_not_recorded";
  if (request.request_state === "closed") return "closed_without_recorded_cause";
  return "unattributed";
}

/** The OPS-014 aggregation. PURE, for the same reason as its OPS-013 sibling. */
export function aggregateUnmetDemand(
  source: UnmetDemandSource,
  filters: AnalyticsFilters,
  generatedAt: string
): UnmetDemandAnalytics {
  const categoryOf = new Map(source.workspaces.map((w) => [w.business_account_id, w.business_category]));
  const marketOf = new Map(source.requests.map((r) => [r.id, classifyMarket(r)]));

  const requests = source.requests.filter((r) => {
    if (filters.market && marketOf.get(r.id) !== filters.market) return false;
    if (filters.category && categoryOf.get(r.business_account_id ?? "") !== filters.category) return false;
    if (filters.payer && r.payer_type !== filters.payer) return false;
    return true;
  });

  const universe = {
    confirmed: requests.filter((r) => r.request_state === "confirmed").length,
    neverSubmitted: requests.filter((r) => NEVER_SUBMITTED.has(r.request_state)).length,
    stillOpen: requests.filter((r) => STILL_OPEN.has(r.request_state)).length,
    couldNotConfirm: requests.filter((r) => COULD_NOT_CONFIRM.has(r.request_state)).length,
  };

  const unmet = requests.filter((r) => COULD_NOT_CONFIRM.has(r.request_state));

  const eventsByRequest = new Map<string, TerminalEventRow[]>();
  for (const e of source.terminalEvents) {
    const list = eventsByRequest.get(e.request_id) ?? [];
    list.push(e);
    eventsByRequest.set(e.request_id, list);
  }

  const causeOf = new Map<string, string>();
  for (const r of unmet) causeOf.set(r.id, attributeCause(r, eventsByRequest.get(r.id) ?? []));
  const unattributed = [...causeOf.values()].filter((c) => c === "unattributed").length;

  /* Review and timing triggers are ARRAYS: one request can carry several, so
     these buckets do not sum to the request count and the panel says so. */
  const reviewReasons = unmet.flatMap((r) => stringArray(r.review_reasons));
  const timingReasons = unmet.flatMap((r) => stringArray(r.timing_review_reasons));

  const byDayCounts = new Map<string, number>();
  for (const r of unmet) {
    const day = isoOrEmpty(r.created_at).slice(0, 10);
    if (!day) continue;
    byDayCounts.set(day, (byDayCounts.get(day) ?? 0) + 1);
  }
  const byDay = [...byDayCounts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, count]) => ({ key: day, label: day, count }));

  const recent: UnmetDemandRequestRef[] = unmet
    .slice()
    .sort((a, b) => isoOrEmpty(b.created_at).localeCompare(isoOrEmpty(a.created_at)))
    .slice(0, 50)
    .map((r) => ({
      requestId: uuidOrEmpty(r.id),
      requestState: REQUEST_STATES.includes(r.request_state as never)
        ? r.request_state
        : UNRECOGNISED_KEY,
      cause: causeOf.get(r.id) ?? "unattributed",
      createdAt: isoOrEmpty(r.created_at),
    }))
    .filter((r) => r.requestId !== "");

  return {
    generatedAt,
    windowDays: filters.days,
    state:
      requests.length === 0
        ? "empty"
        : source.truncatedSources.length > 0
          ? "partial"
          : unattributed > 0
            ? "partial"
            : "live",
    universe,
    causes: panel(bucketize([...causeOf.values()], CAUSES, CAUSE_LABELS), { unattributed }),
    unattributed,
    serviceArea: panel(
      bucketize(unmet.map((r) => r.service_area_review_state), SERVICE_AREA_STATES, SERVICE_AREA_LABELS)
    ),
    quoteDisposition: panel(
      bucketize(unmet.map((r) => r.quote_status), QUOTE_STATUSES, QUOTE_STATUS_LABELS)
    ),
    reviewTriggers: panel(bucketize(reviewReasons, REVIEW_REASONS, {}), { multiValued: true }),
    timingTriggers: panel(bucketize(timingReasons, TIMING_REASONS, {}), { multiValued: true }),
    categories: panel(
      bucketize(
        unmet.map((r) => categoryOf.get(r.business_account_id ?? "") ?? "category_not_recorded"),
        CATEGORIES,
        CATEGORY_LABELS
      )
    ),
    markets: panel(
      bucketize(unmet.map((r) => marketOf.get(r.id) ?? "market_not_recorded"), MARKETS, MARKET_LABELS)
    ),
    distanceBands: panel(
      bucketize(
        unmet.map((r) =>
          distanceBand(optionalNum(r.billable_loaded_miles) ?? optionalNum(r.loaded_miles))
        ),
        DISTANCE_BANDS,
        DISTANCE_BAND_LABELS
      )
    ),
    weightBands: panel(
      bucketize(unmet.map((r) => r.weight_band ?? "not_recorded"), WEIGHT_BANDS, WEIGHT_BAND_LABELS)
    ),
    restrictedClasses: panel(
      bucketize(unmet.map((r) => r.restricted_class ?? "not_recorded"), RESTRICTED_CLASSES, {})
    ),
    byDay: panel(byDay),
    recent,
    truncatedSources: source.truncatedSources,
  };
}

/* ------------------------------------------------------------------- loading */

/** One source's row cap. A source that hits it is reported as truncated, so a
 *  count is read as a floor rather than believed as a total. */
const ROW_CAP = 5000;

type Fetched<T> = { rows: T[]; truncated: boolean };

async function fetchRows<T>(
  name: string,
  build: () => any,
  failures: string[]
): Promise<Fetched<T>> {
  const { data, error } = await build().limit(ROW_CAP);
  if (error) {
    failures.push(name);
    return { rows: [], truncated: false };
  }
  const rows = (Array.isArray(data) ? data : []) as T[];
  return { rows, truncated: rows.length >= ROW_CAP };
}

function sinceIso(days: number | null, now: number): string | null {
  if (days === null) return null;
  return new Date(now - days * 86_400_000).toISOString();
}

/**
 * The request projection, shared by both tabs.
 *
 * Note what is here and what is not. `pickup_address` is projected down to its
 * three verified classification fields with PostgREST's `->>` operator — the
 * same shape `lib/couranr/requests/commands.ts` already uses — so `line1`,
 * `line2`, `instructions`, `postalCode`, `formattedAddress` and the capture
 * coordinates are never read at all, let alone emitted.
 */
const REQUEST_SELECT =
  "id,business_account_id,created_at,submitted_at,request_state,review_state," +
  "service_area_review_state,quote_status,payer_type,requester_kind,service_level," +
  "weight_band,restricted_class,loaded_miles,billable_loaded_miles,review_reasons," +
  "timing_review_reasons,pickup_city:pickup_address->>city," +
  "pickup_region:pickup_address->>region,pickup_country:pickup_address->>countryCode";

export type LoadFailure = { ok: false; failedSources: string[] };
export type LoadResult<T> = { ok: true; value: T } | LoadFailure;

/**
 * `tsconfig` sets `"strict": false`; without `strictNullChecks` a bare
 * `if (!r.ok)` does not narrow this union. An explicit predicate does — the
 * same reason `isActorDenied` and `isApiFailure` exist.
 */
export function isLoadFailure(r: { ok: boolean }): r is LoadFailure {
  return r.ok === false;
}

/** OPS-013. Reads the canonical tables; derives every figure from them. */
export async function loadOperationsAnalytics(
  filters: AnalyticsFilters,
  nowMs: number = Date.now()
): Promise<LoadResult<OperationsAnalytics>> {
  const since = sinceIso(filters.days, nowMs);
  const failures: string[] = [];
  const scope = (q: any, column = "created_at") => (since ? q.gte(column, since) : q);

  const [
    requests, deliveries, obligations, proofs, assignments, drivers,
    incidents, problemReports, conversations, workspaces,
  ] = await Promise.all([
    fetchRows<RequestRow>("requests", () =>
      scope(supabaseAdmin.from("couranr_delivery_requests").select(REQUEST_SELECT)), failures),
    fetchRows<DeliveryRow>("deliveries", () =>
      scope(supabaseAdmin.from("couranr_deliveries").select(
        "id,request_id,business_account_id,created_at,fulfillment_state,service_level," +
        "proof_method,plan_source,promotional_credit_cents,standard_quote_cents")), failures),
    fetchRows<ObligationRow>("obligations", () =>
      scope(supabaseAdmin.from("couranr_payment_obligations").select(
        "id,request_id,created_at,payer_type,payment_state,amount_cents,captured_at," +
        "captured_amount_cents,refunded_at,refunded_amount_cents")), failures),
    fetchRows<ProofRow>("proofs", () =>
      scope(supabaseAdmin.from("couranr_delivery_proofs").select(
        "delivery_id,proof_stage,proof_type,created_at")), failures),
    fetchRows<AssignmentRow>("assignments", () =>
      scope(supabaseAdmin.from("couranr_delivery_assignments").select(
        "id,delivery_id,driver_id,assignment_state,created_at")), failures),
    fetchRows<DriverRow>("drivers", () =>
      supabaseAdmin.from("couranr_drivers").select("id,driver_state,active"), failures),
    fetchRows<IncidentRow>("incidents", () =>
      scope(supabaseAdmin.from("couranr_delivery_incidents").select(
        "id,incident_type,incident_state,created_at")), failures),
    fetchRows<ProblemReportRow>("problemReports", () =>
      scope(supabaseAdmin.from("couranr_customer_problem_reports").select(
        "id,problem_type,report_state,created_at")), failures),
    fetchRows<ConversationRow>("conversations", () =>
      scope(supabaseAdmin.from("couranr_conversations").select(
        "id,kind,status,due_state,created_at")), failures),
    fetchRows<WorkspaceRow>("workspaces", () =>
      supabaseAdmin.from("couranr_merchant_workspaces").select(
        "business_account_id,business_category"), failures),
  ]);

  /* FAIL CLOSED. A source that errored is indistinguishable from a source with
     no rows, and "the query failed" rendered as "there were none" is exactly
     how this repo once told an established merchant they were new. */
  if (failures.length > 0) return { ok: false, failedSources: failures };

  const sources: Array<[string, Fetched<unknown>]> = [
    ["requests", requests], ["deliveries", deliveries], ["obligations", obligations],
    ["proofs", proofs], ["assignments", assignments], ["drivers", drivers],
    ["incidents", incidents], ["problemReports", problemReports],
    ["conversations", conversations], ["workspaces", workspaces],
  ];

  return {
    ok: true,
    value: aggregateOperationsAnalytics(
      {
        requests: requests.rows,
        deliveries: deliveries.rows,
        obligations: obligations.rows,
        proofs: proofs.rows,
        assignments: assignments.rows,
        drivers: drivers.rows,
        incidents: incidents.rows,
        problemReports: problemReports.rows,
        conversations: conversations.rows,
        workspaces: workspaces.rows,
        truncatedSources: sources.filter(([, s]) => s.truncated).map(([n]) => n),
      },
      filters,
      new Date(nowMs).toISOString()
    ),
  };
}

/** OPS-014. Same tables, read for what Couranr could NOT confirm. */
export async function loadUnmetDemandAnalytics(
  filters: AnalyticsFilters,
  nowMs: number = Date.now()
): Promise<LoadResult<UnmetDemandAnalytics>> {
  const since = sinceIso(filters.days, nowMs);
  const failures: string[] = [];
  const scope = (q: any) => (since ? q.gte("created_at", since) : q);

  const [requests, terminalEvents, workspaces] = await Promise.all([
    fetchRows<RequestRow>("requests", () =>
      scope(supabaseAdmin.from("couranr_delivery_requests").select(REQUEST_SELECT)), failures),
    /* `metadata->>reasonCode` ONLY. The rest of that object is `internalNote`
       (free operator text), `merchantMessage`, and a free-text cancellation
       `reason` — none of which may reach an analytics surface. */
    fetchRows<TerminalEventRow>("terminalEvents", () =>
      scope(
        supabaseAdmin
          .from("couranr_delivery_request_events")
          .select("request_id,actor_type,command,created_at,reason_code:metadata->>reasonCode")
          .in("command", ["decline_delivery_request", "cancel_delivery_request"])
      ), failures),
    fetchRows<WorkspaceRow>("workspaces", () =>
      supabaseAdmin.from("couranr_merchant_workspaces").select(
        "business_account_id,business_category"), failures),
  ]);

  if (failures.length > 0) return { ok: false, failedSources: failures };

  const truncated: string[] = [];
  if (requests.truncated) truncated.push("requests");
  if (terminalEvents.truncated) truncated.push("terminalEvents");
  if (workspaces.truncated) truncated.push("workspaces");

  return {
    ok: true,
    value: aggregateUnmetDemand(
      {
        requests: requests.rows,
        terminalEvents: terminalEvents.rows,
        workspaces: workspaces.rows,
        truncatedSources: truncated,
      },
      filters,
      new Date(nowMs).toISOString()
    ),
  };
}

/** Parses the query string into filters. Anything unrecognised becomes null —
 *  a filter is never invented from a caller-supplied value. */
export function parseFilters(params: URLSearchParams): AnalyticsFilters {
  const rawDays = params.get("days");
  let days: number | null = DEFAULT_FILTERS.days;
  if (rawDays === "all") days = null;
  else if (rawDays !== null) {
    const parsed = Number(rawDays);
    days = Number.isFinite(parsed) && parsed > 0 && parsed <= 3650 ? Math.trunc(parsed) : DEFAULT_FILTERS.days;
  }

  const market = params.get("market");
  const category = params.get("category");
  const payer = params.get("payer");

  return {
    days,
    market: market && MARKETS.includes(market) ? market : null,
    category: category && CATEGORIES.includes(category) ? category : null,
    payer: payer && (PAYER_TYPES as readonly string[]).includes(payer) ? payer : null,
  };
}

/**
 * Every closed vocabulary this surface can emit, exposed so the test suite can
 * pin each one to the CHECK constraint that owns it. A list that drifts from
 * its constraint does not fail loudly — it silently buckets every real row as
 * `unrecognised`, which reads as a measurement.
 */
export const ANALYTICS_VOCABULARY = {
  markets: MARKETS,
  categories: CATEGORIES,
  payerTypes: PAYER_TYPES as readonly string[],
  causes: CAUSES,
  requestStates: REQUEST_STATES as readonly string[],
  /** name of the CHECK constraint -> the list derived from it. */
  fromConstraint: {
    couranr_dr_request_state_chk: REQUEST_STATES as readonly string[],
    couranr_dr_service_area_state_chk: SERVICE_AREA_STATES as readonly string[],
    couranr_dr_quote_status_chk: QUOTE_STATUSES as readonly string[],
    couranr_dr_payer_type_chk: PAYER_TYPES as readonly string[],
    couranr_dr_requester_kind_chk: REQUESTER_KINDS as readonly string[],
    couranr_dlv_fulfillment_chk: FULFILLMENT_STATES as readonly string[],
    couranr_dp_stage_chk: PROOF_STAGES as readonly string[],
    couranr_dp_type_chk: PROOF_TYPES as readonly string[],
    couranr_asg_state_chk: ASSIGNMENT_STATES as readonly string[],
    couranr_di_type_chk: INCIDENT_TYPES as readonly string[],
    couranr_cpr_problem_chk: PROBLEM_TYPES as readonly string[],
    couranr_cv_kind_chk: CONVERSATION_KINDS as readonly string[],
    couranr_cv_due_state_chk: CONVERSATION_DUE_STATES as readonly string[],
  } as Record<string, readonly string[]>,
  /**
   * Vocabularies that add ONE explicit "not recorded" bucket on top of their
   * constraint, because a nullable column needs somewhere honest to put a null.
   */
  fromConstraintPlusNotRecorded: {
    couranr_dr_weight_band_chk: [WEIGHT_BANDS, "not_recorded"],
    couranr_dr_restricted_class_chk: [RESTRICTED_CLASSES, "not_recorded"],
    couranr_mw_category_chk: [CATEGORIES, "category_not_recorded"],
  } as Record<string, [readonly string[], string]>,
};

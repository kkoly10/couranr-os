import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import {
  COURANR_PRICING_POLICY_VERSION,
  INCLUDED_LOADED_MILES,
  type QuoteResult,
} from "@/lib/couranr/pricing";
import type { TimingEvaluation } from "@/lib/couranr/timing/policy";
import {
  deriveCanonicalRouteAndQuote,
  isCanonicalAddressResolutionError,
  type CanonicalRouteEvidence,
} from "@/lib/couranr/routing/googleRoutes";
import type { GoogleAddressSnapshot } from "@/lib/couranr/routing/address";
import { applyShipmentPolicyToQuote } from "@/lib/couranr/shipment/quoteStatus";
import { evaluateShipmentPolicy, type PolicyDisposition } from "@/lib/couranr/shipment/policy";
import { factsFromDraft } from "@/lib/couranr/shipment/draftFacts";
import {
  evaluateAndRecordIntakePolicy,
  findLinkedIntakeSession,
  isIntakeFailure,
  linkIntakeSession,
  loadIntakePolicySnapshot,
  syncFormFactsIntoIntake,
} from "@/lib/couranr/intake/commands";
import {
  classifyDatabaseError,
  logServerFailure,
  newCorrelationId,
  type PublicErrorCode,
} from "@/lib/couranr/errors";
import { canActOnDeliveryRequest, type RequestActor } from "./permissions";
import {
  isNormalizeFailure,
  normalizeDeliveryRequestInput,
  type DeliveryRequestDraft,
} from "./input";
import {
  declineRequiresInternalNote,
  isDeclineReason,
  isTransitionDenied,
  resolveTransition,
  type DeclineReason,
  type PayerType,
} from "./states";

assertServerOnly("lib/couranr/requests/commands.ts");

/**
 * Named server commands for the delivery-request lifecycle.
 *
 * ATOMICITY. Each mutating command is ONE `.rpc()` call into a service-role-only
 * SQL function that performs the request mutation and the audit-event insert in
 * a single transaction. The previous shape — `.update()` then `.insert(event)`
 * — was two transactions, so a failed event insert left the mutation committed
 * while the API reported an error: a state change with no audit trail.
 *
 * Every command still, before it calls anything:
 *   1. verifies the actor against DRP-001,
 *   2. passes its own `business_account_id` scope into the function, which
 *      re-checks it — `service_role` has `rolbypassrls = true`, so RLS does not
 *      constrain these queries; the GRANTs and this scoping are the boundary,
 *   3. checks the CURRENT state against the state machine before calling, and
 *      the function re-checks it in the same statement that writes,
 *   4. compare-and-sets `version` inside the function's WHERE clause.
 *
 * No command accepts a target status from a caller. Quote-creation commands
 * receive prices only from `lib/couranr/pricing`; submission receives no quote
 * values and references the existing immutable quote UUID.
 *
 * There is no `resilientUpdateById`-style retry here. If a write fails the
 * caller is told, with a correlation id, and nothing is persisted.
 */

export const TABLE = "couranr_delivery_requests";
export const EVENTS_TABLE = "couranr_delivery_request_events";

export const RPC = {
  create: "couranr_create_routed_delivery_request_draft",
  estimate: "couranr_calculate_routed_delivery_request_estimate",
  // P5-001 §26: the routed estimate, wrapped so the shipment arguments are
  // re-validated against the CURRENT trusted intake facts in one transaction.
  commitIntake: "couranr_commit_intake_to_request",
  // §3 (correction pass): the routed CREATE, wrapped the same way — one
  // transaction that locks the session, requires the expected revision and
  // current policy, re-validates the facts, creates, links and audits.
  createFromIntake: "couranr_create_request_from_intake",
  submit: "couranr_submit_delivery_request_v2",
  beginReview: "couranr_begin_delivery_request_review",
  accept: "couranr_accept_delivery_request_as_quoted",
  requote: "couranr_requote_routed_delivery_request",
  decline: "couranr_decline_delivery_request",
} as const;

export type CommandFailure = {
  ok: false;
  code: PublicErrorCode;
  /** Quote this to Couranr Support to find the server log line. */
  correlationId: string;
  /**
   * Present ONLY for `invalid_input`, and only ever our own field-level codes.
   * A driver message, constraint name or table name never reaches here.
   */
  details?: Array<{ code: string; field?: string }>;
  /** Optional override for the default public message. Never a driver string. */
  message?: string;
};

export type CommandSuccess<T> = { ok: true; value: T };
export type CommandResult<T> = CommandSuccess<T> | CommandFailure;

/** The columns every read of a request selects. Never `select("*")`. */
const REQUEST_COLUMN_LIST = [
  "id",
  "requester_kind",
  "business_account_id",
  "created_by",
  "created_at",
  "updated_at",
  "submitted_at",
  "version",
  "request_state",
  "readiness_state",
  "review_state",
  "service_area_review_state",
  "payer_type",
  "quote_status",
  "current_quote_version_id",
  "source",
  "recipient_name",
  "recipient_phone",
  "recipient_email",
  "loaded_miles",
  "weight_lb",
  "weight_band",
  "restricted_class",
  "timing_intent",
  "requested_pickup_local",
  "operating_timezone",
  "requested_departure_at",
  "additional_stops",
  "single_destination_contract",
  "service_level",
  "signature_required",
  "proof_method",
  "pricing_policy_version",
  "delivery_subtotal_cents",
  "included_loaded_miles",
  "billable_loaded_miles",
  "rounding_applied",
  "tax_included",
  "payment_due_cents",
  "quote_line_items",
  "review_reasons",
  "pickup_address",
  "dropoff_address",
  "normalized_request_payload",
];

const REQUEST_COLUMNS = REQUEST_COLUMN_LIST.join(",");

/**
 * Exactly the columns `toDeliveryRequestView` reads, and nothing else.
 *
 * Derived from the same list rather than retyped, so a projection that feeds
 * the view model cannot silently omit a field the view reads — an omitted
 * column comes back `undefined`, which the view would happily publish as an
 * absent value rather than fail on.
 *
 * `created_by` and `normalized_request_payload` are dropped: the view never
 * reads either, and the payload is the largest column on the table.
 */
export const REQUEST_VIEW_COLUMNS = REQUEST_COLUMN_LIST.filter(
  (c) => c !== "created_by" && c !== "normalized_request_payload"
).join(",");

export type DeliveryRequestRow = Record<string, any>;

/**
 * `tsconfig` sets `"strict": false`, and without `strictNullChecks` a bare
 * `if (!r.ok) return r` does NOT narrow these unions — the compiler still sees
 * the success arm. An explicit type predicate narrows regardless.
 */
export function isCommandFailure(r: { ok: boolean }): r is CommandFailure {
  return r.ok === false;
}

/**
 * Turns any failure into a sanitized result, logging the real cause under a
 * correlation id. This is the ONLY path from a driver error to a caller, and it
 * forwards nothing but the classification.
 */
function fail(params: {
  operation: string;
  code: PublicErrorCode;
  detail?: unknown;
  message?: string;
  details?: Array<{ code: string; field?: string }>;
}): CommandFailure {
  const correlationId = newCorrelationId();
  logServerFailure({
    correlationId,
    operation: params.operation,
    code: params.code,
    detail: params.detail,
  });
  const out: CommandFailure = { ok: false, code: params.code, correlationId };
  if (params.message) out.message = params.message;
  if (params.details) out.details = params.details;
  return out;
}

/** A denial carries no record detail — it must not reveal what exists. */
function denied(operation: string, reason: string): CommandFailure {
  return fail({
    operation,
    code: "not_permitted",
    detail: { reason },
    message: permissionMessage(reason),
  });
}

/**
 * Wraps an RPC call. A PostgREST error is classified by its SQLSTATE and never
 * forwarded; the driver's own message goes only to the server log.
 */
async function callRpc(
  operation: string,
  fn: string,
  args: Record<string, unknown>
): Promise<CommandResult<DeliveryRequestRow>> {
  const { data, error } = (await supabaseAdmin.rpc(fn, args)) as {
    data: any;
    error: any;
  };

  if (error) {
    const code = classifyDatabaseError(error);
    return fail({ operation, code, detail: { fn, code: error.code, message: error.message } });
  }
  if (!data) {
    // A composite-returning function that yields no row. Treated as a conflict
    // rather than a success with an empty body.
    return fail({ operation, code: "conflict", detail: { fn, reason: "no row returned" } });
  }
  return { ok: true, value: data };
}

/** Loads one request, scoped to the business it belongs to. */
async function loadRequest(
  operation: string,
  requestId: string,
  businessAccountId: string | null
): Promise<CommandResult<DeliveryRequestRow>> {
  let query = supabaseAdmin.from(TABLE).select(REQUEST_COLUMNS).eq("id", requestId);
  // Operations passes null and reads across businesses; a merchant never does.
  if (businessAccountId !== null) {
    query = query.eq("business_account_id", businessAccountId);
  }

  const { data, error } = (await query.maybeSingle()) as { data: any; error: any };
  if (error) {
    return fail({ operation, code: "internal", detail: error.message });
  }
  if (!data) {
    return fail({ operation, code: "not_found", message: "Delivery request not found." });
  }
  return { ok: true, value: data };
}

/**
 * Reads back the quote the DATABASE holds for this request. Never recomputes
 * it, and never reads a payload.
 *
 * This used to re-derive the quote by re-running `quoteDelivery` over the
 * persisted shipment columns. That was already the weaker choice - a stored
 * quote is immutable commercial evidence, so reproducing it by recomputation
 * makes the answer depend on today's engine rather than on what the payer was
 * actually shown - and Pricing V2 made it outright wrong: traffic evidence
 * lives on `couranr_quote_versions`, not on the request row, and V2 fails an
 * automatic quote closed when the delay is absent. A re-derivation therefore
 * answered `manual_review_required` / 0 cents / no line items for a request the
 * database had just stored as `estimated`.
 *
 * The request row denormalizes every quote field, so reading is both correct
 * and cheaper. `roundingApplied`, `taxIncluded` and `paymentDueCents` are
 * engine invariants under every policy version this codebase can mint, which
 * is why the stored columns are asserted rather than surfaced.
 */
function quoteFromRow(row: DeliveryRequestRow): QuoteResult {
  const num = (v: unknown, fallback: number): number => {
    if (v === null || v === undefined || v === "") return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    policyVersion: row.pricing_policy_version ?? COURANR_PRICING_POLICY_VERSION,
    quoteStatus: row.quote_status,
    deliverySubtotalCents: num(row.delivery_subtotal_cents, 0),
    lineItems: Array.isArray(row.quote_line_items) ? row.quote_line_items : [],
    includedLoadedMiles: num(row.included_loaded_miles, INCLUDED_LOADED_MILES),
    billableLoadedMiles: num(row.billable_loaded_miles, 0),
    trafficDelaySeconds: null,
    reviewReasons: Array.isArray(row.review_reasons) ? row.review_reasons : [],
    roundingApplied: false,
    taxIncluded: false,
    paymentDueCents: null,
    validationErrors: [],
  };
}

/**
 * Shipment arguments. Shared by create and re-estimate so the two paths cannot
 * drift — a field sent on create but forgotten on edit would leave the stored
 * shipment describing a different delivery from the stored quote.
 *
 * Identity and lifecycle are deliberately absent: the SQL functions hard-code
 * every state and own `business_account_id`, `created_by` and the idempotency
 * key as separate arguments.
 */
export function shipmentArgs(
  draft: DeliveryRequestDraft,
  canonical: {
    pickupAddress: GoogleAddressSnapshot;
    dropoffAddress: GoogleAddressSnapshot;
  }
) {
  return {
    // This command is reached only from the canonical Business portal. Source
    // is server-owned origin identity, not a form-selectable capability name.
    p_source: "merchant_portal",
    p_readiness_state: draft.readinessState,
    p_payer_type: draft.payerType,
    p_recipient_name: draft.recipientName,
    p_recipient_phone: draft.recipientPhone,
    p_recipient_email: draft.recipientEmail,
    p_weight_lb: draft.weightLb,
    p_weight_band: draft.weightBand,
    // The merchant's shipment-safety declaration; the database refuses an
    // estimated quote without a trusted "none".
    p_restricted_class: draft.restrictedClass,
    p_additional_stops: draft.additionalStops,
    p_service_level: draft.serviceLevel,
    p_signature_required: draft.signatureRequired,
    p_proof_method: draft.proofMethod,
    p_pickup_address: canonical.pickupAddress,
    p_dropoff_address: canonical.dropoffAddress,
    // Overnight is not a column (the service-level CHECK allows three values).
    // The function stores it in normalized_request_payload so a later re-quote
    // reproduces the manual-review outcome instead of pricing it as standard.
    p_overnight_requested: draft.overnightRequested,
  };
}

/** Exact Google route evidence passed only by this server command layer. */
export function routeArgs(route: CanonicalRouteEvidence) {
  return {
    p_route_distance_meters: route.distanceMeters,
    p_route_duration_seconds: route.durationSeconds,
    // TRF-001. Both durations travel to the database, which re-derives the
    // delay and refuses the write if the stored value is not exactly
    // max(traffic - static, 0). The delay is therefore checked twice, on two
    // sides of the boundary, and asserted by neither the browser nor this
    // process alone.
    p_route_static_duration_seconds: route.staticDurationSeconds,
    p_route_traffic_delay_seconds: route.trafficDelaySeconds,
    p_distance_source: route.distanceSource,
    p_serviceability_outcome: route.serviceabilityOutcome,
    p_route_review_reason: route.reviewReason,
  };
}

/**
 * TMZ-001 requested-timing arguments — SERVER-EVALUATED ONLY. The canonical
 * instant comes from the timing evaluation this process just ran against
 * America/New_York; the browser has no field that reaches any of these.
 */
export function timingArgs(t: TimingEvaluation) {
  return {
    p_timing_intent: t.intent,
    p_requested_pickup_local: t.requestedPickupLocal,
    p_requested_departure_at: t.requestedDepartureAt
      ? t.requestedDepartureAt.toISOString()
      : null,
    p_timing_review_reasons: t.reviewReasons,
  };
}

/**
 * Quote arguments — SERVER-COMPUTED ONLY.
 *
 * There is deliberately no payment argument: the SQL functions have no
 * `payment_due_cents` parameter and hard-code it null, alongside
 * `rounding_applied` and `tax_included` false. The function also re-checks that
 * the subtotal equals the sum of the line items and raises CR422 if not, so a
 * bug on this side cannot persist an inconsistent quote.
 */
export function quoteArgs(quote: QuoteResult) {
  const estimated = quote.quoteStatus === "estimated";
  return {
    p_quote_status: quote.quoteStatus,
    p_pricing_policy_version: estimated ? quote.policyVersion : null,
    p_delivery_subtotal_cents: estimated ? quote.deliverySubtotalCents : null,
    p_included_loaded_miles: quote.includedLoadedMiles,
    p_billable_loaded_miles: quote.billableLoadedMiles,
    p_quote_line_items: quote.lineItems,
    p_review_reasons: quote.reviewReasons,
  };
}

async function routeAndQuote(
  operation: string,
  shipment: Parameters<typeof deriveCanonicalRouteAndQuote>[0]
): Promise<CommandResult<Awaited<ReturnType<typeof deriveCanonicalRouteAndQuote>>>> {
  try {
    return { ok: true, value: await deriveCanonicalRouteAndQuote(shipment) };
  } catch (error) {
    if (isCanonicalAddressResolutionError(error)) {
      return fail({
        operation,
        code: "invalid_input",
        detail: { field: error.field, reason: error.reason },
        details: [{ code: "google_place_unverified", field: error.field }],
        message: "Couranr could not verify one of the selected Google addresses.",
      });
    }
    return fail({ operation, code: "internal", detail: error });
  }
}

/* ------------------------------------------- create_delivery_request_draft */

/**
 * §14 — fold the intake session's DETERMINISTIC policy disposition into the
 * quote before anything is persisted: prohibited -> `invalid`, needs_review
 * -> `manual_review_required`, both with no payable subtotal. The manual
 * form path (no session) changes nothing. Also returns the session's current
 * revision, which the commit command requires as its CAS value.
 */
async function applyIntakePolicy(
  operation: string,
  quote: QuoteResult,
  intakeSessionId: string | null | undefined,
  businessAccountId: string,
  /**
   * The structured statement to evaluate when there is NO intake session —
   * the manual path. It is a merchant statement, so it is evaluated by the
   * same deterministic policy as the AI path; without a trusted safety
   * declaration it lands in review exactly like an intake session would.
   */
  manual: Parameters<typeof factsFromDraft>[0] | null
): Promise<CommandResult<{
  quote: QuoteResult;
  intakeRevision: number | null;
  policyDisposition: PolicyDisposition | null;
}>> {
  if (!intakeSessionId) {
    if (!manual) return { ok: true, value: { quote, intakeRevision: null, policyDisposition: null } };
    const policy = evaluateShipmentPolicy(factsFromDraft(manual));
    return {
      ok: true,
      value: {
        quote: applyShipmentPolicyToQuote(quote, policy),
        intakeRevision: null,
        policyDisposition: policy.disposition,
      },
    };
  }
  const snapshot = await loadIntakePolicySnapshot({
    sessionId: intakeSessionId,
    businessAccountId,
  });
  if (isIntakeFailure(snapshot)) {
    return fail({
      operation,
      code: snapshot.code,
      detail: { intakeSessionId, reason: "policy snapshot unavailable" },
      message: snapshot.message,
    });
  }
  const { policy, currentRevision } = snapshot.value;
  if (!policy) {
    // Every intake path evaluates policy before pricing; a session with no
    // evaluation is a programming error, not a shipment with no concerns.
    return fail({
      operation,
      code: "conflict",
      detail: { intakeSessionId, reason: "policy not evaluated" },
      message: "The shipment could not be evaluated. Try again.",
    });
  }
  return {
    ok: true,
    value: {
      quote: applyShipmentPolicyToQuote(quote, policy),
      intakeRevision: currentRevision,
      policyDisposition: policy.disposition,
    },
  };
}

/**
 * The structured form is the merchant's LATER statement of the commercial
 * facts (see intake/sync.ts). Bring the fact record into agreement with it
 * and re-run the deterministic policy over the result, so that the policy
 * fold and the commit check below both read facts that describe THIS
 * shipment — not the one the conversation described before the merchant
 * changed a field.
 */
async function syncIntakeWithForm(
  operation: string,
  intakeSessionId: string,
  businessAccountId: string,
  actorUserId: string,
  draft: DeliveryRequestDraft
): Promise<CommandResult<null>> {
  const synced = await syncFormFactsIntoIntake({
    sessionId: intakeSessionId,
    businessAccountId,
    actorUserId,
    statement: {
      weightLb: draft.weightLb,
      weightBand: draft.weightBand,
      restrictedClass: draft.restrictedClass,
      serviceLevel: draft.serviceLevel,
      timingIntent: draft.timingIntent,
      requestedPickupLocal: draft.requestedPickupLocal,
    },
  });
  if (isIntakeFailure(synced)) {
    return fail({
      operation,
      code: synced.code,
      detail: { intakeSessionId, reason: "fact sync failed" },
      message: synced.message,
    });
  }
  const evaluated = await evaluateAndRecordIntakePolicy({
    sessionId: intakeSessionId,
    businessAccountId,
  });
  if (isIntakeFailure(evaluated)) {
    return fail({
      operation,
      code: evaluated.code,
      detail: { intakeSessionId, reason: "policy evaluation failed" },
      message: evaluated.message,
    });
  }
  return { ok: true, value: null };
}

/** Bind the session to its request; CR409 when it belongs to another. */
async function bindIntakeToRequest(
  operation: string,
  intakeSessionId: string,
  businessAccountId: string,
  requestId: string
): Promise<CommandResult<null>> {
  const linked = await linkIntakeSession({ sessionId: intakeSessionId, businessAccountId, requestId });
  if (isIntakeFailure(linked)) {
    return fail({
      operation,
      code: linked.code,
      detail: { intakeSessionId, requestId, reason: "link failed" },
      message:
        linked.code === "conflict"
          ? "This shipment description belongs to a different delivery."
          : linked.message,
    });
  }
  return { ok: true, value: null };
}

export async function createDeliveryRequestDraft(params: {
  actor: RequestActor;
  businessAccountId: string;
  rawInput: unknown;
  idempotencyKey: string;
  /** Present when the shipment came through Smart Intake (P5-001). */
  intakeSessionId?: string | null;
}): Promise<CommandResult<{ request: DeliveryRequestRow; quote: QuoteResult }>> {
  const op = "createDeliveryRequestDraft";
  const permission = canActOnDeliveryRequest(params.actor, "create", params.businessAccountId);
  if (!permission.allowed) return denied(op, permission.reason);

  const normalized = normalizeDeliveryRequestInput(params.rawInput);
  if (isNormalizeFailure(normalized)) {
    return fail({
      operation: op,
      code: "invalid_input",
      detail: normalized.errors,
      details: normalized.errors,
      message: "Some details need attention before this delivery can be created.",
    });
  }
  const draft: DeliveryRequestDraft = normalized.value;

  if (params.actor.kind !== "member") {
    // Operations does not create on a merchant's behalf in this slice, and an
    // anonymous actor never reaches here. `created_by` must be a real member.
    return denied(op, "role_may_not_write");
  }

  const routedResult = await routeAndQuote(op, draft);
  if (isCommandFailure(routedResult)) return routedResult;
  const routed = routedResult.value;
  if (params.intakeSessionId) {
    const synced = await syncIntakeWithForm(
      op, params.intakeSessionId, params.businessAccountId, params.actor.userId, draft
    );
    if (isCommandFailure(synced)) return synced;
  }
  const adjusted = await applyIntakePolicy(
    op, routed.quote, params.intakeSessionId, params.businessAccountId, draft
  );
  if (isCommandFailure(adjusted)) return adjusted;
  const { quote, intakeRevision, policyDisposition } = adjusted.value;

  // Only an INPUT-invalid quote is refused as bad input. A policy-PROHIBITED
  // quote is also `invalid` but with zero validation errors — that one is
  // PERSISTED, because "Couranr cannot carry this" is an answer the merchant
  // and Operations both need on the record, not a form error.
  if (quote.quoteStatus === "invalid" && quote.validationErrors.length > 0) {
    return fail({
      operation: op,
      code: "invalid_input",
      detail: quote.validationErrors,
      details: quote.validationErrors.map((code) => ({ code })),
      message: "These shipment details cannot be priced.",
    });
  }

  // One transactional call: the request and its creation event, or neither.
  // Idempotency is enforced by the function on (business_account_id,
  // idempotency_key), so a retry returns the original and appends no second
  // creation event.
  const createArgs = {
    p_business_account_id: params.businessAccountId,
    p_created_by: params.actor.userId,
    p_idempotency_key: params.idempotencyKey,
    ...shipmentArgs(draft, routed),
    ...routeArgs(routed.route),
    ...timingArgs(routed.timing),
    ...quoteArgs(quote),
  };
  // A shipment that came through Smart Intake is created through the atomic
  // wrapper: the session is locked, the intake revision and the policy it was
  // priced under must still be current, the facts are re-validated, and the
  // link and audit land in the SAME transaction as the request and Quote 1.
  // There is no after-the-fact linkage gap for a stale revision to slip into.
  const result =
    params.intakeSessionId && intakeRevision !== null
      ? await callRpc(op, RPC.createFromIntake, {
          p_session_id: params.intakeSessionId,
          p_expected_intake_revision: intakeRevision,
          p_expected_policy_disposition: policyDisposition,
          ...createArgs,
        })
      : await callRpc(op, RPC.create, createArgs);
  if (isCommandFailure(result)) return result;

  return {
    ok: true,
    value: {
      request: result.value,
      // Report the quote the DATABASE holds. On an idempotent replay the stored
      // request may differ from this attempt's payload, and the stored one wins.
      quote: quoteFromRow(result.value),
    },
  };
}

/* ------------------------------------ calculate_delivery_request_estimate */

export async function calculateDeliveryRequestEstimate(params: {
  actor: RequestActor;
  businessAccountId: string;
  requestId: string;
  expectedVersion: number;
  /**
   * An edited shipment. A draft is editable (`isEditable`), so re-estimating
   * after the merchant changes an address must price what they
   * changed it to. Omit to re-price the stored shipment unchanged.
   */
  rawInput?: unknown;
  /** Present when the shipment came through Smart Intake (P5-001). */
  intakeSessionId?: string | null;
}): Promise<CommandResult<{ request: DeliveryRequestRow; quote: QuoteResult }>> {
  const op = "calculateDeliveryRequestEstimate";
  const permission = canActOnDeliveryRequest(params.actor, "create", params.businessAccountId);
  if (!permission.allowed) return denied(op, permission.reason);
  if (params.actor.kind === "anonymous") return denied(op, "anonymous");

  const loaded = await loadRequest(op, params.requestId, params.businessAccountId);
  if (isCommandFailure(loaded)) return loaded;
  const row = loaded.value;

  const transition = resolveTransition("calculate_delivery_request_estimate", row.request_state);
  if (!transition.allowed) {
    return fail({
      operation: op,
      code: "wrong_state",
      detail: { from: row.request_state },
      message: "This delivery request can no longer be re-estimated.",
    });
  }

  // The server remembers which intake session this request came from. A
  // client that forgot (a remounted panel, a reload) must not be able to turn
  // an intake-backed request into an unsynced manual one: once a session is
  // bound to the request, every later estimate syncs the form into its facts
  // and commits through the wrapper, whatever the browser sent.
  let intakeSessionId: string | null = params.intakeSessionId ?? null;
  if (!intakeSessionId) {
    const linked = await findLinkedIntakeSession({
      requestId: params.requestId,
      businessAccountId: params.businessAccountId,
    });
    if (isIntakeFailure(linked)) {
      return fail({
        operation: op,
        code: linked.code,
        detail: { requestId: params.requestId, reason: "linked intake lookup failed" },
        message: "Couranr could not read this delivery's intake record. Try again.",
      });
    }
    intakeSessionId = linked.value;
  }

  // Either the edited draft or the stored row — never a mix, so the stored
  // shipment and the stored quote can never describe different deliveries.
  let shipment: ReturnType<typeof shipmentArgs> | null = null;
  let routed: Awaited<ReturnType<typeof deriveCanonicalRouteAndQuote>>;

  if (params.rawInput === undefined) {
    const routedResult = await routeAndQuote(op, {
      pickupAddress: row.pickup_address,
      dropoffAddress: row.dropoff_address,
      // SUR-001 band cutover: a null stored weight STAYS null. The old `?? 0`
      // was a sentinel — exactly the fabricated-pounds bug this batch bans.
      weightLb:
        row.weight_lb === null || row.weight_lb === undefined
          ? null
          : Number(row.weight_lb),
      weightBand: row.weight_band ?? null,
      additionalStops: Number(row.additional_stops ?? 0),
      serviceLevel: row.service_level,
      signatureRequired: row.signature_required === true,
      overnightRequested: row.normalized_request_payload?.overnightRequested === true,
      timingIntent: row.timing_intent === "scheduled" ? "scheduled" : "asap",
      requestedPickupLocal: row.requested_pickup_local ?? null,
    });
    if (isCommandFailure(routedResult)) return routedResult;
    routed = routedResult.value;
  } else {
    const normalized = normalizeDeliveryRequestInput(params.rawInput);
    if (isNormalizeFailure(normalized)) {
      return fail({
        operation: op,
        code: "invalid_input",
        detail: normalized.errors,
        details: normalized.errors,
        message: "Some details need attention before this delivery can be priced.",
      });
    }
    const draft = normalized.value;
    const routedResult = await routeAndQuote(op, draft);
    if (isCommandFailure(routedResult)) return routedResult;
    routed = routedResult.value;
    shipment = shipmentArgs(draft, routed);

    if (intakeSessionId) {
      // A session may have started AFTER this draft existed (manual form
      // first, description second): bind it before anything reads it as
      // this request's evidence. Then the form's statement wins the facts.
      const bound = await bindIntakeToRequest(
        op, intakeSessionId, params.businessAccountId, params.requestId
      );
      if (isCommandFailure(bound)) return bound;
      const synced = await syncIntakeWithForm(
        op, intakeSessionId, params.businessAccountId, params.actor.userId, draft
      );
      if (isCommandFailure(synced)) return synced;
    }
  }

  const adjusted = await applyIntakePolicy(
    op,
    routed.quote,
    intakeSessionId,
    params.businessAccountId,
    // Manual path: the edited draft, or the stored shipment's own statement.
    shipment !== null && params.rawInput !== undefined
      ? (normalizeDeliveryRequestInput(params.rawInput) as { ok: true; value: DeliveryRequestDraft }).value
      : {
          weightLb: row.weight_lb === null || row.weight_lb === undefined ? null : Number(row.weight_lb),
          weightBand: row.weight_band ?? null,
          restrictedClass: row.restricted_class ?? "unknown",
          serviceLevel: row.service_level,
          timingIntent: row.timing_intent === "scheduled" ? "scheduled" : "asap",
          requestedPickupLocal: row.requested_pickup_local ?? null,
        }
  );
  if (isCommandFailure(adjusted)) return adjusted;
  const { quote, intakeRevision, policyDisposition } = adjusted.value;

  // Input-invalid is refused; policy-prohibited `invalid` (zero validation
  // errors) is persisted — see createDeliveryRequestDraft for why.
  if (quote.quoteStatus === "invalid" && quote.validationErrors.length > 0) {
    return fail({
      operation: op,
      code: "invalid_input",
      detail: quote.validationErrors,
      details: quote.validationErrors.map((code) => ({ code })),
      message: "These shipment details cannot be priced.",
    });
  }

  // The function ignores every shipment argument when p_update_shipment is
  // false, so the stored row is passed through unchanged rather than rewritten
  // from a partially reconstructed draft.
  const estimateArgs = {
    p_request_id: params.requestId,
    p_business_account_id: params.businessAccountId,
    p_expected_version: params.expectedVersion,
    p_actor_user_id: params.actor.userId,
    p_update_shipment: shipment !== null,
    ...(shipment ?? shipmentArgsFromRow(row, routed)),
    ...routeArgs(routed.route),
    ...timingArgs(routed.timing),
    ...quoteArgs(quote),
  };
  // An edited shipment that came through Smart Intake is committed through
  // the wrapper: same estimate, same CAS, plus the shipment arguments are
  // re-validated against the trusted facts while both are locked (§26). A
  // re-price of the stored shipment has nothing new to validate.
  const result =
    shipment !== null && intakeSessionId && intakeRevision !== null
      ? await callRpc(op, RPC.commitIntake, {
          p_session_id: intakeSessionId,
          p_expected_intake_revision: intakeRevision,
          p_expected_policy_disposition: policyDisposition,
          ...estimateArgs,
        })
      : await callRpc(op, RPC.estimate, estimateArgs);
  if (isCommandFailure(result)) return result;

  return { ok: true, value: { request: result.value, quote } };
}

/* ------------------------------------------------ submit_delivery_request */

export async function submitDeliveryRequest(params: {
  actor: RequestActor;
  businessAccountId: string;
  requestId: string;
  expectedVersion: number;
  /**
   * The merchant ticked MER-006's "I approve this delivery estimate if Couranr
   * confirms it without changes." Only a merchant-paid request can use it to
   * skip a second approval, and only the value recorded here — never a
   * browser-supplied amount — is what accept-as-quoted later checks.
   *
   * Defaulted false and coerced with `=== true`, so a missing, malformed or
   * truthy-but-not-true body field fails closed: the request is still
   * submitted, and confirming it will require the payer's approval.
   */
  merchantAcknowledged?: boolean;
}): Promise<CommandResult<{ request: DeliveryRequestRow }>> {
  const op = "submitDeliveryRequest";
  const permission = canActOnDeliveryRequest(params.actor, "submit", params.businessAccountId);
  if (!permission.allowed) return denied(op, permission.reason);
  if (params.actor.kind === "anonymous") return denied(op, "anonymous");

  const loaded = await loadRequest(op, params.requestId, params.businessAccountId);
  if (isCommandFailure(loaded)) return loaded;
  const row = loaded.value;

  const transition = resolveTransition("submit_delivery_request", row.request_state);
  if (!transition.allowed) {
    return fail({
      operation: op,
      code: "wrong_state",
      detail: { from: row.request_state },
      message: "This delivery request has already been submitted.",
    });
  }

  // Submission identifies an existing immutable commercial agreement. Any
  // commercial edit must first create Quote N+1 through a quote command.
  if (!row.current_quote_version_id || row.quote_status === "invalid") {
    return fail({
      operation: op,
      code: "invalid_input",
      detail: { reason: "current_quote_required" },
      message: "Create a valid delivery quote before submitting this request.",
    });
  }

  const result = await callRpc(op, RPC.submit, {
    p_request_id: params.requestId,
    p_business_account_id: params.businessAccountId,
    p_expected_version: params.expectedVersion,
    p_actor_user_id: params.actor.userId,
    p_acknowledged: params.merchantAcknowledged === true,
  });
  if (isCommandFailure(result)) return result;

  return { ok: true, value: { request: result.value } };
}

/* ------------------------------------------ begin_delivery_request_review */

export async function beginDeliveryRequestReview(params: {
  actor: RequestActor;
  requestId: string;
  expectedVersion: number;
}): Promise<CommandResult<{ request: DeliveryRequestRow }>> {
  const op = "beginDeliveryRequestReview";
  // Operations reads and reviews across businesses, so the scope is null here
  // and the permission check asks about the request's own business.
  const loaded = await loadRequest(op, params.requestId, null);
  if (isCommandFailure(loaded)) return loaded;
  const row = loaded.value;

  const permission = canActOnDeliveryRequest(
    params.actor,
    "review",
    row.business_account_id ?? null
  );
  if (!permission.allowed) return denied(op, permission.reason);
  if (params.actor.kind === "anonymous") return denied(op, "anonymous");

  const transition = resolveTransition("begin_delivery_request_review", row.request_state);
  if (!transition.allowed) {
    return fail({
      operation: op,
      code: "wrong_state",
      detail: { from: row.request_state },
      message: "This request is not waiting for Couranr review.",
    });
  }

  const result = await callRpc(op, RPC.beginReview, {
    p_request_id: params.requestId,
    p_business_account_id: row.business_account_id ?? null,
    p_expected_version: params.expectedVersion,
    p_actor_user_id: params.actor.userId,
  });
  if (isCommandFailure(result)) return result;

  return { ok: true, value: { request: result.value } };
}

/* ------------------------------------------------------ review outcomes ---
 *
 * REV-001, owner-approved 2026-07-31. Three named commands end a Couranr
 * review. Each is one RPC into a service-role-only SQL function that does the
 * state change and the audit event in a single transaction.
 *
 * What none of them do — deliberately, and enforced by the SQL: authorize a
 * payment, capture a payment, create an order, or create a delivery. Payment,
 * readiness and fulfillment are separate state groups (STA-001) and still gate
 * everything downstream. `confirmed` means Couranr confirmed the request and
 * its unchanged quote, nothing more.
 *
 * All three are Operations-only, so they load the request with a null business
 * scope and then ask the permission layer about the request's OWN business.
 */

/**
 * Shared preamble: load, authorize as Operations, and check the transition
 * against the state machine. Returns the row on success.
 *
 * The state check here is advisory — the SQL function re-checks both states
 * and compare-and-sets `version` in the same statement that writes, so a race
 * between this read and that write is a conflict, not a bad transition.
 */
async function loadForReview(
  op: string,
  actor: RequestActor,
  requestId: string,
  command: Parameters<typeof resolveTransition>[0]
): Promise<CommandResult<{ row: DeliveryRequestRow; actorUserId: string }>> {
  const loaded = await loadRequest(op, requestId, null);
  if (isCommandFailure(loaded)) return loaded;
  const row = loaded.value;

  const permission = canActOnDeliveryRequest(actor, "review", row.business_account_id ?? null);
  if (!permission.allowed) return denied(op, permission.reason);
  // Narrowed here so the callers can read `userId` without each repeating the
  // check — and so a future command cannot forget it.
  if (actor.kind === "anonymous") return denied(op, "anonymous");

  const transition = resolveTransition(command, row.request_state, row.payer_type as PayerType);
  if (isTransitionDenied(transition)) {
    return fail({
      operation: op,
      code: "wrong_state",
      detail: { from: row.request_state, reason: transition.reason },
      message:
        transition.reason === "payer_required"
          ? "This request does not record who is paying, so it cannot be confirmed."
          : "This request is no longer waiting for a Couranr review decision.",
    });
  }
  return { ok: true, value: { row, actorUserId: actor.userId } };
}

/* ------------------------------------ accept_delivery_request_as_quoted --- */

/**
 * Confirm at the stored quote. Takes no amount: the SQL reads the subtotal off
 * the request, so there is no parameter a caller could use to confirm a price
 * the pricing engine never produced.
 */
export async function acceptDeliveryRequestAsQuoted(params: {
  actor: RequestActor;
  requestId: string;
  expectedVersion: number;
}): Promise<CommandResult<{ request: DeliveryRequestRow }>> {
  const op = "acceptDeliveryRequestAsQuoted";
  const loaded = await loadForReview(
    op,
    params.actor,
    params.requestId,
    "accept_delivery_request_as_quoted"
  );
  if (isCommandFailure(loaded)) return loaded;
  const { row, actorUserId } = loaded.value;

  const result = await callRpc(op, RPC.accept, {
    p_request_id: params.requestId,
    p_business_account_id: row.business_account_id ?? null,
    p_expected_version: params.expectedVersion,
    p_actor_user_id: actorUserId,
  });
  if (isCommandFailure(result)) {
    /*
     * `conflict` here is CR412 — the acknowledgment is missing, or the quote
     * has been revised since it was given. It is NOT `version_conflict`
     * (CR409), which is a genuine concurrency race where reloading is the
     * right advice. Reloading will never resolve this one, so the operator is
     * told what actually has to happen.
     *
     * Testing the code matters: an earlier version tested for "conflict"
     * while the SQL raised CR409, so this branch never ran and the operator
     * was sent to reload forever. Browser assertion L11 covers it.
     */
    if (result.code === "conflict" && row.payer_type === "merchant") {
      result.message =
        "This request cannot be confirmed without the payer's approval: its submission did not record the merchant approving this quote. Send it as a revised quote instead.";
    }
    return result;
  }

  return { ok: true, value: { request: result.value } };
}

/* -------------------------------------------- requote_delivery_request --- */

/**
 * Send a revised quote. The amount is recomputed here through the canonical
 * pricing engine from the request's OWN stored shipment — no caller supplies a
 * price, and the SQL independently re-checks that the line items sum to the
 * subtotal before persisting.
 *
 * SCOPE LIMIT, stated rather than worked around: this command does not edit the
 * shipment. It re-prices what is stored. So it changes the number only when the
 * pricing policy itself has changed since submission. Correcting a merchant's
 * mileage or weight and then re-pricing needs an Operations shipment-correction
 * command, which is not in this slice and must not be improvised into this one.
 */
export async function requoteDeliveryRequest(params: {
  actor: RequestActor;
  requestId: string;
  expectedVersion: number;
  reason: string;
}): Promise<CommandResult<{ request: DeliveryRequestRow }>> {
  const op = "requoteDeliveryRequest";

  const reason = typeof params.reason === "string" ? params.reason.trim() : "";
  if (reason.length === 0) {
    return fail({
      operation: op,
      code: "invalid_input",
      details: [{ code: "requote_reason_required", field: "reason" }],
      message: "Say why the quote is being revised.",
    });
  }

  const loaded = await loadForReview(op, params.actor, params.requestId, "requote_delivery_request");
  if (isCommandFailure(loaded)) return loaded;
  const { row, actorUserId } = loaded.value;

  const routedResult = await routeAndQuote(op, {
    pickupAddress: row.pickup_address,
    dropoffAddress: row.dropoff_address,
    // SUR-001 band cutover: a null stored weight STAYS null. The old `?? 0`
    // was a sentinel — exactly the fabricated-pounds bug this batch bans.
    weightLb:
      row.weight_lb === null || row.weight_lb === undefined
        ? null
        : Number(row.weight_lb),
    weightBand: row.weight_band ?? null,
    additionalStops: Number(row.additional_stops ?? 0),
    serviceLevel: row.service_level,
    signatureRequired: row.signature_required === true,
    overnightRequested: row.normalized_request_payload?.overnightRequested === true,
    timingIntent: row.timing_intent === "scheduled" ? "scheduled" : "asap",
    requestedPickupLocal: row.requested_pickup_local ?? null,
  });
  if (isCommandFailure(routedResult)) return routedResult;
  const routed = routedResult.value;
  const quote = routed.quote;
  if (quote.quoteStatus !== "estimated") {
    return fail({
      operation: op,
      code: "invalid_input",
      detail: { quoteStatus: quote.quoteStatus, validationErrors: quote.validationErrors },
      details: quote.validationErrors.map((code) => ({ code })),
      message: "These shipment details cannot be priced, so no revised quote can be sent.",
    });
  }

  const result = await callRpc(op, RPC.requote, {
    p_request_id: params.requestId,
    p_business_account_id: row.business_account_id ?? null,
    p_expected_version: params.expectedVersion,
    p_actor_user_id: actorUserId,
    p_pricing_policy_version: quote.policyVersion,
    p_delivery_subtotal_cents: quote.deliverySubtotalCents,
    p_included_loaded_miles: quote.includedLoadedMiles,
    p_billable_loaded_miles: quote.billableLoadedMiles,
    p_quote_line_items: quote.lineItems,
    ...routeArgs(routed.route),
    p_requote_reason: reason,
  });
  if (isCommandFailure(result)) return result;

  return { ok: true, value: { request: result.value } };
}

/* -------------------------------------------- decline_delivery_request --- */

export async function declineDeliveryRequest(params: {
  actor: RequestActor;
  requestId: string;
  expectedVersion: number;
  reason: DeclineReason | string;
  internalNote?: string | null;
}): Promise<CommandResult<{ request: DeliveryRequestRow }>> {
  const op = "declineDeliveryRequest";

  if (!isDeclineReason(params.reason)) {
    return fail({
      operation: op,
      code: "invalid_input",
      details: [{ code: "decline_reason_unrecognized", field: "reason" }],
      message: "Choose a reason Couranr could not confirm this delivery.",
    });
  }

  const note = typeof params.internalNote === "string" ? params.internalNote.trim() : "";
  /*
   * `other` names nothing and `merchant_account_on_hold` asserts something
   * about a business that has to be justifiable later, so both require a note.
   * The database enforces this too (CR422) — this check exists to give a
   * field-level error the form can attach to the right input, not to be the
   * only thing standing between a bad call and the row.
   */
  if (declineRequiresInternalNote(params.reason) && note.length === 0) {
    return fail({
      operation: op,
      code: "invalid_input",
      details: [{ code: "internal_note_required", field: "internalNote" }],
      message: "Add a note explaining why this delivery could not be confirmed.",
    });
  }

  const loaded = await loadForReview(op, params.actor, params.requestId, "decline_delivery_request");
  if (isCommandFailure(loaded)) return loaded;
  const { row, actorUserId } = loaded.value;

  const result = await callRpc(op, RPC.decline, {
    p_request_id: params.requestId,
    p_business_account_id: row.business_account_id ?? null,
    p_expected_version: params.expectedVersion,
    p_actor_user_id: actorUserId,
    p_decline_reason: params.reason,
    p_internal_note: note.length > 0 ? note : null,
  });
  if (isCommandFailure(result)) return result;

  return { ok: true, value: { request: result.value } };
}

/* --------------------------------------------------------------- reads --- */

export async function getDeliveryRequest(params: {
  actor: RequestActor;
  businessAccountId: string | null;
  requestId: string;
}): Promise<CommandResult<{ request: DeliveryRequestRow; events: DeliveryRequestRow[] }>> {
  const op = "getDeliveryRequest";
  const loaded = await loadRequest(op, params.requestId, params.businessAccountId);
  if (isCommandFailure(loaded)) return loaded;
  const row = loaded.value;

  const permission = canActOnDeliveryRequest(params.actor, "read", row.business_account_id ?? null);
  if (!permission.allowed) return denied(op, permission.reason);

  /*
   * EVENT PROJECTION — the merchant-visible one.
   *
   * `metadata` is NEVER selected whole here. A decline event carries an
   * `internalNote` written for Couranr Operations, and the same component
   * renders this list for a merchant and for Operations. Selecting the column
   * and stripping the key afterwards would put the note one forgotten `...`
   * spread away from a merchant's screen; selecting only named JSON keys
   * means the note is not in the process at all on this path.
   *
   * `reason` is read alongside `reasonCode` because events written under the
   * placeholder taxonomy used that key. Old rows are never rewritten, so the
   * reader accommodates them instead.
   */
  const SAFE_EVENT_COLUMNS =
    "id,actor_type,command,from_state,to_state,created_at," +
    "reasonCode:metadata->>reasonCode," +
    "reasonVersion:metadata->>reasonVersion," +
    "legacyReason:metadata->>reason";

  const { data: events } = await supabaseAdmin
    .from(EVENTS_TABLE)
    .select(SAFE_EVENT_COLUMNS)
    .eq("request_id", params.requestId)
    .order("created_at", { ascending: false })
    .limit(50);

  return { ok: true, value: { request: row, events: events ?? [] } };
}

/**
 * The internal notes on a request's decline events. OPERATIONS ONLY.
 *
 * Deliberately a separate function rather than a branch inside
 * `getDeliveryRequest`: there is exactly one code path that can read a note,
 * it names the capability it needs, and the merchant read has no branch that
 * could ever reach it. A conditional select string would have been fewer
 * lines and one refactor away from leaking.
 */
export async function getDeclineInternalNotes(params: {
  actor: RequestActor;
  requestId: string;
}): Promise<CommandResult<{ notes: Array<{ eventId: string; internalNote: string }> }>> {
  const op = "getDeclineInternalNotes";

  const loaded = await loadRequest(op, params.requestId, null);
  if (isCommandFailure(loaded)) return loaded;
  const row = loaded.value;

  // `review`, not `read`: every active member of a business may read a
  // request, and none of them may see an internal note.
  const permission = canActOnDeliveryRequest(params.actor, "review", row.business_account_id ?? null);
  if (!permission.allowed) return denied(op, permission.reason);
  if (params.actor.kind !== "operations") return denied(op, "role_may_not_review");

  const { data, error } = await supabaseAdmin
    .from(EVENTS_TABLE)
    .select("id,internalNote:metadata->>internalNote")
    .eq("request_id", params.requestId)
    .eq("command", "decline_delivery_request")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return fail({ operation: op, code: "internal", detail: error.message });

  const notes = (data ?? [])
    .filter((e: any) => typeof e.internalNote === "string" && e.internalNote.length > 0)
    .map((e: any) => ({ eventId: String(e.id), internalNote: String(e.internalNote) }));

  return { ok: true, value: { notes } };
}

/** OPS-002. Requests waiting for Couranr review, oldest submission first. */
export async function listReviewQueue(params: {
  actor: RequestActor;
  limit?: number;
}): Promise<CommandResult<DeliveryRequestRow[]>> {
  const op = "listReviewQueue";
  if (params.actor.kind !== "operations") return denied(op, "role_may_not_review");

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select(REQUEST_COLUMNS)
    .eq("request_state", "pending_couranr_review")
    .order("submitted_at", { ascending: true })
    .limit(Math.min(Math.max(params.limit ?? 50, 1), 200));

  if (error) {
    return fail({
      operation: op,
      code: "internal",
      detail: error.message,
      message: "The Couranr Operations Queue could not be loaded.",
    });
  }
  return { ok: true, value: data ?? [] };
}

/** Requests belonging to one business, newest first. */
export async function listDeliveryRequests(params: {
  actor: RequestActor;
  businessAccountId: string;
  limit?: number;
}): Promise<CommandResult<DeliveryRequestRow[]>> {
  const op = "listDeliveryRequests";
  const permission = canActOnDeliveryRequest(params.actor, "read", params.businessAccountId);
  if (!permission.allowed) return denied(op, permission.reason);

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select(REQUEST_COLUMNS)
    .eq("business_account_id", params.businessAccountId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(params.limit ?? 50, 1), 200));

  if (error) {
    return fail({
      operation: op,
      code: "internal",
      detail: error.message,
      message: "Your deliveries could not be loaded.",
    });
  }
  return { ok: true, value: data ?? [] };
}

/* ------------------------------------------------------------ internals -- */

/**
 * The stored shipment, shaped as function arguments.
 *
 * Only used to fill the positional arguments of a re-estimate that is NOT
 * updating the shipment. The function ignores every one of them in that branch;
 * they are supplied because PostgREST requires a value for a parameter with no
 * default, and passing the stored values keeps the call self-consistent if that
 * branch ever changes.
 */
function shipmentArgsFromRow(
  row: DeliveryRequestRow,
  canonical: {
    pickupAddress: GoogleAddressSnapshot;
    dropoffAddress: GoogleAddressSnapshot;
  }
) {
  return {
    p_source: row.source,
    p_readiness_state: row.readiness_state,
    p_payer_type: row.payer_type,
    p_recipient_name: row.recipient_name,
    p_recipient_phone: row.recipient_phone,
    p_recipient_email: row.recipient_email,
    p_weight_lb: row.weight_lb,
    p_weight_band: row.weight_band ?? null,
    p_restricted_class: row.restricted_class ?? null,
    p_additional_stops: row.additional_stops,
    p_service_level: row.service_level,
    p_signature_required: row.signature_required,
    p_proof_method: row.proof_method,
    p_pickup_address: canonical.pickupAddress,
    p_dropoff_address: canonical.dropoffAddress,
    p_overnight_requested: row.normalized_request_payload?.overnightRequested === true,
  };
}

function permissionMessage(reason: string): string {
  switch (reason) {
    case "anonymous":
      return "Sign in to continue.";
    case "not_a_member":
    case "wrong_business":
      return "You do not have access to this business account.";
    case "membership_not_active":
      return "Your access to this business account is not active.";
    case "role_may_not_review":
      return "Only Couranr Operations can review a delivery request.";
    case "role_may_not_write":
      return "Your role can view deliveries but cannot create or submit them.";
    default:
      return "You do not have access to this delivery request.";
  }
}

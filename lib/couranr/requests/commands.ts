import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import { quoteDelivery, type QuoteResult } from "@/lib/couranr/pricing";
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
 * No command accepts a target status from a caller, and no command accepts an
 * amount: prices come from `lib/couranr/pricing`, and the SQL functions have no
 * payment-amount parameter at all.
 *
 * There is no `resilientUpdateById`-style retry here. If a write fails the
 * caller is told, with a correlation id, and nothing is persisted.
 */

export const TABLE = "couranr_delivery_requests";
export const EVENTS_TABLE = "couranr_delivery_request_events";

export const RPC = {
  create: "couranr_create_delivery_request_draft",
  estimate: "couranr_calculate_delivery_request_estimate",
  submit: "couranr_submit_delivery_request",
  beginReview: "couranr_begin_delivery_request_review",
  accept: "couranr_accept_delivery_request_as_quoted",
  requote: "couranr_requote_delivery_request",
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
const REQUEST_COLUMNS = [
  "id",
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
  "source",
  "recipient_name",
  "recipient_phone",
  "recipient_email",
  "loaded_miles",
  "weight_lb",
  "additional_stops",
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
].join(",");

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
 * Recomputes the quote from PERSISTED shipment fields. Never from a payload.
 * This is the `start-checkout:180-186` pattern: the server recomputes and the
 * client's numbers are irrelevant.
 */
function quoteFromRow(row: DeliveryRequestRow, overnightRequested: boolean): QuoteResult {
  return quoteDelivery({
    loadedMiles: Number(row.loaded_miles ?? 0),
    weightLb: Number(row.weight_lb ?? 0),
    additionalStops: Number(row.additional_stops ?? 0),
    serviceLevel: row.service_level,
    signatureRequired: row.signature_required === true,
    overnightRequested,
  });
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
export function shipmentArgs(draft: DeliveryRequestDraft) {
  return {
    p_source: draft.source,
    p_readiness_state: draft.readinessState,
    p_payer_type: draft.payerType,
    p_recipient_name: draft.recipientName,
    p_recipient_phone: draft.recipientPhone,
    p_recipient_email: draft.recipientEmail,
    p_loaded_miles: draft.loadedMiles,
    p_weight_lb: draft.weightLb,
    p_additional_stops: draft.additionalStops,
    p_service_level: draft.serviceLevel,
    p_signature_required: draft.signatureRequired,
    p_proof_method: draft.proofMethod,
    p_pickup_address: draft.pickupAddress,
    p_dropoff_address: draft.dropoffAddress,
    // Overnight is not a column (the service-level CHECK allows three values).
    // The function stores it in normalized_request_payload so a later re-quote
    // reproduces the manual-review outcome instead of pricing it as standard.
    p_overnight_requested: draft.overnightRequested,
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

/* ------------------------------------------- create_delivery_request_draft */

export async function createDeliveryRequestDraft(params: {
  actor: RequestActor;
  businessAccountId: string;
  rawInput: unknown;
  idempotencyKey: string;
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

  const quote = quoteDelivery({
    loadedMiles: draft.loadedMiles,
    weightLb: draft.weightLb,
    additionalStops: draft.additionalStops,
    serviceLevel: draft.serviceLevel,
    signatureRequired: draft.signatureRequired,
    overnightRequested: draft.overnightRequested,
  });

  if (quote.quoteStatus === "invalid") {
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
  const result = await callRpc(op, RPC.create, {
    p_business_account_id: params.businessAccountId,
    p_created_by: params.actor.userId,
    p_idempotency_key: params.idempotencyKey,
    ...shipmentArgs(draft),
    ...quoteArgs(quote),
  });
  if (isCommandFailure(result)) return result;

  return {
    ok: true,
    value: {
      request: result.value,
      // Report the quote the DATABASE holds. On an idempotent replay the stored
      // request may differ from this attempt's payload, and the stored one wins.
      quote: quoteFromRow(
        result.value,
        result.value.normalized_request_payload?.overnightRequested === true
      ),
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
   * after the merchant changes an address or a distance must price what they
   * changed it to. Omit to re-price the stored shipment unchanged.
   */
  rawInput?: unknown;
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

  // Either the edited draft or the stored row — never a mix, so the stored
  // shipment and the stored quote can never describe different deliveries.
  let shipment: ReturnType<typeof shipmentArgs> | null = null;
  let quote: QuoteResult;

  if (params.rawInput === undefined) {
    quote = quoteFromRow(row, row.normalized_request_payload?.overnightRequested === true);
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
    shipment = shipmentArgs(draft);
    quote = quoteDelivery({
      loadedMiles: draft.loadedMiles,
      weightLb: draft.weightLb,
      additionalStops: draft.additionalStops,
      serviceLevel: draft.serviceLevel,
      signatureRequired: draft.signatureRequired,
      overnightRequested: draft.overnightRequested,
    });
  }

  if (quote.quoteStatus === "invalid") {
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
  const result = await callRpc(op, RPC.estimate, {
    p_request_id: params.requestId,
    p_business_account_id: params.businessAccountId,
    p_expected_version: params.expectedVersion,
    p_actor_user_id: params.actor.userId,
    p_update_shipment: shipment !== null,
    ...(shipment ?? shipmentArgsFromRow(row)),
    ...quoteArgs(quote),
  });
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

  // The quote is recomputed at submission, so what Couranr reviews is what the
  // server computes now — not a stale number a merchant may have been looking
  // at for an hour.
  const quote = quoteFromRow(row, row.normalized_request_payload?.overnightRequested === true);
  if (quote.quoteStatus === "invalid") {
    return fail({
      operation: op,
      code: "invalid_input",
      detail: quote.validationErrors,
      details: quote.validationErrors.map((code) => ({ code })),
      message: "These shipment details cannot be priced.",
    });
  }

  const result = await callRpc(op, RPC.submit, {
    p_request_id: params.requestId,
    p_business_account_id: params.businessAccountId,
    p_expected_version: params.expectedVersion,
    p_actor_user_id: params.actor.userId,
    ...quoteArgs(quote),
    p_merchant_acknowledged: params.merchantAcknowledged === true,
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
    String(row.business_account_id)
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
    p_business_account_id: String(row.business_account_id),
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

  const permission = canActOnDeliveryRequest(actor, "review", String(row.business_account_id));
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
    p_business_account_id: String(row.business_account_id),
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

  const quote = quoteFromRow(row, row.normalized_request_payload?.overnightRequested === true);
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
    p_business_account_id: String(row.business_account_id),
    p_expected_version: params.expectedVersion,
    p_actor_user_id: actorUserId,
    p_pricing_policy_version: quote.policyVersion,
    p_delivery_subtotal_cents: quote.deliverySubtotalCents,
    p_included_loaded_miles: quote.includedLoadedMiles,
    p_billable_loaded_miles: quote.billableLoadedMiles,
    p_quote_line_items: quote.lineItems,
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
  // `other` is the escape hatch from an admittedly incomplete taxonomy
  // (REV-002 is unresolved). It is only honest if it says something, so the
  // note is required there and optional everywhere else.
  if (params.reason === "other" && note.length === 0) {
    return fail({
      operation: op,
      code: "invalid_input",
      details: [{ code: "internal_note_required_for_other", field: "internalNote" }],
      message: "Add a note explaining why this delivery could not be confirmed.",
    });
  }

  const loaded = await loadForReview(op, params.actor, params.requestId, "decline_delivery_request");
  if (isCommandFailure(loaded)) return loaded;
  const { row, actorUserId } = loaded.value;

  const result = await callRpc(op, RPC.decline, {
    p_request_id: params.requestId,
    p_business_account_id: String(row.business_account_id),
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

  const permission = canActOnDeliveryRequest(params.actor, "read", String(row.business_account_id));
  if (!permission.allowed) return denied(op, permission.reason);

  const { data: events } = await supabaseAdmin
    .from(EVENTS_TABLE)
    .select("id,actor_type,command,from_state,to_state,created_at")
    .eq("request_id", params.requestId)
    .order("created_at", { ascending: false })
    .limit(50);

  return { ok: true, value: { request: row, events: events ?? [] } };
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
function shipmentArgsFromRow(row: DeliveryRequestRow) {
  return {
    p_source: row.source,
    p_readiness_state: row.readiness_state,
    p_payer_type: row.payer_type,
    p_recipient_name: row.recipient_name,
    p_recipient_phone: row.recipient_phone,
    p_recipient_email: row.recipient_email,
    p_loaded_miles: row.loaded_miles,
    p_weight_lb: row.weight_lb,
    p_additional_stops: row.additional_stops,
    p_service_level: row.service_level,
    p_signature_required: row.signature_required,
    p_proof_method: row.proof_method,
    p_pickup_address: row.pickup_address,
    p_dropoff_address: row.dropoff_address,
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

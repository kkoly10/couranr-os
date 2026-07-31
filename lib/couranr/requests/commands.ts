import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import { quoteDelivery, type QuoteResult } from "@/lib/couranr/pricing";
import { canActOnDeliveryRequest, type RequestActor } from "./permissions";
import {
  isNormalizeFailure,
  normalizeDeliveryRequestInput,
  type DeliveryRequestDraft,
} from "./input";
import { resolveTransition, type RequestCommand, type RequestState } from "./states";

assertServerOnly("lib/couranr/requests/commands.ts");

/**
 * Named server commands for the delivery-request lifecycle.
 *
 * Every command, without exception:
 *   1. verifies the actor against DRP-001,
 *   2. re-scopes its own query by business_account_id — `service_role` has
 *      `rolbypassrls = true`, so the deny-all RLS on these tables does NOT
 *      constrain these queries; the GRANTs and this scoping are the boundary,
 *   3. checks the CURRENT state and takes an allow-listed transition,
 *   4. compare-and-sets `version`, so a concurrent write loses rather than
 *      silently overwriting,
 *   5. appends an audit event.
 *
 * No command accepts a target status from a caller, and no command accepts an
 * amount: prices come from `lib/couranr/pricing` and nowhere else.
 *
 * There is no `resilientUpdateById`-style retry here. If a column is missing
 * the write fails and the caller is told. A payment write that "succeeds"
 * having persisted none of its columns is the failure mode this repo already
 * has; it is not reproduced.
 */

export const TABLE = "couranr_delivery_requests";
export const EVENTS_TABLE = "couranr_delivery_request_events";

export type CommandFailure = {
  ok: false;
  status: 400 | 401 | 403 | 404 | 409 | 500;
  error: string;
  code:
    | "not_permitted"
    | "invalid_input"
    | "not_found"
    | "wrong_state"
    | "version_conflict"
    | "write_failed";
  details?: unknown;
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

function denied(reason: string): CommandFailure {
  return { ok: false, status: 403, error: reason, code: "not_permitted" };
}

/**
 * Appends an audit event. A failure here is returned, not swallowed: an
 * un-audited state change is a defect, not a cosmetic problem.
 *
 * `metadata` must never carry a secret, a token or a signed URL — the table
 * comment says so and the callers below pass only machine codes.
 */
async function appendEvent(params: {
  requestId: string;
  actor: RequestActor;
  command: RequestCommand;
  fromState: RequestState | null;
  toState: RequestState | null;
  metadata?: Record<string, unknown>;
}): Promise<{ ok: true } | CommandFailure> {
  const actorType = params.actor.kind === "operations" ? "operations" : "merchant";
  const actorUserId = params.actor.kind === "anonymous" ? null : params.actor.userId;

  const { error } = await supabaseAdmin.from(EVENTS_TABLE).insert({
    request_id: params.requestId,
    actor_user_id: actorUserId,
    actor_type: actorType,
    command: params.command,
    from_state: params.fromState,
    to_state: params.toState,
    metadata: params.metadata ?? {},
  });

  if (error) {
    return {
      ok: false,
      status: 500,
      error: "The change could not be recorded. Nothing was applied.",
      code: "write_failed",
      details: error.message,
    };
  }
  return { ok: true };
}

/** Loads one request, scoped to the business it belongs to. */
async function loadRequest(
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
    return {
      ok: false,
      status: 500,
      error: "Could not load this delivery request.",
      code: "write_failed",
      details: error.message,
    };
  }
  if (!data) {
    return { ok: false, status: 404, error: "Delivery request not found.", code: "not_found" };
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
 * Columns the SHIPMENT owns. Shared by create and re-estimate so the two paths
 * cannot drift — a field persisted on create but forgotten on edit would leave
 * the stored shipment describing a different delivery from the stored quote.
 *
 * Identity and lifecycle columns are deliberately absent: `business_account_id`,
 * `created_by`, `idempotency_key`, `request_state`, `review_state` and
 * `service_area_review_state` are not the merchant's to edit.
 */
export function shipmentColumns(draft: DeliveryRequestDraft) {
  return {
    source: draft.source,
    readiness_state: draft.readinessState,
    payer_type: draft.payerType,
    recipient_name: draft.recipientName,
    recipient_phone: draft.recipientPhone,
    recipient_email: draft.recipientEmail,
    loaded_miles: draft.loadedMiles,
    weight_lb: draft.weightLb,
    additional_stops: draft.additionalStops,
    service_level: draft.serviceLevel,
    signature_required: draft.signatureRequired,
    proof_method: draft.proofMethod,
    pickup_address: draft.pickupAddress,
    dropoff_address: draft.dropoffAddress,
    normalized_request_payload: {
      // Overnight is not a column (the service-level CHECK allows three
      // values). Persisting it here is what lets a later re-quote or submit
      // reproduce the manual-review outcome instead of silently pricing the
      // request as standard.
      overnightRequested: draft.overnightRequested,
    },
  };
}

/** Columns the quote owns. Written together or not at all. */
export function quoteColumns(quote: QuoteResult) {
  const estimated = quote.quoteStatus === "estimated";
  return {
    quote_status: quote.quoteStatus,
    pricing_policy_version: estimated ? quote.policyVersion : null,
    delivery_subtotal_cents: estimated ? quote.deliverySubtotalCents : null,
    included_loaded_miles: quote.includedLoadedMiles,
    billable_loaded_miles: quote.billableLoadedMiles,
    quote_line_items: quote.lineItems,
    review_reasons: quote.reviewReasons,
    // Asserted, not inherited: the database CHECKs these three and the pricing
    // engine types them as literals. Writing them explicitly means a future
    // change to either side fails here rather than drifting.
    rounding_applied: quote.roundingApplied,
    tax_included: quote.taxIncluded,
    payment_due_cents: quote.paymentDueCents,
  };
}

/* ------------------------------------------- create_delivery_request_draft */

export async function createDeliveryRequestDraft(params: {
  actor: RequestActor;
  businessAccountId: string;
  rawInput: unknown;
  idempotencyKey: string;
}): Promise<CommandResult<{ request: DeliveryRequestRow; quote: QuoteResult }>> {
  const permission = canActOnDeliveryRequest(params.actor, "create", params.businessAccountId);
  if (!permission.allowed) return denied(permissionMessage(permission.reason));

  const normalized = normalizeDeliveryRequestInput(params.rawInput);
  if (isNormalizeFailure(normalized)) {
    return {
      ok: false,
      status: 400,
      error: "Some details need attention before this delivery can be created.",
      code: "invalid_input",
      details: normalized.errors,
    };
  }
  const draft: DeliveryRequestDraft = normalized.value;

  if (params.actor.kind !== "member") {
    // Operations does not create on a merchant's behalf in this slice, and an
    // anonymous actor never reaches here. Belt and braces: created_by must be
    // a real user id, and only a member has one in this path.
    return denied("Couranr Operations cannot create a request on a merchant's behalf.");
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
    return {
      ok: false,
      status: 400,
      error: "These shipment details cannot be priced.",
      code: "invalid_input",
      details: quote.validationErrors,
    };
  }

  const insert = {
    business_account_id: params.businessAccountId,
    created_by: params.actor.userId,
    idempotency_key: params.idempotencyKey,
    request_state: "draft" as const,
    review_state: "not_required" as const,
    // SVC-002 is unresolved, so no request is auto-accepted or auto-declined
    // on geography. Every one is captured for review.
    service_area_review_state: "pending" as const,
    ...shipmentColumns(draft),
    ...quoteColumns(quote),
  };

  const { data, error } = (await supabaseAdmin
    .from(TABLE)
    .insert(insert)
    .select(REQUEST_COLUMNS)
    .single()) as { data: any; error: any };

  if (error) {
    // 23505 is the (business_account_id, idempotency_key) unique constraint:
    // the same submission arriving twice, not a new request.
    if ((error as any).code === "23505") {
      const existing = (await supabaseAdmin
        .from(TABLE)
        .select(REQUEST_COLUMNS)
        .eq("business_account_id", params.businessAccountId)
        .eq("idempotency_key", params.idempotencyKey)
        .maybeSingle()) as { data: any };
      if (existing.data) {
        // Return the request that already exists, quoted from ITS stored
        // fields. Re-quoting from `draft` would report numbers that were never
        // persisted if the two payloads differed.
        return {
          ok: true,
          value: {
            request: existing.data,
            quote: quoteFromRow(
              existing.data,
              existing.data.normalized_request_payload?.overnightRequested === true
            ),
          },
        };
      }
    }
    return {
      ok: false,
      status: 500,
      error: "This delivery request could not be created.",
      code: "write_failed",
      details: error.message,
    };
  }

  const audit = await appendEvent({
    requestId: data.id,
    actor: params.actor,
    command: "create_delivery_request_draft",
    fromState: null,
    toState: "draft",
    metadata: { quoteStatus: quote.quoteStatus, reviewReasons: quote.reviewReasons },
  });
  if (isCommandFailure(audit)) return audit;

  return { ok: true, value: { request: data, quote } };
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
  const permission = canActOnDeliveryRequest(params.actor, "create", params.businessAccountId);
  if (!permission.allowed) return denied(permissionMessage(permission.reason));

  const loaded = await loadRequest(params.requestId, params.businessAccountId);
  if (isCommandFailure(loaded)) return loaded;
  const row = loaded.value;

  const transition = resolveTransition("calculate_delivery_request_estimate", row.request_state);
  if (!transition.allowed) {
    return {
      ok: false,
      status: 409,
      error: "This delivery request can no longer be re-estimated.",
      code: "wrong_state",
    };
  }

  // The shipment the quote is computed from, and the columns to persist with
  // it. Either the edited draft or the stored row — never a mix of the two, so
  // the stored shipment and the stored quote can never describe different
  // deliveries.
  let shipmentPatch: Record<string, unknown> = {};
  let quote: QuoteResult;

  if (params.rawInput === undefined) {
    quote = quoteFromRow(row, row.normalized_request_payload?.overnightRequested === true);
  } else {
    const normalized = normalizeDeliveryRequestInput(params.rawInput);
    if (isNormalizeFailure(normalized)) {
      return {
        ok: false,
        status: 400,
        error: "Some details need attention before this delivery can be priced.",
        code: "invalid_input",
        details: normalized.errors,
      };
    }
    const draft = normalized.value;
    shipmentPatch = shipmentColumns(draft);
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
    return {
      ok: false,
      status: 400,
      error: "These shipment details cannot be priced.",
      code: "invalid_input",
      details: quote.validationErrors,
    };
  }

  const updated = await updateWithVersion({
    requestId: params.requestId,
    businessAccountId: params.businessAccountId,
    expectedVersion: params.expectedVersion,
    patch: { ...shipmentPatch, ...quoteColumns(quote) },
  });
  if (isCommandFailure(updated)) return updated;

  const audit = await appendEvent({
    requestId: params.requestId,
    actor: params.actor,
    command: "calculate_delivery_request_estimate",
    fromState: row.request_state,
    toState: row.request_state,
    metadata: { quoteStatus: quote.quoteStatus, reviewReasons: quote.reviewReasons },
  });
  if (isCommandFailure(audit)) return audit;

  return { ok: true, value: { request: updated.value, quote } };
}

/* ------------------------------------------------ submit_delivery_request */

export async function submitDeliveryRequest(params: {
  actor: RequestActor;
  businessAccountId: string;
  requestId: string;
  expectedVersion: number;
}): Promise<CommandResult<{ request: DeliveryRequestRow }>> {
  const permission = canActOnDeliveryRequest(params.actor, "submit", params.businessAccountId);
  if (!permission.allowed) return denied(permissionMessage(permission.reason));

  const loaded = await loadRequest(params.requestId, params.businessAccountId);
  if (isCommandFailure(loaded)) return loaded;
  const row = loaded.value;

  const transition = resolveTransition("submit_delivery_request", row.request_state);
  if (!transition.allowed) {
    return {
      ok: false,
      status: 409,
      error: "This delivery request has already been submitted.",
      code: "wrong_state",
    };
  }

  // The quote is recomputed at submission and re-persisted, so what Couranr
  // reviews is what the server computes now — not a stale number a merchant
  // may have been looking at for an hour.
  const overnightRequested = row.normalized_request_payload?.overnightRequested === true;
  const quote = quoteFromRow(row, overnightRequested);
  if (quote.quoteStatus === "invalid") {
    return {
      ok: false,
      status: 400,
      error: "These shipment details cannot be priced.",
      code: "invalid_input",
      details: quote.validationErrors,
    };
  }

  const updated = await updateWithVersion({
    requestId: params.requestId,
    businessAccountId: params.businessAccountId,
    expectedVersion: params.expectedVersion,
    patch: {
      ...quoteColumns(quote),
      request_state: transition.nextState,
      review_state: "pending",
      submitted_at: new Date().toISOString(),
    },
  });
  if (isCommandFailure(updated)) return updated;

  const audit = await appendEvent({
    requestId: params.requestId,
    actor: params.actor,
    command: "submit_delivery_request",
    fromState: row.request_state,
    toState: transition.nextState,
    metadata: { quoteStatus: quote.quoteStatus, reviewReasons: quote.reviewReasons },
  });
  if (isCommandFailure(audit)) return audit;

  return { ok: true, value: { request: updated.value } };
}

/* ------------------------------------------ begin_delivery_request_review */

export async function beginDeliveryRequestReview(params: {
  actor: RequestActor;
  requestId: string;
  expectedVersion: number;
}): Promise<CommandResult<{ request: DeliveryRequestRow }>> {
  // Operations reads and reviews across businesses, so the scope is null here
  // and `canActOnDeliveryRequest` is asked about the request's own business.
  const loaded = await loadRequest(params.requestId, null);
  if (isCommandFailure(loaded)) return loaded;
  const row = loaded.value;

  const permission = canActOnDeliveryRequest(
    params.actor,
    "review",
    String(row.business_account_id)
  );
  if (!permission.allowed) return denied(permissionMessage(permission.reason));

  const transition = resolveTransition("begin_delivery_request_review", row.request_state);
  if (!transition.allowed) {
    return {
      ok: false,
      status: 409,
      error: "This request is not waiting for Couranr review.",
      code: "wrong_state",
    };
  }

  // Opening a request for review records who opened it and bumps the version.
  // It does NOT decide the outcome: accept, requote and decline are not part
  // of this slice, and no code here can reach those states.
  const updated = await updateWithVersion({
    requestId: params.requestId,
    businessAccountId: String(row.business_account_id),
    expectedVersion: params.expectedVersion,
    patch: {},
  });
  if (isCommandFailure(updated)) return updated;

  const audit = await appendEvent({
    requestId: params.requestId,
    actor: params.actor,
    command: "begin_delivery_request_review",
    fromState: row.request_state,
    toState: transition.nextState,
    metadata: { openedBy: "operations" },
  });
  if (isCommandFailure(audit)) return audit;

  return { ok: true, value: { request: updated.value } };
}

/* --------------------------------------------------------------- reads --- */

export async function getDeliveryRequest(params: {
  actor: RequestActor;
  businessAccountId: string | null;
  requestId: string;
}): Promise<CommandResult<{ request: DeliveryRequestRow; events: DeliveryRequestRow[] }>> {
  const loaded = await loadRequest(params.requestId, params.businessAccountId);
  if (isCommandFailure(loaded)) return loaded;
  const row = loaded.value;

  const permission = canActOnDeliveryRequest(params.actor, "read", String(row.business_account_id));
  if (!permission.allowed) return denied(permissionMessage(permission.reason));

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
  if (params.actor.kind !== "operations") {
    return denied("Couranr Operations access required.");
  }

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select(REQUEST_COLUMNS)
    .eq("request_state", "pending_couranr_review")
    .order("submitted_at", { ascending: true })
    .limit(Math.min(Math.max(params.limit ?? 50, 1), 200));

  if (error) {
    return {
      ok: false,
      status: 500,
      error: "The Couranr Operations Queue could not be loaded.",
      code: "write_failed",
      details: error.message,
    };
  }
  return { ok: true, value: data ?? [] };
}

/** Requests belonging to one business, newest first. */
export async function listDeliveryRequests(params: {
  actor: RequestActor;
  businessAccountId: string;
  limit?: number;
}): Promise<CommandResult<DeliveryRequestRow[]>> {
  const permission = canActOnDeliveryRequest(params.actor, "read", params.businessAccountId);
  if (!permission.allowed) return denied(permissionMessage(permission.reason));

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select(REQUEST_COLUMNS)
    .eq("business_account_id", params.businessAccountId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(params.limit ?? 50, 1), 200));

  if (error) {
    return {
      ok: false,
      status: 500,
      error: "Your deliveries could not be loaded.",
      code: "write_failed",
      details: error.message,
    };
  }
  return { ok: true, value: data ?? [] };
}

/* ------------------------------------------------------------ internals -- */

/**
 * Compare-and-set on `version`. Matching zero rows means someone else wrote
 * first — reported as a conflict, never retried blindly.
 */
async function updateWithVersion(params: {
  requestId: string;
  businessAccountId: string;
  expectedVersion: number;
  patch: Record<string, unknown>;
}): Promise<CommandResult<DeliveryRequestRow>> {
  if (!Number.isInteger(params.expectedVersion) || params.expectedVersion < 1) {
    return {
      ok: false,
      status: 409,
      error: "This delivery request changed while you were working on it. Reload and try again.",
      code: "version_conflict",
    };
  }

  const { data, error } = (await supabaseAdmin
    .from(TABLE)
    .update({
      ...params.patch,
      version: params.expectedVersion + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.requestId)
    .eq("business_account_id", params.businessAccountId)
    .eq("version", params.expectedVersion)
    .select(REQUEST_COLUMNS)
    .maybeSingle()) as { data: any; error: any };

  if (error) {
    return {
      ok: false,
      status: 500,
      error: "This delivery request could not be updated.",
      code: "write_failed",
      details: error.message,
    };
  }
  if (!data) {
    return {
      ok: false,
      status: 409,
      error: "This delivery request changed while you were working on it. Reload and try again.",
      code: "version_conflict",
    };
  }
  return { ok: true, value: data };
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

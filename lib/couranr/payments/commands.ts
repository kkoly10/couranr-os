import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import {
  classifyDatabaseError,
  logServerFailure,
  newCorrelationId,
  type PublicErrorCode,
} from "@/lib/couranr/errors";
import { canActOnDeliveryRequest, type RequestActor } from "@/lib/couranr/requests/permissions";
import {
  createManualCapturePaymentIntent,
  isFullyAuthorized,
  retrievePaymentIntent,
  syntheticEventId,
  type ObligationForIntent,
} from "./stripe";
import { generatePaymentToken, hashPaymentToken, TOKEN_TTL_DAYS } from "./tokens";
import { isLinkRefusalReason, type LinkRefusalReason } from "./states";

assertServerOnly("lib/couranr/payments/commands.ts");

/**
 * Named server commands for payment AUTHORIZATION.
 *
 * Same contract as the request command layer: one `.rpc()` per mutation into a
 * service-role-only SQL function that does the state change and its audit row
 * in a single transaction, actor verified first, no caller-supplied amount, no
 * caller-supplied target state, and no `resilientUpdateById`-style retry.
 *
 * NOTHING HERE CAPTURES. There is no capture wrapper, no refund wrapper, no
 * order creation and no delivery creation. `tests/couranr-payments.test.ts`
 * asserts the strings are absent rather than trusting the reading.
 */

export const RPC = {
  createObligation: "couranr_create_payment_obligation",
  attachIntent: "couranr_attach_payment_intent",
  applyIntentState: "couranr_apply_payment_intent_state",
  issueToken: "couranr_issue_payment_access_token",
  redeemToken: "couranr_redeem_payment_access_token",
  revokeTokens: "couranr_revoke_payment_access_tokens",
} as const;

export const OBLIGATIONS_TABLE = "couranr_payment_obligations";

export type PaymentFailure = {
  ok: false;
  code: PublicErrorCode;
  correlationId: string;
  message?: string;
};
export type PaymentResult<T> = { ok: true; value: T } | PaymentFailure;

/** `tsconfig` has `strict: false`, so `.ok` does not narrow without this. */
export function isPaymentFailure(r: { ok: boolean }): r is PaymentFailure {
  return r.ok === false;
}

function fail(params: {
  operation: string;
  code: PublicErrorCode;
  detail?: unknown;
  message?: string;
}): PaymentFailure {
  const correlationId = newCorrelationId();
  logServerFailure({
    correlationId,
    operation: params.operation,
    code: params.code,
    detail: params.detail,
  });
  const out: PaymentFailure = { ok: false, code: params.code, correlationId };
  if (params.message) out.message = params.message;
  return out;
}

/**
 * The ONLY path from a provider or driver error to a caller.
 *
 * A Stripe error carries a `raw` object, a request id, sometimes a decline
 * code and occasionally the merchant's own account details. None of it is
 * forwarded: the caller gets a classification and a correlation id, and the
 * real cause goes to the server log under that id.
 */
function sanitizeProviderError(operation: string, err: any): PaymentFailure {
  const type = typeof err?.type === "string" ? err.type : "unknown";
  // A card decline is the caller's problem to retry; everything else is ours.
  const code: PublicErrorCode = type === "StripeCardError" ? "invalid_input" : "internal";
  return fail({
    operation,
    code,
    detail: { type, code: err?.code, statusCode: err?.statusCode, message: err?.message },
    message:
      code === "invalid_input"
        ? "That payment method was declined. Try a different card."
        : "The payment provider could not be reached. Nothing was charged.",
  });
}

async function callRpc<T = any>(
  operation: string,
  fn: string,
  args: Record<string, unknown>
): Promise<PaymentResult<T>> {
  const { data, error } = (await supabaseAdmin.rpc(fn, args)) as { data: any; error: any };
  if (error) {
    return fail({
      operation,
      code: classifyDatabaseError(error),
      detail: { fn, code: error.code, message: error.message },
    });
  }
  if (data === null || data === undefined) {
    return fail({ operation, code: "conflict", detail: { fn, reason: "no row returned" } });
  }
  return { ok: true, value: data as T };
}

/* ------------------------------------------------------- obligations --- */

export type ObligationRow = Record<string, any>;

/**
 * Create — or return — the obligation for a request.
 *
 * Idempotent by construction: the SQL returns the live obligation when it
 * still matches the request's quote, so two clicks produce one obligation and
 * one PaymentIntent. Takes no amount.
 */
export async function ensurePaymentObligation(params: {
  actor: RequestActor;
  requestId: string;
  businessAccountId: string;
  idempotencyKey: string;
}): Promise<PaymentResult<{ obligation: ObligationRow }>> {
  const op = "ensurePaymentObligation";

  // Creating an obligation is a merchant-side act on their own request, so it
  // needs the same membership check as submitting one.
  const permission = canActOnDeliveryRequest(params.actor, "submit", params.businessAccountId);
  if (!permission.allowed) {
    return fail({
      operation: op,
      code: "not_permitted",
      detail: { reason: permission.reason },
      message: "You do not have access to this delivery.",
    });
  }

  const r = await callRpc<ObligationRow>(op, RPC.createObligation, {
    p_request_id: params.requestId,
    p_business_account_id: params.businessAccountId,
    p_idempotency_key: params.idempotencyKey,
  });
  if (isPaymentFailure(r)) return r;
  return { ok: true, value: { obligation: r.value } };
}

/** Loads one obligation. Scoped by business unless the caller is Operations. */
export async function getObligationForRequest(params: {
  requestId: string;
  businessAccountId: string | null;
}): Promise<PaymentResult<{ obligation: ObligationRow | null }>> {
  const op = "getObligationForRequest";
  let q = supabaseAdmin
    .from(OBLIGATIONS_TABLE)
    .select(
      "id,request_id,business_account_id,payer_type,request_version,pricing_policy_version," +
        "quote_version_id,amount_cents,currency,payment_state,provider,provider_payment_intent_id,version," +
        "created_at,updated_at,authorized_at,failed_at,cancelled_at"
    )
    .eq("request_id", params.requestId)
    .neq("payment_state", "cancelled");
  if (params.businessAccountId !== null) {
    q = q.eq("business_account_id", params.businessAccountId);
  }

  const { data, error } = (await q.maybeSingle()) as { data: any; error: any };
  if (error) return fail({ operation: op, code: "internal", detail: error.message });
  return { ok: true, value: { obligation: data ?? null } };
}

/**
 * The live obligation for a PaymentIntent, by intent id.
 *
 * The webhook needs this BEFORE it applies anything: an obligation already in
 * `capture_pending` belongs to capture reconciliation, not to the
 * authorization state machine, and the only way to know is to look.
 */
export async function getObligationByIntentId(params: {
  intentId: string;
}): Promise<PaymentResult<{ obligation: ObligationRow | null }>> {
  const op = "getObligationByIntentId";
  const { data, error } = (await supabaseAdmin
    .from(OBLIGATIONS_TABLE)
    .select(
      "id,request_id,business_account_id,payer_type,amount_cents,currency," +
        "quote_version_id,payment_state,provider_payment_intent_id,version"
    )
    .eq("provider_payment_intent_id", params.intentId)
    .maybeSingle()) as { data: any; error: any };
  if (error) return fail({ operation: op, code: "internal", detail: error.message });
  return { ok: true, value: { obligation: data ?? null } };
}

/* ---------------------------------------------------- payment intents --- */

/**
 * Ensure the obligation has a PaymentIntent, and return the client secret the
 * Payment Element needs.
 *
 * The client secret is the one payment value that legitimately crosses to the
 * browser — it authorizes confirming THIS intent and nothing else. It is never
 * logged and never stored.
 */
export async function ensurePaymentIntent(params: {
  obligation: ObligationRow;
}): Promise<PaymentResult<{ obligation: ObligationRow; clientSecret: string }>> {
  const op = "ensurePaymentIntent";
  const ob = params.obligation;

  if (ob.payment_state === "authorized") {
    return fail({
      operation: op,
      code: "conflict",
      detail: { reason: "already_authorized" },
      message: "This delivery is already authorized.",
    });
  }

  // Already has one: reuse it rather than creating a second.
  if (ob.provider_payment_intent_id) {
    try {
      const existing = await retrievePaymentIntent(String(ob.provider_payment_intent_id));
      if (!existing.client_secret) {
        return fail({ operation: op, code: "internal", detail: "intent has no client secret" });
      }
      return { ok: true, value: { obligation: ob, clientSecret: existing.client_secret } };
    } catch (e: any) {
      return sanitizeProviderError(op, e);
    }
  }

  let intent;
  try {
    intent = await createManualCapturePaymentIntent({
      obligation: ob as ObligationForIntent,
      obligationVersion: Number(ob.version),
    });
  } catch (e: any) {
    return sanitizeProviderError(op, e);
  }

  /*
   * Creating an intent does NOT authorize anything: it is attached, and the
   * obligation moves to `requires_action`. Only a verified requires_capture
   * state reaches `authorized`, through applyVerifiedIntentState below.
   */
  const attached = await callRpc<ObligationRow>(op, RPC.attachIntent, {
    p_obligation_id: ob.id,
    p_expected_version: Number(ob.version),
    p_payment_intent_id: intent.id,
  });
  if (isPaymentFailure(attached)) return attached;

  if (!intent.client_secret) {
    return fail({ operation: op, code: "internal", detail: "intent has no client secret" });
  }
  return { ok: true, value: { obligation: attached.value, clientSecret: intent.client_secret } };
}

export type ApplyOutcome = {
  outcome: "applied" | "duplicate" | "ignored" | "rejected";
  obligation_id: string | null;
  request_id: string | null;
  payment_state: string | null;
  request_state: string | null;
  rejected_reason: string | null;
};

/**
 * Apply a VERIFIED PaymentIntent state.
 *
 * "Verified" means one of exactly two things: it arrived on a
 * signature-checked webhook, or this server retrieved it from Stripe itself. A
 * browser redirect and a Payment Element `onSuccess` are neither, and there is
 * no parameter here that would let one in — the caller passes fields it read
 * off a real intent, and the SQL re-checks every one of them against the
 * stored obligation before moving anything.
 */
export async function applyVerifiedIntentState(params: {
  providerEventId: string;
  eventType: string;
  intentId: string;
  intentStatus: string;
  amount: number;
  amountCapturable: number;
  currency: string;
  metadata: Record<string, string> | null;
}): Promise<PaymentResult<ApplyOutcome>> {
  const op = "applyVerifiedIntentState";
  const r = await callRpc<ApplyOutcome>(op, RPC.applyIntentState, {
    p_provider_event_id: params.providerEventId,
    p_event_type: params.eventType,
    p_payment_intent_id: params.intentId,
    p_intent_status: params.intentStatus,
    p_amount: params.amount,
    p_amount_capturable: params.amountCapturable,
    p_currency: params.currency,
    p_metadata: params.metadata ?? {},
  });
  if (isPaymentFailure(r)) return r;
  return { ok: true, value: r.value };
}

/**
 * Re-read an intent from Stripe and apply whatever it actually says.
 *
 * This is what a payment page calls after the Payment Element reports success:
 * the browser's claim is discarded and the server asks Stripe. If the intent
 * is not really at `requires_capture` for the full amount, nothing is
 * authorized no matter what the page believed.
 */
export async function reconcilePaymentIntent(params: {
  intentId: string;
  /**
   * The obligation's version, i.e. WHICH cycle this observation belongs to.
   * The event id is scoped to it so an obligation returning to a state it has
   * held before — the ordinary `failed` -> re-confirm -> `requires_capture`
   * recovery — is not swallowed as a duplicate of the first authorization.
   */
  obligationVersion: number;
}): Promise<PaymentResult<ApplyOutcome>> {
  const op = "reconcilePaymentIntent";
  let pi;
  try {
    pi = await retrievePaymentIntent(params.intentId);
  } catch (e: any) {
    return sanitizeProviderError(op, e);
  }

  return applyVerifiedIntentState({
    providerEventId: syntheticEventId(pi, params.obligationVersion),
    // Mapped to the event the state machine understands, so a retrieve and a
    // webhook take the same path and cannot disagree.
    eventType: isFullyAuthorized(pi, pi.amount ?? 0)
      ? "payment_intent.amount_capturable_updated"
      : `payment_intent.${pi.status}`,
    intentId: pi.id,
    intentStatus: String(pi.status),
    amount: Number(pi.amount ?? 0),
    amountCapturable: Number(pi.amount_capturable ?? 0),
    currency: String(pi.currency ?? ""),
    metadata: (pi.metadata as Record<string, string>) ?? {},
  });
}

/* --------------------------------------------------------- links ------- */

/**
 * Issue a customer payment link.
 *
 * The raw token is returned to the caller EXACTLY ONCE and is never persisted
 * — only its SHA-256 hash reaches the database.
 */
export async function issuePaymentLink(params: {
  actor: RequestActor;
  requestId: string;
  businessAccountId: string;
  obligationId: string;
}): Promise<PaymentResult<{ token: string; expiresAt: string }>> {
  const op = "issuePaymentLink";

  const permission = canActOnDeliveryRequest(params.actor, "submit", params.businessAccountId);
  if (!permission.allowed) {
    return fail({
      operation: op,
      code: "not_permitted",
      detail: { reason: permission.reason },
      message: "You do not have access to this delivery.",
    });
  }

  const token = generatePaymentToken();
  const r = await callRpc<any>(op, RPC.issueToken, {
    p_request_id: params.requestId,
    p_obligation_id: params.obligationId,
    p_token_hash: hashPaymentToken(token),
    p_ttl_days: TOKEN_TTL_DAYS,
  });
  if (isPaymentFailure(r)) return r;

  // The only moment the raw token exists outside the customer's URL.
  return { ok: true, value: { token, expiresAt: String(r.value.expires_at) } };
}

export type RedeemedLink = {
  valid: boolean;
  reason: LinkRefusalReason | null;
  request_id: string | null;
  obligation_id: string | null;
  request_state: string | null;
  payment_state: string | null;
  payer_type: string | null;
  amount_cents: number | null;
};

/** Resolves a raw token. The raw value never leaves this function. */
export async function redeemPaymentLink(params: {
  rawToken: string;
}): Promise<PaymentResult<RedeemedLink>> {
  const op = "redeemPaymentLink";
  const r = await callRpc<RedeemedLink[] | RedeemedLink>(op, RPC.redeemToken, {
    p_token_hash: hashPaymentToken(params.rawToken),
  });
  if (isPaymentFailure(r)) return r;

  // A `returns table` function comes back as an array through PostgREST.
  const row = Array.isArray(r.value) ? r.value[0] : r.value;
  if (!row) {
    return { ok: true, value: { valid: false, reason: "not_found" } as RedeemedLink };
  }
  const reason = isLinkRefusalReason(row.reason) ? row.reason : null;
  return { ok: true, value: { ...row, reason } };
}

export async function revokePaymentLinks(params: {
  requestId: string;
  reason: string;
}): Promise<PaymentResult<{ revoked: number }>> {
  const op = "revokePaymentLinks";
  const r = await callRpc<number>(op, RPC.revokeTokens, {
    p_request_id: params.requestId,
    p_reason: params.reason,
  });
  if (isPaymentFailure(r)) return r;
  return { ok: true, value: { revoked: Number(r.value ?? 0) } };
}

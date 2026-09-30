import type Stripe from "stripe";
import { stripe } from "@/lib/stripeClient";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import { logServerFailure, newCorrelationId, type PublicErrorCode } from "@/lib/couranr/errors";
import { applyVerifiedIntentState, isPaymentFailure } from "@/lib/couranr/payments/commands";
import { intentMetadata, syntheticEventId, type ObligationForIntent } from "@/lib/couranr/payments/stripe";

assertServerOnly("lib/couranr/routeRuns/settlement.ts");

type Failure = { ok: false; code: PublicErrorCode; correlationId: string; message: string };
type Result<T> = { ok: true; value: T } | Failure;
type Item = {
  sequence: number;
  requestId: string;
  quoteVersionId: string;
  obligationId: string;
  amountCents: number;
  paymentState: string;
  obligationVersion: number;
};
export type RouteSettlementView = {
  settlementId: string;
  routeRunId: string;
  state: string;
  version: number;
  referenceTotalCents: number;
  currency: "usd";
  card: { brand: string; last4: string };
  uncertainObligationId: string | null;
  items: Item[];
};
type Attempt = {
  outcome: "attempt_ready";
  reconcilingUnknown: boolean;
  settlementId: string;
  obligationId: string;
  requestId: string;
  quoteVersionId: string;
  sequence: number;
  amountCents: number;
  currency: string;
  payerType: string;
  pricingPolicyVersion: string;
  requestVersion: number;
  obligationVersion: number;
  paymentState: string;
  providerPaymentIntentId: string | null;
  idempotencyKey: string;
  stripeCustomerId: string;
  stripePaymentMethodId: string;
  stripeLivemode: boolean;
};
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const positive = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const providerId = (v: unknown, prefix: string): v is string =>
  typeof v === "string" && new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(v);
const providerObjectId = (v: unknown): string | null =>
  typeof v === "string" ? v : record(v) && typeof v.id === "string" ? v.id : null;
const liveMode = () => process.env.VERCEL_ENV === "production";

function failure(operation: string, reason: unknown, message: string, code: PublicErrorCode = "internal"): Failure {
  const correlationId = newCorrelationId();
  logServerFailure({ operation, correlationId, code, detail: reason });
  return { ok: false, code, correlationId, message };
}
async function rpc(operation: string, fn: string, args: Record<string, unknown>): Promise<Result<unknown>> {
  try {
    const { data, error } = await supabaseAdmin.rpc(fn, args);
    if (error) return failure(operation, { fn, code: error.code, reason: error.message },
      "Route checkout could not continue. Refresh its payment status before retrying.", "conflict");
    return { ok: true, value: data };
  } catch (error) {
    return failure(operation, { fn, error }, "Route checkout needs Couranr Support to reconcile its status.");
  }
}
function view(value: unknown): RouteSettlementView | null {
  const uncertain = record(value) ? value.uncertainObligationId : undefined;
  if (uncertain !== null && !uuid(uncertain)) return null;
  if (!record(value) || !uuid(value.settlementId) || !uuid(value.routeRunId) ||
      typeof value.state !== "string" || !positive(value.version) ||
      !positive(value.referenceTotalCents) || value.currency !== "usd" ||
      !record(value.card) || typeof value.card.brand !== "string" ||
      typeof value.card.last4 !== "string" || !/^\d{4}$/.test(value.card.last4) ||
      !Array.isArray(value.items) || value.items.length < 2 || value.items.length > 5) return null;
  const items: Item[] = [];
  for (const [index, item] of value.items.entries()) {
    if (!record(item) || item.sequence !== index + 1 || !uuid(item.requestId) ||
        !uuid(item.quoteVersionId) || !uuid(item.obligationId) ||
        !positive(item.amountCents) || typeof item.paymentState !== "string" ||
        !positive(item.obligationVersion) || item.currency !== "usd") return null;
    items.push({
      sequence: index + 1, requestId: item.requestId,
      quoteVersionId: item.quoteVersionId, obligationId: item.obligationId,
      amountCents: item.amountCents, paymentState: item.paymentState,
      obligationVersion: item.obligationVersion,
    });
  }
  if (items.reduce((sum, item) => sum + item.amountCents, 0) !== value.referenceTotalCents) return null;
  return {
    settlementId: value.settlementId, routeRunId: value.routeRunId,
    state: value.state, version: value.version,
    referenceTotalCents: value.referenceTotalCents, currency: "usd",
    card: { brand: value.card.brand, last4: value.card.last4 },
    uncertainObligationId: uncertain as string | null, items,
  };
}
function attempt(value: unknown, settlement: RouteSettlementView, expectedObligationId: string): Attempt | null {
  if (!record(value) || value.outcome !== "attempt_ready" ||
      typeof value.reconcilingUnknown !== "boolean" ||
      value.settlementId !== settlement.settlementId ||
      value.obligationId !== expectedObligationId ||
      !uuid(value.requestId) || !uuid(value.quoteVersionId) ||
      !positive(value.sequence) || !positive(value.amountCents) ||
      value.currency !== "usd" || value.payerType !== "merchant" ||
      !positive(value.requestVersion) || !positive(value.obligationVersion) ||
      typeof value.paymentState !== "string" ||
      !(value.providerPaymentIntentId === null || providerId(value.providerPaymentIntentId, "pi")) ||
      typeof value.pricingPolicyVersion !== "string" ||
      typeof value.idempotencyKey !== "string" ||
      !value.idempotencyKey.startsWith(`couranr:route:${settlement.settlementId}:`) ||
      !providerId(value.stripeCustomerId, "cus") ||
      !providerId(value.stripePaymentMethodId, "pm") ||
      typeof value.stripeLivemode !== "boolean") return null;
  const item = settlement.items.find((i) => i.obligationId === expectedObligationId);
  if (!item || item.sequence !== value.sequence || item.requestId !== value.requestId ||
      item.quoteVersionId !== value.quoteVersionId || item.amountCents !== value.amountCents) return null;
  return value as Attempt;
}
function verifyIntent(pi: Stripe.PaymentIntent, a: Attempt, metadata: Record<string, string>): boolean {
  return providerId(pi.id, "pi") && pi.amount === a.amountCents && pi.currency === "usd" &&
    pi.capture_method === "manual" && pi.livemode === a.stripeLivemode &&
    providerObjectId(pi.customer) === a.stripeCustomerId &&
    providerObjectId(pi.payment_method) === a.stripePaymentMethodId &&
    Object.entries(metadata).every(([key, expected]) => pi.metadata?.[key] === expected);
}

/** Safe projection only. The frozen Customer/PaymentMethod IDs stay server-side. */
export async function readRouteSettlement(params: {
  businessAccountId: string; actorUserId: string; routeRunId: string;
}): Promise<Result<RouteSettlementView | null>> {
  const r = await rpc("readRouteSettlement", "couranr_read_route_run_settlement", {
    p_business_account_id: params.businessAccountId,
    p_actor_user_id: params.actorUserId,
    p_route_run_id: params.routeRunId,
  });
  if (r.ok === false) return r;
  if (r.value === null) return { ok: true, value: null };
  const decoded = view(r.value);
  return decoded ? { ok: true, value: decoded } :
    failure("readRouteSettlement", "invalid_settlement_projection",
      "Route checkout needs Couranr Support to reconcile its status.");
}

/** Merchant confirmation only; this command creates no provider charge or hold. */
export async function beginRouteCheckout(params: {
  businessAccountId: string; actorUserId: string; routeRunId: string;
  expectedVersion: number; idempotencyKey: string;
}): Promise<Result<RouteSettlementView>> {
  const r = await rpc("beginRouteCheckout", "couranr_begin_route_run_checkout", {
    p_business_account_id: params.businessAccountId,
    p_actor_user_id: params.actorUserId,
    p_route_run_id: params.routeRunId,
    p_expected_version: params.expectedVersion,
    p_idempotency_key: params.idempotencyKey,
  });
  if (r.ok === false) return r;
  const decoded = view(r.value);
  return decoded ? { ok: true, value: decoded } :
    failure("beginRouteCheckout", "invalid_settlement_projection",
      "Route checkout needs Couranr Support to reconcile its status.");
}

async function markUnknown(params: {
  businessAccountId: string; actorUserId: string; routeRunId: string;
  obligationId: string; reason: string;
}): Promise<void> {
  await rpc("markRouteAuthorizationUnknown", "couranr_mark_route_settlement_provider_unknown", {
    p_business_account_id: params.businessAccountId,
    p_actor_user_id: params.actorUserId,
    p_route_run_id: params.routeRunId,
    p_obligation_id: params.obligationId,
    p_reason: params.reason,
  });
}

/**
 * Advances at most ONE child. Every provider call uses a previously committed
 * SQL attempt key. An ambiguous response does not start the next child.
 */
export async function authorizeNextRouteChild(params: {
  businessAccountId: string; actorUserId: string; routeRunId: string;
}): Promise<Result<{ settlement: RouteSettlementView; actionClientSecret?: string }>> {
  const current = await readRouteSettlement(params);
  if (current.ok === false) return current;
  const settlement = current.value;
  if (!settlement) return failure("authorizeNextRouteChild", "checkout_not_started",
    "Confirm this Route checkout before authorizing its stops.", "conflict");
  if (settlement.state === "authorized") return { ok: true, value: { settlement } };
  if (!["pending_authorization","authorization_required","authorization_unknown"].includes(settlement.state)) {
    return failure("authorizeNextRouteChild", { state: settlement.state },
      "Route checkout cannot authorize another delivery in its current state.", "conflict");
  }
  const next = settlement.state === "authorization_unknown"
    ? settlement.items.find((item) => item.obligationId === settlement.uncertainObligationId)
    : settlement.items.find((item) => item.paymentState !== "authorized");
  if (!next) return failure("authorizeNextRouteChild", "all_items_authorized_but_state_not_synced",
    "Refresh this Route's payment status before continuing.", "conflict");
  if (settlement.state === "authorization_unknown" &&
      ["authorized","failed","cancelled"].includes(next.paymentState)) {
    const reconciled = await rpc("authorizeNextRouteChild", "couranr_sync_route_run_settlement", {
      p_business_account_id: params.businessAccountId,
      p_actor_user_id: params.actorUserId,
      p_route_run_id: params.routeRunId,
      p_provider_reconciled: true,
    });
    if (reconciled.ok === false) return reconciled;
    const updated = view(reconciled.value);
    return updated ? { ok: true, value: { settlement: updated } } :
      failure("authorizeNextRouteChild", "invalid_reconciled_projection",
        "Couranr Support must reconcile this payment.");
  }
  const begun = await rpc("authorizeNextRouteChild", "couranr_begin_route_child_authorization", {
    p_business_account_id: params.businessAccountId,
    p_actor_user_id: params.actorUserId,
    p_route_run_id: params.routeRunId,
    p_obligation_id: next.obligationId,
  });
  if (begun.ok === false) return begun;
  if (record(begun.value) && begun.value.outcome === "manual_reconciliation_required") {
    return failure("authorizeNextRouteChild", "provider_idempotency_horizon_elapsed",
      "Couranr Support must reconcile this payment before the Route can continue.", "conflict");
  }
  const a = attempt(begun.value, settlement, next.obligationId);
  if (!a || a.stripeLivemode !== liveMode()) {
    return failure("authorizeNextRouteChild", "provider_attempt_or_mode_invalid",
      "Couranr Support must reconcile this Route's saved-card configuration.");
  }
  const ob: ObligationForIntent = {
    id: a.obligationId, request_id: a.requestId,
    business_account_id: params.businessAccountId,
    quote_version_id: a.quoteVersionId, payer_type: a.payerType,
    amount_cents: a.amountCents, currency: a.currency,
    pricing_policy_version: a.pricingPolicyVersion, request_version: a.requestVersion,
  };
  const metadata = intentMetadata(ob);
  let pi: Stripe.PaymentIntent;
  try {
    if (a.providerPaymentIntentId) {
      pi = await stripe.paymentIntents.retrieve(a.providerPaymentIntentId);
    } else {
      const method = await stripe.paymentMethods.retrieve(a.stripePaymentMethodId);
      if (providerObjectId(method.customer) !== a.stripeCustomerId ||
          method.livemode !== a.stripeLivemode || method.type !== "card") {
        return failure("authorizeNextRouteChild", "saved_method_identity_changed",
          "The saved card no longer matches this checkout. Couranr Support must review it.", "conflict");
      }
      pi = await stripe.paymentIntents.create({
        amount: a.amountCents, currency: a.currency,
        capture_method: "manual", automatic_payment_methods: { enabled: true },
        customer: a.stripeCustomerId, payment_method: a.stripePaymentMethodId,
        confirm: true, off_session: true, metadata,
        description: `Couranr Route delivery ${a.requestId}`,
      }, { idempotencyKey: a.idempotencyKey });
    }
  } catch (error) {
    // Off-session SCA may be returned as a StripeCardError carrying the
    // original PaymentIntent. Retrieve that exact object; never mint another.
    const candidate = record(error) ? (error.payment_intent ??
      (record(error.raw) ? error.raw.payment_intent : null)) : null;
    const candidateId = providerObjectId(candidate);
    if (providerId(candidateId, "pi")) {
      try {
        pi = await stripe.paymentIntents.retrieve(candidateId);
      } catch (retrieveError) {
        await markUnknown({ ...params, obligationId: a.obligationId, reason: "provider_authorization_outcome_unknown" });
        return failure("authorizeNextRouteChild", { reason: "provider_retrieve_unknown", error: retrieveError },
          "The payment provider's outcome is unknown. Do not retry checkout; reconcile this Route.");
      }
    } else {
      await markUnknown({ ...params, obligationId: a.obligationId, reason: "provider_authorization_outcome_unknown" });
      return failure("authorizeNextRouteChild", { reason: "provider_response_unknown", error },
        "The payment provider's outcome is unknown. Do not retry checkout; reconcile this Route.");
    }
  }
  if (!verifyIntent(pi, a, metadata) ||
      !["requires_capture","requires_action","requires_payment_method","canceled"].includes(pi.status) ||
      (pi.status === "requires_capture" && pi.amount_capturable !== a.amountCents)) {
    await markUnknown({ ...params, obligationId: a.obligationId, reason: "provider_identity_or_state_mismatch" });
    return failure("authorizeNextRouteChild", "provider_identity_or_state_mismatch",
      "The payment provider's result could not be verified. Couranr Support must reconcile it.");
  }
  let version = a.obligationVersion;
  if (!a.providerPaymentIntentId) {
    const attached = await rpc("authorizeNextRouteChild", "couranr_attach_payment_intent", {
      p_obligation_id: a.obligationId,
      p_expected_version: a.obligationVersion,
      p_payment_intent_id: pi.id,
    });
    if (attached.ok === false || !record(attached.value) ||
        attached.value.provider_payment_intent_id !== pi.id ||
        !positive(attached.value.version)) {
      await markUnknown({ ...params, obligationId: a.obligationId, reason: "provider_attach_outcome_unknown" });
      return failure("authorizeNextRouteChild", "provider_attach_outcome_unknown",
        "The payment was started but Couranr could not confirm its record. Reconciliation is required.");
    }
    version = attached.value.version;
  }
  const eventType = pi.status === "requires_capture" ? "payment_intent.amount_capturable_updated" :
    pi.status === "requires_payment_method" ? "payment_intent.payment_failed" :
    `payment_intent.${pi.status}`;
  const applied = await applyVerifiedIntentState({
    providerEventId: syntheticEventId(pi, version), eventType,
    intentId: pi.id, intentStatus: pi.status,
    amount: pi.amount, amountCapturable: pi.amount_capturable,
    currency: pi.currency, metadata: pi.metadata as Record<string, string>,
  });
  if (isPaymentFailure(applied) || applied.value.outcome === "rejected") {
    await markUnknown({ ...params, obligationId: a.obligationId, reason: "provider_state_apply_unknown" });
    return failure("authorizeNextRouteChild", "provider_state_apply_unknown",
      "Couranr could not reconcile this payment. Do not retry checkout.");
  }
  const synced = await rpc("authorizeNextRouteChild", "couranr_sync_route_run_settlement", {
    p_business_account_id: params.businessAccountId,
    p_actor_user_id: params.actorUserId,
    p_route_run_id: params.routeRunId,
    p_provider_reconciled: a.reconcilingUnknown,
  });
  if (synced.ok === false) return synced;
  const updated = view(synced.value);
  if (!updated) return failure("authorizeNextRouteChild", "invalid_synced_projection",
    "Route checkout needs Couranr Support to reconcile its status.");
  if (updated.state === "authorization_required") {
    if (!pi.client_secret) return failure("authorizeNextRouteChild", "missing_action_secret",
      "Couranr Support must reconcile this payment.");
    return { ok: true, value: { settlement: updated, actionClientSecret: pi.client_secret } };
  }
  return { ok: true, value: { settlement: updated } };
}

/**
 * Compensation for a definitive failed Route settlement's remaining holds. This is the
 * ordinary canonical begin/complete hold-release command, with the Route's
 * failed settlement serving as its narrow admission proof. Ambiguous provider
 * outcomes and captured obligations are deliberately not released; a captured
 * sibling instead remains in governed refund/Operations recovery.
 */
export async function releaseKnownRouteHolds(params: {
  businessAccountId: string; actorUserId: string; routeRunId: string;
}): Promise<Result<RouteSettlementView>> {
  const operation = "releaseKnownRouteHolds";
  let current = await readRouteSettlement(params);
  if (current.ok === false) return current;
  if (!current.value ||
      !["authorization_failed", "recovery_required"].includes(current.value.state)) {
    return failure(operation, "failed_settlement_required",
      "The Route's payment outcome needs review before any hold can be released.", "conflict");
  }
  for (const original of current.value.items) {
    if (original.paymentState !== "authorized") continue;
    // Refresh the version before every release: webhook and Operations actions
    // are allowed to race this compensation and are never guessed away.
    current = await readRouteSettlement(params);
    if (current.ok === false) return current;
    const settlement = current.value;
    const item = settlement?.items.find((candidate) => candidate.obligationId === original.obligationId);
    if (!settlement || !item || !["authorization_failed", "recovery_required"].includes(settlement.state)) {
      return failure(operation, "settlement_changed_during_release",
        "The Route changed during payment recovery. Couranr Support must reconcile it.", "conflict");
    }
    if (item.paymentState === "cancelled") continue;
    if (item.paymentState !== "authorized") return failure(operation, "hold_changed_during_release",
      "A payment hold changed during recovery. Couranr Support must reconcile it.", "conflict");
    const { data: obligation, error: readError } = await supabaseAdmin
      .from("couranr_payment_obligations")
      .select("id,request_id,quote_version_id,business_account_id,provider_payment_intent_id,payment_state,version")
      .eq("id", item.obligationId)
      .eq("request_id", item.requestId)
      .eq("quote_version_id", item.quoteVersionId)
      .eq("business_account_id", params.businessAccountId)
      .maybeSingle();
    if (readError || !obligation || obligation.payment_state !== "authorized" ||
        obligation.version !== item.obligationVersion ||
        !providerId(obligation.provider_payment_intent_id, "pi")) {
      return failure(operation, { reason: "obligation_recheck", readError },
        "The payment record changed during recovery. Couranr Support must reconcile it.", "conflict");
    }
    const begun = await rpc(operation, "couranr_begin_payment_release", {
      p_obligation_id: item.obligationId,
      p_actor_user_id: params.actorUserId,
      p_expected_version: item.obligationVersion,
      p_reason: "Route checkout could not authorize every delivery before capture",
    });
    if (begun.ok === false) return begun;
    if (!record(begun.value) || !["applied", "ignored"].includes(String(begun.value.outcome))) {
      return failure(operation, "release_begin_not_applied",
        "Couranr Support must reconcile this payment hold.");
    }
    if (begun.value.outcome === "ignored") continue;
    const intentId = obligation.provider_payment_intent_id;
    let intent: Stripe.PaymentIntent;
    try {
      intent = await stripe.paymentIntents.cancel(intentId);
    } catch (cancelError) {
      try {
        intent = await stripe.paymentIntents.retrieve(intentId);
      } catch (retrieveError) {
        return failure(operation, { cancelError, retrieveError },
          "The provider's release outcome is unknown. Couranr Support must reconcile it.");
      }
    }
    if (intent.id !== intentId || intent.status !== "canceled") {
      return failure(operation, { intentId, observedStatus: intent.status },
        "The provider did not confirm release of this hold. Couranr Support must reconcile it.");
    }
    const completed = await rpc(operation, "couranr_complete_payment_release", {
      p_obligation_id: item.obligationId,
      p_payment_intent_id: intentId,
      p_intent_status: intent.status,
    });
    if (completed.ok === false || !record(completed.value) ||
        !["applied", "ignored"].includes(String(completed.value.outcome))) {
      return failure(operation, "release_completion_unknown",
        "The provider released the hold, but Couranr could not confirm its record. Couranr Support must reconcile it.");
    }
  }
  const synced = await rpc(operation, "couranr_sync_route_run_settlement", {
    p_business_account_id: params.businessAccountId,
    p_actor_user_id: params.actorUserId,
    p_route_run_id: params.routeRunId,
    p_provider_reconciled: false,
  });
  if (synced.ok === false) return synced;
  const decoded = view(synced.value);
  return decoded ? { ok: true, value: decoded } : failure(operation, "invalid_recovery_projection",
    "Couranr Support must reconcile this Route's payment record.");
}

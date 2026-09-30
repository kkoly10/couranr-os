import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { stripe } from "@/lib/stripeClient";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import { logServerFailure, newCorrelationId } from "@/lib/couranr/errors";
import type { PublicErrorCode } from "@/lib/couranr/errors";
import { BUSINESS_CARD_CONSENT, BUSINESS_CARD_CONSENT_VERSION } from "./consent";
import type { BusinessPaymentMethodSummary } from "./paymentMethodTypes";

assertServerOnly("lib/couranr/billing/paymentMethod.ts");

type Row = Record<string, unknown>;
type Failure = { ok: false; code: PublicErrorCode; message: string; correlationId: string };
type Result<T> = { ok: true; value: T } | Failure;
export function isBusinessPaymentFailure<T>(result: Result<T>): result is Failure {
  return result.ok === false;
}
function fail(operation: string, detail: unknown, message: string, code: PublicErrorCode = "internal"): Failure {
  const correlationId = newCorrelationId();
  logServerFailure({ operation, correlationId, code, detail });
  return { ok: false, code, message, correlationId };
}

async function rpc(operation: string, name: string, args: Record<string, unknown>): Promise<Result<Row>> {
  const { data, error } = await supabaseAdmin.rpc(name, args);
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    return fail(operation, { name, error: error?.message }, "We could not update the saved card. Please try again.");
  }
  return { ok: true, value: data as Row };
}

const customerId = (v: unknown): v is string => typeof v === "string" && /^cus_[A-Za-z0-9]+$/.test(v);
const setupId = (v: unknown): v is string => typeof v === "string" && /^seti_[A-Za-z0-9]+$/.test(v);
const methodId = (v: unknown): v is string => typeof v === "string" && /^pm_[A-Za-z0-9]+$/.test(v);
const uuid = (v: unknown): v is string => typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const modeMatchesDeployment = (livemode: unknown) => typeof livemode === "boolean" &&
  livemode === (process.env.VERCEL_ENV === "production");

/** Read-only, to be called only after the route's billing.read membership gate. */
export async function getBusinessPaymentMethod(businessAccountId: string): Promise<Result<BusinessPaymentMethodSummary>> {
  const { data, error } = await supabaseAdmin
    .from("couranr_business_payment_profiles")
    .select("default_payment_method_id,stripe_customer_livemode,card_brand,card_last4")
    .eq("business_account_id", businessAccountId)
    .maybeSingle();
  if (error) return fail("getBusinessPaymentMethod", error.message, "We could not load the saved card.");
  if (!data?.default_payment_method_id) return { ok: true, value: { state: "none" } };
  if (!modeMatchesDeployment(data.stripe_customer_livemode)) {
    return fail("getBusinessPaymentMethod", "customer_deployment_mode_mismatch",
      "This business payment profile needs Couranr Support to reconcile its payment-provider mode.");
  }
  if (typeof data.card_brand !== "string" || typeof data.card_last4 !== "string") {
    return fail("getBusinessPaymentMethod", "incomplete_method_evidence", "We could not load the saved card.");
  }
  return { ok: true, value: { state: "ready", brand: data.card_brand, last4: data.card_last4 } };
}

/**
 * A durable customer-create key is committed before provider I/O. Unknown
 * outcomes use that same key; after its safe retry horizon we fail closed for
 * manual Stripe reconciliation instead of risking a second Customer mapping.
 */
export async function startBusinessPaymentSetup(params: {
  businessAccountId: string;
  actorUserId: string;
}): Promise<Result<{ clientSecret: string | null; attemptId: string; alreadyConfirmed: boolean }>> {
  const op = "startBusinessPaymentSetup";
  const base = { p_business_account_id: params.businessAccountId, p_actor_user_id: params.actorUserId };
  const begun = await rpc(op, "couranr_begin_business_payment_customer", base);
  if (isBusinessPaymentFailure(begun)) return begun;
  let customer: string | null = customerId(begun.value.stripe_customer_id)
    ? begun.value.stripe_customer_id : null;
  if (!customer) {
    const started = Date.parse(String(begun.value.created_at ?? ""));
    if (!Number.isFinite(started) || Date.now() - started >= 23 * 60 * 60 * 1000) {
      return fail(op, "customer_create_needs_provider_reconciliation", "Card setup needs Couranr Support to reconcile its payment-provider record.");
    }
    try {
      const created = await stripe.customers.create(
        { metadata: { couranrBusinessAccountId: params.businessAccountId } },
        { idempotencyKey: `couranr:business-customer:${String(begun.value.customer_create_key)}` },
      );
      if (!customerId(created.id) || !modeMatchesDeployment(created.livemode) ||
          created.metadata?.couranrBusinessAccountId !== params.businessAccountId) {
        return fail(op, "provider_customer_identity_mismatch", "Card setup could not be verified.");
      }
      customer = created.id;
    } catch (e: unknown) {
      return fail(op, e instanceof Error ? e.message : "customer_provider_error", "Card setup could not be verified. Please try again.");
    }
    const attached = await rpc(op, "couranr_attach_business_payment_customer", {
      ...base, p_customer_id: customer, p_livemode: process.env.VERCEL_ENV === "production",
    });
    if (isBusinessPaymentFailure(attached)) return attached;
  }
  if (!customerId(customer)) return fail(op, "customer_identity_missing", "Card setup could not be verified.");
  if (customerId(begun.value.stripe_customer_id) &&
      !modeMatchesDeployment(begun.value.stripe_customer_livemode)) {
    return fail(op, "customer_deployment_mode_mismatch", "This business payment profile needs Couranr Support to reconcile its payment-provider mode.");
  }

  const begunAttempt = await rpc(op, "couranr_begin_business_payment_setup", {
    ...base,
    p_consent_version: BUSINESS_CARD_CONSENT_VERSION,
    p_consent_text: BUSINESS_CARD_CONSENT,
  });
  if (isBusinessPaymentFailure(begunAttempt)) return begunAttempt;
  let attempt = begunAttempt.value;
  let attemptId = String(attempt.id ?? "");
  if (!uuid(attemptId)) return fail(op, "setup_attempt_identity_missing", "Card setup could not be verified.");
  let provider;
  try {
    if (setupId(attempt.stripe_setup_intent_id)) {
      provider = await stripe.setupIntents.retrieve(attempt.stripe_setup_intent_id);
      if (provider.customer !== customer || !modeMatchesDeployment(provider.livemode) ||
          provider.usage !== "off_session" ||
          provider.metadata?.couranrBusinessAccountId !== params.businessAccountId ||
          provider.metadata?.couranrSetupAttemptId !== attemptId ||
          provider.metadata?.consentVersion !== BUSINESS_CARD_CONSENT_VERSION) {
        return fail(op, "provider_setup_identity_mismatch", "Card setup could not be verified.");
      }
      if (provider.status === "succeeded") {
        // Any currently authorized manager may reconcile a verified success
        // if the original consenting manager left before the server commit.
        // The attempt still records the original consent actor separately.
        return { ok: true, value: { clientSecret: null, attemptId, alreadyConfirmed: true } };
      }
      const expired = Date.parse(String(attempt.expires_at ?? "")) <= Date.now();
      if (provider.status !== "canceled" && expired) {
        // The old client secret must be made unusable at Stripe BEFORE the
        // database generation moves. If confirmation won the race, refuse.
        provider = await stripe.setupIntents.cancel(provider.id);
      }
      if (provider.status === "canceled") {
        const rotated = await rpc(op, "couranr_rotate_business_payment_setup", {
          ...base,
          p_old_attempt_id: attemptId,
          p_old_setup_intent_id: provider.id,
          p_consent_version: BUSINESS_CARD_CONSENT_VERSION,
          p_consent_text: BUSINESS_CARD_CONSENT,
        });
        if (isBusinessPaymentFailure(rotated)) return rotated;
        attempt = rotated.value;
        attemptId = String(attempt.id ?? "");
        provider = undefined;
      } else if (attempt.actor_user_id !== params.actorUserId) {
        return fail(op, "setup_owned_by_another_actor", "Another business owner or manager is setting up a card. Try again after they finish or the setup expires.", "conflict");
      }
    } else if (attempt.actor_user_id !== params.actorUserId ||
               Date.parse(String(attempt.expires_at ?? "")) <= Date.now()) {
      if (Date.parse(String(attempt.expires_at ?? "")) > Date.now()) {
        return fail(op, "setup_owned_by_another_actor", "Another business owner or manager is setting up a card. Try again after they finish or the setup expires.", "conflict");
      }
      const rotated = await rpc(op, "couranr_rotate_business_payment_setup", {
        ...base,
        p_old_attempt_id: attemptId,
        p_old_setup_intent_id: null,
        p_consent_version: BUSINESS_CARD_CONSENT_VERSION,
        p_consent_text: BUSINESS_CARD_CONSENT,
      });
      if (isBusinessPaymentFailure(rotated)) return rotated;
      attempt = rotated.value;
      attemptId = String(attempt.id ?? "");
    }
    if (!provider) {
      if (!uuid(attemptId)) return fail(op, "setup_attempt_identity_missing", "Card setup could not be verified.");
      provider = await stripe.setupIntents.create(
        {
          customer,
          usage: "off_session",
          payment_method_types: ["card"],
          metadata: {
            couranrBusinessAccountId: params.businessAccountId,
            couranrSetupAttemptId: attemptId,
            consentVersion: BUSINESS_CARD_CONSENT_VERSION,
          },
        },
        { idempotencyKey: `couranr:business-setup:${attemptId}` },
      );
    }
  } catch (e: unknown) {
    return fail(op, e instanceof Error ? e.message : "setup_provider_error", "Card setup could not be verified. Please try again.");
  }
  if (!setupId(provider.id) || !modeMatchesDeployment(provider.livemode) ||
      provider.customer !== customer || provider.usage !== "off_session" ||
      provider.metadata?.couranrBusinessAccountId !== params.businessAccountId ||
      provider.metadata?.couranrSetupAttemptId !== attemptId ||
      provider.metadata?.consentVersion !== BUSINESS_CARD_CONSENT_VERSION) {
    return fail(op, "provider_setup_identity_mismatch", "Card setup could not be verified.");
  }
  const attached = await rpc(op, "couranr_attach_business_payment_setup", {
    ...base,
    p_attempt_id: attemptId,
    p_setup_intent_id: provider.id,
  });
  if (isBusinessPaymentFailure(attached)) return attached;
  if (!provider.client_secret || provider.status === "canceled") {
    return fail(op, "provider_setup_not_confirmable", "Card setup cannot continue. Please try again later.");
  }
  return { ok: true, value: { clientSecret: provider.client_secret, attemptId, alreadyConfirmed: false } };
}

/** Browser success is ignored; both provider objects are retrieved afresh. */
export async function completeBusinessPaymentSetup(params: {
  businessAccountId: string;
  actorUserId: string;
  attemptId: string;
}): Promise<Result<BusinessPaymentMethodSummary>> {
  const op = "completeBusinessPaymentSetup";
  const profile = await supabaseAdmin.from("couranr_business_payment_profiles")
    .select("stripe_customer_id,stripe_customer_livemode,current_generation")
    .eq("business_account_id", params.businessAccountId).maybeSingle();
  if (profile.error || !customerId(profile.data?.stripe_customer_id) ||
      !modeMatchesDeployment(profile.data?.stripe_customer_livemode)) {
    return fail(op, profile.error?.message ?? "customer_missing", "The saved card is not ready yet.");
  }
  const attempt = await supabaseAdmin.from("couranr_business_payment_setup_attempts")
    .select("id,generation,stripe_setup_intent_id,consent_version")
    .eq("business_account_id", params.businessAccountId)
    .eq("id", params.attemptId)
    .eq("generation", profile.data.current_generation)
    .maybeSingle();
  if (attempt.error || !attempt.data || !setupId(attempt.data.stripe_setup_intent_id) ||
      attempt.data.consent_version !== BUSINESS_CARD_CONSENT_VERSION) {
    return fail(op, attempt.error?.message ?? "setup_attempt_missing_or_stale", "This card setup is no longer current. Start again.", "conflict");
  }
  let provider;
  let paymentMethod;
  try {
    provider = await stripe.setupIntents.retrieve(attempt.data.stripe_setup_intent_id);
    if (provider.status !== "succeeded" || !methodId(provider.payment_method) ||
        !modeMatchesDeployment(provider.livemode)) {
      return fail(op, "provider_setup_not_succeeded", "Finish the card confirmation before saving it.", "conflict");
    }
    paymentMethod = await stripe.paymentMethods.retrieve(provider.payment_method);
  } catch (e: unknown) {
    return fail(op, e instanceof Error ? e.message : "provider_retrieve_error", "Card setup could not be verified. Please try again.");
  }
  if (provider.customer !== profile.data.stripe_customer_id || provider.usage !== "off_session" ||
      provider.metadata?.couranrBusinessAccountId !== params.businessAccountId ||
      provider.metadata?.couranrSetupAttemptId !== attempt.data.id ||
      provider.metadata?.consentVersion !== BUSINESS_CARD_CONSENT_VERSION ||
      paymentMethod.id !== provider.payment_method ||
      paymentMethod.customer !== profile.data.stripe_customer_id ||
      !modeMatchesDeployment(paymentMethod.livemode) ||
      paymentMethod.type !== "card" || !paymentMethod.card?.brand || !paymentMethod.card?.last4) {
    return fail(op, "provider_method_identity_mismatch", "Card setup could not be verified.");
  }
  const saved = await rpc(op, "couranr_complete_business_payment_setup", {
    p_business_account_id: params.businessAccountId,
    p_actor_user_id: params.actorUserId,
    p_attempt_id: attempt.data.id,
    p_setup_intent_id: provider.id,
    p_payment_method_id: paymentMethod.id,
    p_card_brand: paymentMethod.card.brand.toLowerCase(),
    p_card_last4: paymentMethod.card.last4,
  });
  if (isBusinessPaymentFailure(saved)) return saved;
  return {
    ok: true,
    value: {
      state: "ready",
      brand: String(saved.value.card_brand),
      last4: String(saved.value.card_last4),
    },
  };
}

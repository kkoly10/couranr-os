import type Stripe from "stripe";
import { stripe } from "@/lib/stripeClient";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { hashAccessToken } from "@/lib/couranr/accessTokens";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import type { FeedbackView } from "./feedbackTypes";

assertServerOnly("lib/couranr/driver/feedback.ts");

export type FeedbackScope =
  | { audience: "recipient"; rawToken: string }
  | { audience: "sender"; guestSessionId: string }
  | { audience: "merchant"; actorUserId: string };

function scopeArgs(scope: FeedbackScope) {
  return {
    p_audience: scope.audience,
    p_token_hash: scope.audience === "recipient" ? hashAccessToken(scope.rawToken) : null,
    p_guest_session_id: scope.audience === "sender" ? scope.guestSessionId : null,
    p_actor_user_id: scope.audience === "merchant" ? scope.actorUserId : null,
  };
}

export async function readDriverFeedback(deliveryId: string, scope: FeedbackScope): Promise<FeedbackView> {
  const { data, error } = await supabaseAdmin.rpc("couranr_get_driver_feedback", {
    p_delivery_id: deliveryId, ...scopeArgs(scope),
  });
  if (error) throw error;
  return data as FeedbackView;
}

export async function submitDriverReview(params: {
  deliveryId: string; scope: FeedbackScope; rating: number; comment: string;
}): Promise<FeedbackView> {
  const { error } = await supabaseAdmin.rpc("couranr_submit_driver_review", {
    p_delivery_id: params.deliveryId, ...scopeArgs(params.scope),
    p_rating: params.rating, p_comment: params.comment,
  });
  if (error) throw error;
  return readDriverFeedback(params.deliveryId, params.scope);
}

type TipRow = {
  id: string; delivery_id: string; driver_id: string; request_id: string;
  amount_cents: number; currency: string; provider_payment_intent_id: string | null;
  payment_state: string;
};

export function tipIntentMetadata(tip: TipRow): Record<string, string> {
  return {
    couranrTipId: tip.id,
    couranrTipDeliveryId: tip.delivery_id,
    couranrTipDriverId: tip.driver_id,
  };
}

function exactTipIntent(intent: Stripe.PaymentIntent, tip: TipRow): boolean {
  return intent.id === tip.provider_payment_intent_id &&
    intent.amount === tip.amount_cents && intent.currency === "usd" &&
    intent.capture_method === "automatic" &&
    intent.metadata?.couranrTipId === tip.id &&
    intent.metadata?.couranrTipDeliveryId === tip.delivery_id &&
    intent.metadata?.couranrTipDriverId === tip.driver_id;
}

/** A separate company-owned charge, never a delivery authorization or Connect transfer. */
export async function prepareDriverTip(params: {
  deliveryId: string; scope: FeedbackScope; amountCents: number;
}): Promise<{ clientSecret: string | null; state: string; amountCents: number }> {
  const { data, error } = await supabaseAdmin.rpc("couranr_prepare_driver_tip", {
    p_delivery_id: params.deliveryId, ...scopeArgs(params.scope),
    p_amount_cents: params.amountCents,
  });
  if (error) throw error;
  let tip = data as TipRow;
  if (tip.payment_state === "succeeded" || tip.payment_state === "refunded" ||
      tip.payment_state === "partially_refunded") {
    return { clientSecret: null, state: tip.payment_state, amountCents: tip.amount_cents };
  }
  let intent: Stripe.PaymentIntent;
  if (tip.provider_payment_intent_id) {
    intent = await stripe.paymentIntents.retrieve(tip.provider_payment_intent_id);
  } else {
    intent = await stripe.paymentIntents.create({
      amount: tip.amount_cents, currency: "usd", capture_method: "automatic",
      automatic_payment_methods: { enabled: true },
      metadata: tipIntentMetadata(tip),
      description: `Voluntary Couranr driver tip ${tip.delivery_id}`,
    }, { idempotencyKey: `couranr:driver-tip:${tip.id}:v1` });
    const attached = await supabaseAdmin.rpc("couranr_attach_driver_tip_intent", {
      p_tip_id: tip.id, p_intent_id: intent.id,
    });
    if (attached.error) throw attached.error;
    tip = attached.data as TipRow;
  }
  if (!exactTipIntent(intent, tip)) throw new Error("tip_intent_mismatch");
  return {
    clientSecret: intent.client_secret ?? null,
    state: tip.payment_state,
    amountCents: tip.amount_cents,
  };
}

/** The browser and webhook both re-read Stripe; neither trusts a callback body. */
export async function reconcileDriverTipIntent(intentId: string): Promise<{
  outcome: "not_tip" | "settled"; state?: string;
}> {
  const intent = await stripe.paymentIntents.retrieve(intentId);
  const tipId = intent.metadata?.couranrTipId;
  if (!tipId) return { outcome: "not_tip" };
  const { data, error } = await supabaseAdmin.from("couranr_driver_tips")
    .select("id,delivery_id,driver_id,request_id,amount_cents,currency,provider_payment_intent_id,payment_state")
    .eq("id", tipId).maybeSingle();
  if (error || !data || !exactTipIntent(intent, data as TipRow)) throw new Error("tip_provider_mismatch");
  const chargeId = typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge?.id;
  let refundedAmount = 0;
  let disputed = false;
  if (chargeId && intent.status === "succeeded") {
    const charge = await stripe.charges.retrieve(chargeId);
    const chargeIntentId = typeof charge.payment_intent === "string"
      ? charge.payment_intent : charge.payment_intent?.id;
    if (chargeIntentId !== intent.id || charge.amount !== intent.amount) {
      throw new Error("tip_charge_mismatch");
    }
    refundedAmount = charge.amount_refunded;
    disputed = charge.disputed;
  }
  const result = await supabaseAdmin.rpc("couranr_settle_driver_tip", {
    p_tip_id: data.id, p_intent_id: intent.id,
    p_delivery_id: data.delivery_id, p_driver_id: data.driver_id,
    p_status: intent.status, p_amount_cents: intent.amount,
    p_amount_received_cents: intent.amount_received,
    p_refunded_amount_cents: refundedAmount,
    p_currency: intent.currency, p_disputed: disputed,
  });
  if (result.error) throw result.error;
  return { outcome: "settled", state: result.data.payment_state };
}

/** Re-authorize the viewer and resolve the intent from the stored tip row. */
export async function reconcileDriverTipForViewer(deliveryId: string, scope: FeedbackScope): Promise<FeedbackView> {
  await readDriverFeedback(deliveryId, scope);
  const { data, error } = await supabaseAdmin.from("couranr_driver_tips")
    .select("provider_payment_intent_id").eq("delivery_id", deliveryId)
    .eq("audience", scope.audience).maybeSingle();
  if (error) throw error;
  if (data?.provider_payment_intent_id) await reconcileDriverTipIntent(data.provider_payment_intent_id);
  return readDriverFeedback(deliveryId, scope);
}

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
  payment_state: string; intent_generation: number;
};

export function tipIntentMetadata(tip: TipRow): Record<string, string> {
  return {
    couranrTipId: tip.id,
    couranrTipDeliveryId: tip.delivery_id,
    couranrTipDriverId: tip.driver_id,
  };
}

async function createTipIntent(tip: TipRow, generation: number): Promise<Stripe.PaymentIntent> {
  return stripe.paymentIntents.create({
    amount: tip.amount_cents, currency: "usd", capture_method: "automatic",
    automatic_payment_methods: { enabled: true },
    metadata: tipIntentMetadata(tip),
    description: `Voluntary Couranr driver tip ${tip.delivery_id}`,
  }, { idempotencyKey: `couranr:driver-tip:${tip.id}:intent:${generation}` });
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
  if (["succeeded", "refunded", "partially_refunded", "disputed", "dispute_lost"]
      .includes(tip.payment_state)) {
    return { clientSecret: null, state: tip.payment_state, amountCents: tip.amount_cents };
  }
  let intent: Stripe.PaymentIntent;
  if (tip.provider_payment_intent_id) {
    intent = await stripe.paymentIntents.retrieve(tip.provider_payment_intent_id);
    if (intent.status === "canceled") {
      const expectedIntent = tip.provider_payment_intent_id;
      const expectedGeneration = Number(tip.intent_generation ?? 0);
      const replacement = await createTipIntent(tip, expectedGeneration + 1);
      const rotated = await supabaseAdmin.rpc("couranr_replace_driver_tip_intent", {
        p_tip_id: tip.id,
        p_expected_intent_id: expectedIntent,
        p_expected_generation: expectedGeneration,
        p_new_intent_id: replacement.id,
      });
      if (rotated.error) {
        // A concurrent retry may already have attached the exact idempotent
        // replacement. Re-read once; never create another provider object.
        const latest = await supabaseAdmin.from("couranr_driver_tips")
          .select("id,delivery_id,driver_id,request_id,amount_cents,currency,provider_payment_intent_id,payment_state,intent_generation")
          .eq("id", tip.id).maybeSingle();
        if (latest.error || !latest.data?.provider_payment_intent_id ||
            latest.data.provider_payment_intent_id === expectedIntent) {
          throw rotated.error;
        }
        const latestIntentId = latest.data.provider_payment_intent_id;
        tip = latest.data as TipRow;
        intent = latestIntentId === replacement.id
          ? replacement
          : await stripe.paymentIntents.retrieve(latestIntentId);
      } else {
        tip = rotated.data as TipRow;
        intent = replacement;
      }
    }
  } else {
    intent = await createTipIntent(tip, Number(tip.intent_generation ?? 0));
    const attached = await supabaseAdmin.rpc("couranr_attach_driver_tip_intent", {
      p_tip_id: tip.id, p_intent_id: intent.id,
    });
    if (attached.error) {
      const latest = await supabaseAdmin.from("couranr_driver_tips")
        .select("id,delivery_id,driver_id,request_id,amount_cents,currency,provider_payment_intent_id,payment_state,intent_generation")
        .eq("id", tip.id).maybeSingle();
      if (latest.error || latest.data?.provider_payment_intent_id !== intent.id) throw attached.error;
      tip = latest.data as TipRow;
    } else {
      tip = attached.data as TipRow;
    }
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
    .select("id,delivery_id,driver_id,request_id,amount_cents,currency,provider_payment_intent_id,payment_state,intent_generation")
    .eq("id", tipId).maybeSingle();
  if (error || !data || !exactTipIntent(intent, data as TipRow)) throw new Error("tip_provider_mismatch");
  const chargeId = typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge?.id;
  let refundedAmount = 0;
  let disputeId: string | null = null;
  let disputeStatus: string | null = null;
  let disputedAmount = 0;
  if (chargeId && intent.status === "succeeded") {
    const charge = await stripe.charges.retrieve(chargeId);
    const chargeIntentId = typeof charge.payment_intent === "string"
      ? charge.payment_intent : charge.payment_intent?.id;
    if (chargeIntentId !== intent.id || charge.amount !== intent.amount) {
      throw new Error("tip_charge_mismatch");
    }
    refundedAmount = charge.amount_refunded;
    const disputes = await stripe.disputes.list({ charge: chargeId, limit: 10 });
    if (disputes.has_more || disputes.data.length > 1) {
      throw new Error("tip_multiple_disputes_unsupported");
    }
    const dispute = disputes.data[0];
    if (dispute) {
      const disputeChargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
      const disputeIntentId = typeof dispute.payment_intent === "string"
        ? dispute.payment_intent : dispute.payment_intent?.id;
      if (disputeChargeId !== chargeId || (disputeIntentId && disputeIntentId !== intent.id) ||
          dispute.currency !== "usd" || !Number.isInteger(dispute.amount) ||
          dispute.amount <= 0 || dispute.amount > intent.amount - refundedAmount) {
        throw new Error("tip_dispute_mismatch");
      }
      disputeId = dispute.id;
      disputeStatus = dispute.status;
      disputedAmount = dispute.amount;
    }
  }
  const result = await supabaseAdmin.rpc("couranr_settle_driver_tip", {
    p_tip_id: data.id, p_intent_id: intent.id,
    p_delivery_id: data.delivery_id, p_driver_id: data.driver_id,
    p_status: intent.status, p_amount_cents: intent.amount,
    p_amount_received_cents: intent.amount_received,
    p_refunded_amount_cents: refundedAmount,
    p_currency: intent.currency,
    p_dispute_id: disputeId,
    p_dispute_status: disputeStatus,
    p_disputed_amount_cents: disputedAmount,
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

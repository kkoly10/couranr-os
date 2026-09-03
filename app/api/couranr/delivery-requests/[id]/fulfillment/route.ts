import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import {
  getCanonicalDelivery,
  getServicePlan,
  isFulfillmentFailure,
} from "@/lib/couranr/fulfillment/commands";
import { getDeliveryRequest, isCommandFailure } from "@/lib/couranr/requests/commands";
import {
  getNewestRefundAttemptForObligation,
  getObligationForRequest,
  isPaymentFailure,
} from "@/lib/couranr/payments/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * GET — the lifecycle view of one request: payment, plan and delivery.
 *
 * Serves MER-007 and OPS-003 from one place so the merchant and Operations
 * cannot be looking at different answers. The scope is the caller's: a
 * merchant passes their business account and sees only their own; Operations
 * passes none and reads across businesses, which only they may do.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!UUID_RE.test(params.id)) return routeFailure("not_found", "Delivery request not found.");

  const businessAccountId = req.nextUrl.searchParams.get("businessAccountId");
  if (businessAccountId !== null && !UUID_RE.test(businessAccountId)) {
    return routeFailure("invalid_input", "A business account is required.");
  }

  const actor = await resolveRequestActor(req, businessAccountId);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  // Authorizes the read; also the only place the business scope is resolved.
  const loaded = await getDeliveryRequest({
    actor: actor.actor,
    businessAccountId,
    requestId: params.id,
  });
  if (isCommandFailure(loaded)) return failureResponse(loaded);

  const ob = await getObligationForRequest({ requestId: params.id, businessAccountId });
  if (isPaymentFailure(ob)) return failureResponse(ob);

  // Review item 6: the screen's refund controls are decided by the newest
  // attempt's state, not guessed from the obligation alone.
  let refundAttempt: {
    state: string;
    amountCents: number;
    retainedCents: number;
    reason: string;
  } | null = null;
  if (ob.value.obligation) {
    const att = await getNewestRefundAttemptForObligation({
      obligationId: String(ob.value.obligation.id),
    });
    if (isPaymentFailure(att)) return failureResponse(att);
    refundAttempt = att.value.attempt
      ? {
          state: att.value.attempt.attempt_state,
          amountCents: att.value.attempt.amount_cents,
          retainedCents: att.value.attempt.retained_cents,
          reason: att.value.attempt.reason,
        }
      : null;
  }

  const plan = await getServicePlan({ requestId: params.id });
  if (isFulfillmentFailure(plan)) return failureResponse(plan);

  const delivery = await getCanonicalDelivery({ requestId: params.id, businessAccountId });
  if (isFulfillmentFailure(delivery)) return failureResponse(delivery);

  return NextResponse.json({
    readinessState: loaded.value.request.readiness_state,
    requestState: loaded.value.request.request_state,
    payment: ob.value.obligation
      ? {
          id: ob.value.obligation.id,
          amountCents: ob.value.obligation.amount_cents,
          currency: ob.value.obligation.currency,
          paymentState: ob.value.obligation.payment_state,
          payerType: ob.value.obligation.payer_type,
          // Batch 3 §A: the commercial approval instant and what it is.
          // provider_event = the signature-verified provider instant;
          // processing_fallback = provider instant unknown, stamp is Couranr
          // processing time. Never invented either way.
          authorizedAt: ob.value.obligation.authorized_at ?? null,
          authorizedAtSource: ob.value.obligation.authorized_at_source ?? null,
          authorizationProcessedAt: ob.value.obligation.authorization_processed_at ?? null,
          capturedAmountCents: ob.value.obligation.captured_amount_cents ?? null,
          refundedAmountCents: ob.value.obligation.refunded_amount_cents ?? null,
          refundedAt: ob.value.obligation.refunded_at ?? null,
          // Batch 3 §B: a provider hold with no local authorization — the
          // stale-quote case Operations must be able to release.
          staleProviderHold:
            Boolean(ob.value.obligation.provider_payment_intent_id) &&
            ["not_started", "requires_action"].includes(String(ob.value.obligation.payment_state)),
          refundAttempt,
        }
      : null,
    servicePlan: plan.value.plan
      ? {
          id: plan.value.plan.id,
          planState: plan.value.plan.plan_state,
          scheduledPickupStart: plan.value.plan.scheduled_pickup_start,
          scheduledPickupEnd: plan.value.plan.scheduled_pickup_end,
          timezone: plan.value.plan.timezone,
          vehicleRequirement: plan.value.plan.vehicle_requirement,
        }
      : null,
    delivery: delivery.value.delivery
      ? {
          id: delivery.value.delivery.id,
          fulfillmentState: delivery.value.delivery.fulfillment_state,
          capturedAmountCents: delivery.value.delivery.captured_amount_cents,
          scheduledPickupStart: delivery.value.delivery.scheduled_pickup_start,
          scheduledPickupEnd: delivery.value.delivery.scheduled_pickup_end,
          timezone: delivery.value.delivery.timezone,
          // No driver is assigned in this slice, and saying so explicitly is
          // better than an absent field a screen might read as "unknown".
          driverAssigned: false,
        }
      : null,
  });
}

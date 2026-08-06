import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import {
  getCanonicalDelivery,
  getServicePlan,
  isFulfillmentFailure,
} from "@/lib/couranr/fulfillment/commands";
import { getDeliveryRequest, isCommandFailure } from "@/lib/couranr/requests/commands";
import { getObligationForRequest, isPaymentFailure } from "@/lib/couranr/payments/commands";
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

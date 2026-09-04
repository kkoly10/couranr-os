import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import {
  createDeliveryFromPromotionalCredit,
  isFulfillmentFailure,
} from "@/lib/couranr/fulfillment/commands";
import { getDeliveryRequest, isCommandFailure } from "@/lib/couranr/requests/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST — create the canonical delivery from an applied Couranr promotional credit.
 *
 * No amount is accepted from the browser and this route never touches Stripe.
 * The database verifies the current immutable quote, applied credit, merchant
 * readiness, confirmed plan and tenant before conversion.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!UUID_RE.test(params.id)) return routeFailure("not_found", "Delivery request not found.");

  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  const loaded = await getDeliveryRequest({
    actor: actor.actor,
    businessAccountId: null,
    requestId: params.id,
  });
  if (isCommandFailure(loaded)) return failureResponse(loaded);

  const result = await createDeliveryFromPromotionalCredit({
    actor: actor.actor,
    requestId: params.id,
    businessAccountId: loaded.value.request.business_account_id ?? null,
  });
  if (isFulfillmentFailure(result)) return failureResponse(result);

  return NextResponse.json({
    deliveryId: result.value.delivery.id,
    fulfillmentState: result.value.delivery.fulfillment_state,
    settlement: "promotional_credit",
  });
}

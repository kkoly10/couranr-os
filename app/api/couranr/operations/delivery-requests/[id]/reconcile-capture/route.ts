import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { isFulfillmentFailure, reconcileCapture } from "@/lib/couranr/fulfillment/commands";
import { getDeliveryRequest, isCommandFailure } from "@/lib/couranr/requests/commands";
import { getObligationForRequest, isPaymentFailure } from "@/lib/couranr/payments/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST — ask the payment provider what actually happened, and settle.
 *
 * This is the ONLY exit from `capture_pending`, and it is deliberately not a
 * second capture. `capture_pending` means Couranr does not know whether the
 * money moved; the safe action is to READ the provider's answer and then
 * either finish the capture or release the hold so it can be retried. A retry
 * button here would be an invitation to capture twice.
 *
 * Takes no amount, no target state and no provider identifier — the intent is
 * the one already attached to the obligation.
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

  const ob = await getObligationForRequest({ requestId: params.id, businessAccountId: null });
  if (isPaymentFailure(ob)) return failureResponse(ob);

  const obligation = ob.value.obligation;
  if (!obligation) {
    return routeFailure("conflict", "This delivery has no payment to reconcile.");
  }
  if (obligation.payment_state !== "capture_pending") {
    // Nothing to settle. Refusing is better than a no-op that reads as work
    // having been done.
    return routeFailure("conflict", "This payment is not waiting on the provider.");
  }
  if (!obligation.provider_payment_intent_id) {
    return routeFailure("conflict", "This payment has no provider record to check.");
  }

  const result = await reconcileCapture({
    actor: actor.actor,
    requestId: params.id,
    businessAccountId: String(loaded.value.request.business_account_id),
    obligationId: String(obligation.id),
    // Identifies WHICH capture cycle is being settled, so a second failed
    // cycle records its own release rather than colliding with the first.
    obligationVersion: Number(obligation.version),
    paymentIntentId: String(obligation.provider_payment_intent_id),
  });
  if (isFulfillmentFailure(result)) return failureResponse(result);

  return NextResponse.json({
    outcome: result.value.outcome,
    paymentState: result.value.paymentState,
    deliveryId: result.value.deliveryId,
  });
}

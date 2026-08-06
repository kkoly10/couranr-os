import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { capturePayment, isFulfillmentFailure } from "@/lib/couranr/fulfillment/commands";
import { getDeliveryRequest, isCommandFailure } from "@/lib/couranr/requests/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST — capture the authorized payment and create the canonical delivery.
 *
 * The body carries NO amount: the amount is the one already authorized, and
 * Stripe captures the full hold by default. Every prerequisite — confirmed
 * request, ready merchant, confirmed service plan for this generation, no
 * existing delivery — is re-checked in the database inside the same statement
 * that moves the obligation, so a stale Operations tab cannot capture against
 * a request that has moved on.
 *
 * Safe to retry: `couranr_begin_payment_capture` returns the existing
 * obligation when a capture is already in flight or done, Stripe's idempotency
 * key returns the first capture rather than performing a second, and
 * conversion is idempotent on `request_id`.
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

  const result = await capturePayment({
    actor: actor.actor,
    requestId: params.id,
    businessAccountId: String(loaded.value.request.business_account_id),
  });
  if (isFulfillmentFailure(result)) return failureResponse(result);

  return NextResponse.json({
    paymentState: result.value.paymentState,
    deliveryId: result.value.deliveryId,
    fulfillmentState: "scheduled",
  });
}

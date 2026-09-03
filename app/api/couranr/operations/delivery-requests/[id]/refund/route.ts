import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { isFulfillmentFailure, refundPayment } from "@/lib/couranr/fulfillment/commands";
import { getDeliveryRequest, isCommandFailure } from "@/lib/couranr/requests/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { REFUND_REASONS, type RefundReason } from "@/lib/couranr/payments/states";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST — refund captured money under a GOVERNED reason (batch 3 §B/§30).
 *
 * The body carries exactly one field: a reason from the closed
 * `REFUND_REASONS` vocabulary. There is NO amount parameter anywhere on this
 * path — `couranr_begin_payment_refund` derives the figure from the captured
 * amount and CAN-001's retention table, so no browser, merchant or operator
 * can type a refund figure.
 *
 * Safe to retry. The attempt row is persisted before Stripe is called and a
 * replay converges on it under the same provider idempotency key.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!UUID_RE.test(params.id)) return routeFailure("not_found", "Delivery request not found.");

  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Pick a governed refund reason.");
  }

  const reason = typeof body?.reason === "string" ? body.reason : "";
  if (!(REFUND_REASONS as readonly string[]).includes(reason)) {
    return routeFailure("invalid_input", "Pick a governed refund reason.");
  }

  const loaded = await getDeliveryRequest({
    actor: actor.actor,
    businessAccountId: null,
    requestId: params.id,
  });
  if (isCommandFailure(loaded)) return failureResponse(loaded);

  const result = await refundPayment({
    actor: actor.actor,
    requestId: params.id,
    businessAccountId: loaded.value.request.business_account_id ?? null,
    reason: reason as RefundReason,
  });
  if (isFulfillmentFailure(result)) return failureResponse(result);

  // Nested under a named key, like every other canonical route.
  return NextResponse.json({ refund: result.value });
}

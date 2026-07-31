import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import {
  getObligationForRequest,
  isPaymentFailure,
  reconcilePaymentIntent,
} from "@/lib/couranr/payments/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST — the merchant's Payment Element says it finished. Go and check.
 *
 * The authenticated twin of `/api/couranr/pay/[token]/reconcile`. Same rule:
 * the body carries no state, no amount and no PaymentIntent id, because
 * nothing the browser says about a payment is believed. The obligation names
 * its own intent, the server retrieves it from Stripe, and whatever Stripe
 * says is what gets applied.
 *
 * Scoped by business account, so a merchant cannot reconcile — or learn
 * anything about — another merchant's delivery.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) return routeFailure("not_found", "Delivery request not found.");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Expected a JSON body.");
  }

  const businessAccountId = String(body?.businessAccountId ?? "");
  if (!UUID_RE.test(businessAccountId)) {
    return routeFailure("invalid_input", "A business account is required.");
  }

  const actor = await resolveRequestActor(req, businessAccountId);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  const ob = await getObligationForRequest({ requestId: params.id, businessAccountId });
  if (isPaymentFailure(ob)) return failureResponse(ob);
  if (!ob.value.obligation) return routeFailure("not_found", "There is nothing to pay for here.");

  const intentId = ob.value.obligation.provider_payment_intent_id;
  if (!intentId) return routeFailure("conflict", "Payment has not been set up yet.");

  const applied = await reconcilePaymentIntent({ intentId: String(intentId) });
  if (isPaymentFailure(applied)) return failureResponse(applied);

  return NextResponse.json({
    outcome: applied.value.outcome,
    paymentState: applied.value.payment_state,
    requestState: applied.value.request_state,
  });
}

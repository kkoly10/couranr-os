import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import {
  ensurePaymentIntent,
  ensurePaymentObligation,
  isPaymentFailure,
} from "@/lib/couranr/payments/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST — begin merchant-paid authorization for a delivery request (MER-007).
 *
 * The body carries NO amount. It cannot: `ensurePaymentObligation` reads the
 * price off the request, and `ensurePaymentIntent` reads it off the obligation.
 * A client that posts `amountCents` is simply ignored — there is nowhere for
 * the value to go.
 *
 * Returns a client secret, which authorizes confirming THIS PaymentIntent and
 * nothing else. Returning it does not mean anything is authorized: the
 * obligation is at `requires_action` until a verified `requires_capture` state
 * arrives.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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

  const obligation = await ensurePaymentObligation({
    actor: actor.actor,
    requestId: params.id,
    businessAccountId,
    // One key per request. A second click reaches the same idempotent create.
    idempotencyKey: `authorize:${params.id}`,
  });
  // Through the one audited path, like every other canonical failure.
  if (isPaymentFailure(obligation)) return failureResponse(obligation);

  const intent = await ensurePaymentIntent({ obligation: obligation.value.obligation });
  if (isPaymentFailure(intent)) return failureResponse(intent);

  return NextResponse.json({
    obligation: {
      id: intent.value.obligation.id,
      amountCents: intent.value.obligation.amount_cents,
      currency: intent.value.obligation.currency,
      paymentState: intent.value.obligation.payment_state,
      payerType: intent.value.obligation.payer_type,
    },
    // Scoped to one intent. Not a secret in the credential sense, and never
    // logged or stored regardless.
    clientSecret: intent.value.clientSecret,
  });
}

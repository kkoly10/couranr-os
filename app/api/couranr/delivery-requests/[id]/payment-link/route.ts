import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { getDeliveryRequest, isCommandFailure } from "@/lib/couranr/requests/commands";
import {
  getObligationForRequest,
  isPaymentFailure,
  issuePaymentLink,
} from "@/lib/couranr/payments/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST — issue a customer payment link for the CURRENT obligation.
 *
 * Net-new. `issuePaymentLink` has existed since the authorization slice and
 * had zero callers, which meant `MerchantPaymentPanel` promised "Couranr sends
 * the recipient a secure payment link" for a link nothing sent, and
 * `PaymentLinkPage` told refused customers to "ask the business to send a new
 * payment link" — an action no surface exposed.
 *
 * The raw token is returned to the caller EXACTLY ONCE and never persisted;
 * only its SHA-256 hash reaches the database. It is therefore never logged and
 * never placed in a URL by this route — the caller shows it to the merchant,
 * who sends it.
 *
 * The obligation is chosen by the SERVER from the request, never named by the
 * caller, so a link can only ever point at the live obligation for this
 * delivery.
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

  // Authorizes the read and resolves the business scope in one place.
  const loaded = await getDeliveryRequest({
    actor: actor.actor,
    businessAccountId,
    requestId: params.id,
  });
  if (isCommandFailure(loaded)) return failureResponse(loaded);

  const ob = await getObligationForRequest({ requestId: params.id, businessAccountId });
  if (isPaymentFailure(ob)) return failureResponse(ob);

  const obligation = ob.value.obligation;
  if (!obligation) {
    return routeFailure("conflict", "This delivery has no payment to collect yet.");
  }
  if (obligation.payer_type !== "customer") {
    // A merchant-paid delivery is authorized by the merchant in MER-007. A
    // link would invite the wrong person to pay.
    return routeFailure("conflict", "This delivery is paid by the business, not the recipient.");
  }
  if (obligation.payment_state === "authorized") {
    return routeFailure("conflict", "This payment is already authorized.");
  }
  if (obligation.payment_state === "capture_pending" || obligation.payment_state === "captured") {
    return routeFailure("conflict", "This payment is already being collected.");
  }

  const link = await issuePaymentLink({
    actor: actor.actor,
    requestId: params.id,
    businessAccountId,
    obligationId: String(obligation.id),
  });
  if (isPaymentFailure(link)) return failureResponse(link);

  /*
   * Issuing revokes every older live token for this request, so the previous
   * link stops working the moment a new one exists. The response carries the
   * raw token once; it is not stored and cannot be re-read.
   */
  return NextResponse.json({
    token: link.value.token,
    expiresAt: link.value.expiresAt,
    amountCents: obligation.amount_cents,
    paymentState: obligation.payment_state,
  });
}

import { NextRequest, NextResponse } from "next/server";
import {
  redeemGuestSessionToken,
  isConsumerFailure,
  submitConsumerSend,
} from "@/lib/couranr/consumer/send";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { advanceAutomaticFulfillment } from "@/lib/couranr/automation/engine";

export const dynamic = "force-dynamic";

/**
 * PUB-004 consumer /send — submit for Couranr review.
 *
 * NO AUTO-ACCEPT: the request enters the same Couranr review every
 * customer-paid request goes through, and payment opens only after Couranr
 * accepts it.
 *
 * THE BODY CARRIES EXACTLY TWO THINGS, and neither is a commercial fact: what
 * the sender says the shipment is worth, and their two acknowledgements. The
 * session still names the request, the server still holds every price, state
 * and target, the protection LEVEL is derived rather than accepted, and
 * FORBIDDEN_CONSUMER_KEYS still refuses a body reaching for any of them.
 *
 * An acknowledgement is the one fact the server cannot hold on the sender's
 * behalf: it exists only because a person ticked a box, and they tick it at
 * submission rather than at pricing — so it has to arrive here. A malformed or
 * absent body is refused by submitConsumerSend, never defaulted.
 */
export async function POST(req: NextRequest) {
  const session = await redeemGuestSessionToken(req);
  if (isConsumerFailure(session)) return routeFailure("not_found");

  const body = await req.json().catch(() => ({}));
  const r = await submitConsumerSend({ session: session.value, body });
  if (isConsumerFailure(r)) return failureResponse(r);
  if (session.value.requestId) {
    await advanceAutomaticFulfillment(String(session.value.requestId));
  }
  return NextResponse.json({ request: { state: r.value.state } });
}

import { NextRequest, NextResponse } from "next/server";
import {
  redeemGuestSessionToken,
  isConsumerFailure,
  submitConsumerSend,
} from "@/lib/couranr/consumer/send";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { consumerSendServerLive } from "@/lib/couranr/sameday/serverGate";
import { advanceAutomaticFulfillment } from "@/lib/couranr/automation/engine";

export const dynamic = "force-dynamic";

/**
 * PUB-004 consumer /send — submit for Couranr review.
 *
 * NO AUTO-ACCEPT: the request enters the same Couranr review every
 * customer-paid request goes through, and payment opens only after Couranr
 * accepts it. The body is not read at all — the session names the request,
 * and the server holds every fact about it.
 */
export async function POST(req: NextRequest) {
  if (!consumerSendServerLive()) return routeFailure("not_found");

  const session = await redeemGuestSessionToken(req);
  if (isConsumerFailure(session)) return routeFailure("not_found");

  const r = await submitConsumerSend({ session: session.value });
  if (isConsumerFailure(r)) return failureResponse(r);
  if (session.value.requestId) {
    await advanceAutomaticFulfillment(String(session.value.requestId));
  }
  return NextResponse.json({ request: { state: r.value.state } });
}

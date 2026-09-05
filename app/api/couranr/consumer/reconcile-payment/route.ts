import { NextRequest, NextResponse } from "next/server";
import {
  redeemGuestSessionToken,
  isConsumerFailure,
  reconcileConsumerPayment,
} from "@/lib/couranr/consumer/send";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { consumerSendServerLive } from "@/lib/couranr/sameday/serverGate";
import { advanceAutomaticFulfillment } from "@/lib/couranr/automation/engine";

export const dynamic = "force-dynamic";

/**
 * PUB-004 consumer /send — verify what Stripe actually says.
 *
 * The browser's claim of success is discarded; the server re-reads the
 * intent and applies the verified state. The body is never read.
 */
export async function POST(req: NextRequest) {
  if (!consumerSendServerLive()) return routeFailure("not_found");

  const session = await redeemGuestSessionToken(req);
  if (isConsumerFailure(session)) return routeFailure("not_found");

  const r = await reconcileConsumerPayment({ session: session.value });
  if (isConsumerFailure(r)) return failureResponse(r);
  if (session.value.requestId) {
    await advanceAutomaticFulfillment(String(session.value.requestId));
  }
  return NextResponse.json({
    payment: { outcome: r.value.outcome, paymentState: r.value.paymentState },
  });
}

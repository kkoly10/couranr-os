import { NextRequest, NextResponse } from "next/server";
import {
  getConsumerSendView,
  redeemGuestSessionToken,
  isConsumerFailure,
} from "@/lib/couranr/consumer/send";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { consumerSendServerLive } from "@/lib/couranr/sameday/serverGate";

export const dynamic = "force-dynamic";

/**
 * PUB-004 consumer /send — the guest's own-request projection.
 *
 * Deliberately narrow: state, quote status, total, payment state — no
 * internal ids, no merchant data, no history. When the request is confirmed
 * and no live tracking link exists, one is minted and the RAW tracking token
 * appears in this response exactly once; it is never recoverable afterwards.
 */
export async function GET(req: NextRequest) {
  if (!consumerSendServerLive()) return routeFailure("not_found");

  const session = await redeemGuestSessionToken(req);
  if (isConsumerFailure(session)) return routeFailure("not_found");

  const r = await getConsumerSendView({ session: session.value });
  if (isConsumerFailure(r)) return failureResponse(r);
  return NextResponse.json({ request: r.value });
}

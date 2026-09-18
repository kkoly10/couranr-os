import { NextRequest, NextResponse } from "next/server";
import {
  getConsumerSendView,
  redeemGuestSessionToken,
  isConsumerFailure,
} from "@/lib/couranr/consumer/send";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

/**
 * PUB-004 consumer /send — the guest's own-request projection.
 *
 * Deliberately narrow: state, quote status, total, payment state — no
 * internal ids, no merchant data, no history.
 *
 * THIS COMMENT USED TO SAY the raw tracking token appears in this response
 * exactly once. It no longer does, and the change was the point: the SENDER IS
 * NEVER GIVEN THE RECIPIENT'S TOKEN. The recipient is emailed their own private
 * tracking by the lifecycle, and this response reports only that a notification
 * was sent and to which address. A comment describing the capability that was
 * deliberately removed is an invitation to put it back.
 */
export async function GET(req: NextRequest) {
  const session = await redeemGuestSessionToken(req);
  if (isConsumerFailure(session)) return routeFailure("not_found");

  const r = await getConsumerSendView({ session: session.value });
  if (isConsumerFailure(r)) return failureResponse(r);
  return NextResponse.json({ request: r.value });
}

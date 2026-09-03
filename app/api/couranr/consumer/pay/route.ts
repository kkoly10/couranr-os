import { NextRequest, NextResponse } from "next/server";
import {
  redeemGuestSessionToken,
  isConsumerFailure,
  payConsumerSend,
} from "@/lib/couranr/consumer/send";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

/**
 * PUB-004 consumer /send — start payment authorization.
 *
 * Reachable ONLY while the request is in a payable state, i.e. after Couranr
 * review accepted it. The amount comes from the stored obligation — the body
 * is never read — and the client secret is the one payment value that
 * legitimately crosses to the browser.
 */
export async function POST(req: NextRequest) {
  const session = await redeemGuestSessionToken(req);
  if (isConsumerFailure(session)) return routeFailure("not_found");

  const r = await payConsumerSend({ session: session.value });
  if (isConsumerFailure(r)) return failureResponse(r);
  return NextResponse.json({
    payment: { clientSecret: r.value.clientSecret, amountCents: r.value.amountCents },
  });
}

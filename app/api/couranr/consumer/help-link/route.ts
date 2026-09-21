import { NextRequest, NextResponse } from "next/server";
import { redeemGuestSessionToken, isConsumerFailure } from "@/lib/couranr/consumer/send";
import { issueCustomerHelpToken, isHelpFailure } from "@/lib/couranr/conversations/help";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await redeemGuestSessionToken(req);
  if (isConsumerFailure(session)) return routeFailure("not_found");
  if (!session.value.requestId) return routeFailure("not_found");
  const issued = await issueCustomerHelpToken({
    sourceKind: "sender_guest",
    rawSourceToken: req.headers.get("x-couranr-guest") ?? "",
  });
  if (isHelpFailure(issued)) return failureResponse(issued);
  return NextResponse.json({ help: issued.value }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

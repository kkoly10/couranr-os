import { NextRequest, NextResponse } from "next/server";
import { isWellFormedTrackingToken } from "@/lib/couranr/tracking/tokens";
import { issueCustomerHelpToken, isHelpFailure } from "@/lib/couranr/conversations/help";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!isWellFormedTrackingToken(token)) return routeFailure("not_found");
  const issued = await issueCustomerHelpToken({ sourceKind: "recipient_tracking", rawSourceToken: token });
  if (isHelpFailure(issued)) return failureResponse(issued);
  return NextResponse.json({ help: issued.value }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

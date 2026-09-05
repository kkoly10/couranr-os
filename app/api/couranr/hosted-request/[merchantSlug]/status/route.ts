import { NextRequest, NextResponse } from "next/server";
import {
  redeemGuestSessionToken,
  isConsumerFailure,
} from "@/lib/couranr/consumer/send";
import {
  getHostedGuestStatus,
  isHostedFailure,
} from "@/lib/couranr/hosted/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

/** Narrow resume/status projection for the owner of the guest-session token. */
export async function GET(
  req: NextRequest,
  props: { params: Promise<{ merchantSlug: string }> }
) {
  const { merchantSlug } = await props.params;
  const session = await redeemGuestSessionToken(req);
  if (isConsumerFailure(session)) return routeFailure("not_found");

  const result = await getHostedGuestStatus({
    session: session.value,
    merchantSlug,
  });
  if (isHostedFailure(result)) return failureResponse(result);
  return NextResponse.json({ request: result.value });
}

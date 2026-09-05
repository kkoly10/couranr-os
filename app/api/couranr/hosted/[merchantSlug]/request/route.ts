import { NextRequest, NextResponse } from "next/server";
import {
  isHostedFailure,
  readHostedRequest,
  redeemHostedSessionToken,
} from "@/lib/couranr/hosted/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ merchantSlug: string }> }
) {
  const { merchantSlug } = await props.params;
  const session = await redeemHostedSessionToken(req, merchantSlug);
  if (isHostedFailure(session)) return routeFailure("not_found");

  const result = await readHostedRequest(session.value);
  if (isHostedFailure(result)) return failureResponse(result);
  return NextResponse.json(result.value, {
    headers: { "cache-control": "no-store" },
  });
}

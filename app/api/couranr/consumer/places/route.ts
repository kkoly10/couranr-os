import { NextRequest, NextResponse } from "next/server";
import {
  autocompleteConsumerPlaces,
  redeemGuestSessionToken,
  isConsumerFailure,
} from "@/lib/couranr/consumer/send";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

/**
 * Guest-gated Places autocomplete for the /send funnel.
 *
 * The gate exists so Couranr's Google quota cannot be farmed anonymously: a
 * malformed, unknown, revoked or expired guest token gets ONE uniform 404.
 * Suggestions are hints only — the Place ID a guest picks is re-verified by
 * Place Details inside the estimate pipeline.
 */
export async function GET(req: NextRequest) {
  const session = await redeemGuestSessionToken(req);
  if (isConsumerFailure(session)) return routeFailure("not_found");

  const r = await autocompleteConsumerPlaces(req.nextUrl.searchParams.get("query"));
  if (isConsumerFailure(r)) return failureResponse(r);
  return NextResponse.json({ suggestions: r.value.suggestions });
}

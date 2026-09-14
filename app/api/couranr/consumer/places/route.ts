import { NextRequest, NextResponse } from "next/server";
import {
  autocompleteConsumerPlaces,
  claimConsumerPlaceSearch,
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
 * Then a per-session throttle runs BEFORE any paid provider call — a rate-
 * limited request never reaches Google, and the shared global paid-provider
 * budget remains the final backstop. Suggestions are hints only; the Place ID
 * a guest picks is re-verified by Place Details inside the estimate pipeline.
 */
export async function GET(req: NextRequest) {
  const session = await redeemGuestSessionToken(req);
  if (isConsumerFailure(session)) return routeFailure("not_found");

  // Per-guest-session rate limit BEFORE the paid provider call. A 429 here
  // means no Google request was made.
  const throttle = await claimConsumerPlaceSearch(session.value);
  if (isConsumerFailure(throttle)) return failureResponse(throttle);

  const r = await autocompleteConsumerPlaces(req.nextUrl.searchParams.get("query"));
  if (isConsumerFailure(r)) return failureResponse(r);
  // `degraded` distinguishes a provider outage/budget stop (empty-but-failed)
  // from a genuine no-result, so the client can show the right message.
  return NextResponse.json({ suggestions: r.value.suggestions, degraded: r.value.degraded });
}

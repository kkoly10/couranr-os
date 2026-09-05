import { NextRequest, NextResponse } from "next/server";
import {
  claimHostedPlaceSearch,
  isHostedFailure,
  redeemHostedSessionToken,
} from "@/lib/couranr/hosted/commands";
import {
  autocompleteConsumerPlaces,
  isConsumerFailure,
} from "@/lib/couranr/consumer/send";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

/**
 * Hosted address suggestions reuse the same guarded Google Places (New)
 * autocomplete seam as /send. The selected Place ID is only customer evidence
 * here; Place Details is deferred until the host merchant validates.
 */
export async function GET(
  req: NextRequest,
  props: { params: Promise<{ merchantSlug: string }> }
) {
  const { merchantSlug } = await props.params;
  const session = await redeemHostedSessionToken(req, merchantSlug);
  if (isHostedFailure(session)) return routeFailure("not_found");

  const query = req.nextUrl.searchParams.get("query") ?? "";
  const normalized = query.trim();

  // Invalid/too-short input costs nothing and consumes no throttle slot.
  if (normalized.length < 3 || normalized.length > 120) {
    return NextResponse.json(
      { suggestions: [] },
      { headers: { "cache-control": "no-store" } }
    );
  }

  // Per-session throttle FIRST, global paid-provider budget SECOND inside the
  // shared autocomplete seam, Google call LAST.
  const claimed = await claimHostedPlaceSearch(session.value);
  if (isHostedFailure(claimed)) return failureResponse(claimed);

  const result = await autocompleteConsumerPlaces(normalized);
  if (isConsumerFailure(result)) return failureResponse(result);
  return NextResponse.json(result.value, {
    headers: { "cache-control": "no-store" },
  });
}

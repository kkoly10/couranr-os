import { NextRequest, NextResponse } from "next/server";
import {
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
  const result = await autocompleteConsumerPlaces(query);
  if (isConsumerFailure(result)) return failureResponse(result);
  return NextResponse.json(result.value, {
    headers: { "cache-control": "no-store" },
  });
}

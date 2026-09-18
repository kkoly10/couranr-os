import { NextRequest, NextResponse } from "next/server";
import { isLoadFailure, loadOperationsAnalytics, parseFilters } from "@/lib/couranr/operations/analytics";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { routeFailure, routeInternalFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

/**
 * OPS-013. Operations-only, privacy-safe aggregates.
 *
 * `resolveRequestActor(req, null)` is the Operations-only form: no membership
 * is looked up and a caller without an Operations profile role is refused, so
 * this never becomes a cross-tenant read for a merchant who guesses the URL.
 *
 * The response carries aggregates only. Every string in it is a UUID, an
 * ISO-8601 timestamp, or a member of a closed vocabulary — see the privacy
 * contract in `lib/couranr/operations/analytics.ts`.
 */
export async function GET(req: NextRequest) {
  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  const result = await loadOperationsAnalytics(parseFilters(req.nextUrl.searchParams));

  /*
   * FAILS CLOSED. A source that could not be read is not an empty source, and
   * rendering it as zeros would be a fabricated measurement — the one thing
   * this surface must never produce.
   */
  if (isLoadFailure(result)) {
    return routeInternalFailure({
      operation: "operations.analytics.overview",
      detail: { failedSources: result.failedSources },
      message: "Could not load Operations analytics.",
    });
  }

  return NextResponse.json({ analytics: result.value });
}

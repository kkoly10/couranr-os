import { NextRequest, NextResponse } from "next/server";
import { isLoadFailure, loadUnmetDemandAnalytics, parseFilters } from "@/lib/couranr/operations/analytics";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { routeFailure, routeInternalFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

/**
 * OPS-014. Requests Couranr could not confirm, attributed to RECORDED causes.
 *
 * Operations-only, same gate as its OPS-013 sibling. The payload separates
 * "never submitted", "still open" and "could not confirm" rather than summing
 * them, and carries its unattributed count as its own number — the registry's
 * "partial attribution" state — so no caller can read one total as lost
 * customers.
 */
export async function GET(req: NextRequest) {
  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  const result = await loadUnmetDemandAnalytics(parseFilters(req.nextUrl.searchParams));

  if (isLoadFailure(result)) {
    return routeInternalFailure({
      operation: "operations.analytics.unmetDemand",
      detail: { failedSources: result.failedSources },
      message: "Could not load unmet demand analytics.",
    });
  }

  return NextResponse.json({ unmetDemand: result.value });
}

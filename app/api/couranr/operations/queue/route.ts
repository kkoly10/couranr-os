import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { isCommandFailure, listReviewQueue } from "@/lib/couranr/requests/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { toDeliveryRequestView } from "@/lib/couranr/requests/view";

export const dynamic = "force-dynamic";

/** GET — OPS-002 Couranr Operations Queue. Operations only. */
export async function GET(req: NextRequest) {
  // null scope: this route is Operations-only, so no membership is consulted
  // and a merchant is refused before any query runs.
  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  const result = await listReviewQueue({ actor: actor.actor });
  if (isCommandFailure(result)) return failureResponse(result);

  return NextResponse.json({ requests: result.value.map(toDeliveryRequestView) });
}

import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { getDeliveryRequest, isCommandFailure } from "@/lib/couranr/requests/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { toDeliveryRequestView } from "@/lib/couranr/requests/view";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** GET — MER-007 delivery detail. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) {
    return routeFailure("not_found", "Delivery request not found.");
  }

  const businessAccountId = req.nextUrl.searchParams.get("businessAccountId");
  if (businessAccountId !== null && !UUID_RE.test(businessAccountId)) {
    return routeFailure("invalid_input", "A business account is required.");
  }

  const actor = await resolveRequestActor(req, businessAccountId);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  const result = await getDeliveryRequest({
    actor: actor.actor,
    businessAccountId,
    requestId: params.id,
  });
  if (isCommandFailure(result)) return failureResponse(result);

  return NextResponse.json({
    request: toDeliveryRequestView(result.value.request),
    events: result.value.events,
  });
}

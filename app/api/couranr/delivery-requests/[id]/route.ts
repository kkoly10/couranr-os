import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { getDeliveryRequest, isCommandFailure } from "@/lib/couranr/requests/commands";
import { toDeliveryRequestView } from "@/lib/couranr/requests/view";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** GET — MER-007 delivery detail. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "Delivery request not found." }, { status: 404 });
  }

  const businessAccountId = req.nextUrl.searchParams.get("businessAccountId");
  if (businessAccountId !== null && !UUID_RE.test(businessAccountId)) {
    return NextResponse.json({ error: "A business account is required." }, { status: 400 });
  }

  const actor = await resolveRequestActor(req, businessAccountId);
  if (isActorDenied(actor)) return NextResponse.json({ error: actor.error }, { status: actor.status });

  const result = await getDeliveryRequest({
    actor: actor.actor,
    businessAccountId,
    requestId: params.id,
  });
  if (isCommandFailure(result)) {
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }

  return NextResponse.json({
    request: toDeliveryRequestView(result.value.request),
    events: result.value.events,
  });
}

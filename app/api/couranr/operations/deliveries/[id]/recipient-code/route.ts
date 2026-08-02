import { NextRequest, NextResponse } from "next/server";
import { isDriverFailure, issueHandoffCode } from "@/lib/couranr/driver/commands";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST — Couranr Operations issues the recipient's drop-off code.
 *
 * Operations only, and a separate route from the pickup code for the same
 * reason the merchant pair is separate: two credentials, two holders, two HMAC
 * domains, and no parameter that could send the wrong one.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  if (!UUID_RE.test(params.id)) return routeFailure("not_found", "Delivery not found.");

  const r = await issueHandoffCode({
    actorUserId: actor.userId,
    deliveryId: params.id,
    kind: "recipient_dropoff",
  });
  if (isDriverFailure(r)) return failureResponse(r);
  return NextResponse.json({ handoffCode: r.value });
}

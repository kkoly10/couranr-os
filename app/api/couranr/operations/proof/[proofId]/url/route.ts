import { NextRequest, NextResponse } from "next/server";
import { isDriverFailure } from "@/lib/couranr/driver/commands";
import { signedProofUrl } from "@/lib/couranr/driver/proof";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * GET — a signed URL for any proof image, for Couranr Operations.
 *
 * No ownership walk, unlike the driver route: reviewing evidence across every
 * business IS the Operations capability, so the actor gate is the whole
 * boundary. That is also why this route is Operations-only rather than
 * scoped — there is no narrower answer it could give.
 *
 * The 900-second TTL is chosen by the viewer role inside the proof policy and
 * is not a parameter. A reviewer working a dispute needs longer than a driver
 * glancing at a photo; neither of them gets to say so in a request.
 */
export async function GET(req: NextRequest, { params }: { params: { proofId: string } }) {
  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  if (!UUID_RE.test(params.proofId)) {
    return routeFailure("not_found", "There is no image for that proof.");
  }

  const r = await signedProofUrl({ proofId: params.proofId, viewer: "operations" });
  if (isDriverFailure(r)) return failureResponse(r);
  return NextResponse.json({ url: r.value.url, expiresInSeconds: r.value.expiresInSeconds });
}

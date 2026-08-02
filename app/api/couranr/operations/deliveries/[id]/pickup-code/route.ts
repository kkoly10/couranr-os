import { NextRequest, NextResponse } from "next/server";
import { isDriverFailure, issueHandoffCode } from "@/lib/couranr/driver/commands";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST — Couranr Operations issues a pickup code on the sender's behalf.
 *
 * Exists because the merchant route cannot cover the support call: a sender who
 * cannot reach their own screen, or whose code was read out to the wrong
 * person, needs someone who can supersede it. Passing null to
 * `resolveRequestActor` is this codebase's spelling of "Operations only", so no
 * merchant reaches this path however they are scoped.
 *
 * Regeneration is the same call. The SQL supersedes every live generation of
 * this kind, which is exactly what a compromised code needs, and the digest is
 * bound to the new generation so the old six digits cannot verify against it.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  if (!UUID_RE.test(params.id)) return routeFailure("not_found", "Delivery not found.");

  const r = await issueHandoffCode({
    actorUserId: actor.userId,
    deliveryId: params.id,
    kind: "merchant_pickup",
  });
  if (isDriverFailure(r)) return failureResponse(r);
  return NextResponse.json({ handoffCode: r.value });
}

import { NextRequest, NextResponse } from "next/server";
import { isDriverFailure, issueHandoffCode } from "@/lib/couranr/driver/commands";
import {
  isActorDenied,
  resolveRequestActor,
  resolveUserId,
} from "@/lib/couranr/requests/actor";
import {
  failureResponse,
  routeFailure,
  routeInternalFailure,
} from "@/lib/couranr/requests/respond";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST — the sender issues (or regenerates) the pickup code for their own
 * delivery.
 *
 * TWO RESOLUTIONS, DELIBERATELY. The Bearer token is validated first so no
 * unauthenticated caller can use this route to learn whether a delivery id is
 * real; only then is the delivery read, and only then is the actor resolved
 * AGAINST that delivery's business account. A merchant cannot send the scope
 * they want to be judged by — the delivery decides it.
 *
 * There is no "regenerate" flag. The SQL command supersedes every live
 * generation of this kind and mints the next one, so issuing and regenerating
 * are one call and a caller cannot select between two behaviours.
 *
 * The code is returned exactly once, in this response. It is never stored in
 * plain form, never logged, and no route anywhere reads one back.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await resolveUserId(req);
  if (isActorDenied(auth)) return routeFailure(auth.code, auth.error);

  if (!UUID_RE.test(params.id)) return routeFailure("not_found", "Delivery not found.");

  const { data: delivery, error: deliveryFailed } = (await supabaseAdmin
    .from("couranr_deliveries")
    .select("id,business_account_id")
    .eq("id", params.id)
    .maybeSingle()) as { data: any; error: any };
  if (deliveryFailed) return routeInternalFailure({ operation: "merchantPickupCode:delivery" });
  if (!delivery) return routeFailure("not_found", "Delivery not found.");

  const businessAccountId = String(delivery.business_account_id ?? "");
  if (!UUID_RE.test(businessAccountId)) {
    return routeInternalFailure({ operation: "merchantPickupCode:scope" });
  }

  const actor = await resolveRequestActor(req, businessAccountId);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);
  // A member of some OTHER business resolves with a null membership, and a
  // membership that is merely invited or disabled is not access either — the
  // permission module treats only `active` as a member who may act.
  if (
    actor.actor.kind === "member" &&
    (actor.actor.membership === null || actor.actor.membership.status !== "active")
  ) {
    return routeFailure("not_permitted", "You do not have access to this delivery.");
  }

  const r = await issueHandoffCode({
    actorUserId: actor.userId,
    deliveryId: params.id,
    kind: "merchant_pickup",
  });
  if (isDriverFailure(r)) return failureResponse(r);
  return NextResponse.json({ handoffCode: r.value });
}

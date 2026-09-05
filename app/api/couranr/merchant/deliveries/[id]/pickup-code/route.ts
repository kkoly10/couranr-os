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
} from "@/lib/couranr/requests/respond";
import {
  isDispatchFailure,
  resolveMerchantBusinessForDelivery,
} from "@/lib/couranr/dispatch/commands";
import { canActOnDeliveryRequest } from "@/lib/couranr/requests/permissions";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST — the sender issues (or regenerates) the pickup code for their own
 * delivery.
 *
 * TWO RESOLUTIONS, DELIBERATELY. The Bearer token is validated first so no
 * unauthenticated caller can use this route to learn whether a delivery id is
 * real; only then is merchant authority derived from the delivery. Direct
 * merchant deliveries use delivery.business_account_id; hosted Consumer
 * deliveries use the durable hosted-intake relationship. A merchant cannot
 * send the scope they want to be judged by — the delivery decides it.
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

  const scope = await resolveMerchantBusinessForDelivery(params.id);
  if (isDispatchFailure(scope)) return failureResponse(scope);
  const businessAccountId = scope.value.businessAccountId;

  const actor = await resolveRequestActor(req, businessAccountId);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  const permission = canActOnDeliveryRequest(
    actor.actor,
    "submit",
    businessAccountId
  );
  if (!permission.allowed) {
    // Do not turn a valid delivery UUID into a cross-tenant existence oracle.
    // A real member with a read-only role gets the useful 403; someone outside
    // the host business gets the same 404 as for a missing delivery.
    if (actor.actor.kind === "member" && !actor.actor.membership) {
      return routeFailure("not_found", "Delivery not found.");
    }
    return routeFailure(
      "not_permitted",
      "Your role can view this delivery but cannot issue handoff codes."
    );
  }

  const r = await issueHandoffCode({
    actorUserId: actor.userId,
    deliveryId: params.id,
    kind: "merchant_pickup",
  });
  if (isDriverFailure(r)) return failureResponse(r);
  return NextResponse.json({ handoffCode: r.value });
}

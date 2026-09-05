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
 * POST — the sender issues the code their RECIPIENT will give the driver.
 *
 * A separate route from the pickup code rather than a `kind` parameter: the two
 * are different credentials, held by different people, under different HMAC
 * domains. A parameter would put "which credential am I minting" one typo away
 * from wrong, and the merchant would hand the recipient a code that opens the
 * pickup instead.
 *
 * Same two-step resolution as the pickup code: authenticate, then derive the
 * merchant scope from the delivery (direct tenant or hosted relationship), then
 * resolve the actor against that scope.
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
    return routeFailure(
      "not_permitted",
      "Your role can view this delivery but cannot issue handoff codes."
    );
  }

  const r = await issueHandoffCode({
    actorUserId: actor.userId,
    deliveryId: params.id,
    kind: "recipient_dropoff",
  });
  if (isDriverFailure(r)) return failureResponse(r);
  return NextResponse.json({ handoffCode: r.value });
}

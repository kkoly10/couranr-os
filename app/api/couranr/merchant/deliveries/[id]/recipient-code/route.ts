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
 * POST — the sender issues the code their RECIPIENT will give the driver.
 *
 * A separate route from the pickup code rather than a `kind` parameter: the two
 * are different credentials, held by different people, under different HMAC
 * domains. A parameter would put "which credential am I minting" one typo away
 * from wrong, and the merchant would hand the recipient a code that opens the
 * pickup instead.
 *
 * Same two-step resolution as the pickup code: authenticate, then read the
 * delivery, then resolve the actor against the delivery's own business account.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await resolveUserId(req);
  if (isActorDenied(auth)) return routeFailure(auth.code, auth.error);

  if (!UUID_RE.test(params.id)) return routeFailure("not_found", "Delivery not found.");

  const { data: delivery, error: deliveryFailed } = (await supabaseAdmin
    .from("couranr_deliveries")
    .select("id,business_account_id")
    .eq("id", params.id)
    .maybeSingle()) as { data: any; error: any };
  if (deliveryFailed) return routeInternalFailure({ operation: "merchantRecipientCode:delivery" });
  if (!delivery) return routeFailure("not_found", "Delivery not found.");

  const businessAccountId = String(delivery.business_account_id ?? "");
  if (!UUID_RE.test(businessAccountId)) {
    return routeInternalFailure({ operation: "merchantRecipientCode:scope" });
  }

  const actor = await resolveRequestActor(req, businessAccountId);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);
  if (
    actor.actor.kind === "member" &&
    (actor.actor.membership === null || actor.actor.membership.status !== "active")
  ) {
    return routeFailure("not_permitted", "You do not have access to this delivery.");
  }

  const r = await issueHandoffCode({
    actorUserId: actor.userId,
    deliveryId: params.id,
    kind: "recipient_dropoff",
  });
  if (isDriverFailure(r)) return failureResponse(r);
  return NextResponse.json({ handoffCode: r.value });
}

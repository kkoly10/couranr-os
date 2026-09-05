import { NextRequest, NextResponse } from "next/server";
import { isDriverFailure, listProofMetadata } from "@/lib/couranr/driver/proof";
import {
  isActorDenied,
  resolveRequestActor,
  resolveUserId,
} from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import {
  isDispatchFailure,
  resolveMerchantBusinessForDelivery,
} from "@/lib/couranr/dispatch/commands";
import { canActOnDeliveryRequest } from "@/lib/couranr/requests/permissions";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * GET — what proof EXISTS for the sender's own delivery. Metadata only.
 *
 * The merchant is deliberately not among the media viewers: they learn the
 * stage, the type, when it finalized and that an image is attached — never the
 * object path, never a bucket, never a signed URL, never the capture
 * coordinates, and never the driver. There is no sibling route here that
 * returns a URL, because for this audience one does not exist.
 *
 * `listProofMetadata` is scoped by delivery id alone, so the whole
 * authorization is the resolution above it. Direct merchant deliveries use
 * delivery.business_account_id; hosted Consumer deliveries resolve the durable
 * hosted-intake relationship without fabricating merchant tenancy.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
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
    "read",
    businessAccountId
  );
  if (!permission.allowed) {
    // A signed-in user outside this business gets the same answer as for a
    // missing delivery. Active members may read proof metadata.
    if (actor.actor.kind === "member" && !actor.actor.membership) {
      return routeFailure("not_found", "Delivery not found.");
    }
    return routeFailure("not_permitted", "You do not have access to this delivery.");
  }

  const proof = await listProofMetadata(params.id);
  // A failed read must not render as "no proof was captured". Not knowing and
  // knowing there is none are different facts, and the merchant acts
  // differently on each.
  if (isDriverFailure(proof)) return failureResponse(proof);
  return NextResponse.json({ proof: proof.value });
}

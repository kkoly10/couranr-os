import { NextRequest, NextResponse } from "next/server";
import { isDriverFailure, listProofMetadata } from "@/lib/couranr/driver/proof";
import {
  isActorDenied,
  resolveRequestActor,
  resolveUserId,
} from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure, routeInternalFailure } from "@/lib/couranr/requests/respond";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

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
 * authorization is the resolution above it: the delivery's own business account
 * decides who may ask.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await resolveUserId(req);
  if (isActorDenied(auth)) return routeFailure(auth.code, auth.error);

  if (!UUID_RE.test(params.id)) return routeFailure("not_found", "Delivery not found.");

  const { data: delivery, error: deliveryFailed } = (await supabaseAdmin
    .from("couranr_deliveries")
    .select("id,business_account_id")
    .eq("id", params.id)
    .maybeSingle()) as { data: any; error: any };
  if (deliveryFailed) return routeInternalFailure({ operation: "merchantProof:delivery" });
  if (!delivery) return routeFailure("not_found", "Delivery not found.");

  const businessAccountId = String(delivery.business_account_id ?? "");
  if (!UUID_RE.test(businessAccountId)) {
    return routeInternalFailure({ operation: "merchantProof:scope" });
  }

  const actor = await resolveRequestActor(req, businessAccountId);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);
  if (
    actor.actor.kind === "member" &&
    (actor.actor.membership === null || actor.actor.membership.status !== "active")
  ) {
    return routeFailure("not_permitted", "You do not have access to this delivery.");
  }

  const proof = await listProofMetadata(params.id);
  // A failed read must not render as "no proof was captured". Not knowing and
  // knowing there is none are different facts, and the merchant acts
  // differently on each.
  if (isDriverFailure(proof)) return failureResponse(proof);
  return NextResponse.json({ proof: proof.value });
}

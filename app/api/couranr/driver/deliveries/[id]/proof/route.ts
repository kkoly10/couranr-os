import { NextRequest, NextResponse } from "next/server";
import { isDriverFailure, listProofMetadata } from "@/lib/couranr/driver/proof";
import { isActorDenied, resolveUserId } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure, routeInternalFailure } from "@/lib/couranr/requests/respond";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** One answer for every reason this is not the caller's delivery. */
const NOT_YOURS = "That delivery is not assigned to you.";

/**
 * GET — what proof the CALLING DRIVER has already recorded on their own
 * delivery. Metadata only, exactly like the merchant's view.
 *
 * WHY THIS EXISTS. The pickup form's requirements were tracked purely in the
 * page's own state, so nothing survived a reload. A driver who photographed the
 * shipment, lost the tab at a loading dock and came back was told to record it
 * again — while Couranr already held the proof and the server would have
 * accepted the completion. They could recover only by re-doing work they had
 * already done, with no way to see what was already stored.
 *
 * Scoped to an ACTIVE assignment on THIS driver's profile, the same walk
 * `…/driver/proof/[proofId]/url` performs: caller -> their driver profile ->
 * the assignment on this delivery. A driver who is not the assigned one gets
 * the same sentence as a driver asking about a delivery that does not exist, so
 * this cannot be used to discover which delivery ids are real.
 *
 * It returns NO object path, NO bucket and NO signed URL — `listProofMetadata`
 * reduces a row to stage, type, time and whether an image exists. Opening an
 * image remains a separate, separately-scoped route with its own 600-second
 * TTL, so widening this one cannot widen media access.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await resolveUserId(req);
  if (isActorDenied(auth)) return routeFailure(auth.code, auth.error);

  if (!UUID_RE.test(params.id)) return routeFailure("not_found", NOT_YOURS);

  const { data: driver, error: driverFailed } = (await supabaseAdmin
    .from("couranr_drivers")
    .select("id")
    .eq("user_id", auth.userId)
    .maybeSingle()) as { data: any; error: any };
  // A failed lookup fails CLOSED as an internal error rather than joining the
  // cases NOT_YOURS covers — "we could not check" is not "not yours".
  if (driverFailed) return routeInternalFailure({ operation: "driverProofList:driver" });
  if (!driver) return routeFailure("not_found", NOT_YOURS);

  const { data: assignment, error: assignmentFailed } = (await supabaseAdmin
    .from("couranr_delivery_assignments")
    .select("id")
    .eq("delivery_id", params.id)
    .eq("driver_id", driver.id)
    .eq("assignment_state", "active")
    .maybeSingle()) as { data: any; error: any };
  if (assignmentFailed) return routeInternalFailure({ operation: "driverProofList:assignment" });
  if (!assignment) return routeFailure("not_found", NOT_YOURS);

  const proof = await listProofMetadata(params.id);
  // A failed read must not render as "you have recorded nothing" — that is the
  // whole defect this route exists to close, and returning [] here would
  // reintroduce it one layer down.
  if (isDriverFailure(proof)) return failureResponse(proof);

  const { data: pickupCode, error: pickupCodeError } = (await supabaseAdmin
    .from("couranr_handoff_codes")
    .select("code_state")
    .eq("delivery_id", params.id)
    .eq("code_kind", "merchant_pickup")
    .eq("code_state", "consumed")
    .order("generation", { ascending: false })
    .limit(1)
    .maybeSingle()) as { data: any; error: any };
  if (pickupCodeError) return routeInternalFailure({ operation: "driverProofList:pickupCode" });

  return NextResponse.json({
    proof: proof.value,
    pickupCredentialVerified: Boolean(pickupCode),
  });
}

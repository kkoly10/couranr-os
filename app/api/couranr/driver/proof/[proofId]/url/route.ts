import { NextRequest, NextResponse } from "next/server";
import { isDriverFailure } from "@/lib/couranr/driver/commands";
import { signedProofUrl } from "@/lib/couranr/driver/proof";
import { isActorDenied, resolveUserId } from "@/lib/couranr/requests/actor";
import {
  failureResponse,
  routeFailure,
  routeInternalFailure,
} from "@/lib/couranr/requests/respond";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * ONE answer for every reason a driver may not see an image: a malformed id, a
 * proof that does not exist, a proof with no media, and a proof belonging to
 * somebody else's delivery are all this sentence. A distinct refusal for the
 * last case would turn this route into an oracle for which proof ids are real.
 */
const NO_MEDIA = "There is no image for that proof.";

/**
 * GET — a short-lived signed URL for one of the CALLER'S OWN proof images.
 *
 * `signedProofUrl` has no idea who is asking; it signs whatever proof id it is
 * handed. So the ownership walk happens here, before anything is signed:
 * caller -> their driver profile -> the assignment the proof was recorded
 * under. Scoped to an ACTIVE assignment, which is what a driver needs to review
 * a photo mid-run; once a delivery is finished the assignment is `completed`
 * and the driver's evidence access ends with the job.
 *
 * The TTL is not a parameter. It is chosen by the viewer role — 600 seconds for
 * a driver — inside the proof policy, so no caller can lengthen the life of a
 * URL to private media.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ proofId: string }> }) {
  const params = await props.params;
  const auth = await resolveUserId(req);
  if (isActorDenied(auth)) return routeFailure(auth.code, auth.error);

  if (!UUID_RE.test(params.proofId)) return routeFailure("not_found", NO_MEDIA);

  const { data: driver, error: driverFailed } = (await supabaseAdmin
    .from("couranr_drivers")
    .select("id")
    .eq("user_id", auth.userId)
    .maybeSingle()) as { data: any; error: any };
  // A failed lookup must never read as "not yours": it fails closed as an
  // internal error rather than joining the four cases NO_MEDIA covers.
  if (driverFailed) return routeInternalFailure({ operation: "driverProofUrl:driver" });
  if (!driver) return routeFailure("not_found", NO_MEDIA);

  const { data: proof, error: proofFailed } = (await supabaseAdmin
    .from("couranr_delivery_proofs")
    .select("id,assignment_id")
    .eq("id", params.proofId)
    .maybeSingle()) as { data: any; error: any };
  if (proofFailed) return routeInternalFailure({ operation: "driverProofUrl:proof" });
  if (!proof || !UUID_RE.test(String(proof.assignment_id ?? ""))) {
    return routeFailure("not_found", NO_MEDIA);
  }

  const { data: assignment, error: assignmentFailed } = (await supabaseAdmin
    .from("couranr_delivery_assignments")
    .select("id")
    .eq("id", proof.assignment_id)
    .eq("driver_id", driver.id)
    .eq("assignment_state", "active")
    .maybeSingle()) as { data: any; error: any };
  if (assignmentFailed) return routeInternalFailure({ operation: "driverProofUrl:assignment" });
  if (!assignment) return routeFailure("not_found", NO_MEDIA);

  const r = await signedProofUrl({ proofId: params.proofId, viewer: "driver" });
  if (isDriverFailure(r)) return failureResponse(r);
  return NextResponse.json({ url: r.value.url, expiresInSeconds: r.value.expiresInSeconds });
}

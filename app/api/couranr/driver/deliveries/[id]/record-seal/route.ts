import { NextRequest, NextResponse } from "next/server";
import { isDriverFailure, recordDeliverySeal } from "@/lib/couranr/driver/commands";
import { isActorDenied, resolveUserId } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST — the driver records the tamper-evident seal applied at a secure pickup.
 *
 * The body carries two things and neither is an authority claim: the serial
 * printed on the physical seal, and the id of the sealed-package photograph it
 * is visible in. WHO the driver is comes from the session, and WHETHER they hold
 * this delivery is resolved inside the SQL by couranr_driver_assignment_for —
 * so a caller holding a delivery UUID cannot seal someone else's shipment.
 *
 * The SQL also refuses a seal on a delivery whose protection level does not
 * require one, and a photograph belonging to a different delivery. Those are
 * refusals rather than silent no-ops: a seal recorded where none was asked for
 * implies a custody ceremony the sender was never told about.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await resolveUserId(req);
  if (isActorDenied(auth)) return routeFailure(auth.code, auth.error);

  if (!UUID_RE.test(params.id)) return routeFailure("not_found", "Delivery not found.");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Expected a JSON body.");
  }

  const sealIdentifier = typeof body?.sealIdentifier === "string" ? body.sealIdentifier : "";
  const sealedPackageProofId =
    typeof body?.sealedPackageProofId === "string" ? body.sealedPackageProofId : "";
  if (!UUID_RE.test(sealedPackageProofId)) {
    return routeFailure("invalid_input", "Take the sealed-package photo before recording the seal.");
  }

  const r = await recordDeliverySeal({
    userId: auth.userId,
    deliveryId: params.id,
    sealIdentifier,
    sealedPackageProofId,
  });
  if (isDriverFailure(r)) return failureResponse(r);
  // NESTED key, like every other canonical route.
  return NextResponse.json({ seal: r.value });
}

import { NextRequest, NextResponse } from "next/server";
import { isDriverFailure, recordSealCondition } from "@/lib/couranr/driver/commands";
import { isActorDenied, resolveUserId } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST — the driver records what the seal looks like at handoff.
 *
 * The body carries one closed value: intact, damaged or missing. WHO the driver
 * is comes from the session, and WHETHER they hold this delivery is resolved
 * inside the SQL by couranr_driver_assignment_for.
 *
 * A damaged or missing seal is NOT an error and does not block the delivery.
 * Making honesty expensive would give the one person holding the parcel a
 * reason to report it intact, so the refusals here are about authority and
 * shape only — never about what the driver saw.
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

  const condition = typeof body?.condition === "string" ? body.condition : "";
  const r = await recordSealCondition({
    userId: auth.userId,
    deliveryId: params.id,
    condition,
  });
  if (isDriverFailure(r)) return failureResponse(r);
  // NESTED key, like every other canonical route.
  return NextResponse.json({ seal: r.value });
}

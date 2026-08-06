import { NextRequest, NextResponse } from "next/server";
import { isDriverFailure, startRouteToDropoff } from "@/lib/couranr/driver/commands";
import { isActorDenied, resolveUserId } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST — the shipment is loaded and moving (`picked_up -> in_transit`).
 *
 * Separate route rather than a target state on one endpoint: the two "start
 * route" steps have different preconditions and different audit records, and
 * collapsing them would let a caller reach one by mistyping the other.
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

  const expectedVersion = Number(body?.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return routeFailure("invalid_input", "A current delivery version is required.");
  }

  const r = await startRouteToDropoff({
    userId: auth.userId,
    deliveryId: params.id,
    expectedVersion,
  });
  if (isDriverFailure(r)) return failureResponse(r);
  return NextResponse.json({ delivery: r.value });
}

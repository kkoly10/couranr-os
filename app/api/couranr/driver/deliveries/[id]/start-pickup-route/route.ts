import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveUserId } from "@/lib/couranr/requests/actor";
import { isDriverFailure, startRouteToPickup } from "@/lib/couranr/driver/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST — the driver is leaving for pickup (`assigned -> en_route_to_pickup`).
 *
 * The body carries a version and nothing else. There is no destination
 * parameter: this command's landing state is hard-coded in SQL, so a browser
 * can pick WHICH command runs but never WHERE it lands.
 *
 * Authentication happens before the delivery id is even looked at, and the
 * command derives the caller's own assignment from `auth.userId` — the id in
 * the path can only NARROW it. A driver naming someone else's delivery gets
 * the same refusal an unassigned driver gets.
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

  const r = await startRouteToPickup({
    userId: auth.userId,
    deliveryId: params.id,
    expectedVersion,
  });
  if (isDriverFailure(r)) return failureResponse(r);
  return NextResponse.json({ delivery: r.value });
}

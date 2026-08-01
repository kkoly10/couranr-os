import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveUserId } from "@/lib/couranr/requests/actor";
import { getAssignedDeliveryForDriver, isDispatchFailure } from "@/lib/couranr/dispatch/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * GET — the ONE delivery assigned to the calling driver, sanitized.
 *
 * Scoped by the caller's own user id, never by anything they sent. The optional
 * `deliveryId` query parameter narrows but cannot widen: a driver asking about
 * a delivery that is not theirs gets `assigned: null`, exactly what a driver
 * with no work gets. "You have none" and "that is not yours" are deliberately
 * indistinguishable — a 403 here would confirm the delivery exists.
 *
 * There is no POST, PUT or DELETE on this route on purpose. A driver cannot
 * assign, replace, cancel or self-select anything in this slice; every dispatch
 * mutation lives under /api/couranr/operations and is gated on the Operations
 * actor.
 *
 * Authentication is `resolveUserId`, NOT `resolveRequestActor(req, null)`.
 * Passing null to the latter is this codebase's spelling of "Operations only",
 * so using it here refused every driver with "Couranr Operations access
 * required" — the whole DRV-001/DRV-002 surface was unreachable by the only
 * people it exists for. Authorization is not weakened by the change: it never
 * lived in the actor gate. It lives in `getAssignedDeliveryForDriver`, which
 * starts from THIS user's driver profile and walks to their one active
 * assignment, so an authenticated stranger gets `assigned: null` and learns
 * nothing.
 */
export async function GET(req: NextRequest) {
  const auth = await resolveUserId(req);
  if (isActorDenied(auth)) return routeFailure(auth.code, auth.error);
  const userId = auth.userId;

  const raw = req.nextUrl.searchParams.get("deliveryId");
  // A malformed id is treated as "no such assignment" rather than as a
  // validation error, so probing with junk teaches nothing either.
  const deliveryId = raw && UUID_RE.test(raw) ? raw : raw ? "" : null;
  if (deliveryId === "") return NextResponse.json({ assigned: null });

  const r = await getAssignedDeliveryForDriver({ userId, deliveryId });
  if (isDispatchFailure(r)) return failureResponse(r);
  return NextResponse.json({ assigned: r.value.assigned });
}

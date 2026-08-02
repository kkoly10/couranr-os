import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveUserId } from "@/lib/couranr/requests/actor";
import { getAssignedDeliveryForDriver, isDispatchFailure } from "@/lib/couranr/dispatch/commands";
import { driverCompletionReceipt } from "@/lib/couranr/driver/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * GET — the ONE delivery assigned to the calling driver, sanitized.
 *
 * THREE-WAY DISCRIMINATED ANSWER, because two of the three used to look
 * identical. A driver who has just delivered and a driver with no work both
 * produced `assigned: null`, so the screen that had shown a live delivery a
 * second earlier fell back to "nothing assigned" — the completion vanished at
 * the moment it mattered most. `status` now separates them:
 *
 *   active             the assignment, projected
 *   recently_completed the receipt, for the 24 hours the SQL keeps it visible
 *   none               genuinely nothing
 *
 * Scoped by the caller's own user id, never by anything they sent. The optional
 * `deliveryId` query parameter narrows but cannot widen: a driver asking about
 * a delivery that is not theirs gets `status: "none"`, exactly what a driver
 * with no work gets. "You have none" and "that is not yours" are deliberately
 * indistinguishable — a 403 here would confirm the delivery exists. The receipt
 * branch keeps that property: it is only reached for the caller's OWN completed
 * delivery, so it cannot answer a question about someone else's.
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
  if (deliveryId === "") return NextResponse.json({ status: "none", assigned: null });

  const r = await getAssignedDeliveryForDriver({ userId, deliveryId });
  if (isDispatchFailure(r)) return failureResponse(r);
  if (r.value.assigned) return NextResponse.json({ status: "active", assigned: r.value.assigned });

  // Only consulted once there is no live assignment, and only for the delivery
  // that was asked about: a driver narrowing to delivery X must not be handed
  // the receipt for delivery Y. The receipt is always the caller's own —
  // `couranr_driver_completion_receipt` starts from their user id — so this
  // reveals nothing either way.
  const receipt = await driverCompletionReceipt(userId);
  if (receipt && (deliveryId === null || receipt.deliveryId === deliveryId)) {
    return NextResponse.json({ status: "recently_completed", receipt });
  }

  return NextResponse.json({ status: "none", assigned: null });
}

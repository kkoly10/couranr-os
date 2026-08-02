import { NextRequest, NextResponse } from "next/server";
import { isDriverFailure, unassignDeliveryBeforePickup } from "@/lib/couranr/driver/commands";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_REASON = 200;

/**
 * POST — take a delivery back off a driver before pickup.
 *
 * Operations only, and it CLOSES at `at_pickup`: once a driver is standing at
 * the sender the SQL refuses with `too_late_to_unassign`, because from that
 * point the shipment's custody, not the schedule, is what is being decided.
 * The window is enforced in the command, never by whatever the queue screen
 * happened to render.
 *
 * The reason is mandatory. This is the one dispatch action that silently
 * removes work from someone who was counting on it, and an unassignment with
 * no recorded reason is unreviewable a week later.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

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

  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (reason.length === 0) {
    return routeFailure("invalid_input", "A reason is required.");
  }
  if (reason.length > MAX_REASON) {
    return routeFailure("invalid_input", `Keep the reason under ${MAX_REASON} characters.`);
  }

  const r = await unassignDeliveryBeforePickup({
    actor: actor.actor,
    deliveryId: params.id,
    expectedVersion,
    reason,
  });
  if (isDriverFailure(r)) return failureResponse(r);
  return NextResponse.json({ delivery: r.value });
}

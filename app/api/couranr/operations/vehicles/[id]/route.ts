import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { isDispatchFailure, updateDispatchVehicle } from "@/lib/couranr/dispatch/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { SETTABLE_AVAILABILITY } from "@/lib/couranr/dispatch/states";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * PATCH — edit a canonical vehicle, or take it out of service.
 *
 * A vehicle currently on a delivery cannot be deactivated or marked
 * unavailable here; releasing it is what replacing the assignment does. The
 * SQL refuses that too, so the rule holds even if this route is bypassed.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) return routeFailure("not_found", "Vehicle not found.");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Expected a JSON body.");
  }

  const expectedVersion = Number(body?.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return routeFailure("invalid_input", "A current version is required.");
  }
  if (
    body?.availabilityState != null &&
    !SETTABLE_AVAILABILITY.includes(String(body.availabilityState) as any)
  ) {
    return routeFailure("invalid_input", "That is not an availability Couranr can set.");
  }

  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  const capacity = Number(body?.payloadCapacityLb);

  const r = await updateDispatchVehicle({
    actor: actor.actor,
    vehicleId: params.id,
    expectedVersion,
    name: typeof body?.name === "string" ? body.name : null,
    payloadCapacityLb: Number.isFinite(capacity) && capacity > 0 ? Math.trunc(capacity) : null,
    active: typeof body?.active === "boolean" ? body.active : null,
    availabilityState: body?.availabilityState != null ? String(body.availabilityState) : null,
  });
  if (isDispatchFailure(r)) return failureResponse(r);
  return NextResponse.json(r.value);
}

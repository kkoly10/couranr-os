import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import {
  isDispatchFailure,
  setVehicleAvailability,
  updateDispatchVehicle,
} from "@/lib/couranr/dispatch/commands";
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
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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
  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  /*
   * `availability` names a DESTINATION and selects a named command; it is never
   * forwarded to SQL. Editing data and changing a state are two different
   * commands with two different audit meanings, so this route dispatches to
   * one or the other rather than doing both at once.
   */
  const availability = body?.availability;
  if (availability != null) {
    if (!SETTABLE_AVAILABILITY.includes(String(availability) as any)) {
      return routeFailure("invalid_input", "That is not an availability Couranr can set.");
    }
    const moved = await setVehicleAvailability({
      actor: actor.actor,
      vehicleId: params.id,
      expectedVersion,
      availabilityState: String(availability),
    });
    if (isDispatchFailure(moved)) return failureResponse(moved);
    return NextResponse.json(moved.value);
  }

  const capacity = Number(body?.payloadCapacityLb);

  const r = await updateDispatchVehicle({
    actor: actor.actor,
    vehicleId: params.id,
    expectedVersion,
    name: typeof body?.name === "string" ? body.name : null,
    payloadCapacityLb: Number.isFinite(capacity) && capacity > 0 ? Math.trunc(capacity) : null,
  });
  if (isDispatchFailure(r)) return failureResponse(r);
  return NextResponse.json(r.value);
}
